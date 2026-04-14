// api/dorm-data.js
export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // 直接调用 Supabase REST API
    const response = await fetch(`${supabaseUrl}/rest/v1/students?select=*`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase API error: ${response.status}`);
    }

    const students = await response.json();

    // 重建前端需要的 dormData 结构
    const dormData = {};
    const nameIndex = {};

    students.forEach(student => {
      // 构建 dormData
      if (!dormData[student.grade]) {
        dormData[student.grade] = {};
      }
      if (!dormData[student.grade][student.class_name]) {
        dormData[student.grade][student.class_name] = {};
      }
      if (!dormData[student.grade][student.class_name][student.dorm]) {
        dormData[student.grade][student.class_name][student.dorm] = [null, null, null, null];
      }
      dormData[student.grade][student.class_name][student.dorm][student.bed - 1] = student.name;

      // 构建 nameIndex
      nameIndex[student.name] = {
        grade: student.grade,
        className: student.class_name,
        dorm: student.dorm,
        bed: student.bed
      };
    });

    res.status(200).json({ dormData, nameIndex });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}