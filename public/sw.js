const CACHE = 'flowboard-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon.ico'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res));
  return res.clone();
};

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  // Pages: network first so deploys show up, cached app shell when offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => put('/', res))
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Hashed assets and fonts: cache first, fill the cache on first use.
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))),
  );
});
