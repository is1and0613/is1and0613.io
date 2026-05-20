# NIGHTSHIFT 查寝系统 — 查寝现场 Bug 修复与交互优化完整文档（基于代码 pinpoint 版）

**项目**：NIGHTSHIFT 查寝系统  
**代码依据**：`manual-upload.js` 现场分析  
**目标**：修复 2 个核心 Bug + 5 项交互优化

---

## Bug 1：假单上传事由映射异常 — 多命中 + 遍历顺序混乱 + 无优先级

### 根因（基于 `manual-upload.js` 代码 pinpoint）

**问题 1：`reasonKeywords` 使用 Object，遍历顺序不可靠**
```javascript
const reasonKeywords = {
  '数分': '数分', '网安': '网安', '阿sir': '阿sir', ...
  '请假离校': 'leaveSchool', '离校': 'leaveSchool', ...
  '事假': 'leaveInside', '假': 'leaveInside'  // ← 这个最危险
};
```
`detectReason()` 使用 `for (const [keyword, mapped] of Object.entries(reasonKeywords))` 遍历。  
Object.entries 的遍历顺序虽然现代引擎通常保持插入顺序，但**不保证**，且 `'假': 'leaveInside'` 这个极短关键词会大面积误触发。

**问题 2：`'假': 'leaveInside'` 是贪婪匹配炸弹**
任何包含"假"字的文本（如"请假离校""请假外出""假单"）都会先被 `'假': 'leaveInside'` 捕获，如果遍历顺序中它在 `'请假离校': 'leaveSchool'` 之前，就会返回 `leaveInside` 而非 `leaveSchool`。

**问题 3：`includes` 匹配无边界**
```javascript
if (lower.includes(keyword.toLowerCase())) { return ... }
```
`'网安'` 会匹配 `"网安工作室"`，`'离校'` 会匹配 `"请假离校"`，这没问题。但 `'假'` 会匹配 `"请假离校"`、`"请假外出"`、`"假单"`、`"假如"` 等一切含"假"的文本。

**问题 4：无优先级机制**
`detectReason` 一旦命中就立即 `return`，没有"离校 > 外出 > 事假"的优先级分层。`parseLine` 和 `parseSectionHeader` 都依赖 `detectReason`，所以整条解析链都受影响。

**问题 5：后端 `/api/smart-group` 可能复用了同样逻辑**
前端先调后端 API，失败后才 fallback 到本地解析。如果后端也用了同样的 `reasonKeywords` 对象遍历，问题会一致出现。

### 修复方向

1. **删除 `'假': 'leaveInside'` 这个关键词**：它太宽泛，没有精确性。保留 `'事假': 'leaveInside'` 即可。

