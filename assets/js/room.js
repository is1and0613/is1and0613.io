// assets/js/room.js — 多人查寝房间逻辑

const roomState = {
  mode: null,           // null | 'single' | 'multi'
  room: null,           // room_info from sync
  code: null,
  states: [],           // room_states from sync
  logs: [],             // room_logs from sync
  messages: [],         // room_messages from sync
  members: [],          // room_members from sync
  pollingTimer: null,
  lastMsgId: 0,
  lastReadId: 0,        // last message ID user has actually seen
  unreadCount: 0,       // unread message count for badge
};

// ============================================
// Mode selection
// ============================================

function showModeSelection() {
  document.getElementById('modeOverlay').classList.add('active');
}

function selectMode(mode) {
  roomState.mode = mode;
  sessionStorage.setItem('checkMode', mode);
  document.getElementById('modeOverlay').classList.remove('active');

  if (mode === 'single') {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    loadDormData();
  } else {
    showRoomLobby();
  }
}

// ============================================
// Room lobby
// ============================================

function showRoomLobby() {
  document.getElementById('roomLobby').style.display = 'block';
  document.getElementById('dormContainer').style.display = 'none';
  document.querySelector('.bottom-bar').style.display = 'none';
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.search-section').style.display = 'none';
  document.querySelector('.floor-tabs').style.display = 'none';
  document.querySelector('.filter-bar').style.display = 'none';
  document.querySelector('.status-bar').style.display = 'none';
}

function hideRoomLobby() {
  document.getElementById('roomLobby').style.display = 'none';
  document.getElementById('roomView').style.display = 'none';
  document.querySelector('.header').style.display = '';
  document.querySelector('.search-section').style.display = '';
  document.querySelector('.floor-tabs').style.display = '';
  document.querySelector('.filter-bar').style.display = '';
  document.querySelector('.status-bar').style.display = '';
  document.querySelector('.bottom-bar').style.display = '';
  document.getElementById('dormContainer').style.display = '';
  document.getElementById('floatingChatBtn').classList.remove('show');
  closeAllDrawers();
}

