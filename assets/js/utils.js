// assets/js/utils.js — 通用工具函数

/**
 * 显示 Toast 提示
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration 毫秒
 */
function showToast(message, type = 'info', duration = 2000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * 复制文本到剪贴板
 */
async function copyToClipboard(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制');
      return;
    } catch (e) { /* fall through */ }
  }
  fallbackCopy(text);
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast('已复制');
  } catch (e) {
    showToast('复制失败', 'error');
  }
  document.body.removeChild(textarea);
}

/**
 * 防抖
 */
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 返回上一页或跳转到指定页
 */
function goBack(fallbackUrl = 'index.html') {
  if (document.referrer && document.referrer.includes(window.location.host)) {
    window.history.back();
  } else {
    window.location.href = fallbackUrl;
  }
}

/**
 * 从 sessionStorage 获取 Token，无则跳转登录
 * @returns {string|null} token
 */
function requireAuth() {
  const token = sessionStorage.getItem('authToken');
  if (!token) {
    showToast('未登录，请重新登录');
    setTimeout(() => { window.location.replace('login.html'); }, 1000);
    return null;
  }
  return token;
}

/**
 * 带统一错误处理的 API 请求封装
 * 自动带 Token、自动 401 跳转、自动 JSON 解析、统一 Toast 错误
 */
async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem('authToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (e) {
    showToast('网络错误，请稍后重试', 'error');
    throw e;
  }

  if (response.status === 401) {
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('loggedIn');
    showToast('登录已过期，请重新登录');
    setTimeout(() => { window.location.replace('login.html'); }, 1500);
    throw new Error('Unauthorized');
  }

  const data = await response.json();

  if (!response.ok) {
    const msg = data.message || data.error || '请求失败';
    showToast(msg, 'error');
    throw new Error(msg);
  }

  return data;
}

/**
 * 注册 Service Worker + 更新检测
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('SW registered:', reg.scope);

    // 已存在等待中的 SW，提示用户刷新
    if (reg.waiting) {
      showUpdateToast();
      return;
    }

    // 监听新 SW 安装中
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateToast();
        }
      });
    });
  }).catch(err => {
    console.warn('SW registration failed:', err);
  });

  // controllerchange：旧页面被新 SW 接管时提示
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    showToast('系统已更新，请刷新页面获取最新版本', 'info', 0);
  });
}

/**
 * 显示持久更新提示（不自动消失）
 */
function showUpdateToast() {
  let toast = document.getElementById('sw-update-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sw-update-toast';
    toast.className = 'toast show info';
    toast.style.cssText = 'cursor:pointer;white-space:normal;text-align:center;max-width:280px;';
    toast.textContent = '系统已更新，点击刷新';
    toast.addEventListener('click', () => {
      window.location.reload();
    });
    document.body.appendChild(toast);
  }
}

// 页面加载时自动注册 Service Worker
registerServiceWorker();

// ============================================
// 主题初始化（所有页面通用）
// ============================================
(function initTheme() {
  const saved = localStorage.getItem('nightshift_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  if (!localStorage.getItem('nightshift_theme')) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.matches) document.documentElement.setAttribute('data-theme', 'dark');
  }
  // 更新主题图标
  document.addEventListener('DOMContentLoaded', function() {
    updateThemeIcon();
  });
})();

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('nightshift_theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const icons = document.querySelectorAll('#btnTheme i, .btn-theme i');
  const theme = document.documentElement.getAttribute('data-theme');
  icons.forEach(icon => {
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  });
}
