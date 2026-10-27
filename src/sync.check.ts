// Runs in real Chromium with IndexedDB against the SQLite-backed worker. See scripts/sync.check.mjs.
import { SYNC_PROTOCOL, applyOp, emptyState, materialize, mergeStates, type CrdtState } from './services/crdt.ts';
import { DatabaseService } from './services/DatabaseService.ts';
import type { Card, CrdtOp } from './types';
import { CryptoService } from './services/CryptoService.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SettingsModal } from './modals/SettingsModal.tsx';
import { useFlowStore as settingsStore, db as settingsDb, sync as settingsSync } from './store/useFlowStore.ts';
import { BoardView } from './views/BoardView.tsx';
import { DEFAULT_FILTERS, planMove } from './utils.ts';
import { App } from './App.tsx';
import { boardIdFromPath, boardPath, setBoardUrl } from './boardRouting.ts';

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
  applyOp(state, op('card.move', 60, 'newer stale move'));
  equal(materialize(state).cards.length, 1, 'Undo remains restored after a later edit');
  applyOp(state, op('card.delete', 70));
  applyOp(state, op('card.move', 80, 'newer edit from a device that missed the delete'));
  equal(materialize(state).cards.length, 0, 'deletes are authoritative over newer edits');
  // A card resurrected by an older version heals locally from its logged deletion.
  await reloaded.updateSyncState('healed', emptyState(), local => {
    local.cards.zombie = { id: 'zombie', boardId: 'healed', title: 'Resurrected', __ts: 30, __opId: 'stale-move' };
    local.activity.gone = { id: 'gone', boardId: 'healed', cardId: 'zombie', type: 'deleted', ts: 20, __ts: 20, __opId: 'gone' };
    return [];
  });
  equal(await reloaded.get('cards', 'zombie'), undefined, 'logged deletion removes a resurrected card from live storage');
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
  equal(location.pathname, boardPath(boardId), 'creating a board navigates to its URL');
  equal((await a.sync.getBoardCreds(boardId))!.password, 'test-password', 'creating a board saves its password locally');
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
  equal(location.pathname, boardPath(boardId), 'joining a board navigates to its URL');
  equal((await b.sync.getBoardCreds(boardId))!.password, 'test-password', 'joining a board saves its password locally');
  await syncB();
  equal(b.useFlowStore.getState().cards[0].title, 'Initial', 'join downloads initial cards');
  await b.useFlowStore.getState().updateCard(cardId, { title: 'Edited on B' });
  await syncB();
  await syncA();
  equal(a.useFlowStore.getState().cards[0].title, 'Edited on B', 'remote edit reaches A');
  results.push('Two isolated devices: create, join, edit, push and pull');

  const creds = (await a.sync.getBoardCreds(boardId))!;
  const call = async (path: string, body: object = {}) => {
    const r = await fetch(path, { method: 'POST', body: JSON.stringify({ boardId, keyHash: creds.keyHash, protocolVersion: SYNC_PROTOCOL, ...body }) });
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

  const pick = (st: ReturnType<typeof a.useFlowStore.getState>) => ({ boards: st.boards.filter(x => x.id === boardId),
    columns: st.columns.filter(c => c.boardId === boardId), cards: st.cards.filter(c => c.boardId === boardId), activity: [] });
  const exportBeforeDelete = JSON.stringify(pick(a.useFlowStore.getState()));
  await a.useFlowStore.getState().deleteCard(cardId);
  await syncA();
  await syncB();
  assert(!b.useFlowStore.getState().cards.some(c => c.id === cardId), 'deletion reaches B');
  await call('/api/crdt/ops/push', { ops: [{ ...op('card.move', Date.now() + 60000), boardId, payload: { ...offline, id: cardId, title: 'newer stale move' } }] });
  await syncB();
  assert(!b.useFlowStore.getState().cards.some(c => c.id === cardId), 'a newer move from a stale device must not resurrect on B');
  await a.useFlowStore.getState().importData(exportBeforeDelete);
  a.sync.stopTimer();
  assert(!a.useFlowStore.getState().cards.some(c => c.id === cardId), 'merging an older export must not restore a deleted card');
  await syncA();
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

  const boardBeforeFailedJoin = JSON.stringify(reloadB.useFlowStore.getState().cards);
  const joinFetch = window.fetch;
  for (const [reply, expected] of [
    [() => new Response(JSON.stringify({ found: true, data: {} })), 'Deploy the updated sync worker'],
    [() => new Response(JSON.stringify({ found: false })), 'Deploy the updated sync worker'],
    [() => new Response('unavailable', { status: 503 }), 'HTTP 503'],
    [() => new Response('<html>frontend, not worker</html>'), 'sync worker, not the frontend'],
    [() => { throw new TypeError('Failed to fetch'); }, 'Unable to reach the cloud worker'],
  ] as const) {
    window.fetch = async (...args) => String(args[0]).endsWith('/api/board/get') ? reply() : joinFetch(...args);
    let message = '';
    try { await reloadB.useFlowStore.getState().joinBoard(boardId, 'test-password'); }
    catch (error) { message = (error as Error).message; }
    finally { window.fetch = joinFetch; }
    assert(message.includes(expected), `join reports the actual failure: ${expected}, got ${message}`);
    equal(JSON.stringify(reloadB.useFlowStore.getState().cards), boardBeforeFailedJoin, 'failed join must not change existing cards');
    equal((await reloadB.sync.getBoardCreds(boardId))!.keyHash, creds.keyHash, 'failed join must not change existing credentials');
  }
  results.push('Join distinguishes worker upgrades, server/network errors and wrong endpoints from missing boards');

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
  assert((await fetch('/api/board/put', { method: 'POST', body: JSON.stringify({ boardId: legacyId, keyHash: legacyKey, data: encrypted, protocolVersion: SYNC_PROTOCOL }) })).ok, 'store encrypted legacy data');
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

  // Old pause flags are inert. Upgrade and sync an actual unversioned IndexedDB copy.
  await a.useFlowStore.getState().createBoard('Upgrade board', 'upgrade-password');
  const upgradeId = a.useFlowStore.getState().activeBoardId!;
  const upgradeBoard = a.useFlowStore.getState().boards.find(b => b.id === upgradeId)!;
  const upgradeColumns = a.useFlowStore.getState().columns.filter(c => c.boardId === upgradeId);
  await a.useFlowStore.getState().createCard(upgradeId, upgradeColumns[0].id, { title: 'Deleted then moved by an old client' });
  await a.useFlowStore.getState().createCard(upgradeId, upgradeColumns[0].id, { title: 'Cloud-only card' });
  await syncA();
  const removed = a.useFlowStore.getState().cards.find(c => c.boardId === upgradeId)!;
  const upgradeKey = (await a.sync.getBoardCreds(upgradeId))!.keyHash;
  client = 'old-upgrade';
  const oldDb = await new DatabaseService().open();
  await oldDb.put('boards', upgradeBoard);
  await oldDb.batchPut('columns', upgradeColumns);
  await oldDb.put('cards', { ...removed, columnId: upgradeColumns[2].id });
  const upgradeState = (await a.db.get<{ value: CrdtState }>('settings', `crdtState:${upgradeId}`))!.value;
  const deletedAt = Math.max(Date.now(), upgradeState.cards[removed.id].__ts!) + 10000;
  await oldDb.put('activity', { id: 'old-delete', boardId: upgradeId, cardId: removed.id, type: 'deleted', ts: deletedAt });
  const queued = { ...removed, id: 'pending-upgrade-card', title: 'Pending old-client draft' };
  const unversioned = { ...queued, id: 'unversioned-local-card', title: 'Unversioned local-only card' };
  await oldDb.batchPut('cards', [queued, unversioned]);
  await oldDb.batchPut('crdtOps', [
    { ...op('card.create', deletedAt + 1), boardId: upgradeId, opId: 'old-queued-create', payload: queued },
    { ...op('card.move', deletedAt + 2), boardId: upgradeId, opId: 'old-queued-move', payload: removed },
  ]);
  await oldDb.put('boardCreds', { boardId: upgradeId, keyHash: upgradeKey, name: upgradeBoard.name, lastSynced: null });
  await oldDb.put('settings', { key: 'workerUrl', value: location.origin });
  const oldBackup = { local: emptyState(), pending: ['do not delete this backup'] };
  await oldDb.put('settings', { key: `syncRecovery:${upgradeId}`, value: { ...oldBackup, resolved: false } });
  await oldDb.put('settings', { key: `syncRepairBackup:${upgradeId}:old`, value: oldBackup });
  const upgraded = await load('upgraded', 'old-upgrade');
  await upgraded.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  upgraded.sync.stopTimer();
  assert(!upgraded.useFlowStore.getState().cards.some(c => c.id === removed.id), 'upgrade automatically removes the resurrected card');
  assert(upgraded.useFlowStore.getState().cards.some(c => c.title === 'Cloud-only card'), 'normal merging retains cloud-only cards');
  equal((await upgraded.db.getAll('crdtOps')).length, 0, 'old pause flags no longer block pending uploads');
  const upgradedCloud = await (await fetch('/api/crdt/state/get', { method: 'POST', body: JSON.stringify({ boardId: upgradeId, keyHash: upgradeKey }) })).json();
  assert(upgradedCloud.state.cards[removed.id].__deleted, 'legacy activity deletion reaches the cloud despite a newer queued move');
  assert(upgradedCloud.data.cards.some((c: Card) => c.id === queued.id), 'pending old-client draft reaches the cloud');
  equal(upgradedCloud.state.cards[unversioned.id].__ts, 0, 'unversioned local records migrate without a fresh clock');
  equal((await oldDb.get<{ value: unknown }>('settings', `syncRepairBackup:${upgradeId}:old`))!.value, oldBackup, 'existing backups are not discarded');
  assert(await upgraded.useFlowStore.getState().joinBoard(upgradeId, 'upgrade-password'), 'an old pause flag does not block rejoining');
  upgraded.sync.stopTimer();
  const fresh = await load('upgrade-joiner', 'upgrade-joiner');
  assert(await fresh.useFlowStore.getState().joinBoard(upgradeId, 'upgrade-password'), 'a new device joins the upgraded board');
  fresh.sync.stopTimer();
  assert(!fresh.useFlowStore.getState().cards.some(c => c.id === removed.id), 'new joins cannot bring back the deleted card');
  for (const field of ['beginSyncRepair', 'overwriteImport', 'resolveSyncRecovery', 'exportSyncRecovery', 'syncRecoveryBoardIds']) {
    assert(!(field in upgraded.useFlowStore.getState()), `${field} is removed, not just hidden`);
  }
  results.push('Legacy upgrade resumes sync without repair: pending drafts, automatic deletion handling, zero-clock migration and preserved backups');

  await reloadB.useFlowStore.getState().updateCard(cardId, { title: 'Waiting for worker upgrade' });
  reloadB.sync.stopTimer();
  const queuedCount = (await reloadB.db.getAll('crdtOps')).length;
  const realFetch = window.fetch;
  let unsafePushes = 0;
  window.fetch = async (...args) => {
    if (String(args[0]).endsWith('/api/crdt/state/get')) return new Response(JSON.stringify({ found: false }));
    if (String(args[0]).endsWith('/api/crdt/ops/push')) unsafePushes++;
    return realFetch(...args);
  };
  try { await reloadB.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 }); }
  finally { window.fetch = realFetch; reloadB.sync.stopTimer(); }
  equal(unsafePushes, 0, 'incompatible worker blocks pushes even for already-versioned boards');
  equal((await reloadB.db.getAll('crdtOps')).length, queuedCount, 'keep local edits until worker is upgraded');
  results.push('Worker-version handshake blocks unsafe uploads without discarding the outbox');

  // Histories reset by older releases remain fenced, without any replacement actions.
  const oldHistory = emptyState();
  oldHistory.boards.history = { id: 'history', __ts: 1, __opId: 'old-board' };
  const draft = { ...op('card.create', 2, 'Keep local draft', 'history-draft'), boardId: 'history', payload: { id: 'history-draft', boardId: 'history' } };
  await db.updateSyncState('history', oldHistory, local => { applyOp(local, draft); return [draft]; });
  const newHistory = emptyState();
  newHistory.boards.history = { id: 'history', syncGeneration: 'existing-reset', __ts: 3, __opId: 'new-board' };
  let mismatched = false;
  try { await db.updateSyncState('history', emptyState(), local => { mergeStates(local, newHistory); return []; }, newHistory); }
  catch { mismatched = true; }
  assert(mismatched, 'a changed history cannot silently merge or relabel old pending creates');
  equal((await db.getSyncOutbox('history')).ops.map(o => o.opId), [draft.opId], 'mismatched history preserves pending work');
  assert(await db.get('cards', 'history-draft'), 'mismatched history keeps the local draft');
  client = 'compatible-history';
  const compatibleDb = await new DatabaseService().open();
  await compatibleDb.updateSyncState('history', emptyState(), local => { mergeStates(local, newHistory); return []; }, newHistory);
  const sameHistory = await compatibleDb.updateSyncState('history', emptyState(), local => { applyOp(local, draft); return [draft]; }, newHistory);
  equal(sameHistory.boards.history.syncGeneration, 'existing-reset', 'new joins and matching histories retain existing identifiers');
  assert(await compatibleDb.get('cards', 'history-draft'), 'matching histories still allow ordinary edits');
  results.push('Existing cloud history identifiers still fence incompatible local copies without discarding drafts');

  // Exercise the actual join screen: rejected joins must show the real error,
  // keep the dialog open, and clear the busy state so retry is possible.
  const originalJoin = settingsStore.getState().joinBoard;
  let joinAttempts = 0;
  settingsStore.setState({ joinBoard: async () => {
    if (++joinAttempts === 1) throw new Error('Deploy the updated sync worker against the existing D1 database.');
    return false;
  } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(createElement(SettingsModal, { inviteId: 'existing-board' })));
    assert(!container.querySelector('[role="tablist"]'), 'invite join stays focused without settings tabs');
    assert(!container.querySelector('#worker-url'), 'invite join does not expose unrelated settings');
    const password = container.querySelector<HTMLInputElement>('#join-pw')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'test-password');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const joinButton = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Join board')!;
    joinButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(container.querySelector('[role="alert"]')?.textContent?.includes('Deploy the updated sync worker'), 'join screen displays actionable worker error');
    assert(!joinButton.disabled && joinButton.textContent?.includes('Join board'), 'join screen resets busy state after rejection');
    joinButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(container.querySelector('[role="alert"]')?.textContent?.includes('No board matches'), 'only a genuine not-found result shows ID/password guidance');
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    settingsStore.setState({ joinBoard: originalJoin });
  }
  results.push('Settings join UI keeps actionable errors visible and allows retry');

  const beforeSettingsUi = settingsStore.getState();
  let savedSettings: { workerUrl: string; syncInterval: number } | undefined;
  settingsStore.setState({ boards: [upgradeBoard], activeBoardId: upgradeId,
    saveSettings: async value => { savedSettings = value; } });
  const settingsHost = document.createElement('div');
  document.body.append(settingsHost);
  const settingsRoot = createRoot(settingsHost);
  try {
    flushSync(() => settingsRoot.render(createElement(SettingsModal)));
    const tabs = [...settingsHost.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    equal(tabs.map(t => t.textContent), ['General', 'Boards', 'Backup'], 'only the three supported settings tabs remain');
    const tab = (name: string) => tabs.find(t => t.textContent === name)!;
    const panel = (name: string) => document.getElementById(tab(name).getAttribute('aria-controls')!)!;
    const selectTab = (name: string) => flushSync(() => tab(name).click());
    assert(tab('General').getAttribute('aria-selected') === 'true' && !panel('General').hidden, 'normal settings start on General');
    assert(panel('Backup').hidden && panel('Boards').hidden, 'inactive tab panels are hidden');
    equal(tabs.filter(t => t.tabIndex === 0).length, 1, 'only the active tab is in the tab order');
    for (const button of tabs) equal(panel(button.textContent!).getAttribute('aria-labelledby'), button.id, 'each panel labels itself with its tab');
    const workerField = settingsHost.querySelector<HTMLInputElement>('#worker-url')!;
    const joinField = settingsHost.querySelector<HTMLInputElement>('#join-id')!;
    const joinPassword = settingsHost.querySelector<HTMLInputElement>('#join-pw')!;
    assert(panel('General').contains(workerField) && panel('Boards').contains(joinField) && !panel('General').contains(joinField), 'sync settings stay in General; joining moves to Boards');
    flushSync(() => {
      for (const [field, value] of [[workerField, ' https://worker.example.test '], [joinField, 'draft-board-id'], [joinPassword, 'draft-test-password']] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const interval = settingsHost.querySelector<HTMLSelectElement>('#sync-interval')!;
      interval.value = '60';
      interval.dispatchEvent(new Event('change', { bubbles: true }));
    });
    selectTab('Backup');
    assert(!panel('Backup').hidden && panel('General').hidden, 'Backup shows only backup tools');
    assert(panel('Backup').textContent?.includes('Export JSON') && panel('Backup').textContent?.includes('Import JSON'), 'backup actions are available');
    assert(![...settingsHost.querySelectorAll('button')].some(b => b.textContent === 'Save settings'), 'Save settings belongs to General');
    for (const [key, expected] of [['Home', 'General'], ['ArrowLeft', 'Backup'], ['ArrowRight', 'General'], ['End', 'Backup'], ['ArrowLeft', 'Boards']]) {
      const current = tabs.find(t => t.getAttribute('aria-selected') === 'true')!;
      flushSync(() => current.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
      assert(tab(expected).getAttribute('aria-selected') === 'true' && document.activeElement === tab(expected), `${key} selects and focuses the correct tab`);
    }
    selectTab('General');
    equal(workerField.value, ' https://worker.example.test ', 'tab switches preserve unsaved worker URL');
    equal(joinField.value, 'draft-board-id', 'tab switches preserve the join draft');
    equal(joinPassword.value, 'draft-test-password', 'tab switches preserve the join password');
    [...settingsHost.querySelectorAll('button')].find(b => b.textContent === 'Save settings')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(savedSettings, { workerUrl: 'https://worker.example.test', syncInterval: 60 }, 'General saves its preserved form values');
    assert(!/Repair this board|Sync recovery|Use this device|Use cloud|Overwrite import/.test(settingsHost.textContent ?? ''), 'repair controls are removed from every panel');
    equal(settingsHost.querySelectorAll('input[type="file"]').length, 1, 'only the additive import picker remains');
  } finally {
    flushSync(() => settingsRoot.unmount());
    settingsHost.remove();
    settingsStore.setState(beforeSettingsUi, true);
  }
  results.push('Settings without repair: three tabs, keyboard navigation, labelled panels, preserved drafts, General save and normal backups');

  // Keep the real board at the drop position while a local write is deliberately held open.
  const savedUiState = settingsStore.getState();
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  for (const scenario of ['reorder', 'keyboard', 'cross-column', 'failure', 'cancel', 'noop']) {
    const host = document.createElement('div');
    host.style.cssText = 'width:1100px;height:600px;--col-w:280px';
    document.body.append(host);
    const boardRoot = createRoot(host);
    const initialCards = ['first', 'second', 'third'].map((id, order) => ({ ...offline, id, title: id, boardId: 'drag-board', columnId: order === 2 ? 'done' : 'todo', order }));
    let finishMove: ((error?: Error) => void) | undefined;
    let moveCalls = 0;
    settingsStore.setState({
      activeBoardId: 'drag-board', searchQuery: '', filters: DEFAULT_FILTERS, backlogOpen: false, toasts: [],
      columns: ['todo', 'done'].map((id, order) => ({ id, boardId: 'drag-board', name: id, color: '#888888', order })),
      cards: initialCards,
      moveCard: async (id, column, index) => {
        moveCalls++;
        await new Promise<void>((resolve, reject) => { finishMove = error => error ? reject(error) : resolve(); });
        const current = settingsStore.getState().cards;
        const updates = planMove(current, id, column, index);
        settingsStore.setState({ cards: current.map(c => updates.get(c.id) ?? c) });
      },
    });
    const orderIn = (column: string) => [...host.querySelectorAll(`[aria-label="${column}"] [aria-roledescription^="Draggable card"]`)].map(el => el.getAttribute('aria-label'));
    const press = async (code: string, target: EventTarget = document) => {
      flushSync(() => target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true })));
      await frame();
    };
    const mouse = async (type: string, x: number, y: number, target: EventTarget = document) => {
      flushSync(() => target.dispatchEvent(new MouseEvent(type, { button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: x, clientY: y, bubbles: true })));
      await frame();
    };
    try {
      flushSync(() => boardRoot.render(createElement(BoardView)));
      await frame();
      const first = host.querySelector<HTMLElement>('[aria-label="first"][aria-roledescription]')!;
      if (scenario === 'keyboard') {
        first.focus();
        await press('Space', first);
        await press('ArrowDown');
        await press('Space');
      } else {
        const start = first.getBoundingClientRect();
        const x = start.left + start.width / 2, y = start.top + start.height / 2;
        await mouse('mousedown', x, y, first);
        await mouse('mousemove', x + 8, y);
        const targetCard = scenario === 'noop' ? first : host.querySelector<HTMLElement>(`[aria-label="${scenario === 'cross-column' ? 'third' : 'second'}"][aria-roledescription]`)!;
        const end = targetCard.getBoundingClientRect();
        const endX = end.left + end.width / 2, endY = end.top + end.height / 2;
        await mouse('mousemove', endX, endY);
        if (scenario === 'cancel') await press('Escape');
        else await mouse('mouseup', endX, endY);
      }
      if (scenario === 'cancel' || scenario === 'noop') {
        equal(moveCalls, 0, `${scenario}: do not save`);
        equal(orderIn('todo'), ['first', 'second'], `${scenario}: retain saved order`);
        continue;
      }
      equal(moveCalls, 1, `${scenario}: start one save`);
      const target = scenario === 'cross-column' ? 'done' : 'todo';
      const droppedOrder = orderIn(target);
      if (scenario === 'cross-column') {
        equal(orderIn('todo'), ['second'], 'cross-column: do not return to the source while saving');
        assert(droppedOrder.includes('first'), 'cross-column: keep the card at its destination');
      } else equal(droppedOrder, ['second', 'first'], `${scenario}: retain final same-column order while saving`);
      equal(settingsStore.getState().cards, initialCards, `${scenario}: shared state is not optimistic`);
      // A second drag must not overwrite the layout while the first save is pending.
      await press('Space', host.querySelector<HTMLElement>('[aria-label="second"][aria-roledescription]')!);
      assert(!host.querySelector('[aria-label="second"][aria-pressed="true"]'), 'wait for the pending save before starting another drag');
      finishMove!(scenario === 'failure' ? new Error('disk failure') : undefined);
      await frame();
      if (scenario === 'failure') {
        equal(orderIn('todo'), ['first', 'second'], 'failed save restores saved order');
        assert(settingsStore.getState().toasts.some(t => t.message.includes('Try again')), 'failed save shows an error');
      } else equal(orderIn(target), droppedOrder, `${scenario}: switch to saved state without moving the card`);
    } finally {
      flushSync(() => boardRoot.unmount());
      host.remove();
      settingsStore.setState(savedUiState, true);
    }
  }
  results.push('Card drops retain the destination during delayed writes, recover on failure, and handle cancel/no-op');

  // Exercise routing through the actual app, IndexedDB, sidebar links and browser history.
  equal(boardIdFromPath('/board/route_b/'), 'route_b', 'accept a trailing slash');
  equal(boardIdFromPath(boardPath('space / %')), 'space / %', 'board IDs round-trip through URL encoding');
  for (const path of ['/', '/board/', '/board/a/extra', '/board/%E0%A4%A']) {
    equal(boardIdFromPath(path), null, `invalid board path is safe: ${path}`);
  }
  client = 'routing';
  await settingsDb.open();
  for (const [id, createdAt] of [['route-a', 1], ['route_b', 2]] as const) {
    await settingsDb.put('boards', { id, name: id, createdAt });
  }
  await settingsDb.put('settings', { key: 'activeBoardId', value: 'route-a' });
  const routingHost = document.createElement('div');
  document.body.append(routingHost);
  const routingRoot = createRoot(routingHost);
  const previousUrl = location.href;
  try {
    history.replaceState(null, '', '/board/route_b?source=link#main-content');
    settingsStore.setState({ isLoading: true, error: null });
    flushSync(() => routingRoot.render(createElement(App)));
    for (let i = 0; settingsStore.getState().isLoading && i < 60; i++) await frame();
    await frame();
    equal(settingsStore.getState().error, null, 'routing app initializes');
    equal(settingsStore.getState().activeBoardId, 'route_b', 'direct link wins over the saved selection');
    equal(routingHost.querySelector('h1')?.textContent, 'route_b', 'direct link renders the right board');
    const link = routingHost.querySelector<HTMLAnchorElement>('a[href="/board/route-a"]')!;
    assert(link, 'boards have real links for opening in a new tab');
    const initialLength = history.length;
    settingsStore.getState().setSearchQuery('old board filter');
    link.click();
    await frame();
    equal(location.pathname, '/board/route-a', 'sidebar click changes the browser URL');
    equal(settingsStore.getState().activeBoardId, 'route-a', 'sidebar click selects the board');
    equal(settingsStore.getState().searchQuery, '', 'navigation clears board filters');
    equal(location.search + location.hash, '?source=link#main-content', 'navigation preserves query and hash');
    equal(history.length, initialLength + 1, 'board navigation adds one history entry');
    link.click();
    await frame();
    equal(history.length, initialLength + 1, 'selecting the current board does not duplicate history');
    for (const [direction, id] of [['back', 'route_b'], ['forward', 'route-a']] as const) {
      const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }));
      history[direction]();
      await popped;
      await frame();
      equal(settingsStore.getState().activeBoardId, id, `${direction} restores the board`);
      equal(routingHost.querySelector('h1')?.textContent, id, `${direction} renders the restored board`);
    }
    const beforeDelete = history.length;
    await settingsStore.getState().deleteBoard('route-a');
    equal(location.pathname, '/board/route_b', 'deleting the active board routes to the remaining board');
    equal(history.length, beforeDelete, 'deletion replaces the obsolete URL');
    history.replaceState(null, '', '/board/missing');
    await settingsStore.getState().init();
    equal(settingsStore.getState().activeBoardId, null, 'missing deep link never displays an unrelated board');
    equal(location.pathname, '/', 'missing board URL falls back safely');
    const missing = settingsStore.getState().toasts.find(t => t.action?.label === 'Join board')!;
    assert(missing, 'missing board offers a way to join');
    await missing.action!.run();
    equal(settingsStore.getState().modal?.props?.boardId, 'missing', 'join action retains the requested board ID');
    settingsStore.getState().closeModal();
    await settingsStore.getState().setActiveBoard('route_b');
    await settingsStore.getState().deleteBoard('route_b');
    equal(location.pathname, '/', 'deleting the last board routes home');
    setBoardUrl(null);
    equal(location.pathname, '/', 'home navigation is idempotent');
  } finally {
    flushSync(() => routingRoot.unmount());
    routingHost.remove();
    settingsSync.stopTimer();
    settingsStore.setState(savedUiState, true);
    history.replaceState(null, '', previousUrl);
  }
  results.push('Board URLs: direct links, sidebar links, creation/join, back/forward, duplicate navigation, deletion and missing boards');
  a.sync.stopTimer(); b.sync.stopTimer(); reloadB.sync.stopTimer();
}

run().then(() => fetch('/sync-result', { method: 'POST', body: JSON.stringify({ ok: true, results }) }))
  .catch(error => fetch('/sync-result', { method: 'POST', body: JSON.stringify({ ok: false, error: error.stack }) }));