2. **将 `reasonKeywords` 改为有序数组，按优先级分层**：
```javascript
const reasonKeywords = [
  // 第一层：离校（最高优先级）
  { keywords: ['请假离校', '离校', '回家'], mapped: 'leaveSchool', reasonLabel: '请假离校' },
  // 第二层：外出
  { keywords: ['请假外出', '外出', '出门'], mapped: 'leaveOutside', reasonLabel: '请假外出' },
  // 第三层：工作室类（事假）
  { keywords: ['数分', '数分工作室', '数据分析工作室', '数据分析', 'data'], mapped: '数分', leaveType: 'leaveInside' },
  { keywords: ['网安', '网安工作室', '网络安全工作室', '网络安全'], mapped: '网安', leaveType: 'leaveInside' },
  { keywords: ['阿sir', '啊sir', '啊SIR', '预备阿sir', '自媒体工作室', '自媒体', 'sir', '阿SIR', '阿Sir'], mapped: '阿sir', leaveType: 'leaveInside' },
  { keywords: ['数据实战', '数据实战工作室', '数实战'], mapped: '数实战', leaveType: 'leaveInside' },
  { keywords: ['舆情', '舆情工作室'], mapped: '舆情', leaveType: 'leaveInside' },
  { keywords: ['网管', '网管工作室'], mapped: '网管', leaveType: 'leaveInside' },
  // 第四层：组织类（事假）
  { keywords: ['分团委'], mapped: '分团委', leaveType: 'leaveInside' },
  { keywords: ['学生会'], mapped: '学生会', leaveType: 'leaveInside' },
  { keywords: ['合唱团'], mapped: '合唱团', leaveType: 'leaveInside' },
  { keywords: ['运动会'], mapped: '运动会', leaveType: 'leaveInside' },
  { keywords: ['警乐团'], mapped: '警乐团', leaveType: 'leaveInside' },
  { keywords: ['羽毛球'], mapped: '羽毛球', leaveType: 'leaveInside' },
  { keywords: ['篮球队', '篮球', '篮球队假单'], mapped: '篮球队', leaveType: 'leaveInside' },
  { keywords: ['辩论队', '辩队'], mapped: '辩论队', leaveType: 'leaveInside' },
  { keywords: ['备赛', '比赛', '竞赛'], mapped: '备赛', leaveType: 'leaveInside' },
  { keywords: ['复习'], mapped: '复习', leaveType: 'leaveInside' },
  { keywords: ['学习', '自习'], mapped: '学习', leaveType: 'leaveInside' },
  { keywords: ['校督', '校督促'], mapped: '校督', leaveType: 'leaveInside' },
  // 兜底：事假（只有明确出现"事假"二字时才触发）
  { keywords: ['事假'], mapped: '其他', leaveType: 'leaveInside' }
];
```

3. **`detectReason` 改为分层遍历**：
```javascript
function detectReason(text) {
  const lower = text.toLowerCase();
  for (const rule of reasonKeywords) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return {
          found: true,
          reason: rule.reasonLabel || rule.mapped,
          leaveType: rule.leaveType || rule.mapped,
          mapped: rule.mapped,
          matchedKeyword: keyword
        };
      }
    }
  }
  return { found: false };
}
```
这样按数组顺序遍历，先匹配离校，再外出，再工作室/组织，最后事假兜底，优先级天然保证。

4. **后端 `/api/smart-group` 同步修改**：如果后端也用了同样的映射逻辑，需要同步改为有序数组结构。

---

## Bug 2：生成报告与实际状态不匹配 — 状态叠加/取消后报告逻辑错误

### 根因排查方向（需结合 `index.js` 确认）
1. **状态叠加的数据结构**：检查 `index.js` 中人员状态在内存/存储中的数据结构。是否允许同时存在多个状态？
2. **事由字段的独立性**：事由是否与"事假"状态强绑定？取消"未归"时是否错误清空了整个状态对象？
3. **报告生成逻辑**：`generateReport` 读取的是哪个字段？状态为 null 时是否 fallback 到"在寝"？
4. **状态取消的边界**：点击已激活的"事假"按钮时，预期是取消"事假"标记。但如果是在"未归"叠加后重新点击"事假"，逻辑链条可能混乱。

### 修复方向
1. **单一状态原则**：每个人员同一时间只能有一个主状态，选择新状态时**覆盖**旧状态，不要叠加。
2. **事由与状态解耦存储**：`status`（主状态枚举）+ `reason`（事由字符串），事由独立存储，状态变更时不自动清空事由（除非状态变为非事假）。
3. **报告生成严格读取当前状态**：`status === null` 时显示"未确认"或不计入统计，**绝不 fallback 到"在寝"**。

---

## Bug 3："收起其他选项"按钮无效（基于代码 pinpoint）

### 根因
`renderGroups` 中 `sub-reason-menu` 的显示条件：
```javascript
${group.showSubReasons || subReasons.includes(group.reason) || isCustomReason ? `
  <div class="sub-reason-menu" ...>
