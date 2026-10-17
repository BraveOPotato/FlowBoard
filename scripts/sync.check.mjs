// Run: npm run test:sync (requires Chromium, or set CHROME_BIN).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import worker from '../worker/index.js';
import { createDatabase } from '../worker/test-db.js';

const { sql, env } = createDatabase();
const workerUrl = process.env.SYNC_WORKER_URL;
if (workerUrl) assert.ok(['localhost', '127.0.0.1'].includes(new URL(workerUrl).hostname), 'Only local test workers are allowed');
const profile = await mkdtemp(join(tmpdir(), 'flowboard-sync-'));
let finish;
const finished = new Promise(resolve => { finish = resolve; });
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'sync-check', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/sync-check') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><body>Running sync checks<script>addEventListener("error", e => fetch("/sync-result", {method:"POST", body: JSON.stringify({error:e.message})}));</script><script type="module" src="/src/sync.check.ts"></script></body></html>');
      } else if (req.url === '/sync-result') {
        let body = '';
        for await (const part of req) body += part;
        finish(JSON.parse(body));
        res.end('ok');
      } else if (req.url?.startsWith('/api/')) {
        let body = '';
        for await (const part of req) body += part;
        const response = workerUrl
          ? await fetch(`${workerUrl}${req.url}`, { method: req.method, body: body || undefined })
          : await worker.fetch(new Request(`https://test${req.url}`, { method: req.method, body: body || undefined }), env);
        if (!response.ok) console.error(`Test API ${req.url}: ${response.status} ${await response.clone().text()}`);
        // Node fetch has already decompressed an external worker response.
        const headers = new Headers(response.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        res.writeHead(response.status, Object.fromEntries(headers));
        res.end(await response.text());
      } else next();
    });
  } }],
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const child = spawn(process.env.CHROME_BIN || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${address.port}/sync-check`]);
  let errors = '';
  child.stderr.on('data', part => { errors += part; });
  let timer;
  try {
    const result = await Promise.race([finished, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Sync checks timed out: ${errors}`)), 60000);
      child.on('error', reject);
      child.on('exit', code => reject(new Error(`Chromium exited ${code}: ${errors}`)));
    })]);
    assert.ok(result.ok, result.error);
    console.log(result.results.join('\n'));
    console.log('browser sync checks passed');
  } finally {
    clearTimeout(timer);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
} finally {
  await server.close();
  sql.close();
  await rm(profile, { recursive: true, force: true });
}
