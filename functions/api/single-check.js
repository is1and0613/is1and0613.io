// functions/api/single-check.js — v18 单人查寝数据同步（按 account + date 维度）
// 替代旧的 session-based check-session API，实现真正的跨设备同步

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, maskName,
} from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, POST, OPTIONS');
  }

  dbGuard(env);
  const db = env.DB;

  const url = new URL(request.url);
  const queryAction = url.searchParams.get('action');

  // ============================================
  // GET: 列出指定日期的所有查寝记录
  // ============================================
  if (request.method === 'GET') {
    const payload = await verifyToken(request, env);
    const userId = payload.user_id;

    if (!userId) {
      return errorResponse('用户身份无效', 401);
    }

    // v20: 只读查询 — 任何已认证用户可查看自己的记录
    if (queryAction === 'list') {
      const date = url.searchParams.get('date');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return errorResponse('缺少或无效的 date 参数（格式：YYYY-MM-DD）', 400);
      }

      const { results } = await db.prepare(
        `SELECT * FROM single_check_records
         WHERE user_id = ? AND check_date = ?
         ORDER BY dorm_number, bed_number`
      ).bind(userId, date).all();

      return jsonResponse({ records: results });
    }

    return errorResponse('未知 action，支持: list', 400);
  }

  // ============================================
  // POST: 批量 upsert 查寝记录
  // ============================================
  if (request.method === 'POST') {
    const payload = await verifyToken(request, env);
    requireRole(payload, ['inspector', 'teacher', 'admin']);
    const userId = payload.user_id;

    if (!userId) {
      return errorResponse('用户身份无效', 401);
    }

    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return errorResponse('请求格式错误', 400);
    }

    if (queryAction === 'update') {
      const { check_date, records } = body;

      if (!check_date || !/^\d{4}-\d{2}-\d{2}$/.test(check_date)) {
        return errorResponse('缺少或无效的 check_date 参数（格式：YYYY-MM-DD）', 400);
      }

      if (!records || !Array.isArray(records) || records.length === 0) {
        return errorResponse('缺少 records 数组', 400);
      }

      // 批量 upsert：利用 UNIQUE(user_id, check_date, student_id) 约束
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO single_check_records
         (user_id, check_date, student_id, student_name, dorm_number, bed_number, grade, class_name, status, reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      );

      const batch = records.map(r =>
        stmt.bind(
          userId,
          check_date,
          r.student_id || r.student_name,
          r.student_name || r.student_id,
          r.dorm_number || null,
          r.bed_number ? String(r.bed_number) : null,
          r.grade || null,
          r.class_name || null,
          r.status || 'in',
          r.reason || null
        )
      );

      // 分批执行，避免 D1 单次批量过大
      for (let i = 0; i < batch.length; i += 20) {
        const chunk = batch.slice(i, i + 20);
        await db.batch(chunk);
      }

      return jsonResponse({ message: '同步成功', count: records.length });
    }

    return errorResponse('未知 action，支持: update', 400);
  }

  return errorResponse('不支持的请求方法', 405);
});
