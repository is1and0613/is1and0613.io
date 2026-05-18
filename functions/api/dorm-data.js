// functions/api/dorm-data.js

import { jsonResponse, errorResponse, handleOptions, verifyToken, withErrorGuard } from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return handleOptions('GET, OPTIONS');
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // JWT 校验
  try {
    await verifyToken(request, context.env);
  } catch (e) {
    return e;
  }

  const supabaseUrl = context.env.SUPABASE_URL;
  const supabaseKey = context.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return errorResponse('Server configuration error', 500);
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/students?select=*`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase API error: ${response.status}`);
    }

    const students = await response.json();

    const dormData = {};
    const nameIndex = {};

    students.forEach((student) => {
      if (!dormData[student.grade]) dormData[student.grade] = {};
      if (!dormData[student.grade][student.class_name]) dormData[student.grade][student.class_name] = {};
      if (!dormData[student.grade][student.class_name][student.dorm]) {
        dormData[student.grade][student.class_name][student.dorm] = [null, null, null, null];
      }
      dormData[student.grade][student.class_name][student.dorm][student.bed - 1] = student.name;

      nameIndex[student.name] = {
        grade: student.grade,
        className: student.class_name,
        dorm: student.dorm,
        bed: student.bed,
      };
    });

    return jsonResponse({ dormData, nameIndex });
  } catch (error) {
    console.error('API Error:', error);
    return errorResponse('Internal server error', 500);
  }
});
