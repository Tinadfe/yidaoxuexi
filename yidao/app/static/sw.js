/* 医道学堂 PWA Service Worker：网络优先，离线兜底 */
const CACHE = 'yidao-v1';
const CORE = ['/static/style.css', '/static/app.js', '/static/manifest.json', '/static/logo.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(url.pathname.startsWith('/api/')) return;              // API 永远走网络
  e.respondWith(
    fetch(e.request).then(res => {
      if(e.request.method === 'GET' && res.ok && (url.pathname.startsWith('/static/') || url.pathname === '/')){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
