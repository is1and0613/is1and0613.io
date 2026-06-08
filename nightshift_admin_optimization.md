# NightShift 查寝系统 — 管理员后台与安全加固优化需求文档

> **版本**：v2026-0608  
> **适用**：DeepSeek / Claude Code 分阶段执行  
> **约束**：严禁擅自简化、降级或用劣质等效方案替代。如有技术困难必须先告知并征求同意。  
> **特别说明**：manualupload 假单解析模块不参与敏感词过滤，保持原有逻辑不变。

---

## 一、项目现状与核心问题诊断

### 1.1 当前 admin.html 问题

| 问题 | 说明 |
|------|------|
| **风格断层** | 当前为 flat 设计（白底卡片、蓝色填充按钮 `#3498db`），与主站（index.html）的新拟态（Neumorphism）风格完全脱节。 |
| **功能残缺** | 仅有文件上传功能，无数据查看、管理、导出、审计、教师监管视图。 |
| **数据操作危险** | 仅支持全量替换（`DELETE` 全表后 `INSERT`），无增量更新。误操作将瞬间清空全部宿舍数据，无法恢复。 |
| **验证缺失** | 无表头自动匹配、无数据完整性校验、无格式错误提示、无上传预览确认。 |
| **权限硬编码** | 前端和后端均写死 `username === 'chaqin'`，无法扩展多管理员或角色体系。 |
| **无移动端适配** | 布局未针对手机优化，但查寝场景主要用手机。 |

### 1.2 当前 dorm-upload-json.js 问题

| 问题 | 说明 |
|------|------|
| **全量替换策略** | 先 `DELETE FROM dorm_students` 再逐条 `INSERT`，无事务保护。 |
| **无数据验证** | 直接入库，不检查字段合法性、不返回错误行号。 |
| **无权限扩展** | 同样硬编码 `username !== 'chaqin'`，与前端重复判断。 |
| **无增量逻辑** | 无法做到"只更新变化的、保留已有的"。 |

### 1.3 项目整体安全与合规缺口

| 缺口 | 风险 |
|------|------|
| **无角色权限体系** | 所有用户等同，无只读/可改/可审计/全权限分级。 |
| **无敏感词过滤** | 聊天系统无内容审核，存在合规风险。 |
| **无数据脱敏** | 日志、报错、接口直接暴露学生完整姓名。 |
| **无教师监管后台** | 老师无法查看全局房间状态、历史记录、操作日志。 |
| **无前端密码墙** | 直接访问链接即可进入主界面，无二次验证。 |
| **无数据导出** | 无法生成 Excel 报表供学校上报或存档。 |
| **无登录审计** | 无法追踪谁在何时登录、是否失败。 |

---

## 二、设计规范（必须严格遵守，禁止偏离）

### 2.1 新拟态（Neumorphism）全局规范

所有新增/重构页面（`admin.html`、`teacher.html`、`login.html` 以及任何新增页面）必须与主站 `index.html` 风格 100% 统一。

| 元素 | 规范 |
|------|------|
| **页面背景** | 浅色模式 `#E0E5EC`；深色模式 `#1A1D3C`。 |
| **同色异影** | 所有卡片/按钮背景与页面背景色完全一致，层次只靠阴影，禁止任何背景色差。 |
| **大卡片** | `box-shadow: 10px 10px 20px var(--neu-dark), -10px -10px 20px var(--neu-light);` |
| **中等凸起** | `box-shadow: 6px 6px 12px var(--neu-dark), -6px -6px 12px var(--neu-light);` |
| **小凸起** | `box-shadow: 5px 5px 10px var(--neu-dark), -5px -5px 10px var(--neu-light);` |
| **凹陷** | `box-shadow: inset 6px 6px 12px var(--neu-dark), inset -6px -6px 12px var(--neu-light);` |
| **底部按钮** | `box-shadow: 8px 8px 16px var(--neu-dark), -8px -8px 16px var(--neu-light);` |
| **按下态** | 外阴影 → 内阴影 + `transform: scale(0.96~0.98)`。 |
| **Header 按钮** | 放弃新拟态，改用毛玻璃半透明：`rgba(255,255,255,0.12)` + `backdrop-filter: blur`，无阴影、无光晕。 |
| **动效统一** | `transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);` |
| **光源统一** | 假设光源从左上角 45° 射入，所有外阴影方向一致。 |

### 2.2 配色定稿

| 用途 | 浅色模式 | 深色模式 |
|------|---------|---------|
| 页面背景 | `#E0E5EC` | `#1A1D3C` |
| 暗部阴影 | `#B8C4D4` | `rgba(0,0,0,0.6)` |
| 亮部高光 | `#FFFFFF` | `rgba(255,255,255,0.08)` |
| 主文字 | `#1A1D3C` | `#E2E8F0` |
| 次要文字 | `#6B7280` | `#94A3B8` |

### 2.3 状态色（仅用于文字/圆点/细边框，禁止用于填充背景）

| 状态 | 颜色 |
|------|------|
| 在寝 | `#2563EB`（蓝） |
| 离校 | `#7C3AED`（紫） |
| 事假 | `#D97706`（橙） |
| 外出 | `#059669`（绿） |
| 未归 | `#DC2626`（红） |

