import { parseSnapshot, stripMeta, validId, type SyncRecord } from './crdt.ts';
import type { ActivityEvent, Card, FlowState } from '../types';

type BoardExport = Pick<FlowState, 'boards' | 'columns' | 'cards' | 'activity'>;
type Finding = { boardId: string; id: string; reason: string; evidence?: string[]; from?: unknown; to?: unknown };
type Change = Finding & { action: 'delete-card' | 'move-card' | 'restore-card' | 'reindex-card' };
export type RepairDecisions = Record<string, 'keep' | 'delete'>;
const STORES = ['boards', 'columns', 'cards', 'activity'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const group = (card: Card) => JSON.stringify([card.boardId, card.columnId]);

function readExport(value: unknown): BoardExport {
  if (!value || typeof value !== 'object') throw new Error('Expected a FlowBoard JSON export.');
  const result: Record<string, SyncRecord[]> = {};
  for (const store of STORES) {
    const rows = (value as Record<string, unknown>)[store] ?? (store === 'activity' ? [] : undefined);
    if (!Array.isArray(rows)) throw new Error(`Missing ${store} array.`);
    const seen = new Set<string>();
    result[store] = rows.map(row => {
      if (!row || !validId(row.id) || seen.has(row.id) || row.__deleted || store !== 'boards' && !validId(row.boardId)) throw new Error(`Invalid, deleted, or duplicate ${store} record. Use a materialized FlowBoard export.`);
      seen.add(row.id);
      const clean = stripMeta(structuredClone(row));
      delete clean.syncProtocol;
      delete clean.syncGeneration;
      return clean;
    });
  }
  return result as unknown as BoardExport;
}

/** Produce an offline repair candidate, never a live merge or a complete event-log replay. */
export function repairExport(currentValue: unknown, baselineValue?: unknown, decisions: RepairDecisions = {}, options: { deletedUntilRestored?: boolean } = {}) {
  const current = readExport(currentValue);
  const baseline = baselineValue === undefined ? { boards: [], columns: [], cards: [], activity: [] } : readExport(baselineValue);
  const review: Finding[] = [];
  const changes: Change[] = [];
  const quarantined: { store: string; record: unknown; reason: string }[] = [];
  const untrustedEvents = new Set<string>();
  const data = {} as BoardExport;
  for (const store of STORES) {
    const map = new Map<string, SyncRecord>();
    for (const row of baseline[store]) map.set(row.id, row as unknown as SyncRecord);
    for (const row of current[store]) {
      const previous = map.get(row.id);
      if (previous && store !== 'boards' && previous.boardId !== (row as unknown as SyncRecord).boardId) throw new Error(`Record ${row.id} belongs to different boards in the two inputs.`);
      if (previous && store === 'activity' && Object.keys({ ...previous, ...row }).some(k => !same(previous[k], (row as unknown as SyncRecord)[k]))) {
        untrustedEvents.add(row.id);
        review.push({ boardId: String(previous.boardId), id: row.id, reason: 'Conflicting copies of the same activity event; excluded from repair evidence.', from: previous, to: row });
      }
      map.set(row.id, row as unknown as SyncRecord);
    }
    // Array order is not a version. Prefer current payloads by ID, retaining older-only records.
    Object.assign(data, { [store]: [...map.values()] });
  }
  for (const store of ['boards', 'columns'] as const) {
    const ids = new Set(current[store].map(r => r.id));
    for (const row of baseline[store]) if (!ids.has(row.id)) review.push({ boardId: store === 'boards' ? row.id : String((row as unknown as SyncRecord).boardId),
      id: row.id, reason: `Baseline-only ${store === 'boards' ? 'board' : 'column'} retained; no deletion history is available for this record type.` });
  }
  const boards = new Set(data.boards.map(b => b.id));
  for (const store of ['columns', 'cards', 'activity'] as const) {
    Object.assign(data, { [store]: data[store].filter(row => {
      if (boards.has(row.boardId)) return true;
      quarantined.push({ store, record: row, reason: 'No board record exists in either export; retained here, not imported as a phantom board.' });
      return false;
    }) });
  }
  const beforeCards = new Map(baseline.cards.map(c => [c.id, c]));
  const currentCards = new Map(current.cards.map(c => [c.id, c]));
  const baselineEvents = new Set(baseline.activity.map(e => e.id));
  const originalVersions = new Map((currentValue as BoardExport).cards.map(c => [c.id, c as Card & { __ts?: number }]));
  const candidates = new Set(data.cards.map(c => c.id));
  const knownCards = new Set([...candidates, ...data.activity.map(e => e.cardId)]);
  for (const [id, decision] of Object.entries(decisions)) {
    if (!knownCards.has(id) || !['keep', 'delete'].includes(decision)) throw new Error(`Invalid repair decision for card ${id}.`);
  }
  const events = new Map<string, ActivityEvent[]>();
  for (const event of data.activity) {
    if (!validId(event.cardId) || !Number.isSafeInteger(event.ts) || event.ts < 0) throw new Error(`Invalid activity card ID or timestamp: ${event.id}.`);
    if (untrustedEvents.has(event.id)) continue;
    const key = JSON.stringify([event.boardId, event.cardId]);
    const list = events.get(key) ?? [];
    list.push(event);
    events.set(key, list);
  }
  for (const list of events.values()) list.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const touched = new Set<string>();
  const arrivals = new Map<string, number>();
  data.cards = data.cards.filter(card => {
    const decision = Object.hasOwn(decisions, card.id) ? decisions[card.id] : undefined;
    const history = events.get(JSON.stringify([card.boardId, card.id])) ?? [];
    const lifecycle = history.filter(e => e.type === 'created' || e.type === 'deleted');
    const last = lifecycle.at(-1);
    const recordTime = originalVersions.get(card.id)?.__ts ?? 0;
    const newerRecord = !!last && recordTime >= last.ts;
    const laterActions = last?.type === 'deleted' ? history.filter(e => e.ts > last.ts) : [];
    const tiedLifecycle = !!last && lifecycle.some(e => e.ts === last.ts && e.type !== last.type);
    const baselineContradiction = last?.type === 'deleted' && beforeCards.has(card.id) && baselineEvents.has(last.id);
    const ambiguousDelete = last?.type === 'deleted' && (laterActions.length > 0 || tiedLifecycle || baselineContradiction || newerRecord);
    // ponytail: audit-only heuristic, not a full operation replay; unlogged restores
    // require review. The stronger deletion policy is opt-in, never background sync.
    const policyDelete = options.deletedUntilRestored && last?.type === 'deleted' && !tiedLifecycle && !newerRecord;
    const remove = decision === 'delete' || decision !== 'keep'
      && (policyDelete || last?.type === 'deleted' && !ambiguousDelete);
    if (remove) {
      changes.push({ action: 'delete-card', boardId: card.boardId, id: card.id,
        reason: decision === 'delete' ? 'User-approved deletion.' : policyDelete
          ? 'Opt-in policy: deletion remains effective until an explicit create/Undo event.' : 'Latest lifecycle event is a deletion, with no later activity or restoration.',
        evidence: last ? [last.id, ...laterActions.map(e => e.id)] : [] });
      touched.add(group(card));
      return false;
    }
    if ((ambiguousDelete || tiedLifecycle) && !decision) review.push({ boardId: card.boardId, id: card.id,
      reason: 'Deletion conflicts with later activity, the trusted baseline, an equal-time restore, or a newer record. Preserved pending review.',
      evidence: [last!.id, ...laterActions.map(e => e.id)] });
    const previous = beforeCards.get(card.id);
    if (previous && currentCards.has(card.id)) {
      const fields = new Set([...Object.keys(previous), ...Object.keys(card)]);
      for (const field of fields) {
        if (['order', 'columnId'].includes(field)) continue;
        const oldValue = (previous as unknown as Record<string, unknown>)[field];
        const newValue = (card as unknown as Record<string, unknown>)[field];
        if (!same(oldValue, newValue)) review.push({ boardId: card.boardId, id: card.id,
          reason: `Conflicting ${field}; retained the current payload. Activity does not contain a complete edit payload.`, from: oldValue, to: newValue });
      }
    }
    if (!currentCards.has(card.id)) {
      changes.push({ action: 'restore-card', boardId: card.boardId, id: card.id, reason: 'Record is available only in the baseline.' });
      review.push({ boardId: card.boardId, id: card.id, reason: 'Baseline-only card retained; a missing current row alone does not prove a deletion.' });
      touched.add(group(card));
      arrivals.set(card.id, card.createdAt);
    }
    const position = history.filter(e => Object.hasOwn(e, 'toColId')).at(-1);
    if (position && position.toColId !== card.columnId && (!tiedLifecycle || decision)) {
      const target = position.toColId;
      const tied = history.some(e => e.ts === position.ts && Object.hasOwn(e, 'toColId') && e.toColId !== target);
      if (tied || recordTime >= position.ts || history.some(e => e.ts > position.ts && e.type !== 'deleted')
        || target !== null && !data.columns.some(c => c.id === target && c.boardId === card.boardId)) {
        review.push({ boardId: card.boardId, id: card.id, reason: 'Position evidence is ambiguous, older than the record, or references a missing column.', evidence: [position.id] });
      } else {
        touched.add(group(card));
        changes.push({ action: 'move-card', boardId: card.boardId, id: card.id, reason: 'Latest recorded destination differs from the stored card.',
          from: card.columnId, to: target, evidence: [position.id] });
        card.columnId = target!;
        touched.add(group(card));
        arrivals.set(card.id, position.ts);
      }
    }
    return true;
  });
  // Activity has no within-column indexes. Keep resident order; append repaired arrivals
  // by event time, then compact only affected columns. Exact historical ordering is unknown.
  for (const key of touched) {
    const cards = data.cards.filter(c => group(c) === key).sort((a, b) =>
      Number(arrivals.has(a.id)) - Number(arrivals.has(b.id))
      || (arrivals.get(a.id) ?? a.order) - (arrivals.get(b.id) ?? b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    cards.forEach((card, index) => {
      if (card.order !== index) changes.push({ action: 'reindex-card', boardId: card.boardId, id: card.id,
        reason: 'Compacted affected column order; no historical drag index is available.', from: card.order, to: index });
      card.order = index;
    });
  }
  for (const history of events.values()) {
    const id = history[0].cardId;
    const lifecycle = history.filter(e => e.type === 'created' || e.type === 'deleted');
    const last = lifecycle.at(-1);
    const expectedDeletion = Object.hasOwn(decisions, id) && decisions[id] === 'delete'
      || options.deletedUntilRestored && last?.type === 'deleted' && !lifecycle.some(e => e.ts === last.ts && e.type === 'created');
    if (!candidates.has(id) && history.at(-1)?.type !== 'deleted' && !expectedDeletion) review.push({ boardId: history[0].boardId, id,
      reason: 'Activity refers to a missing card without a terminal delete. Full card contents cannot be recreated from activity.' });
  }
  for (const board of data.boards) parseSnapshot(data, board.id);
  const summary = data.boards.map(board => ({ boardId: board.id, name: board.name,
    beforeCards: baseline.cards.filter(c => c.boardId === board.id).length,
    currentCards: current.cards.filter(c => c.boardId === board.id).length,
    repairedCards: data.cards.filter(c => c.boardId === board.id).length,
    deletedCards: changes.filter(c => c.boardId === board.id && c.action === 'delete-card').length,
    movedCards: changes.filter(c => c.boardId === board.id && c.action === 'move-card').length,
    cardsWithoutActivity: data.cards.filter(c => c.boardId === board.id && !events.has(JSON.stringify([c.boardId, c.id]))).length,
    reviewItems: review.filter(c => c.boardId === board.id).length }));
  return { data, report: { summary, decisions, deletionPolicy: options.deletedUntilRestored ? 'deleted-unless-restored' : 'review-conflicts', changes, review, quarantined,
    limitations: ['Activity is a partial audit trail, not the complete sync operation log.',
      'No activity or absence from a snapshot is not proof of deletion. Imported/archived cards without activity are retained.',
      'Descriptions, tags, priorities, checklists, and exact within-column ordering cannot be reconstructed from activity.',
      'Export dates are not sync watermarks: an earlier export can be missing changes already made on another device.'] } };
}
