/**
 * FlowBoard Cloudflare Worker — D1 backend
 *
 * Replaces KV with D1 (SQLite). API surface identical to KV version.
 * TTL enforced by scheduled cron (0 3 * * *) pruning rows older than 90 days.
 *
 * ── Legacy endpoints (full-state sync, unchanged) ────────────────────────────
 *   POST /api/board/get               — fetch board  { boardId, keyHash }
 *   POST /api/board/put               — save board   { boardId, keyHash, data }
 *   POST /api/board/touch             — renew TTL    { boardId, keyHash }
 *   GET  /api/invite/:boardId         — returns boardId (for invite link resolution)
 *
 * ── CRDT endpoints (operation-log sync) ──────────────────────────────────────
 *   POST /api/crdt/ops/push           — append ops   { boardId, keyHash, ops: [...] }
 *   POST /api/crdt/ops/pull           — fetch ops    { boardId, keyHash, since: <ts> }
 *   POST /api/crdt/state/get          — materialized { boardId, keyHash }
 *   POST /api/crdt/state/snapshot     — force snapshot (GC old ops) { boardId, keyHash }
 *
 * D1 binding: flowboard_db  (configure in wrangler.toml)
 * Schema:     migrations/schema.sql
 */

const TTL_MS           = 90 * 24 * 60 * 60 * 1000;  // 90 days
const GC_MAX_AGE_MS    = 30 * 24 * 60 * 60 * 1000;  // prune ops > 30 days on snapshot
const SNAPSHOT_EVERY   = 200;                         // auto-snapshot every N ops

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


// ── CRDT: apply an op to a mutable state object ──────────────────────────────
// State shape: { boards: {id→obj}, columns: {id→obj}, cards: {id→obj}, activity: {id→obj} }
// LWW: only overwrite a field if incoming op.ts >= field's recorded ts.

function applyOp(state, op) {
  const { type, ts, payload } = op;

  function lwwMerge(existing, incoming, opTs) {
    if (!existing) return { ...incoming, __ts: opTs };
    const merged = { ...existing };
    if (opTs >= (existing.__ts || 0)) Object.assign(merged, incoming, { __ts: opTs });
    return merged;
  }

  switch (type) {
    case 'board.update': {
      const { boardId, ...fields } = payload;
      state.boards[boardId] = lwwMerge(state.boards[boardId], { id: boardId, ...fields }, ts);
      break;
    }
    case 'column.create':
    case 'column.update': {
      const { id, ...fields } = payload;
      state.columns[id] = lwwMerge(state.columns[id], { id, ...fields }, ts);
      break;
    }
    case 'column.delete': {
      const { id } = payload;
      // Mark deleted — don't remove so we can ignore future stale ops
      state.columns[id] = state.columns[id]
        ? { ...state.columns[id], __deleted: true, __ts: ts }
        : { id, __deleted: true, __ts: ts };
      break;
    }
    case 'card.create':
    case 'card.update':
    case 'card.move': {
      const { id, ...fields } = payload;
      state.cards[id] = lwwMerge(state.cards[id], { id, ...fields }, ts);
      break;
    }
    case 'card.delete': {
      const { id } = payload;
      state.cards[id] = state.cards[id]
        ? { ...state.cards[id], __deleted: true, __ts: ts }
        : { id, __deleted: true, __ts: ts };
      break;
    }
    case 'activity.create': {
      const { id, ...fields } = payload;
      if (!state.activity[id]) {
        // Activity is immutable — only insert if not already present
        state.activity[id] = { id, ...fields, __ts: ts };
      }
      break;
    }
  }
}

// Rebuild state from scratch by replaying all ops in ts order
function replayOps(ops) {
  const state = { boards: {}, columns: {}, cards: {}, activity: {} };
  const sorted = [...ops].sort((a, b) => a.ts - b.ts || a.opId.localeCompare(b.opId));
  for (const op of sorted) applyOp(state, op);
  return state;
}

// Convert map-of-objects state → array-of-objects (stripping deleted + __ts meta)
function materialize(mapState) {
  function clean(map) {
    return Object.values(map)
      .filter(x => !x.__deleted)
      .map(({ __ts, __deleted, ...rest }) => rest);
  }
  return {
    boards:   clean(mapState.boards),
    columns:  clean(mapState.columns),
    cards:    clean(mapState.cards),
    activity: clean(mapState.activity),
  };
}

// ── D1 helpers ────────────────────────────────────────────────────────────────

const now = () => Date.now();

// ---- Legacy boards table ----

async function boardGet(db, keyHash) {
  const row = await db.prepare(
    'SELECT data FROM boards WHERE key_hash = ?'
  ).bind(keyHash).first();
  return row ? JSON.parse(row.data) : null;
}