### 2.4 禁止项（零容忍）

- 禁止纯白卡片（如当前 `background: white`）。
- 禁止彩色晕染/渐变/发光/阴影扩散。
- 禁止粗边框（`border > 1px`），如需分隔只用阴影或 1px 细线。
- 禁止 emoji，全站统一使用 Font Awesome 或 SVG 图标。
- 禁止蓝色/绿色/红色等纯色填充按钮（如当前 `#3498db` 按钮）。
- 禁止任何 flat 设计元素残留。

---

## 三、数据库变更（D1）

所有变更写入 `migrations/v20_admin_enhance.sql`，部署时按顺序执行。

### 3.1 用户表增强

```sql
-- 增加 role 字段与登录审计
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student';
ALTER TABLE users ADD COLUMN last_login_ip TEXT;
ALTER TABLE users ADD COLUMN last_login_at DATETIME;

-- role 枚举：student | inspector | teacher | admin
-- 现有用户默认设为 'inspector'（因为能登录的都是查寝员）
UPDATE users SET role = 'inspector' WHERE role = 'student' OR role IS NULL;
```

### 3.2 新增系统配置表

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始访问密码（4位数字，前端密码墙使用）
INSERT OR IGNORE INTO settings (key, value) VALUES ('access_password', '0000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sensitive_words_version', '1');
```

### 3.3 新增系统日志表（管理员审计）

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

### 3.4 新增登录审计表

```sql
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  role TEXT,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip TEXT,
  user_agent TEXT,
  status TEXT, -- success | failed
  fail_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, login_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_status ON login_logs(status, login_at);
```

### 3.5 宿舍学生表确认

确认 `dorm_students` 表包含以下字段：
`id`, `dorm_name`, `floor`, `class_name`, `student_name`, `bed`, `year_code`, `grade_name`, `grade`, `status`, `created_at`, `updated_at`。

如缺少 `grade`（纯数字年级，如 2023）或 `updated_at`，需补充：

```sql
ALTER TABLE dorm_students ADD COLUMN grade INTEGER;
ALTER TABLE dorm_students ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;
```

### 3.6 room_logs 表确认

确认 `room_logs` 包含：`id`, `room_id`, `user_id`, `action_type`, `target_student`, `old_status`, `new_status`, `detail`, `created_at`。

如缺少 `old_status` / `new_status`，需补充：

```sql
ALTER TABLE room_logs ADD COLUMN old_status TEXT;
ALTER TABLE room_logs ADD COLUMN new_status TEXT;
```

---

## 四、分阶段任务（Phase 1 → 6）

---

### Phase 1：管理员后台前端重构（P0，最高优先级）

**目标**：将 `admin.html` 从 flat 风格彻底重构为新拟态风格，并补全所有管理功能。

#### 1.1 全局布局与导航

- **页面结构**：单页应用（SPA）形式，顶部固定 Header + 下方 Tab 内容区。
- **Header**：新拟态风格，左侧系统标题（"管理后台"），右侧显示当前管理员用户名、角色标签、"返回主页"按钮（毛玻璃）、"退出登录"按钮（毛玻璃）。
- **Tab 导航栏**：新拟态凹陷容器（`inset` 阴影），包含 5 个 Tab：数据上传 | 数据管理 | 房间监控 | 操作日志 | 系统设置。
- **Tab 滑块**：选中态有滑块指示器，使用 `transform: translateX` 实现平滑动画，过渡时间 0.35s。
- **内容切换**：各 Tab 内容独立，切换时淡入淡出（`opacity` + `transform`），禁止页面跳转刷新。

#### 1.2 数据上传 Tab

- **文件拖拽区域**：新拟态凹陷效果（`inset` 阴影），拖拽进入时高亮（阴影颜色变浅或增加内发光反馈）。
- **表头自动识别**：上传 `.xlsx` 后，前端自动识别表头，兼容以下列名写法：
  - 姓名：`姓名`、`学生姓名`、`name`、`student_name`
  - 宿舍号：`宿舍号`、`宿舍`、`dorm`、`dorm_name`
  - 班级：`班级`、`class`、`class_name`
  - 床号：`床号`、`床位`、`bed`
  - 年级：`年级`、`grade`、`year_code`
  - 专业：`专业`、`major`
- **上传模式选择**：新拟态单选按钮组（凸起/凹陷切换表示选中/未选中）：
  - **全量替换**（危险操作，需二次确认）
  - **增量更新**（默认选中，只新增/修改，不删除已有数据）
- **预览区域**：新拟态卡片，显示解析结果统计：
  - 总记录数、有效记录数、错误行数
  - 各年级人数分布（小统计卡片，新拟态凸起）
  - 各宿舍人数分布
- **错误行高亮**：如果某行缺失必填字段（姓名/宿舍号/床号），在预览列表中标记为红色背景（状态色 `#DC2626` 的 10% 透明度底色）。
- **操作按钮**：
  - "确认导入"（新拟态凸起按钮，大阴影）
  - "跳过错误行并导入"（仅当存在错误行时显示）
  - "重新选择文件"（新拟态中等凸起）

