// functions/api/admin/rooms.js
// v20: 管理员房间监控 — 列出所有房间及状态

import {
  jsonResponse, errorResponse, handleOptions,
  verifyToken, dbGuard, withErrorGuard,
  requireRole,
} from '../_utils.js';

export const onRequest = withErrorGuard(async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions('GET, OPTIONS');
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  dbGuard(env);

  const payload = await verifyToken(request, env);
  requireRole(payload, ['admin']);

  const db = env.DB;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'detail') {
    const roomId = url.searchParams.get('id');
    if (!roomId) return errorResponse('缺少 room id', 400);

    const room = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return errorResponse('房间不存在', 404);

    const states = await db.prepare(
      'SELECT * FROM room_states WHERE room_id = ? ORDER BY dorm_number, bed_number'
    ).bind(roomId).all();

    const logs = await db.prepare(
      `SELECT rl.*, u.username, u.display_name
       FROM room_logs rl LEFT JOIN users u ON rl.user_id = u.id
       WHERE rl.room_id = ? ORDER BY rl.created_at DESC LIMIT 100`
    ).bind(roomId).all();

    const members = await db.prepare(
      `SELECT rm.*, u.username, u.display_name
       FROM room_members rm LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.room_id = ?`
    ).bind(roomId).all();

    const messages = await db.prepare(
      `SELECT rm.*, u.username, u.display_name
       FROM room_messages rm LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.room_id = ? ORDER BY rm.created_at DESC LIMIT 50`
    ).bind(roomId).all();

    return jsonResponse({
      room,
      states: states.results,
      logs: logs.results,
      members: members.results,
      messages: messages.results,
    });
  }

  // 清理过期超过 7 天的房间（保留 7 天防误伤）
  try {
    await db.prepare(
      "DELETE FROM rooms WHERE status = 'expired' AND expires_at < datetime('now', '-7 days')"
    ).run();
  } catch (e) { /* 清理失败不影响查询 */ }

  const { results: rooms } = await db.prepare(
    `SELECT r.*,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT COUNT(*) FROM room_states WHERE room_id = r.id) as student_count
     FROM rooms r
     WHERE r.status = 'active'
     ORDER BY r.created_at DESC
     LIMIT 100`
  ).all();

  const creatorIds = [...new Set(rooms.filter(r => r.creator_id).map(r => r.creator_id))];
  const creatorNames = {};
  if (creatorIds.length) {
    const users = await db.prepare(
      `SELECT id, username, display_name FROM users WHERE id IN (${creatorIds.join(',')})`
    ).all();
    for (const u of users.results) {
      creatorNames[u.id] = u.display_name || u.username;
    }
  }

  const enrichedRooms = rooms.map(r => ({
    ...r,
    creator_name: creatorNames[r.creator_id] || String(r.creator_id),
  }));

  let totalStudents = 0;
  try {
    const countResult = await db.prepare(
      "SELECT COUNT(*) as count FROM dorm_students WHERE status = '在校'"
    ).first();
    totalStudents = countResult ? countResult.count : 0;
  } catch (e) { /* ignore */ }

  return jsonResponse({
    rooms: enrichedRooms,
    total_students: totalStudents,
  });
});
