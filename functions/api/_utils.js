// functions/api/_utils.js — 共享 API 工具

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ============================================
// JWT
// ============================================

export async function verifyToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  if (!token) {
    throw errorResponse('未授权，请重新登录', 401);
  }

  const JWT_SECRET = env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw errorResponse('服务器配置错误', 500);
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw errorResponse('Token 格式无效', 401);
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
      throw errorResponse('Token 签名无效', 401);
    }

    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr);

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw errorResponse('Token 已过期，请重新登录', 401);
    }

    return payload;
  } catch (e) {
    if (e instanceof Response) throw e;
    throw errorResponse('Token 验证失败', 401);
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
  const signatureB64 = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

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
    throw errorResponse('数据库服务暂未开通，请联系管理员在 Cloudflare Dashboard 绑定 D1', 503);
  }
}

// ============================================
// 响应模板
// ============================================

export function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

export function errorResponse(message, status = 400) {
  return new Response(
    JSON.stringify({ success: false, message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

export function handleOptions(allowedMethods = 'GET, POST, OPTIONS') {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
