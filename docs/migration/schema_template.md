# 表结构信息收集模板
# 请根据你的实际 D1 数据库填写，填完发给我，我帮你生成精准迁移脚本

## 数据库基本信息
- 项目名: NightShift 查寝系统
- D1 数据库名: nightshift-db (database_id: dc0645ff-429c-479d-8d14-fdd831d36254)
- 总表数量: 14
- 总数据量估算: ~2000 条（含 172 条宿舍学生 + 少量用户/房间/日志）

---

## 表1: users (用户表)

### 用途
存储查寝员/管理员账户，含 PBKDF2 密码哈希、角色和登录审计信息

### SQLite 建表语句（最重要）
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'inspector',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  last_login_ip TEXT,
  is_temp INTEGER DEFAULT 0
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃，由 CloudBase 生成 _id |
| username | TEXT | 用户名（3-20字符） | 否 | 直接迁移 |
| password_hash | TEXT | PBKDF2 SHA-256 哈希 | ⚠️ 是 | 丢弃/强制重置密码 |
| display_name | TEXT | 显示名 | 否 | 直接迁移 |
| role | TEXT | 角色（admin/inspector） | 否 | 直接迁移 |
| created_at | DATETIME | 注册时间 | 否 | 直接迁移 |
| last_login_at | DATETIME | 最后登录时间 | 否 | 直接迁移 |
| last_login_ip | TEXT | 最后登录IP | ⚠️ 是 | 可丢弃 |
| is_temp | INTEGER | 是否临时账户 | 否 | 直接迁移 |

### 特殊说明
- [ ] 此表有外键关联到: rooms(creator_id), room_members(user_id), room_logs(user_id), room_messages(user_id), room_states(updated_by), single_check_records(user_id), system_logs(user_id), login_logs(user_id)
- [x] 此表有唯一索引/约束: username UNIQUE
- [ ] 此表数据量: ~5 条（少量管理员账户）
- [ ] 前端是否硬编码依赖了 id 值: 否（JWT token 中含 user_id，但前端 API 用 token 鉴权，不直接引用数字 id）
- 密码存储方式: [ ] 明文 [ ] MD5 [x] PBKDF2 (Web Crypto API, 100000 iterations, SHA-256, 16-byte salt, 格式 salt$hash)
- 如果丢弃密码，用户需要: [ ] 重新注册 [x] 管理员重置 [ ] 其他: 有新注册接口，可让用户自行重新注册

---

## 表2: rooms (查寝房间表)

### 用途
查寝房间——每次查寝创建一个房间，有创建者、过期时间和状态

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  creator_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_activity_at DATETIME,
  status TEXT DEFAULT 'active',
  dorm_building TEXT
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃，由 CloudBase 生成 _id |
| code | TEXT | 房间码（UNIQUE） | 否 | 直接迁移 |
| creator_id | INTEGER | 创建者用户ID | 否 | 需映射到新的用户 _id |
| created_at | DATETIME | 创建时间 | 否 | 直接迁移 |
| expires_at | DATETIME | 过期时间 | 否 | 直接迁移 |
| last_activity_at | DATETIME | 最后活动时间 | 否 | 直接迁移 |
| status | TEXT | active / inactive | 否 | 直接迁移 |
| dorm_building | TEXT | 宿舍楼名称 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: creator_id → users(id)；被 room_members, room_states, room_logs, room_messages 引用
- [x] 此表有唯一索引/约束: code UNIQUE
- [ ] 此表数据量: ~50 条（短期房间，过期清理）
- [ ] 前端是否硬编码依赖了 id 值: 是——前端通过 room code 查找房间，但 room_id 用于 API 路由参数。迁移后需更新 room 关联的子表外键

---

## 表3: room_members (房间成员表)

### 用途
记录哪些用户加入了哪个查寝房间，含角色（creator/member）和最后已读消息ID

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS room_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  role TEXT DEFAULT 'member',
  last_read_msg_id INTEGER DEFAULT 0,
  UNIQUE(room_id, user_id)
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| room_id | INTEGER | 房间ID | 否 | 需映射到新 rooms._id |
| user_id | INTEGER | 用户ID | 否 | 需映射到新 users._id |
| joined_at | DATETIME | 加入时间 | 否 | 直接迁移 |
| role | TEXT | creator / member | 否 | 直接迁移 |
| last_read_msg_id | INTEGER | 最后已读消息ID | 否 | 需映射到新 messages._id |

