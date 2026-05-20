# NIGHTSHIFT 查寝系统 — 交互优化完整实现文档

**项目**：NIGHTSHIFT 查寝系统  
**包含**：Tinder 式宿舍滑动切换 + 英伦风夜间配色 + 点击已选状态取消标记 + 误触撤销机制  
**前提**：Bug 1（状态同步）与 Bug 2（报告两段式）已修复，多人查寝复用单人界面架构已完成。

---

## 一、Tinder 式宿舍卡片滑动切换

### 1.1 核心设计
- **单容器渲染**：同一时间 DOM 中只保留当前宿舍卡片 + 预窥层（相邻宿舍只露边缘）。
- **跟随手指**：`touchmove` 实时更新 `transform: translateX()`，无延迟。
- **阈值切换**：松手时水平位移超过 25% 屏宽，或甩手速度超过 0.6 px/ms，触发切换。
- **回弹动画**：未达阈值时 0.3s 弹性回弹到原位。
- **边界提示**：第一个宿舍右滑、最后一个宿舍左滑时 Toast 提示，不报错。

### 1.2 CSS（加入 `assets/css/index.css`）

```css
/* ===== 滑动容器 ===== */
.dorm-swipe-viewport {
  position: relative;
  width: 100%;
  overflow: hidden;
  touch-action: pan-y; /* 垂直滚动交给浏览器，水平自己接管 */
}

.dorm-card-stack {
  position: relative;
  width: 100%;
  min-height: 60vh;
}

/* 当前宿舍卡片 */
.dorm-card-current {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  will-change: transform;
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* 预窥层：相邻宿舍若隐若现 */
.dorm-card-peek {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  transform: scale(0.95);
}

.dorm-card-current.is-dragging ~ .dorm-card-peek {
  opacity: 0.4;
}

/* 滑动指示箭头（可选，拖动时渐显） */
.swipe-hint {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 48px;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: 10;
}
.swipe-hint.left { left: 20px; }
.swipe-hint.right { right: 20px; }

.dorm-card-current.is-dragging[data-direction="left"] ~ .swipe-hint.left {
  opacity: 0.3;
}
.dorm-card-current.is-dragging[data-direction="right"] ~ .swipe-hint.right {
  opacity: 0.3;
}
```

### 1.3 JS（加入 `assets/js/index.js` 或新建 `dorm-swipe.js`）

