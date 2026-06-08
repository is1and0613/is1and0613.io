// functions/api/admin/student-delete.js
// v20: 管理员单条学生记录删除

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction, maskName,
} from '../_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('POST, OPTIONS');
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  dbGuard(env);

  const payload = await verifyToken(request, env);
  requireRole(payload, ['admin']);

  let body;
  try { body = await request.json(); } catch (e) {
    return errorResponse('请求格式错误', 400);
  }

  const { student_name, dorm_name, bed } = body;

  if (!student_name || !dorm_name || !bed) {
    return errorResponse('缺少 student_name / dorm_name / bed', 400);
  }

  const db = env.DB;

  const existing = await db.prepare(
    'SELECT id FROM dorm_students WHERE student_name = ? AND dorm_name = ? AND bed = ?'
  ).bind(student_name.trim(), dorm_name.trim(), Number(bed)).first();

  if (!existing) {
    return errorResponse('未找到匹配的学生记录', 404);
  }

  await db.prepare(
    'DELETE FROM dorm_students WHERE id = ?'
  ).bind(existing.id).run();

  // 系统日志（姓名脱敏）
  await logSystemAction(env,
    { user_id: payload.user_id, username: payload.username, role: payload.role },
    'student_delete', 'student', String(existing.id),
    `删除 ${maskName(student_name)} ${dorm_name}/${bed}`, request
  );

  return jsonResponse({ message: '删除成功' });
});
