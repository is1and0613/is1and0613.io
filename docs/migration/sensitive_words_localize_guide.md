# 紧急任务：前端敏感词库本地化（绕过 CloudBase 限制）

## 背景
- 系统原从 Cloudflare KV 加载敏感词库（`SENSITIVE_WORDS` namespace）
- 数据库正在迁移到腾讯云 CloudBase，但 CloudBase 体验版无法一次性写入 470KB 词库
- **敏感词过滤是内容安全红线，必须保证明天汇报时 100% 可用**
- 解决方案：**把词库作为静态文件打包进前端，本地加载过滤**

## 任务目标
1. 把 `sensitive-words/merged.txt` 复制到前端可访问的静态目录
2. 修改前端加载敏感词的代码，从本地文件读取（不再依赖 KV/API）
3. 重新部署 Cloudflare Pages
4. 部署后验证敏感词过滤功能正常

## 操作步骤

### Step 1: 复制词库到前端静态目录

在项目根目录执行（PowerShell）:
```powershell
# 如果 public/assets 目录不存在，先创建
New-Item -ItemType Directory -Force -Path "publicssets"

# 复制词库
Copy-Item "sensitive-words\merged.txt" "publicssets\sensitive_words.txt"

# 验证文件大小（应该在 400-500KB 左右）
Get-Item "publicssets\sensitive_words.txt" | Select-Object Name, Length
```

> 如果项目没有 `public/` 目录，直接复制到 `assets/` 或项目根目录。

### Step 2: 修改前端加载逻辑

**全局搜索**以下关键词，找到加载敏感词的代码：
- `sensitive_words`
- `trie-filter`
- `trieFilter`
- `SENSITIVE_WORDS`
- `fetch.*words`
- `KV`

**常见模式识别：**

**模式 A：从 KV 加载（原来）**
```javascript
// 原来可能是这样：
const words = await fetch('/api/settings?sensitive_words').then(r => r.text());
// 或
const words = await fetch('https://.../api/settings').then(...);
```

**改成从本地文件加载：**
```javascript
// 新写法：
const words = await fetch('/assets/sensitive_words.txt').then(r => r.text());
```

**模式 B：从 API 获取 JSON 格式**
```javascript
// 原来：
const res = await fetch('/api/settings');
const data = await res.json();
const words = data.sensitive_words;
```

**改成：**
```javascript
// 新写法：
const words = await fetch('/assets/sensitive_words.txt').then(r => r.text());
```

**模式 C：如果有缓存/版本逻辑**
```javascript
// 原来：
const version = localStorage.getItem('words_version');
const words = await fetchWords(version);
```

**改成：**
```javascript
// 新写法：直接加载本地文件，不再缓存版本
const words = await fetch('/assets/sensitive_words.txt').then(r => r.text());
```

### Step 3: 确认 trie-filter.js 构建逻辑

找到 `trie-filter.js` 或相关过滤逻辑，确认：
1. 词库是换行分隔的（`\n`）
2. 构建 Trie 的代码不需要修改，只需要改输入源

**如果词库加载后需要处理：**
```javascript
// 加载词库
const wordsText = await fetch('/assets/sensitive_words.txt').then(r => r.text());
const words = wordsText.split('\n').filter(w => w.trim());

// 构建 Trie（原有逻辑不变）
const trie = buildTrie(words);
```

### Step 4: 重新部署

```bash
# 在项目根目录
npx wrangler pages deploy . --commit-dirty=true
```

> 如果项目用 git 管理，先 commit 再 push，Cloudflare Pages 会自动重新部署。

### Step 5: 验证

部署后，浏览器打开 `https://niteshift.cn`，执行：
1. F12 → Network → 刷新页面
2. 搜索 `sensitive_words.txt`，确认请求状态 200，大小 400-500KB
3. 在密码墙或查寝页面输入含敏感词的内容，确认过滤生效（如输入"测试"应该正常，输入词库里的词应该被拦截或替换）
4. Console 里没有 `trie-filter` 或 `sensitive_words` 相关报错

## 注意事项
1. **不要删原来的 KV 相关代码**，先注释掉或保留备用，等 CloudBase 稳定后再切
2. **本地文件路径**必须是 `/assets/sensitive_words.txt`（如果放在 `public/assets/` 下）
3. **如果项目结构不同**（没有 `public/` 目录），把文件放在 `assets/` 或根目录，路径相应调整
4. **部署后如果 404**，检查文件是否真的在部署包里（Cloudflare Pages 部署日志）

## 汇报话术（如果问到敏感词）
> "系统具备完整的敏感词过滤功能，词库本地部署，不依赖外部服务，确保内容安全合规。"

## 执行确认
完成以上步骤后，回复：
1. 文件复制路径：`public/assets/sensitive_words.txt`（或其他路径）
2. 修改的文件名和代码行数
3. 部署是否成功
4. 浏览器验证结果（Network 截图 + 过滤测试是否通过）
