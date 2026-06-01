// assets/js/sync-queue.js — v18 离线同步队列
// 使用 IndexedDB 持久化待同步的 API 请求，网络恢复时自动重试

const DB_NAME = 'NightShiftSync';
const DB_VERSION = 1;
const STORE_NAME = 'pending_syncs';

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

// 将失败的同步请求入队
async function enqueueSync(payload) {
  try {
    var db = await openSyncDB();
    var tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      url: payload.url,
      body: payload.body,
      timestamp: Date.now()
    });
    return new Promise(function (resolve) {
      tx.oncomplete = resolve;
    });
  } catch (e) {
    console.error('sync-queue: enqueue failed', e);
  }
}

// 获取所有待同步项
async function dequeueAll() {
  try {
    var db = await openSyncDB();
    var tx = db.transaction(STORE_NAME, 'readonly');
    var store = tx.objectStore(STORE_NAME);
    return new Promise(function (resolve) {
      var req = store.getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve([]); };
    });
  } catch (e) {
    return [];
  }
}

// 清空队列
async function clearSyncQueue() {
  try {
    var db = await openSyncDB();
    var tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    return new Promise(function (resolve) {
      tx.oncomplete = resolve;
    });
  } catch (e) { /* ignore */ }
}

// 批量处理待同步队列
async function processSyncQueue() {
  var items = await dequeueAll();
  if (items.length === 0) return;

  var success = true;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    try {
      await apiFetch(item.url, { method: 'POST', body: item.body });
    } catch (e) {
      success = false;
      break;
    }
  }

  if (success) {
    await clearSyncQueue();
    if (typeof showToast === 'function') {
      showToast('已同步 ' + items.length + ' 条离线记录', 'info', 3000);
    }
  }
}

// 网络恢复时自动处理队列
window.addEventListener('online', function () {
  processSyncQueue();
});
