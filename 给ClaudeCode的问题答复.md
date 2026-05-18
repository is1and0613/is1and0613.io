# 给用户（Claude Code 执行者）的问题答复与执行策略

> 来源：Kimi 对用户 5 个问题的答复，以及用户补充要求（不要手动确认、自动按 Phase 执行）。
> 执行原则：用户已入睡，要求一觉起来看到成果。按 Phase 顺序自动推进，遇阻塞记录问题并继续，不要卡住等回复。

---

## 问题 1：Cloudflare D1 是否已配置？

**答复：未配置。先写代码，后续用户手动绑定。**

- 当前项目无 D1 数据库，无 wrangler.toml，用户也未在 Dashboard 创建 D1。
- **代码先行策略**：所有 D1 相关 API 代码正常写，通过 env.DB 访问。
- **本地开发兼容**：在 functions/api/_utils.js 或各 API 顶部加一层防御：
  ```js
  if (!env.DB) {
    return errorResponse('数据库未配置，请联系管理员', 503);
  }
  ```
  这样本地 npx wrangler pages dev 不会 crash，只是提示未配置。
- **部署后状态**：用户醒来后会看到 D1 相关的功能（注册/登录/房间）返回"数据库未配置"，这是预期行为。用户需要手动去 Dashboard 创建 D1 -> 绑定 -> 执行初始化 SQL，之后功能自动生效。
- **初始化 SQL**：保留在 DEPLOY.md 或单独 schema.sql 中，用户醒来后执行。

---

## 问题 2：优先级和节奏

**答复：不要用户手动确认，按 Phase 1->2->3->4->5->6 自动顺序执行。**

- 用户明确："不要我手动确认因为我要睡觉了，我希望我一觉起来能看见它把该做的都做了"。
- **执行策略**：
  1. 按 Phase 1（SW 优化）-> Phase 2（账户系统+D1 代码）-> Phase 3（报告+实习开关）-> Phase 4（多人查寝）-> Phase 5（滑动切换）-> Phase 6（去 Emoji+UI 修冲突）顺序推进。
  2. 每个 Phase 完成后，**自动执行 npm run deploy** 部署到线上（或至少本地 npx wrangler pages dev 验证无语法错误）。
  3. **遇阻塞不卡住**：如果某 Phase 因缺少依赖（如 D1 未绑定导致 API 500）无法完全测试，记录问题在 PROGRESS.md，继续推进下一个 Phase。不要 sleep 等用户回复。
  4. 每个 Phase 结束后，在 PROGRESS.md 写一行状态：
     ```
     Phase 1: 完成，已部署，SW 版本号已更新为 v2026-0517-a
     Phase 2: 代码完成，API 因 D1 未绑定返回 503，待用户绑定后自动恢复
     ...
     ```

---

## 问题 3：报告格式矛盾（用户纠正）

**答复：保留 3 种，用户已纠正笔误。**

- **保留**：
  1. **在校版**（present）
  2. **请假版**（absent/leave，含事由）
  3. **假期版**（vacation，长假/寒暑假）
- **删除**：
  - internship（实习版）
  - internshipVacation（实习假期版）
- **新增**：**实习开关**（Toggle）
  - 开启：在以上 3 种报告中，把 is_intern = 1 的学生单独分区列出（如"实习学生"区块），或纳入统计但标注"(实习)"。
  - 关闭：is_intern = 1 的学生完全排除，不计入应到/实到/未到人数。
- **数据来源**：is_intern 字段。如果 dorm-data API（Supabase）暂时没有此字段，**先在前端通过年级规则判断**（如学号前两位或年级字段 === '大三' 且专业含'实习'关键词），后续用户再要求迁移到后端。不要阻塞 Phase 3。

---

## 问题 4：单人 vs 多人模式状态管理

**答复：两套并行，不要统一为 D1。**

- **单人模式**：保持现有 localStorage 状态管理，零改动或最小改动。单人查寝是快速本地操作，不需要网络同步，用户可能弱网环境使用。
- **多人模式**：走 D1 room_states 表，通过 API 同步。
- **抽象层建议（可选）**：在 assets/js/common.js 中加一个轻量封装：
  ```js
  async function setStudentStatus(student, status, mode, roomCode?) {
    if (mode === 'single') {
      // 写 localStorage
    } else {
      // POST /api/room/:code/state
    }
  }
  ```
  但这不是强制的，如果改动量大，直接两套逻辑分别写在 index.js（单人）和 room.js（多人）里也可以。
- **关键边界**：单人模式不创建房间、不生成校验码、不走任何 D1 API。登录后选"单人查寝"直接进入现有 index.html 逻辑。

