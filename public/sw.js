const CACHE = 'flowboard-v1.2.3';
// ponytail: retain immutable bundles for older open tabs; add client-aware pruning if storage grows too large.
const ASSETS = 'flowboard-assets';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(['/', '/icon.ico']))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('flowboard-') && k !== CACHE && k !== ASSETS).map(async (k) => {
        // Migrate bundles cached by 1.2.1/1.2.2 before removing their old app shells.
        const old = await caches.open(k);
        const assets = await caches.open(ASSETS);
        for (const req of await old.keys()) {
          if (new URL(req.url).pathname.startsWith('/assets/')) await assets.put(req, await old.match(req));
        }
        await caches.delete(k);
      })))
      .then(() => self.clients.claim()),
  );
});

const put = (e, req, res, cache = CACHE) => {
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    e.waitUntil(caches.open(cache).then((c) => c.put(req, copy)).catch(() => {}));
  }
  return res;
};

const unavailable = () => new Response('Unavailable offline. Reconnect and reload FlowBoard.', { status: 503 });

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
        .then((res) => put(e, '/', res))
        .catch(async () => (await caches.match('/')) || unavailable()),
    );
    return;
  }

  // Hashed assets and fonts: cache first, fill the cache on first use.
  e.respondWith(
    caches.match(request)
      .then((hit) => hit || fetch(request).then((res) => put(e, request, res, sameOrigin && url.pathname.startsWith('/assets/') ? ASSETS : CACHE)))
      .catch(() => unavailable()),
  );
});
