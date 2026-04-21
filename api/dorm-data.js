// api/dorm-data.js
import { verifyToken } from './auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : null;

  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: '未授权，请重新登录' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
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

    const dormData = {};
    const nameIndex = {};

    students.forEach(student => {
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
        bed: student.bed
      };
    });

    res.status(200).json({ dormData, nameIndex });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}