#### 1.3 数据管理 Tab

- **搜索栏**：新拟态凹陷输入框，支持按姓名、宿舍号、班级模糊搜索，实时过滤。
- **筛选栏**：年级筛选（下拉或横向滚动标签）、楼层筛选、状态筛选。
- **数据表格**：新拟态风格表格，行与行之间用微小阴影分隔（非边框），表头轻微凸起。
- **单条操作**：
  - 点击行展开编辑态（新拟态凹陷编辑区），可修改：姓名、班级、宿舍、床号、状态。
  - "保存"（凸起）、"取消"（凹陷）、"删除"（红色文字，无背景，按下态变红）。
- **批量操作**：左侧复选框（新拟态小凸起，选中态内部有圆点），顶部批量操作栏：批量删除、批量修改状态。
- **分页**：新拟态风格分页器（上一页/下一页为凸起按钮，页码为凹陷小方块）。

#### 1.4 房间监控 Tab（教师监管视图雏形）

- **房间列表**：新拟态卡片列表，每卡片显示：
  - 房间码（可复制）、创建者、创建时间、过期倒计时、当前人数、最后活动时间
  - 状态标签：活跃（绿点）、已过期（灰点）
- **房间详情**：点击卡片展开/进入详情页（或 Modal），显示：
  - 成员列表：姓名（脱敏）、宿舍、床号、当前状态、最后修改人、修改时间
  - 消息记录：发送者（脱敏）、时间、内容（敏感词已过滤）
  - 操作日志：该房间内的状态变更记录
- **自动刷新**：每 30 秒自动轮询一次房间状态（无痕刷新，不闪动）。

#### 1.5 操作日志 Tab

- **筛选栏**：按操作类型（登录/上传/修改/删除/状态变更）、按用户、按时间范围（今天/最近7天/最近30天/自定义）。
- **日志表格**：时间、操作人、角色、操作类型、目标、详情、IP。
- **数据脱敏**：学生姓名显示为 `张**`、`李**`（保留首字，其余替换为 `*`）。
- **分页**：同数据管理 Tab。

#### 1.6 系统设置 Tab

- **敏感词库状态**：显示当前加载词库总数、警校补充词数量、最后更新时间。
- **访问密码设置**：4 位数字输入框（新拟态凹陷），用于前端密码墙。
- **管理员密码修改**：原密码 + 新密码 + 确认新密码。
- **词库测试**：输入框 + 测试按钮，实时显示过滤结果（如输入"翻墙"显示"**"）。

#### 1.7 登录弹窗重构

- 当前登录弹窗为 flat 白底卡片，需重构为新拟态风格：
  - 遮罩层：`rgba(26, 29, 60, 0.6)` + `backdrop-filter: blur(8px)`
  - 登录卡片：新拟态大凸起，与页面背景同色。
  - 输入框：新拟态凹陷。
  - 按钮：新拟态凸起，禁止蓝色填充。

**验收标准**：
- 在 375px ~ 1920px 宽度下正常显示，移动端优先。
- 所有交互元素有按下态反馈（`scale(0.97)` + 内阴影）。
- 无 flat 风格元素残留（无白底卡片、无蓝色填充按钮、无 emoji）。
- 上传 1000 条数据预览不卡顿（使用虚拟滚动或分页）。
- 增量更新模式为默认选中。

---

### Phase 2：后端 API 重构与权限体系（P0，最高优先级）

**目标**：建立 RBAC 角色权限体系，重构数据上传 API，全面加固安全。

#### 2.1 权限分级（RBAC）

- **JWT Payload 扩展**：在签发 JWT 时加入 `role` 字段。
- **角色定义**：
  - `student`：仅查看（只读自己的数据，不可修改）。
  - `inspector`：可修改查寝状态（单人/多人模式均可操作）。
  - `teacher`：可查看所有房间、所有历史记录、操作日志、导出报表（不可修改学生基础数据）。
  - `admin`：全权限（数据上传、修改、删除、系统设置、角色分配）。
- **默认角色**：新注册用户默认 `student`，由 admin 在后台提升角色。
- **角色修改接口**：`POST /api/admin/users/:id/role`，仅 admin 可调用，修改 `users.role` 字段。

#### 2.2 数据上传 API 重构

- **路径**：保留 `/api/admin/dorm-upload-json`（或新增 `/api/admin/dorm-upload`，兼容旧路径）。
- **请求体增加 `mode` 字段**：
  - `mode: 'incremental'`（默认）：增量更新。
  - `mode: 'replace'`：全量替换（需额外确认参数 `confirm: true`）。
- **增量更新逻辑**：
  - 以 `student_name` + `dorm_name` + `bed` 作为复合唯一键。
  - 如果记录存在：更新 `class_name`, `grade`, `grade_name`, `status`, `updated_at`。
  - 如果记录不存在：插入新记录，`created_at` 和 `updated_at` 均为当前时间。
  - 不删除任何已有记录。
  - 返回结果：成功数、更新数、新增数、失败数、失败明细（行号+原因）。
