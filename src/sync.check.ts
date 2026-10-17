// Runs in real Chromium with IndexedDB against the SQLite-backed worker. See scripts/sync.check.mjs.
import { applyOp, emptyState, materialize, mergeStates, type CrdtState } from './services/crdt.ts';
import { DatabaseService } from './services/DatabaseService.ts';
import type { Card, CrdtOp } from './types';
import { CryptoService } from './services/CryptoService.ts';

const results: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const equal = (a: unknown, b: unknown, message: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const op = (type: string, ts: number, title = '', id = 'card'): CrdtOp => ({ boardId: 'board', opId: `op-${ts}-${type}`, clientId: 'remote', type, ts, payload: { id, boardId: 'board', title } });
const originalOpen = indexedDB.open.bind(indexedDB);
let client = 'unit';
indexedDB.open = (name, version) => originalOpen(`check-${client}-${name}`, version);

async function run() {
  // Delete/update order, same-clock ties, Undo and reload all use the same reducer as production.
  const state = emptyState();
  applyOp(state, op('card.create', 20, 'created'));
  applyOp(state, op('card.delete', 30));
  applyOp(state, op('card.update', 10, 'stale'));
  equal(materialize(state).cards.length, 0, 'stale update must not resurrect');
  applyOp(state, op('card.create', 40, 'Undo'));
  applyOp(state, op('card.delete', 35));
  equal(materialize(state).cards[0].title, 'Undo', 'stale delete must not win');
  const db = await new DatabaseService().open();
  await db.updateSyncState('board', emptyState(), local => { mergeStates(local, state); return []; });
  const reloaded = await new DatabaseService().open();
  const fromDisk = await reloaded.get<{ value: CrdtState }>('settings', 'crdtState:board');
  equal(fromDisk!.value.cards.card.__ts, 40, 'persist timestamp');
  applyOp(fromDisk!.value, op('card.delete', 39));
  equal(materialize(fromDisk!.value).cards[0].title, 'Undo', 'reload must retain conflict protection');
  await reloaded.updateSyncState('board', emptyState(), local => { applyOp(local, op('card.delete', 50)); return []; });
  const tombstone = await reloaded.get<{ value: CrdtState }>('settings', 'crdtState:board');
  assert(tombstone!.value.cards.card.__deleted, 'persist tombstones');
  equal(await reloaded.get('cards', 'card'), undefined, 'remove deleted card from live storage');
  results.push('Persistent timestamps, tombstones, stale updates/deletes and Undo');

  // IDB transactions serialize multiple open database connections and roll back on failure.
  await Promise.all([
    db.updateSyncState('board', emptyState(), local => { applyOp(local, op('card.create', 60, 'A', 'A')); return []; }),
    reloaded.updateSyncState('board', emptyState(), local => { applyOp(local, op('card.create', 61, 'B', 'B')); return []; }),
  ]);
  const both = await db.get<{ value: CrdtState }>('settings', 'crdtState:board');
  equal(materialize(both!.value).cards.map(c => c.id).sort(), ['A', 'B'], 'concurrent tabs must not overwrite each other');
  let failed = false;
  try { await db.updateSyncState('board', emptyState(), local => { applyOp(local, op('card.create', 70, 'not saved', 'failed')); throw new Error('disk failure'); }); }
  catch { failed = true; }
  assert(failed, 'surface write failure');
  equal(await db.get('cards', 'failed'), undefined, 'rollback failed write');
  let aborted = false;
  try {
    await db.updateSyncState('board', emptyState(), local => {
      const change = op('card.create', 71, 'must roll back', 'uncloneable');
      applyOp(local, change);
      return [{ ...change, payload: { invalid: () => {} } }];
    });
  } catch { aborted = true; }
  assert(aborted, 'unwritable outbox aborts the entire transaction');
  equal(await db.get('cards', 'uncloneable'), undefined, 'do not persist records without their pending operation');
  assert(!(await db.get<{ value: CrdtState }>('settings', 'crdtState:board'))!.value.cards.uncloneable, 'roll back conflict metadata too');
  results.push('Real IndexedDB concurrency and rollback');

  const pending = op('card.update', 100, 'unsent legacy edit', 'pending');
  await db.put('cards', { id: 'pending', boardId: 'board', title: 'unsent legacy edit' });
  await db.put('crdtOps', pending);
  const olderRemote = emptyState();
  applyOp(olderRemote, op('card.update', 99, 'older server value', 'pending'));
  await db.updateSyncState('board', emptyState(), local => { mergeStates(local, olderRemote); return []; });
  equal((await db.get<{ title: string }>('cards', 'pending'))!.title, 'unsent legacy edit', 'upgrade replays durable pending ops before remote state');
  results.push('Upgrade retains unversioned local records and the existing outbox');

  const load = async (name: string, storage: string) => {
    client = storage;
    localStorage.setItem('fbClientId', storage);
    const m = await import(/* @vite-ignore */ `/src/store/useFlowStore.ts?check=${name}`) as typeof import('./store/useFlowStore.ts');
    await m.useFlowStore.getState().init();
    m.useFlowStore.setState({ workerUrl: location.origin });
    m.sync.setWorkerUrl(location.origin);
    assert(!m.useFlowStore.getState().error, 'store initializes');
    return m;
  };
  const a = await load('a', 'a');
  const syncA = async () => { await a.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 }); a.sync.stopTimer(); };
  await a.useFlowStore.getState().createBoard('Shared board', 'test-password');
  const boardId = a.useFlowStore.getState().activeBoardId!;
  const columnId = a.useFlowStore.getState().columns[0].id;
  await a.useFlowStore.getState().createCard(boardId, columnId, { title: 'Initial' });
  const cardId = a.useFlowStore.getState().cards[0].id;
  assert((await a.db.getAll<CrdtOp>('crdtOps')).length > 0, 'local writes enqueue durable ops');
  await syncA();
  equal((await a.db.getAll('crdtOps')).length, 0, 'acknowledged pushes clear outbox');
  const b = await load('b', 'b');
  b.sync.setWorkerUrl(location.origin);
  const syncB = async () => { await b.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 }); b.sync.stopTimer(); };
  assert(await b.useFlowStore.getState().joinBoard(boardId, 'test-password'), 'second device joins');
  await syncB();
  equal(b.useFlowStore.getState().cards[0].title, 'Initial', 'join downloads initial cards');
  await b.useFlowStore.getState().updateCard(cardId, { title: 'Edited on B' });
  await syncB();
  await syncA();
  equal(a.useFlowStore.getState().cards[0].title, 'Edited on B', 'remote edit reaches A');
  results.push('Two isolated devices: create, join, edit, push and pull');

  const creds = (await a.sync.getBoardCreds(boardId))!;
  const call = async (path: string, body: object = {}) => {
    const r = await fetch(path, { method: 'POST', body: JSON.stringify({ boardId, keyHash: creds.keyHash, ...body }) });
    assert(r.ok, `worker request ${path}`);
    return r.json();
  };
  // An old cursor and operations created before the last poll must not hide newly-arriving work.
  await a.db.put('settings', { key: `crdtMeta:${boardId}`, value: { lastPulledTs: Date.now() + 1000000 } });
  const offline: Card = { ...a.useFlowStore.getState().cards[0], id: 'late-offline', title: 'Late offline card', createdAt: Date.now() - 60 * 864e5 };
  await call('/api/crdt/ops/push', { ops: [{ ...op('card.create', Date.now() - 60 * 864e5), boardId, opId: 'offline', payload: offline }] });
  await call('/api/crdt/state/snapshot');
  await syncA();
  assert(a.useFlowStore.getState().cards.some(c => c.id === offline.id), 'recover an offline op after it has been pruned');
  results.push('Late offline arrivals and snapshot recovery ignore old timestamp cursors');

  await a.useFlowStore.getState().deleteCard(cardId);
  await syncA();
  await syncB();
  assert(!b.useFlowStore.getState().cards.some(c => c.id === cardId), 'deletion reaches B');
  const deletion = (await a.db.get<{ value: CrdtState }>('settings', `crdtState:${boardId}`))!.value.cards[cardId].__ts!;
  await call('/api/crdt/ops/push', { ops: [{ ...op('card.update', deletion - 1), boardId, payload: { ...offline, id: cardId, title: 'stale resurrection' } }] });
  await syncB();
  assert(!b.useFlowStore.getState().cards.some(c => c.id === cardId), 'stale update must not resurrect on B');
  await a.useFlowStore.getState().toasts.find(t => t.action)?.action!.run();
  await syncA(); await syncB();
  assert(b.useFlowStore.getState().cards.some(c => c.id === cardId), 'Undo reaches B');

  const reloadB = await load('reload-b', 'b');
  await reloadB.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  reloadB.sync.stopTimer();
  assert(reloadB.useFlowStore.getState().cards.some(c => c.id === cardId), 'joined board survives reload');
  assert(!await reloadB.useFlowStore.getState().joinBoard(boardId, 'wrong-password'), 'wrong password fails');
  equal((await reloadB.sync.getBoardCreds(boardId))!.keyHash, creds.keyHash, 'failed join must not replace good credentials');
  results.push('Deletion, stale-operation rejection, Undo, reload and failed-join safety');

  // A write made while offline must survive a failed push and a remote read with an older version.
  await reloadB.useFlowStore.getState().updateCard(cardId, { title: 'Offline edit' });
  reloadB.sync.setWorkerUrl(`${location.origin}/unreachable`);
  equal(await reloadB.sync.pushCrdtOps(boardId), false, 'failed push reported');
  assert((await reloadB.db.getAll<CrdtOp>('crdtOps')).length > 0, 'failed push retains outbox');
  await reloadB.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  reloadB.sync.stopTimer();
  await syncA();
  equal(a.useFlowStore.getState().cards.find(c => c.id === cardId)!.title, 'Offline edit', 'retry sends preserved local edit');
  results.push('Offline outbox retry and local-edit protection');

  // Large queues are chunked. If batch 2 fails, only acknowledged batch 1 is removed.
  const bulk = Array.from({ length: 205 }, (_, i) => ({ ...op('card.create', Date.now() + i, '', `bulk-${i}`), boardId,
    opId: `bulk-op-${i}`, payload: { ...offline, boardId, id: `bulk-${i}`, title: `Bulk ${i}` } }));
  await reloadB.db.updateSyncState(boardId, emptyState(), local => { for (const item of bulk) applyOp(local, item); return bulk; });
  const originalFetch = window.fetch;
  let batches = 0;
  window.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/crdt/ops/push') && ++batches === 2) return new Response('unavailable', { status: 503 });
    return originalFetch(...args);
  };
  try { equal(await reloadB.sync.pushCrdtOps(boardId), false, 'partial push fails'); }
  finally { window.fetch = originalFetch; }
  equal((await reloadB.db.getAll<CrdtOp>('crdtOps')).length, 105, 'keep only unacknowledged batches');
  assert(await reloadB.sync.pushCrdtOps(boardId), 'retry partial push');
  equal((await reloadB.db.getAll<CrdtOp>('crdtOps')).length, 0, 'retry drains outbox');
  await syncA();
  equal(a.useFlowStore.getState().cards.filter(c => c.id.startsWith('bulk-')).length, 205, 'all bulk cards arrive');
  results.push('205-operation queue, automatic snapshot and partial-batch retry');

  // Encrypted legacy-only boards migrate without discarding their records or refreshing stale clocks.
  const legacyId = 'legacy-board', password = 'legacy-password';
  const legacyKey = await CryptoService.hashKey(legacyId, password);
  const legacyCard = { ...offline, id: 'legacy-card', boardId: legacyId };
  const legacy = { boards: [{ id: legacyId, name: 'Legacy', createdAt: 1 }], columns: [], cards: [legacyCard], activity: [] };
  const encrypted = await CryptoService.encrypt(legacyId, password, legacy);
  assert((await fetch('/api/board/put', { method: 'POST', body: JSON.stringify({ boardId: legacyId, keyHash: legacyKey, data: encrypted }) })).ok, 'store encrypted legacy data');
  assert(await reloadB.useFlowStore.getState().joinBoard(legacyId, password), 'join encrypted legacy board');
  await reloadB.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  reloadB.sync.stopTimer();
  const migrated = await (await fetch('/api/crdt/state/get', { method: 'POST', body: JSON.stringify({ boardId: legacyId, keyHash: legacyKey }) })).json();
  equal(migrated.data.cards[0].id, 'legacy-card', 'legacy baseline is seeded into server state');
  equal(migrated.state.cards['legacy-card'].__ts, 0, 'migration does not give stale legacy data a fresh clock');
  results.push('Encrypted legacy board join and migration');
  await reloadB.useFlowStore.getState().createCard(boardId, columnId, { title: 'Automatically synced' });
  let autoSynced = false;
  for (let attempt = 0; attempt < 50 && !autoSynced; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    autoSynced = (await call('/api/crdt/state/get')).data.cards.some((c: Card) => c.title === 'Automatically synced');
  }
  assert(autoSynced, 'local edits trigger a debounced sync without reload or settings interaction');
  results.push('Automatic debounced sync after local edits');
  a.sync.stopTimer(); b.sync.stopTimer(); reloadB.sync.stopTimer();
}

run().then(() => fetch('/sync-result', { method: 'POST', body: JSON.stringify({ ok: true, results }) }))
  .catch(error => fetch('/sync-result', { method: 'POST', body: JSON.stringify({ ok: false, error: error.stack }) }));
