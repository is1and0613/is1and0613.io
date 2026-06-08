// functions/api/room.js
// 房间 API：创建、加入、同步、状态更新、消息

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction,
} from './_utils.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/I/1
const CODE_LENGTH = 6;
const ROOM_TTL_MINUTES = 2 * 24 * 60; // 2 days
const MAX_SYNC_LOGS = 50;
const MAX_SYNC_MESSAGES = 50;

// ============================================
// v20: 敏感词 KV 后端过滤（全局缓存，热更新）
// ============================================
let _swTrieRoot = null;
let _swTrieVersion = null;

async function getSensitiveTrie(env) {
  try {
    if (!env.SENSITIVE_WORDS) return null;
    const version = await env.SENSITIVE_WORDS.get('version', 'text') || '0';
    if (_swTrieRoot && _swTrieVersion === version) return _swTrieRoot;

    const text = await env.SENSITIVE_WORDS.get('sensitive_words', 'text');
    if (!text) return null;
    const words = text.split('\n').map(w => w.trim()).filter(w => w.length > 0);
    _swTrieRoot = buildBackendTrie(words);
    _swTrieVersion = version;
    console.log('[SW-Filter] Loaded ' + words.length + ' sensitive words, version=' + version);
    return _swTrieRoot;
  } catch (e) {
    console.error('[SW-Filter] Failed to load KV:', e.message);
    return null;
  }
}

function buildBackendTrie(words) {
  const root = {};
  for (const word of words) {
    let node = root;
    for (const ch of word.toLowerCase()) {
      if (!node[ch]) node[ch] = {};
      node = node[ch];
    }
    node._end = true;
  }
  return root;
}

function checkBackendTrie(text, trie) {
  if (!text || !trie) return false;
  const lower = text.toLowerCase();
  const n = lower.length;
  for (let i = 0; i < n; i++) {
    let node = trie;
    for (let j = i; j < n; j++) {
      node = node[lower[j]];
      if (!node) break;
      if (node._end) return true;
    }
  }
  return false;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueCode(env) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const existing = await env.DB.prepare(
      'SELECT id FROM rooms WHERE code = ?'
    ).bind(code).first();
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique room code after 10 attempts');
}

// Fetch dorm data from D1 for room state initialization
async function fetchDormData(env) {
  const { results: students } = await env.DB.prepare(
    `SELECT student_name as name, dorm_name as dorm, bed
     FROM dorm_students
     WHERE status = '在校' AND student_name IS NOT NULL
     ORDER BY dorm_name, bed`
  ).all();

  return { students };
}

// ============================================
// Request handler
// ============================================

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, POST, OPTIONS');
  }

  dbGuard(env);

  // Determine action from query params or body
  const url = new URL(request.url);
  const queryAction = url.searchParams.get('action');
  const code = url.searchParams.get('code');

  if (request.method === 'GET' && queryAction === 'sync' && code) {
    return handleSync(request, env, code);
  }

  if (request.method !== 'POST') {
    return errorResponse('Method Not Allowed', 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    // body may be empty for some actions
  }

  const action = body.action || queryAction;

  switch (action) {
    case 'create':
      return handleCreate(request, env);
    case 'join':
      return handleJoin(request, env, body);
    case 'state':
      return handleState(request, env, body);
    case 'message':
      return handleMessage(request, env, body);
    default:
      return errorResponse('无效的 action，支持: create, join, sync, state, message', 400);
  }
});

// ============================================
// POST /api/room — action: create
// ============================================

async function handleCreate(request, env) {
  const payload = await verifyToken(request, env);
  requireRole(payload, ['inspector', 'admin']);

  const userId = payload.user_id;
  const username = payload.username;

  const code = await generateUniqueCode(env);

  await env.DB.prepare(
    `INSERT INTO rooms (code, creator_id, expires_at, status)
     VALUES (?, ?, datetime('now', '+${ROOM_TTL_MINUTES} minutes'), 'active')`
  ).bind(code, userId).run();

  const room = await env.DB.prepare(
    'SELECT id, expires_at FROM rooms WHERE code = ?'
  ).bind(code).first();

  // Add creator as member
  await env.DB.prepare(
    "INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'creator')"
  ).bind(room.id, userId).run();

  // Initialize room_states from D1 dorm data
  try {
    const { students } = await fetchDormData(env);

    const stmt = env.DB.prepare(
      'INSERT INTO room_states (room_id, student_name, dorm_number, bed_number, status) VALUES (?, ?, ?, ?, ?)'
    );

    const batch = students.map(s =>
      stmt.bind(room.id, s.name, String(s.dorm), String(s.bed), 'present')
    );

    // Execute in chunks to avoid overwhelming D1
    for (let i = 0; i < batch.length; i += 20) {
      const chunk = batch.slice(i, i + 20);
      await env.DB.batch(chunk);
    }
  } catch (e) {
    // If D1 query fails, room is created but states are empty
    // Frontend can retry or use local data
    console.error('Failed to init room states from D1:', e);
  }

  // Log room creation
  await env.DB.prepare(
    `INSERT INTO room_logs (room_id, user_id, action_type, detail)
     VALUES (?, ?, 'system', ?)`
  ).bind(room.id, userId, `${username} 创建了房间`).run();

  // v20: system_log
  await logSystemAction(env,
    { user_id: userId, username, role: payload.role || 'inspector' },
    'room_create', 'room', String(room.id), `创建房间 ${code}`, request
  );

  return jsonResponse({
    message: '房间创建成功',
    code,
    room_id: room.id,
    expires_at: room.expires_at,
  }, 201);
}

