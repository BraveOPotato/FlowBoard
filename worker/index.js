/**
 * FlowBoard Cloudflare Worker
 *
 * KV key scheme:  SHA-256(boardId + ":" + password)  →  JSON board data
 * TTL: 90 days (7,776,000 seconds) — resets on every read or write
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
 * CRDT KV key scheme:
 *   ops:{keyHash}       → JSON array of all operations, sorted by ts ascending
 *   snap:{keyHash}      → materialized board state (boards/columns/cards/activity)
 *   snapts:{keyHash}    → timestamp of last snapshot (used for GC)
 *
 * Each operation: { opId, type, ts, clientId, boardId, payload }
 * Op types: card.create | card.update | card.move | card.delete |
 *            column.create | column.update | column.delete | board.update |
 *            activity.create
 *
 * Conflict resolution: last-write-wins per entity field, using op.ts.
 * Op log is append-only. GC: ops older than 30 days are pruned on snapshot.
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


// ── CRDT: apply an op to a mutable state object ──────────────────────────────
// State shape: { boards: {id→obj}, columns: {id→obj}, cards: {id→obj}, activity: {id→obj} }
// LWW: only overwrite a field if incoming op.ts >= field's recorded ts.

function applyOp(state, op) {
  const { type, ts, payload } = op;

  // Helper: LWW merge — per-field ts stored in __ts sub-object
  function lwwMerge(existing, incoming, opTs) {
    if (!existing) return { ...incoming, __ts: opTs };
    const merged = { ...existing };
    const fieldTs = existing.__ts || 0;
    // For simplicity, use single entity-level ts (sufficient for kanban use case)
    if (opTs >= fieldTs) {
      Object.assign(merged, incoming, { __ts: opTs });
    }
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
      if (state.columns[id]) state.columns[id] = { ...state.columns[id], __deleted: true, __ts: ts };
      else state.columns[id] = { id, __deleted: true, __ts: ts };
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
      if (state.cards[id]) state.cards[id] = { ...state.cards[id], __deleted: true, __ts: ts };
      else state.cards[id] = { id, __deleted: true, __ts: ts };
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
    default:
      break;
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

// ── CRDT KV helpers ───────────────────────────────────────────────────────────

const CRDT_TTL = TTL_SECONDS;
const GC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // prune ops older than 30 days on snapshot
const SNAPSHOT_INTERVAL_OPS = 200; // auto-snapshot every N ops to keep KV values small

async function crdtGetOps(env, keyHash) {
  const raw = await env.BOARDS.get(`ops:${keyHash}`);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function crdtPutOps(env, keyHash, ops) {
  await env.BOARDS.put(`ops:${keyHash}`, JSON.stringify(ops), { expirationTtl: CRDT_TTL });
}

async function crdtGetSnap(env, keyHash) {
  const raw = await env.BOARDS.get(`snap:${keyHash}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function crdtPutSnap(env, keyHash, mapState, snapTs) {
  await env.BOARDS.put(`snap:${keyHash}`, JSON.stringify(mapState), { expirationTtl: CRDT_TTL });
  await env.BOARDS.put(`snapts:${keyHash}`, String(snapTs), { expirationTtl: CRDT_TTL });
}

async function crdtGetSnapTs(env, keyHash) {
  const raw = await env.BOARDS.get(`snapts:${keyHash}`);
  return raw ? parseInt(raw, 10) : 0;
}

// Build full map-state: start from snapshot, replay any ops after it
async function crdtBuildState(env, keyHash) {
  const [snap, ops, snapTs] = await Promise.all([
    crdtGetSnap(env, keyHash),
    crdtGetOps(env, keyHash),
    crdtGetSnapTs(env, keyHash),
  ]);

  let mapState = snap || { boards: {}, columns: {}, cards: {}, activity: {} };

  // Only replay ops newer than the snapshot
  const newOps = ops.filter(o => o.ts > snapTs || !snap);
  const sorted = newOps.sort((a, b) => a.ts - b.ts || a.opId.localeCompare(b.opId));
  for (const op of sorted) applyOp(mapState, op);

  return { mapState, ops, snapTs };
}

// Force a snapshot: replay all ops, persist map-state, prune old ops
async function crdtSnapshot(env, keyHash) {
  const ops = await crdtGetOps(env, keyHash);
  const mapState = replayOps(ops);
  const nowTs = Date.now();

  // Prune ops older than GC_MAX_AGE_MS
  const keptOps = ops.filter(o => nowTs - o.ts < GC_MAX_AGE_MS);

  await crdtPutSnap(env, keyHash, mapState, nowTs);
  await crdtPutOps(env, keyHash, keptOps);
  return mapState;
}

export default {
  async fetch(request, env) {
    try {
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

      // ── CRDT: Push ops ────────────────────────────────────
      // Body: { boardId, keyHash, ops: [{ opId, type, ts, clientId, payload }, ...] }
      // Returns: { ok, opsAccepted, totalOps, snapshotTaken }
      if (path === '/api/crdt/ops/push') {
        const { ops: incoming } = body;
        if (!Array.isArray(incoming)) return err('ops must be an array');
        if (incoming.length === 0) return json({ ok: true, opsAccepted: 0 });

        // Validate each op has required fields
        for (const op of incoming) {
          if (!op.opId || !op.type || !op.ts || !op.payload) {
            return err('each op needs opId, type, ts, payload');
          }
          // Ensure ts is a number
          if (typeof op.ts !== 'number') return err('op.ts must be a number');
        }

        // Load existing ops
        const existingOps = await crdtGetOps(env, kvKey);
        const existingIds = new Set(existingOps.map(o => o.opId));

        // Deduplicate — idempotent: same opId already present = skip
        const newOps = incoming.filter(o => !existingIds.has(o.opId));

        const merged = [...existingOps, ...newOps].sort((a, b) => a.ts - b.ts);
        await crdtPutOps(env, kvKey, merged);

        // Auto-snapshot to keep KV sizes manageable
        let snapshotTaken = false;
        if (merged.length % SNAPSHOT_INTERVAL_OPS < newOps.length) {
          await crdtSnapshot(env, kvKey);
          snapshotTaken = true;
        } else {
          // Touch TTL on snapshot too
          const snap = await crdtGetSnap(env, kvKey);
          if (snap) {
            const snapTs = await crdtGetSnapTs(env, kvKey);
            await crdtPutSnap(env, kvKey, snap, snapTs);
          }
        }

        return json({ ok: true, opsAccepted: newOps.length, totalOps: merged.length, snapshotTaken });
      }

      // ── CRDT: Pull ops since timestamp ────────────────────
      // Body: { boardId, keyHash, since: <ts ms> }
      // Returns: { ops: [...] } — only ops with ts > since, sorted ascending
      if (path === '/api/crdt/ops/pull') {
        const since = typeof body.since === 'number' ? body.since : 0;

        const ops = await crdtGetOps(env, kvKey);
        if (!ops.length) return json({ ops: [] });

        // Touch TTL
        await crdtPutOps(env, kvKey, ops);

        const filtered = ops
          .filter(o => o.ts > since)
          .sort((a, b) => a.ts - b.ts);

        return json({ ops: filtered });
      }

      // ── CRDT: Get materialized state ──────────────────────
      // Body: { boardId, keyHash }
      // Returns: { found, data: { boards, columns, cards, activity } }
      // Use this on first join / full re-sync instead of replaying ops from zero.
      if (path === '/api/crdt/state/get') {
        const ops = await crdtGetOps(env, kvKey);
        if (!ops.length) {
          const snap = await crdtGetSnap(env, kvKey);
          if (!snap) return json({ found: false });
          return json({ found: true, data: materialize(snap) });
        }

        const { mapState } = await crdtBuildState(env, kvKey);
        const data = materialize(mapState);
        return json({ found: true, data });
      }

      // ── CRDT: Force snapshot (maintenance / GC) ───────────
      // Body: { boardId, keyHash }
      // Returns: { ok, opsKept }
      if (path === '/api/crdt/state/snapshot') {
        const ops = await crdtGetOps(env, kvKey);
        if (!ops.length) return json({ ok: true, opsKept: 0 });

        await crdtSnapshot(env, kvKey);
        const keptOps = await crdtGetOps(env, kvKey);
        return json({ ok: true, opsKept: keptOps.length });
      }

      return err('Not found', 404);
    } catch (e) {
      console.log(e);
      return new Response(
        JSON.stringify({
          error: e.message,
          stack: e.stack,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...CORS,
          },
        }
      );
    }
  },
};
