const CACHE_NAME = 'dorm-check-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([
    '/', '/index.html', '/login.html', '/upload.html', '/manual-upload.html'
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (/^\/api\//.test(new URL(request.url).pathname)) {
    e.respondWith(fetch(request));
    return;
  }
  e.respondWith(caches.match(request).then(cached => {
    return cached || fetch(request).then(res => {
      if (request.method === 'GET' && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      }
      return res;
    });
  }));
});