- **全量替换逻辑**：
  - 必须使用 SQLite 事务：`BEGIN TRANSACTION` → `DELETE` → `INSERT` 循环 → `COMMIT`。
  - 任意步骤失败执行 `ROLLBACK`，确保不会半清空。
  - 要求前端传入 `confirm: true`，否则拒绝执行。
- **数据验证（每条记录）**：
  - `student_name`：非空字符串，必须为 2-4 个汉字（正则 `/^[\u4e00-\u9fa5]{2,4}$/`）。
  - `dorm_name`：非空字符串，建议匹配数字开头（如 `611`、`514`），但不强制。
  - `bed`：整数，范围 1-6。
  - `class_name`：非空字符串。
  - `grade` / `year_code`：至少存在一个。
  - 验证失败时记录错误行号和具体原因，不中断整体流程（继续处理后续行）。
- **权限检查**：使用 JWT 中的 `role` 字段，仅 `admin` 可访问。非 admin 返回 403，不暴露 API 细节。
- **日志记录**：上传完成后写入 `system_logs`，包含：文件名、记录数、成功数、失败数、模式（incremental/replace）。

#### 2.3 中间件全面增强（`_middleware.js`）

- **路径级权限控制**：
  - `/api/admin/*`：强制 JWT 有效 + `role === 'admin'`。
  - `/api/teacher/*`：强制 JWT 有效 + `role` 属于 `['teacher', 'admin']`。
  - `/api/inspector/*` 或直接保护现有 API：修改状态的 API 要求 `role` 属于 `['inspector', 'teacher', 'admin']`。
  - 只读 API（如获取学生列表）：`role` 属于 `['student', 'inspector', 'teacher', 'admin']`。
- **非授权响应**：返回 403，响应体统一为 `{"error": "Forbidden"}`，不透露 API 存在性或角色要求。
- **请求日志**：所有受保护 API 调用记录到 `system_logs`（user_id, action='api_access', target_type='api', target_id=路径, ip）。
- **安全响应头**：确保所有响应包含：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - （Cloudflare 已自带部分，需确认并补充缺失项）

#### 2.4 数据脱敏策略

- **对外接口默认脱敏**：所有返回学生姓名的 API（除 `/api/admin/*` 内部管理接口外），默认将姓名处理为保留首字+掩码：
  - 2 字姓名：`张*`
  - 3 字姓名：`张**`
  - 4 字姓名：`张**` 或 `张*三`（统一为保留首字，其余替换为 `*`）
- **实现方式**：建议在后端写一个 `maskName(name)` 工具函数，在 JSON 序列化前统一处理。
- **例外**：管理员后台的数据管理 Tab 需要显示完整姓名以便管理，但操作日志中仍脱敏。
- **日志脱敏**：`system_logs.detail` 字段不得包含完整姓名，写入前先 `maskName` 处理。
- **错误信息脱敏**：任何报错信息（如 "学生张三状态更新失败"）不得返回给前端，前端仅显示通用错误码。

#### 2.5 登录审计

- **登录接口增强**：
  - 成功登录：写入 `login_logs`，`status='success'`，记录 IP、User-Agent、时间。
  - 失败登录：写入 `login_logs`，`status='failed'`，记录失败原因（密码错误/用户不存在）。
  - 更新 `users.last_login_at` 和 `users.last_login_ip`。
- **查询接口**：
  - `GET /api/admin/login-logs`：admin 查询所有登录日志，支持分页、时间筛选。
  - `GET /api/teacher/login-logs`：teacher 查询其权限范围内的登录日志（如只查看自己所在部门/班级的用户，如果技术实现复杂，可 Phase 2 仅实现 admin 查询，teacher 查询延后）。

**验收标准**：
- 非 admin 访问上传 API 返回 403，无额外信息泄露。
- 全量替换中途失败时数据不丢失（事务回滚）。
- 增量更新 1000 条数据在 5 秒内完成（D1 性能基准）。
- 所有对外接口（非 admin）返回的学生姓名已脱敏。
- 登录失败 3 次后建议前端提示"多次失败，请检查密码"。

---

### Phase 3：敏感词过滤系统（P0，最高优先级）

**目标**：为聊天系统接入 Trie 树敏感词过滤，前后端双重保护。

#### 3.1 词库准备

- **本地词库迁移**：请将本地路径 `E:/上大学。。。/女工/NightShift/sensitive-words` 下的所有词库文件复制到项目根目录的 `/sensitive-words/` 文件夹中。
- **格式统一**：如果词库文件不是每行一词的纯文本格式（`.txt`），需先转换为 `.txt`：UTF-8 编码，每行一词，无空行，无 BOM。
- **警校补充词库**：必须加入以下词汇，保存为 `/sensitive-words/police-supplement.txt`：

```
翻墙
VPN
代理
境外
反动
暴乱
游行
罢课
自杀
自残
涉密
机密
绝密
警务通
数字证书
公安网
内网
```

- **词库合并**：构建时将所有 `.txt` 词库合并为 `/sensitive-words/merged.txt`，去重，按 UTF-8 编码保存。
- **大小控制**：合并后词库大小控制在 5MB 以内。如果过大，需分片（如 `merged-part1.txt`, `merged-part2.txt`）。

