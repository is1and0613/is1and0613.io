// NightShift API Client — CloudBase 统一接口
// v1: 替换所有 fetch('/api/...') 调用，统一走 CloudBase 代理

const API_BASE = 'https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api';

// ============================================
// 核心请求函数
// ============================================

/**
 * 统一 API 请求（所有请求走 CloudBase 代理）
 * @param {string} path — 虚拟路由路径，如 '/api/dorm-data'
 * @param {object} payload — 请求参数（不含 path 的其余字段）
 * @returns {Promise<object>} — 解析后的 JSON 响应
 */
async function apiRequest(path, payload = {}) {
  const token = sessionStorage.getItem('authToken') || localStorage.getItem('token') || '';
  const resp = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ path, ...payload })
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// ============================================
// PBKDF2 密码哈希（客户端，与旧 _utils.js 一致）
// ============================================

/**
 * 哈希密码（PBKDF2 SHA-256, 100000 iterations, 16-byte salt）
 * @param {string} password — 明文密码
 * @returns {Promise<string>} — 格式 "saltBase64$hashBase64"
 */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return saltB64 + '$' + hash;
}

/**
 * 验证密码
 * @param {string} password — 明文密码
 * @param {string} stored — 存储的哈希（格式 "saltBase64$hashBase64"）
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 2) return false;
  const [saltB64, hash] = parts;
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const computedHash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return hash === computedHash;
}

/**
 * 签发简易 JWT（客户端 self-signed，仅用于 sessionStorage 传递用户信息）
 * 实际鉴权由 CloudBase 云函数中的 verifyToken 完成，
 * 这里只负责打包用户信息为 JWT 格式并存入 sessionStorage，
 * 云函数收到后使用相同 JWT_SECRET 验签。
 * 注意：客户端不应知道 JWT_SECRET，因此此函数仅在 login/register 成功
 * 且云函数返回 token 时使用。若云函数未返回 token，则降级为 user-info JSON。
 */
function makeUserPayload(user) {
  return {
    user_id: user._id || user.id,
    username: user.username,
    display_name: user.display_name || user.username,
    role: user.role || 'inspector',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  };
}

// ============================================
// 房间相关
// ============================================

async function getRoomByCode(code) { return apiRequest('/api/roomByCode', { data: { code } }); }
async function getRoomMembers(room_id) { return apiRequest('/api/roomMembers', { data: { room_id } }); }
async function getRoomStates(room_id) { return apiRequest('/api/roomStates', { data: { room_id } }); }
async function getRoomLogs(room_id) { return apiRequest('/api/roomLogs', { data: { room_id } }); }
async function getRoomMessages(room_id) { return apiRequest('/api/roomMessages', { data: { room_id } }); }
async function createRoom(data) { return apiRequest('/api/add', { collection: 'rooms', data }); }
async function syncRoomByCode(code) { return apiRequest('/api/room/sync', { code }); }

// ============================================
// 宿舍数据
// ============================================

async function getDormByFloor(floor) { return apiRequest('/api/dormByFloor', { data: { floor } }); }
async function getDormByName(dorm_name) { return apiRequest('/api/dormByName', { data: { dorm_name } }); }
async function getDormData(pin) { return apiRequest('/api/dorm-data', { pin }); }
async function getGradeMapping() { return apiRequest('/api/gradeMapping'); }

// ============================================
// 查寝记录
// ============================================

async function getSingleCheck(user_id, check_date) { return apiRequest('/api/singleCheckByUserDate', { data: { user_id, check_date } }); }
async function getCheckRecords(session_id) { return apiRequest('/api/checkRecords', { data: { session_id } }); }

// ============================================
// 通用 CRUD
// ============================================

async function listCollection(collection, where = {}, limit = 100, skip = 0) {
  return apiRequest('/api/list', { collection, where, limit, skip });
}
async function updateDoc(collection, _id, data) {
  return apiRequest('/api/update', { collection, data: { _id, ...data } });
}
async function deleteDoc(collection, _id) {
  return apiRequest('/api/delete', { collection, data: { _id } });
}
async function addBatch(collection, data) {
  return apiRequest('/api/addBatch', { collection, data });
}

// ============================================
// 用户相关
// ============================================

