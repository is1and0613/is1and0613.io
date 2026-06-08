// functions/api/dorm-data.js
// 宿舍数据查询（D1）

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
} from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, OPTIONS');
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const payload = await verifyToken(request, context.env);
  dbGuard(context.env);

  const { results: students } = await context.env.DB.prepare(`
    SELECT
      ds.dorm_name,
      ds.floor,
      ds.class_name,
      ds.student_name,
      ds.bed,
      ds.year_code,
      ds.grade_name,
      ds.status,
      gm.display_order
    FROM dorm_students ds
    LEFT JOIN grade_mapping gm ON ds.year_code = gm.year_code
    WHERE ds.status = '在校' OR ds.status = '空床'
    ORDER BY gm.display_order, ds.dorm_name, ds.bed
  `).all();

  const dormData = {};
  const nameIndex = {};

  // v20: 同时构建扁平化学生列表供管理后台使用
  const studentsFlat = [];

  for (const student of students) {
    // 构造 grade key：前端期望 "2022级" 格式
    const grade = student.year_code
      ? '20' + student.year_code + '级'
      : (student.grade_name ? student.grade_name : '其他');
    const className = student.class_name || '';
    const dorm = student.dorm_name;
    const bed = student.bed;
    const name = student.student_name;

    if (!dormData[grade]) dormData[grade] = {};
    if (!dormData[grade][className]) dormData[grade][className] = {};
    if (!dormData[grade][className][dorm]) {
      dormData[grade][className][dorm] = [null, null, null, null];
    }

    if (name && bed && bed >= 1 && bed <= 4) {
      dormData[grade][className][dorm][bed - 1] = name;
      nameIndex[name] = {
        grade,
        className,
        dorm,
        bed,
      };
    }

    // 构建扁平记录
    studentsFlat.push({
      id: student.dorm_name + '_' + student.bed,
      dorm_name: student.dorm_name,
      floor: student.floor,
      student_name: student.student_name,
      bed: student.bed,
      class_name: student.class_name || '',
      grade: grade,
      grade_name: student.grade_name || '',
      status: student.status || '在校',
      year_code: student.year_code,
      display_order: student.display_order,
    });
  }

  return jsonResponse({ dormData, nameIndex, students: studentsFlat });
});
