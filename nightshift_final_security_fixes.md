# NightShift 安全漏洞修复文档（P0/P1 紧急修复）

> 生成时间：2026-06-12 10:06  
> 项目路径：`E:\上大学。。。\女工\NightShift`  
> 执行人：Claude Code  
> 前置条件：登录/注册已恢复正常，管理员 `chaqin` 角色已改回 `admin`

---

## 修复总览

| 优先级 | 漏洞 | 修复文件 | 工作量 |
|--------|------|----------|--------|
| P0 | 通用 CRUD 无权限校验 | `cloudbase/api/index.js` | 中 |
| P0 | Settings PIN 明文 + 公开可读 | `cloudbase/api/index.js` | 中 |
| P0 | 登录/注册无速率限制 | `cloudbase/api/index.js` | 中 |
| P1 | 用户名 XSS | `cloudbase/api/index.js` + `api-client.js` | 低 |
| P1 | 用户枚举 | `cloudbase/api/index.js` | 低 |
| P1 | 无密码强度策略 | `cloudbase/api/index.js` + `login.html` | 低 |
| P2 | 密码哈希泄露（/api/list） | `cloudbase/api/index.js` | 低 |
| P2 | 前端获取密码哈希（changePassword） | `cloudbase/api/index.js` + `api-client.js` | 中 |

---

## Step 1: 通用 CRUD 接口加权限校验（P0）

**文件**：`cloudbase/api/index.js`

在 `exports.main` 中，找到 `/api/list`、`/api/update`、`/api/delete`、`/api/add` 四个通用路由，统一加权限控制。

### 1.1 /api/list — 集合白名单 + 字段过滤

```javascript
if (path === '/api/list') {
    const collection = params.collection;
    const user = params._user;

    // 🔒 集合白名单：inspector 禁止查询敏感集合
    const SENSITIVE_COLLECTIONS = ['users', 'settings', 'login_logs'];
    if (user.role !== 'admin' && SENSITIVE_COLLECTIONS.includes(collection)) {
        return response(403, { code: 403, message: '无权访问该集合' });
    }

    // 查询逻辑保持原有...
    const where = params.where || {};
    const limit = Math.min(params.limit || 50, 200);
    const { data, total } = await getDb().collection(collection)
        .where(where).limit(limit).get();

    // 🔒 对 users 集合返回时过滤敏感字段（即使 admin 也不应返回 password_hash）
    let safeData = data;
    if (collection === 'users') {
        safeData = data.map(u => {
            const { password_hash, last_login_ip, ...safe } = u;
            return safe;
        });
    }
    // 🔒 对 settings 集合隐藏 access_password 明文
    if (collection === 'settings') {
        safeData = data.map(s => {
            if (s.key === 'access_password') {
                return { ...s, value: '***' };  // 隐藏明文
            }
            return s;
        });
    }

    return response(200, { code: 0, data: safeData, total });
}
```

### 1.2 /api/delete — 所有权校验 + 集合限制

```javascript
if (path === '/api/delete') {
    const collection = params.collection;
    const user = params._user;
    const targetId = params.data?._id || params.data?.id;

    // 🔒 禁止删除敏感集合（users/settings 只能走专用 admin 接口）
    if (['users', 'settings'].includes(collection)) {
        return response(403, { code: 403, message: '禁止通过通用接口删除该集合' });
    }

    // 🔒 非 admin 只能删除自己创建的记录
    if (user.role !== 'admin') {
        const { data: target } = await getDb().collection(collection).doc(targetId).get();
        if (!target || target.creator_id !== user.user_id) {
            return response(403, { code: 403, message: '无权删除该记录' });
        }
    }

    await getDb().collection(collection).doc(targetId).remove();
    return response(200, { code: 0, message: 'Deleted' });
}
```

### 1.3 /api/update — 所有权校验 + 集合限制

