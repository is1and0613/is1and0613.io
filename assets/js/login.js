// assets/js/login.js — 登录/注册页逻辑

let currentMode = 'login'; // 'login' | 'register'

function toggleMode() {
  currentMode = currentMode === 'login' ? 'register' : 'login';
  const loginGroup = document.getElementById('loginBtnGroup');
  const registerBtn = document.getElementById('registerBtn');
  const switchText = document.getElementById('switchText');
  const switchLink = document.getElementById('switchLink');
  const title = document.querySelector('.login-subtitle');

  if (currentMode === 'register') {
    loginGroup.style.display = 'none';
    registerBtn.style.display = 'flex';
    switchText.textContent = '已有账户？';
    switchLink.textContent = '返回登录';
    title.textContent = '注册新账户以继续使用';
  } else {
    loginGroup.style.display = 'flex';
    registerBtn.style.display = 'none';
    switchText.textContent = '没有账户？';
    switchLink.textContent = '注册新账户';
    title.textContent = '登录或注册以继续使用';
  }
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

  const btn = document.querySelector('.login-btn');
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

      // 根据 role 自动跳转
      let role = 'inspector';
      try {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        role = payload.role || 'inspector';
      } catch (e) { /* use default */ }

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
