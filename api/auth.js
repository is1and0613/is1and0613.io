// api/auth.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { password } = req.body || {};
  const correctPassword = process.env.ADMIN_PASSWORD;

  if (!correctPassword) {
    console.error('ADMIN_PASSWORD 环境变量未设置');
    return res.status(500).json({ success: false, message: '服务器配置错误' });
  }

  if (password === correctPassword) {
    const token = jwt.sign(
      { 
        authenticated: true,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    
    return res.status(200).json({ 
      success: true, 
      message: '登录成功',
      token: token
    });
  } else {
    return res.status(401).json({ success: false, message: '密码错误' });
  }
}

export function verifyToken(token) {
  if (!token || !JWT_SECRET) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded && decoded.authenticated === true;
  } catch (error) {
    return false;
  }
}