```javascript
/**
 * DormSwipeController
 * Tinder 式宿舍卡片滑动切换
 */
class DormSwipeController {
  constructor(options) {
    this.container = document.querySelector(options.containerSelector);
    this.dorms = options.dorms || [];
    this.currentIndex = options.startIndex || 0;
    this.onDormChange = options.onDormChange || (() => {});
    this.buildDormHTML = options.buildDormHTML; // 外部传入的渲染函数

    this.threshold = window.innerWidth * 0.25;
    this.velocityThreshold = 0.6;

    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastTime = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.velocity = 0;

    this.init();
  }

  init() {
    this.buildStructure();
    this.bindEvents();
    this.render(this.currentIndex);
  }

  buildStructure() {
    this.container.innerHTML = `
      <div class="dorm-card-stack" id="dorm-stack">
        <div class="dorm-card-peek" id="dorm-peek"></div>
        <div class="dorm-card-current" id="dorm-current"></div>
        <div class="swipe-hint left">‹</div>
        <div class="swipe-hint right">›</div>
      </div>
    `;
    this.stackEl = document.getElementById('dorm-stack');
    this.currentEl = document.getElementById('dorm-current');
    this.peekEl = document.getElementById('dorm-peek');
  }

  bindEvents() {
    const stack = this.stackEl;
    stack.addEventListener('touchstart', this.onStart.bind(this), { passive: false });
    stack.addEventListener('touchmove', this.onMove.bind(this), { passive: false });
    stack.addEventListener('touchend', this.onEnd.bind(this));
    stack.addEventListener('touchcancel', this.onEnd.bind(this));
    stack.addEventListener('mousedown', this.onMouseStart.bind(this));
  }

  onStart(e) {
    const touch = e.touches[0];
    this.isDragging = true;
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.lastX = this.startX;
    this.lastTime = Date.now();
    this.deltaX = 0;
    this.deltaY = 0;

    this.currentEl.style.transition = 'none';
    this.currentEl.classList.add('is-dragging');
    this.preparePeek();
  }

  onMove(e) {
    if (!this.isDragging) return;
    const touch = e.touches[0];

    this.deltaX = touch.clientX - this.startX;
    this.deltaY = touch.clientY - this.startY;

    // 水平主导时阻止默认滚动
    if (Math.abs(this.deltaX) > Math.abs(this.deltaY) && Math.abs(this.deltaX) > 10) {
      e.preventDefault();
    }

    // 方向标记（用于 CSS 箭头提示）
    const direction = this.deltaX > 0 ? 'right' : 'left';
    this.currentEl.setAttribute('data-direction', direction);

    // 实时跟随 + 轻微旋转
    const rotate = this.deltaX * 0.03;
    const scale = 1 - Math.abs(this.deltaX) / window.innerWidth * 0.05;
    this.currentEl.style.transform = `translateX(${this.deltaX}px) rotate(${rotate}deg) scale(${scale})`;

    // 预窥层反向微移
    const peekOffset = this.deltaX > 0 ? -40 : 40;
    const peekOpacity = Math.min(Math.abs(this.deltaX) / 150, 0.5);
    this.peekEl.style.opacity = peekOpacity;
    this.peekEl.style.transform = `translateX(${peekOffset}px) scale(0.95)`;

    // 计算速度
    const now = Date.now();
    const dt = now - this.lastTime;
    if (dt > 0) {
      this.velocity = (touch.clientX - this.lastX) / dt;
    }
    this.lastX = touch.clientX;
    this.lastTime = now;
  }

  onEnd(e) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.currentEl.classList.remove('is-dragging');
    this.currentEl.removeAttribute('data-direction');

    this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    this.peekEl.style.transition = 'opacity 0.2s ease, transform 0.3s ease';

    const absX = Math.abs(this.deltaX);
    const fastSwipe = Math.abs(this.velocity || 0) > this.velocityThreshold;

    if (absX > this.threshold || fastSwipe) {
      if (this.deltaX > 0) this.prev();
      else this.next();
    } else {
      this.snapBack();
    }
  }

  snapBack() {
    this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
    this.peekEl.style.opacity = '0';
    this.peekEl.style.transform = 'translateX(0) scale(0.95)';
  }

  next() {
    if (this.currentIndex >= this.dorms.length - 1) {
      this.snapBack();
      this.showToast('已经是最后一个宿舍');
      return;
    }

    this.currentEl.style.transform = `translateX(-100vw) rotate(-10deg) scale(0.9)`;

    setTimeout(() => {
      this.currentIndex++;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(100vw) rotate(10deg) scale(0.9)';
      this.render(this.currentIndex);

      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
      this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
      this.peekEl.style.opacity = '0';
    }, 300);
  }

  prev() {
    if (this.currentIndex <= 0) {
      this.snapBack();
      this.showToast('已经是第一个宿舍');
      return;
    }

    this.currentEl.style.transform = `translateX(100vw) rotate(10deg) scale(0.9)`;

    setTimeout(() => {
      this.currentIndex--;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = 'translateX(-100vw) rotate(-10deg) scale(0.9)';
      this.render(this.currentIndex);

      void this.currentEl.offsetWidth;
      this.currentEl.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
      this.currentEl.style.transform = 'translateX(0) rotate(0deg) scale(1)';
      this.peekEl.style.opacity = '0';
    }, 300);
  }

  render(index) {
    const dorm = this.dorms[index];
    if (!dorm) return;

    // 调用外部传入的渲染函数，复用现有宿舍卡片 HTML 生成逻辑
    this.currentEl.innerHTML = this.buildDormHTML(dorm);

    // 绑定状态按钮事件（需在 buildDormHTML 后执行）
    this.bindStatusButtons();

    // 通知外部更新（楼层筛选高亮、底部统计等）
    this.onDormChange({ dorm, index, total: this.dorms.length });
  }

  preparePeek() {
    let peekIndex = this.currentIndex;
    if (this.deltaX > 0) peekIndex = this.currentIndex - 1;
    else if (this.deltaX < 0) peekIndex = this.currentIndex + 1;

    if (peekIndex >= 0 && peekIndex < this.dorms.length) {
      // 预窥层简化渲染，只保留轮廓和宿舍名
      this.peekEl.innerHTML = `<div style="opacity:0.6;filter:blur(2px);">${this.buildDormHTML(this.dorms[peekIndex])}</div>`;
    }
  }

  bindStatusButtons() {
    const buttons = this.currentEl.querySelectorAll('.btn-status');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('.student-row');
        const studentId = row.dataset.studentId;
        const newStatus = e.target.dataset.status;
        const oldStatus = row.dataset.currentStatus || '';

        // 调用外部状态管理逻辑
        window.updateStudentStatus(studentId, newStatus, oldStatus);
      });
    });
  }

  showToast(msg) {
    if (window.showToast) window.showToast(msg);
  }

  // 鼠标事件适配（桌面端调试）
  onMouseStart(e) {
    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = this.startX;
    this.lastTime = Date.now();

    const onMouseMove = (ev) => {
      if (!this.isDragging) return;
      this.deltaX = ev.clientX - this.startX;
      this.deltaY = ev.clientY - this.startY;
      const rotate = this.deltaX * 0.03;
      this.currentEl.style.transition = 'none';
      this.currentEl.style.transform = `translateX(${this.deltaX}px) rotate(${rotate}deg)`;
    };

    const onMouseUp = (ev) => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.deltaX = ev.clientX - this.startX;
      this.onEnd({ touches: [{ clientX: ev.clientX }] });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
}

// ===== 初始化示例 =====
// 在页面加载完成后调用，dorms 为过滤/排序后的宿舍数组
// const swipe = new DormSwipeController({
//   containerSelector: '#dorm-viewport',
//   dorms: filteredDorms,
//   startIndex: 0,
//   buildDormHTML: window.renderDormCard, // 复用你现有的渲染函数
//   onDormChange: ({ dorm, index }) => {
//     // 更新楼层筛选高亮、底部统计等
//   }
// });
```