```javascript
if (path === '/api/update') {
    const collection = params.collection;
    const user = params._user;
    const targetId = params.data?._id || params.data?.id;
    const updateData = { ...params.data };
    delete updateData._id;  // CloudBase SDK 不允许更新 _id

    // 🔒 禁止修改敏感集合
    if (['users', 'settings'].includes(collection)) {
        return response(403, { code: 403, message: '禁止通过通用接口修改该集合' });
    }

    // 🔒 非 admin 只能修改自己创建的记录
    if (user.role !== 'admin') {
        const { data: target } = await getDb().collection(collection).doc(targetId).get();
        if (!target || target.creator_id !== user.user_id) {
            return response(403, { code: 403, message: '无权修改该记录' });
        }
    }

    await getDb().collection(collection).doc(targetId).update({ data: updateData });
    return response(200, { code: 0, message: 'Updated' });
}
```

### 1.4 /api/add — 集合限制（已部分修复，补充）

```javascript
if (path === '/api/add') {
    const collection = params.collection;
    const user = params._user;

    // 🔒 禁止通过通用接口往 users/settings 添加数据
    if (['users', 'settings'].includes(collection)) {
        return response(403, { code: 403, message: '禁止通过通用接口添加该集合' });
    }

    // 原有逻辑：强制 role=inspector（已修复）...
    const data = params.data || {};
    data.creator_id = user.user_id;  // 标记创建者
    data.created_at = new Date();

    const res = await getDb().collection(collection).add(data);
    return response(200, { code: 0, data: { id: res.id || res._id }, message: 'Added' });
}
```

---

## Step 2: Settings 集合安全加固（P0）

**文件**：`cloudbase/api/index.js`

### 2.1 对 access_password 做哈希存储

**注意**：当前 dorm-data 路由已经在服务端校验 PIN（明文比对）。如果改哈希存储，需要同步改 dorm-data 的 PIN 校验逻辑。

**方案 A（推荐）：保持明文，但限制访问**
- 不改 `access_password` 存储方式
- 通过 Step 1.1 的 `/api/list` 字段过滤，已经隐藏了 `value: '***'`
- 同时限制只有 admin 能读 settings 集合

**方案 B（更安全）：哈希存储**
如果坚持哈希，需要：
1. 在 CloudBase 控制台 → settings 集合 → 找到 `access_password` → 把 `value` 从明文 `"0613"` 改成 PBKDF2 哈希值
2. 在 dorm-data 路由里，把明文比对改成哈希比对

**建议先用方案 A**，汇报后再做方案 B。

### 2.2 限制 settings 集合仅 admin 可读写

在 `/api/list`、`/api/update`、`/api/delete`、`/api/add` 里已经通过集合白名单限制了。

额外给 `/api/admin/settings` 或 `/api/settings` 专用路由加 admin 校验：

```javascript
if (path === '/api/settings') {
    // 🔒 settings 仅 admin 可读写
    if (!params._user || params._user.role !== 'admin') {
        return response(403, { code: 403, message: '需要管理员权限' });
    }
    // ... 原有逻辑
}
```

---

## Step 3: 登录/注册速率限制（P0）

**文件**：`cloudbase/api/index.js`

CloudBase 云函数无内置 Redis，用**内存计数器**（冷启动会重置，但防不住分布式攻击，能防单 IP 暴力破解）。

在文件顶部添加：

```javascript
// 内存速率限制器（按 IP 统计）
const rateLimitMap = new Map();
const RATE_LIMIT = {
    login: { max: 5, windowMs: 15 * 60 * 1000 },      // 15分钟内5次
    register: { max: 3, windowMs: 60 * 60 * 1000 },    // 1小时内3次
    general: { max: 60, windowMs: 60 * 1000 }          // 1分钟内60次通用请求
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
```

在 `exports.main` 中，JWT 校验之后，路由分发之前加：

