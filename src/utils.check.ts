/// <reference types="node" />
// Run: node src/utils.check.ts
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, formatDue, hasFilters, matchesCard, planMove } from './utils.ts';
import type { Card } from './types';

const card = (id: string, boardId: string, columnId: string | null, order: number) =>
  ({ id, boardId, columnId, order, title: id, desc: '', tags: [], color: 'transparent', priority: 'medium', dueDate: null, createdAt: 0 }) as Card;

const cards = [
  card('a', 'b1', 'todo', 0), card('b', 'b1', 'todo', 1), card('c', 'b1', 'todo', 2),
  card('x', 'b1', null, 0), card('y', 'b1', null, 1),
  card('other', 'b2', null, 0),
];
const apply = (u: Map<string, Card>) => cards.map((c) => u.get(c.id) ?? c);
const order = (list: Card[], boardId: string, col: string | null) =>
  list.filter((c) => c.boardId === boardId && c.columnId === col).sort((p, q) => p.order - q.order).map((c) => c.id);

// Reorder within a column.
assert.deepEqual(order(apply(planMove(cards, 'a', 'todo', 2)), 'b1', 'todo'), ['b', 'c', 'a']);

// Column → backlog, then both lists are re-packed.
const moved = apply(planMove(cards, 'b', null, 1));
assert.deepEqual(order(moved, 'b1', null), ['x', 'b', 'y']);
assert.deepEqual(order(moved, 'b1', 'todo'), ['a', 'c']);
assert.deepEqual(moved.filter((c) => c.boardId === 'b1').map((c) => c.order).sort(), [0, 0, 1, 1, 2]);

// Another board's backlog card is never touched.
assert.equal(planMove(cards, 'b', null, 0).has('other'), false);

// Due dates are calendar days in local time.
const d = new Date();
const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
assert.equal(formatDue(iso)?.state, 'today');

// Filters combine (AND), search is case-insensitive, and checklists are searchable.
const sample: Card = { ...cards[0], title: 'Review launch', priority: 'high', tags: ['Design'], dueDate: '2026-03-09', checklist: [{ id: 'task', title: 'Check contrast', done: false }] };
const now = new Date(2026, 2, 9, 23, 45);
assert.equal(matchesCard(sample, '  CONTRAST  ', { ...DEFAULT_FILTERS, priority: 'high', tag: 'Design', due: 'today', columnId: 'todo' }, now), true);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, priority: 'low', tag: 'Design' }, now), false);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, tag: 'Engineering' }, now), false);
assert.equal(matchesCard(sample, '', { ...DEFAULT_FILTERS, columnId: 'backlog' }, now), false);
assert.equal(matchesCard({ ...sample, columnId: null }, '', { ...DEFAULT_FILTERS, columnId: 'backlog' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: null }, '', { ...DEFAULT_FILTERS, due: 'none' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: null }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), false);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-08' }, '', { ...DEFAULT_FILTERS, due: 'overdue' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-16' }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), true);
assert.equal(matchesCard({ ...sample, dueDate: '2026-03-17' }, '', { ...DEFAULT_FILTERS, due: 'week' }, now), false);
assert.equal(hasFilters(DEFAULT_FILTERS), false);
assert.equal(hasFilters({ ...DEFAULT_FILTERS, tag: 'Design' }), true);

// Undo insertion preserves the original position and repacks sibling orders after a deletion.
const removed = cards.filter((c) => c.id !== 'b');
const restoredUpdates = planMove([...removed, cards[1]], 'b', 'todo', 1);
const restored = [...removed, cards[1]].map((c) => restoredUpdates.get(c.id) ?? c);
assert.deepEqual(order(restored, 'b1', 'todo'), ['a', 'b', 'c']);
assert.equal(restoredUpdates.has('other'), false);

console.log('utils checks passed');
