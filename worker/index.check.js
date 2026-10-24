// Runs the worker against an in-memory SQLite stand-in for D1: node worker/index.check.js
import assert from 'node:assert/strict';
import worker from './index.js';
import { createDatabase } from './test-db.js';
import { SYNC_PROTOCOL, applyOp, emptyState, materialize, mergeStates, settle } from '../src/services/crdt.ts';

const { sql, env } = createDatabase();

const keyHash = 'a'.repeat(64);
const boardId = 'b1';
const call = async (path, body = {}) => (await worker.fetch(new Request(`https://w${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash, protocolVersion: SYNC_PROTOCOL, ...body }) }), env)).json();
let n = 0;
const op = (type, ts, payload) => ({ opId: `op${++n}`, type, ts, clientId: 'c', payload });
const push = (...ops) => call('/api/crdt/ops/push', { ops });
const join = async () => {
  const r = await call('/api/board/get');
  return { ...r, cardIds: r.crdt.cards.map((c) => c.id).sort(), boardIds: r.crdt.boards.map((b) => b.id) };
};

const DAY = 864e5;
const old = Date.now() - 60 * DAY;

// Board, column and first card were created long ago; a snapshot then prunes those ops.
await push(op('board.update', old, { boardId, id: boardId, name: 'Team' }), op('column.create', old, { id: 'col', boardId }), op('card.create', old, { id: 'A', boardId, columnId: 'col' }));
await call('/api/crdt/state/snapshot');
assert.deepEqual((await join()).cardIds, ['A'], 'first join sees the board');

// Later activity must reach later joiners (no frozen copy), and a second snapshot must keep the pruned history.
await push(op('card.create', Date.now(), { id: 'B', boardId, columnId: 'col' }));
await call('/api/crdt/state/snapshot');
// Op created offline before the snapshot but pushed after it.
await push(op('card.create', Date.now() - DAY, { id: 'C', boardId, columnId: 'col' }));
// Deleted then restored with Undo, vs. deleted for good.
await push(op('card.create', Date.now(), { id: 'D', boardId }), op('card.delete', Date.now() + 1, { id: 'D' }), op('card.create', Date.now() + 2, { id: 'D', boardId }));
await push(op('card.create', Date.now(), { id: 'E', boardId }), op('card.delete', Date.now() + 1, { id: 'E' }));
// A stale update must not resurrect a newer delete.
await push(op('card.update', Date.now() - DAY, { id: 'E', boardId }));
// Nor can a newer edit from a device that never saw the delete: deletes are authoritative.
await push(op('card.move', Date.now() + DAY, { id: 'E', boardId, columnId: 'col' }));

let j = await join();
assert.deepEqual(j.boardIds, [boardId], 'board record survives snapshots');
assert.deepEqual(j.cardIds, ['A', 'B', 'C', 'D'], 'joiner gets every live card');
assert.deepEqual(j.crdt.deleted, ['E'], 'tombstones are reported so stale copies can be dropped');
assert.deepEqual(j.data.cards.map((c) => c.id).sort(), j.cardIds, 'without a legacy row, data is the live state');

// A legacy full-state row is returned as-is alongside the live state.
sql.prepare('INSERT OR REPLACE INTO boards (key_hash, data, updated_at) VALUES (?, ?, ?)').run(keyHash, JSON.stringify({ enc: 1 }), Date.now());
j = await join();
assert.deepEqual(j.data, { enc: 1 });
assert.deepEqual(j.cardIds, ['A', 'B', 'C', 'D']);

// Boards recovered under protocol 2 stay reconciled after the protocol 3 upgrade.
await push(op('board.update', Date.now() + 10, { boardId, id: boardId, name: 'Recovered', syncProtocol: 2 }));
j = await join();
assert.deepEqual(j.data.cards.map(c => c.id).sort(), j.cardIds, 'recovery prevents a stale legacy baseline from being reapplied');
assert.deepEqual(JSON.parse(sql.prepare('SELECT data FROM boards WHERE key_hash = ?').get(keyHash).data), { enc: 1 }, 'retain legacy data for backup, not live sync');

// Cron: a board with recent activity keeps its oldest ops; an idle board is removed entirely.
const idle = 'f'.repeat(64);
sql.prepare('UPDATE crdt_ops SET updated_at = 0 WHERE type = ?').run('column.create');
sql.prepare("INSERT INTO crdt_ops VALUES ('x', ?, 'card.create', 0, 'c', '{}', 0)").run(idle);
sql.prepare('INSERT INTO crdt_snapshots VALUES (?, ?, 0, 0)').run(idle, '{}');
await worker.scheduled(null, env);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops WHERE key_hash = ?').get(keyHash).n > 0, true);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops WHERE key_hash = ?').get(idle).n, 0);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM crdt_snapshots WHERE key_hash = ?').get(idle).n, 0);
assert.deepEqual((await join()).cardIds, ['A', 'B', 'C', 'D'], 'cron keeps live boards whole');

console.log('worker checks passed');

// A late offline op arrives after a snapshot's read but before its write/GC.
const race = createDatabase();
const raceCall = async (path, body = {}) => worker.fetch(new Request(`https://w${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash, protocolVersion: SYNC_PROTOCOL, ...body }) }), race.env);
await raceCall('/api/crdt/ops/push', { ops: [op('card.create', old, { id: 'before', boardId })] });
race.env.flowboard_db.beforeBatch = async (ss) => {
  if (!ss[0].query.includes('INSERT INTO crdt_snapshots')) return;
  race.env.flowboard_db.beforeBatch = null;
  await raceCall('/api/crdt/ops/push', { ops: [op('card.create', old + 1, { id: 'arrived-during-gc', boardId })] });
};
await raceCall('/api/crdt/state/snapshot');
assert.deepEqual((await (await raceCall('/api/crdt/state/get')).json()).data.cards.map(c => c.id).sort(), ['arrived-during-gc', 'before']);

// A second snapshot wins while the first is waiting. The stale snapshot must neither replace it nor prune its history.
await raceCall('/api/crdt/ops/push', { ops: [op('card.create', old + 2, { id: 'second', boardId })] });
race.env.flowboard_db.beforeBatch = async (ss) => {
  if (!ss[0].query.includes('INSERT INTO crdt_snapshots')) return;
  race.env.flowboard_db.beforeBatch = null;
  await raceCall('/api/crdt/ops/push', { ops: [op('card.create', old + 3, { id: 'concurrent', boardId })] });
  await raceCall('/api/crdt/state/snapshot');
};
await raceCall('/api/crdt/state/snapshot');
assert.deepEqual((await (await raceCall('/api/crdt/state/get')).json()).data.cards.map(c => c.id).sort(), ['arrived-during-gc', 'before', 'concurrent', 'second']);

// Snapshot and GC roll back together if a database statement fails.
await raceCall('/api/crdt/ops/push', { ops: [op('card.create', old + 4, { id: 'rollback', boardId })] });
const priorSnap = race.sql.prepare('SELECT snap FROM crdt_snapshots').get().snap;
race.sql.exec("CREATE TRIGGER fail_gc BEFORE DELETE ON crdt_ops BEGIN SELECT RAISE(ABORT, 'simulated D1 failure'); END");
const log = console.error;
console.error = () => {};
try { assert.equal((await raceCall('/api/crdt/state/snapshot')).status, 500); }
finally { console.error = log; }
assert.equal(race.sql.prepare('SELECT snap FROM crdt_snapshots').get().snap, priorSnap);
assert.equal(race.sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops').get().n, 1);
race.sql.exec('DROP TRIGGER fail_gc');

// Reads on every supported read path renew CRDT-only boards, including snapshot-only boards.
for (const path of ['/api/board/get', '/api/board/touch', '/api/crdt/ops/pull', '/api/crdt/state/get']) {
  race.sql.exec('UPDATE boards SET updated_at = 0; UPDATE crdt_ops SET updated_at = 0; UPDATE crdt_snapshots SET updated_at = 0');
  assert.equal((await raceCall(path)).status, 200);
  await worker.scheduled(null, race.env);
  assert.equal((await (await raceCall('/api/crdt/state/get')).json()).found, true, path);
}
race.sql.exec('UPDATE boards SET updated_at = 0; UPDATE crdt_ops SET updated_at = 0; UPDATE crdt_snapshots SET updated_at = 0');
await worker.scheduled(null, race.env);
assert.equal((await (await raceCall('/api/crdt/state/get')).json()).found, false, 'idle boards still expire');

// Same-clock conflicts converge even when a competing operation arrives after compaction.
await raceCall('/api/crdt/ops/push', { ops: [{ ...op('card.create', old, { id: 'tie', boardId, title: 'winner' }), opId: 'z' }] });
await raceCall('/api/crdt/state/snapshot');
await raceCall('/api/crdt/ops/push', { ops: [{ ...op('card.delete', old, { id: 'tie' }), opId: 'a' }] });
assert.equal((await (await raceCall('/api/crdt/state/get')).json()).data.cards[0].title, 'winner');

for (const bad of [null, { ...op('unknown', 0, { id: 'x' }) }, op('card.create', 0, { id: '__proto__' }), op('card.create', 0, { id: 'x', boardId: 'another-board' })]) {
  assert.equal((await raceCall('/api/crdt/ops/push', { ops: [bad] })).status, 400);
}
console.log('worker concurrency, rollback, TTL and validation checks passed');

// Cached old clients cannot overwrite a recovered board, through either write API.
const before = (await (await raceCall('/api/crdt/state/get')).json()).state;
for (const protocolVersion of [undefined, 1, SYNC_PROTOCOL - 1, SYNC_PROTOCOL + 1]) {
  assert.equal((await raceCall('/api/crdt/ops/push', { protocolVersion, ops: [op('card.update', Date.now(), { id: 'tie', boardId, title: 'stale client' })] })).status, 409);
  assert.equal((await raceCall('/api/board/put', { protocolVersion, data: { cards: [] } })).status, 409);
}
assert.deepEqual((await (await raceCall('/api/crdt/state/get')).json()).state, before);
console.log('outdated-client writes rejected without changing shared state');

// Overwrite is one atomic history replacement, not a batch of ordinary edits.
const snapshot = {
  boards: [{ id: boardId, name: 'Restored board', createdAt: 1 }],
  columns: [{ id: 'restored-column', boardId, name: 'Done', order: 0, color: '#888888' }],
  cards: [{ id: 'restored-card', boardId, columnId: 'restored-column', title: 'Snapshot ticket', desc: '', tags: [], color: 'transparent', priority: 'medium', dueDate: null, order: 0, createdAt: 1 }],
  activity: [{ id: 'restored-event', boardId, cardId: 'restored-card', type: 'created', ts: 1 }],
};
const cloudState = async () => (await (await raceCall('/api/crdt/state/get')).json()).state;
const reset = async (resetId, expected = undefined) => raceCall('/api/crdt/state/replace', { resetId, snapshot, expected: expected === undefined ? await cloudState() : expected });
const beforeInvalid = await cloudState();
for (const invalid of [{}, { ...snapshot, boards: [{ id: 'another-board', name: 'Wrong', createdAt: 1 }] },
  { ...snapshot, cards: [...snapshot.cards, ...snapshot.cards] },
  { ...snapshot, columns: [] }, { ...snapshot, cards: [{ ...snapshot.cards[0], title: null }] },
  { ...snapshot, cards: [{ ...snapshot.cards[0], boardId: undefined }] }]) {
  assert.equal((await raceCall('/api/crdt/state/replace', { resetId: 'invalid', snapshot: invalid, expected: beforeInvalid })).status, 400);
}
assert.deepEqual(await cloudState(), beforeInvalid, 'invalid snapshots never modify the board');

// A write between the repair read and commit must not be erased by that repair.
race.env.flowboard_db.beforeBatch = async ss => {
  if (!ss[0].query.includes('INSERT INTO crdt_snapshots')) return;
  race.env.flowboard_db.beforeBatch = null;
  await raceCall('/api/crdt/ops/push', { ops: [op('card.create', Date.now(), { id: 'arrived-during-reset', boardId })] });
};
assert.equal((await reset('conflicted')).status, 409);
assert.ok((await cloudState()).cards['arrived-during-reset'], 'concurrent work survives a rejected overwrite');

const beforeReset = await cloudState();
const beforeResetLog = race.sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops').get().n;
race.sql.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON crdt_ops BEGIN SELECT RAISE(ABORT, 'simulated reset failure'); END");
console.error = () => {};
try { assert.equal((await reset('failed', beforeReset)).status, 500); }
finally { console.error = log; }
assert.deepEqual(await cloudState(), beforeReset, 'failed overwrite rolls back its snapshot');
assert.equal(race.sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops').get().n, beforeResetLog, 'failed overwrite retains history');
race.sql.exec('DROP TRIGGER fail_reset');

assert.equal((await reset('reset-one', beforeReset)).status, 200);
let restored = await cloudState();
assert.deepEqual(Object.keys(restored.cards), ['restored-card']);
assert.deepEqual(Object.keys(restored.activity), ['restored-event'], 'old Timeline events are not merged');
assert.equal(restored.boards[boardId].syncGeneration, 'reset-one');
assert.equal(race.sql.prepare('SELECT COUNT(*) AS n FROM crdt_ops').get().n, 0, 'old live operation history is removed');
assert.deepEqual((await (await raceCall('/api/board/get')).json()).data.cards.map(c => c.id), ['restored-card']);
for (const generation of [undefined, '', 'older-generation']) {
  assert.equal((await raceCall('/api/crdt/ops/push', { generation, ops: [op('card.create', Date.now() + 1e12, { id: 'resurrected', boardId })] })).status, 409);
}
assert.equal((await raceCall('/api/board/put', { data: { cards: [] } })).status, 409);
assert.deepEqual(await cloudState(), restored, 'old devices cannot resurrect records, even with future timestamps');
assert.equal((await raceCall('/api/crdt/ops/push', { generation: 'reset-one', ops: [op('card.update', Date.now() + 100, { id: 'restored-card', boardId, title: 'After reset' })] })).status, 200);
assert.equal((await reset('reset-one', beforeReset)).status, 200, 'retrying the same reset ID is idempotent');
assert.equal((await cloudState()).cards['restored-card'].title, 'After reset', 'a retry does not wipe post-reset work');
await raceCall('/api/crdt/state/snapshot');
assert.equal((await cloudState()).boards[boardId].syncGeneration, 'reset-one', 'ordinary compaction preserves the generation');

// A queued upload that passed an earlier read is fenced inside its insert transaction.
race.env.flowboard_db.beforeBatch = async ss => {
  if (!ss[0].query.includes('INSERT OR IGNORE INTO crdt_ops')) return;
  race.env.flowboard_db.beforeBatch = null;
  assert.equal((await reset('reset-two')).status, 200);
};
assert.equal((await raceCall('/api/crdt/ops/push', { generation: 'reset-one', ops: [op('card.create', Date.now() + 1e12, { id: 'racy-old-upload', boardId })] })).status, 409);
restored = await cloudState();
assert.equal(restored.boards[boardId].syncGeneration, 'reset-two');
assert.ok(!restored.cards['racy-old-upload']);
const withoutActivity = { ...snapshot };
delete withoutActivity.activity;
assert.equal((await raceCall('/api/crdt/state/replace', { resetId: 'empty-timeline', snapshot: withoutActivity, expected: restored })).status, 200);
assert.deepEqual((await cloudState()).activity, {}, 'a snapshot without activity explicitly resets the Timeline to empty');
const deletedInHistory = { ...snapshot, activity: [{ id: 'future-delete', boardId, cardId: 'restored-card', type: 'deleted', ts: Date.now() + DAY }] };
assert.equal((await raceCall('/api/crdt/state/replace', { resetId: 'restore-over-history', snapshot: deletedInHistory, expected: await cloudState() })).status, 200);
assert.deepEqual((await (await raceCall('/api/crdt/state/get')).json()).data.cards.map(c => c.id), ['restored-card'], 'overwrite is an explicit restore, even over its own delete history');
console.log('overwrite validation, atomic rollback, concurrent-write detection and stale-device fencing passed');

// Existence is decided only by create/delete, so every application order converges.
const lifeOps = [
  op('card.create', 10, { id: 'L', boardId, title: 'created' }),
  op('card.delete', 20, { id: 'L', boardId }),
  op('card.move', 30, { id: 'L', boardId, title: 'stale move', columnId: 'col' }),
  op('card.update', 40, { id: 'L', boardId, title: 'stale edit' }),
];
const orders = xs => xs.length < 2 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
const fold = ops => settle(ops.reduce((state, o) => (applyOp(state, o), state), emptyState()));
for (const ops of [lifeOps, [...lifeOps, op('card.create', 50, { id: 'L', boardId, title: 'Undo' })]]) {
  const expected = fold(ops);
  for (const order of orders(ops)) assert.deepEqual(fold(order), expected, 'every op order converges');
  for (let split = 1; split < ops.length; split++) {
    const [left, right] = [fold(ops.slice(0, split)), fold(ops.slice(split))];
    assert.deepEqual(settle(mergeStates(structuredClone(left), right)), expected, 'merging partial replicas converges');
    assert.deepEqual(settle(mergeStates(structuredClone(right), left)), expected, 'merge order does not matter');
  }
}
assert.deepEqual(materialize(fold(lifeOps)).cards, [], 'newer edits cannot resurrect a deleted card');
assert.equal(materialize(fold([...lifeOps, op('card.create', 50, { id: 'L', boardId, title: 'Undo' })])).cards[0].title, 'Undo', 'an explicit create (Undo) restores');

// Pre-protocol-3 snapshots hold resurrected cards as live rows. The activity log still
// records the deletion, so the cloud heals itself on the next read without a manual merge.
const healed = createDatabase();
const resurrected = emptyState();
resurrected.boards[boardId] = { id: boardId, name: 'Team', createdAt: 1, __ts: 1, __opId: 'b' };
resurrected.cards.Z = { id: 'Z', boardId, title: 'Resurrected', __ts: 30, __opId: 'stale-move', __deleted: false };
resurrected.cards.U = { id: 'U', boardId, title: 'Undone', __ts: 30, __opId: 'undo', __deleted: false };
for (const [id, cardId, type, ts] of [['z-new', 'Z', 'created', 10], ['z-gone', 'Z', 'deleted', 20], ['u-gone', 'U', 'deleted', 20], ['u-undo', 'U', 'created', 25]]) {
  resurrected.activity[id] = { id, boardId, cardId, type, ts, __ts: ts, __opId: id };
}
healed.sql.prepare('INSERT INTO crdt_snapshots VALUES (?, ?, ?, ?)').run(keyHash, JSON.stringify(resurrected), 1, Date.now());
const healedCall = async path => (await worker.fetch(new Request(`https://w${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash }) }), healed.env)).json();
assert.deepEqual((await healedCall('/api/crdt/state/get')).data.cards.map(c => c.id), ['U'], 'logged deletes win; a logged Undo still restores');
assert.deepEqual((await healedCall('/api/board/get')).crdt.cards.map(c => c.id), ['U'], 'rejoining cannot bring the deleted ticket back');
console.log('authoritative deletes: convergence in every order, explicit Undo, and self-healing of resurrected cards passed');
