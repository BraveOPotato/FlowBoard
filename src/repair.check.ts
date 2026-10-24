// Offline repair checks: node src/repair.check.ts. No production exports or fixtures needed.
import assert from 'node:assert/strict';
import { repairExport } from './services/repair.ts';
import type { ActivityEvent, Card } from './types';

const board = { id: 'board', name: 'Board', createdAt: 1 };
const columns = ['todo', 'done'].map((id, order) => ({ id, boardId: board.id, name: id, color: '#888888', order }));
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, boardId: board.id, title: id, desc: 'Keep these details',
  tags: ['important'], priority: 'medium', color: 'transparent', dueDate: null, checklist: [{ id: 'check', title: 'Preserve checklist', done: true }],
  createdAt: 1, columnId: 'todo', order: 0, ...extra });
const event = (id: string, cardId: string, type: ActivityEvent['type'], ts: number, extra: Partial<ActivityEvent> = {}): ActivityEvent =>
  ({ id, cardId, boardId: board.id, type, ts, cardTitle: cardId, ...extra });
const deleted = event('delete-old', 'old', 'deleted', 20);
const baseline = { boards: [board], columns, cards: [card('shared'), card('ambiguous'), card('lost')],
  activity: [event('create-shared', 'shared', 'created', 1, { toColId: 'todo' })] };
const current = { boards: [board, { ...board, id: 'other', name: 'Other board' }],
  columns: [...columns, { ...columns[0], id: 'orphan', boardId: 'removed-board' }, { ...columns[0], id: 'other-todo', boardId: 'other' }],
  cards: [card('shared'), card('old'), card('ambiguous'), card('new'), card('old-title', { title: 'Same title' }),
    card('new-title', { title: 'Same title' }), card('imported-without-history', { boardId: 'other', columnId: 'other-todo' })],
  activity: [...baseline.activity, deleted, event('move-shared', 'shared', 'moved', 30, { toColId: 'done' }),
    event('delete-ambiguous', 'ambiguous', 'deleted', 20), event('move-ambiguous', 'ambiguous', 'moved', 30, { toColId: 'done' }),
    event('create-new', 'new', 'created', 40, { toColId: 'todo' }), event('delete-title', 'old-title', 'deleted', 20)] };
const originalCurrent = JSON.stringify(current), originalBaseline = JSON.stringify(baseline);
const { data, report } = repairExport(current, baseline, { ambiguous: 'delete' });
assert.equal(JSON.stringify(current), originalCurrent, 'never mutate the current export');
assert.equal(JSON.stringify(baseline), originalBaseline, 'never mutate the baseline');
assert.ok(!data.cards.some(c => ['old', 'ambiguous', 'old-title'].includes(c.id)));
assert.ok(data.cards.some(c => c.id === 'new-title'), 'do not deduplicate or delete by matching titles');
assert.ok(data.cards.some(c => c.id === 'new'), 'keep new work');
assert.ok(data.cards.some(c => c.id === 'lost'), 'retain a full baseline-only record, with review');
assert.equal(data.cards.find(c => c.id === 'shared')!.columnId, 'done');
assert.deepEqual(data.cards.find(c => c.id === 'shared')!.checklist, baseline.cards[0].checklist);
assert.equal(data.cards.find(c => c.id === 'shared')!.desc, baseline.cards[0].desc);
assert.equal(data.activity.length, current.activity.length, 'retain the full audit trail, including deletion evidence');
assert.equal(report.quarantined.length, 1, 'quarantine orphaned records instead of inventing a board');
assert.deepEqual(data.cards.find(c => c.boardId === 'other'), current.cards.find(c => c.boardId === 'other'), 'unaffected boards are unchanged');
assert.ok(report.review.some(r => r.id === 'lost'));
assert.deepEqual(repairExport(data).data, data, 'repair is idempotent');
assert.deepEqual(repairExport(data, undefined, { ambiguous: 'delete' }).data, data, 'an already-applied decision remains valid when its card exists only in activity');