### 特殊说明
- [x] 此表有外键关联到: room_id → rooms(id), user_id → users(id)
- [x] 此表有唯一索引/约束: (room_id, user_id) UNIQUE
- [ ] 此表数据量: ~100 条

---

## 表4: room_states (房间人员状态表)

### 用途
记录每个房间内所有学生的查寝状态（在寝/不在/请假等），核心业务表

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS room_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  dorm_number TEXT NOT NULL,
  bed_number TEXT,
  status TEXT DEFAULT 'present',
  reason TEXT,
  reason_detail TEXT,
  updated_by INTEGER,
  updated_by_name TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_states_room_student ON room_states(room_id, student_name);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| room_id | INTEGER | 房间ID | 否 | 需映射到新 rooms._id |
| student_name | TEXT | 学生姓名 | ⚠️ 是 | 直接迁移（前端已做脱敏展示） |
| dorm_number | TEXT | 宿舍号 | 否 | 直接迁移 |
| bed_number | TEXT | 床号 | 否 | 直接迁移 |
| status | TEXT | present/absent/leave | 否 | 直接迁移 |
| reason | TEXT | 离寝原因 | 否 | 直接迁移 |
| reason_detail | TEXT | 原因详情 | 否 | 直接迁移 |
| updated_by | INTEGER | 操作者用户ID | 否 | 需映射 |
| updated_by_name | TEXT | 操作者姓名 | 否 | 直接迁移 |
| updated_at | DATETIME | 更新时间 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: room_id → rooms(id), updated_by → users(id)
- [ ] 此表有唯一索引/约束: idx_room_states_room_student
- [ ] 此表数据量: 每个房间 ~40 人，动态

---

## 表5: room_logs (动作日志表)

### 用途
记录查寝房间内所有操作（状态变更、加入/退出等），按房间隔离

### SQLite 建表语句
```sql
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
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| room_id | INTEGER | 房间ID | 否 | 需映射 |
| user_id | INTEGER | 操作用户ID | 否 | 需映射 |
| action_type | TEXT | 操作类型 | 否 | 直接迁移 |
| target_student | TEXT | 目标学生姓名 | ⚠️ 是 | 直接迁移 |
| old_status | TEXT | 旧状态 | 否 | 直接迁移 |
| new_status | TEXT | 新状态 | 否 | 直接迁移 |
| detail | TEXT | 详情 | 否 | 直接迁移 |
| created_at | DATETIME | 操作时间 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: room_id → rooms(id), user_id → users(id)
- [ ] 此表数据量: 每房间 ~100 条

---

## 表6: room_messages (房间消息表)

### 用途
房间内聊天消息，多设备实时同步

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| room_id | INTEGER | 房间ID | 否 | 需映射 |
| user_id | INTEGER | 发送者ID | 否 | 需映射 |
| content | TEXT | 消息内容 | 否 | 直接迁移 |
| created_at | DATETIME | 发送时间 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: room_id → rooms(id), user_id → users(id)
- [ ] 此表数据量: 每房间 ~50 条，7天后清理
- [ ] 前端是否硬编码依赖了 id 值: room_members.last_read_msg_id 引用此表 id

---

## 表7: check_sessions (查寝批次表)

### 用途
跨设备同步的查寝批次——记录查寝的时间和楼层维度

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS check_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  floor TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  last_sync DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | TEXT | UUID（主键） | 否 | 直接迁移（已是字符串ID，不需转换） |
| user_id | TEXT | 用户ID（字符串） | 否 | 映射到新用户ID |
| floor | TEXT | 楼层 | 否 | 直接迁移 |
| created_at | DATETIME | 创建时间 | 否 | 直接迁移 |
| status | TEXT | active/completed | 否 | 直接迁移 |
| last_sync | DATETIME | 最后同步时间 | 否 | 直接迁移 |

### 特殊说明
- [ ] 此表有外键关联到: check_records(session_id)
- [ ] 此表有唯一索引/约束: id 是 TEXT PRIMARY KEY（非自增）
- [ ] 此表数据量: ~20 条
- 注意: 此表 id 已是 UUID 字符串，不使用自增整型，迁移最简单

---

## 表8: check_records (查寝记录表)

### 用途
每个查寝批次下的学生查寝记录，主键为 (session_id, student_name)

### SQLite 建表语句
```sql
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
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| session_id | TEXT | 批次ID | 否 | 直接迁移 |
| student_name | TEXT | 学生姓名 | ⚠️ 是 | 直接迁移 |
| status | TEXT | 查寝状态 | 否 | 直接迁移 |
| reason | TEXT | 原因 | 否 | 直接迁移 |
| updated_by | TEXT | 操作者 | 否 | 直接迁移 |
| updated_at | DATETIME | 更新时间 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: session_id → check_sessions(id)
- [ ] 复合主键: (session_id, student_name)，无自增 id 列
- [ ] 此表数据量: 每批次 ~40 条

