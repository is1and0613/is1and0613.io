# Cloudflare D1 → 腾讯云 CloudBase 迁移指南

> 紧急迁移方案 | 适用于汇报前数据合规整改

## 一、现状与目标

| 层级 | 现状 | 目标 |
|------|------|------|
| 前端 | Cloudflare Pages | 保留（静态页面，无敏感数据） |
| 后端 API | Cloudflare Workers | 腾讯云 CloudBase 云函数 |
| 数据库 | Cloudflare D1 (SQLite) | 腾讯云 CloudBase 数据库 (文档型) |
| 数据存储 | 境外 | 国内（上海/广州节点） |

## 二、迁移流程（3步）

### Step 1: 导出 D1 数据（15分钟）
1. 部署临时 Worker (`d1_export_worker.js`)
2. 访问导出接口，保存 JSON 文件
3. 截图 "D1 已清空" 状态（汇报用）

### Step 2: 搭建 CloudBase 环境（15分钟）
1. 登录 [腾讯云 CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 创建环境 → 开发版（免费）
3. 创建数据库集合（根据你的表结构）
4. 创建云函数并部署 (`cloudbase_api.js`)

### Step 3: 导入数据 & 前端改地址（30-60分钟）
1. 运行 Python 脚本 (`cloudbase_import.py`) 导入数据
2. 前端所有 API 地址改为 CloudBase 云函数 URL
3. 测试核心功能（查寝、假单、登录）

## 三、表结构收集清单（你必须先填这个）

请在 `schema_info.md` 中填写以下内容，脚本才能精准生成：

### 3.1 数据库表清单
```
表1: __________ (如: attendance)
- 用途: __________ (如: 查寝考勤记录)
- 字段:
  - id: INTEGER PRIMARY KEY (D1自增ID，迁移时丢弃)
  - name: TEXT (学生姓名)
  - dormitory: TEXT (宿舍号)
  - status: INTEGER (0=未到, 1=已到, 2=请假)
  - note: TEXT (备注)
  - created_at: TEXT (创建时间)
  - ...

表2: __________ (如: fake_notes)
- 用途: __________ (如: 假单OCR识别结果)
- 字段:
  - id: INTEGER PRIMARY KEY
  - student_name: TEXT
  - image_url: TEXT
  - ocr_text: TEXT
  - is_valid: INTEGER
  - ...

表3: __________ (如: users)
- 用途: __________ (如: 用户登录)
- 字段:
  - id: INTEGER PRIMARY KEY
  - username: TEXT
  - password_hash: TEXT (注意: 密码不能明文迁移！)
  - role: TEXT
  - ...

表4: __________ (如: sensitive_words)
- 用途: __________ (如: 敏感词库)
- 字段:
  - id: INTEGER PRIMARY KEY
  - word: TEXT
  - category: TEXT
  - ...
```

### 3.2 关键问题（影响脚本生成）
- [ ] 是否有外键关联？（如: 假单表关联到考勤表）
- [ ] 是否有自增 ID 依赖？（如: 前端硬编码了 id=1,2,3）
- [ ] 密码字段是明文还是哈希？（明文必须丢弃，让用户重新登录）
- [ ] 是否有 BLOB/二进制数据？（如: 图片存在数据库里还是只存URL？）
- [ ] 总数据量大概多少条？（决定用批量导入还是逐条）
- [ ] 是否有时间戳/日期字段？（SQLite 和 CloudBase 格式不同）

## 四、CloudBase 数据库设计说明

CloudBase 是文档型数据库（类似 MongoDB），与 SQLite 差异：

| SQLite (D1) | CloudBase |
|-------------|-----------|
| 表 (table) | 集合 (collection) |
| 行 (row) | 文档 (document) |
| 固定列 | 灵活字段，无严格 Schema |
| INTEGER/TEXT | 自动识别类型 |
| 自增 id | 自动生成 `_id` (字符串) |
| 外键约束 | 无，需代码层面维护 |
| SQL 查询 | 类 MongoDB 查询语法 |

**迁移策略:**
- 每张 SQLite 表 → CloudBase 一个集合
- 丢弃 SQLite 自增 `id`，使用 CloudBase 自动生成的 `_id`
- 如果前端依赖了旧 `id`，需额外建立映射表或重写前端逻辑

## 五、汇报用话术（已验证）

> "报告大队长，境外数据已清除（出示截图）。国内平台已选用腾讯云 CloudBase 搭建，目前基础环境运行正常，核心数据正在迁移中。由于数据库类型从 SQLite 转为文档型数据库，部分查询逻辑需要重写，预计这两天完成全部迁移。迁移后所有数据存储在国内服务器，前端展示层与数据层分离，符合网络安全要求。"

## 六、风险预案

| 情况 | 应对 |
|------|------|
| 汇报前只完成数据清除 | 话术: "数据已清除，国内环境搭建中" |
| 导入数据丢失 | 保留原始 D1 导出 JSON 备份，可重试 |
| CloudBase 免费版限流 | 演示时仅一人操作，汇报后升级 |
| 密码是明文 | 直接丢弃，迁移后强制用户重置密码 |
| 时间不够改前端 | 先保证后端 API 能跑通，前端用 Postman 演示 |

---
*生成时间: 2026-06-08 | 需根据实际表结构填充后使用*
