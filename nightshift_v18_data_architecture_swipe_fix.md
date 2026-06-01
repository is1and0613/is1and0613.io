# NIGHTSHIFT 查寝系统 — 数据存储架构改造 + 滑动方向修正

> **版本**: v18  
> **日期**: 2026-06-01  
> **目标**: 单人查寝数据按账号持久化（跨设备同步），多人查寝数据按房间持久化（协同共享）；修正卡片式滑动方向。

---

## 一、数据存储架构改造

### 1.1 核心原则

| 模式 | 存储维度 | 数据归属 | 同步范围 |
|------|---------|---------|---------|
| **单人查寝** | 按 `user_id`（账号） | 该用户所有历史查寝记录 | 同一账号跨设备同步 |
| **多人查寝** | 按 `room_id`（房间码） | 该房间内所有成员的查寝状态 | 同一房间内所有成员实时同步 |

**现状问题**：数据目前大概率存在 `localStorage` 或 IndexedDB 中，导致：
- 换设备登录同一账号，查寝记录丢失。
- 多人查寝时，房主和成员的数据各自为政，无法真正协同。

---

### 1.2 数据库表设计（D1）

#### A. 单人查寝记录表 `single_check_records`

```sql
CREATE TABLE IF NOT EXISTS single_check_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,           -- 账号维度：谁查的
  check_date TEXT NOT NULL,        -- 查寝日期，如 "2026-06-01"
  dorm_id TEXT NOT NULL,           -- 宿舍号，如 "505"
  student_id TEXT NOT NULL,        -- 学生标识（学号或姓名+班级）
  student_name TEXT NOT NULL,
  grade TEXT,                      -- 年级，如 "2025"
  major TEXT,                      -- 专业，如 "网安"
  class_name TEXT,                 -- 班级，如 "2501"
  bed_number TEXT,                 -- 床号
  status TEXT NOT NULL,            -- 状态：in/out/leave/away/missing
  reason TEXT,                     -- 事由（如 "工作室"、"篮球队"）
  reason_detail TEXT,              -- 具体事由细分（如 "网安"、"数分"）
  created_at INTEGER NOT NULL,    -- 首次记录时间戳
  updated_at INTEGER NOT NULL,    -- 最后更新时间戳
  UNIQUE(user_id, check_date, student_id)  -- 同一用户同一天同一学生唯一记录
);

-- 索引：加速按用户+日期查询
CREATE INDEX IF NOT EXISTS idx_single_user_date ON single_check_records(user_id, check_date);
-- 索引：加速按用户+宿舍查询
CREATE INDEX IF NOT EXISTS idx_single_user_dorm ON single_check_records(user_id, dorm_id);
```

#### B. 多人查寝记录表 `room_check_records`

```sql
CREATE TABLE IF NOT EXISTS room_check_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,           -- 房间维度：哪个房间
  student_id TEXT NOT NULL,        -- 学生标识
  student_name TEXT NOT NULL,
  dorm_id TEXT NOT NULL,           -- 宿舍号
  grade TEXT,
  major TEXT,
  class_name TEXT,
  bed_number TEXT,
  status TEXT NOT NULL,            -- 状态
  reason TEXT,
  reason_detail TEXT,
  updated_by TEXT NOT NULL,        -- 最后修改者 user_id（用于审计）
  updated_by_name TEXT,            -- 修改者姓名（显示用）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(room_id, student_id)      -- 同一房间同一学生唯一记录
);

-- 索引：加速按房间查询
CREATE INDEX IF NOT EXISTS idx_room_records ON room_check_records(room_id, updated_at);
```