### 1.4 集成要点
- 将原来的宿舍列表容器（如 `#dorm-list`）外层包 `<div class="dorm-swipe-viewport" id="dorm-viewport">`。
- `buildDormHTML` 参数传入你现有的宿舍卡片渲染函数，**不要重写 HTML 结构**。
- 楼层筛选变更时，重新过滤 `dorms` 数组，调用 `swipe.dorms = filtered; swipe.currentIndex = 0; swipe.render(0);`。
- 状态按钮点击事件在 `bindStatusButtons` 中绑定，内部调用你现有的 `window.updateStudentStatus`（或等价函数）。

---

## 二、英伦风夜间配色方案

### 2.1 配色选择
从七组配色中选定 **英伦风 · 松林绿 + 迪奥金 + 绀色**：
- 松林绿 `#1C312C`：低明度墨绿，夜间吸光不刺眼，有"夜间执勤"严肃质感。
- 迪奥金 `#A99563`：暗金点缀，用于状态标签/按钮/高亮，像肩章质感，辨识度高但不跳。
- 绀色 `#1A1D3C`：深蓝近黑，用于次级容器、弹层、抽屉，与松林绿形成层次。
- 山矾白 `#F5F4F0`（从 QQ 飞车配色借调）：主文字色，在深色底上清晰但不刺眼。

### 2.2 CSS 变量定义（加入 `assets/css/index.css` 顶部）

