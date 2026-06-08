// assets/js/login.js — 登录/注册页逻辑 (v21: 单按钮 + admin 模式切换)

let currentMode = 'login';   // 'login' | 'register'
let loginRole = 'inspector'; // 'inspector' | 'admin'

function updateUI() {
  const title = document.getElementById('loginTitle');
  const subtitle = document.getElementById('loginSubtitle');
  const icon = document.getElementById('loginIcon');
  const btnIcon = document.querySelector('#mainLoginBtn i');
  const btnText = document.getElementById('mainLoginBtnText');
  const switchRow = document.getElementById('switchModeRow');

  if (loginRole === 'admin') {
    // Admin mode
    title.textContent = '管理后台登录';
    subtitle.textContent = '请输入管理员账号密码';
    if (icon) icon.innerHTML = '<i class="fas fa-shield-alt"></i>';
    btnIcon.className = 'fas fa-shield-alt';
    btnText.textContent = '管理员登录';
    // Bottom: only "返回查寝员登录"
    switchRow.innerHTML = '<a href="javascript:void(0)" onclick="switchToInspectorMode()">← 返回查寝员登录</a>';
  } else if (currentMode === 'register') {
    // Register mode
    title.textContent = '晚寝查寝系统';
    subtitle.textContent = '注册新账户以继续使用';
    if (icon) icon.innerHTML = '<i class="fas fa-bed"></i>';
    btnIcon.className = 'fas fa-user-plus';
    btnText.textContent = '注册新账户';
    switchRow.innerHTML =
      '<span>已有账户？</span>' +
      '<a href="javascript:void(0)" onclick="toggleMode()">返回登录</a>';
  } else {
    // Default: inspector login
    title.textContent = '晚寝查寝系统';
    subtitle.textContent = '登录或注册以继续使用';
    if (icon) icon.innerHTML = '<i class="fas fa-bed"></i>';
    btnIcon.className = 'fas fa-user-check';
    btnText.textContent = '查寝员登录';
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

  const btn = document.getElementById('mainLoginBtn');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>处理中...';
  btn.disabled = true;

  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: currentMode,
        username,
        password,
      }),
    });

    const data = await response.json();

    if (data.success) {
      sessionStorage.setItem('authToken', data.token);
      sessionStorage.setItem('loggedIn', 'true');
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

      // v21: 如果是 admin 模式但后端返回非 admin，给出提示
      if (loginRole === 'admin' && role !== 'admin') {
        showToast('该账户非管理员，请使用查寝员登录', 'error');
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        return;
      }

      showToast(currentMode === 'register' ? '注册成功' : '登录成功');
      const target = role === 'admin' ? 'admin.html' : 'index.html';
      setTimeout(() => {
        window.location.replace(target);
      }, 500);
    } else {
      showToast(data.message || '操作失败', 'error');
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
      doLogin();
    }
  }
});
