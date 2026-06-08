// functions/api/_utils.js — 共享 API 工具

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Security response headers (applied to all JSON responses)
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// ============================================
// 数据脱敏 & 角色权限
// ============================================

/**
 * 学生姓名脱敏：保留首字，其余替换为 *
 * 2字: 张*  3字: 张**  4字+: 张***
 */
export function maskName(name) {
  if (!name || typeof name !== 'string' || name.length <= 1) return name || '';
  return name[0] + '*'.repeat(name.length - 1);
}

/**
 * 角色权限检查：role 不在 allowedRoles 中则抛 403
 */
export function requireRole(payload, allowedRoles) {
  const role = payload.role || 'student';
  if (!allowedRoles.includes(role)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

/**
 * 获取客户端 IP
 */
export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

/**
 * 写入系统日志（不抛异常，失败静默忽略）
 */
export async function logSystemAction(env, userInfo, action, targetType, targetId, detail, request) {
  try {
    if (!env || !env.DB) return;
    const ip = request ? getClientIP(request) : 'system';
    const ua = request ? (request.headers.get('User-Agent') || '').slice(0, 200) : '';
    // 脱敏 detail 中的姓名
    const safeDetail = detail ? maskNamesInText(detail) : null;
    await env.DB.prepare(
      `INSERT INTO system_logs (user_id, username, role, action, target_type, target_id, detail, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      userInfo.user_id || null,
      userInfo.username || 'system',
      userInfo.role || 'unknown',
      action,
      targetType || null,
      targetId ? String(targetId) : null,
      safeDetail ? safeDetail.slice(0, 500) : null,
      ip,
      ua
    ).run();
  } catch (e) {
    // 静默失败，不影响主业务
    console.error('logSystemAction failed:', e.message);
  }
}

/**
 * 对文本中疑似姓名的部分做脱敏（简易版：匹配常见中文姓名位置）
 * 主要用于日志 detail 字段
 */
function maskNamesInText(text) {
  if (!text || typeof text !== 'string') return text;
  // 简单策略：对 2-4 个连续中文字符做脱敏
  return text.replace(/[一-龥]{2,4}/g, (match) => {
    // 排除一些常见非姓名词汇
    const nonNames = ['修改', '删除', '创建', '加入', '导出', '查询', '上传', '更新', '成功', '失败',
      '状态', '房间', '数据', '学生', '日志', '宿舍', '班级', '年级', '记录', '导入'];
    if (nonNames.includes(match)) return match;
    return maskName(match);
  });
}

// ============================================
// JWT
// ============================================

function throwError(message, status) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export async function verifyToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  if (!token) {
    throwError('未授权，请重新登录', 401);
  }

  const JWT_SECRET = env.JWT_SECRET;
  if (!JWT_SECRET) {
    throwError('服务器配置错误', 500);
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throwError('Token 格式无效', 401);
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(JWT_SECRET);

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const sigStr = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    const signature = Uint8Array.from(atob(sigStr), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature, data);
    if (!valid) {
      throwError('Token 签名无效', 401);
    }

    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr);

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throwError('Token 已过期，请重新登录', 401);
    }

    return payload;
  } catch (e) {
    if (e.status) throw e;
    throwError('Token 验证失败', 401);
  }
}

function base64UrlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  // Convert UTF-8 bytes to base64 using btoa on binary string
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary)
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function signJWT(payload, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));

  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);

  // 对二进制签名直接 btoa，不走 base64UrlEncode（避免 TextEncoder UTF-8 二次编码膨胀）
  const signatureBytes = new Uint8Array(signature);
  const signatureB64 = btoa(String.fromCharCode(...signatureBytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// ============================================
// 密码哈希（PBKDF2，Web Crypto API）
// ============================================

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `${saltB64}$${hash}`;
}

export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 2) return false;
  const [saltB64, hash] = parts;
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const computedHash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return hash === computedHash;
}

// ============================================
// D1 防御性守卫
// ============================================

export function dbGuard(env) {
  if (!env || !env.DB) {
    const err = new Error('数据库服务暂未开通，请稍后重试');
    err.status = 503;
    throw err;
  }
}

// ============================================
// 响应模板
// ============================================

export function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { status, headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' } }
  );
}

export function errorResponse(message, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, ...securityHeaders, 'Content-Type': 'application/json' } }
  );
}

export function handleOptions(allowedMethods = 'GET, POST, PUT, OPTIONS') {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// 包装器：将 throw Error (with .status) 转换为 JSON error response
export function withErrorGuard(handler) {
  return async function(context) {
    try {
      return await handler(context);
    } catch (e) {
      if (e instanceof Response) return e;
      const status = e.status || 500;
      const message = e.message || '服务器内部错误';
      return errorResponse(message, status);
    }
  };
}