```css
:root {
  /* 日间模式（保留现有配色，作为 fallback） */
  --bg-page: #F5F4F0;
  --bg-card: #FFFFFF;
  --bg-elevated: #F8F8F8;
  --text-primary: #1A1D3C;
  --text-secondary: #666666;
  --accent: #1C312C;
  --accent-gold: #A99563;
  --border: #E5E5E5;
  --status-present: #1C312C;
  --status-absent: #E74C3C;
  --status-leave-school: #9B59B6;
  --status-leave-inside: #F39C12;
  --status-leave-outside: #3c7a17;
}

/* 夜间模式：英伦风 */
[data-theme="dark"] {
  --bg-page: #0D1216;
  --bg-card: #1C312C;
  --bg-elevated: #1A1D3C;
  --text-primary: #F5F4F0;
  --text-secondary: #A99563;
  --accent: #A99563;
  --accent-gold: #A99563;
  --border: #2A3D36;
  --status-present: #A99563;
  --status-absent: #E74C3C;
  --status-leave-school: #9B59B6;
  --status-leave-inside: #F39C12;
  --status-leave-outside: #15F5B9;
}

/* 全局应用变量 */
body {
  background: var(--bg-page);
  color: var(--text-primary);
  transition: background 0.3s, color 0.3s;
}

.dorm-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  transition: background 0.3s, border-color 0.3s;
}

.btn-status.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.status-tag {
  color: var(--text-secondary);
}

/* 夜间模式状态按钮微调 */
[data-theme="dark"] .btn-status:not(.active) {
  background: transparent;
  color: var(--text-primary);
  border-color: var(--border);
}

[data-theme="dark"] .btn-status.active[data-status="leaveOutside"] {
  background: var(--status-leave-outside);
  color: #000;
  border-color: var(--status-leave-outside);
}
```

### 2.3 主题切换逻辑（加入 `assets/js/index.js`）

```javascript
// 初始化主题
const savedTheme = localStorage.getItem('nightshift_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

// 切换主题函数（绑定到设置按钮或自动跟随系统）
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('nightshift_theme', next);
}

// 可选：跟随系统暗黑模式
if (window.matchMedia && !localStorage.getItem('nightshift_theme')) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
  mq.addEventListener('change', (e) => {
    if (!localStorage.getItem('nightshift_theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}
```

---

## 三、点击已选状态取消标记

### 3.1 需求
- 状态按钮为单选模式，当前已激活的状态按钮再次点击 = **取消标记**。
- 取消后人员恢复为"未标记"（空白/默认态），不再计入任何状态分类。
- 底部统计同步更新，报告生成时该人员不纳入统计（或归为"未确认"）。

### 3.2 实现逻辑

```javascript
/**
 * 更新人员状态（支持取消标记）
 * @param {string} studentId - 学生 ID
 * @param {string} newStatus - 目标状态（在寝/未归/离校/事假/外出）
 * @param {string} oldStatus - 当前状态
 */
function updateStudentStatus(studentId, newStatus, oldStatus) {
  // 如果点击的是已激活状态 → 取消标记
  if (newStatus === oldStatus) {
    newStatus = null; // 或 '' / 'unmarked'
  }

  // 更新内存状态
  const student = findStudent(studentId);
  const previousStatus = student.status;
  student.status = newStatus;

  // 持久化
  saveStatusToStorage(studentId, newStatus);

  // 触发同步（多人查寝）
  if (isMultiCheck()) {
    syncStatusToRoom(studentId, newStatus);
  }

  // UI 更新：重新渲染该学生行或仅更新按钮样式
  renderStudentStatus(studentId, newStatus);

  // 底部统计更新
  updateBottomStats();

  // 显示变更提示（见第四部分）
  showStatusChangeToast(student.name, previousStatus, newStatus);
}

// 状态按钮点击事件绑定
function bindStatusButtonEvents(container) {
  container.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.student-row');
      const studentId = row.dataset.studentId;
      const clickedStatus = e.target.dataset.status;
      const currentStatus = row.dataset.currentStatus;

      updateStudentStatus(studentId, clickedStatus, currentStatus);
    });
  });
}
```

### 3.3 取消后的视觉表现
- 取消标记后，该学生的状态按钮全部恢复为未激活样式（边框色，无填充）。
- 状态标签显示为灰色占位文字"未确认"或直接隐藏状态标签（根据现有 UI 决定）。
- 底部统计栏对应分类计数 -1。

---

## 四、误触处理：状态变更提示 + 撤销机制

### 4.1 问题场景
用户误触改变了人员状态，但**忘记之前是什么状态**，想恢复却不知道点哪个按钮。

### 4.2 解决方案：状态变更 Toast 提示

每次状态变更（包括取消标记）时，弹出轻量 Toast，明确显示**旧状态 → 新状态**：

