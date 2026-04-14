export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ success: false, message: '请输入密码' });
    }

    const correctPassword = process.env.ADMIN_PASSWORD;

    if (!correctPassword) {
      console.error('ADMIN_PASSWORD 环境变量未设置');
      return res.status(500).json({ success: false, message: '服务器配置错误' });
    }

    if (password === correctPassword) {
      return res.status(200).json({ success: true, message: '登录成功' });
    } else {
      return res.status(401).json({ success: false, message: '密码错误' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}