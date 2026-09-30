/// <reference types="node" />
// Run: node src/utils.check.ts
import assert from 'node:assert/strict';
import { formatDue, planMove } from './utils.ts';
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

console.log('utils checks passed');
