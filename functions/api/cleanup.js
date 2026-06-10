// functions/api/cleanup.js
// 日志清理 API：支持 JWT 鉴权（admin 手动点击）和 Secret Key（GitHub Actions 自动任务）
// system_logs / login_logs 保留 3 天，room_messages 保留 7 天，inactive rooms 保留 7 天

import {
  jsonResponse, errorResponse, handleOptions, verifyToken, corsHeaders, securityHeaders,
} from './_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let isAuthorized = false;

  // 方式1：JWT 鉴权（admin 手动点击）
  try {
    const payload = await verifyToken(request, env);
    if (payload.role === 'admin') {
      isAuthorized = true;
    }
  } catch (e) {
    // JWT 验证失败，继续检查 secret
  }

  // 方式2：Secret Key 鉴权（GitHub Actions 自动任务）
  if (!isAuthorized) {
    const cleanupSecret = request.headers.get('X-Cleanup-Secret') || '';
    if (cleanupSecret && env.CLEANUP_SECRET && cleanupSecret === env.CLEANUP_SECRET) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return errorResponse('Unauthorized', 401);
  }

  const db = env.DB;
  if (!db) {
    return errorResponse('数据库不可用', 503);
  }

  const results = {};

  // 1. 清理操作日志：保留最近 3 天
  try {
    const systemLogs = await db.prepare(
      `DELETE FROM system_logs WHERE created_at < datetime('now', '-3 days')`
    ).run();
    results.system_logs_deleted = systemLogs.meta?.changes || 0;
  } catch (e) {
    results.system_logs_deleted = 0;
    results.system_logs_error = e.message;
  }

  // 2. 清理登录日志：保留最近 3 天
  try {
    const loginLogs = await db.prepare(
      `DELETE FROM login_logs WHERE login_at < datetime('now', '-3 days')`
    ).run();
    results.login_logs_deleted = loginLogs.meta?.changes || 0;
  } catch (e) {
    results.login_logs_deleted = 0;
    results.login_logs_error = e.message;
  }

  // 3. 清理聊天记录：保留最近 7 天
  try {
    const roomMessages = await db.prepare(
      `DELETE FROM room_messages WHERE created_at < datetime('now', '-7 days')`
    ).run();
    results.room_messages_deleted = roomMessages.meta?.changes || 0;
  } catch (e) {
    results.room_messages_deleted = 0;
    results.room_messages_error = e.message;
  }

  // 4. 清理已关闭房间：inactive 超过 7 天
  try {
    const rooms = await db.prepare(
      `DELETE FROM rooms WHERE status = 'inactive' AND updated_at < datetime('now', '-7 days')`
    ).run();
    results.inactive_rooms_deleted = rooms.meta?.changes || 0;
  } catch (e) {
    results.inactive_rooms_deleted = 0;
    results.inactive_rooms_error = e.message;
  }

  return jsonResponse({
    cleaned_at: new Date().toISOString(),
    ...results,
  });
}

// OPTIONS 预检
export async function onRequestOptions() {
  return handleOptions('POST, OPTIONS');
}