```javascript
function showStatusChangeToast(studentName, oldStatus, newStatus) {
  const statusMap = {
    'present': '在寝',
    'absent': '未归',
    'leaveSchool': '离校',
    'leaveInside': '事假',
    'leaveOutside': '外出',
    null: '未确认',
    '': '未确认',
    'unmarked': '未确认'
  };

  const oldLabel = statusMap[oldStatus] || '未确认';
  const newLabel = statusMap[newStatus] || '未确认';

  const message = newStatus === null
    ? `已取消 ${studentName} 的标记`
    : `已将 ${studentName} 由 ${oldLabel} 更新为 ${newLabel}`;

  showToast(message, { duration: 3000 });
}
```

**效果**：
- 用户误触后，Toast 立刻提示"已将张溪影由 在寝 更新为 离校"。
- 用户看到旧状态是"在寝"，直接点"在寝"按钮即可恢复，不需要记忆。
- 如果是取消标记，提示"已取消张溪影的标记"，用户知道该人员现在处于未确认状态。

### 4.3 进阶方案：限时撤销按钮（可选）

如果 Toast 提示还不够，可在 Toast 上附加一个"撤销"按钮，3 秒内点击直接恢复旧状态：

```javascript
function showStatusChangeToastWithUndo(studentName, oldStatus, newStatus, studentId) {
  const statusMap = { /* 同上 */ };
  const oldLabel = statusMap[oldStatus] || '未确认';
  const newLabel = statusMap[newStatus] || '未确认';

  const toastId = 'status-toast-' + Date.now();
  const toastHTML = `
    <div class="toast-with-undo" id="${toastId}">
      <span>已将 ${studentName} 由 ${oldLabel} 更新为 ${newLabel}</span>
      <button class="btn-undo" onclick="undoStatusChange('${studentId}', '${oldStatus}', '${toastId}')">撤销</button>
    </div>
  `;

  showToastHTML(toastHTML, { duration: 4000 });
}

function undoStatusChange(studentId, oldStatus, toastId) {
  // 恢复旧状态
  updateStudentStatus(studentId, oldStatus, null);
  // 移除 Toast
  document.getElementById(toastId)?.remove();
}
```

**建议**：先实现 4.2 的基础 Toast（改动最小，效果最直接），如果实际使用中还是觉得误触频繁，再升级 4.3 的撤销按钮。

---

## 五、验证清单

### 滑动切换
- [ ] 手机上左右滑动宿舍卡片，手指跟随无延迟，动画流畅。
- [ ] 滑动超过 25% 屏宽松手，正确切换上一个/下一个宿舍。
- [ ] 滑动未达阈值松手，卡片弹性回弹到原位。
- [ ] 第一个宿舍右滑、最后一个宿舍左滑，出现 Toast 提示"已经是第一个/最后一个"。
- [ ] 切换宿舍后，人员状态按钮可正常点击，状态正确保存和同步。
- [ ] 楼层筛选变更后，滑动范围限制在当前筛选结果内。

### 夜间配色
- [ ] 切换 dark 模式后，页面背景变为近黑色，卡片变为松林绿，文字变为山矾白。
- [ ] 状态按钮在 dark 模式下边框和填充色正确切换。
- [ ] "外出"状态在 dark 模式下显示为 #15F5B9（青绿），在 light 模式下显示为 #3c7a17（深绿）。
- [ ] 刷新页面后主题保持上次选择（localStorage 持久化）。

### 点击取消标记
- [ ] 点击已激活的状态按钮，该人员恢复未标记态，按钮全部变灰。
- [ ] 取消后底部统计栏对应分类计数 -1。
- [ ] 多人模式下，协查人员界面同步看到该人员恢复未标记。
- [ ] 报告生成时，未标记人员不纳入统计（或单独归类）。

### 误触提示
- [ ] 每次状态变更后，Toast 正确显示"由 XX 更新为 XX"。
- [ ] 取消标记时，Toast 显示"已取消 XX 的标记"。
- [ ] 误触后根据 Toast 提示，能准确点回旧状态恢复。

---

## 六、关联文档

- `fix_multi_reuse_single_deepseek.md` — 多人查寝复用单人界面架构
- `fix_multi_status_and_report.md` — 状态同步 Bug + 报告两段式修复
