// Run: node scripts/sw.check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const origin = 'https://flowboard.test';
const key = (req) => new URL(typeof req === 'string' ? req : req.url, origin).href;
const stores = new Map();
let failWrites = false;
const caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async addAll(urls) { for (const url of urls) await this.put(url, await network(url)); },
      async put(req, res) {
        if (failWrites) throw new Error('quota exceeded');
        // Read the body later, like the real asynchronous Cache API.
        await Promise.resolve();
        data.set(key(req), new Response(await res.text(), { status: res.status }));
      },
      async match(req) { return data.get(key(req))?.clone(); },
      async keys() { return [...data.keys()].map((url) => new Request(url)); },
    };
  },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); },
  async match(req) {
    for (const name of stores.keys()) {
      const hit = await (await this.open(name)).match(req);
      if (hit) return hit;
    }
  },
};
let network = async () => new Response('new app');
let skipped = false;
let claimed = false;
const handlers = {};
runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
  URL, Response, caches, fetch: (...args) => network(...args),
  self: {
    location: { origin },
    addEventListener(type, handler) { handlers[type] = handler; },
    async skipWaiting() { skipped = true; },
    clients: { async claim() { claimed = true; } },
  },
});
const dispatch = (type, request) => {
  const pending = [];
  let response;
  handlers[type]({ request, waitUntil(promise) { pending.push(promise); }, respondWith(promise) { response = promise; } });
  return { response, async done() { for (const promise of pending) await promise; } };
};
const get = (path, mode = 'cors') => dispatch('fetch', { url: new URL(path, origin).href, method: 'GET', mode });

// Failed installation must not trigger takeover of the old app.
network = async () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(dispatch('install').done());
assert.equal(skipped, false);
network = async () => new Response('new app');
await dispatch('install').done();
assert.equal(skipped, true);

await (await caches.open('flowboard-v1.2.1')).put('/assets/old.js', new Response('old bundle'));
await (await caches.open('another-app')).put('/', new Response('unrelated'));
await dispatch('activate').done();
assert.equal(claimed, true);
assert.equal(stores.has('flowboard-v1.2.1'), false);
assert.equal(stores.has('another-app'), true, 'do not delete another app’s cache');
assert.equal(await (await caches.match('/assets/old.js')).text(), 'old bundle', 'keep old tabs working');

const event = get('/assets/new.js');
assert.equal(await (await event.response).text(), 'new app', 'caller can immediately consume the network body');
await event.done();
assert.equal(await (await caches.match('/assets/new.js')).text(), 'new app', 'cache write has its own body and lifetime');

failWrites = true;
const full = get('/assets/full.js');
assert.equal((await full.response).status, 200, 'cache quota must not fail a successful network response');
await full.done();
failWrites = false;
network = async () => { throw new TypeError('Failed to fetch'); };
assert.equal(await (await get('/assets/old.js').response).text(), 'old bundle');
assert.equal((await get('/assets/uncached.js').response).status, 503, 'offline cache miss must not reject respondWith');
assert.equal((await get('https://fonts.googleapis.com/css2?family=Geist').response).status, 503);
assert.equal(await (await get('/board/example', 'navigate').response).text(), 'new app', 'deep routes use the cached shell offline');
stores.clear();
assert.equal((await get('/', 'navigate').response).status, 503, 'missing offline shell still returns a Response');
assert.equal(get('https://api.example.test/data').response, undefined, 'unrelated API requests are not intercepted');
console.log('service worker checks passed');