#### 3.2 前端 Trie 树实现

- **文件位置**：`assets/js/trie-filter.js`。
- **功能要求**：
  - `buildTrie(words)`：从词库数组构建 Trie 树对象。
  - `filter(text, replacement='*')`：检测文本中的敏感词，替换为 `replacement` 字符（默认 `*`），返回替换后的文本。
  - `hasSensitive(text)`：仅检测不替换，返回 `boolean`。
  - `findAll(text)`：返回文本中所有敏感词的位置数组（`[{start, end, word}]`），用于前端高亮。
- **性能要求**：
  - 词库构建时间不超过 2 秒。
  - 1000 字文本检测耗时 < 10ms。
  - 如果词库过大导致构建慢，支持 Web Worker 异步构建或分片懒加载。
- **加载策略**：
  - 页面加载时 `fetch('/sensitive-words/merged.txt')`，按行分割后构建 Trie。
  - 构建完成后存入内存，全局复用。
  - 如果 fetch 失败，聊天系统应降级为允许发送（但后端仍会过滤），并在控制台报错。

#### 3.3 过滤接入点

- **聊天消息发送前拦截**：
  - 用户在房间消息输入框输入内容，点击发送前，调用 `trie-filter.js` 的 `hasSensitive()` 检测。
  - 如果包含敏感词：前端拦截，不调用 API，显示 Toast 提示："消息包含敏感内容，已禁止发送。"
  - 消息输入框实时高亮：使用 `findAll()` 获取敏感词位置，在输入框下方或内联显示红色下划线/红色背景（仅视觉提示，不阻止输入）。
- **房间名称/备注创建时**：
  - 创建房间时，对房间名称和备注文本进行 `hasSensitive()` 检测。
  - 如果包含敏感词：禁止创建，提示"房间名称包含敏感内容"。
- **假单解析豁免**：`manualupload.js` 假单文本解析模块**明确不参与敏感词过滤**，保持原有逻辑不变。此需求不可更改。

#### 3.4 后端二次过滤（冗余保护）

- **聊天 API 增强**：`functions/api/room.js` 中的消息发送处理逻辑，接收消息后先用同样 Trie 树逻辑检测。
- **如果前端漏过**：后端返回 400，响应体 `{"error": "Message contains sensitive content"}`，不写入 `room_messages` 表。
- **后端词库来源**：构建时将 `/sensitive-words/merged.txt` 内联到 Worker 代码中，或通过 Cloudflare KV 存储（推荐 KV，便于热更新）。
- **敏感词拦截日志**：后端拦截敏感词时，记录到 `system_logs`，`action='sensitive_blocked'`，`detail` 包含敏感词类型（不记录完整消息内容，避免日志污染）。

#### 3.5 管理员后台展示

- 系统设置 Tab 显示：当前词库总数、警校补充词数量、最后更新时间。
- 提供测试输入框：管理员输入文本，实时显示过滤后结果（使用 `filter()`）。

**验收标准**：
- 聊天发送"翻墙"被前端拦截，不调用 API。
- 词库构建后 1000 字文本检测耗时 < 10ms。
- 前后端过滤逻辑一致（同一文本前后端判断结果相同）。
- 假单解析不受任何影响（可正常包含任何词汇）。
- 房间名称含敏感词时禁止创建。

---

### Phase 4：数据导出与报表（P1）

**目标**：支持 Excel 报表导出，方便老师上报学校或存档。

#### 4.1 管理员后台数据导出

- **导出按钮位置**：数据管理 Tab 顶部，"导出当前结果"（新拟态凸起按钮）。
- **导出范围**：
  - 如果当前有筛选/搜索条件，导出符合条件的数据。
  - 如果无筛选，提示"导出全部数据？"，确认后导出全部。
- **导出格式**：`.xlsx`（使用已加载的 SheetJS 库）。
- **导出列**：
  - 姓名（管理员导出完整姓名，teacher 导出脱敏姓名）
  - 年级
  - 班级
  - 宿舍号
  - 床号
  - 当前状态
  - 最后更新时间
- **文件名**：`dorm_students_YYYYMMDD_HHMMSS.xlsx`
- **列宽**：自适应中文内容（SheetJS 的 `wch` 设置）。

#### 4.2 查寝报告导出（主界面）

- **位置**：`index.html` 的报告生成区域，增加"导出 Excel"按钮（新拟态小凸起）。
- **导出内容**：当前查寝结果（单人或多人模式）。
- **导出列**：
  - 宿舍号
  - 姓名
  - 状态（中文：在寝/离校/事假/外出/未归）
  - 事由（如工作室、病假原因等）
  - 记录人
  - 记录时间
- **文件名**：`check_report_YYYYMMDD_HHMMSS.xlsx`

#### 4.3 房间数据导出（教师监管）

- **位置**：房间监控 Tab → 房间详情 → "导出房间记录"。
- **导出内容**：该房间的历史状态变更记录。
- **导出列**：
  - 时间
  - 操作人
  - 学生姓名（脱敏）
  - 原状态
  - 新状态
  - 事由
- **文件名**：`room_history_{room_code}_YYYYMMDD.xlsx`