```
当用户选择了 `subReasons` 中的某个事由（如"分团委"、"学生会"）后，`subReasons.includes(group.reason)` **永远为 true**。  
所以即使 `group.showSubReasons` 被 toggle 为 false，条件整体仍为 true，菜单**永远不会收起**。

### 修复
将显示条件改为**仅依赖 `group.showSubReasons`**：
```javascript
${group.showSubReasons ? `
  <div class="sub-reason-menu" ...>
```
当用户选择了一个 subReason 后，如果 `showSubReasons` 为 false，菜单收起，但按钮文字应显示当前已选事由（如"∨ 分团委"），点击可重新展开。

按钮文字逻辑同步修改：
```javascript
const subMenuBtnText = group.showSubReasons
  ? '<i class="fas fa-chevron-up"></i> 收起其他选项'
  : '<i class="fas fa-chevron-down"></i> ' + (subReasons.includes(group.reason) ? group.reason : '更多事由');
```

---

## 需求 1：假单优先级 — 一人多假单时的状态判定

### 场景
一个人可能同时拥有多个假单：工作室、分团委、请假离校、请假外出、篮球队等。

### 优先级规则（从高到低）
| 优先级 | 假单类型 | 对应状态 |
|---|---|---|
| 1（最高） | 请假离校 | `leaveSchool` |
| 2 | 请假外出 | `leaveOutside` |
| 3 | 分团委、篮球队、辩论队、警乐团、校督、学生会等 | `leaveInside` |
| 4（最低） | 网安、数分、数实战、阿sir、网管、复习、备赛等 | `leaveInside` |

### 实现
- 解析假单时，为每个人员收集所有匹配到的假单类型列表。
- 按上述优先级排序，取最高优先级的一项作为最终状态。
- 如果最终状态为 `leaveInside`，事由显示为实际命中的具体名称。
- 同优先级多个事由时，按假单文本中出现顺序取第一个。

---

## 需求 2：搜索功能优化 — 精确匹配 + 全局穿透显示

### 2A. 搜索改为精确匹配，不用模糊匹配
- `index.html` 顶部搜索框只精确匹配姓名/班级/宿舍号：`name.includes(query) || className.includes(query) || dormId.includes(query)`。
- 不需要拼音转码、不需要编辑距离、不需要联想高亮。
- **注意**：`upload.html` / `manual-upload.html` 的人员匹配仍需使用模糊匹配（见需求 5）。

### 2B. 搜索全局穿透，不受当前筛选条件限制
- 搜索在**全量数据**上执行，搜索命中项**无视当前楼层/状态筛选**，强制显示在结果中并高亮（如边框金色）。
- 搜索框清空后，恢复正常的筛选逻辑。

---

## 需求 3：点击按钮切换 vs 滑动切换的动效分离

- **手指滑动切换**：保留现有动效（跟随手指 + 飞出/飞入 + 旋转）。
- **点击按钮切换**：改为快速平滑过渡（约 0.15s 淡入淡出或轻微滑动），无旋转、不飞出屏幕外。
- 按钮调用独立的 `nextByButton()` / `prevByButton()`，不复用滑动的 `nextBySwipe()`。

---

## 需求 4：状态按钮手势隔离（防误触）

状态按钮容器阻止事件冒泡到卡片滑动层：
```javascript
document.querySelectorAll('.status-btns').forEach(container => {
  container.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  container.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
});
```

---

## 需求 5：精简模糊匹配（仅用于 upload / manual-upload 的人员识别）

### 设计原则
- **不清洗空格**：输入是什么就比对什么。
- **不分词**：只接收单个已提取的姓名字符串进行比对。
- **不过度模糊**：姓氏严格相等 + 去姓后编辑距离 ≤ 1。

### 匹配规则
1. 姓氏严格相等（第一个字必须相同）。
2. 去姓后长度相等。
3. 去姓后 Levenshtein 编辑距离 ≤ 1。

### 使用场景
- `upload.html` / `manual-upload.html`：OCR 结果校正、手动输入后的人员匹配。
- `index.html` 搜索框不使用此模糊匹配。

---

## 需求 6：勾选框尺寸调整（upload 页面）

### 现状
`manual-upload.js` 中：
```javascript
<div class="person-checkbox ${p.checked ? 'checked' : ''}">
  ${p.checked ? '<i class="fas fa-check"></i>' : ''}
</div>
```
勾选框 CSS 尺寸过大，视觉比例失调。

### 修复
- 视觉尺寸改为 24x24px（或 28x28px）。
- 触控热区扩大到 40x40px（用透明 padding 或伪元素），保证好点击但不突兀。
- 与姓名、宿舍号垂直居中对齐，行高一致。

---

## 执行优先级

| 优先级 | 事项 | 影响 |
|---|---|---|
| P0 | Bug 1：假单事由映射异常 | 影响所有假单解析，自动化完全失效 |
| P0 | Bug 2：报告生成状态错误 | 直接影响查寝结果准确性 |
| P0 | Bug 3：收起其他选项无效 | 假单页面 UI 功能缺陷 |
| P1 | 需求 1：假单优先级规则 | 提升自动化程度 |
| P1 | 需求 2B：搜索全局穿透 | 急着找人时不受筛选限制 |
| P2 | 需求 2A：搜索精确匹配 | 减少搜索干扰 |
| P2 | 需求 3：动效分离 | 赶时间体验更干脆 |
| P2 | 需求 4：手势隔离 | 防止误触切宿舍 |
| P2 | 需求 5：精简模糊匹配 | OCR/手误纠错 |
| P2 | 需求 6：勾选框尺寸 | 视觉微调 |

---

## 验证清单

### Bug 1 验证
- [ ] 上传包含"请假离校"的文本，解析后状态为 `leaveSchool`（离校），不是 `leaveInside`（事假）。
- [ ] 上传包含"事假"但不包含"离校/外出"的文本，解析后状态为 `leaveInside`。
- [ ] 上传包含"网安"的文本，解析后事由显示"网安"，底层分类为工作室。
- [ ] 多次上传相同文本，解析结果一致（行为可预测）。

### Bug 2 验证
- [ ] 人员标记"事假+工作室" → 额外选"未归" → 取消"未归" → 人员恢复"事假"，事由仍显示"工作室"。
- [ ] 生成报告时，该人员状态显示为"事假"，事由显示"工作室"。
- [ ] 状态为 null 的人员，报告生成时不 fallback 到"在寝"。

### Bug 3 验证
- [ ] 点击"∧ 收起其他选项"，下方具体事由选项（分团委、学生会等）平滑收起。
- [ ] 收起后按钮文字变为"∨ 更多事由"或显示当前已选事由。
- [ ] 再次点击可重新展开。

### 需求 1 验证
- [ ] 同一人拥有 [请假离校, 网安] → 最终状态为"离校"。
- [ ] 同一人拥有 [分团委, 篮球队] → 最终状态为"事假"，事由显示"分团委"。
- [ ] 同一人拥有 [请假外出, 网安] → 最终状态为"外出"。

### 需求 2 验证
- [ ] 搜索框输入"王一诺"，只显示精确匹配的人员，不弹出模糊联想。
- [ ] 当前筛选"5F"+"未归"，搜索"402-1 在寝"的人员，该人员**强制显示**在结果中。

### 需求 3 验证
- [ ] 点击左右箭头按钮切换宿舍，动画快速干脆（约 0.15s），无旋转。
- [ ] 手指滑动切换宿舍，保留原有的跟随手指 + 旋转 + 飞出动效。

### 需求 4 验证
- [ ] 在状态按钮区域左右快速滑动，宿舍卡片**绝不切换**。
- [ ] 在卡片空白处左右滑动，正常切换宿舍。

### 需求 5 验证
- [ ] `fuzzyMatchName('孔怡罪', [...])` 返回 `孔怡霏`。
- [ ] `fuzzyMatchName('黄品睿', [...])` 返回 `黄思睿`。
- [ ] `fuzzyMatchName('孔怡然', [...])` 不返回 `孔怡霏`（编辑距离 2）。

### 需求 6 验证
- [ ] 勾选框视觉尺寸适中（24~28px），不突兀。
- [ ] 勾选框触控区域足够大（40x40px），易于点击。
- [ ] 勾选框与姓名、宿舍号垂直居中对齐。