// ============================================
// POST /api/room — action: join
// ============================================

async function handleJoin(request, env, body) {
  const payload = await verifyToken(request, env);
  requireRole(payload, ['inspector', 'admin']);

  const userId = payload.user_id;
  const username = payload.username;
  const { code } = body;

  if (!code) {
    return errorResponse('请输入房间码', 400);
  }

  const room = await env.DB.prepare(
    'SELECT * FROM rooms WHERE code = ?'
  ).bind(code.toUpperCase()).first();

  if (!room) {
    return errorResponse('房间不存在，请检查房间码', 404);
  }

  if (room.status !== 'active') {
    return errorResponse('房间已结束', 410);
  }

  // Check expiry
  const expiresAt = new Date(room.expires_at + 'Z');
  if (expiresAt < new Date()) {
    await env.DB.prepare(
      "UPDATE rooms SET status = 'expired' WHERE id = ?"
    ).bind(room.id).run();
    return errorResponse('房间已过期（2天有效期）', 410);
  }

  // Check duplicate
  const existingMember = await env.DB.prepare(
    'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(room.id, userId).first();

  if (existingMember) {
    // Already a member, just return room info
    return jsonResponse({
      message: '你已在该房间中',
      room_id: room.id,
      code: room.code,
    });
  }

  await env.DB.prepare(
    "INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')"
  ).bind(room.id, userId).run();

  // Log join
  await env.DB.prepare(
    `INSERT INTO room_logs (room_id, user_id, action_type, detail)
     VALUES (?, ?, 'join', ?)`
  ).bind(room.id, userId, `${username} 加入了房间`).run();

  // v20: system_log
  await logSystemAction(env,
    { user_id: userId, username, role: payload.role || 'inspector' },
    'room_join', 'room', String(room.id), `加入房间 ${code}`, request
  );

  return jsonResponse({
    message: '成功加入房间',
    room_id: room.id,
    code: room.code,
    expires_at: room.expires_at,
  });
}

// ============================================
// GET /api/room?action=sync&code=XXXXXX
// ============================================

async function handleSync(request, env, code) {
  const payload = await verifyToken(request, env);

  const room = await env.DB.prepare(
    'SELECT * FROM rooms WHERE code = ?'
  ).bind(code.toUpperCase()).first();

  if (!room) {
    return errorResponse('房间不存在', 404);
  }

  // Update expiry if room still active
  if (room.status === 'active') {
    const expiresAt = new Date(room.expires_at + 'Z');
    if (expiresAt < new Date()) {
      await env.DB.prepare(
        "UPDATE rooms SET status = 'expired' WHERE id = ?"
      ).bind(room.id).run();
      room.status = 'expired';
    }
  }

  // Get states
  const states = await env.DB.prepare(
    'SELECT * FROM room_states WHERE room_id = ? ORDER BY dorm_number, bed_number'
  ).bind(room.id).all();

  // Get recent logs
  const logs = await env.DB.prepare(
    `SELECT room_logs.*, users.username, users.display_name
     FROM room_logs
     LEFT JOIN users ON room_logs.user_id = users.id
     WHERE room_logs.room_id = ?
     ORDER BY room_logs.created_at DESC
     LIMIT ?`
  ).bind(room.id, MAX_SYNC_LOGS).all();

  // Get recent messages
  const messages = await env.DB.prepare(
    `SELECT room_messages.*, users.username, users.display_name
     FROM room_messages
     LEFT JOIN users ON room_messages.user_id = users.id
     WHERE room_messages.room_id = ?
     ORDER BY room_messages.created_at ASC
     LIMIT ?`
  ).bind(room.id, MAX_SYNC_MESSAGES).all();

  // Get members
  const members = await env.DB.prepare(
    `SELECT room_members.*, users.username, users.display_name
     FROM room_members
     LEFT JOIN users ON room_members.user_id = users.id
     WHERE room_members.room_id = ?`
  ).bind(room.id).all();

  // Update last_read_msg_id for current user
  const lastMsg = messages.results.length > 0
    ? messages.results[messages.results.length - 1].id
    : 0;
  if (lastMsg > 0) {
    await env.DB.prepare(
      'UPDATE room_members SET last_read_msg_id = ? WHERE room_id = ? AND user_id = ?'
    ).bind(lastMsg, room.id, payload.user_id).run();
  }

  return jsonResponse({
    room_info: {
      id: room.id,
      code: room.code,
      creator_id: room.creator_id,
      created_at: room.created_at,
      expires_at: room.expires_at,
      status: room.status,
      dorm_building: room.dorm_building,
    },
    states: states.results,
    logs: logs.results,
    messages: messages.results,
    members: members.results,
  });
}

// ============================================
// POST /api/room — action: state
// ============================================

async function handleState(request, env, body) {
  const payload = await verifyToken(request, env);
  requireRole(payload, ['inspector', 'admin']);

  const userId = payload.user_id;
  const username = payload.username;
  const { code, student_name, new_status, detail, reason, reason_detail } = body;

  if (!code || !student_name || !new_status) {
    return errorResponse('缺少必要参数: code, student_name, new_status', 400);
  }

  const validStatuses = ['present', 'absent', 'leaveSchool', 'leaveInside', 'leaveOutside'];
  if (!validStatuses.includes(new_status)) {
    return errorResponse('无效的状态值', 400);
  }

  const room = await env.DB.prepare(
    'SELECT * FROM rooms WHERE code = ? AND status = ?'
  ).bind(code.toUpperCase(), 'active').first();

  if (!room) {
    return errorResponse('房间不存在或已过期', 404);
  }

  // Get current state
  const currentState = await env.DB.prepare(
    'SELECT * FROM room_states WHERE room_id = ? AND student_name = ?'
  ).bind(room.id, student_name).first();

  if (!currentState) {
    return errorResponse('未找到该学生', 404);
  }

  const oldStatus = currentState.status;

  // Update state (v18: 增加 reason, reason_detail, updated_by_name)
  const updatedByName = username || payload.display_name || '';
  await env.DB.prepare(
    `UPDATE room_states
     SET status = ?, reason = ?, reason_detail = ?, updated_by = ?, updated_by_name = ?, updated_at = datetime('now')
     WHERE room_id = ? AND student_name = ?`
  ).bind(new_status, detail || reason || null, reason_detail || null, userId, updatedByName, room.id, student_name).run();

  // Insert log
  await env.DB.prepare(
    `INSERT INTO room_logs (room_id, user_id, action_type, target_student, old_status, new_status, detail)
     VALUES (?, ?, 'status_change', ?, ?, ?, ?)`
  ).bind(room.id, userId, student_name, oldStatus, new_status, detail || null).run();

  // v20: system_log
  await logSystemAction(env,
    { user_id: userId, username, role: payload.role || 'inspector' },
    'room_status_change', 'room_states', String(room.id),
    `学生:${student_name} 状态:${oldStatus}→${new_status}`, request
  );

  return jsonResponse({
    message: '状态更新成功',
    student_name,
    old_status: oldStatus,
    new_status,
    updated_at: new Date().toISOString(),
  });
}

// ============================================
// POST /api/room — action: message
// ============================================

async function handleMessage(request, env, body) {
  const payload = await verifyToken(request, env);
  requireRole(payload, ['inspector', 'admin']);

  const userId = payload.user_id;
  const { code, content } = body;

  if (!code || !content || !content.trim()) {
    return errorResponse('缺少必要参数: code, content', 400);
  }

  if (content.length > 500) {
    return errorResponse('消息内容不能超过500字', 400);
  }

  // v20: 后端敏感词二次过滤（KV）
  const trie = await getSensitiveTrie(env);
  if (trie && checkBackendTrie(content.trim(), trie)) {
    // 记录拦截日志（不记录完整消息内容）
    await logSystemAction(env,
      { user_id: userId, username: payload.username, role: payload.role || 'inspector' },
      'sensitive_blocked', 'room_message', code, 'chat消息被拦截', request
    );
    return errorResponse('消息包含敏感内容', 400);
  }

  const room = await env.DB.prepare(
    'SELECT id FROM rooms WHERE code = ? AND status = ?'
  ).bind(code.toUpperCase(), 'active').first();

  if (!room) {
    return errorResponse('房间不存在或已过期', 404);
  }

  const result = await env.DB.prepare(
    `INSERT INTO room_messages (room_id, user_id, content)
     VALUES (?, ?, ?)`
  ).bind(room.id, userId, content.trim()).run();

  return jsonResponse({
    message: '发送成功',
    message_id: result.meta.last_row_id,
    created_at: new Date().toISOString(),
  }, 201);
}
