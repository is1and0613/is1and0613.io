// functions/api/admin/logs.js
// v20: 管理员操作日志查询

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole,
} from '../_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('GET, OPTIONS');
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  dbGuard(env);

  const payload = await verifyToken(request, env);
  requireRole(payload, ['admin']);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const username = url.searchParams.get('username');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const page = parseInt(url.searchParams.get('page')) || 1;
  const pageSize = Math.min(parseInt(url.searchParams.get('pageSize')) || 20, 100);

  const db = env.DB;

  let whereClauses = [];
  let params = [];

  if (action && action !== 'all') {
    whereClauses.push('action = ?');
    params.push(action);
  }
  if (username) {
    whereClauses.push('username LIKE ?');
    params.push('%' + username + '%');
  }
  if (startDate) {
    whereClauses.push('created_at >= ?');
    params.push(startDate);
  }
  if (endDate) {
    whereClauses.push('created_at <= ?');
    params.push(endDate + ' 23:59:59');
  }

  const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Count
  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM system_logs ${whereStr}`
  ).bind(...params).first();
  const total = countResult ? countResult.total : 0;

  // Query
  const offset = (page - 1) * pageSize;
  const { results: logs } = await db.prepare(
    `SELECT * FROM system_logs ${whereStr}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all();

  return jsonResponse({
    logs,
    total,
    page,
    pageSize,
  });
});
