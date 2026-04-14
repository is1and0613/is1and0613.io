// api/dorm-data.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 从数据库查询所有学生
    const { data: students, error } = await supabase
      .from('students')
      .select('*')
      .order('grade', { ascending: false })
      .order('class_name')
      .order('dorm')
      .order('bed');

    if (error) throw error;

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