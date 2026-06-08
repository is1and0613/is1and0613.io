// functions/api/auth.js
// D1-based auth: login / register with PBKDF2 password hashing
// v20: role-based JWT, login audit, password change

import {
  jsonResponse, errorResponse, handleOptions,
  verifyPassword, hashPassword, signJWT, dbGuard,
  withErrorGuard, getClientIP, logSystemAction,
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
    `INSERT INTO users (username, password_hash, display_name, is_temp, role, last_login_at)
     VALUES (?, ?, '临时账户', 1, 'admin', datetime('now'))`
  ).bind(TEMP_USERNAME, hash).run();
}

async function logLoginAttempt(env, userId, username, status, failReason, ip, ua) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare(
      `INSERT INTO login_logs (user_id, username, role, login_at, ip, user_agent, status, fail_reason)
       VALUES (?, ?, (SELECT role FROM users WHERE id = ?), datetime('now'), ?, ?, ?, ?)`
    ).bind(userId, username, userId, ip, (ua || '').slice(0, 200), status, failReason || null).run();
  } catch (e) {
    console.error('logLoginAttempt failed:', e.message);
  }
}

async function handleChangePassword(env, username, password, body, request) {
  const { old_password, new_password } = body;
  if (!old_password || !new_password) {
    return errorResponse('缺少原密码或新密码', 400);
  }
  if (new_password.length < 6 || new_password.length > 30) {
    return errorResponse('密码长度需在 6-30 个字符之间', 400);
  }

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(username).first();
  if (!user) {
    return errorResponse('用户不存在', 404);
  }

  const valid = await verifyPassword(old_password, user.password_hash);
  if (!valid) {
    return errorResponse('原密码错误', 401);
  }

  const newHash = await hashPassword(new_password);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ? WHERE id = ?"
  ).bind(newHash, user.id).run();

  await logSystemAction(env,
    { user_id: user.id, username, role: user.role || 'inspector' },
    'password_change', 'user', String(user.id), '修改密码', request
  );

  return jsonResponse({ message: '密码修改成功' });
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

  // change_password uses token auth, not username/password
  if (action === 'change_password') {
    const { verifyToken } = await import('./_utils.js');
    try {
      const payload = await verifyToken(request, env);
      return handleChangePassword(env, payload.username, password, body, request);
    } catch (e) {
      return errorResponse('未授权', 401);
    }
  }

  if (!username || !password) {
    return errorResponse('用户名和密码不能为空', 400);
  }

  // Ensure temp account exists on first request
  await ensureTempAccount(env);

  switch (action) {
    case 'login':
      return handleLogin(env, username, password, request);
    case 'register':
      return handleRegister(env, username, password, request);
    default:
      return errorResponse('无效的 action，请使用 login 或 register', 400);
  }
});

async function handleLogin(env, username, password, request) {
  try {
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).bind(username).first();

    const ip = getClientIP(request);
    const ua = request.headers.get('User-Agent') || '';

    if (!user) {
      await logLoginAttempt(env, null, username, 'failed', '用户不存在', ip, ua);
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
          await logLoginAttempt(env, user.id, username, 'failed', '账户过期', ip, ua);
          return errorResponse('账户已过期（30天未登录），请重新注册', 401);
        }
      }
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await logLoginAttempt(env, user.id, username, 'failed', '密码错误', ip, ua);
      return errorResponse('用户名或密码错误', 401);
    }

    const role = user.role || 'inspector';

    // 更新最后登录信息
    await env.DB.prepare(
      "UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?"
    ).bind(ip, user.id).run();

    // 记录成功登录
    await logLoginAttempt(env, user.id, username, 'success', null, ip, ua);

    // 记录系统日志
    await logSystemAction(env,
      { user_id: user.id, username, role },
      'login_success', 'user', String(user.id), '登录成功', request
    );

    const token = await signJWT(
      {
        user_id: user.id,
        username: user.username,
        display_name: user.display_name || user.username,
        role: role,
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
        role: role,
      },
    });
  } catch (e) {
    return errorResponse('登录异常', 500);
  }
}

async function handleRegister(env, username, password, request) {
  if (username.length < 3 || username.length > 20) {
    return errorResponse('用户名长度需在 3-20 个字符之间', 400);
  }
  if (password.length < 6 || password.length > 30) {
    return errorResponse('密码长度需在 6-30 个字符之间', 400);
  }
  if (!/^[a-zA-Z0-9_一-龥]+$/.test(username)) {
    return errorResponse('用户名只能包含中英文、数字和下划线', 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();
  if (existing) {
    return errorResponse('用户名已被注册', 409);
  }

  const hash = await hashPassword(password);
  const name = username; // display_name defaults to username
  const role = 'inspector'; // new users default to inspector

  const result = await env.DB.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, last_login_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(username, hash, name, role).run();

  const userId = result.meta.last_row_id;

  const token = await signJWT(
    {
      user_id: userId,
      username,
      display_name: name,
      role: role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    },
    env.JWT_SECRET
  );

  const ip = getClientIP(request);
  const ua = request.headers.get('User-Agent') || '';
  await logLoginAttempt(env, userId, username, 'success', null, ip, ua);

  return jsonResponse({
    message: '注册成功',
    token,
    user: {
      id: userId,
      username,
      display_name: name,
      role: role,
    },
  }, 201);
}