async function getUserByUsername(username) {
  return apiRequest('/api/userByUsername', { data: { username } });
}

// ============================================
// 认证相关（登录 / 注册 / 修改密码）
// ============================================

/**
 * 登录：先从 CloudBase 取用户 → 本地 PBKDF2 验证 → 请求 token
 */
async function loginUser(username, password) {
  // Step 1: 获取用户记录（含 password_hash）
  const userRes = await getUserByUsername(username);
  if (!userRes.data) {
    return { success: false, message: '用户名或密码错误' };
  }
  const user = userRes.data;

  // Step 2: 本地验证密码
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return { success: false, message: '用户名或密码错误' };
  }

  // Step 3: 请求 CloudBase 签发 token（不再传密码）
  const tokenRes = await apiRequest('/api/auth', {
    action: 'login',
    username: user.username,
    user_id: user._id || user.id,
    role: user.role || 'inspector',
    display_name: user.display_name || user.username
  });

  return tokenRes;
}

/**
 * 注册：本地 PBKDF2 哈希 → CloudBase 存储
 */
async function registerUser(username, password) {
  // Step 1: 检查是否已存在
  const existRes = await getUserByUsername(username);
  if (existRes.data) {
    return { success: false, message: '用户名已被注册' };
  }

  // Step 2: 本地哈希密码
  const password_hash = await hashPassword(password);

  // Step 3: 创建用户
  const createRes = await apiRequest('/api/add', {
    collection: 'users',
    data: {
      username,
      password_hash,
      display_name: username,
      role: 'inspector',
      created_at: new Date().toISOString(),
      is_temp: 0
    }
  });

  if (createRes.data && createRes.data._id) {
    // Step 4: 请求 token
    const tokenRes = await apiRequest('/api/auth', {
      action: 'login',
      username,
      user_id: createRes.data._id,
      role: 'inspector',
      display_name: username
    });
    return tokenRes;
  }

  return createRes;
}

/**
 * 修改密码（本地验证 + 更新）
 */
async function changePassword(oldPassword, newPassword, username) {
  // Step 1: 获取当前用户
  const userRes = await getUserByUsername(username);
  if (!userRes.data) {
    return { success: false, message: '用户不存在' };
  }

  // Step 2: 验证原密码
  const valid = await verifyPassword(oldPassword, userRes.data.password_hash);
  if (!valid) {
    return { success: false, message: '原密码错误' };
  }

  // Step 3: 哈希新密码并更新
  const newHash = await hashPassword(newPassword);
  return apiRequest('/api/update', {
    collection: 'users',
    data: { _id: userRes.data._id, password_hash: newHash }
  });
}

// ============================================
// 设置相关
// ============================================

async function getSettings() { return apiRequest('/api/settings'); }
async function updateSetting(key, value) { return apiRequest('/api/updateSetting', { data: { key, value } }); }
async function verifyAccessPassword(password) { return apiRequest('/api/verify-access-password', { password }); }
async function getSensitiveWordStats() { return apiRequest('/api/sensitive-words-stats'); }
async function updateAccessPassword(password) { return apiRequest('/api/access-password', { password }); }

// ============================================
// 智能分组
// ============================================

async function smartGroup(text) { return apiRequest('/api/smart-group', { text }); }

// ============================================
// 管理员后台
// ============================================

async function getAdminRooms() { return apiRequest('/api/admin/rooms'); }
async function getAdminLogs(params = {}) { return apiRequest('/api/admin/logs', params); }
async function getAdminUsers(params = {}) { return apiRequest('/api/admin/users', params); }
async function setUserRole(user_id, role) { return apiRequest('/api/admin/users/set-role', { user_id, role }); }
async function deleteUser(user_id) { return apiRequest('/api/admin/user-delete', { user_id }); }
async function getUserDetail(user_id) { return apiRequest('/api/admin/users/detail', { user_id }); }
async function uploadDormJson(records, mode, confirm) { return apiRequest('/api/admin/dorm-upload-json', { records, mode, confirm }); }
async function updateStudent(payload) { return apiRequest('/api/admin/student-update', payload); }
async function deleteStudent(payload) { return apiRequest('/api/admin/student-delete', payload); }
async function runCleanup() { return apiRequest('/api/cleanup'); }
