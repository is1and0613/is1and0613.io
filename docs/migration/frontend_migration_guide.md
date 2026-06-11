# NightShift 前端 API 替换指令

## 目标
把前端所有调用旧 Cloudflare Worker API (`fetch('/api/xxx')`) 改成调用新 CloudBase API (`apiRequest(path, payload)`)。

## 操作范围
修改以下文件中的所有 `fetch` 调用：
- `index.html`
- `login.html`
- `admin.html`
- `upload.html`
- `manual-upload.html`
- 以及任何 `.js` 文件

## 新增文件
在 `index.html` 同级目录新建 `api-client.js`，内容如下：

```javascript
const API_BASE = 'https://nightshift-d0gong2x832b1270e-1412242998.ap-shanghai.app.tcloudbase.com/api';

async function apiRequest(path, payload = {}) {
    const resp = await fetch(API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (sessionStorage.getItem('token') || localStorage.getItem('token') || '')
        },
        body: JSON.stringify({ path, ...payload })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
}

// 快捷接口
async function getRoomByCode(code) { return apiRequest('/api/roomByCode', { data: { code } }); }
async function getRoomMembers(room_id) { return apiRequest('/api/roomMembers', { data: { room_id } }); }
async function getRoomStates(room_id) { return apiRequest('/api/roomStates', { data: { room_id } }); }
async function getRoomLogs(room_id) { return apiRequest('/api/roomLogs', { data: { room_id } }); }
async function getRoomMessages(room_id) { return apiRequest('/api/roomMessages', { data: { room_id } }); }
async function createRoom(data) { return apiRequest('/api/add', { collection: 'rooms', data }); }
async function getDormByFloor(floor) { return apiRequest('/api/dormByFloor', { data: { floor } }); }
async function getDormByName(dorm_name) { return apiRequest('/api/dormByName', { data: { dorm_name } }); }
async function getSingleCheck(user_id, check_date) { return apiRequest('/api/singleCheckByUserDate', { data: { user_id, check_date } }); }
async function getSettings() { return apiRequest('/api/settings'); }
async function updateSetting(key, value) { return apiRequest('/api/updateSetting', { data: { key, value } }); }
async function getGradeMapping() { return apiRequest('/api/gradeMapping'); }
async function getCheckRecords(session_id) { return apiRequest('/api/checkRecords', { data: { session_id } }); }
async function listCollection(collection, where = {}, limit = 100, skip = 0) { return apiRequest('/api/list', { collection, where, limit, skip }); }
async function updateDoc(collection, _id, data) { return apiRequest('/api/update', { collection, data: { _id, ...data } }); }
async function deleteDoc(collection, _id) { return apiRequest('/api/delete', { collection, data: { _id } }); }
async function addBatch(collection, data) { return apiRequest('/api/addBatch', { collection, data }); }
async function getUserByUsername(username) { return apiRequest('/api/userByUsername', { data: { username } }); }
```

在 `index.html` 的 `<head>` 中加入：
```html
<script src="api-client.js"></script>
```

## 替换规则

### 规则 1：GET 查询（带 query string）
旧代码：
```javascript
fetch('/api/room?code=' + encodeURIComponent(code))
```
新代码：
```javascript
getRoomByCode(code)
```

### 规则 2：GET 查询（带 action 参数）
旧代码：
```javascript
fetch('/api/room?action=members&room_id=' + roomId)
```
新代码：
```javascript
getRoomMembers(roomId)
```

### 规则 3：POST 创建
旧代码：
```javascript
fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'xxx', creator_id: 1 })
})
```
新代码：
```javascript
createRoom({ code: 'xxx', creator_id: 'new_user_id', status: 'active' })
```

### 规则 4：通用列表查询（管理后台）
旧代码：
```javascript
fetch('/api/admin/users?page=1')
```
新代码：
```javascript
listCollection('users', {}, 100, 0)
```

### 规则 5：登录相关
旧代码：
```javascript
fetch('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', username: 'xxx', password: 'xxx' })
})
```
新代码：
```javascript
getUserByUsername(username).then(res => {
    const user = res.data;
    // 本地验密码（保留现有 PBKDF2 逻辑）
    // verifyPassword(password, user.password_hash).then(valid => { ... })
})
```

### 规则 6：删除操作
旧代码：
```javascript
fetch('/api/admin/student-delete', {
    method: 'POST',
    body: JSON.stringify({ id: 123 })
})
```
新代码：
```javascript
deleteDoc('dorm_students', 'cloudbase_doc_id')
```

## 注意事项
1. **所有 `fetch('/api/...')` 都必须替换**，不能遗漏
2. **JWT token 的获取/存储逻辑不变**，`api-client.js` 已经兼容 `sessionStorage` 和 `localStorage`
3. **密码验证逻辑暂时保留在本地**，CloudBase 不存 `password_hash`，登录时先查用户，再本地验密码（PBKDF2）
4. **旧的用户 ID（整数）要换成新的 `_id`（字符串）**，如果前端有硬编码 `user_id = 1` 的地方，需要改成从 JWT payload 里取
5. **CloudBase 的 `_id` 是字符串**，如果前端有 `typeof id === 'number'` 的判断，要改成 `typeof id === 'string'`

## 执行步骤
1. 先全局搜索 `fetch('/api/` 和 `fetch("/api/`，列出所有出现位置
2. 按上述规则逐个替换
3. 替换完后全局搜索 `fetch('/api/` 确认没有遗漏
4. 在浏览器控制台测试 `getRoomByCode('xxx')` 看是否能正常返回
