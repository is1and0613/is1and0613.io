// functions/api/admin/users.js
// v20: 管理员用户管理 — 列表、角色修改、用户详情

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction, maskName,
} from '../_utils.js';

const VALID_ROLES = ['student', 'inspector', 'teacher', 'admin'];

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('GET, POST, OPTIONS');
  dbGuard(env);

  const payload = await verifyToken(request, env);
  requireRole(payload, ['admin']);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const db = env.DB;

  // ============================================
  // GET: 用户列表
  // ============================================
  if (request.method === 'GET' && !action) {
    const role = url.searchParams.get('role');
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(url.searchParams.get('pageSize')) || 20), 100);

    let where = '';
    let params = [];
    if (role && VALID_ROLES.includes(role)) {
      where = 'WHERE role = ?';
      params.push(role);
    }

    // Count
    const countResult = await db.prepare(
      `SELECT COUNT(*) as total FROM users ${where}`
    ).bind(...params).first();
    const total = countResult ? countResult.total : 0;

    // Query
    const offset = (page - 1) * pageSize;
    const { results: users } = await db.prepare(
      `SELECT id, username, display_name, role, last_login_at, last_login_ip, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, offset).all();

    return jsonResponse({ users, total, page, pageSize });
  }

  // ============================================
  // GET ?action=detail&user_id=X: 用户详情（含近期日志）
  // ============================================
  if (request.method === 'GET' && action === 'detail') {
    const userId = parseInt(url.searchParams.get('user_id'));
    if (!userId) return errorResponse('缺少 user_id', 400);

    const user = await db.prepare(
      'SELECT id, username, display_name, role, last_login_at, last_login_ip, created_at FROM users WHERE id = ?'
    ).bind(userId).first();
    if (!user) return errorResponse('用户不存在', 404);

    // 最近 10 条登录记录
    const { results: loginLogs } = await db.prepare(
      `SELECT * FROM login_logs WHERE user_id = ? ORDER BY login_at DESC LIMIT 10`
    ).bind(userId).all();

    // 最近 10 条操作记录
    const { results: systemLogs } = await db.prepare(
      `SELECT * FROM system_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    ).bind(userId).all();

    return jsonResponse({ user, login_logs: loginLogs, system_logs: systemLogs });
  }

  // ============================================
  // POST ?action=set-role: 修改用户角色
  // ============================================
  if (request.method === 'POST' && action === 'set-role') {
    let body;
    try { body = await request.json(); } catch (e) {
      return errorResponse('请求格式错误', 400);
    }

    const { user_id, role } = body;
    if (!user_id || !role) return errorResponse('缺少 user_id 或 role', 400);
    if (!VALID_ROLES.includes(role)) {
      return errorResponse('无效的角色，支持: ' + VALID_ROLES.join(', '), 400);
    }

    // 禁止修改自己的角色
    if (parseInt(user_id) === payload.user_id) {
      return errorResponse('不能修改自己的角色', 403);
    }

    const targetUser = await db.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
    ).bind(parseInt(user_id)).first();
    if (!targetUser) return errorResponse('用户不存在', 404);

    const oldRole = targetUser.role || 'inspector';
    if (oldRole === role) {
      return jsonResponse({ message: '角色未变更' });
    }

    await db.prepare(
      "UPDATE users SET role = ? WHERE id = ?"
    ).bind(role, parseInt(user_id)).run();

    // 系统日志
    await logSystemAction(env,
      { user_id: payload.user_id, username: payload.username, role: payload.role },
      'role_change', 'user', String(user_id),
      `${targetUser.username}: ${oldRole} → ${role}`, request
    );

    return jsonResponse({ message: '角色修改成功', old_role: oldRole, new_role: role });
  }

  return errorResponse('未知的 action', 400);
});
