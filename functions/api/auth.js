// functions/api/auth.js
// D1-based auth: login / register with PBKDF2 password hashing

import {
  jsonResponse, errorResponse, handleOptions,
  verifyPassword, hashPassword, signJWT, dbGuard,
  withErrorGuard,
} from './_utils.js';

const TEMP_USERNAME = 'chaqin';
const TEMP_PASSWORD = '123456';

async function ensureTempAccount(env) {
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(TEMP_USERNAME).first();
  if (existing) return;
  const hash = await hashPassword(TEMP_PASSWORD);
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, display_name, is_temp, last_login_at)
     VALUES (?, ?, '临时账户', 1, datetime('now'))`
  ).bind(TEMP_USERNAME, hash).run();
}

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handleOptions('POST, OPTIONS');
  }

  if (request.method !== 'POST') {
    return errorResponse('Method Not Allowed', 405);
  }

  dbGuard(env);

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('请求格式错误', 400);
  }

  const { action, username, password } = body;

  if (!username || !password) {
    return errorResponse('用户名和密码不能为空', 400);
  }

  // Ensure temp account exists on first request
  await ensureTempAccount(env);

  switch (action) {
    case 'login':
      return handleLogin(env, username, password);
    case 'register':
      return handleRegister(env, username, password);
    default:
      return errorResponse('无效的 action，请使用 login 或 register', 400);
  }
});

async function handleLogin(env, username, password) {
  try {
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) {
    return errorResponse('用户名或密码错误', 401);
  }

  // Lazy expiry: non-temp accounts inactive for 30 days are deleted
  if (!user.is_temp) {
    const lastLogin = user.last_login_at;
    if (lastLogin) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      if (new Date(lastLogin + 'Z') < cutoff) {
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
        return errorResponse('账户已过期（30天未登录），请重新注册', 401);
      }
    }
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return errorResponse('用户名或密码错误', 401);
  }

  await env.DB.prepare(
    "UPDATE users SET last_login_at = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  const token = await signJWT(
    {
      user_id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
    env.JWT_SECRET
  );

  return jsonResponse({
    message: '登录成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
    },
  });
  } catch (e) {
    return errorResponse('登录异常: ' + (e.message || e), 500);
  }
}

async function handleRegister(env, username, password, displayName) {
  // Validation
  if (username.length < 3 || username.length > 20) {
    return errorResponse('用户名长度需在 3-20 个字符之间', 400);
  }
  if (password.length < 6 || password.length > 30) {
    return errorResponse('密码长度需在 6-30 个字符之间', 400);
  }
  if (!/^[a-zA-Z0-9_一-鿿]+$/.test(username)) {
    return errorResponse('用户名只能包含中英文、数字和下划线', 400);
  }

  // Check uniqueness
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();
  if (existing) {
    return errorResponse('用户名已被注册', 409);
  }

  const hash = await hashPassword(password);
  const name = displayName || username;

  const result = await env.DB.prepare(
    `INSERT INTO users (username, password_hash, display_name, last_login_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(username, hash, name).run();

  const userId = result.meta.last_row_id;

  const token = await signJWT(
    {
      user_id: userId,
      username,
      display_name: name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
    env.JWT_SECRET
  );

  return jsonResponse({
    message: '注册成功',
    token,
    user: {
      id: userId,
      username,
      display_name: name,
    },
  }, 201);
}