---

## 表9: single_check_records (单人查寝记录表)

### 用途
v18 新增——按 user + date + student 维度的单人查寝持久化记录，跨设备同步

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS single_check_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  check_date TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  dorm_number TEXT,
  bed_number TEXT,
  grade TEXT,
  class_name TEXT,
  status TEXT DEFAULT 'in',
  reason TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, check_date, student_id)
);
CREATE INDEX IF NOT EXISTS idx_single_check_user_date ON single_check_records(user_id, check_date);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| user_id | INTEGER | 查寝员ID | 否 | 需映射 |
| check_date | TEXT | 查寝日期 | 否 | 直接迁移 |
| student_id | TEXT | 学号 | 否 | 直接迁移 |
| student_name | TEXT | 学生姓名 | ⚠️ 是 | 直接迁移 |
| dorm_number | TEXT | 宿舍号 | 否 | 直接迁移 |
| bed_number | TEXT | 床号 | 否 | 直接迁移 |
| grade | TEXT | 年级 | 否 | 直接迁移 |
| class_name | TEXT | 班级 | 否 | 直接迁移 |
| status | TEXT | in/out/leave | 否 | 直接迁移 |
| reason | TEXT | 原因 | 否 | 直接迁移 |
| updated_at | DATETIME | 更新时间 | 否 | 直接迁移 |

### 特殊说明
- [x] 此表有外键关联到: user_id → users(id)
- [x] 此表有唯一索引/约束: (user_id, check_date, student_id) UNIQUE
- [ ] 此表数据量: 每用户每天 ~40 条
- 这是目前活跃使用的核心查寝记录表

---

## 表10: dorm_students (宿舍人员表)

### 用途
宿舍楼学生花名册，含楼层、班级、年级、床位信息，是查寝时学生列表的数据源

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS dorm_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dorm_name TEXT NOT NULL,
  floor INTEGER NOT NULL,
  class_name TEXT,
  student_name TEXT,
  bed INTEGER,
  year_code TEXT,
  grade_name TEXT,
  status TEXT DEFAULT '在校',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dorm_floor ON dorm_students(floor);
CREATE INDEX IF NOT EXISTS idx_dorm_name ON dorm_students(dorm_name);
CREATE INDEX IF NOT EXISTS idx_class_name ON dorm_students(class_name);
CREATE INDEX IF NOT EXISTS idx_year_code ON dorm_students(year_code);
CREATE INDEX IF NOT EXISTS idx_grade_name ON dorm_students(grade_name);
CREATE INDEX IF NOT EXISTS idx_student_name ON dorm_students(student_name);
CREATE INDEX IF NOT EXISTS idx_dorm_bed ON dorm_students(dorm_name, bed);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| dorm_name | TEXT | 宿舍号（如 512） | 否 | 直接迁移 |
| floor | INTEGER | 楼层 | 否 | 直接迁移 |
| class_name | TEXT | 班级名 | 否 | 直接迁移 |
| student_name | TEXT | 学生姓名（空床为 NULL） | ⚠️ 是 | 直接迁移 |
| bed | INTEGER | 床号 1-4 | 否 | 直接迁移 |
| year_code | TEXT | 年级代码（22/23/24/25） | 否 | 直接迁移 |
| grade_name | TEXT | 年级（大一~大四） | 否 | 直接迁移 |
| status | TEXT | 在校/空床/实习/休学 | 否 | 直接迁移 |
| created_at | DATETIME | 创建时间 | 否 | 直接迁移 |
| updated_at | DATETIME | 更新时间 | 否 | 直接迁移 |

