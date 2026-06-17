// assets/js/login.js — 登录/注册页逻辑 (v22: 注册验证码)

let currentMode = 'login';   // 'login' | 'register'
let loginRole = 'inspector'; // 'inspector' | 'admin'

// ===== 图形验证码 =====
(function() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const DARK_COLORS  = ['#E2E8F0', '#FFFFFF', '#81cac4', '#a8b5e0'];
  const LIGHT_COLORS = ['#1A1D3C', '#2D3748', '#0b3289', '#015697'];

  window.refreshCaptcha = function() {
    const canvas = document.getElementById('captchaCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // 背景 — 跟随主题 neumorphic bg
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--neu-bg').trim() || (isDark ? '#1A1D3C' : '#E0E5EC');
    const FONT_COLORS = isDark ? DARK_COLORS : LIGHT_COLORS;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // 生成 4 位验证码
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    window.__captchaCode = code;

    // 绘制字符
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = FONT_COLORS[Math.floor(Math.random() * FONT_COLORS.length)];
      const angle = (Math.random() - 0.5) * 0.5;
      const x = 15 + i * 26 + (Math.random() - 0.5) * 6;
      const y = 30 + (Math.random() - 0.5) * 8;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillText(code[i], 0, 0);
      ctx.restore();
    }

    // 干扰线
    for (let i = 0; i < 4; i++) {
      const v = isDark ? Math.floor(Math.random() * 200 + 55) : Math.floor(Math.random() * 100);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.lineWidth = 1 + Math.random();
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, Math.random() * h);
      ctx.lineTo(Math.random() * w, Math.random() * h);
      ctx.stroke();
    }

    // 干扰点
    for (let i = 0; i < 25; i++) {
      const dotAlpha = isDark ? 0.25 + Math.random() * 0.35 : 0.15 + Math.random() * 0.2;
      const dotV = isDark ? 255 : 0;
      ctx.fillStyle = `rgba(${dotV},${dotV},${dotV},${dotAlpha})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // 点击刷新
  const canvas = document.getElementById('captchaCanvas');
  if (canvas) canvas.addEventListener('click', window.refreshCaptcha);
})();

function updateUI() {
  const title = document.getElementById('loginTitle');
  const subtitle = document.getElementById('loginSubtitle');
  const icon = document.getElementById('loginIcon');
  const btnIcon = document.querySelector('#mainLoginBtn i');
  const btnText = document.getElementById('mainLoginBtnText');
  const switchRow = document.getElementById('switchModeRow');
  const captchaGroup = document.getElementById('captchaGroup');

  if (loginRole === 'admin') {
    // Admin mode
    title.textContent = '管理后台登录';
    subtitle.textContent = '请输入管理员账号密码';
    if (icon) icon.innerHTML = '<i class="fas fa-shield-alt"></i>';
    btnIcon.className = 'fas fa-shield-alt';
    btnText.textContent = '管理员登录';
    if (captchaGroup) captchaGroup.style.display = 'none';
    // Bottom: only "返回查寝员登录"
    switchRow.innerHTML = '<a href="javascript:void(0)" onclick="switchToInspectorMode()">← 返回查寝员登录</a>';
  } else if (currentMode === 'register') {
    // Register mode — 显示验证码
    title.textContent = '晚寝查寝系统';
    subtitle.textContent = '注册新账户以继续使用';
    if (icon) icon.innerHTML = '<i class="fas fa-bed"></i>';
    btnIcon.className = 'fas fa-user-plus';
    btnText.textContent = '注册新账户';
    if (captchaGroup) { captchaGroup.style.display = ''; window.refreshCaptcha(); }
    switchRow.innerHTML =
      '<span>已有账户？</span>' +
      '<a href="javascript:void(0)" onclick="toggleMode()">返回登录</a>';
  } else {
    // Default: inspector login — 隐藏验证码
    title.textContent = '晚寝查寝系统';
    subtitle.textContent = '登录或注册以继续使用';
    if (icon) icon.innerHTML = '<i class="fas fa-bed"></i>';
    btnIcon.className = 'fas fa-user-check';
    btnText.textContent = '查寝员登录';
    if (captchaGroup) captchaGroup.style.display = 'none';
    switchRow.innerHTML =
      '<span id="switchText">没有账户？</span>' +
      '<a href="javascript:void(0)" id="switchLink1" onclick="toggleMode()">注册新账户</a>' +
      '<span class="switch-sep">·</span>' +
      '<a href="javascript:void(0)" id="switchLink2" onclick="switchToAdminMode()">管理员登录</a>';
  }
}

function switchToAdminMode() {
  currentMode = 'login';
  loginRole = 'admin';
  document.getElementById('username').focus();
  updateUI();
}

function switchToInspectorMode() {
  currentMode = 'login';
  loginRole = 'inspector';
  document.getElementById('username').focus();
  updateUI();
}

function toggleMode() {
  currentMode = currentMode === 'login' ? 'register' : 'login';
  loginRole = 'inspector'; // register mode is always inspector
  document.getElementById('username').focus();
  updateUI();
}

async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const pin = document.getElementById('pin').value.trim();

  if (!username) {
    showToast('请输入用户名');
    document.getElementById('username').focus();
    return;
  }

  if (!password) {
    showToast('请输入密码');
    document.getElementById('password').focus();
    return;
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    showToast('请输入4位数字PIN码');
    document.getElementById('pin').focus();
    return;
  }

  // 注册模式：验证码校验
  if (currentMode === 'register') {
    const captchaInput = document.getElementById('captchaInput').value.trim().toUpperCase();
    if (!captchaInput) {
      showToast('请输入验证码');
      document.getElementById('captchaInput').focus();
      return;
    }
    if (captchaInput !== window.__captchaCode) {
      showToast('验证码错误，请重新输入');
      document.getElementById('captchaInput').value = '';
      window.refreshCaptcha();
      return;
    }
  }

  const btn = document.getElementById('mainLoginBtn');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>处理中...';
  btn.disabled = true;

  try {
    const captchaVal = currentMode === 'register'
      ? document.getElementById('captchaInput').value.trim().toUpperCase() : '';
    const data = currentMode === 'login'
      ? await loginUser(username, password, pin)
      : await registerUser(username, password, captchaVal);

    if (data.success && data.token) {
      sessionStorage.setItem('authToken', data.token);
      sessionStorage.setItem('loggedIn', 'true');
      // 🔒 登录时已验 PIN，跳过主页密码墙
      sessionStorage.setItem('access_password_verified', '1');
      if (data.user) {
        sessionStorage.setItem('username', data.user.username);
        sessionStorage.setItem('displayName', data.user.display_name || data.user.username);
      }

      // 根据 JWT role 自动跳转
      let role = 'inspector';
      try {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        role = payload.role || 'inspector';
      } catch (e) { /* use default */ }

      // v21: 模式与角色不匹配时拦截，防止误进
      if (loginRole === 'admin' && role !== 'admin') {
        showToast('该账户非管理员，请使用查寝员登录', 'error');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        return;
      }
      if (loginRole === 'inspector' && role === 'admin') {
        showToast('这是管理员账户，请使用底部「管理员登录」入口', 'error');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        return;
      }

      showToast(currentMode === 'register' ? '注册成功，请登录' : '登录成功');
      const target = role === 'admin' ? 'admin.html' : 'index.html';
      setTimeout(() => {
        window.location.replace(target);
      }, 500);
    } else if (currentMode === 'register' && data.code === 0) {
      // 🔒 用户枚举修复：注册已存在用户名时返回通用提示
      showToast('注册请求已提交，请登录');
      toggleMode(); // 切换到登录模式
    } else {
      showToast(data.message || '操作失败', 'error');
      // 注册失败刷新验证码，防止重放
      if (currentMode === 'register') {
        document.getElementById('captchaInput').value = '';
        window.refreshCaptcha();
      }
      if (data.message && data.message.includes('密码错误')) {
        document.getElementById('password').value = '';
        document.getElementById('password').focus();
      }
    }
  } catch (error) {
    console.error('请求失败:', error);
    showToast('网络错误，请稍后重试', 'error');
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('username').focus();
  updateUI();
});

// Enter key support
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activeEl = document.activeElement;
    if (activeEl.id === 'username') {
      document.getElementById('password').focus();
    } else if (activeEl.id === 'password') {
      document.getElementById('pin').focus();
    } else if (activeEl.id === 'pin') {
      doLogin();
    } else if (activeEl.id === 'captchaInput') {
      doLogin();
    }
  }
});