---

## 问题 5：dorm-data API 的未来与 Supabase

**答复：Supabase 暂时不动，dorm-data 继续作为数据源。**

- **现状**：dorm-data.js 从 Supabase 拉取宿舍名单。这个链路稳定，不要动。
- **创建房间时**：POST /api/room/create 内部调用现有的 dorm-data 逻辑（或直接复用其 Supabase 查询代码），获取当前宿舍楼名单，批量写入 D1 room_states。
- **is_intern 字段**：
  - 如果 Supabase 表已有此字段，dorm-data API 直接返回，前端/后端都用。
  - 如果 Supabase 没有，**先不动 Supabase 表结构**（避免用户醒来后发现数据层被改乱）。在前端通过年级/学号规则硬编码判断：
    ```js
    function isInternStudent(student) {
      // 示例：学号 23 开头且年级为大三
      return student.grade === '大三' || student.id?.startsWith('23');
    }
    ```
  - 后续用户如需精确控制，会主动要求改 Supabase 表。
- **D1 与 Supabase 分工**：
  - Supabase：宿舍基础数据（姓名、宿舍号、床位）—— 只读数据源
  - D1：账户、房间、房间状态、日志、消息 —— 业务数据

---

## 附加执行策略（关键）

### 1. 代码防御性编程
所有新增 API 必须兼容 D1 未绑定的情况：
```js
export async function onRequestPost(context) {
  const { env } = context;
  if (!env.DB) {
    return errorResponse('数据库服务暂未开通，请稍后重试', 503);
  }
  // ... 正常逻辑
}
```
这样用户醒来看到"数据库未配置"提示，知道要去绑 D1，而不是看到 500 Internal Server Error 一脸懵。

### 2. 文件组织
- 新增 functions/api/room.js：包含 create/join/sync/state/message 所有房间相关 API（用 URL path 或 query 参数区分动作，减少文件数量）。
- 新增 functions/api/auth.js：改造现有 auth，增加 register/login/refresh，接入 D1。
- 新增 assets/js/room.js：多人查寝前端逻辑。
- 新增 assets/css/room.css：多人查寝样式。
- 模式选择页：复用 index.html 或新建 mode-select.html？建议复用 index.html，登录后先显示模式选择覆盖层，选模式后再渲染主界面。

### 3. 临时账户初始化
在 functions/api/auth.js 的注册逻辑中，加一个启动时检测（或在 schema.sql 中）：
```sql
-- 初始化时执行
INSERT OR IGNORE INTO users (username, password_hash, display_name, is_temp, last_login_at)
VALUES ('chaqin', '$2b$10$...', '临时账户', 1, CURRENT_TIMESTAMP);
```
密码哈希用 bcrypt 或 Web Crypto PBKDF2 生成。如果本地开发没有 bcrypt 库，可用简单的 HMAC-SHA256 代替，但生产环境建议 bcrypt。

### 4. 去 Emoji 全局策略
用以下正则全局搜索项目：
```
/[\u{1F300}-\u{1F9FF}]/gu
```
或人工抽查重点文件：
- assets/js/utils.js（Toast 图标）
- assets/js/index.js（状态标记）
- assets/js/upload.js（上传状态）
- assets/js/manual-upload.js（假单类型）
- 所有 HTML 文件
替换方案：Phosphor Icons CDN（<script src="https://unpkg.com/@phosphor-icons/web"></script>，使用 <i class="ph ph-check"></i>），或内联 SVG。

### 5. 进度记录
每完成一个 Phase，在 PROGRESS.md 记录：
```markdown
## 2026-05-17 自动执行记录

### Phase 1: SW 优化
- 状态: 完成
- 变更: sw.js 版本号 v2026-0517-a，activate 自动清理旧缓存，fetch 不拦截 navigate 请求
- 部署: 已 deploy
- 验证: 电脑端/手机端访问正常

### Phase 2: 账户系统
- 状态: 代码完成，待 D1 绑定
- 变更: 新增 users 表 API，JWT 鉴权改造，临时账户 chaqin/123456
- 部署: 已 deploy（API 返回 503 数据库未配置，预期行为）
- 阻塞: 需用户创建 D1 并绑定 env.DB

...
```

---

**总结：按 Phase 顺序自动推进，代码兼容 D1 未绑定状态，Supabase 不动，报告保留 3 种+实习开关，单人/双人状态管理两套并行，去 Emoji 用 Phosphor/SVG。用户醒来检查 PROGRESS.md 即可知道哪些已完成、哪些需手动配置。**
