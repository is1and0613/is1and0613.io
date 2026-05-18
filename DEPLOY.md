# Cloudflare Pages 部署说明

本项目已从 Vercel 迁移到 **Cloudflare Pages + Pages Functions**。

---

## 一、前置准备

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

按提示在浏览器中授权即可。

---

## 二、环境变量清单

在 Cloudflare Dashboard → Pages → 项目设置 → **Environment variables** 中，填入以下变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `JWT_SECRET` | JWT 签名密钥（任意长字符串） | `your-random-secret-key-123` |
| `ADMIN_PASSWORD` | 管理员登录密码 | `your-admin-password` |
| `BAIDU_OCR_API_KEY` | 百度 OCR API Key | `your-baidu-api-key` |
| `BAIDU_OCR_SECRET_KEY` | 百度 OCR Secret Key | `your-baidu-secret-key` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | `sk-xxxxxxxxxxxxxxxx` |

> ⚠️ **注意**：所有变量都需要在 **Production** 环境下配置。如果需要在本地预览时也使用变量，可在 `.dev.vars` 文件中添加（格式：`KEY=VALUE`，每行一个）。

---

## 三、部署步骤

### 方式一：命令行部署

```bash
# 本地预览（可选）
npm run dev

# 部署到 Cloudflare Pages
npm run deploy
```

首次部署时，wrangler 会提示创建 Pages 项目，按提示选择即可。

### 方式二：Git 集成自动部署（推荐）

1. 在 Cloudflare Dashboard → Pages → **Create a project**
2. 选择 **Connect to Git**，绑定 GitHub 仓库
3. 构建设置：
   - **Framework preset**: `None`
   - **Build command**: 留空（纯静态站点，无需构建）
   - **Build output directory**: 留空（根目录即为输出目录）
4. 保存并部署

每次推送到默认分支时，Cloudflare 会自动重新部署。

---

## 四、绑定自定义域名 `niteshift.cn`

1. 在 Cloudflare Dashboard → Pages → 你的项目 → **Custom domains**
2. 点击 **Set up a custom domain**
3. 输入 `niteshift.cn`，点击 **Continue**
4. Cloudflare 会自动检测 DNS 记录：
   - 如果域名已在 Cloudflare DNS 管理，系统会提示添加一条 **CNAME** 记录指向你的 Pages 项目（如 `nightshift-dorm-check.pages.dev`）
   - 按提示添加 DNS 记录
5. ⚠️ **重要**：添加 DNS 记录时，请保持 **Proxied 状态为关闭（灰色云）**，Pages 自带 CDN，不需要额外开启 Proxied/橙色云
6. 等待 SSL 证书颁发（通常几分钟内完成）

---

## 五、D1 数据库配置（多人查寝功能必须）

### 1. 创建 D1 数据库

在 Cloudflare Dashboard → **Workers & Pages** → **D1** → **Create database**：
- 数据库名称：`nightshift-db`（或任意名称）

### 2. 绑定 D1 到 Pages 项目

在 Cloudflare Dashboard → Pages → 你的项目 → **Settings** → **Functions** → **D1 database bindings**：
- 变量名：`DB`
- D1 数据库：选择刚创建的 `nightshift-db`

### 3. 初始化表结构

在 Cloudflare Dashboard → D1 → 你的数据库 → **Console**，执行 `schema.sql` 中的全部 SQL 语句。

或使用 Wrangler CLI：
```bash
wrangler d1 execute nightshift-db --file=schema.sql
```

### 4. 验证

访问登录页，使用临时账户 `chaqin` / `123456` 登录。若能成功登录并进入模式选择页，说明 D1 配置正确。

> 若 D1 未绑定，登录/注册 API 将返回 503 "数据库服务暂未开通"，单人查寝模式不受影响。

---

## 六、项目结构说明

```
.
├── functions/api/          # Cloudflare Pages Functions（后端 API）
│   ├── _utils.js           # 共享工具（JWT/密码/响应模板）
│   ├── auth.js             # 登录/注册（D1 账户系统）
│   ├── admin/              # 管理员 API
│   │   └── dorm-upload-json.js  # 宿舍数据上传（全量替换）
│   ├── room.js             # 多人查寝房间（创建/加入/同步/状态/消息）
│   ├── dorm-data.js        # 宿舍数据查询（D1）
│   ├── baidu-ocr.js        # 百度 OCR（文件上传版）
│   ├── ocr.js              # 百度 OCR（主入口）
│   ├── deepseek-clean.js   # DeepSeek 文本清洗
│   └── smart-group.js      # DeepSeek 智能分组
├── schema.sql              # D1 数据库初始化脚本
├── index.html              # 前端页面（单人/多人模式）
├── login.html              # 登录/注册页
├── upload.html             # 上传假单页
├── manual-upload.html      # 手动输入假单页
├── admin.html              # 管理后台（宿舍数据上传）
├── sw.js                   # Service Worker
└── package.json
```

- `functions/api/*.js` 会自动映射到 `/api/*` 路由，前端调用路径无需修改

---

## 七、Deploy 前检查清单

每次部署前确认：
1. **SW 版本号** 已更新（`sw.js` 中的 `CACHE_NAME`）
2. **D1 Bindings** 已在 Cloudflare Dashboard 配置（变量名 `DB`）
3. **环境变量** `.dev.vars` 与线上 Dashboard 一致
4. **node_modules 不在 git 中**（`.gitignore` 已配置）
5. **临时账户** `chaqin` / `123456` 可登录
6. **单人/多人模式切换** 流畅
7. **无 Emoji** 残留（全局搜索验证）

---

## 八、常见问题

### Q: 本地开发时环境变量怎么配置？

在项目根目录创建 `.dev.vars` 文件：

```
JWT_SECRET=dev-secret
ADMIN_PASSWORD=dev-password
BAIDU_OCR_API_KEY=your-key
BAIDU_OCR_SECRET_KEY=your-secret
DEEPSEEK_API_KEY=sk-...
```

然后运行 `npm run dev` 即可。

### Q: 部署后 API 返回 404？

请确认：
1. `functions/api/` 目录已提交到 Git
2. Cloudflare Pages 构建设置中 **Root directory** 为项目根目录（不是子目录）
3. 如果使用了 Git 集成，确保 `functions/` 目录在仓库根目录下

### Q: 百度 OCR 或 DeepSeek API 调用失败？

检查 Cloudflare Dashboard → Pages → 项目 → **Functions** → **Logs**，查看实时日志。常见问题：
- 环境变量未设置或拼写错误
- API Key 已过期或额度不足
- 请求超时（Cloudflare Workers 单次请求限制为 30/50 秒，视计划而定）

---

## 九、迁移总结

| 原 Vercel 配置 | 新 Cloudflare Pages 配置 |
|----------------|--------------------------|
| `api/*.js` | `functions/api/*.js` |
| `process.env.XXX` | `context.env.XXX` |
| `export default handler(req, res)` | `export async function onRequest(context)` |
| `req.body` / `req.headers` | `context.request.json()` / `context.request.headers.get(...)` |
| `res.status(...).json(...)` | `new Response(JSON.stringify(...), {status, headers})` |
| `formidable` + `fs` 文件上传 | 原生 `FormData` + `ArrayBuffer` |
| `openai` SDK | 原生 `fetch` 调用 REST API |
| `jsonwebtoken` | Web Crypto API (`crypto.subtle`) |
| `vercel.json` | 已删除（Cloudflare Pages 自动路由） |
