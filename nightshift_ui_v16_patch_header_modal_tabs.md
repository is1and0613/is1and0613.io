# NIGHTSHIFT 查寝系统 UI 迭代 — v16 补丁（Header + Modal + Tabs 居中）

> **版本**: v16-patch  
> **日期**: 2026-05-29  
> **目标**: Header 按钮改毛玻璃、Modal 按钮统一新拟态、Tabs 文字强制居中。

---

## 一、修复清单

| # | 问题 | 优先级 | 涉及文件 |
|---|------|--------|---------|
| 1 | Header 按钮白色光晕丑，用户明确否决新拟态 | P0 | `theme.css`, `index.css` |
| 2 | 多人查寝 Modal 内部按钮风格割裂（蓝填充/有边框无阴影） | P0 | `index.css`, `index.html` |
| 3 | Tabs 按钮文字不居中（如图，4F 偏左） | P0 | `theme.css`, `index.css` |

---

## 二、具体修复

### 2.1 Header 按钮 — 毛玻璃半透明（彻底放弃新拟态）

用户原话："不要再用这种效果了。很丑啊！"

**改造**：在深蓝 Header 背景上，按钮改用**毛玻璃半透明**，无阴影、无光晕、无凸起。

```css
/* 覆盖/删除之前的 .neu-btn-header 相关样式 */

.header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;  /* 确保图标+文字居中 */
  gap: 6px;
  padding: 8px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #FFFFFF;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  -webkit-tap-highlight-color: transparent;
  /* 彻底禁止任何阴影和光晕 */
  box-shadow: none !important;
  filter: none !important;
  text-shadow: none !important;
}
.header-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
.header-btn:active {
  background: rgba(255, 255, 255, 0.08);
  transform: scale(0.96);
}

/* 月亮图标专用圆形 */
.header-btn.icon-round {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
}

/* 图标颜色强制白色 */
.header-btn i,
.header-btn svg {
  color: #FFFFFF;
  font-size: 16px;
}
```

**HTML 替换**：
```html
<button class="header-btn icon-round" id="themeToggle" aria-label="切换主题">
  <i class="icon-moon"></i>
</button>
<button class="header-btn">
  <i class="icon-wechat"></i>企业微信
</button>
<button class="header-btn">
  <i class="icon-refresh"></i>新查寝
</button>
```

**注意**：
- 删除所有旧的 `.neu-btn-header` 样式定义。
- 删除 Header 按钮相关的 `box-shadow`、`filter: drop-shadow`、`text-shadow`。
- 若浏览器不支持 `backdrop-filter`，会优雅降级为纯半透明背景，不影响使用。

---

### 2.2 多人查寝 Modal 内部按钮统一

**现状**："创建房间"是克莱因蓝填充，"加入房间"和"返回单人模式"是边框按钮，风格割裂。

**改造**：Modal 背景为浅色（`#E0E5EC`），所有按钮统一为标准新拟态凸起，禁止任何填充色。

```css
/* Modal 内主按钮（创建房间 / 加入房间） */
.modal-btn-primary {
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  background: var(--neu-bg);
  box-shadow: 8px 8px 16px var(--neu-dark), -8px -8px 16px var(--neu-light);
  border: none;
  color: var(--neu-text);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;  /* 图标+文字居中 */
  gap: 8px;
  -webkit-tap-highlight-color: transparent;
}
.modal-btn-primary:active {
  box-shadow: inset 4px 4px 8px var(--neu-dark), inset -4px -4px 8px var(--neu-light);
  transform: scale(0.98);
}

/* Modal 内次要按钮（返回单人模式） */
.modal-btn-secondary {
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  background: var(--neu-bg);
  box-shadow: 6px 6px 12px var(--neu-dark), -6px -6px 12px var(--neu-light);
  border: none;
  color: var(--neu-text-secondary);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;  /* 图标+文字居中 */
  gap: 8px;
  -webkit-tap-highlight-color: transparent;
}
.modal-btn-secondary:active {
  box-shadow: inset 3px 3px 6px var(--neu-dark), inset -3px -3px 6px var(--neu-light);
  transform: scale(0.98);
}
```

**HTML 替换**：
```html
<!-- 创建房间 -->
<button class="modal-btn-primary" onclick="createRoom()">
  <i class="icon-plus"></i>创建房间
</button>

<!-- 加入房间 -->
<button class="modal-btn-primary" onclick="joinRoom()">
  <i class="icon-enter"></i>加入房间
</button>

<!-- 返回单人模式 -->
<button class="modal-btn-secondary" onclick="closeMultiCheckModal()">
  <i class="icon-arrow-left"></i>返回单人模式
</button>
```

