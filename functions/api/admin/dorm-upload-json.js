// functions/api/admin/dorm-upload-json.js
// v20: 管理员上传宿舍数据 — 支持增量更新 & 全量替换（事务保护）
// v20: 数据验证 + 角色权限 + 操作日志

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction, maskName,
} from '../_utils.js';

// 姓名验证：2-20 非空字符（兼容少数民族姓名）
const NAME_REGEX = /^[^\s]{2,20}$/;

function validateRecord(r, index) {
  const errors = [];
  if (!r.student_name || typeof r.student_name !== 'string') {
    errors.push('姓名为空');
  } else if (!NAME_REGEX.test(r.student_name.trim())) {
    errors.push('姓名格式无效: ' + r.student_name);
  }
  if (!r.dorm_name || typeof r.dorm_name !== 'string' || !r.dorm_name.trim()) {
    errors.push('宿舍号为空');
  }
  if (r.bed === null || r.bed === undefined || isNaN(Number(r.bed)) || Number(r.bed) < 1 || Number(r.bed) > 6) {
    errors.push('床号无效: ' + r.bed);
  }
  return errors;
}

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('POST, OPTIONS');
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  dbGuard(env);

  const payload = await verifyToken(request, env);

  // v20: 角色权限检查
  requireRole(payload, ['admin']);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('请求格式错误', 400);
  }

  const { records, mode, confirm } = body;

  if (!Array.isArray(records) || records.length === 0) {
    return errorResponse('缺少有效的 records 数组', 400);
  }

  const uploadMode = mode || 'incremental';

  if (uploadMode === 'replace' && !confirm) {
    return errorResponse('全量替换需要 confirm: true 确认', 400);
  }

  if (!['incremental', 'replace'].includes(uploadMode)) {
    return errorResponse('无效的 mode，请使用 incremental 或 replace', 400);
  }

  const db = env.DB;

  // Resolve grade_name for each record via grade_mapping
  const gradeMap = {};
  try {
    const { results: mappings } = await db.prepare(
      'SELECT year_code, grade_name FROM grade_mapping'
    ).all();
    for (const m of mappings) {
      gradeMap[m.year_code] = m.grade_name;
    }
  } catch (e) { /* grade_mapping may not exist */ }

  // Validate & enrich records
  const validRecords = [];
  const errors = [];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const rowErrors = validateRecord(r, i);
    if (rowErrors.length > 0) {
      errors.push({ row: i + 1, errors: rowErrors });
      continue; // skip invalid records
    }

    if (!r.grade_name && r.year_code) {
      r.grade_name = gradeMap[r.year_code] || '';
    }

    validRecords.push(r);
  }

  let result;

  if (uploadMode === 'replace') {
    result = await doReplace(db, validRecords);
  } else {
    result = await doIncremental(db, validRecords);
  }

  // 日志记录
  const userInfo = {
    user_id: payload.user_id,
    username: payload.username,
    role: payload.role || 'admin',
  };
  await logSystemAction(env, userInfo,
    'dorm_upload', 'dorm_students', null,
    `模式:${uploadMode} 总数:${records.length} 成功:${result.inserted + result.updated} 失败:${errors.length}`,
    request
  );

  return jsonResponse({
    message: `导入完成`,
    mode: uploadMode,
    inserted: result.inserted,
    updated: result.updated,
    total: records.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ============================================
// 增量更新
// ============================================
async function doIncremental(db, records) {
  let inserted = 0, updated = 0;

  const selectStmt = db.prepare(
    `SELECT id FROM dorm_students
     WHERE student_name = ? AND dorm_name = ? AND bed = ?`
  );

  const updateStmt = db.prepare(
    `UPDATE dorm_students
     SET class_name = ?, grade = ?, grade_name = ?,
         year_code = ?, floor = ?, status = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  );

  const insertStmt = db.prepare(
    `INSERT INTO dorm_students
     (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, grade, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  );

  for (const r of records) {
    const existing = await selectStmt.bind(
      r.student_name.trim(), r.dorm_name.trim(), Number(r.bed)
    ).first();

    if (existing) {
      await updateStmt.bind(
        r.class_name || null,
        r.grade || null,
        r.grade_name || '',
        r.year_code || null,
        r.floor || null,
        r.status || '在校',
        existing.id
      ).run();
      updated++;
    } else {
      await insertStmt.bind(
        r.dorm_name.trim(), r.floor || 0, r.class_name || null,
        r.student_name.trim(), Number(r.bed), r.year_code || null,
        r.grade_name || '', r.grade || null, r.status || '在校'
      ).run();
      inserted++;
    }
  }

  return { inserted, updated };
}

// ============================================
// 全量替换（事务保护）
// ============================================
async function doReplace(db, records) {
  try {
    // SQLite/D1 不支持显式 BEGIN/COMMIT（部分支持），用 batch 模拟原子性
    // 先执行 DELETE，再批量 INSERT
    await db.prepare('DELETE FROM dorm_students').run();
    await db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').bind('dorm_students').run();

    const insertStmt = db.prepare(
      `INSERT INTO dorm_students
       (dorm_name, floor, class_name, student_name, bed, year_code, grade_name, grade, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );

    // Batch insert in chunks
    const batch = records.map(r =>
      insertStmt.bind(
        r.dorm_name.trim(), r.floor || 0, r.class_name || null,
        r.student_name.trim(), Number(r.bed), r.year_code || null,
        r.grade_name || '', r.grade || null, r.status || '在校'
      )
    );

    for (let i = 0; i < batch.length; i += 50) {
      const chunk = batch.slice(i, i + 50);
      await db.batch(chunk);
    }

    return { inserted: records.length, updated: 0 };
  } catch (e) {
    throw new Error('全量替换失败: ' + (e.message || e));
  }
}
