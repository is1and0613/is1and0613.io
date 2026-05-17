# NightShift V2 优化进度

## 2026-05-18 自动执行记录

### Phase 1: Service Worker 优化
- **状态**: 完成
- **变更**:
  - `sw.js`: 版本化缓存，activate 自动清理旧缓存，fetch 不拦截 navigate 请求
  - `assets/js/utils.js`: 新增 `registerServiceWorker()` / `showUpdateToast()`，自动检测新 SW 并提示刷新
  - 所有页面通过 utils.js 自动注册 SW

### Phase 2: 账户系统（D1 数据库）
- **状态**: 代码完成，待 D1 绑定
- **变更**:
  - `schema.sql`: 6 张表 (users, rooms, room_members, room_states, room_logs, room_messages)
  - `functions/api/auth.js`: 重写为 D1 登录/注册，PBKDF2 密码哈希，30 天惰性过期，临时账户 chaqin/123456
  - `functions/api/room.js`: 新建，支持 create/join/sync/state/message
  - `functions/api/_utils.js`: 新增 `hashPassword()` / `verifyPassword()` / `dbGuard()` / `signJWT()`
  - `login.html/js`: 用户名+密码登录/注册
- **阻塞**: 需用户创建 D1 并绑定 env.DB，然后执行 `schema.sql`

### Phase 3: 报告格式精简 + 实习开关
- **状态**: 完成
- **变更**:
  - 删除 `generateInternshipReportText()` / `generateInternshipVacationReportText()`
  - 3 种报告（请假版/在校版/假期版）均支持实习学生过滤
  - 新增"包含实习学生"Toggle（2023级=实习），默认关闭
  - `index.css`: `.intern-toggle` / `.toggle-switch` 样式

### Phase 4: 多人查寝模式
- **状态**: 代码完成，待 D1 绑定
- **变更**:
  - `index.html`: 模式选择遮罩、房间大厅、房间视图、聊天/日志抽屉、浮动消息按钮
  - `assets/js/room.js`: 模式选择、创建/加入房间、30s 轮询同步、乐观状态更新
  - `assets/css/room.css`: 全部房间 UI 样式
- **限制**: 消息非即时（30s 轮询），状态以最后写入为准

### Phase 5: 展示方式升级（列表+卡片+滑动）
- **状态**: 完成
- **变更**:
  - `index.js`: 新增 `toggleViewMode()` / `renderCardView()` / 触摸滑动处理
  - `index.html`: 列表/卡片视图切换按钮
  - `index.css`: `.view-toggle-bar` / `.card-view-container` / `.card-nav-top` 等
  - 支持 Touch swipe 切换宿舍，垂直滚动不冲突，左右箭头辅助

### Phase 6: UI 去 Emoji + 冲突排查
- **状态**: 完成
- **变更**:
  - `manual-upload.js`: ✓ → `<i class="fas fa-check"></i>`，▼/▲ → `<i class="fas fa-chevron-down/up"></i>`
  - `theme.css`: body 添加 `touch-action: manipulation`、`overflow-x: hidden`
  - `theme.css`: bottom-bar 添加 `safe-area-inset-bottom` 适配
  - 全项目 emoji 扫描：0 残留
  - z-index 层级审查：Loading < Modal < Toast < Drawer — 合理
  - 颜色对比度：`#2C436F` on `#EAF0E2` 通过 WCAG AA

### Phase 7: 部署 Checklist
- **状态**: 完成
- **变更**:
  - `sw.js`: 版本号更新为 `nightshift-v2026-0518-a`
  - `.gitignore`: node_modules / .dev.vars / .wrangler 已配置
  - `DEPLOY.md`: 新增 D1 配置章节、Deploy 前检查清单、更新文件结构

---

## 用户待办

1. **创建 D1 数据库**：Cloudflare Dashboard → D1 → 创建 `nightshift-db`
2. **绑定 D1**：Pages 项目 → Settings → Functions → D1 bindings → 变量名 `DB`
3. **初始化表结构**：在 D1 控制台执行 `schema.sql`
4. **部署**：`npm run deploy` 或 push 到 Git
5. **验证**：用临时账户 `chaqin` / `123456` 登录，测试单人/多人模式
