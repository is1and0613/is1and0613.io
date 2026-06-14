// cloudbase_api_v3.js
// 修复版：add/addBatch 直接传入数据，避免被 SDK 自动包进 data 字段

const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");

// 懒初始化，冷启动失败时不影响 OPTIONS 响应
let _db = null;
function getDb() {
    if (!_db) {
        const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
        _db = app.database();
    }
    return _db;
}

const JWT_SECRET = process.env.JWT_SECRET || "niteshift-secret-key-2005-05-12";

function signJWT(payload) {
    const header = { alg: "HS256", typ: "JWT" };
    const h = Buffer.from(JSON.stringify(header)).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const data = h + "." + p;
    const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
    return data + "." + sig;
}

function verifyJWT(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const [h, p, sig] = parts;
        const data = h + "." + p;
        const expected = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
        if (sig !== expected) return null;
        const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) { return null; }
}

function requireAuth(event) {
    const auth = (event.headers || {}).authorization || (event.headers || {}).Authorization || "";
    if (!auth.startsWith("Bearer ")) return null;
    return verifyJWT(auth.substring(7));
}

function requireAdmin(event) {
    const user = requireAuth(event);
    if (!user || user.role !== "admin") return null;
    return user;
}

// PBKDF2-SHA256 密码验证（与前端 api-client.js hashPassword 格式一致）
// 前端格式: saltBase64$hashBase64  (16-byte salt, 100k iter, SHA-256, 256-bit output)
function verifyPassword(password, storedHash) {
    try {
        if (!storedHash || typeof storedHash !== 'string') return false;
        const parts = storedHash.split('$');
        if (parts.length !== 2) return false;
        const [saltB64, hashB64] = parts;
        const salt = Buffer.from(saltB64, 'base64');
        const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
        return derived.toString('base64') === hashB64;
    } catch (e) {
        console.error('verifyPassword error:', e.message);
        return false;
    }
}

// PBKDF2-SHA256 密码哈希（与前端 api-client.js hashPassword 格式一致）
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    return salt.toString('base64') + '$' + derived.toString('base64');
}

// ============ 内存速率限制器（按 IP 统计）============
const rateLimitMap = new Map();
const RATE_LIMIT = {
    login: { max: 1, windowMs: 5 * 1000 },      // 5秒内最多1次登录
    register: { max: 1, windowMs: 5 * 1000 },   // 5秒内最多1次注册
    general: { max: 60, windowMs: 60 * 1000 }   // 1分钟内60次通用请求
};

function checkRateLimit(ip, action) {
    const key = `${ip}:${action}`;
    const now = Date.now();
    const config = RATE_LIMIT[action] || RATE_LIMIT.general;

    if (!rateLimitMap.has(key)) {
        rateLimitMap.set(key, { count: 1, resetTime: now + config.windowMs });
        return { allowed: true };
    }

    const record = rateLimitMap.get(key);
    if (now > record.resetTime) {
        record.count = 1;
        record.resetTime = now + config.windowMs;
        return { allowed: true };
    }

    if (record.count >= config.max) {
        return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
    }

    record.count++;
    return { allowed: true };
}

// 🔒 无需 JWT 即可访问的公开路由
const PUBLIC_PATHS = [
    '/api/auth',
    '/api/userByUsername',
    '/api/verify-access-password',
    '/api/dorm-data',   // 有自己的 JWT-or-PIN 逻辑
    '/api/cleanup'      // 有自己的 JWT-or-Secret 双重认证
];

const COLLECTIONS = {
    users: 'users', rooms: 'rooms', room_members: 'room_members',
    room_states: 'room_states', room_logs: 'room_logs', room_messages: 'room_messages',
    check_sessions: 'check_sessions', check_records: 'check_records',
    single_check_records: 'single_check_records', dorm_students: 'dorm_students',
    grade_mapping: 'grade_mapping', settings: 'settings',
    system_logs: 'system_logs', login_logs: 'login_logs'
};

const ALLOWED_COLLECTIONS = Object.values(COLLECTIONS);

const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://niteshift.cn',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
};