const noBaseline = repairExport(current);
assert.ok(!noBaseline.data.cards.some(c => c.id === 'old'), 'terminal deletions can be recovered from a single corrupted export');
assert.ok(noBaseline.data.cards.some(c => c.id === 'ambiguous'), 'do not silently delete after contradictory post-delete activity');
assert.ok(noBaseline.report.review.some(r => r.id === 'ambiguous'));
const stickyDeletes = repairExport(current, baseline, {}, { deletedUntilRestored: true });
assert.ok(!stickyDeletes.data.cards.some(c => c.id === 'ambiguous'), 'opt-in deletion policy handles resurrection without manually merging files');
assert.equal(repairExport(stickyDeletes.data, undefined, {}, { deletedUntilRestored: true }).report.review.length, 0, 'do not flag intentionally deleted records as missing content on a repeat repair');
assert.ok(repairExport(current, baseline, { ambiguous: 'keep' }, { deletedUntilRestored: true }).data.cards.some(c => c.id === 'ambiguous'), 'an explicit keep overrides the optional deletion policy');
const trusted = { ...baseline, cards: [card('old')], activity: [deleted] };
assert.ok(repairExport(current, trusted).data.cards.some(c => c.id === 'old'), 'a trusted baseline can prove the audit trail is incomplete');
assert.ok(!repairExport(current, trusted, { old: 'delete' }).data.cards.some(c => c.id === 'old'), 'an explicit decision resolves the baseline conflict');

const restored = { ...current, activity: [...current.activity, event('undo-old', 'old', 'created', 50, { toColId: 'done' })] };
assert.equal(repairExport(restored).data.cards.find(c => c.id === 'old')!.columnId, 'done', 'a later explicit Undo/create restores the card');
assert.ok(repairExport(restored, undefined, {}, { deletedUntilRestored: true }).data.cards.some(c => c.id === 'old'), 'the deletion policy respects explicit Undo');
const newVersion = { ...current, cards: current.cards.map(c => c.id === 'old' ? { ...c, __ts: 100 } : c) };
assert.ok(repairExport(newVersion).data.cards.some(c => c.id === 'old'), 'do not overrule a newer versioned record with an older audit event');
assert.ok(repairExport(newVersion, undefined, {}, { deletedUntilRestored: true }).data.cards.some(c => c.id === 'old'), 'the stronger deletion policy still defers to newer record metadata');

const conflict = { ...baseline, activity: [event('move-shared', 'shared', 'moved', 30, { toColId: 'todo' })] };
const conflictingEvents = repairExport(current, conflict);
assert.ok(conflictingEvents.report.review.some(r => r.id === 'move-shared'));
assert.equal(conflictingEvents.data.cards.find(c => c.id === 'shared')!.columnId, 'todo', 'conflicting immutable events are not repair evidence');
const contentChange = { ...current, cards: current.cards.map(c => c.id === 'shared' ? { ...c, desc: 'Later description' } : c) };
const contentResult = repairExport(contentChange, baseline);
assert.equal(contentResult.data.cards.find(c => c.id === 'shared')!.desc, 'Later description');
assert.ok(contentResult.report.review.some(r => r.id === 'shared' && r.reason.includes('desc')), 'report unknown full-payload conflicts rather than guessing');

const tied = { ...current, activity: [...current.activity, event('zz-restore', 'old', 'created', deleted.ts, { toColId: 'done' })] };
assert.ok(repairExport(tied).report.review.some(r => r.id === 'old'), 'equal-time lifecycle conflicts always require review');
const foreign = { ...current, activity: [...current.activity, event('foreign-delete', 'shared', 'deleted', 100, { boardId: 'other' })] };
assert.ok(repairExport(foreign).data.cards.some(c => c.id === 'shared'), 'scope repair evidence by both board ID and card ID');
for (const bad of [{}, { ...current, cards: [...current.cards, current.cards[0]] },
  { ...current, cards: [{ ...current.cards[0], __deleted: true }] }]) assert.throws(() => repairExport(bad));
assert.throws(() => repairExport(current, baseline, { typo: 'delete' }));
console.log('offline repair checks passed: replay evidence, explicit decisions, Undo, ambiguity, preservation, scope and idempotence');
