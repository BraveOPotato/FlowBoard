/* FlowBoard Service Worker */
const CACHE = 'flowboard-v1.0.3';
const ASSETS = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  // Don't intercept API/server calls
  if (e.request.url.includes('/api/') || e.request.url.includes(':3737')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
