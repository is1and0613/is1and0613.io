// functions/api/admin/dorm-upload-json.js
// 管理员上传宿舍数据（前端已解析为 JSON）

import { jsonResponse, errorResponse, handleOptions, verifyToken, withErrorGuard } from '../_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') return handleOptions('POST, OPTIONS');
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const payload = await verifyToken(request, context.env);
  if (payload.username !== 'chaqin') {
    return errorResponse('Forbidden: admin only', 403);
  }

  const body = await request.json();
  const { records } = body;

  if (!Array.isArray(records) || records.length === 0) {
    return errorResponse('Invalid records array', 400);
  }

  // Resolve grade_name for each record via grade_mapping
  const gradeMap = {};
  const { results: mappings } = await context.env.DB.prepare(
    'SELECT year_code, grade_name FROM grade_mapping'
  ).all();
  for (const m of mappings) {
    gradeMap[m.year_code] = m.grade_name;
  }

  for (const r of records) {
    if (!r.grade_name && r.year_code) {
      r.grade_name = gradeMap[r.year_code] || '';
    }
  }

  // Full replace: clear old data then insert
  await context.env.DB.prepare('DELETE FROM dorm_students').run();
  await context.env.DB.prepare('DELETE FROM sqlite_sequence WHERE name = ?').bind('dorm_students').run();

  const insertStmt = context.env.DB.prepare(
    `INSERT INTO dorm_students
     (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const r of records) {
    await insertStmt.bind(
      r.dorm_name, r.floor, r.class_name, r.student_name,
      r.bed, r.year_code, r.grade_name, r.status
    ).run();
  }

  return jsonResponse({
    success: true,
    imported: records.length,
    message: `Imported ${records.length} records.`
  });
});
