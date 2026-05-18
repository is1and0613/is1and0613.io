// Service Worker — NightShift 查寝系统
// 版本更新时修改此常量（deploy checklist 第一项）
const CACHE_NAME = 'nightshift-v2026-0518-b';

// 安装：skipWaiting 立即激活，不预缓存
self.addEventListener('install', () => {
  self.skipWaiting();
});

// 激活：清理所有旧版本缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  // 不调用 clients.claim()，让新 SW 在下次导航时接管
});

// 是否可缓存的静态资源
function isCacheableAsset(url) {
  const pathname = url.pathname;
  return (
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.woff')
  );
}

// 请求拦截：仅缓存静态资源（Stale-While-Revalidate）
self.addEventListener('fetch', e => {
  const { request } = e;

  // 非 GET 不拦截（POST/PUT 等 API 请求直接放行）
  if (request.method !== 'GET') return;

  // 导航请求（HTML 页面）不拦截，始终走网络
  if (request.mode === 'navigate') return;

  const url = new URL(request.url);

  // API 请求不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 跨域请求不缓存
  if (url.origin !== location.origin) return;

  // 仅缓存静态资源
  if (!isCacheableAsset(url)) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const fetchPromise = fetch(request).then(networkRes => {
          if (networkRes.ok) {
            cache.put(request, networkRes.clone());
          }
          return networkRes;
        }).catch(err => {
          // 网络失败时，若有缓存则返回缓存（已在下方 cached || fetchPromise 处理）
          // 若无缓存，返回一个友好错误响应
          if (!cached) {
            console.warn('SW: 静态资源加载失败且无缓存:', url.pathname, err);
          }
          throw err;
        });

        // 缓存优先返回，后台更新
        return cached || fetchPromise;
      })
    )
  );
});