function response(statusCode, body) {
    return {
        statusCode,
        isBase64Encoded: false,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

exports.main = async (event, context) => {
    console.log('=== RAW EVENT ===', JSON.stringify(event).substring(0, 500));

    // CORS preflight — 必须在所有 DB 操作之前返回，冷启动失败也不能影响 OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            isBase64Encoded: false,
            headers: corsHeaders,
            body: ''
        };
    }

    let params = event;
    let rawBody = event.body;

    if (rawBody) {
        if (event.isBase64Encoded) {
            rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
        }
        if (typeof rawBody === 'string') {
            try { params = JSON.parse(rawBody); } catch (e) {
                return response(400, { code: 400, message: 'Invalid JSON body' });
            }
        } else if (typeof rawBody === 'object') {
            params = rawBody;
        }
    }

    const { path, collection, data, where, limit = 100, skip = 0, orderBy } = params;
    console.log('path:', path, 'collection:', collection);

    if (collection && !ALLOWED_COLLECTIONS.includes(collection)) {
        return response(400, { code: 400, message: 'Invalid collection: ' + collection });
    }

    // ========== 🔒 JWT 认证中间件 ==========
    if (!PUBLIC_PATHS.includes(path)) {
        const authUser = requireAuth(event);
        if (!authUser) {
            return response(401, { code: 401, message: '未授权访问，缺少有效 Token' });
        }
        // 将用户信息注入 params，供后续路由使用
        params._user = authUser;
    }
    // =====================================

    // 🔒 获取客户端 IP + 对公开路由做速率限制
    const clientIp = (event.headers || {})['x-forwarded-for'] || (event.headers || {})['x-real-ip'] || 'unknown';

    if (['/api/auth', '/api/userByUsername'].includes(path)) {
        const limitAction = (params.action === 'login') ? 'login' : (params.action === 'register' ? 'register' : 'general');
        const limitResult = checkRateLimit(clientIp, limitAction);
        if (!limitResult.allowed) {
            return response(429, {
                code: 429,
                message: `请求过于频繁，请 ${limitResult.retryAfter} 秒后重试`
            });
        }
    }

    try {
        if (path === '/api/list') {
            const user = params._user;

            // 🔒 集合白名单：非 admin 禁止查询敏感集合
            const SENSITIVE_COLLECTIONS = ['users', 'settings', 'login_logs'];
            if (user && user.role !== 'admin' && SENSITIVE_COLLECTIONS.includes(collection)) {
                return response(403, { code: 403, message: '无权访问该集合' });
            }

            const whereClause = where || {};
            const queryLimit = Math.min(parseInt(limit) || 50, 200);
            let query = getDb().collection(collection).where(whereClause);
            if (orderBy) {
                const [field, direction] = orderBy.split(':');
                query = query.orderBy(field, direction || 'asc');
            }
            const { data: resData, total } = await query.limit(queryLimit).skip(parseInt(skip)).get();

            // 🔒 敏感字段过滤
            let safeData = resData;
            if (collection === 'users') {
                safeData = resData.map(u => {
                    const { password_hash, last_login_ip, ...safe } = u;
                    return safe;
                });
            }
            if (collection === 'settings') {
                safeData = resData.map(s => {
                    if (s.key === 'access_password') {
                        return { ...s, value: '***' };
                    }
                    return s;
                });
            }

            return response(200, { code: 0, data: safeData, total: total || safeData.length });
        }

        // 修改点 1：add 直接传入 data，不加 { data: ... } 包装
        if (path === '/api/add') {
            const user = params._user;

            // 🔒 禁止通过通用接口往敏感集合添加数据
            if (['users', 'settings'].includes(collection)) {
                return response(403, { code: 403, message: '禁止通过通用接口添加该集合' });
            }

            // 🔒 创建房间：admin 和 inspector 均可操作（查寝员需要创建查寝房间）
            if (collection === 'rooms' && user && user.role !== 'admin' && user.role !== 'inspector') {
                return response(403, { code: 403, message: '无权创建房间' });
            }

            const docData = { ...(data || {}), creator_id: user?.user_id, created_at: new Date() };
            const res = await getDb().collection(collection).add(docData);
            return response(200, { code: 0, data: { id: res.id || res._id }, message: 'Added' });
        }

        // 修改点 2：addBatch 直接传入 item，不加 { data: ... } 包装
        if (path === '/api/addBatch') {
            const items = data || [];
            if (items.length === 0) return response(200, { code: 0, results: [] });

            // 🔒 安全：users 表强制 role='inspector'，防止客户端提权
            const safeItems = collection === 'users'
                ? items.map(item => ({ ...item, role: 'inspector' }))
                : items;

            const results = [];
            const CONCURRENCY = 5;

            for (let i = 0; i < safeItems.length; i += CONCURRENCY) {
                const batch = safeItems.slice(i, i + CONCURRENCY);
                const promises = batch.map(item =>
                    getDb().collection(collection).add(item)
                        .then(res => ({ success: true, _id: res.id || res._id, old_id: item._old_id || null }))
                        .catch(err => ({ success: false, error: err.message, old_id: item._old_id || null }))
                );
                const batchResults = await Promise.all(promises);
                results.push(...batchResults);
            }

            const successCount = results.filter(r => r.success).length;
            console.log('addBatch:', safeItems.length, 'items,', successCount, 'success');
            return response(200, { code: 0, results });
        }

        // update 保持原样：SDK 的 data 参数是更新指令，不是文档字段
        if (path === '/api/update') {
            const user = params._user;
            const targetId = data?._id || data?.id;

            // 🔒 禁止通过通用接口修改敏感集合
            if (['users', 'settings'].includes(collection)) {
                return response(403, { code: 403, message: '禁止通过通用接口修改该集合' });
            }

            // 🔒 非 admin 只能修改自己创建的记录
            if (user && user.role !== 'admin') {
                const { data: target } = await getDb().collection(collection).doc(targetId).get();
                if (!target || target.creator_id !== user.user_id) {
                    return response(403, { code: 403, message: '无权修改该记录' });
                }
            }

            const { _id, ...updateData } = data;
            const res = await getDb().collection(collection).doc(targetId).update(updateData);
            return response(200, { code: 0, data: res });
        }

        if (path === '/api/delete') {
            const user = params._user;
            const targetId = data?._id || data?.id;

            // 🔒 禁止通过通用接口删除敏感集合
            if (['users', 'settings'].includes(collection)) {
                return response(403, { code: 403, message: '禁止通过通用接口删除该集合' });
            }

            // 🔒 非 admin 只能删除自己创建的记录
            if (user && user.role !== 'admin') {
                const { data: target } = await getDb().collection(collection).doc(targetId).get();
                if (!target || target.creator_id !== user.user_id) {
                    return response(403, { code: 403, message: '无权删除该记录' });
                }
            }

            await getDb().collection(collection).doc(targetId).remove();
            return response(200, { code: 0, message: 'Deleted' });
        }

        if (path === '/api/count') {
            const { total } = await getDb().collection(collection).where(where || {}).count();
            return response(200, { code: 0, count: total });
        }

        // 以下业务接口完全不动，因为查询条件查的是顶层字段
        if (path === '/api/roomByCode') {
            const { code } = data;
            const { data: rooms } = await getDb().collection(COLLECTIONS.rooms).where({ code: code }).limit(1).get();
            return response(200, { code: 0, data: rooms[0] || null });
        }

        if (path === '/api/roomMembers') {
            const { room_id } = data;
            const { data: members } = await getDb().collection(COLLECTIONS.room_members).where({ room_id: room_id }).get();
            return response(200, { code: 0, data: members });
        }

        if (path === '/api/roomStates') {
            const { room_id } = data;
            const { data: states } = await getDb().collection(COLLECTIONS.room_states).where({ room_id: room_id }).get();
            return response(200, { code: 0, data: states });
        }

        if (path === '/api/roomLogs') {
            const { room_id } = data;
            const { data: logs } = await getDb().collection(COLLECTIONS.room_logs).where({ room_id: room_id }).orderBy('created_at', 'desc').limit(200).get();
            return response(200, { code: 0, data: logs });
        }

        if (path === '/api/roomMessages') {
            const { room_id } = data;
            const { data: messages } = await getDb().collection(COLLECTIONS.room_messages).where({ room_id: room_id }).orderBy('created_at', 'asc').limit(500).get();
            return response(200, { code: 0, data: messages });
        }

        if (path === '/api/userByUsername') {
            const { username } = data;
            const { data: users } = await getDb().collection(COLLECTIONS.users).where({ username: username }).limit(1).get();
            if (users.length === 0) {
                return response(404, { code: 404, message: '用户不存在' });
            }
            // 🔒 绝不返回 password_hash
            const { password_hash, ...safeUser } = users[0];
            return response(200, { code: 0, data: safeUser });
        }

        if (path === '/api/checkRecords') {
            const { session_id } = data;
            const { data: records } = await getDb().collection(COLLECTIONS.check_records).where({ session_id: session_id }).get();
            return response(200, { code: 0, data: records });
        }

        if (path === '/api/singleCheckByUserDate') {
            const { user_id, check_date } = data;
            const { data: records } = await getDb().collection(COLLECTIONS.single_check_records).where({ user_id: user_id, check_date: check_date }).get();
            return response(200, { code: 0, data: records });
        }

        if (path === '/api/dormByFloor') {
            const { floor } = data;
            const { data: students } = await getDb().collection(COLLECTIONS.dorm_students).where({ floor: parseInt(floor) }).orderBy('dorm_name', 'asc').orderBy('bed', 'asc').get();
            return response(200, { code: 0, data: students });
        }

        if (path === '/api/dormByName') {
            const { dorm_name } = data;
            const { data: students } = await getDb().collection(COLLECTIONS.dorm_students).where({ dorm_name: dorm_name }).orderBy('bed', 'asc').get();
            return response(200, { code: 0, data: students });
        }

        if (path === '/api/gradeMapping') {
            const { data: mappings } = await getDb().collection(COLLECTIONS.grade_mapping).orderBy('display_order', 'asc').get();
            return response(200, { code: 0, data: mappings });
        }

        if (path === '/api/settings') {
            // 🔒 settings 仅 admin 可读
            const user = params._user;
            if (!user || user.role !== 'admin') {
                return response(403, { code: 403, message: '需要管理员权限' });
            }

            const { data: settings } = await getDb().collection(COLLECTIONS.settings).get();
            const result = {};
            for (const s of settings) {
                // 🔒 隐藏 access_password 明文
                result[s.key] = s.key === 'access_password' ? '***' : s.value;
            }
            return response(200, { code: 0, data: result });
        }

        if (path === '/api/updateSetting') {
            const { key, value } = data;
            const coll = getDb().collection(COLLECTIONS.settings);
            const { data: existing } = await coll.where({ key: key }).limit(1).get();
            if (existing.length > 0) {
                await coll.doc(existing[0]._id).update({ value: value, updated_at: new Date().toISOString() });
            } else {
                await coll.add({ key: key, value: value, updated_at: new Date().toISOString() });
            }
            return response(200, { code: 0, message: 'Setting updated' });
        }

        if (path === '/api/checkSensitive') {
            const { text } = data;
            const { data: wordDocs } = await getDb().collection(COLLECTIONS.settings).where({ key: 'sensitive_words' }).limit(1).get();
            let found = [];
            if (wordDocs.length > 0 && wordDocs[0].value) {
                const words = wordDocs[0].value.split('\n');
                for (const word of words) {
                    if (word && text && text.includes(word)) found.push(word);
                }
            }
            return response(200, { code: 0, found: found, count: found.length });
        }

        // ============ P0: 认证（服务端验证密码）v2026-0612b ============
        if (path === '/api/auth') {
            const { action, username, password } = params;
            console.log('[auth v2026-0612b] action:', action, 'username:', username, 'hasPassword:', !!password, 'passwordLen:', password ? password.length : 0);

            // ===== 登录 =====
            if (action === 'login') {
                if (!username || !password) {
                    return response(400, { code: 400, message: '缺少用户名或密码' });
                }

                // 1. 查用户（仅通过 username，不信任客户端传入的 user_id）
                const { data: users } = await getDb().collection(COLLECTIONS.users)
                    .where({ username }).limit(1).get();
                if (users.length === 0) {
                    return response(401, { code: 401, message: '用户名或密码错误' });
                }
                const user = users[0];

                // 2. 🔒 服务端验证密码（绝不信任客户端）
                const valid = verifyPassword(password, user.password_hash);
                console.log('[auth] login verifyPassword result:', valid);
                if (!valid) {
                    // 记录失败登录日志
                    const now = new Date().toISOString();
                    const ip = (event.headers || {})['x-forwarded-for'] || '';
                    const ua = ((event.headers || {})['user-agent'] || '').slice(0, 200);
                    try {
                        await getDb().collection(COLLECTIONS.login_logs).add({
                            user_id: user._id, username: user.username,
                            role: user.role || 'inspector',
                            login_at: now, ip, user_agent: ua,
                            status: 'fail', fail_reason: '密码错误',
                            migrated_from: 'd1'
                        });
                    } catch (e) { /* non-critical */ }
                    return response(401, { code: 401, message: '用户名或密码错误' });
                }

                // 3. 使用数据库中的 role，绝不信任客户端传入
                const now = new Date().toISOString();
                const ip = (event.headers || {})['x-forwarded-for'] || '';
                const ua = ((event.headers || {})['user-agent'] || '').slice(0, 200);

                await getDb().collection(COLLECTIONS.users).doc(user._id).update({
                    last_login_at: now, last_login_ip: ip
                }).catch(() => {});

                try {
                    await getDb().collection(COLLECTIONS.login_logs).add({
                        user_id: user._id, username: user.username,
                        role: user.role || 'inspector',
                        login_at: now, ip, user_agent: ua,
                        status: 'success', fail_reason: null,
                        migrated_from: 'd1'
                    });
                } catch (e) { /* non-critical */ }

                const token = signJWT({
                    user_id: user._id, username: user.username,
                    display_name: user.display_name || user.username,
                    role: user.role || 'inspector',
                    iat: Math.floor(Date.now() / 1000),
                    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
                });

                return response(200, {
                    code: 0, success: true, message: '登录成功', token,
                    user: { id: user._id, username: user.username, display_name: user.display_name || user.username, role: user.role || 'inspector' }
                });
            }

            // ===== 注册 =====
            if (action === 'register') {
                if (!username || !password) {
                    return response(400, { code: 400, message: '缺少用户名或密码' });
                }

                // 🔒 XSS 过滤：去掉 HTML 危险字符
                function sanitizeInput(str) {
                    if (!str) return str;
                    return str.replace(/[<>'"&]/g, '');
                }
                const safeUsername = sanitizeInput(username);
                const safeDisplayName = sanitizeInput(username);  // display_name 默认同 username

                // 🔒 长度限制
                if (safeUsername.length < 2 || safeUsername.length > 32) {
                    return response(400, { code: 400, message: '用户名长度应为 2-32 字符' });
                }

                // 🔒 密码强度校验（至少 6 位）
                if (!password || password.length < 6) {
                    return response(400, { code: 400, message: '密码至少 6 位' });
                }

                // 🔒 检查是否已存在（不暴露"用户名已存在"）
                const { data: existing } = await getDb().collection(COLLECTIONS.users)
                    .where({ username: safeUsername }).limit(1).get();
                if (existing.length > 0) {
                    return response(200, { code: 0, message: '注册请求已提交' });
                }

                // 🔒 服务端哈希密码，role 强制 inspector
                const password_hash = hashPassword(password);
                const createRes = await getDb().collection(COLLECTIONS.users).add({
                    username: safeUsername,
                    password_hash,
                    display_name: safeDisplayName,
                    role: 'inspector',
                    created_at: new Date().toISOString(),
                    is_temp: 0
                });

                const userId = createRes.id || createRes._id;

                // 签发 token（使用数据库中的真实 role）
                const token = signJWT({
                    user_id: userId,
                    username: safeUsername,
                    display_name: safeDisplayName,
                    role: 'inspector',
                    iat: Math.floor(Date.now() / 1000),
                    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
                });

                return response(200, {
                    code: 0, success: true, message: '注册请求已提交', token,
                    user: { id: userId, username: safeUsername, display_name: safeDisplayName, role: 'inspector' }
                });
            }

            // ===== 修改密码（服务端验证）=====
            if (action === 'change_password') {
                const authUser = requireAuth(event);
                if (!authUser) {
                    return response(401, { code: 401, message: '请先登录' });
                }
                const { old_password, new_password } = params;

                if (!old_password || !new_password) {
                    return response(400, { code: 400, message: '缺少旧密码或新密码' });
                }
                if (new_password.length < 6) {
                    return response(400, { code: 400, message: '新密码至少 6 位' });
                }

                // 1. 查当前用户
                const { data: dbUsers } = await getDb().collection(COLLECTIONS.users)
                    .where({ _id: authUser.user_id }).limit(1).get();
                if (dbUsers.length === 0) {
                    return response(404, { code: 404, message: '用户不存在' });
                }
                const dbUser = dbUsers[0];

                // 2. 🔒 服务端验证旧密码
                const valid = verifyPassword(old_password, dbUser.password_hash);
                if (!valid) {
                    return response(401, { code: 401, message: '旧密码错误' });
                }

                // 3. 🔒 服务端哈希新密码并更新
                const newHash = hashPassword(new_password);
                await getDb().collection(COLLECTIONS.users).doc(authUser.user_id)
                    .update({ password_hash: newHash });

                return response(200, { code: 0, message: '密码修改成功' });
            }

            return response(400, { code: 400, message: '[v2026-0612c] Invalid action: ' + (action || 'none') });
        }

        // ============ P0: 宿舍数据（主页核心，需认证）============
        if (path === '/api/dorm-data') {
            // 🔒 安全：已登录用户（有效 JWT）直接放行；未登录请求需要 PIN
            const authUser = requireAuth(event);
            if (!authUser) {
                const pin = params.pin || (data && data.pin);
                const { data: pinSettings } = await getDb().collection(COLLECTIONS.settings)
                    .where({ key: 'access_password' }).limit(1).get();
                if (pinSettings.length > 0 && pinSettings[0].value) {
                    if (!pin || String(pin) !== String(pinSettings[0].value)) {
                        return response(403, { code: 403, message: '访问密码错误' });
                    }
                }
            }

            const { data: students } = await getDb().collection(COLLECTIONS.dorm_students)
                .orderBy('dorm_name', 'asc').orderBy('bed', 'asc').limit(2000).get();
            const { data: mappings } = await getDb().collection(COLLECTIONS.grade_mapping)
                .orderBy('display_order', 'asc').get();

            const gradeMap = {};
            for (const m of mappings) { gradeMap[m.year_code] = m.grade_name; }

            const dormData = {};
            const nameIndex = {};
            const studentsFlat = [];

            for (const s of students) {
                if (s.status !== '在校' && s.status !== '空床') continue;
                const grade = s.year_code ? '20' + s.year_code + '级' : (s.grade_name || '其他');
                const cls = s.class_name || '';
                const dorm = s.dorm_name;
                const bed = s.bed;
                const name = s.student_name;

                if (!dormData[grade]) dormData[grade] = {};
                if (!dormData[grade][cls]) dormData[grade][cls] = {};
                if (!dormData[grade][cls][dorm]) {
                    dormData[grade][cls][dorm] = [null, null, null, null];
                }
                if (name && bed && bed >= 1 && bed <= 4) {
                    dormData[grade][cls][dorm][bed - 1] = name;
                    nameIndex[name] = { grade, className: cls, dorm, bed };
                }

                studentsFlat.push({
                    id: s.dorm_name + '_' + s.bed,
                    dorm_name: s.dorm_name, floor: s.floor,
                    student_name: s.student_name, bed: s.bed,
                    class_name: s.class_name || '', grade, grade_name: s.grade_name || '',
                    status: s.status || '在校', year_code: s.year_code,
                    display_order: s.display_order
                });
            }

            return response(200, { code: 0, success: true, dormData, nameIndex, students: studentsFlat });
        }

        // ============ P0: 管理员房间监控 ============
        if (path === '/api/admin/rooms') {
            const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                .orderBy('created_at', 'desc').limit(500).get();
            const { data: allMembers } = await getDb().collection(COLLECTIONS.room_members).limit(2000).get();
            const { data: allStates } = await getDb().collection(COLLECTIONS.room_states).limit(2000).get();

            const mc = {}, ac = {};
            for (const m of allMembers) { mc[m.room_id] = (mc[m.room_id] || 0) + 1; }
            for (const s of allStates) {
                if (s.status !== 'present') { ac[s.room_id] = (ac[s.room_id] || 0) + 1; }
            }

            const enriched = rooms.map(r => ({
                ...r, member_count: mc[r._id] || mc[r._old_id] || 0, absent_count: ac[r._id] || ac[r._old_id] || 0
            }));

            return response(200, { code: 0, success: true, rooms: enriched });
        }

        // ============ P0: 管理员用户管理（仅 admin 可调用）============
        if (path === '/api/admin/users') {
            // 🔒 安全：仅 admin 角色可查看用户列表
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const role = params.role;
            const page = Math.max(1, parseInt(params.page) || 1);
            const pageSize = Math.min(Math.max(1, parseInt(params.pageSize) || 20), 100);

            let where = {};
            if (role && ['inspector', 'admin'].includes(role)) { where = { role }; }

            const { total } = await getDb().collection(COLLECTIONS.users).where(where).count();
            const { data: users } = await getDb().collection(COLLECTIONS.users)
                .where(where).orderBy('created_at', 'desc')
                .skip((page - 1) * pageSize).limit(pageSize).get();

            // 🔒 安全：过滤 password_hash，但保留登录信息供管理查看
            const safe = users.map(u => ({
                id: u._id, username: u.username, display_name: u.display_name,
                role: u.role || 'inspector', created_at: u.created_at,
                last_login_at: u.last_login_at || null,
                last_login_ip: u.last_login_ip || null
            }));
            return response(200, { code: 0, success: true, users: safe, total, page, pageSize });
        }

        // ============ P0: 宿舍数据批量导入 ============
        if (path === '/api/admin/dorm-upload-json') {
            const { records, mode = 'incremental', confirm } = params;
            if (!Array.isArray(records) || records.length === 0) {
                return response(400, { code: 400, message: '缺少有效的 records 数组' });
            }
            if (mode === 'replace' && !confirm) {
                return response(400, { code: 400, message: '全量替换需要 confirm: true 确认' });
            }

            const valid = [], errors = [];
            for (let i = 0; i < records.length; i++) {
                const r = records[i], re = [];
                if (!r.student_name || typeof r.student_name !== 'string') re.push('姓名为空');
                if (!r.dorm_name || !String(r.dorm_name).trim()) re.push('宿舍号为空');
                if (r.bed == null || isNaN(Number(r.bed)) || Number(r.bed) < 1) re.push('床号无效');
                if (re.length) { errors.push({ row: i + 1, errors: re }); }
                else { valid.push(r); }
            }

            let inserted = 0, updated = 0;

            if (mode === 'replace') {
                // Delete all existing in batches
                let allDeleted = false;
                while (!allDeleted) {
                    const { data: docs } = await getDb().collection(COLLECTIONS.dorm_students).limit(100).get();
                    if (docs.length === 0) { allDeleted = true; break; }
                    await Promise.all(docs.map(d =>
                        getDb().collection(COLLECTIONS.dorm_students).doc(d._id).remove().catch(() => {})
                    ));
                }
                // Insert in batches
                for (let i = 0; i < valid.length; i += 5) {
                    const batch = valid.slice(i, i + 5).map(r => ({
                        dorm_name: String(r.dorm_name).trim(), floor: r.floor || 0,
                        class_name: r.class_name || null, student_name: String(r.student_name).trim(),
                        bed: Number(r.bed), year_code: r.year_code || null,
                        grade_name: r.grade_name || '', grade: r.grade || null,
                        status: r.status || '在校',
                        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                        migrated_from: 'admin_upload'
                    }));
                    const results = await Promise.all(batch.map(item =>
                        getDb().collection(COLLECTIONS.dorm_students).add(item)
                            .then(() => ({ success: true })).catch(e => ({ success: false }))
                    ));
                    inserted += results.filter(r => r.success).length;
                }
            } else {
                // Incremental: preload all existing for fast lookup
                const { data: allDorm } = await getDb().collection(COLLECTIONS.dorm_students).limit(2000).get();
                const existMap = {};
                for (const d of allDorm) {
                    existMap[d.student_name + '|' + d.dorm_name + '|' + d.bed] = d._id;
                }

                const toInsert = [], toUpdate = [];
                for (const r of valid) {
                    const key = String(r.student_name).trim() + '|' + String(r.dorm_name).trim() + '|' + Number(r.bed);
                    if (existMap[key]) { toUpdate.push({ _id: existMap[key], ...r }); updated++; }
                    else { toInsert.push(r); inserted++; }
                }

                // Batch insert
                for (let i = 0; i < toInsert.length; i += 5) {
                    const batch = toInsert.slice(i, i + 5).map(r => ({
                        dorm_name: String(r.dorm_name).trim(), floor: r.floor || 0,
                        class_name: r.class_name || null, student_name: String(r.student_name).trim(),
                        bed: Number(r.bed), year_code: r.year_code || null,
                        grade_name: r.grade_name || '', grade: r.grade || null,
                        status: r.status || '在校',
                        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                        migrated_from: 'admin_upload'
                    }));
                    await Promise.all(batch.map(item =>
                        getDb().collection(COLLECTIONS.dorm_students).add(item).catch(() => {})
                    ));
                }
                // Batch update
                for (let i = 0; i < toUpdate.length; i += 5) {
                    const batch = toUpdate.slice(i, i + 5);
                    await Promise.all(batch.map(r =>
                        getDb().collection(COLLECTIONS.dorm_students).doc(r._id).update({
                            class_name: r.class_name || null, grade: r.grade || null,
                            grade_name: r.grade_name || '', year_code: r.year_code || null,
                            floor: r.floor || null, status: r.status || '在校',
                            updated_at: new Date().toISOString()
                        }).catch(() => {})
                    ));
                }
            }

            return response(200, {
                code: 0, success: true,
                message: `导入完成`, mode,
                inserted, updated, total: records.length,
                errors: errors.length > 0 ? errors : undefined
            });
        }

        // ============ P1: OCR 假单识别 ============
        if (path === '/api/ocr') {
            const image = params.image || (data && data.image);
            if (!image) return response(400, { code: 400, message: '缺少 image (base64)' });

            const apiKey = process.env.BAIDU_OCR_API_KEY;
            const secretKey = process.env.BAIDU_OCR_SECRET_KEY;
            if (!apiKey || !secretKey) return response(500, { code: 500, message: 'OCR 服务未配置' });

            try {
                // Get Baidu token
                const tokenRes = await fetch(
                    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
                    { method: 'POST' }
                );
                const tokenData = await tokenRes.json();
                if (!tokenData.access_token) {
                    return response(500, { code: 500, message: 'OCR token 获取失败' });
                }

                // Strip data: prefix if present
                const base64 = image.replace(/^data:image\/\w+;base64,/, '');

                // Call OCR
                const ocrRes = await fetch(
                    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${tokenData.access_token}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: `image=${encodeURIComponent(base64)}&language_type=CHN_ENG&detect_direction=true`
                    }
                );
                const ocrData = await ocrRes.json();

                if (ocrData.error_code) {
                    return response(500, { code: 500, message: 'OCR 识别失败: ' + (ocrData.error_msg || '') });
                }

                // Format result text
                const words = (ocrData.words_result || []).map(w => w.words).join('\n');
                return response(200, { code: 0, success: true, formattedText: words || '' });
            } catch (e) {
                console.error('OCR error:', e);
                return response(500, { code: 500, message: 'OCR 服务异常: ' + e.message });
            }
        }

        // ============ P1: 智能分组 ============
        if (path === '/api/smart-group') {
            const text = params.text || (data && data.text);
            if (!text) return response(400, { code: 400, message: '缺少 text' });

            const apiKey = process.env.DEEPSEEK_API_KEY;
            if (!apiKey) return response(500, { code: 500, message: 'DeepSeek API Key 缺失' });

            try {
                const aiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                    body: JSON.stringify({
                        model: 'deepseek-chat', temperature: 0.1,
                        messages: [
                            { role: 'system', content: `你是一个假单解析助手。请将下面的文本解析为事由分组，并提取请假时间段。
输出格式必须为严格的 JSON 对象：
{
  "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "groups": [
    { "reason": "事由名称", "leaveType": "leaveInside" 或 "leaveSchool" 或 "leaveOutside", "people": ["人名1", "人名2"] }
  ]
}
规则（按优先级从高到低，同一人命中多个关键词时取最高优先级）：
优先级1（最高）— 请假离校/离校/回家 → leaveSchool, reason="请假离校"；
优先级2 — 请假外出/外出/出门 → leaveOutside, reason="请假外出"；
优先级3 — 组织/团队类：分团委/学生会/合唱团/运动会/警乐团/羽毛球/篮球队/篮球/辩论队/辩队/校督/校督促 → leaveInside, reason为该关键词；
优先级4（最低）— 工作室/学习类：数分/网安/阿sir/数实战/网管/舆情/备赛/复习/学习/自习 → leaveInside, reason为该关键词；
- 仅当文本明确出现"事假"二字且无更高优先级关键词时，归为 leaveInside, reason="其他"。
- 人名必须是已知宿舍名单中的人（后端会验证），但模型只需要提取疑似人名的中文词。
- 从文本中提取请假时间段，支持常见中文表达。年份缺失时，使用当前年份 2026 年。
- 只输出 JSON，不要有任何额外文字或 markdown 包裹。` },
                            { role: 'user', content: text }
                        ]
                    })
                });
                const aiData = await aiRes.json();
                const rawContent = aiData.choices?.[0]?.message?.content || '{}';

                let dateRange = null, groups = [];
                try {
                    const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/```\s*([\s\S]*?)```/);
                    const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent.trim();
                    const parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed)) { groups = parsed; }
                    else { dateRange = parsed.dateRange || null; groups = parsed.groups || []; }
                    if (!Array.isArray(groups)) groups = [];
                } catch (e) {
                    return response(500, { code: 500, message: '模型返回格式错误' });
                }

                return response(200, { code: 0, success: true, dateRange, groups });
            } catch (e) {
                console.error('Smart group error:', e);
                return response(500, { code: 500, message: e.message || '智能分组失败' });
            }
        }

        // ============ P3: 验证访问密码（公开接口） ============
        if (path === '/api/verify-access-password') {
            const password = params.password || (data && data.password);
            if (!password) return response(400, { code: 400, message: '缺少 password' });

            const { data: settings } = await getDb().collection(COLLECTIONS.settings)
                .where({ key: 'access_password' }).limit(1).get();
            const valid = settings.length > 0 && settings[0].value === password;
            return response(200, { code: 0, success: true, valid });
        }

        // ============ P3: 更新访问密码（admin） ============
        if (path === '/api/access-password') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const password = params.password || (data && data.password);
            if (!password || !/^\d{4}$/.test(password)) {
                return response(400, { code: 400, message: '密码必须为4位数字' });
            }

            const coll = getDb().collection(COLLECTIONS.settings);
            const { data: existing } = await coll.where({ key: 'access_password' }).limit(1).get();
            const now = new Date().toISOString();
            if (existing.length > 0) {
                await coll.doc(existing[0]._id).update({ value: password, updated_at: now });
            } else {
                await coll.add({ key: 'access_password', value: password, updated_at: now, migrated_from: 'd1' });
            }
            return response(200, { code: 0, success: true, message: '访问密码已更新' });
        }

        // ============ P3: 敏感词库统计（admin） ============
        if (path === '/api/sensitive-words-stats') {
            const { data: wordDocs } = await getDb().collection(COLLECTIONS.settings)
                .where({ key: 'sensitive_words' }).limit(1).get();

            let total = 0;
            let updated_at = null;
            if (wordDocs.length > 0 && wordDocs[0].value) {
                total = wordDocs[0].value.split(/\r?\n/).filter(w => w.trim().length > 0).length;
                updated_at = wordDocs[0].updated_at || null;
            }
            return response(200, { code: 0, success: true, total, updated_at: updated_at || '--' });
        }

        // ============ P3: 用户详情（admin） ============
        if (path === '/api/admin/users/detail') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const user_id = params.user_id || (data && data.user_id);
            if (!user_id) return response(400, { code: 400, message: '缺少 user_id' });

            const { data: users } = await getDb().collection(COLLECTIONS.users).where({ _id: user_id }).limit(1).get();
            if (users.length === 0) {
                // Also try by old ID
                const { data: users2 } = await getDb().collection(COLLECTIONS.users).where({ _old_id: parseInt(user_id) || user_id }).limit(1).get();
                if (users2.length === 0) return response(404, { code: 404, message: '用户不存在' });
                const u = users2[0]; const { password_hash, ...safe } = u;
                return response(200, { code: 0, success: true, user: safe, login_logs: [], system_logs: [] });
            }

            const user = users[0];
            const { password_hash, ...safeUser } = user;

            // Recent login logs
            const { data: loginLogs } = await getDb().collection(COLLECTIONS.login_logs)
                .where({ user_id: user._id }).orderBy('login_at', 'desc').limit(10).get();

            // Recent system logs
            const { data: systemLogs } = await getDb().collection(COLLECTIONS.system_logs)
                .where({ user_id: user._id }).orderBy('created_at', 'desc').limit(10).get();

            return response(200, { code: 0, success: true, user: safeUser, login_logs: loginLogs, system_logs: systemLogs });
        }

        // ============ P3: 修改用户角色（admin） ============
        if (path === '/api/admin/users/set-role') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const user_id = params.user_id || (data && data.user_id);
            const role = params.role || (data && data.role);
            if (!user_id || !role) return response(400, { code: 400, message: '缺少 user_id 或 role' });
            if (!['inspector', 'admin'].includes(role)) return response(400, { code: 400, message: '无效的角色' });

            // Cannot change own role
            if (String(user_id) === String(admin.user_id)) {
                return response(403, { code: 403, message: '不能修改自己的角色' });
            }

            let targetUser = null;
            const { data: users } = await getDb().collection(COLLECTIONS.users).where({ _id: user_id }).limit(1).get();
            targetUser = users[0];
            if (!targetUser) {
                const { data: users2 } = await getDb().collection(COLLECTIONS.users).where({ _old_id: parseInt(user_id) || user_id }).limit(1).get();
                targetUser = users2[0];
            }
            if (!targetUser) return response(404, { code: 404, message: '用户不存在' });

            const oldRole = targetUser.role || 'inspector';
            if (oldRole === role) return response(200, { code: 0, message: '角色未变更' });

            // CloudBase SDK update: 直接传字段对象，不用 { data: ... } 包装
            const updateRes = await getDb().collection(COLLECTIONS.users).doc(targetUser._id).update({ role });
            console.log('[set-role] update result:', JSON.stringify(updateRes));

            // 记录操作日志
            try {
                await getDb().collection(COLLECTIONS.system_logs).add({
                    user_id: admin.user_id, username: admin.username,
                    role: admin.role, action: 'role_change',
                    detail: `将 ${targetUser.username} 的角色由 ${oldRole} 改为 ${role}`,
                    target_id: targetUser._id,
                    ip: (event.headers || {})['x-forwarded-for'] || '',
                    created_at: new Date().toISOString()
                });
            } catch (e) { /* non-critical */ }

            return response(200, { code: 0, success: true, message: '角色修改成功', old_role: oldRole, new_role: role });
        }

        // ============ P3: 删除用户（admin） ============
        if (path === '/api/admin/user-delete') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const user_id = params.user_id || (data && data.user_id);
            if (!user_id) return response(400, { code: 400, message: '缺少 user_id' });

            // 不能删除自己
            if (String(user_id) === String(admin.user_id)) {
                return response(403, { code: 403, message: '不能删除自己的账号' });
            }

            // 查找目标用户
            let targetUser = null;
            const { data: users } = await getDb().collection(COLLECTIONS.users).where({ _id: user_id }).limit(1).get();
            targetUser = users[0];
            if (!targetUser) {
                const { data: users2 } = await getDb().collection(COLLECTIONS.users).where({ _old_id: parseInt(user_id) || user_id }).limit(1).get();
                targetUser = users2[0];
            }
            if (!targetUser) return response(404, { code: 404, message: '用户不存在' });

            // 检查是否是最后一个 admin
            if (targetUser.role === 'admin') {
                const { total } = await getDb().collection(COLLECTIONS.users).where({ role: 'admin' }).count();
                if (total <= 1) {
                    return response(403, { code: 403, message: '不能删除最后一个管理员，系统将无法管理' });
                }
            }

            const deletedUser = { username: targetUser.username, role: targetUser.role || 'inspector' };
            await getDb().collection(COLLECTIONS.users).doc(targetUser._id).remove();

            // 记录操作日志
            try {
                await getDb().collection(COLLECTIONS.system_logs).add({
                    user_id: admin.user_id, username: admin.username,
                    role: admin.role, action: 'user_delete',
                    detail: `删除用户 ${deletedUser.username}（原角色: ${deletedUser.role}）`,
                    target_id: targetUser._id,
                    ip: (event.headers || {})['x-forwarded-for'] || '',
                    created_at: new Date().toISOString()
                });
            } catch (e) { /* non-critical */ }

            return response(200, { code: 0, success: true, message: '用户已删除', deleted: deletedUser });
        }

        // ============ P3: 房间同步（compose 已有接口） ============
        if (path === '/api/room/sync') {
            const authUser = requireAuth(event);
            if (!authUser) return response(401, { code: 401, message: '未授权' });

            const code = params.code || (data && data.code);
            if (!code) return response(400, { code: 400, message: '缺少 code' });

            // Get room
            const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                .where({ code: code.toUpperCase() }).limit(1).get();
            if (rooms.length === 0) return response(404, { code: 404, message: '房间不存在' });

            const room = rooms[0];

            // Check expiry & auto-expire
            if (room.status === 'active' && room.expires_at) {
                if (new Date(room.expires_at) < new Date()) {
                    await getDb().collection(COLLECTIONS.rooms).doc(room._id).update({ status: 'expired' });
                    room.status = 'expired';
                } else {
                    // Update last_activity_at (heartbeat)
                    await getDb().collection(COLLECTIONS.rooms).doc(room._id).update({
                        last_activity_at: new Date().toISOString()
                    }).catch(() => {});
                }
            }

            // Get states, logs, messages, members in parallel
            const [statesRes, logsRes, messagesRes, membersRes] = await Promise.all([
                getDb().collection(COLLECTIONS.room_states).where({ room_id: room._id }).orderBy('dorm_number', 'asc').orderBy('bed_number', 'asc').get(),
                getDb().collection(COLLECTIONS.room_logs).where({ room_id: room._id }).orderBy('created_at', 'desc').limit(50).get(),
                getDb().collection(COLLECTIONS.room_messages).where({ room_id: room._id }).orderBy('created_at', 'asc').limit(50).get(),
                getDb().collection(COLLECTIONS.room_members).where({ room_id: room._id }).get()
            ]);

            const states = statesRes.data || [];
            const logs = logsRes.data || [];
            const messages = messagesRes.data || [];
            const members = membersRes.data || [];

            // Collect all user_ids from logs/messages/members to enrich with username
            const userIds = new Set();
            for (const l of logs) { if (l.user_id) userIds.add(String(l.user_id)); }
            for (const m of messages) { if (m.user_id) userIds.add(String(m.user_id)); }
            for (const m of members) { if (m.user_id) userIds.add(String(m.user_id)); }

            const userMap = {};
            if (userIds.size > 0) {
                // Batch fetch users: try by _id first, then by _old_id
                const userPromises = [...userIds].map(uid =>
                    getDb().collection(COLLECTIONS.users).where({ _id: uid }).limit(1).get()
                        .then(r => r.data[0] || null)
                        .catch(() => null)
                );
                const userResults = await Promise.all(userPromises);
                for (const u of userResults) {
                    if (u) {
                        userMap[String(u._id)] = u;
                        if (u._old_id) userMap[String(u._old_id)] = u;
                    }
                }
            }

            // Enrich with username/display_name
            const enrich = (item) => {
                const u = userMap[String(item.user_id)];
                return { ...item, username: u ? u.username : null, display_name: u ? (u.display_name || u.username) : null };
            };

            // Update last_read_msg_id for current user
            const lastMsg = messages.length > 0 ? messages[messages.length - 1]._id : null;
            if (lastMsg) {
                const memberDoc = members.find(m => String(m.user_id) === String(authUser.user_id));
                if (memberDoc && memberDoc._id) {
                    await getDb().collection(COLLECTIONS.room_members).doc(memberDoc._id).update({
                        last_read_msg_id: lastMsg
                    }).catch(() => {});
                }
            }

            return response(200, {
                code: 0, success: true,
                room_info: {
                    id: room._id || room.id, code: room.code, creator_id: room.creator_id,
                    created_at: room.created_at, expires_at: room.expires_at,
                    status: room.status, dorm_building: room.dorm_building
                },
                states, logs: logs.map(enrich), messages: messages.map(enrich), members: members.map(enrich)
            });
        }

        // ============ P3: 管理员日志查询 ============
        if (path === '/api/admin/logs') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const action = params.action;
            const username = params.username;
            const startDate = params.startDate;
            const endDate = params.endDate;
            const page = Math.max(1, parseInt(params.page) || 1);
            const pageSize = Math.min(Math.max(1, parseInt(params.pageSize) || 20), 100);

            let query = getDb().collection(COLLECTIONS.system_logs);
            if (action && action !== 'all') { query = query.where({ action }); }
            if (username) { query = query.where({ username }); }
            // Note: CloudBase where doesn't support LIKE. For date ranges we filter post-query if needed.

            const { total } = await query.count();
            let { data: logs } = await query.orderBy('created_at', 'desc')
                .skip((page - 1) * pageSize).limit(pageSize).get();

            // Post-filter date range if specified (CloudBase doesn't support gt/lt on ISO strings well)
            if (startDate) { logs = logs.filter(l => l.created_at >= startDate); }
            if (endDate) { logs = logs.filter(l => l.created_at <= endDate + 'T23:59:59'); }

            return response(200, { code: 0, success: true, logs, total, page, pageSize });
        }

        // ============ P3: 单条学生更新（admin） ============
        if (path === '/api/admin/student-update') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const { student_name, dorm_name, bed } = params.data || params;
            if (!student_name || !dorm_name || !bed) {
                return response(400, { code: 400, message: '缺少 student_name / dorm_name / bed' });
            }

            const { data: existing } = await getDb().collection(COLLECTIONS.dorm_students)
                .where({ student_name: String(student_name).trim(), dorm_name: String(dorm_name).trim(), bed: Number(bed) })
                .limit(1).get();

            if (existing.length === 0) return response(404, { code: 404, message: '未找到匹配的学生记录' });

            const r = params.data || params;
            const updateData = { updated_at: new Date().toISOString() };
            if (r.class_name !== undefined) updateData.class_name = r.class_name;
            if (r.grade !== undefined) updateData.grade = r.grade;
            if (r.grade_name !== undefined) updateData.grade_name = r.grade_name;
            if (r.year_code !== undefined) updateData.year_code = r.year_code;
            if (r.floor !== undefined) updateData.floor = r.floor;
            if (r.status !== undefined) updateData.status = r.status;
            if (r.new_dorm_name !== undefined) updateData.dorm_name = r.new_dorm_name;
            if (r.new_student_name !== undefined) updateData.student_name = r.new_student_name;
            if (r.new_bed !== undefined) updateData.bed = Number(r.new_bed);

            await getDb().collection(COLLECTIONS.dorm_students).doc(existing[0]._id).update(updateData);
            return response(200, { code: 0, success: true, message: '更新成功' });
        }

        // ============ P3: 单条学生删除（admin） ============
        if (path === '/api/admin/student-delete') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const { student_name, dorm_name, bed } = params.data || params;
            if (!student_name || !dorm_name || !bed) {
                return response(400, { code: 400, message: '缺少 student_name / dorm_name / bed' });
            }

            const { data: existing } = await getDb().collection(COLLECTIONS.dorm_students)
                .where({ student_name: String(student_name).trim(), dorm_name: String(dorm_name).trim(), bed: Number(bed) })
                .limit(1).get();

            if (existing.length === 0) return response(404, { code: 404, message: '未找到匹配的学生记录' });

            await getDb().collection(COLLECTIONS.dorm_students).doc(existing[0]._id).remove();
            return response(200, { code: 0, success: true, message: '删除成功' });
        }

        // ============ P1: 批量更新学生（admin） ============
        if (path === '/api/admin/students-batch-update') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const ids = params.ids || (data && data.ids);
            const update = params.update || (data && data.update) || {};
            if (!Array.isArray(ids) || ids.length === 0) {
                return response(400, { code: 400, message: '缺少 ids 数组' });
            }

            let done = 0, fail = 0;
            for (const id of ids) {
                try {
                    // id 格式: "student_name|dorm_name|bed"
                    const [sName, sDorm, sBed] = id.split('|');
                    if (!sName || !sDorm || !sBed) { fail++; continue; }

                    const { data: existing } = await getDb().collection(COLLECTIONS.dorm_students)
                        .where({ student_name: String(sName).trim(), dorm_name: String(sDorm).trim(), bed: Number(sBed) })
                        .limit(1).get();

                    if (existing.length > 0) {
                        const upd = { updated_at: new Date().toISOString() };
                        if (update.status !== undefined) upd.status = update.status;
                        if (update.grade !== undefined) upd.grade = update.grade;
                        if (update.grade_name !== undefined) upd.grade_name = update.grade_name;
                        if (update.class_name !== undefined) upd.class_name = update.class_name;
                        await getDb().collection(COLLECTIONS.dorm_students).doc(existing[0]._id).update(upd);
                        done++;
                    } else { fail++; }
                } catch (e) { fail++; }
            }

            return response(200, { code: 0, success: true, done, fail, message: `批量更新: ${done} 成功, ${fail} 失败` });
        }

        // ============ P1: 批量删除学生（admin） ============
        if (path === '/api/admin/students-batch-delete') {
            const admin = requireAdmin(event);
            if (!admin) return response(403, { code: 403, message: '需要管理员权限' });

            const ids = params.ids || (data && data.ids);
            if (!Array.isArray(ids) || ids.length === 0) {
                return response(400, { code: 400, message: '缺少 ids 数组' });
            }

            let done = 0, fail = 0;
            for (const id of ids) {
                try {
                    const [sName, sDorm, sBed] = id.split('|');
                    if (!sName || !sDorm || !sBed) { fail++; continue; }

                    const { data: existing } = await getDb().collection(COLLECTIONS.dorm_students)
                        .where({ student_name: String(sName).trim(), dorm_name: String(sDorm).trim(), bed: Number(sBed) })
                        .limit(1).get();

                    if (existing.length > 0) {
                        await getDb().collection(COLLECTIONS.dorm_students).doc(existing[0]._id).remove();
                        done++;
                    } else { fail++; }
                } catch (e) { fail++; }
            }

            return response(200, { code: 0, success: true, done, fail, message: `批量删除: ${done} 成功, ${fail} 失败` });
        }

        // ============ P3: 定时清理 ============
        if (path === '/api/cleanup') {
            // Auth: admin JWT or CLEANUP_SECRET header
            let authorized = false;
            const admin = requireAdmin(event);
            if (admin) { authorized = true; }
            if (!authorized) {
                const secret = (event.headers || {})['x-cleanup-secret'] || '';
                if (secret && process.env.CLEANUP_SECRET && secret === process.env.CLEANUP_SECRET) {
                    authorized = true;
                }
            }
            if (!authorized) return response(403, { code: 403, message: 'Unauthorized' });

            const results = {};
            const now = new Date();
            const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

            // Helper: batch delete old docs from a collection
            async function deleteOlderThan(collName, dateField, cutoffISO) {
                let deleted = 0;
                // CloudBase doesn't support range deletes — get IDs first, then delete
                const coll = getDb().collection(collName);
                let hasMore = true;
                while (hasMore) {
                    const { data: docs } = await coll.limit(100).get();
                    if (docs.length === 0) { hasMore = false; break; }
                    const toDelete = docs.filter(d => d[dateField] && d[dateField] < cutoffISO);
                    if (toDelete.length > 0) {
                        await Promise.all(toDelete.map(d =>
                            coll.doc(d._id).remove().catch(() => {})
                        ));
                        deleted += toDelete.length;
                    }
                    if (docs.length < 100) hasMore = false;
                }
                return deleted;
            }

            try { results.system_logs_deleted = await deleteOlderThan(COLLECTIONS.system_logs, 'created_at', threeDaysAgo); }
            catch (e) { results.system_logs_error = e.message; }

            try { results.login_logs_deleted = await deleteOlderThan(COLLECTIONS.login_logs, 'login_at', threeDaysAgo); }
            catch (e) { results.login_logs_error = e.message; }

            try { results.room_messages_deleted = await deleteOlderThan(COLLECTIONS.room_messages, 'created_at', sevenDaysAgo); }
            catch (e) { results.room_messages_error = e.message; }

            return response(200, {
                code: 0, success: true,
                cleaned_at: now.toISOString(),
                ...results
            });
        }

        // ============ 创建房间（前端 room.js 走 /api/room）============
        if (path === '/api/room') {
            const user = requireAuth(event);
            if (!user) return response(401, { code: 401, message: '请先登录' });
            if (user.role !== 'admin' && user.role !== 'inspector') {
                return response(403, { code: 403, message: '无权创建房间' });
            }

            const action = params.action || (data && data.action);
            const roomCode = (params.code || (data && data.code) || '').toUpperCase();

            if (action === 'create') {
                // 生成 6 位随机房间码
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 排除易混淆字符 I/O/0/1
                let code = '';
                for (let i = 0; i < 6; i++) {
                    code += chars[Math.floor(Math.random() * chars.length)];
                }

                // 确保不重复（最多重试 3 次）
                let retries = 3;
                while (retries > 0) {
                    const { data: existing } = await getDb().collection(COLLECTIONS.rooms)
                        .where({ code }).limit(1).get();
                    if (existing.length === 0) break;
                    code = '';
                    for (let i = 0; i < 6; i++) {
                        code += chars[Math.floor(Math.random() * chars.length)];
                    }
                    retries--;
                }

                const now = new Date();
                const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48小时后过期
                const roomData = {
                    code,
                    creator_id: user.user_id,
                    created_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    status: 'active',
                    dorm_building: params.dorm_building || (data && data.dorm_building) || ''
                };

                const res = await getDb().collection(COLLECTIONS.rooms).add(roomData);
                return response(200, {
                    code: 0, success: true,
                    data: { id: res.id || res._id, code, expires_at: expiresAt.toISOString() },
                    code: code, expires_at: expiresAt.toISOString()
                });
            }

            if (action === 'join') {
                if (!roomCode || roomCode.length !== 6) {
                    return response(400, { code: 400, message: '请输入6位房间码' });
                }

                // 查找房间
                const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                    .where({ code: roomCode }).limit(1).get();
                if (rooms.length === 0) {
                    return response(404, { code: 404, message: '房间不存在' });
                }
                const room = rooms[0];

                // 检查是否过期
                if (room.status === 'expired' || (room.expires_at && new Date(room.expires_at) < new Date())) {
                    if (room.status !== 'expired') {
                        await getDb().collection(COLLECTIONS.rooms).doc(room._id).update({ status: 'expired' });
                    }
                    return response(400, { code: 400, message: '房间已过期' });
                }

                // 检查是否已是成员
                const { data: existingMembers } = await getDb().collection(COLLECTIONS.room_members)
                    .where({ room_id: room._id, user_id: user.user_id }).limit(1).get();

                if (existingMembers.length === 0) {
                    // 加入房间
                    await getDb().collection(COLLECTIONS.room_members).add({
                        room_id: room._id,
                        user_id: user.user_id,
                        username: user.username,
                        display_name: user.display_name || user.username,
                        role: user.role || 'inspector',
                        joined_at: new Date().toISOString()
                    });
                }

                return response(200, {
                    code: 0, success: true,
                    code: room.code, expires_at: room.expires_at
                });
            }

            if (action === 'sync') {
                const messagesOnly = !!(params.messages_only || (data && data.messages_only));

                if (!roomCode || roomCode.length !== 6) {
                    return response(400, { code: 400, message: '缺少 room code' });
                }

                // 查找房间
                const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                    .where({ code: roomCode }).limit(1).get();
                if (rooms.length === 0) return response(404, { code: 404, message: '房间不存在' });
                const room = rooms[0];

                // 检查过期 & 自动标记
                if (room.status === 'active' && room.expires_at) {
                    if (new Date(room.expires_at) < new Date()) {
                        await getDb().collection(COLLECTIONS.rooms).doc(room._id).update({ status: 'expired' });
                        room.status = 'expired';
                    } else {
                        // Heartbeat
                        await getDb().collection(COLLECTIONS.rooms).doc(room._id).update({
                            last_activity_at: new Date().toISOString()
                        }).catch(() => {});
                    }
                }

                if (messagesOnly) {
                    // 仅拉取消息（轻量轮询）
                    const { data: messages } = await getDb().collection(COLLECTIONS.room_messages)
                        .where({ room_id: room._id }).orderBy('created_at', 'asc').limit(50).get();
                    return response(200, { code: 0, success: true, messages: messages || [] });
                }

                // 全量同步：states + logs + messages + members
                const [statesRes, logsRes, messagesRes, membersRes] = await Promise.all([
                    getDb().collection(COLLECTIONS.room_states).where({ room_id: room._id }).orderBy('dorm_number', 'asc').orderBy('bed_number', 'asc').get(),
                    getDb().collection(COLLECTIONS.room_logs).where({ room_id: room._id }).orderBy('created_at', 'desc').limit(50).get(),
                    getDb().collection(COLLECTIONS.room_messages).where({ room_id: room._id }).orderBy('created_at', 'asc').limit(50).get(),
                    getDb().collection(COLLECTIONS.room_members).where({ room_id: room._id }).get()
                ]);

                const states = statesRes.data || [];
                const logs = logsRes.data || [];
                const messages = messagesRes.data || [];
                const members = membersRes.data || [];

                // 收集 user_ids 批量查询用户名
                const userIds = new Set();
                for (const l of logs) { if (l.user_id) userIds.add(String(l.user_id)); }
                for (const m of messages) { if (m.user_id) userIds.add(String(m.user_id)); }
                for (const m of members) { if (m.user_id) userIds.add(String(m.user_id)); }

                const userMap = {};
                if (userIds.size > 0) {
                    const userPromises = [...userIds].map(uid =>
                        getDb().collection(COLLECTIONS.users).where({ _id: uid }).limit(1).get()
                            .then(r => r.data[0] || null).catch(() => null)
                    );
                    const userResults = await Promise.all(userPromises);
                    for (const u of userResults) {
                        if (u) { userMap[String(u._id)] = u; if (u._old_id) userMap[String(u._old_id)] = u; }
                    }
                }

                const enrich = (item) => {
                    const u = userMap[String(item.user_id)];
                    return { ...item, username: u ? u.username : null, display_name: u ? (u.display_name || u.username) : null };
                };

                // 更新 last_read_msg_id
                const lastMsg = messages.length > 0 ? messages[messages.length - 1]._id : null;
                if (lastMsg) {
                    const memberDoc = members.find(m => String(m.user_id) === String(user.user_id));
                    if (memberDoc && memberDoc._id) {
                        await getDb().collection(COLLECTIONS.room_members).doc(memberDoc._id).update({
                            last_read_msg_id: lastMsg
                        }).catch(() => {});
                    }
                }

                return response(200, {
                    code: 0, success: true,
                    room_info: {
                        id: room._id || room.id, code: room.code, creator_id: room.creator_id,
                        created_at: room.created_at, expires_at: room.expires_at,
                        status: room.status, dorm_building: room.dorm_building
                    },
                    states, logs: logs.map(enrich), messages: messages.map(enrich), members: members.map(enrich)
                });
            }

            if (action === 'state') {
                const studentName = params.student_name || (data && data.student_name);
                const newStatus = params.new_status || (data && data.new_status);
                const detail = params.detail || (data && data.detail) || '';

                if (!roomCode || !studentName || !newStatus) {
                    return response(400, { code: 400, message: '缺少必要参数' });
                }

                // 查找房间
                const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                    .where({ code: roomCode }).limit(1).get();
                if (rooms.length === 0) return response(404, { code: 404, message: '房间不存在' });
                const room = rooms[0];

                // Upsert room_state
                const { data: existingStates } = await getDb().collection(COLLECTIONS.room_states)
                    .where({ room_id: room._id, student_name: studentName }).limit(1).get();

                const stateData = {
                    student_name: studentName,
                    status: newStatus,
                    reason: detail,
                    reason_detail: detail || null,
                    updated_at: new Date().toISOString()
                };

                if (existingStates.length > 0) {
                    await getDb().collection(COLLECTIONS.room_states)
                        .doc(existingStates[0]._id).update(stateData);
                } else {
                    await getDb().collection(COLLECTIONS.room_states).add({
                        room_id: room._id,
                        ...stateData,
                        created_at: new Date().toISOString()
                    });
                }

                // Add to room_logs（含新旧状态用于前端展示）
                const oldStatus = existingStates.length > 0 ? existingStates[0].status : null;
                await getDb().collection(COLLECTIONS.room_logs).add({
                    room_id: room._id,
                    room_code: roomCode,
                    user_id: user.user_id,
                    user_name: user.display_name || user.username,
                    action: 'state',
                    student_name: studentName,
                    old_status: oldStatus,
                    new_status: newStatus,
                    detail: detail,
                    created_at: new Date().toISOString()
                }).catch(() => {});

                return response(200, { code: 0, success: true, message: '状态已更新' });
            }

            if (action === 'message') {
                const content = params.content || (data && data.content);

                if (!roomCode || !content) {
                    return response(400, { code: 400, message: '缺少必要参数' });
                }

                // 查找房间
                const { data: rooms } = await getDb().collection(COLLECTIONS.rooms)
                    .where({ code: roomCode }).limit(1).get();
                if (rooms.length === 0) return response(404, { code: 404, message: '房间不存在' });
                const room = rooms[0];

                const msgData = {
                    room_id: room._id,
                    user_id: user.user_id,
                    username: user.username,
                    display_name: user.display_name || user.username,
                    content: content,
                    created_at: new Date().toISOString()
                };

                const res = await getDb().collection(COLLECTIONS.room_messages).add(msgData);
                return response(200, {
                    code: 0, success: true,
                    message: '消息已发送',
                    data: { id: res.id || res._id, ...msgData }
                });
            }

            return response(400, { code: 400, message: 'Unknown room action: ' + action });
        }

        return response(404, {
            code: 404, message: 'Unknown path: ' + path, available: [
                '/api/list', '/api/add', '/api/addBatch', '/api/update', '/api/delete', '/api/count',
                '/api/room', '/api/roomByCode', '/api/roomMembers', '/api/roomStates', '/api/roomLogs', '/api/roomMessages',
                '/api/userByUsername', '/api/checkRecords', '/api/singleCheckByUserDate',
                '/api/dormByFloor', '/api/dormByName', '/api/gradeMapping', '/api/settings',
                '/api/updateSetting', '/api/checkSensitive',
                '/api/auth', '/api/dorm-data', '/api/admin/rooms', '/api/admin/users',
                '/api/admin/dorm-upload-json', '/api/ocr', '/api/smart-group',
                '/api/verify-access-password', '/api/access-password', '/api/sensitive-words-stats',
                '/api/admin/users/detail', '/api/admin/users/set-role', '/api/room/sync',
                '/api/admin/logs', '/api/admin/student-update', '/api/admin/student-delete',
                '/api/admin/user-delete', '/api/admin/students-batch-update', '/api/admin/students-batch-delete', '/api/cleanup'
            ]
        });

    } catch (e) {
        console.error('API Error:', e);
        return response(500, { code: 500, message: e.message, stack: e.stack });
    }
};