```javascript
// 获取客户端 IP（CloudBase 网关会透传）
const clientIp = event.headers?.['x-forwarded-for'] || event.headers?.['x-real-ip'] || 'unknown';

// 对公开路由做速率限制
if (['/api/auth', '/api/userByUsername'].includes(path)) {
    const action = params.action || 'general';  // login / register / general
    const limitKey = action === 'login' ? 'login' : (action === 'register' ? 'register' : 'general');
    const result = checkRateLimit(clientIp, limitKey);
    if (!result.allowed) {
        return response(429, { 
            code: 429, 
            message: `请求过于频繁，请 ${result.retryAfter} 秒后重试` 
        });
    }
}
```

---

## Step 4: 用户名 XSS 过滤（P1）

**文件**：`cloudbase/api/index.js`

在 `/api/auth` 注册分支里，保存用户名前过滤危险字符：

```javascript
if (action === 'register') {
    let { username, password, display_name } = params;

    // 🔒 XSS 过滤
    function sanitizeUsername(str) {
        if (!str) return str;
        return str.replace(/[<>'"&]/g, '');  // 去掉 HTML 标签和实体字符
    }
    username = sanitizeUsername(username);
    display_name = sanitizeUsername(display_name || username);

    // 长度限制
    if (username.length < 2 || username.length > 32) {
        return response(400, { code: 400, message: '用户名长度应为 2-32 字符' });
    }

    // ... 原有注册逻辑
}
```

---

## Step 5: 用户枚举修复（P1）

**文件**：`cloudbase/api/index.js`

注册接口统一返回模糊信息，不区分"用户名已存在"和"注册成功"：

```javascript
if (action === 'register') {
    const { username } = params;

    // 检查用户名是否已存在（必须查，但返回统一信息）
    const { data: existing } = await getDb().collection('users')
        .where({ username }).limit(1).get();

    if (existing.length > 0) {
        // 🔒 统一返回，不暴露"用户名已存在"
        return response(200, { code: 0, message: '注册请求已提交' });
    }

    // ... 创建用户
    return response(200, { code: 0, message: '注册请求已提交' });
}
```

**注意**：前端 `login.html` 的注册表单也要改提示文字，不要写"用户名已被注册"，统一写"注册成功，请登录"。

---

## Step 6: 密码强度策略（P1）

**文件**：`cloudbase/api/index.js` + `login.html`

### 后端校验（注册时）

```javascript
if (action === 'register') {
    const { password } = params;

    // 🔒 密码强度校验
    if (!password || password.length < 6) {
        return response(400, { code: 400, message: '密码至少 6 位' });
    }
    // 如需更严格，可检查复杂度：
    // const hasUpper = /[A-Z]/.test(password);
    // const hasLower = /[a-z]/.test(password);
    // const hasNumber = /\d/.test(password);
    // const hasSpecial = /[!@#$%^&*]/.test(password);
    // const types = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
    // if (types < 2) return response(400, { code: 400, message: '密码需包含字母、数字、特殊字符中至少 2 种' });

    // ... 原有注册逻辑
}
```

### 前端提示（`login.html` 注册表单）

在密码输入框下方加提示文字：
```html
<small style="color: #888;">密码至少 6 位，建议包含字母和数字</small>
```

---

## Step 7: 前端获取密码哈希修复（P2）

**文件**：`cloudbase/api/index.js` + `api-client.js`

### 后端：新增服务端修改密码接口

在 `/api/auth` 里增加 `change_password` 分支：

```javascript
if (action === 'change_password') {
    const user = params._user;
    const { old_password, new_password } = params;

    if (!old_password || !new_password) {
        return response(400, { code: 400, message: '缺少旧密码或新密码' });
    }
    if (new_password.length < 6) {
        return response(400, { code: 400, message: '新密码至少 6 位' });
    }

    // 1. 查当前用户
    const { data: users } = await getDb().collection('users')
        .where({ _id: user.user_id }).limit(1).get();
    if (users.length === 0) {
        return response(404, { code: 404, message: '用户不存在' });
    }
    const dbUser = users[0];

    // 2. 服务端验证旧密码
    const valid = await verifyPassword(old_password, dbUser.password_hash);
    if (!valid) {
        return response(401, { code: 401, message: '旧密码错误' });
    }

    // 3. 服务端哈希新密码并更新
    const newHash = await hashPassword(new_password);
    await getDb().collection('users').doc(user.user_id)
        .update({ data: { password_hash: newHash } });

    return response(200, { code: 0, message: '密码修改成功' });
}
```