#### 4.4 后端大数据量导出（可选）

- 如果前端导出 5000 条以上数据导致卡顿或内存溢出，后端提供 `POST /api/admin/export` 接口：
  - 请求体：筛选条件（年级、楼层、状态等）。
  - 返回：二进制 `.xlsx` 文件流。
  - 权限：admin 或 teacher。
  - 实现方式：后端使用 SheetJS 的 Node 版本（`xlsx` npm 包）生成 buffer，返回 `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`。
- **如果 D1 查询性能限制导致超时**，可改为分页查询后合并，或限制单次导出最大 5000 条。

**验收标准**：
- 导出 500 条数据前端不卡顿（< 3 秒）。
- 导出文件可在 Excel 2016+/WPS/LibreOffice 正常打开，无乱码。
- 列宽自适应中文内容，日期格式正确。
- 管理员导出完整姓名，teacher 导出脱敏姓名。

---

### Phase 5：操作日志审计完善（P1）

**目标**：确保所有关键操作可追溯、可查询、不可篡改。

#### 5.1 日志覆盖范围（必须全部记录）

| 操作 | 记录表 | 必须字段 |
|------|--------|---------|
| 学生数据上传（全量/增量） | `system_logs` | action='dorm_upload', target_type='dorm_students', detail=文件名+记录数+成功数+失败数+模式 |
| 学生数据单条修改 | `system_logs` | action='student_update', target_type='student', target_id=学生ID, detail=修改字段摘要 |
| 学生数据单条删除 | `system_logs` | action='student_delete', target_type='student', target_id=学生ID, detail=被删除学生姓名（脱敏） |
| 房间创建 | `system_logs` + `room_logs` | action='room_create', detail=房间码 |
| 房间加入 | `system_logs` | action='room_join', detail=房间码 |
| 房间关闭/过期 | `system_logs` | action='room_close', detail=房间码 |
| 状态变更（单人） | `single_check_records` 已有 + `system_logs` | action='status_change', detail=学生+旧状态→新状态 |
| 状态变更（多人） | `room_logs` 已有 + `system_logs` | action='room_status_change', detail=房间+学生+旧→新 |
| 登录成功 | `login_logs` | status='success', ip, user_agent |
| 登录失败 | `login_logs` | status='failed', fail_reason, ip |
| 敏感词拦截 | `system_logs` | action='sensitive_blocked', detail=拦截位置（chat/room_name） |
| 数据导出 | `system_logs` | action='export', detail=导出类型+记录数 |
| 管理员后台查询 | `system_logs` | action='admin_query', detail=查询类型（不记录返回数据） |
| 角色修改 | `system_logs` | action='role_change', detail=被修改用户+旧角色→新角色 |

#### 5.2 日志字段完整性要求

- 所有日志必须包含：`user_id`, `username`, `role`, `action`, `target_type`, `target_id`, `detail`, `ip`, `user_agent`, `created_at`。
- `room_logs` 表（已有）必须补充：如果当前缺少 `old_status` / `new_status`，需补充并确保每次状态变更时写入。
- `system_logs` 的 `detail` 字段长度限制：SQLite TEXT 无严格限制，但建议超过 500 字符时截断，避免单条日志过大。

#### 5.3 日志查询接口

- `GET /api/admin/logs`：admin 查询系统日志。
  - 查询参数：`action`, `username`, `startDate`, `endDate`, `page`, `pageSize`（默认 20）。
  - 返回：日志列表 + 总条数（用于分页）。
- `GET /api/teacher/logs`：teacher 查询权限范围内的日志。
  - 可查看：`room_logs`（所有房间）、`system_logs` 中 action 为 `room_*` 和 `status_change` 的日志。
  - 不可查看：admin 操作（`dorm_upload`, `role_change`, `student_delete` 等）。
  - 如果权限过滤实现复杂，Phase 5 可先实现 admin 查询，teacher 查询延后到 Phase 6。

#### 5.4 前端展示

- 管理员后台操作日志 Tab 接入 `/api/admin/logs`。
- 表格形式展示，支持按列排序（时间倒序默认）。
- 大量日志时虚拟滚动或分页，禁止一次性渲染 1000+ 条 DOM。
- 日志不可删除：前端不提供删除按钮，后端不提供删除接口。
- 日志保留策略：前端显示最近 90 天，超期数据由管理员手动清理（或后续通过 D1 定时任务清理，当前 Phase 不实现自动清理）。

**验收标准**：
- 任意状态变更可在 3 秒内通过操作日志 Tab 查到对应记录。
- 日志表格渲染 1000 条不卡顿（虚拟滚动或分页）。
- 日志不可删除（前端无删除按钮，后端无删除接口）。
- 所有敏感操作（上传、删除、角色变更）均有日志记录。

---

### Phase 6：教师监管后台、前端密码墙与话术材料（P0）

**目标**：建立教师专用视图，增加前端访问控制，准备向老师汇报的全套材料。

#### 6.1 教师监管后台

