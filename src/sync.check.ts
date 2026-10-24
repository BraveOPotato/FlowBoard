// Runs in real Chromium with IndexedDB against the SQLite-backed worker. See scripts/sync.check.mjs.
import { SYNC_PROTOCOL, applyOp, emptyState, materialize, mergeStates, type CrdtState } from './services/crdt.ts';
import { DatabaseService } from './services/DatabaseService.ts';
import type { SyncRecovery } from './services/DatabaseService.ts';
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

  // Upgrade an actual old-style IndexedDB copy: no per-record clocks or deletion
  // markers. A cloud-only card could be a deletion OR another device's new card.
  for (const choice of ['local', 'cloud'] as const) {
    await a.useFlowStore.getState().createBoard(`Recovery ${choice}`, 'recovery-password');
    const recoveryId = a.useFlowStore.getState().activeBoardId!;
    const recoveryBoard = a.useFlowStore.getState().boards.find(b => b.id === recoveryId)!;
    const recoveryColumns = a.useFlowStore.getState().columns.filter(c => c.boardId === recoveryId);
    const todo = recoveryColumns[0].id, done = recoveryColumns[2].id;
    await a.useFlowStore.getState().createCard(recoveryId, todo, { title: 'Completed locally' });
    await a.useFlowStore.getState().createCard(recoveryId, todo, { title: 'Deleted locally' });
    await a.useFlowStore.getState().createCard(recoveryId, todo, { title: 'Unknown cloud-only card' });
    await syncA();
    const serverCards = a.useFlowStore.getState().cards.filter(c => c.boardId === recoveryId);
    const completed = serverCards.find(c => c.title === 'Completed locally')!;
    const removed = serverCards.find(c => c.title === 'Deleted locally')!;
    const unknown = serverCards.find(c => c.title === 'Unknown cloud-only card')!;
    const recoveryKey = (await a.sync.getBoardCreds(recoveryId))!.keyHash;
    assert((await fetch('/api/board/put', { method: 'POST', body: JSON.stringify({ boardId: recoveryId, keyHash: recoveryKey, protocolVersion: SYNC_PROTOCOL,
      data: { boards: [recoveryBoard], columns: recoveryColumns, cards: [...serverCards, { ...completed, id: `legacy-only-${choice}` }], activity: [] } }) })).ok, 'store stale full-state baseline');
    const recoveryCloud = async () => (await (await fetch('/api/crdt/state/get', { method: 'POST',
      body: JSON.stringify({ boardId: recoveryId, keyHash: recoveryKey }) })).json()).state as CrdtState;

    client = `old-${choice}`;
    const oldDb = await new DatabaseService().open();
    await oldDb.put('boards', recoveryBoard);
    await oldDb.batchPut('columns', recoveryColumns);
    await oldDb.put('cards', { ...completed, columnId: done });
    await oldDb.put('activity', { id: `deleted-${choice}`, boardId: recoveryId, cardId: removed.id, type: 'deleted', ts: Date.now() });
    const queued = { ...completed, id: `queued-${choice}`, title: 'Pending old-client draft' };
    await oldDb.put('cards', queued);
    await oldDb.put('crdtOps', { ...op('card.create', Date.now() + 1), boardId: recoveryId, opId: `queued-op-${choice}`, payload: queued });
    await oldDb.put('boardCreds', { boardId: recoveryId, keyHash: recoveryKey, name: recoveryBoard.name, lastSynced: null });
    await oldDb.put('settings', { key: 'workerUrl', value: location.origin });

    const upgraded = await load(`upgraded-${choice}`, `old-${choice}`);
    await upgraded.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
    upgraded.sync.stopTimer();
    assert(upgraded.useFlowStore.getState().syncRecoveryBoardIds.includes(recoveryId), 'legacy board pauses automatically');
    let recoveryJoinError = '';
    try { await upgraded.useFlowStore.getState().joinBoard(recoveryId, 'recovery-password'); }
    catch (error) { recoveryJoinError = (error as Error).message; }
    assert(recoveryJoinError.includes('already on this device') && recoveryJoinError.includes('recovery'), 'rejoining a paused board must not report board not found');
    equal(upgraded.useFlowStore.getState().modal?.type, 'settings', 'rejoin directs a paused board to Settings recovery');
    upgraded.useFlowStore.getState().closeModal();
    equal(upgraded.useFlowStore.getState().cards.find(c => c.id === completed.id)!.columnId, done, 'upgrade must not move Done card back');
    assert(!upgraded.useFlowStore.getState().cards.some(c => c.id === removed.id || c.id === unknown.id), 'upgrade must not resurrect deleted or ambiguous cards');
    equal(await upgraded.sync.pushCrdtOps(recoveryId), false, 'paused board must not upload even through direct push');
    assert(!(await recoveryCloud()).cards[queued.id], 'legacy outbox is not uploaded before review');
    equal((await upgraded.db.getAll('crdtOps')).length, 1, 'preserve legacy outbox');
    const backup = (await upgraded.db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${recoveryId}`))!.value;
    equal(backup.local.cards[completed.id].columnId, done, 'backup retains pre-merge Done position');
    assert(!backup.local.cards[removed.id], 'backup retains original absence without inventing a tombstone');
    const createUrl = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    let exported: Blob | undefined;
    URL.createObjectURL = blob => { if (blob instanceof Blob) exported = blob; return createUrl(blob); };
    HTMLAnchorElement.prototype.click = () => {};
    try { await upgraded.useFlowStore.getState().exportSyncRecovery(recoveryId); }
    finally { URL.createObjectURL = createUrl; HTMLAnchorElement.prototype.click = click; }
    const exportedData = JSON.parse(await exported!.text());
    equal(exportedData.cards.find((c: Card) => c.id === completed.id).columnId, done, 'recovery export remains a regular importable board');
    assert(exportedData.recovery.remote.cards[removed.id], 'export includes the cloud version without merging it');

    // The central transaction also protects a remote callback already in flight.
    const remoteBefore = await recoveryCloud();
    await upgraded.db.updateSyncState(recoveryId, emptyState(), state => { mergeStates(state, remoteBefore); return []; }, { remote: true });
    equal((await upgraded.db.get<Card>('cards', completed.id))!.columnId, done, 'remote transaction cannot bypass pause');
    assert(!await upgraded.db.get('cards', removed.id), 'remote transaction cannot bypass deletion protection');
    await upgraded.useFlowStore.getState().updateCard(completed.id, { title: 'Edited while paused' });
    upgraded.sync.stopTimer();

    const resumed = await load(`reloaded-${choice}`, `old-${choice}`);
    await resumed.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
    resumed.sync.stopTimer();
    assert(resumed.useFlowStore.getState().syncRecoveryBoardIds.includes(recoveryId), 'recovery pause survives reload');
    equal(resumed.useFlowStore.getState().cards.find(c => c.id === completed.id)!.title, 'Edited while paused', 'local editing works during recovery');

    const fetchBefore = window.fetch;
    window.fetch = async (...args) => String(args[0]).endsWith('/api/crdt/state/get')
      ? new Response(JSON.stringify({ found: true, state: remoteBefore })) : fetchBefore(...args);
    let blocked = false;
    try { await resumed.useFlowStore.getState().resolveSyncRecovery(recoveryId, choice); }
    catch { blocked = true; }
    finally { window.fetch = fetchBefore; }
    assert(blocked && await resumed.sync.isSyncPaused(recoveryId), 'old worker cannot silently resolve recovery');

    // Resolution, backup, versions and outbox must still roll back as one unit.
    try { await resumed.db.updateSyncState(recoveryId, emptyState(), () => { throw new Error('failed resolution'); }, { resolveWith: remoteBefore }); }
    catch { /* expected rollback */ }
    assert(await resumed.sync.isSyncPaused(recoveryId), 'failed resolution must retain pause');
    await resumed.useFlowStore.getState().resolveSyncRecovery(recoveryId, choice);
    resumed.sync.stopTimer();
    assert(!await resumed.sync.isSyncPaused(recoveryId), 'explicit choice resumes sync');
    const recovered = await recoveryCloud();
    if (choice === 'local') {
      equal(recovered.cards[completed.id].columnId, done, 'local choice publishes Done position');
      equal(recovered.cards[completed.id].title, 'Edited while paused', 'local choice includes edits since backup');
      assert(recovered.cards[removed.id].__deleted && recovered.cards[unknown.id].__deleted, 'only explicit local choice removes cloud-only cards');
      assert(recovered.cards[queued.id] && !recovered.cards[queued.id].__deleted, 'local choice retains pending draft');
    } else {
      equal(resumed.useFlowStore.getState().cards.find(c => c.id === completed.id)!.columnId, todo, 'cloud position is used only after explicit approval');
      assert(resumed.useFlowStore.getState().cards.some(c => c.id === removed.id), 'cloud card is restored only after explicit approval');
      assert(recovered.cards[queued.id].__deleted, 'superseded pending draft cannot leak back after cloud choice');
    }
    const saved = (await resumed.db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${recoveryId}`))!.value;
    assert(saved.resolved && saved.remote && saved.beforeResolution, 'keep both versions after resolution');
    equal(saved.beforeResolution!.cards[completed.id].title, 'Edited while paused', 'backup includes edits made while paused');
    equal(saved.local.cards[completed.id].columnId, done, 'original migration backup is never replaced');
    equal((await resumed.db.getAll('crdtOps')).length, 0, 'recovery operations are acknowledged');
    const fresh = await load(`recovered-join-${choice}`, `recovered-join-${choice}`);
    assert(await fresh.useFlowStore.getState().joinBoard(recoveryId, 'recovery-password'), 'new device can join recovered board');
    await fresh.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
    fresh.sync.stopTimer();
    assert(!fresh.useFlowStore.getState().cards.some(c => c.id === `legacy-only-${choice}`), 'joining recovered board cannot resurrect legacy-only records');
    if (choice === 'local') assert(!fresh.useFlowStore.getState().cards.some(c => c.id === removed.id), 'joining recovered board respects recovered deletions');
    results.push(`Legacy upgrade: Done/deletion protection, durable pause/backup, local edits and explicit ${choice} recovery`);
  }

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

  // Manually repair an already-versioned/rejoined board, not only a legacy upgrade.
  const repair = await load('manual-repair', 'manual-repair');
  const repairSync = async () => { await repair.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 }); repair.sync.stopTimer(); };
  await repair.useFlowStore.getState().createBoard('Board to repair', 'repair-password');
  const repairId = repair.useFlowStore.getState().activeBoardId!;
  const repairColumn = repair.useFlowStore.getState().columns.find(c => c.boardId === repairId)!;
  await repair.useFlowStore.getState().createCard(repairId, repairColumn.id, { title: 'Corrupted ticket' });
  const corruptCard = repair.useFlowStore.getState().cards.find(c => c.boardId === repairId)!;
  await repairSync();
  const stale = await load('stale-repair-device', 'stale-repair-device');
  assert(await stale.useFlowStore.getState().joinBoard(repairId, 'repair-password'), 'second device joins before repair');
  await stale.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  await stale.useFlowStore.getState().updateCard(corruptCard.id, { title: 'Pending stale-device edit' });
  stale.sync.stopTimer();
  const staleQueue = (await stale.db.getSyncOutbox(repairId)).ops.length;
  assert(staleQueue > 0, 'second device has pending pre-repair work');

  await repair.useFlowStore.getState().createBoard('Unrelated board', 'other-password');
  const otherId = repair.useFlowStore.getState().activeBoardId!;
  const otherColumns = repair.useFlowStore.getState().columns.filter(c => c.boardId === otherId);
  await repairSync();
  const importedCard = { ...corruptCard, id: 'snapshot-only-card', title: 'Known-good snapshot' };
  const repairSnapshot = { boards: [repair.useFlowStore.getState().boards.find(b => b.id === repairId)!], columns: [repairColumn],
    cards: Array.from({ length: 125 }, (_, i) => ({ ...importedCard, id: `${importedCard.id}-${i}`, order: i })),
    activity: [{ id: 'snapshot-only-event', boardId: repairId, cardId: `${importedCard.id}-0`, type: 'created', ts: 1 }] };
  const beforeRepairCards = JSON.stringify(repair.useFlowStore.getState().cards);
  for (const invalid of ['{}', JSON.stringify({ ...repairSnapshot, boards: [{ id: 'wrong-board', name: 'Wrong', createdAt: 1 }] }),
    JSON.stringify({ ...repairSnapshot, cards: [{ ...importedCard, columnId: 'missing-column' }] })]) {
    let rejected = false;
    try { await repair.useFlowStore.getState().overwriteImport(repairId, invalid); }
    catch { rejected = true; }
    assert(rejected, 'reject malformed and wrong-board snapshots');
    assert(!await repair.sync.isSyncPaused(repairId), 'invalid import must not begin repair');
    equal(JSON.stringify(repair.useFlowStore.getState().cards), beforeRepairCards, 'invalid overwrite leaves the board untouched');
  }
  await repair.useFlowStore.getState().beginSyncRepair(repairId);
  assert(await repair.sync.isSyncPaused(repairId), 'manual repair pauses a fully versioned board');
  await repair.useFlowStore.getState().updateCard(corruptCard.id, { title: 'Draft while paused' });
  repair.sync.stopTimer();
  const pausedCards = JSON.stringify(repair.useFlowStore.getState().cards);
  const replaceFetch = window.fetch;
  window.fetch = async (...args) => String(args[0]).endsWith('/api/crdt/state/replace')
    ? new Response(JSON.stringify({ error: 'Simulated replacement failure' }), { status: 503 }) : replaceFetch(...args);
  let overwriteFailed = false;
  try { await repair.useFlowStore.getState().overwriteImport(repairId, JSON.stringify(repairSnapshot)); }
  catch { overwriteFailed = true; }
  finally { window.fetch = replaceFetch; }
  assert(overwriteFailed && await repair.sync.isSyncPaused(repairId), 'failed overwrite stays paused');
  equal(JSON.stringify(repair.useFlowStore.getState().cards), pausedCards, 'failed overwrite keeps all local records');
  assert((await repair.db.getSyncOutbox(repairId)).ops.length > 0, 'failed overwrite keeps pending operations');

  // If D1 committed but the local disk failed, keep the old copy paused and let
  // Use cloud finish adopting the reset instead of ever uploading its old queue.
  const writeBeforeReset = repair.db.updateSyncState.bind(repair.db);
  repair.db.updateSyncState = (...args) => args[3]?.replaceWith
    ? Promise.reject(new Error('Simulated local replacement failure')) : writeBeforeReset(...args);
  let localResetFailed = false;
  try { await repair.useFlowStore.getState().overwriteImport(repairId, JSON.stringify(repairSnapshot)); }
  catch { localResetFailed = true; }
  finally { repair.db.updateSyncState = writeBeforeReset; }
  assert(localResetFailed && await repair.sync.isSyncPaused(repairId), 'local failure after a cloud reset stays paused');
  equal(JSON.stringify(repair.useFlowStore.getState().cards), pausedCards, 'local failure preserves the previous device copy');
  await repair.useFlowStore.getState().resolveSyncRecovery(repairId, 'cloud');
  repair.sync.stopTimer();
  await repair.useFlowStore.getState().overwriteImport(repairId, JSON.stringify({ ...repairSnapshot,
    boards: [...repairSnapshot.boards, repair.useFlowStore.getState().boards.find(b => b.id === otherId)!],
    columns: [...repairSnapshot.columns, ...otherColumns] }));
  repair.sync.stopTimer();
  equal(repair.useFlowStore.getState().cards.filter(c => c.boardId === repairId).length, 125, 'all snapshot cards replace the board in one reset');
  assert(!repair.useFlowStore.getState().cards.some(c => c.id === corruptCard.id), 'remove a ticket absent from the snapshot');
  equal(repair.useFlowStore.getState().activity.filter(a => a.boardId === repairId).map(a => a.id), ['snapshot-only-event'], 'replace, not merge, Timeline history');
  equal(repair.useFlowStore.getState().columns.filter(c => c.boardId === otherId), otherColumns, 'other boards are unchanged');
  equal(await repair.db.get('cards', corruptCard.id), undefined, 'remove stale records from IndexedDB too');
  equal((await repair.db.getSyncOutbox(repairId)).ops.length, 0, 'discard superseded outbox only after replacement succeeds');
  const repairBackups = (await repair.db.getAll<{ key: string; value: { local?: CrdtState; pending?: CrdtOp[] } }>('settings'))
    .filter(s => s.key.startsWith(`syncRepairBackup:${repairId}:`));
  assert(repairBackups.some(s => s.value.local?.cards[corruptCard.id]?.title === 'Draft while paused' && s.value.pending?.length), 'keep overwritten records and outbox in a separate durable backup');
  const exportUrl = URL.createObjectURL, exportClick = HTMLAnchorElement.prototype.click;
  let repairExport: Blob | undefined;
  URL.createObjectURL = blob => { if (blob instanceof Blob) repairExport = blob; return exportUrl(blob); };
  HTMLAnchorElement.prototype.click = () => {};
  try { await repair.useFlowStore.getState().exportSyncRecovery(repairId); }
  finally { URL.createObjectURL = exportUrl; HTMLAnchorElement.prototype.click = exportClick; }
  const repairExportData = JSON.parse(await repairExport!.text());
  assert(repairExportData.recovery.backups.some((s: { local?: CrdtState }) => s.local?.cards[corruptCard.id]?.title === 'Draft while paused'), 'export contains the retained pre-overwrite copies');
  equal(await stale.sync.pushCrdtOps(repairId), false, 'pre-repair device cannot upload even before it pulls the reset');
  equal((await stale.db.getSyncOutbox(repairId)).ops.length, staleQueue, 'rejected stale upload keeps pending work');
  await stale.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  stale.sync.stopTimer();
  assert(await stale.sync.isSyncPaused(repairId), 'a changed cloud generation requires review');
  await stale.useFlowStore.getState().resolveSyncRecovery(repairId, 'cloud');
  stale.sync.stopTimer();
  equal(stale.useFlowStore.getState().cards.filter(c => c.boardId === repairId).length, 125, 'cloud choice adopts the repaired board exactly');
  equal(stale.useFlowStore.getState().activity.filter(a => a.boardId === repairId).map(a => a.id), ['snapshot-only-event'], 'cloud choice cannot resurrect pre-reset Timeline events');
  equal((await stale.db.getSyncOutbox(repairId)).ops.length, 0, 'old queue is archived instead of relabelled with the new generation');
  const repairedReload = await load('repaired-reload', 'manual-repair');
  await repairedReload.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
  repairedReload.sync.stopTimer();
  equal(repairedReload.useFlowStore.getState().cards.filter(c => c.boardId === repairId).length, 125, 'overwrite survives reload');
  const repairJoiner = await load('repair-new-joiner', 'repair-new-joiner');
  assert(await repairJoiner.useFlowStore.getState().joinBoard(repairId, 'repair-password'), 'new device joins the overwritten board');
  repairJoiner.sync.stopTimer();
  equal(repairJoiner.useFlowStore.getState().activity.filter(a => a.boardId === repairId).map(a => a.id), ['snapshot-only-event'], 'new joins use only replacement history');
  results.push('Advanced manual repair and 125-card overwrite: validation, failure safety, backups, exact history replacement, reload and stale-device review');

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

  const beforeRepairUi = settingsStore.getState();
  const originalConfirm = window.confirm;
  let manualStarts = 0, overwriteAttempts = 0;
  let savedSettings: { workerUrl: string; syncInterval: number } | undefined;
  settingsStore.setState({ boards: repairSnapshot.boards, activeBoardId: repairId, syncRecoveryBoardIds: [],
    saveSettings: async value => { savedSettings = value; },
    beginSyncRepair: async id => { manualStarts++; settingsStore.setState({ syncRecoveryBoardIds: [id] }); },
    overwriteImport: async (id, json) => {
      equal(id, repairId, 'UI overwrite targets the selected board');
      equal(JSON.parse(json).cards.length, 125, 'UI passes the chosen snapshot');
      overwriteAttempts++;
      throw new Error('Worker must be upgraded before overwriting.');
    } });
  const repairHost = document.createElement('div');
  document.body.append(repairHost);
  const repairRoot = createRoot(repairHost);
  try {
    flushSync(() => repairRoot.render(createElement(SettingsModal)));
    const tabs = [...repairHost.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    equal(tabs.map(t => t.textContent), ['General', 'Backup', 'Advanced'], 'settings are split into three named tabs');
    const tab = (name: string) => tabs.find(t => t.textContent === name)!;
    const panel = (name: string) => document.getElementById(tab(name).getAttribute('aria-controls')!)!;
    const selectTab = (name: string) => flushSync(() => tab(name).click());
    assert(tab('General').getAttribute('aria-selected') === 'true' && !panel('General').hidden, 'normal settings start on General');
    assert(panel('Backup').hidden && panel('Advanced').hidden, 'inactive tab panels are hidden');
    equal(tabs.filter(t => t.tabIndex === 0).length, 1, 'only the active tab is in the tab order');
    for (const button of tabs) equal(panel(button.textContent!).getAttribute('aria-labelledby'), button.id, 'each panel labels itself with its tab');
    const workerField = repairHost.querySelector<HTMLInputElement>('#worker-url')!;
    const joinField = repairHost.querySelector<HTMLInputElement>('#join-id')!;
    const joinPassword = repairHost.querySelector<HTMLInputElement>('#join-pw')!;
    flushSync(() => {
      for (const [field, value] of [[workerField, ' https://worker.example.test '], [joinField, 'draft-board-id'], [joinPassword, 'draft-test-password']] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const interval = repairHost.querySelector<HTMLSelectElement>('#sync-interval')!;
      interval.value = '60';
      interval.dispatchEvent(new Event('change', { bubbles: true }));
    });
    selectTab('Backup');
    assert(!panel('Backup').hidden && panel('General').hidden, 'Backup shows only backup tools');
    assert(panel('Backup').textContent?.includes('Export JSON') && panel('Backup').textContent?.includes('Import JSON'), 'backup actions are available');
    assert(![...repairHost.querySelectorAll('button')].some(b => b.textContent === 'Save settings'), 'Save settings belongs to General');
    selectTab('Advanced');
    for (const [key, expected] of [['Home', 'General'], ['ArrowLeft', 'Advanced'], ['ArrowRight', 'General'], ['End', 'Advanced'], ['ArrowLeft', 'Backup']]) {
      const current = tabs.find(t => t.getAttribute('aria-selected') === 'true')!;
      flushSync(() => current.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
      assert(tab(expected).getAttribute('aria-selected') === 'true' && document.activeElement === tab(expected), `${key} selects and focuses the correct tab`);
    }
    selectTab('General');
    equal(workerField.value, ' https://worker.example.test ', 'tab switches preserve unsaved worker URL');
    equal(joinField.value, 'draft-board-id', 'tab switches preserve the join draft');
    equal(joinPassword.value, 'draft-test-password', 'tab switches preserve the join password');
    [...repairHost.querySelectorAll('button')].find(b => b.textContent === 'Save settings')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(savedSettings, { workerUrl: 'https://worker.example.test', syncInterval: 60 }, 'General saves its preserved form values');
    selectTab('Advanced');
    const advanced = panel('Advanced');
    assert(!advanced.hidden, 'Advanced exposes the repair tools');
    const start = [...advanced.querySelectorAll('button')].find(b => b.textContent === 'Repair this board')!;
    start.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(manualStarts, 1, 'Repair is available for an already-versioned board');
    const overwriteButton = [...advanced.querySelectorAll('button')].find(b => b.textContent === 'Overwrite import')!;
    assert(overwriteButton, 'paused repair offers Overwrite import under Advanced');
    overwriteButton.click();
    const upload = advanced.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = async (json: string) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([json], 'snapshot.json', { type: 'application/json' }));
      upload.files = transfer.files;
      upload.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 25));
    };
    window.confirm = () => { throw new Error('Invalid file must not reach confirmation'); };
    await choose('{}');
    equal(overwriteAttempts, 0, 'invalid file cannot overwrite');
    assert(advanced.querySelector('[role="alert"]')?.textContent?.includes('snapshot'), 'invalid snapshot error remains visible');
    window.confirm = () => false;
    await choose(JSON.stringify(repairSnapshot));
    equal(overwriteAttempts, 0, 'cancelling confirmation makes no replacement call');
    window.confirm = message => { assert(String(message).includes('Timeline history') && String(message).includes('shared sync history'), 'confirmation explains destructive scope'); return true; };
    await choose(JSON.stringify(repairSnapshot));
    equal(overwriteAttempts, 1, 'confirmed snapshot invokes overwrite');
    assert(advanced.querySelector('[role="alert"]')?.textContent?.includes('Worker must be upgraded'), 'overwrite failure remains actionable');
    assert(!overwriteButton.disabled, 'failed overwrite permits retry');
    flushSync(() => repairRoot.render(createElement(SettingsModal, { key: 'paused-board-settings' })));
    assert(repairHost.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Advanced', 'reopening settings with recovery needed starts on Advanced');
  } finally {
    window.confirm = originalConfirm;
    flushSync(() => repairRoot.unmount());
    repairHost.remove();
    settingsStore.setState(beforeRepairUi, true);
  }
  results.push('Settings tabs: keyboard navigation, labelled panels, preserved drafts, General save, invite isolation and Advanced recovery default');
  results.push('Advanced settings UI: manual repair, snapshot picker, validation, destructive confirmation, cancellation and retry');

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