**禁止项**：
- 禁止克莱因蓝（`#09479C`）填充任何 Modal 内按钮。
- 禁止给按钮加 `border: 1px solid` 描边（新拟态不需要边框）。
- 所有按钮背景必须与 Modal 背景同色，层次只靠阴影。

---

### 2.3 Tabs 文字强制居中 [P0]

**现象**：如图，4F 选中态文字明显偏左，未水平居中。

**根因排查**：
1. `.neu-tab` 的 `text-align: center` 可能未生效。
2. `.tab-thumb` 滑块遮挡了文字区域，导致视觉偏左。
3. `padding` 左右不对称。
4. 父容器 `.neu-tabs` 的 `gap` 或 `padding` 导致 tab 宽度计算错误。

**修复**：

```css
/* Tabs 容器 */
.neu-tabs {
  position: relative;
  display: flex;
  background: var(--neu-bg);
  border-radius: 16px;
  padding: 5px;
  box-shadow: inset 5px 5px 10px var(--neu-dark), inset -5px -5px 10px var(--neu-light);
  /* 确保子元素均匀分布 */
  justify-content: space-between;
}

/* 滑块 thumb — 确保不挤压文字布局 */
.tab-thumb {
  position: absolute;
  top: 5px;
  bottom: 5px;         /* 用 bottom 替代 height，避免计算误差 */
  left: 5px;
  background: var(--neu-bg);
  border-radius: 12px;
  box-shadow: 5px 5px 10px var(--neu-dark), -5px -5px 10px var(--neu-light);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 0;
  pointer-events: none;
  /* 不设置 width，由 JS 动态控制 */
}

/* Tab 选项 — 强制居中 */
.neu-tab {
  flex: 1;
  position: relative;
  z-index: 1;
  padding: 10px 0;      /* 左右 padding 设为 0，避免不对称 */
  border-radius: 12px;
  border: none;
  background: transparent;
  color: var(--neu-text-secondary);
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: color 0.35s ease;
  text-align: center;   /* 文字水平居中 */
  -webkit-tap-highlight-color: transparent;
  /* 确保文字在自身区域内居中 */
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;         /* 允许 flex 子元素收缩 */
}
.neu-tab.active {
  color: var(--neu-text);
  font-weight: 600;
}
```

**JS 修复（滑块定位精确计算）**：
```javascript
class SmoothTabs {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    this.thumb = this.container.querySelector('.tab-thumb');
    this.tabs = this.container.querySelectorAll('.neu-tab');
    this.init();
  }

  init() {
    const activeTab = this.container.querySelector('.neu-tab.active');
    if (activeTab) this.moveThumb(activeTab);

    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.moveThumb(tab);
        // ... 原有筛选逻辑
      });
    });

    window.addEventListener('resize', () => {
      const active = this.container.querySelector('.neu-tab.active');
      if (active) this.moveThumb(active);
    });
  }

  moveThumb(targetTab) {
    const containerRect = this.container.getBoundingClientRect();
    const tabRect = targetTab.getBoundingClientRect();

    // 计算相对于容器的位置
    const left = tabRect.left - containerRect.left;
    const width = tabRect.width;

    // 应用样式
    this.thumb.style.left = left + 'px';
    this.thumb.style.width = width + 'px';
    this.thumb.style.transform = 'none'; // 清除之前的 transform，避免冲突
  }
}
```

**关键检查**：
- `.neu-tab` 必须有 `display: flex; justify-content: center; align-items: center;`，确保文字在 flex 子元素内绝对居中。
- `.neu-tab` 的 `padding-left` 和 `padding-right` 必须对称（建议都设为 0，靠 `flex: 1` 自动分配宽度）。
- `.tab-thumb` 使用 `left + width` 定位，不要用 `transform: translateX()`，避免与文字布局产生叠加偏移。
- 确保 `.tab-thumb` 的 `z-index: 0` 和 `.neu-tab` 的 `z-index: 1`，文字浮在滑块上方。

---

## 三、验收标准

### Header 按钮
- [ ] 月亮/企业微信/新查寝按钮无阴影、无光晕、无凸起。
- [ ] 按钮为半透明白色玻璃质感，文字/图标白色。
- [ ] 按下时有微暗+缩小反馈。

### Modal 按钮
- [ ] "创建房间"无克莱因蓝填充，为标准新拟态凸起。
- [ ] "加入房间"和"返回单人模式"同样为新拟态风格，无填充色、无边框。
- [ ] 所有按钮图标+文字水平居中。

### Tabs 居中
- [ ] 楼层 Tabs（全部/1F/4F/5F/6F）每个选项文字严格水平居中。
- [ ] 选中态滑块不遮挡文字，文字始终浮在滑块上方。
- [ ] 切换时滑块平滑移动，文字保持居中。

---

## 四、部署

```bash
npx wrangler pages deploy . --commit-dirty=true
```