- **独立页面**：`teacher.html`（或从 `admin.html` 根据角色动态渲染，但建议独立页面减少权限判断复杂度）。
- **权限**：`role === 'teacher'` 或 `'admin'`。
- **风格**：与 `admin.html` 完全一致的新拟态风格。
- **功能模块**：
  - **全局概览**：新拟态统计卡片，显示：今日查寝房间数、总学生数、各状态人数分布（在寝/离校/事假/外出/未归）。
  - **房间列表**：同 admin 的房间监控 Tab，但 teacher 只能查看不能修改房间状态。
  - **历史查寝**：按日期筛选（新拟态凹陷日期选择器），查看某天的全校或某楼层查寝结果。
  - **报表导出**：接入 Phase 4 的导出功能，teacher 导出时姓名脱敏。
  - **操作日志**：接入 Phase 5 的日志查询，teacher 仅查看房间相关日志。
- **自动刷新**：全局概览每 60 秒自动刷新，房间列表每 30 秒刷新。

#### 6.2 前端密码墙（访问控制）

- **触发条件**：在 `index.html` 加载时，如果满足以下任一条件，则弹出密码墙：
  - `localStorage` 中无有效 `authToken`。
  - `sessionStorage` 中无 `access_password_verified` 标记。
  - URL 是直接访问（非从登录页 `login.html` 跳转而来）。
- **密码墙实现**：
  - 遮罩层：`rgba(26, 29, 60, 0.85)` + `backdrop-filter: blur(12px)`，覆盖整个页面。
  - 密码输入区：新拟态大凸起卡片，中央放置 4 位数字输入框（新拟态凹陷，大字号，每输入一位自动下一位聚焦）。
  - 提示文字："请输入访问密码继续"（次要文字色）。
  - 验证方式：调用 `GET /api/settings/access-password` 或前端硬编码比对（推荐后端验证，密码存储在 `settings` 表）。
  - 验证成功：写入 `sessionStorage.setItem('access_password_verified', '1')`，移除遮罩层，继续加载主界面。
  - 验证失败：输入框抖动（`transform: translateX` 左右晃动 3 次），显示"密码错误"。
  - 忘记密码：显示"请联系管理员"（次要文字）。
- **密码修改**：管理员在系统设置 Tab 修改 `settings.access_password`，即时生效。
- **此功能目的**：全院推广场景下，防止无关人员通过链接直接访问系统，增加一层访问控制。

#### 6.3 话术材料（供用户向老师汇报使用）

需要生成以下 3 份文档，以 Markdown 格式保存到项目 `/docs/` 目录（如 `/docs/teacher-pitch/`）。

**文档 A：项目情况说明（1 页纸）**

- **项目背景**：学生自主开发的晚寝查寝辅助工具，解决传统纸质查寝效率低、易出错、难汇总的问题。零预算开发，使用 Cloudflare 免费服务验证技术可行性。
- **技术架构**：
  - 前端：静态页面托管于 Cloudflare Pages（全球 CDN，国内有节点）。
  - 后端：Cloudflare Workers（边缘计算，延迟低）。
  - 数据库：Cloudflare D1（SQLite，数据存储于境内）。
  - 说明：Cloudflare（NYSE: NET）为纳斯达克上市公司，在中国大陆设有 CDN 节点，用户访问时数据通过国内节点传输，不主动出境。
- **安全举措清单**：
  1. 账号密码 + JWT Token 鉴权，防止未授权访问。
  2. 四级角色权限：学生（只读）、查寝员（可修改）、教师（可审计）、管理员（全权限）。
  3. 敏感词过滤系统：聊天内容实时审核，自动拦截违规词汇。
  4. 数据脱敏：对外接口不暴露完整学生姓名，日志中姓名掩码处理。
  5. 操作日志审计：所有数据变更、登录、导出操作全量记录，可追溯。
  6. 教师监管后台：老师可实时查看全校查寝状态、房间活跃度、历史记录。
  7. HTTPS 强制传输，安全响应头防护。
- **数据说明**：系统仅存储学生姓名、年级、班级、宿舍号、床号、查寝状态，属于弱敏感信息。未涉及身份证号、手机号、家庭住址、成绩等强敏感信息。
- **迁移承诺**：如学校要求正式推广，可在一周内迁移至学校指定服务器（腾讯云/学校机房）并完成 ICP 备案，使用学校子域名（如 `dorm.njpc.edu.cn`），开发者负责技术迁移。

**文档 B：Q&A 预案（老师可能问到的问题）**

| 问题 | 标准回答 |
|------|---------|
| 为什么不用腾讯云/阿里云？ | 学生项目零预算，先用免费服务验证需求和稳定性；如学校决定推广，需要学校提供服务器资源和备案主体，可立即迁移。 |
| 数据是否出境？ | Cloudflare 在中国大陆有 CDN 节点，数据通过国内节点传输；数据库 D1 的存储位置可配置为境内；如学校有顾虑，可迁移至学校内网服务器。 |
| 同学隐私怎么保护？ | 仅存储基础信息（姓名+宿舍），无身份证号/手机号；对外接口全部脱敏显示；操作日志全量审计，任何数据访问留痕。 |
| 谁有权限访问？ | 四级权限：学生只读、查寝员可修改状态、教师可审计查看、管理员可管理数据。所有权限变更记录日志。 |
| 如果系统被攻击怎么办？ | 已启用 HTTPS 强制、JWT 鉴权、边缘函数访问控制；可进一步接入学校 VPN/内网，关闭公网访问。 |
| 聊天记录是否合规？ | 已接入敏感词过滤系统，自动拦截违规内容；聊天仅用于查寝协同，消息不长期存储（房间过期后清理）。 |
| 数据丢了怎么办？ | 支持数据导出备份（Excel）；如迁移到学校服务器，可由学校信息中心统一做数据库备份。 |
| 为什么是一个学生在做？ | 软件开发课程实践 + 互联网+创新创业项目，有指导教师把关，代码经过多轮审核。 |

