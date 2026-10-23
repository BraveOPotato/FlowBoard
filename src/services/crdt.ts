import type { CrdtOp } from '../types';

export const SYNC_PROTOCOL = 2;
export type SyncRecord = { id: string; __ts?: number; __opId?: string; __deleted?: boolean; [key: string]: unknown };
export type CrdtState = Record<'boards' | 'columns' | 'cards' | 'activity', Record<string, SyncRecord>>;
export const emptyState = (): CrdtState => ({ boards: {}, columns: {}, cards: {}, activity: {} });
export const generationOf = (state: CrdtState | null | undefined, boardId: string): string =>
  typeof state?.boards[boardId]?.syncGeneration === 'string' ? state.boards[boardId].syncGeneration as string : '';
export const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(id);
export const opStore = (type: string): keyof CrdtState | undefined => {
  if (type === 'board.update') return 'boards';
  if (['column.create', 'column.update', 'column.delete'].includes(type)) return 'columns';
  if (['card.create', 'card.update', 'card.move', 'card.delete'].includes(type)) return 'cards';
  if (type === 'activity.create') return 'activity';
};

export function validOp(op: CrdtOp, boardId: string) {
  if (!op || !validId(op.opId) || !opStore(op.type) || !Number.isSafeInteger(op.ts) || op.ts < 0) return false;
  if (op.clientId != null && (typeof op.clientId !== 'string' || op.clientId.length > 256)) return false;
  const p = op.payload;
  return !!p && typeof p === 'object' && !Array.isArray(p) && validId(p.id ?? p.boardId)
    && (p.boardId === undefined || p.boardId === boardId)
    && (op.type !== 'board.update' || p.boardId === boardId && (p.id === undefined || p.id === boardId));
}

// Record-level LWW. An op ID breaks equal-clock ties identically on every device and after GC.
export const newer = (a: SyncRecord, b?: SyncRecord) => !b || (a.__ts ?? 0) > (b.__ts ?? 0)
  || (a.__ts ?? 0) === (b.__ts ?? 0) && (a.__opId ?? '') > (b.__opId ?? '');

export function applyOp(state: CrdtState, op: CrdtOp) {
  const store = opStore(op.type);
  if (!store) return;
  const id = String(op.type === 'board.update' ? op.payload.boardId : op.payload.id);
  const existing = Object.hasOwn(state[store], id) ? state[store][id] : undefined;
  const incoming: SyncRecord = { ...op.payload, id, __ts: op.ts, __opId: op.opId, __deleted: op.type.endsWith('.delete') };
  if (newer(incoming, existing)) state[store][id] = { ...existing, ...incoming };
}

export function mergeStates(local: CrdtState, remote: CrdtState): CrdtState {
  for (const store of Object.keys(local) as (keyof CrdtState)[]) {
    for (const row of Object.values(remote[store])) {
      const existing = Object.hasOwn(local[store], row.id) ? local[store][row.id] : undefined;
      if (newer(row, existing)) local[store][row.id] = { ...existing, ...row };
    }
  }
  return local;
}

export function validState(value: unknown, boardId: string): value is CrdtState {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(emptyState()).every((store) => {
    const map = (value as CrdtState)[store as keyof CrdtState];
    return map && typeof map === 'object' && !Array.isArray(map) && Object.entries(map).every(([id, r]) =>
      validId(id) && r && r.id === id && Number.isSafeInteger(r.__ts) && r.__ts! >= 0
      && (r.__opId === undefined || typeof r.__opId === 'string')
      && (store === 'boards' ? id === boardId && (r.syncGeneration === undefined || validId(r.syncGeneration))
        : r.boardId === boardId || r.__deleted && r.boardId === undefined));
  });
}

// Overwrite is deliberately stricter than the additive legacy importer: a malformed
// or wrong-board file must never be interpreted as an empty replacement board.
export function parseSnapshot(data: unknown, boardId: string): CrdtState {
  if (!data || typeof data !== 'object' || !validId(boardId)) throw new Error('Choose a FlowBoard JSON snapshot.');
  const state = emptyState();
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const store of Object.keys(state) as (keyof CrdtState)[]) {
    const rows = (data as Record<string, unknown>)[store] ?? (store === 'activity' ? [] : undefined);
    if (!Array.isArray(rows)) throw new Error(`The snapshot must contain a ${store} array.`);
    for (const value of rows) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid snapshot record.');
      const row = value as SyncRecord;
      if (!validId(row.id) || store !== 'boards' && !validId(row.boardId)) throw new Error('Invalid snapshot record ID or board ID.');
      if (store === 'boards' ? row.id !== boardId : row.boardId !== boardId) continue;
      if (!validId(row.id) || Object.hasOwn(state[store], row.id) || row.__deleted) throw new Error('Invalid or duplicate snapshot record.');
      if (store === 'boards' && (typeof row.name !== 'string' || !number(row.createdAt))) throw new Error('Invalid snapshot board.');
      if (store === 'columns' && (typeof row.name !== 'string' || typeof row.color !== 'string' || !number(row.order))) throw new Error('Invalid snapshot column.');
      if (store === 'cards' && (typeof row.title !== 'string' || typeof row.desc !== 'string' || typeof row.color !== 'string'
        || !Array.isArray(row.tags) || !row.tags.every(t => typeof t === 'string')
        || !['low', 'medium', 'high'].includes(String(row.priority)) || !number(row.order) || !number(row.createdAt)
        || !(row.dueDate === null || typeof row.dueDate === 'string')
        || !(row.columnId === null || validId(row.columnId))
        || row.checklist !== undefined && (!Array.isArray(row.checklist) || !row.checklist.every(c => c && validId(c.id) && typeof c.title === 'string' && typeof c.done === 'boolean')))) {
        throw new Error('Invalid snapshot card.');
      }
      if (store === 'activity' && (!validId(row.cardId) || !number(row.ts)
        || !['created', 'moved', 'updated', 'deleted', 'due_set'].includes(String(row.type)))) throw new Error('Invalid snapshot activity.');
      const fields = stripMeta(row);
      delete fields.syncGeneration;
      delete fields.syncProtocol;
      state[store][row.id] = { ...fields, __ts: 0, __opId: '' };
    }
  }
  if (!state.boards[boardId]) throw new Error('This snapshot does not contain the selected board. Select the matching board or a different snapshot.');
  if (Object.values(state.cards).some(c => c.columnId !== null && !Object.hasOwn(state.columns, String(c.columnId)))) throw new Error('A snapshot card refers to a missing column.');
  return state;
}

export function materialize(state: CrdtState) {
  const clean = (map: Record<string, SyncRecord>) => Object.values(map).filter((r) => !r.__deleted)
    .map(stripMeta);
  return {
    boards: clean(state.boards), columns: clean(state.columns), cards: clean(state.cards), activity: clean(state.activity),
    deleted: [...Object.values(state.columns), ...Object.values(state.cards)].filter((r) => r.__deleted).map((r) => r.id),
  };
}

export function stripMeta(record: SyncRecord) {
  const row = { ...record };
  delete row.__ts;
  delete row.__opId;
  delete row.__deleted;
  return row;
}
