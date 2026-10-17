// Runs the worker against an in-memory SQLite stand-in for D1: node worker/index.check.js
import assert from 'node:assert/strict';
import worker from './index.js';
import { createDatabase } from './test-db.js';

const { sql, env } = createDatabase();

const keyHash = 'a'.repeat(64);
const boardId = 'b1';
const call = async (path, body = {}) => (await worker.fetch(new Request(`https://w${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash, ...body }) }), env)).json();
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
const raceCall = async (path, body = {}) => worker.fetch(new Request(`https://w${path}`, { method: 'POST', body: JSON.stringify({ boardId, keyHash, ...body }) }), race.env);
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