async function boardPut(db, keyHash, data) {
  await db.prepare(
    `INSERT INTO boards (key_hash, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key_hash) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(keyHash, JSON.stringify(data), now()).run();
}

async function boardTouch(db, keyHash) {
  await db.prepare(
    'UPDATE boards SET updated_at = ? WHERE key_hash = ?'
  ).bind(now(), keyHash).run();
}

// ---- CRDT ops table ----

async function opsGet(db, keyHash) {
  const { results } = await db.prepare(
    'SELECT op_id, type, ts, client_id, payload FROM crdt_ops WHERE key_hash = ? ORDER BY ts ASC'
  ).bind(keyHash).all();
  return results.map(r => ({
    opId:     r.op_id,
    type:     r.type,
    ts:       r.ts,
    clientId: r.client_id,
    payload:  JSON.parse(r.payload),
  }));
}

async function opsGetSince(db, keyHash, since) {
  const { results } = await db.prepare(
    'SELECT op_id, type, ts, client_id, payload FROM crdt_ops WHERE key_hash = ? AND ts > ? ORDER BY ts ASC'
  ).bind(keyHash, since).all();
  return results.map(r => ({
    opId:     r.op_id,
    type:     r.type,
    ts:       r.ts,
    clientId: r.client_id,
    payload:  JSON.parse(r.payload),
  }));
}

async function opsCount(db, keyHash) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS cnt FROM crdt_ops WHERE key_hash = ?'
  ).bind(keyHash).first();
  return row ? row.cnt : 0;
}

// Insert new ops — skip existing opIds (idempotent)
async function opsInsert(db, keyHash, ops) {
  if (!ops.length) return;
  const ts = now();
  // D1 batch: up to 100 statements per batch is fine for typical op counts
  const stmts = ops.map(op =>
    db.prepare(
      `INSERT OR IGNORE INTO crdt_ops (op_id, key_hash, type, ts, client_id, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(op.opId, keyHash, op.type, op.ts, op.clientId ?? null, JSON.stringify(op.payload), ts)
  );
  await db.batch(stmts);
}

async function opsDeleteOlderThan(db, keyHash, cutoffTs) {
  await db.prepare(
    'DELETE FROM crdt_ops WHERE key_hash = ? AND ts < ?'
  ).bind(keyHash, cutoffTs).run();
}

// ---- CRDT snapshots table ----

async function snapGet(db, keyHash) {
  const row = await db.prepare(
    'SELECT snap, snap_ts FROM crdt_snapshots WHERE key_hash = ?'
  ).bind(keyHash).first();
  if (!row) return null;
  return { mapState: JSON.parse(row.snap), snapTs: row.snap_ts };
}

async function snapPut(db, keyHash, mapState, snapTs) {
  await db.prepare(
    `INSERT INTO crdt_snapshots (key_hash, snap, snap_ts, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key_hash) DO UPDATE SET snap = excluded.snap, snap_ts = excluded.snap_ts, updated_at = excluded.updated_at`
  ).bind(keyHash, JSON.stringify(mapState), snapTs, now()).run();
}

// Build current map-state: snapshot + replay newer ops
async function buildState(db, keyHash) {
  const [snapRow, ops] = await Promise.all([
    snapGet(db, keyHash),
    opsGet(db, keyHash),
  ]);

  if (!snapRow) {
    // No snapshot — replay everything
    return replayOps(ops);
  }

  // Only replay ops newer than the snapshot
  const { mapState, snapTs } = snapRow;
  const newOps = ops.filter(o => o.ts > snapTs);
  const sorted = newOps.sort((a, b) => a.ts - b.ts || a.opId.localeCompare(b.opId));
  const state = { ...mapState };
  for (const op of sorted) applyOp(state, op);
  return state;
}

// Force snapshot + prune old ops (GC)
async function doSnapshot(db, keyHash) {
  const ops = await opsGet(db, keyHash);
  const mapState = replayOps(ops);
  const snapTs   = now();

  // Prune ops older than GC_MAX_AGE_MS
  const cutoff = snapTs - GC_MAX_AGE_MS;

  await Promise.all([
    snapPut(db, keyHash, mapState, snapTs),
    opsDeleteOlderThan(db, keyHash, cutoff),
  ]);

  return mapState;
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(request, env) {
  const url  = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Invite link — no auth needed, just echo boardId
  const inviteMatch = path.match(/^\/api\/invite\/([^/]+)$/);
  if (inviteMatch) return json({ boardId: decodeURIComponent(inviteMatch[1]) });

  if (request.method !== 'POST') return err('Method not allowed', 405);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body'); }

  const { boardId, keyHash } = body;
  if (!boardId || !keyHash)            return err('boardId and keyHash required');
  if (!/^[0-9a-f]{64}$/.test(keyHash)) return err('Invalid keyHash');

  const db = env.flowboard_db;

  // ── GET board ──────────────────────────────────────────
  if (path === '/api/board/get') {
    let data = await boardGet(db, keyHash);

    if (!data) {
      // Legacy boards table is empty — board may exist only in CRDT tables.
      // Materialise from CRDT state, write back to boards table so future
      // legacy reads (and join attempts) succeed without a second round-trip.
      const count = await opsCount(db, keyHash);
      const snapRow = count ? null : await snapGet(db, keyHash);

      if (count || snapRow) {
        const mapState = count ? await buildState(db, keyHash) : snapRow.mapState;
        data = materialize(mapState);
        // Persist so the legacy path is warm for subsequent reads
        await boardPut(db, keyHash, data);
      }
    }

    if (!data) return json({ found: false });
    await boardTouch(db, keyHash);
    return json({ found: true, data });
  }

  // ── PUT board ──────────────────────────────────────────
  if (path === '/api/board/put') {
    const { data } = body;
    if (!data) return err('data required');
    await boardPut(db, keyHash, data);
    return json({ ok: true });
  }

  // ── TOUCH ──────────────────────────────────────────────
  if (path === '/api/board/touch') {
    const data = await boardGet(db, keyHash);
    if (!data) return json({ found: false });
    await boardTouch(db, keyHash);
    return json({ ok: true });
  }

  // ── CRDT push ops ──────────────────────────────────────
  if (path === '/api/crdt/ops/push') {
    const { ops: incoming } = body;
    if (!Array.isArray(incoming)) return err('ops must be an array');
    if (!incoming.length)         return json({ ok: true, opsAccepted: 0 });

    for (const op of incoming) {
      if (!op.opId || !op.type || typeof op.ts !== 'number' || !op.payload)
        return err('each op needs opId, type, ts (number), payload');
    }

    // Fetch existing opIds for this board to deduplicate
    const { results: existing } = await db.prepare(
      'SELECT op_id FROM crdt_ops WHERE key_hash = ?'
    ).bind(keyHash).all();
    const existingIds = new Set(existing.map(r => r.op_id));

    const newOps = incoming.filter(o => !existingIds.has(o.opId));
    await opsInsert(db, keyHash, newOps);

    const totalOps    = (existing.length + newOps.length);
    const snapshotNow = totalOps > 0 && totalOps % SNAPSHOT_EVERY < newOps.length;
    let snapshotTaken = false;

    if (snapshotNow) {
      await doSnapshot(db, keyHash);
      snapshotTaken = true;
    }

    return json({ ok: true, opsAccepted: newOps.length, totalOps, snapshotTaken });
  }

  // ── CRDT pull ops since ────────────────────────────────
  if (path === '/api/crdt/ops/pull') {
    const since = typeof body.since === 'number' ? body.since : 0;
    const ops   = await opsGetSince(db, keyHash, since);
    return json({ ops });
  }

  // ── CRDT materialized state ────────────────────────────
  if (path === '/api/crdt/state/get') {
    const count = await opsCount(db, keyHash);
    if (!count) {
      const snapRow = await snapGet(db, keyHash);
      if (!snapRow) return json({ found: false });
      return json({ found: true, data: materialize(snapRow.mapState) });
    }
    const mapState = await buildState(db, keyHash);
    return json({ found: true, data: materialize(mapState) });
  }

  // ── CRDT force snapshot ────────────────────────────────
  if (path === '/api/crdt/state/snapshot') {
    const count = await opsCount(db, keyHash);
    if (!count) return json({ ok: true, opsKept: 0 });
    await doSnapshot(db, keyHash);
    const kept = await opsCount(db, keyHash);
    return json({ ok: true, opsKept: kept });
  }

  return err('Not found', 404);
}

// ── Scheduled cron — prune rows older than 90 days ───────────────────────────

async function handleScheduled(env) {
  const cutoff = Date.now() - TTL_MS;
  const db = env.flowboard_db;
  await Promise.all([
    db.prepare('DELETE FROM boards WHERE updated_at < ?').bind(cutoff).run(),
    db.prepare('DELETE FROM crdt_ops WHERE updated_at < ?').bind(cutoff).run(),
    db.prepare('DELETE FROM crdt_snapshots WHERE updated_at < ?').bind(cutoff).run(),
  ]);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
  },

  async scheduled(_event, env) {
    try {
      await handleScheduled(env);
    } catch (e) {
      console.error('Scheduled prune failed:', e);
    }
  },
};