### 前端：`api-client.js` 修改 `changePassword`

```javascript
// 修改前：前端获取 password_hash 本地比对（危险）
// 修改后：只传 old_password 和 new_password，服务端处理
async function changePassword(oldPassword, newPassword) {
    return apiRequest('/api/auth', {
        action: 'change_password',
        old_password: oldPassword,
        new_password: newPassword
    });
}
```

**同时**：`getUserByUsername` 接口返回时也要过滤 `password_hash`：

```javascript
if (path === '/api/userByUsername') {
    const { username } = params;
    const { data } = await getDb().collection('users')
        .where({ username }).limit(1).get();
    if (data.length === 0) {
        return response(404, { code: 404, message: '用户不存在' });
    }
    // 🔒 绝不返回 password_hash
    const { password_hash, ...safeUser } = data[0];
    return response(200, { code: 0, data: safeUser });
}
```

---

## Step 8: 部署与验证

### 8.1 部署后端

```powershell
cd "E:\上大学。。。\女工\NightShift"
npm run deploy:api
```

### 8.2 部署前端（如果改了 `login.html`、`api-client.js`、`sw.js`）

```powershell
npm run deploy
```

### 8.3 验证清单

| 验证项 | 操作 | 预期结果 |
|--------|------|----------|
| 非 admin 查 users 集合 | inspector Token 调 `/api/list` collection=users | 403 |
| 非 admin 查 settings 集合 | inspector Token 调 `/api/list` collection=settings | 403 |
| admin 查 users 集合 | admin Token 调 `/api/list` collection=users | 200，但无 `password_hash` |
| 通用接口删 users | 调 `/api/delete` collection=users | 403 |
| 暴力注册 | 同一 IP 1分钟内注册 4 次 | 第 4 次返回 429 |
| 暴力登录 | 同一 IP 15分钟内登录 6 次 | 第 6 次返回 429 |
| XSS 用户名 | 注册 `<img src=x onerror=...>` | 用户名被过滤为 `img src=x onerror=...`（无尖括号） |
| 用户枚举 | 注册已存在用户名 | 返回"注册请求已提交"，不提示已存在 |
| 弱密码注册 | 注册密码 "123" | 返回 400 "密码至少 6 位" |
| 修改密码 | 调 `/api/auth` action=change_password | 服务端验证旧密码，更新成功，不返回 password_hash |

---

## 给 Claude 的执行指令

按以下顺序执行，每步完成后验证：

1. **Step 1**：通用 CRUD 加权限（最急，防止再被删站）
2. **Step 2**：Settings 集合限制（配合 Step 1 已部分完成）
3. **Step 3**：速率限制（防暴力破解）
4. **Step 4**：XSS 过滤
5. **Step 5**：用户枚举
6. **Step 6**：密码强度
7. **Step 7**：changePassword 服务端化
8. **Step 8**：部署 + 验证

**约束**：
- 只改 `cloudbase/api/index.js`、`api-client.js`、`login.html`
- 不要改数据库结构
- 不要改前端页面样式（除非加密码提示文字）
- 改完后更新 `sw.js` CACHE_NAME（如 `v2026-0612a`）
- 保持现有 JWT 认证逻辑不变（登录注册已修好，不要再动）

**完成后输出**：
- 修改了哪些文件、哪些行
- 验证结果（文字说明即可）
- 是否还有测试账号残留（如 `hacktest888`，还没删的话去控制台手动删）

---

*汇报前最后一轮加固，加油。*