#### C. 房间元信息表 `rooms`（已有则更新字段）

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,       -- 6位房间码
  owner_id TEXT NOT NULL,          -- 房主 user_id
  owner_name TEXT,                 -- 房主姓名
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,     -- 过期时间（2天后）
  status TEXT DEFAULT 'active',    -- active / expired / closed
  member_count INTEGER DEFAULT 1   -- 成员数（含房主）
);
```

#### D. 房间成员表 `room_members`（用于权限管理和实时通知）

```sql
CREATE TABLE IF NOT EXISTS room_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  joined_at INTEGER NOT NULL,
  role TEXT DEFAULT 'member',      -- owner / member
  UNIQUE(room_id, user_id)
);
```

---

### 1.3 前端数据流改造

#### 单人查寝模式

**写入逻辑（状态变更时实时上云）**：
```javascript
// 当用户点击某个学生的状态标签（如在寝→离校）时
async function updateStudentStatus(studentId, newStatus, reason, reasonDetail) {
  const token = localStorage.getItem('token');
  const checkDate = getTodayDate(); // "2026-06-01"

  // 1. 先更新本地 UI（即时反馈）
  updateLocalUI(studentId, newStatus);

  // 2. 异步写入 D1（后台同步）
  try {
    const res = await fetch('/api/single-check/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        checkDate,
        studentId,
        status: newStatus,
        reason,
        reasonDetail,
        dormId: currentDormId,
        studentName: studentName,
        grade: studentGrade,
        major: studentMajor,
        className: studentClass,
        bedNumber: studentBed
      })
    });

    if (!res.ok) throw new Error('同步失败');

    // 3. 更新本地缓存时间戳，标记已同步
    markSynced(studentId);
  } catch (err) {
    console.error('单人查寝同步失败', err);
    // 4. 失败时标记为待同步，下次网络恢复时重试
    markPending(studentId);
    showToast('网络异常，已标记待同步');
  }
}
```

**读取逻辑（页面加载时从云端拉取）**：
```javascript
// 页面初始化时
async function loadSingleCheckData() {
  const token = localStorage.getItem('token');
  const checkDate = getTodayDate();

  try {
    const res = await fetch(`/api/single-check/list?date=${checkDate}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { records } = await res.json();

    // 合并云端数据到本地状态
    // 策略：云端为准，本地未同步的 pending 记录覆盖云端
    mergeRecords(records);
  } catch (err) {
    console.error('拉取单人查寝数据失败', err);
    // 降级：使用本地缓存
    loadFromLocalCache();
  }
}

// 合并策略：云端记录 vs 本地 pending 记录
function mergeRecords(cloudRecords) {
  const pendingRecords = getPendingRecords(); // 本地未同步的变更

  // 以云端为基础
  const merged = { ...cloudRecords };

  // 本地 pending 记录覆盖（因为用户最新操作优先）
  pendingRecords.forEach(r => {
    merged[r.studentId] = r;
  });

  // 渲染到 UI
  renderStudents(merged);
}
```

**API 端点（后端）**：
```javascript
// functions/api/single-check/update.js
export async function onRequestPost(context) {
  const { request, env } = context;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  // 1. 验证 JWT，提取 user_id
  const { userId } = await verifyJWT(token, env.JWT_SECRET);

  // 2. 解析请求体
  const body = await request.json();
  const { checkDate, studentId, status, reason, reasonDetail, dormId, ...studentInfo } = body;

  // 3. UPSERT：存在则更新，不存在则插入
  await env.DB.prepare(`
    INSERT INTO single_check_records 
    (user_id, check_date, student_id, student_name, grade, major, class_name, bed_number, dorm_id, status, reason, reason_detail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, check_date, student_id) DO UPDATE SET
    status = excluded.status,
    reason = excluded.reason,
    reason_detail = excluded.reason_detail,
    dorm_id = excluded.dorm_id,
    updated_at = excluded.updated_at
  `).bind(
    userId, checkDate, studentId, studentInfo.studentName, studentInfo.grade, 
    studentInfo.major, studentInfo.className, studentInfo.bedNumber, dormId,
    status, reason, reasonDetail, Date.now(), Date.now()
  ).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// functions/api/single-check/list.js
export async function onRequestGet(context) {
  const { request, env } = context;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const { userId } = await verifyJWT(token, env.JWT_SECRET);

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || getTodayDate();

  const { results } = await env.DB.prepare(`
    SELECT * FROM single_check_records 
    WHERE user_id = ? AND check_date = ?
    ORDER BY dorm_id, student_name
  `).bind(userId, date).all();

  return new Response(JSON.stringify({ records: results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

#### 多人查寝模式

**写入逻辑（状态变更写入房间维度）**：
```javascript
async function updateRoomStudentStatus(roomId, studentId, newStatus, reason, reasonDetail) {
  const token = localStorage.getItem('token');
  const userId = getUserIdFromToken(token);
  const userName = getUserName();

  // 1. 本地即时更新
  updateLocalUI(studentId, newStatus);

  // 2. 写入 D1（按 room_id 维度）
  try {
    const res = await fetch('/api/room-check/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        roomId,
        studentId,
        status: newStatus,
        reason,
        reasonDetail,
        updatedBy: userId,
        updatedByName: userName
      })
    });

    if (!res.ok) throw new Error('房间同步失败');

    // 3. 触发 WebSocket / 轮询广播，通知其他成员
    // 如果已实现 WebSocket，发送消息；否则依赖轮询
  } catch (err) {
    markRoomPending(roomId, studentId);
    showToast('协同同步失败，已标记待同步');
  }
}
```

**读取逻辑（进入房间时拉取全量数据）**：
```javascript
async function loadRoomCheckData(roomId) {
  const token = localStorage.getItem('token');

  try {
    const res = await fetch(`/api/room-check/list?roomId=${roomId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { records } = await res.json();

    // 渲染房间数据
    renderRoomStudents(records);
  } catch (err) {
    loadFromLocalCache();
  }
}

// 实时同步：轮询或 WebSocket
function startRoomSync(roomId) {
  // 方案 A：轮询（简单实现）
  setInterval(async () => {
    const res = await fetch(`/api/room-check/list?roomId=${roomId}&since=${lastSyncTime}`);
    const { updates } = await res.json();
    if (updates.length > 0) {
      applyUpdates(updates); // 增量更新 UI
      lastSyncTime = Date.now();
    }
  }, 3000); // 每 3 秒轮询一次

  // 方案 B：WebSocket（更实时，需额外实现）
  // const ws = new WebSocket(`wss://niteshift.cn/ws/room/${roomId}`);
  // ws.onmessage = (event) => applyUpdates(JSON.parse(event.data));
}
```

**API 端点（后端）**：
```javascript
// functions/api/room-check/update.js
export async function onRequestPost(context) {
  const { request, env } = context;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const { userId } = await verifyJWT(token, env.JWT_SECRET);

  const body = await request.json();
  const { roomId, studentId, status, reason, reasonDetail, updatedBy, updatedByName } = body;

  // 1. 验证用户是否在该房间中
  const member = await env.DB.prepare(`
    SELECT * FROM room_members WHERE room_id = ? AND user_id = ?
  `).bind(roomId, userId).first();

  if (!member) {
    return new Response(JSON.stringify({ error: '不在该房间中' }), { status: 403 });
  }

  // 2. 获取学生信息（从 rooms 关联的学生名单或本地缓存）
  // 如果学生信息不在请求中，需要从本地名单补充

  // 3. UPSERT 到 room_check_records
  await env.DB.prepare(`
    INSERT INTO room_check_records 
    (room_id, student_id, status, reason, reason_detail, updated_by, updated_by_name, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_id, student_id) DO UPDATE SET
    status = excluded.status,
    reason = excluded.reason,
    reason_detail = excluded.reason_detail,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name,
    updated_at = excluded.updated_at
  `).bind(roomId, studentId, status, reason, reasonDetail, updatedBy, updatedByName, Date.now(), Date.now()).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// functions/api/room-check/list.js
export async function onRequestGet(context) {
  const { request, env } = context;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const { userId } = await verifyJWT(token, env.JWT_SECRET);

  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId');
  const since = parseInt(url.searchParams.get('since') || '0');

  // 验证成员身份
  const member = await env.DB.prepare(`
    SELECT * FROM room_members WHERE room_id = ? AND user_id = ?
  `).bind(roomId, userId).first();
  if (!member) return new Response(JSON.stringify({ error: '无权访问' }), { status: 403 });

  const { results } = await env.DB.prepare(`
    SELECT * FROM room_check_records 
    WHERE room_id = ? AND updated_at > ?
    ORDER BY dorm_id, student_name
  `).bind(roomId, since).all();

  return new Response(JSON.stringify({ records: results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

### 1.4 离线缓存策略（可选但推荐）

```javascript
// 使用 IndexedDB 做本地缓存，Service Worker 做离线支持
const DB_NAME = 'NightShiftCache';
const DB_VERSION = 1;

async function initLocalDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // 单人查寝缓存
      db.createObjectStore('single_pending', { keyPath: 'studentId' });
      db.createObjectStore('single_cache', { keyPath: 'studentId' });
      // 多人查寝缓存
      db.createObjectStore('room_pending', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('room_cache', { keyPath: 'studentId' });
    };
  });
}

// 网络恢复时批量同步 pending 记录
async function syncPendingRecords() {
  const db = await initLocalDB();

  // 同步单人 pending
  const singlePending = await db.transaction('single_pending').objectStore('single_pending').getAll();
  for (const record of singlePending) {
    await updateStudentStatus(record.studentId, record.status, record.reason, record.reasonDetail);
    await db.transaction('single_pending', 'readwrite').objectStore('single_pending').delete(record.studentId);
  }

  // 同步多人 pending
  const roomPending = await db.transaction('room_pending').objectStore('room_pending').getAll();
  for (const record of roomPending) {
    await updateRoomStudentStatus(record.roomId, record.studentId, record.status, record.reason, record.reasonDetail);
    await db.transaction('room_pending', 'readwrite').objectStore('room_pending').delete(record.id);
  }
}

// 监听网络恢复
window.addEventListener('online', syncPendingRecords);
```

---

## 二、滑动方向修正

### 2.1 问题

当前逻辑：
- 手指**向左滑动** → 上一间（index - 1）
- 手指**向右滑动** → 下一间（index + 1）

这与主流移动端交互习惯相反（如抖音、小红书、相册等）：
- 手指**向左滑动** → 内容向左移 → 显示**右边/下一项**（index + 1）
- 手指**向右滑动** → 内容向右移 → 显示**左边/上一项**（index - 1）

### 2.2 修复

找到 `index.js` 中滑动事件处理代码，交换方向映射：

```javascript
// 修改前（错误）
header.addEventListener('touchend', (e) => {
  const deltaX = endX - startX;
  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > 0) {
      this.navigate(1);  // 向右滑 → 下一间 ❌
    } else {
      this.navigate(-1); // 向左滑 → 上一间 ❌
    }
  }
});

// 修改后（正确）
header.addEventListener('touchend', (e) => {
  const endX = e.changedTouches[0].clientX;
  const endY = e.changedTouches[0].clientY;
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > 0) {
      // 手指向右滑动 → 内容向右移 → 显示左边/上一间
      this.navigate(-1); // 上一间 ✅
    } else {
      // 手指向左滑动 → 内容向左移 → 显示右边/下一间
      this.navigate(1);  // 下一间 ✅
    }
  }
});
```

**视觉反馈同步**：
如果滑动时有动画（如卡片平移），确保动画方向与逻辑一致：
- 手指向左滑 → 当前卡片向左滑出 → 新卡片从右侧进入。
- 手指向右滑 → 当前卡片向右滑出 → 新卡片从左侧进入。

```css
/* 滑动动画 CSS（如需） */
.dorm-card {
  transition: transform 0.3s ease;
}
.dorm-card.swipe-left {
  transform: translateX(-100%); /* 向左滑出 */
}
.dorm-card.swipe-right {
  transform: translateX(100%); /* 向右滑出 */
}
```

---

## 三、验收标准

### 数据存储
- [ ] 单人查寝：设备 A 修改学生状态后，设备 B 刷新页面，状态同步更新。
- [ ] 单人查寝：断网时操作标记 pending，网络恢复后自动同步到 D1。
- [ ] 多人查寝：房主修改状态后，成员页面 3 秒内自动更新（轮询或 WebSocket）。
- [ ] 多人查寝：成员修改状态后，房主页面同步更新，且显示"最后由 XXX 更新"。
- [ ] 数据隔离：用户 A 的单人记录不会被用户 B 看到；房间 A 的数据不会混入房间 B。

### 滑动方向
- [ ] 手指向左滑动 → 显示下一间寝室（index + 1）。
- [ ] 手指向右滑动 → 显示上一间寝室（index - 1）。
- [ ] 滑动动画方向与逻辑一致，无视觉跳跃。
- [ ] 按钮导航（左箭头/右箭头）逻辑不变：左箭头 = 上一间，右箭头 = 下一间。

---

## 四、部署

```bash
# 1. 先执行数据库迁移（本地 wrangler CLI）
npx wrangler d1 execute nightshift-db --local --file=./migrations/v18_add_check_records.sql

# 2. 部署前端
npx wrangler pages deploy . --commit-dirty=true

# 3. 验证跨设备同步（用两个浏览器或手机测试）
```

**数据库迁移文件示例**（`migrations/v18_add_check_records.sql`）：
```sql
-- 单人查寝记录表
CREATE TABLE IF NOT EXISTS single_check_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  check_date TEXT NOT NULL,
  dorm_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade TEXT,
  major TEXT,
  class_name TEXT,
  bed_number TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  reason_detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, check_date, student_id)
);
CREATE INDEX IF NOT EXISTS idx_single_user_date ON single_check_records(user_id, check_date);
CREATE INDEX IF NOT EXISTS idx_single_user_dorm ON single_check_records(user_id, dorm_id);

-- 多人查寝记录表
CREATE TABLE IF NOT EXISTS room_check_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  dorm_id TEXT NOT NULL,
  grade TEXT,
  major TEXT,
  class_name TEXT,
  bed_number TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  reason_detail TEXT,
  updated_by TEXT NOT NULL,
  updated_by_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(room_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_room_records ON room_check_records(room_id, updated_at);

-- 房间成员表（如不存在）
CREATE TABLE IF NOT EXISTS room_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  joined_at INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  UNIQUE(room_id, user_id)
);
```