### 特殊说明
- [ ] 此表有外键关联到: 无（独立的花名册表）
- [x] 有 7 个索引: idx_dorm_floor, idx_dorm_name, idx_class_name, idx_year_code, idx_grade_name, idx_student_name, idx_dorm_bed
- [x] 此表数据量: 172 条（含 7 个空床位）
- [ ] 前端是否硬编码依赖了 id 值: 否——前端按 dorm_name + student_name 查询
- 宿舍范围: 4F（大二）、5F（大一/大三）、6F（大一/大三/大四），共 45 间宿舍

---

## 表11: grade_mapping (年级映射表)

### 用途
年级代码 → 年级名称的动态映射（可后期修改），目前 22→大四, 23→大三, 24→大二, 25→大一

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS grade_mapping (
  year_code TEXT PRIMARY KEY,
  grade_name TEXT NOT NULL,
  display_order INTEGER NOT NULL
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| year_code | TEXT | 年级代码（PK） | 否 | 直接迁移 |
| grade_name | TEXT | 年级名称 | 否 | 直接迁移 |
| display_order | INTEGER | 排序序号 | 否 | 直接迁移 |

### 特殊说明
- 数据量: 4 条（25→大一, 24→大二, 23→大三, 22→大四）

---

## 表12: settings (系统配置表)

### 用途
K-V 配置存储，目前存储访问密码和词库版本号

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| key | TEXT | 配置键（PK） | 否 | 直接迁移 |
| value | TEXT | 配置值 | ⚠️ 是（access_password） | access_password 需迁移，其他直接迁移 |
| updated_at | DATETIME | 更新时间 | 否 | 直接迁移 |

### 特殊说明
- 当前键值: access_password (4位数字), sensitive_words_version
- [x] access_password 为 4 位数字密码（前端密码墙用），敏感但非用户密码，建议迁移

---

## 表13: system_logs (系统操作日志表)

### 用途
管理员审计日志——记录所有管理员操作（不敏感时也可记录普通操作）

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  role TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_system_logs_user ON system_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| user_id | INTEGER | 操作用户ID | 否 | 需映射 |
| username | TEXT | 用户名 | 否 | 直接迁移 |
| role | TEXT | 角色 | 否 | 直接迁移 |
| action | TEXT | 操作类型 | 否 | 直接迁移 |
| target_type | TEXT | 操作对象类型 | 否 | 直接迁移 |
| target_id | TEXT | 操作对象ID | 否 | 直接迁移 |
| detail | TEXT | 详情（已脱敏） | 否 | 直接迁移 |
| ip | TEXT | 操作IP | ⚠️ 是 | 可丢弃 |
| user_agent | TEXT | UA | 否 | 直接迁移 |
| created_at | DATETIME | 操作时间 | 否 | 直接迁移 |

### 特殊说明
- 保留 3 天，自动清理
- [ ] 迁移时可选择丢弃此表（大部分是历史操作日志）
- [ ] 此表数据量: 动态，3天窗口内 ~几百条

---

## 表14: login_logs (登录审计表)

### 用途
记录所有登录尝试（成功/失败），含 IP、UA、失败原因

### SQLite 建表语句
```sql
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  role TEXT,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip TEXT,
  user_agent TEXT,
  status TEXT,
  fail_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, login_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_status ON login_logs(status, login_at);
```

### 字段清单
| 字段名 | 类型 | 说明 | 是否敏感 | 迁移策略 |
|--------|------|------|----------|----------|
| id | INTEGER | 自增主键 | 否 | 丢弃 |
| user_id | INTEGER | 用户ID | 否 | 需映射 |
| username | TEXT | 用户名 | 否 | 直接迁移 |
| role | TEXT | 角色 | 否 | 直接迁移 |
| login_at | DATETIME | 登录时间 | 否 | 直接迁移 |
| ip | TEXT | 登录IP | ⚠️ 是 | 可丢弃 |
| user_agent | TEXT | UA | 否 | 直接迁移 |
| status | TEXT | success/failed | 否 | 直接迁移 |
| fail_reason | TEXT | 失败原因 | 否 | 直接迁移 |

### 特殊说明
- 保留 3 天，自动清理
- [ ] 可丢弃此表（登录审计对新系统无意义）

---

## 其他关键信息

### 敏感词库
- 存储方式: Cloudflare KV (namespace SENSITIVE_WORDS, id: cf3b46eb129649d38b491b46f0320c92)
- key: `sensitive_words`，值: 换行分隔的敏感词列表
- 前端加载: trie-filter.js 从 KV 拉取词库构建 Trie，实现本地过滤
- 词库总量: 由 KV 动态维护（settings 中 sensitive_words_version 记录版本）
- 是否从外部API获取: [ ] 是 [x] 否（手动维护在 KV）

### 前端 API 调用情况
- 前端项目框架: [ ] Vue [ ] React [x] 纯 HTML/JS [ ] 其他
- API 请求方式: [x] REST [ ] GraphQL [ ] 其他
- 当前 API Base URL: 同域 `/api/*`（Cloudflare Pages Functions，无独立域名）
- 需要替换的 API 端点数量（估算）: 15+

API 端点清单:
| 路由 | 文件 | 用途 |
|------|------|------|
| POST /api/auth | auth.js | 登录/注册/修改密码 |
| GET /api/check-session | check-session.js | 验证 JWT Token 有效性 |
| POST /api/room | room.js | 创建/加入/离开房间，更新状态 |
| GET /api/room | room.js | 获取房间详情、状态列表 |
| POST /api/single-check | single-check.js | 单人查寝操作 |
| GET /api/dorm-data | dorm-data.js | 宿舍花名册数据 |
| POST /api/ocr | ocr.js | 假条 OCR 识别 |
| POST /api/baidu-ocr | baidu-ocr.js | 百度 OCR 接口 |
| POST /api/deepseek-clean | deepseek-clean.js | DeepSeek AI 清洗假条 |
| POST /api/smart-group | smart-group.js | 智能分组 |
| GET/POST/PUT /api/settings | settings.js | 系统设置（密码墙/词库统计） |
| POST /api/cleanup | cleanup.js | 日志清理（定时任务） |
| GET /api/admin/users | users.js | 管理后台-用户管理 |
| GET /api/admin/logs | logs.js | 管理后台-日志查看 |
| GET /api/admin/rooms | rooms.js | 管理后台-房间管理 |
| POST /api/admin/student-update | student-update.js | 管理后台-学生信息更新 |
| POST /api/admin/student-delete | student-delete.js | 管理后台-学生删除 |
| POST /api/admin/dorm-upload-json | dorm-upload-json.js | 管理后台-宿舍数据导入 |

### 鉴权体系
- 当前鉴权: [x] JWT (HS256, HMAC-SHA256, 30天过期) [ ] Session [x] 二层密码（前端4位数字密码墙） [ ] 其他
- JWT 存储位置: [x] sessionStorage（主） + localStorage（兜底同步） [ ] Cookie [ ] 其他
- 迁移后是否保留现有鉴权: [ ] 是 [x] 否，改用 CloudBase 内置鉴权

### 额外鉴权细节
- 角色系统: admin（管理员，可登录后台和修改系统设置）, inspector（查寝员，默认新用户角色）
- 二层密码墙: 4 位数字访问密码，存储在 settings 表 access_password，前端密码墙验证通过后才可进入主界面
- 临时账户: 系统自动创建 chaqin/123456 临时管理员账户（is_temp=1）
- 账户过期: 非临时账户 30 天未登录自动删除

### 前端页面清单
- index.html —— 查寝主页（密码墙 + 房间列表 + 查寝操作）
- login.html —— 登录/注册页
- admin.html —— 管理后台（用户/日志/房间/数据管理）
- upload.html —— 假条上传
- manual-upload.html —— 手动上传

### 存储汇总
| 存储 | 类型 | 用途 |
|------|------|------|
| D1: nightshift-db | SQLite (D1) | 14 张表，核心业务数据 |
| KV: SENSITIVE_WORDS | KV | 敏感词库 |
| JWT_SECRET | 环境变量/Secret | HS256 签名密钥 |

### 时间压力
- 汇报时间: __________
- 当前可用时间: __________ 小时
- 最低可接受目标: [ ] 仅清除 D1 [ ] 清除+CloudBase 跑通 [ ] 完整迁移

---

*填完此表后，发送给我，我会根据你的实际表结构生成：*
1. *精准的 D1 导出 Worker（含你的真实表名）*
2. *精准的 CloudBase 云函数（含你的字段映射）*
3. *精准的 Python 导入脚本（含数据转换逻辑）*
4. *前端 API 替换清单（含新旧 URL 对照）*
