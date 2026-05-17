// assets/js/dorm-loader.js — 统一宿舍数据加载

/**
 * 渲染 Loading Overlay DOM（如果页面没有则自动插入）
 */
function ensureLoadingOverlay() {
  if (document.getElementById('loadingOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-spinner-large"></div>
    <div class="loading-text">正在加载宿舍数据...</div>
    <div class="loading-error" id="loadingError">
      <p>加载数据失败，请检查网络后刷新重试</p>
      <button onclick="location.reload()">刷新页面</button>
    </div>
  `;
  document.body.insertBefore(overlay, document.body.firstChild);
}

/**
 * 加载宿舍数据（带 Loading Overlay + JWT 校验 + 错误处理）
 * @param {string} apiUrl 默认 '/api/dorm-data'
 * @returns {Promise<Object>} 宿舍数据对象 { dormData, nameIndex }
 */
async function loadDormData(apiUrl = '/api/dorm-data') {
  const token = sessionStorage.getItem('authToken');
  if (!token) {
    window.location.replace('login.html');
    return null;
  }

  ensureLoadingOverlay();

  try {
    const response = await fetch(apiUrl, {
      headers: { 'Authorization': 'Bearer ' + token }
    });

    if (response.status === 401) {
      sessionStorage.removeItem('authToken');
      sessionStorage.removeItem('loggedIn');
      window.location.replace('login.html');
      return null;
    }

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    window.dormData = data.dormData;
    window.nameIndex = data.nameIndex;

    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.add('hidden');

    return data;
  } catch (error) {
    console.error('加载宿舍数据失败:', error);
    const spinner = document.querySelector('.loading-spinner-large');
    const text = document.querySelector('.loading-text');
    const errorEl = document.getElementById('loadingError');
    if (spinner) spinner.style.display = 'none';
    if (text) text.style.display = 'none';
    if (errorEl) errorEl.classList.add('show');
    return null;
  }
}
