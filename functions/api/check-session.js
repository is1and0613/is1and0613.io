// functions/api/check-session.js — 跨设备查寝数据同步 API

import { verifyToken, jsonResponse, errorResponse, handleOptions, withErrorGuard, dbGuard } from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, POST, OPTIONS');
  }

  const user = await verifyToken(request, env);
  dbGuard(env);
  const db = env.DB;

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  if (request.method === 'GET') {
    // 列出当前用户的活跃 sessions
    if (action === 'list') {
      const sessions = await db.prepare(
        `SELECT s.*, COUNT(r.student_name) as record_count
         FROM check_sessions s
         LEFT JOIN check_records r ON s.id = r.session_id
         WHERE s.user_id = ? AND s.status = 'active'
         GROUP BY s.id
         ORDER BY s.last_sync DESC`
      ).bind(user.userId || user.id).all();

      return jsonResponse({ sessions: sessions.results });
    }

    // 获取某个 session 的所有记录
    if (action === 'records') {
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId) return errorResponse('缺少 session_id', 400);

      const session = await db.prepare(
        'SELECT * FROM check_sessions WHERE id = ? AND user_id = ?'
      ).bind(sessionId, user.userId || user.id).first();

      if (!session) return errorResponse('查寝批次不存在', 404);

      const records = await db.prepare(
        'SELECT * FROM check_records WHERE session_id = ?'
      ).bind(sessionId).all();

      return jsonResponse({ session, records: records.results });
    }

    return errorResponse('未知 action', 400);
  }

  if (request.method === 'POST') {
    const body = await request.json();

    // 创建新的查寝 session
    if (action === 'create') {
      const { sessionId, floor } = body;
      if (!sessionId) return errorResponse('缺少 sessionId', 400);

      const userId = user.userId || user.id;

      await db.prepare(
        `INSERT OR REPLACE INTO check_sessions (id, user_id, floor, status, last_sync)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)`
      ).bind(sessionId, userId, floor || null).run();

      return jsonResponse({ sessionId, message: '创建成功' });
    }

    // 批量同步记录
    if (action === 'sync') {
      const { sessionId, records, deviceId } = body;
      if (!sessionId) return errorResponse('缺少 sessionId', 400);
      if (!records || !Array.isArray(records)) return errorResponse('缺少 records', 400);

      const userId = user.userId || user.id;

      // 确保 session 存在
      await db.prepare(
        `INSERT OR IGNORE INTO check_sessions (id, user_id, status, last_sync)
         VALUES (?, ?, 'active', CURRENT_TIMESTAMP)`
      ).bind(sessionId, userId).run();

      // 批量 upsert 记录
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO check_records (session_id, student_name, status, reason, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      );

      // D1 batch
      const batch = [];
      for (const rec of records) {
        batch.push(stmt.bind(sessionId, rec.studentName, rec.status, rec.reason || null, deviceId || 'unknown'));
      }
      await db.batch(batch);

      // 更新 last_sync
      await db.prepare(
        'UPDATE check_sessions SET last_sync = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(sessionId).run();

      return jsonResponse({ message: '同步成功', count: records.length });
    }

    // 标记 session 为完成
    if (action === 'complete') {
      const { sessionId } = body;
      if (!sessionId) return errorResponse('缺少 sessionId', 400);

      await db.prepare(
        'UPDATE check_sessions SET status = ?, last_sync = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
      ).bind('completed', sessionId, user.userId || user.id).run();

      return jsonResponse({ message: '查寝完成' });
    }

    return errorResponse('未知 action', 400);
  }

  return errorResponse('不支持的请求方法', 405);
});
