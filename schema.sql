-- NightShift D1 数据库初始化脚本
-- 在 Cloudflare Dashboard → D1 → 控制台执行此文件

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  is_temp INTEGER DEFAULT 0
);

-- 查寝房间表
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  creator_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  status TEXT DEFAULT 'active',
  dorm_building TEXT
);

-- 房间成员表
CREATE TABLE IF NOT EXISTS room_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  role TEXT DEFAULT 'member',
  last_read_msg_id INTEGER DEFAULT 0,
  UNIQUE(room_id, user_id)
);

-- 房间人员状态表
CREATE TABLE IF NOT EXISTS room_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  dorm_number TEXT NOT NULL,
  bed_number TEXT,
  status TEXT DEFAULT 'present',
  updated_by INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_states_room_student ON room_states(room_id, student_name);

-- 动作日志表
CREATE TABLE IF NOT EXISTS room_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  target_student TEXT,
  old_status TEXT,
  new_status TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 房间消息表
CREATE TABLE IF NOT EXISTS room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 查寝批次表（跨设备同步）
CREATE TABLE IF NOT EXISTS check_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  floor TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  last_sync DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 查寝记录表（跨设备同步）
CREATE TABLE IF NOT EXISTS check_records (
  session_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  updated_by TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, student_name)
);
CREATE INDEX IF NOT EXISTS idx_check_records_session ON check_records(session_id);
