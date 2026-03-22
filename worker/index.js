/**
 * FlowBoard Cloudflare Worker
 *
 * KV key scheme:  SHA-256(boardId + ":" + password)  →  JSON board data
 * TTL: 90 days (7,776,000 seconds) — resets on every read or write
 *
 * Endpoints:
 *   POST /api/board/get               — fetch board  { boardId, keyHash }
 *   POST /api/board/put               — save board   { boardId, keyHash, data }
 *   POST /api/board/touch             — renew TTL    { boardId, keyHash }
 *   GET  /api/invite/:boardId         — returns boardId (for invite link resolution)
 *
 * KV namespace binding: BOARDS  (configure in wrangler.toml)
 */

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── Invite link resolution ────────────────────────────
    // Just confirms the boardId exists in KV (any key with that prefix)
    const inviteMatch = path.match(/^\/api\/invite\/([^/]+)$/);
    if (inviteMatch) {
      const boardId = decodeURIComponent(inviteMatch[1]);
      // We can't verify without the password — just echo the boardId back
      return json({ boardId });
    }

    // ── Require POST + JSON body from here ────────────────
    if (request.method !== 'POST') return err('Method not allowed', 405);

    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    const { boardId, keyHash } = body;
    if (!boardId || !keyHash) return err('boardId and keyHash required');

    // Validate keyHash format (64-char hex SHA-256)
    if (!/^[0-9a-f]{64}$/.test(keyHash)) return err('Invalid keyHash');

    const kvKey = keyHash; // KV key IS the hash — boardId never stored as key

    // ── GET board ─────────────────────────────────────────
    if (path === '/api/board/get') {
      const raw = await env.BOARDS.get(kvKey);
      if (!raw) return json({ found: false });

      // Touch TTL on read
      await env.BOARDS.put(kvKey, raw, { expirationTtl: TTL_SECONDS });

      let data;
      try { data = JSON.parse(raw); } catch { return err('Corrupt board data', 500); }
      return json({ found: true, data });
    }

    // ── PUT board ─────────────────────────────────────────
    if (path === '/api/board/put') {
      const { data } = body;
      if (!data) return err('data required');
      await env.BOARDS.put(kvKey, JSON.stringify(data), { expirationTtl: TTL_SECONDS });
      return json({ ok: true });
    }

    // ── TOUCH (renew TTL without full sync) ───────────────
    if (path === '/api/board/touch') {
      const raw = await env.BOARDS.get(kvKey);
      if (!raw) return json({ found: false });
      await env.BOARDS.put(kvKey, raw, { expirationTtl: TTL_SECONDS });
      return json({ ok: true });
    }

    return err('Not found', 404);
  },
};