**文档 C：教师后台使用指南（图文说明）**

- 以 Markdown 格式编写，预留截图占位符（如 `![教师登录页](placeholder-login.png)`）。
- 包含以下章节：
  1. 如何登录（账号由管理员分配，角色为 teacher）。
  2. 如何查看今日查寝概览（全局统计卡片说明）。
  3. 如何查看房间状态（房间列表、房间详情、成员状态）。
  4. 如何导出报表（选择日期范围 → 点击导出 → 下载 Excel）。
  5. 如何查看操作日志（筛选条件说明）。
  6. 常见问题：看不到数据？检查角色是否为 teacher；导出失败？检查网络或联系管理员。

**验收标准**：
- 教师可用 `teacher` 角色账号登录 `teacher.html` 并查看所有房间和历史记录。
- 密码墙在未输入正确密码前阻止 `index.html` 主界面任何内容加载（包括学生名单）。
- 话术材料可直接复制到 Word 或打印，语言正式、无技术黑话。
- 教师导出报表时，姓名列自动脱敏。

---

## 五、通用要求与执行约束

1. **风格零容忍**：`admin.html`、`teacher.html` 以及任何新增页面，必须 100% 遵循第 2 节新拟态规范。禁止出现任何 flat 设计元素（纯色填充按钮、白底卡片、细线边框、蓝色渐变、emoji）。
2. **禁止擅自简化**：如果某需求在技术上存在困难（如 D1 事务支持、大词库前端构建性能、Web Worker 兼容性），必须先告知用户并征求同意，不可自作主张修改方案或降级实现（如把 Trie 树换成正则匹配、把新拟态换成 flat 设计）。
3. **假单解析豁免**：`manualupload.js` 假单文本解析模块**明确不参与敏感词过滤**，保持原有逻辑不变。此条不可变更。
4. **数据库变更**：所有 `ALTER TABLE` / `CREATE TABLE` 操作必须写入 `migrations/v20_admin_enhance.sql`，部署时通过 `npx wrangler d1 execute nightshift-db --local --file=./migrations/v20_admin_enhance.sql` 执行。
5. **缓存版本**：每次部署必须 bump `sw.js` 中的 `CACHE_NAME`（如从 `nightshift-v2026-0607a` 改为 `nightshift-v2026-0608a`），确保用户端强制刷新。
6. **测试验证**：每个 Phase 完成后，必须在本地执行 `npx wrangler pages dev .` 验证通过，再执行 `npx wrangler pages deploy . --commit-dirty=true` 部署到生产。
7. **API 兼容性**：重构 API 时，旧路径 `/api/admin/dorm-upload-json` 至少保留一个版本的向后兼容（或前端同步更新），避免部署后 admin 页面上传功能瞬间不可用。
8. **错误处理**：所有 API 返回统一错误格式：`{ success: false, error: '错误码', message: '人类可读描述' }`，禁止直接返回 SQL 错误或堆栈跟踪。
9. **移动端优先**：admin 和 teacher 后台必须能在手机浏览器正常使用（查寝场景主要用手机），所有按钮最小点击区域 44×44px。
10. **不涉具体代码建议**：本文档仅描述需求、问题与验收标准，不涉及具体函数/代码行的增删改建议。具体实现由执行方根据现有代码结构自行设计。

---

## 六、附件：警校补充敏感词库

以下词汇必须加入敏感词库，保存为 `/sensitive-words/police-supplement.txt`：

```
翻墙
VPN
代理
境外
反动
暴乱
游行
罢课
自杀
自残
涉密
机密
绝密
警务通
数字证书
公安网
内网
```

---

## 七、部署检查清单（每次部署前必须核对）

- [ ] `sw.js` 中 `CACHE_NAME` 已 bump
- [ ] `migrations/v20_admin_enhance.sql` 已在本地 D1 执行并通过
- [ ] 敏感词库文件已复制到 `/sensitive-words/` 并合并为 `merged.txt`
- [ ] 所有新页面（admin.html, teacher.html）已通过新拟态视觉检查（无 flat 元素）
- [ ] 权限中间件已测试：student 无法访问 admin API，teacher 无法上传数据
- [ ] 数据脱敏已验证：非 admin 接口返回的姓名已掩码
- [ ] 登录审计已验证：成功/失败登录均记录到 `login_logs`
- [ ] 本地 `npx wrangler pages dev .` 无报错
- [ ] 生产部署命令：`npx wrangler pages deploy . --commit-dirty=true`
