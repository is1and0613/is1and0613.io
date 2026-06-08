// functions/api/admin/student-update.js
// v20: 管理员单条学生记录更新

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction,
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

  // 按 (student_name, dorm_name, bed) 定位
  const existing = await db.prepare(
    'SELECT id FROM dorm_students WHERE student_name = ? AND dorm_name = ? AND bed = ?'
  ).bind(student_name.trim(), dorm_name.trim(), Number(bed)).first();

  if (!existing) {
    return errorResponse('未找到匹配的学生记录', 404);
  }

  // 更新字段（只更新有值的字段）
  const updates = [];
  const params = [];

  if (body.class_name !== undefined) { updates.push('class_name = ?'); params.push(body.class_name); }
  if (body.grade !== undefined) { updates.push('grade = ?'); params.push(body.grade); }
  if (body.grade_name !== undefined) { updates.push('grade_name = ?'); params.push(body.grade_name); }
  if (body.year_code !== undefined) { updates.push('year_code = ?'); params.push(body.year_code); }
  if (body.floor !== undefined) { updates.push('floor = ?'); params.push(body.floor); }
  if (body.status !== undefined) { updates.push('status = ?'); params.push(body.status); }
  if (body.new_dorm_name !== undefined) { updates.push('dorm_name = ?'); params.push(body.new_dorm_name); }
  if (body.new_student_name !== undefined) { updates.push('student_name = ?'); params.push(body.new_student_name); }
  if (body.new_bed !== undefined) { updates.push('bed = ?'); params.push(Number(body.new_bed)); }

  if (updates.length === 0) {
    return errorResponse('没有需要更新的字段', 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(existing.id);

  await db.prepare(
    `UPDATE dorm_students SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  // 系统日志
  await logSystemAction(env,
    { user_id: payload.user_id, username: payload.username, role: payload.role },
    'student_update', 'student', String(existing.id),
    `更新 ${student_name} ${dorm_name}/${bed}`, request
  );

  return jsonResponse({ message: '更新成功' });
});