async function createRoom() {
  const btn = document.getElementById('createRoomBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>创建中...';

  try {
    const data = await apiFetch('/api/room', {
      method: 'POST',
      body: JSON.stringify({ action: 'create' }),
    });

    if (data.success) {
      roomState.code = data.code;
      roomState.room = { code: data.code, expires_at: data.expires_at };
      showRoomView();
    }
  } catch (e) {
    // apiFetch handles toast
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus-circle"></i>创建房间';
  }
}

async function joinRoom() {
  const codeInput = document.getElementById('roomCodeInput');
  const code = codeInput.value.trim().toUpperCase();

  if (!code || code.length !== 6) {
    showToast('请输入6位房间码');
    return;
  }

  const btn = document.getElementById('joinRoomBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>加入中...';

  try {
    const data = await apiFetch('/api/room', {
      method: 'POST',
      body: JSON.stringify({ action: 'join', code }),
    });

    if (data.success) {
      roomState.code = data.code;
      roomState.room = { code: data.code, expires_at: data.expires_at };
      showRoomView();
    }
  } catch (e) {
    // apiFetch handles toast
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i>加入房间';
  }
}

// ============================================
// Room view
// ============================================

async function showRoomView() {
  document.getElementById('roomLobby').style.display = 'none';

  // Keep main UI (header, search, floor tabs, filter, dorm container, bottom bar)
  document.querySelector('.header').style.display = '';
  document.querySelector('.search-section').style.display = '';
  document.querySelector('.floor-tabs').style.display = '';
  document.querySelector('.filter-bar').style.display = '';
  document.querySelector('.status-bar').style.display = '';
  document.querySelector('.bottom-bar').style.display = '';
  document.getElementById('dormContainer').style.display = '';

  // Switch header: show room code, hide title
  document.getElementById('headerTitle').style.display = 'none';
  document.getElementById('headerRoomCode').style.display = '';
  document.getElementById('headerRoomCode').textContent = roomState.code;
  document.getElementById('headerCountdown').style.display = '';
  document.getElementById('btnWorkWechat').style.display = 'none';
  document.getElementById('btnReset').style.display = 'none';
  document.getElementById('btnSyncRoom').style.display = '';
  document.getElementById('btnLeaveRoom').style.display = '';

  // Show room members bar
  document.getElementById('roomView').style.display = 'flex';
  document.getElementById('floatingChatBtn').classList.add('show');

  // Persist room code for refresh recovery
  sessionStorage.setItem('roomCode', roomState.code);

  // Load dorm data if not already loaded
  if (!window.dormData) {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    await loadDormData();
  }

  await syncRoom();
  updateRoomCountdown();
  startRoomPolling();
}

async function syncRoom() {
  try {
    const data = await apiFetch(`/api/room?action=sync&code=${roomState.code}`);

    if (data.success) {
      // Check if room expired during sync
      if (data.room_info && data.room_info.status === 'expired') {
        stopRoomPolling();
        showToast('房间已过期（90分钟有效期）');
        setTimeout(() => { leaveRoom(true); }, 1500);
        return;
      }

      roomState.room = data.room_info;
      roomState.states = data.states || [];
      roomState.logs = data.logs || [];
      roomState.messages = data.messages || [];
      roomState.members = data.members || [];

      // Map room states to single-mode studentStatus
      if (roomState.states.length > 0) {
        roomState.states.forEach(s => {
          const statusMap = { present: 'in', absent: 'absent', leave: 'leaveInside', late: 'absent' };
          const mappedStatus = statusMap[s.status] || 'in';
          state.studentStatus[s.student_name] = { status: mappedStatus, reason: s.detail || '' };
        });
      }

      if (data.messages && data.messages.length > 0) {
        const newLastId = data.messages[data.messages.length - 1].id;
        if (newLastId > roomState.lastMsgId) {
          roomState.lastMsgId = newLastId;
        }
        const chatOpen = document.getElementById('chatDrawer').classList.contains('open');
        if (!chatOpen) {
          roomState.unreadCount = data.messages.filter(m => m.id > roomState.lastReadId).length;
        } else {
          roomState.unreadCount = 0;
          roomState.lastReadId = newLastId;
        }
      }

      // Use single-mode renderer
      if (typeof refreshView === 'function') refreshView();
      renderRoomMessages();
      renderRoomLogs();
      renderRoomMembers();
      updateRoomCountdown();
      updateChatBadge();
    }
  } catch (e) {
    // apiFetch handles toast
  }
}

function startRoomPolling() {
  stopRoomPolling();
  // State polling: 30s
  roomState.pollingTimer = setInterval(() => {
    syncRoom();
  }, 30000);
  // Message polling: 3s
  roomState.msgPollingTimer = setInterval(() => {
    syncRoomMessages();
  }, 3000);
}

async function syncRoomMessages() {
  try {
    const data = await apiFetch(`/api/room?action=sync&code=${roomState.code}&messages_only=1`);
    if (data.success && data.messages) {
      roomState.messages = data.messages;
      if (data.messages.length > 0) {
        const newLastId = data.messages[data.messages.length - 1].id;
        if (newLastId > roomState.lastMsgId) {
          roomState.lastMsgId = newLastId;
        }
        const chatOpen = document.getElementById('chatDrawer').classList.contains('open');
        if (!chatOpen) {
          roomState.unreadCount = data.messages.filter(m => m.id > roomState.lastReadId).length;
        } else {
          roomState.unreadCount = 0;
          roomState.lastReadId = newLastId;
        }
      }
      renderRoomMessages();
      updateChatBadge();
    }
  } catch (e) { /* silent */ }
}

function stopRoomPolling() {
  if (roomState.pollingTimer) {
    clearInterval(roomState.pollingTimer);
    roomState.pollingTimer = null;
  }
  if (roomState.msgPollingTimer) {
    clearInterval(roomState.msgPollingTimer);
    roomState.msgPollingTimer = null;
  }
}

// ============================================
// Room state updates
// ============================================

async function updateRoomStudentState(studentName, newStatus, detail) {
  const prevState = roomState.states.find(s => s.student_name === studentName);
  const oldStatus = prevState ? prevState.status : 'present';
  if (prevState) {
    prevState.status = newStatus;
    prevState.updated_at = new Date().toISOString();
  }

  try {
    await apiFetch('/api/room', {
      method: 'POST',
      body: JSON.stringify({
        action: 'state',
        code: roomState.code,
        student_name: studentName,
        new_status: newStatus,
        detail: detail || null,
      }),
    });
  } catch (e) {
    // Rollback on failure
    if (prevState) prevState.status = oldStatus;
    if (typeof refreshView === 'function') refreshView();
  }
}

async function sendRoomMessage() {
  const input = document.getElementById('roomMessageInput');
  const content = input.value.trim();
  if (!content) return;
  if (content.length > 500) {
    showToast('消息不能超过500字');
    return;
  }

  input.value = '';

  // Optimistic local add
  const username = sessionStorage.getItem('displayName') || sessionStorage.getItem('username') || '我';
  roomState.messages.push({
    id: Date.now(),
    username,
    content,
    created_at: new Date().toISOString(),
  });
  renderRoomMessages();

  try {
    await apiFetch('/api/room', {
      method: 'POST',
      body: JSON.stringify({ action: 'message', code: roomState.code, content }),
    });
  } catch (e) {
    // Undo on failure
    roomState.messages.pop();
    renderRoomMessages();
  }
}

// ============================================
// UI rendering
// ============================================

function renderRoomMembers() {
  const container = document.getElementById('roomMembers');
  if (!container) return;
  container.innerHTML = roomState.members.map(m =>
    `<span class="room-member-tag ${m.role === 'creator' ? 'creator' : ''}">${m.display_name || m.username}${m.role === 'creator' ? ' (房主)' : ''}</span>`
  ).join('');
}

function renderRoomMessages() {
  const container = document.getElementById('roomMessages');
  if (!container) return;
  container.innerHTML = roomState.messages.length === 0
    ? '<div class="room-chat-empty">暂无消息</div>'
    : roomState.messages.map(m => {
        const time = m.created_at ? new Date(m.created_at + 'Z').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="room-msg">
          <span class="room-msg-user">${m.username || m.display_name || '未知'}</span>
          <span class="room-msg-text">${escapeHtml(m.content)}</span>
          <span class="room-msg-time">${time}</span>
        </div>`;
      }).join('');
  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function renderRoomLogs() {
  const container = document.getElementById('roomLogs');
  if (!container) return;
  container.innerHTML = roomState.logs.length === 0
    ? '<div class="room-log-empty">暂无操作记录</div>'
    : roomState.logs.slice(0, 20).map(l => {
        const time = l.created_at ? new Date(l.created_at + 'Z').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        let text = `[${time}] ${l.username || l.display_name || '系统'} `;
        if (l.action_type === 'status_change') {
          text += `将 ${l.target_student} 由 ${statusCn(l.old_status)} 更新为 ${statusCn(l.new_status)}`;
        } else if (l.action_type === 'join') {
          text += l.detail || '加入了房间';
        } else {
          text += l.detail || l.action_type;
        }
        return `<div class="room-log-item">${escapeHtml(text)}</div>`;
      }).join('');
}

function statusCn(s) {
  const map = { present: '在寝', absent: '未归', leave: '请假', late: '迟到' };
  return map[s] || s;
}

function updateRoomCountdown() {
  const el = document.getElementById('headerCountdown');
  if (!el || !roomState.room || !roomState.room.expires_at) return;

  const expiresAt = new Date(roomState.room.expires_at + 'Z');
  const now = new Date();
  const diff = expiresAt - now;

  if (diff <= 0) {
    el.textContent = ' · 已过期';
    el.style.color = '#e74c3c';
    stopRoomPolling();
    showToast('房间已过期（90分钟有效期）');
    setTimeout(() => { leaveRoom(true); }, 1500);
    return;
  }

  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  el.textContent = ` · ${min}分${sec}秒后过期`;
  el.style.color = diff < 300000 ? '#e74c3c' : '#999';
}

function leaveRoom(silent) {
  if (!silent && !confirm('确定要退出房间吗？')) return;
  stopRoomPolling();
  // Switch to single mode
  roomState.mode = 'single';
  sessionStorage.setItem('checkMode', 'single');
  sessionStorage.removeItem('roomCode');
  roomState.room = null;
  roomState.code = null;
  roomState.states = [];
  roomState.logs = [];
  roomState.messages = [];
  roomState.members = [];
  roomState.lastReadId = 0;
  roomState.unreadCount = 0;
  updateChatBadge();
  // Restore header
  document.getElementById('headerTitle').style.display = '';
  document.getElementById('headerRoomCode').style.display = 'none';
  document.getElementById('headerCountdown').style.display = 'none';
  document.getElementById('btnWorkWechat').style.display = '';
  document.getElementById('btnReset').style.display = '';
  document.getElementById('btnSyncRoom').style.display = 'none';
  document.getElementById('btnLeaveRoom').style.display = 'none';
  // Hide room-specific elements, show main UI
  hideRoomLobby();
  closeAllDrawers();
  document.getElementById('floatingChatBtn').classList.remove('show');
  // Clear room-mapped student status, restore single-player state
  if (typeof restoreState === 'function') restoreState();
  if (typeof refreshView === 'function') refreshView();
}

// ============================================
// UI toggles
// ============================================

function toggleChatDrawer() {
  const drawer = document.getElementById('chatDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const isOpen = drawer.classList.toggle('open');
  if (isOpen) {
    backdrop.classList.add('show');
    // Default to messages tab
    switchDrawerTab('messages');
    // Mark all as read
    roomState.unreadCount = 0;
    if (roomState.messages.length > 0) {
      roomState.lastReadId = roomState.messages[roomState.messages.length - 1].id;
    }
    updateChatBadge();
  } else {
    backdrop.classList.remove('show');
  }
}

function switchDrawerTab(tab) {
  const tabMessages = document.getElementById('tabMessages');
  const tabLogs = document.getElementById('tabLogs');
  const msgBody = document.getElementById('roomMessages');
  const logBody = document.getElementById('roomLogs');
  const inputBar = document.getElementById('chatInputBar');

  if (tab === 'messages') {
    tabMessages.classList.add('active');
    tabLogs.classList.remove('active');
    msgBody.style.display = '';
    logBody.style.display = 'none';
    inputBar.style.display = '';
    renderRoomMessages();
  } else {
    tabLogs.classList.add('active');
    tabMessages.classList.remove('active');
    logBody.style.display = '';
    msgBody.style.display = 'none';
    inputBar.style.display = 'none';
    renderRoomLogs();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function closeAllDrawers() {
  document.getElementById('chatDrawer').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('show');
}

function updateChatBadge() {
  const btn = document.getElementById('floatingChatBtn');
  if (!btn) return;
  let badge = btn.querySelector('.unread-badge');
  if (roomState.unreadCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      btn.appendChild(badge);
    }
    badge.textContent = roomState.unreadCount > 99 ? '99+' : roomState.unreadCount;
  } else if (badge) {
    badge.remove();
  }
}

function generateRoomReport() {
  if (typeof showReportModal === 'function') {
    showReportModal();
  }
}

// Countdown ticker
setInterval(() => {
  if (roomState.room) updateRoomCountdown();
}, 10000);
