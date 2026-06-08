// functions/api/settings.js
// v20: 系统设置管理 — access password, sensitive word stats
// 路由: /api/settings?action=... (query-param based for Pages Functions compatibility)

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole, logSystemAction,
} from './_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('GET, POST, PUT, OPTIONS');
  dbGuard(env);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // ============================================
  // POST /api/settings?action=verify-access-password （无需认证，公开接口）
  // ============================================
  if (request.method === 'POST' && action === 'verify-access-password') {
    let body;
    try { body = await request.json(); } catch (e) {
      return errorResponse('请求格式错误', 400);
    }
    const { password } = body;
    if (!password) return errorResponse('缺少 password 参数', 400);

    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'access_password'"
    ).first();

    const valid = setting && setting.value === password;
    return jsonResponse({ valid });
  }

  // ============================================
  // 以下接口需要 admin 认证
  // ============================================
  const payload = await verifyToken(request, env);
  requireRole(payload, ['admin']);

  // ============================================
  // GET /api/settings?action=sensitive-words-stats
  // ============================================
  if (request.method === 'GET' && action === 'sensitive-words-stats') {
    const version = await env.DB.prepare(
      "SELECT value, updated_at FROM settings WHERE key = 'sensitive_words_version'"
    ).first();

    let total = '--';
    try {
      if (env.SENSITIVE_WORDS) {
        const wordsText = await env.SENSITIVE_WORDS.get('sensitive_words', 'text');
        if (wordsText) {
          total = String(wordsText.split('\n').filter(w => w.trim()).length);
        }
      }
    } catch (e) { /* KV not configured yet */ }

    return jsonResponse({
      total,
      supplement: 17,
      updated_at: version ? version.updated_at : '--',
    });
  }

  // ============================================
  // PUT /api/settings?action=access-password
  // ============================================
  if ((request.method === 'PUT' || request.method === 'POST') && action === 'access-password') {
    let body;
    try { body = await request.json(); } catch (e) {
      return errorResponse('请求格式错误', 400);
    }
    const { password } = body;
    if (!password || !/^\d{4}$/.test(password)) {
      return errorResponse('密码必须为4位数字', 400);
    }

    await env.DB.prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES ('access_password', ?, datetime('now'))`
    ).bind(password).run();

    await logSystemAction(env,
      { user_id: payload.user_id, username: payload.username, role: payload.role },
      'settings_change', 'settings', 'access_password', '更新访问密码', request
    );

    return jsonResponse({ message: '访问密码已更新' });
  }

  return errorResponse('未知的 action 参数', 400);
});
