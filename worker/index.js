/**
 * FlowBoard Cloudflare Worker — D1 backend
 *
 * Replaces KV with D1 (SQLite). API surface identical to KV version.
 * TTL enforced by scheduled cron (0 3 * * *) pruning boards idle for 90 days.
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


// Shared conflict rules keep the server, local edits and remote reads convergent.
import { SYNC_PROTOCOL, applyOp, emptyState, generationOf, materialize, parseSnapshot, settle, validId, validOp } from '../src/services/crdt.ts';

// Replay ops in ts order onto a state (empty by default)
function replayOps(ops, state = emptyState()) {
  for (const op of [...ops].sort((a, b) => a.ts - b.ts || (a.opId > b.opId ? 1 : -1))) applyOp(state, op);
  return settle(state);
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
  // A JSON null row records activity for CRDT-only boards without inventing a legacy copy.
  await db.prepare(`INSERT INTO boards (key_hash, data, updated_at)
    SELECT ?, 'null', ? WHERE EXISTS (SELECT 1 FROM boards WHERE key_hash = ?)
      OR EXISTS (SELECT 1 FROM crdt_ops WHERE key_hash = ?)
      OR EXISTS (SELECT 1 FROM crdt_snapshots WHERE key_hash = ?)
    ON CONFLICT(key_hash) DO UPDATE SET updated_at = excluded.updated_at`
  ).bind(keyHash, now(), keyHash, keyHash, keyHash).run();
}

// ---- CRDT ops table ----

// A D1 batch is a transaction: GC cannot occur between these two reads.
async function readHistory(db, keyHash) {
  const [snap, log] = await db.batch([
    db.prepare('SELECT snap, snap_ts FROM crdt_snapshots WHERE key_hash = ?').bind(keyHash),
    db.prepare('SELECT rowid, op_id, type, ts, client_id, payload FROM crdt_ops WHERE key_hash = ? ORDER BY ts ASC').bind(keyHash),
  ]);
  return { snap: snap.results[0], maxRowId: log.results.reduce((max, r) => Math.max(max, r.rowid), 0), ops: log.results.map(r => ({
    opId: r.op_id, type: r.type, ts: r.ts, clientId: r.client_id, payload: JSON.parse(r.payload),
  })) };
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
const generationSql = `COALESCE((SELECT json_extract(j.value, '$.syncGeneration')
  FROM crdt_snapshots s, json_each(s.snap, '$.boards') j WHERE s.key_hash = ? AND j.key = ?), '')`;

async function opsInsert(db, keyHash, boardId, ops, generation) {
  const ts = now();
  // D1 batch: up to 100 statements per batch is fine for typical op counts
  const stmts = ops.map(op =>
    db.prepare(
      `INSERT OR IGNORE INTO crdt_ops (op_id, key_hash, type, ts, client_id, payload, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${generationSql} = ?`
    ).bind(op.opId, keyHash, op.type, op.ts, op.clientId ?? null, JSON.stringify(op.payload), ts, keyHash, boardId, generation)
  );
  // The generation check runs inside the insert transaction, not in a racy earlier read.
  stmts.push(db.prepare(`SELECT ${generationSql} AS generation`).bind(keyHash, boardId));
  const result = await db.batch(stmts);
  return result.at(-1).results[0].generation === generation;
}

// Current map-state (null if the board has no CRDT data): snapshot + replay every stored op.
// Not just ops newer than the snapshot — op ts is the client's clock, so ops made offline can arrive
// after a snapshot with an older ts. Re-applying ops already in the snapshot is a no-op under LWW.
async function buildState(db, keyHash) {
  const { snap, ops } = await readHistory(db, keyHash);
  if (!snap && !ops.length) return null;
  return replayOps(ops, snap ? JSON.parse(snap.snap) : undefined);
}

// Force snapshot + prune old ops (GC). The snapshot carries the pruned history forward.
async function doSnapshot(db, keyHash) {
  const { snap, ops } = await readHistory(db, keyHash);
  if (!snap && !ops.length) return;
  const state = replayOps(ops, snap ? JSON.parse(snap.snap) : undefined);
  const encoded = JSON.stringify(state);
  const ts = Math.max(now(), (snap?.snap_ts ?? 0) + 1);
  // CAS rejects a snapshot based on superseded history. Snapshot and GC commit together.
  const writes = [db.prepare(`INSERT INTO crdt_snapshots (key_hash, snap, snap_ts, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key_hash) DO UPDATE SET snap = excluded.snap, snap_ts = excluded.snap_ts, updated_at = excluded.updated_at
    WHERE crdt_snapshots.snap_ts = ? AND crdt_snapshots.snap = ?`
  ).bind(keyHash, encoded, ts, now(), snap?.snap_ts ?? null, snap?.snap ?? null)];
  const prune = ops.filter(o => o.ts < now() - GC_MAX_AGE_MS);
  // Delete only captured IDs, never a time range containing newly arrived offline work.
  for (let i = 0; i < prune.length; i += 50) {
    const ids = prune.slice(i, i + 50).map(o => o.opId);
    writes.push(db.prepare(`DELETE FROM crdt_ops WHERE key_hash = ? AND op_id IN (${ids.map(() => '?').join(',')})
      AND EXISTS (SELECT 1 FROM crdt_snapshots WHERE key_hash = ? AND snap_ts = ? AND snap = ?)`
    ).bind(keyHash, ...ids, keyHash, ts, encoded));
  }
  await db.batch(writes);
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
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1024 * 1024) return err('Request too large', 413);
  try { body = JSON.parse(text); } catch { return err('Invalid JSON body'); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return err('Invalid request body');
  const { boardId, keyHash } = body;
  if (!validId(boardId) || typeof keyHash !== 'string') return err('boardId and keyHash required');
  if (!/^[0-9a-f]{64}$/.test(keyHash)) return err('Invalid keyHash');

  // Old tabs must not overwrite a recovered board. Their durable outboxes remain
  // intact on this non-2xx response and can be reviewed after updating the app.
  if (['/api/crdt/ops/push', '/api/board/put', '/api/crdt/state/replace'].includes(path) && body.protocolVersion !== SYNC_PROTOCOL) {
    return err('Reload FlowBoard to update before syncing changes.', 409);
  }

  const db = env.flowboard_db;

  // Explicit overwrite: replace the live snapshot and operation history as one transaction.
  // No schema change is needed; the new generation lives in the board's snapshot record.
  if (path === '/api/crdt/state/replace') {
    if (!validId(body.resetId) || !Object.hasOwn(body, 'expected')) return err('Snapshot and expected cloud state required');
    let state;
    try { state = parseSnapshot(body.snapshot, boardId); }
    catch (error) { return err(error.message); }
    const { snap, ops, maxRowId } = await readHistory(db, keyHash);
    const current = !snap && !ops.length ? null : replayOps(ops, snap ? JSON.parse(snap.snap) : undefined);
    if (generationOf(current, boardId) === body.resetId) return json({ ok: true, state: current, protocolVersion: SYNC_PROTOCOL });
    if (JSON.stringify(current) !== JSON.stringify(body.expected)) return err('The cloud board changed. Export a fresh backup and retry the repair.', 409);
    const ts = Math.max(now(), (snap?.snap_ts ?? 0) + 1);
    // Overwrite is an explicit restore: its rows outrank deletions in their own activity.
    const stamp = Object.values(state.activity).reduce((max, e) => Math.max(max, e.ts + 1), now());
    let i = 0;
    for (const map of Object.values(state)) for (const row of Object.values(map)) {
      const opId = `${body.resetId}:${++i}`;
      Object.assign(row, { __ts: stamp, __opId: opId, __lifeTs: stamp, __lifeOpId: opId, __deleted: false });
    }
    Object.assign(state.boards[boardId], { syncProtocol: SYNC_PROTOCOL, syncGeneration: body.resetId });
    const encoded = JSON.stringify(state);
    const [written] = await db.batch([
      db.prepare(`INSERT INTO crdt_snapshots (key_hash, snap, snap_ts, updated_at)
        SELECT ?, ?, ?, ? WHERE (SELECT snap FROM crdt_snapshots WHERE key_hash = ?) IS ?
          AND (SELECT snap_ts FROM crdt_snapshots WHERE key_hash = ?) IS ?
          AND (SELECT COUNT(*) FROM crdt_ops WHERE key_hash = ?) = ?
          AND COALESCE((SELECT MAX(rowid) FROM crdt_ops WHERE key_hash = ?), 0) = ?
        ON CONFLICT(key_hash) DO UPDATE SET snap = excluded.snap, snap_ts = excluded.snap_ts, updated_at = excluded.updated_at`
      ).bind(keyHash, encoded, ts, now(), keyHash, snap?.snap ?? null, keyHash, snap?.snap_ts ?? null, keyHash, ops.length, keyHash, maxRowId),
      db.prepare(`DELETE FROM crdt_ops WHERE key_hash = ? AND EXISTS
        (SELECT 1 FROM crdt_snapshots WHERE key_hash = ? AND snap = ? AND snap_ts = ?)`)
        .bind(keyHash, keyHash, encoded, ts),
    ]);
    if (!written.meta.changes) return err('The cloud board changed during repair. Export a fresh backup and retry.', 409);
    await boardTouch(db, keyHash);
    return json({ ok: true, state, protocolVersion: SYNC_PROTOCOL });
  }

  // ── GET board ──────────────────────────────────────────
  // `data` is the legacy full-state row (possibly encrypted, and only as fresh as its last
  // full push) or, if there is none, the live CRDT state. `crdt` is always the live state,
  // for the client to apply on top of `data`.
  if (path === '/api/board/get') {
    await boardTouch(db, keyHash);
    const [legacy, mapState] = await Promise.all([boardGet(db, keyHash), buildState(db, keyHash)]);
    if (!legacy && !mapState) return json({ found: false, protocolVersion: SYNC_PROTOCOL });
    const crdt = mapState && materialize(mapState);
    // An explicit recovery chose the complete shared board. Do not seed unknown
    // records from an old full-state copy on the next join (they may be deleted).
    // Keep that legacy row in D1 for backup/recovery, but no longer apply it.
    const reconciled = !!mapState?.boards[boardId]?.syncProtocol;
    return json({ found: true, data: reconciled ? crdt : legacy ?? crdt, crdt, state: mapState, protocolVersion: SYNC_PROTOCOL });
  }

  // ── PUT board ──────────────────────────────────────────
  if (path === '/api/board/put') {
    const { data } = body;
    if (!data) return err('data required');
    const version = await db.prepare(`SELECT ${generationSql} AS generation`).bind(keyHash, boardId).first();
    if (version.generation) return err('Legacy writes are disabled after an overwrite repair. Reload FlowBoard.', 409);
    await boardPut(db, keyHash, data);
    return json({ ok: true });
  }

  // ── TOUCH ──────────────────────────────────────────────
  if (path === '/api/board/touch') {
    await boardTouch(db, keyHash);
    if (!await boardGet(db, keyHash) && !await buildState(db, keyHash)) return json({ found: false });
    return json({ ok: true });
  }

  // ── CRDT push ops ──────────────────────────────────────
  if (path === '/api/crdt/ops/push') {
    const { ops: incoming } = body;
    if (!Array.isArray(incoming) || incoming.length > 100) return err('ops must be an array of at most 100 operations');
    const generation = body.generation ?? '';
    if (generation !== '' && !validId(generation)) return err('Invalid sync generation');

    for (const op of incoming) {
      if (!validOp(op, boardId)) return err('Invalid or cross-board operation');
      if (op.type === 'board.update' && op.payload.syncGeneration !== undefined
        && (!validId(op.payload.syncGeneration) || op.payload.syncGeneration !== generation)) return err('Invalid board generation');
    }

    // Fetch existing opIds for this board to deduplicate
    const { results: existing } = await db.prepare(
      'SELECT op_id FROM crdt_ops WHERE key_hash = ?'
    ).bind(keyHash).all();
    const existingIds = new Set(existing.map(r => r.op_id));

    const newOps = [...new Map(incoming.map(o => [o.opId, o])).values()].filter(o => !existingIds.has(o.opId));
    if (!await opsInsert(db, keyHash, boardId, newOps, generation)) return err('This board was repaired. Reload FlowBoard and review recovery before uploading older changes.', 409);
    await boardTouch(db, keyHash);

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
    await boardTouch(db, keyHash);
    const since = typeof body.since === 'number' ? body.since : 0;
    const ops   = await opsGetSince(db, keyHash, since);
    return json({ ops });
  }

  // ── CRDT materialized state ────────────────────────────
  if (path === '/api/crdt/state/get') {
    await boardTouch(db, keyHash);
    const mapState = await buildState(db, keyHash);
    return json(mapState ? { found: true, data: materialize(mapState), state: mapState, protocolVersion: SYNC_PROTOCOL } : { found: false, protocolVersion: SYNC_PROTOCOL });
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
  // Expire CRDT boards whole, once idle for the TTL. Pruning individual old rows would
  // strip a live board of its oldest records (the board itself, its first cards).
  const live = 'SELECT key_hash FROM boards WHERE updated_at >= ? UNION SELECT key_hash FROM crdt_ops WHERE updated_at >= ? UNION SELECT key_hash FROM crdt_snapshots WHERE updated_at >= ?';
  await db.batch([
    db.prepare(`DELETE FROM crdt_ops WHERE key_hash NOT IN (${live})`).bind(cutoff, cutoff, cutoff),
    db.prepare(`DELETE FROM crdt_snapshots WHERE key_hash NOT IN (${live})`).bind(cutoff, cutoff, cutoff),
    db.prepare('DELETE FROM boards WHERE updated_at < ?').bind(cutoff),
  ]);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
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
