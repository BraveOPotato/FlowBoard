import type { CrdtOp } from '../types';

export type SyncRecord = { id: string; __ts?: number; __opId?: string; __deleted?: boolean; [key: string]: unknown };
export type CrdtState = Record<'boards' | 'columns' | 'cards' | 'activity', Record<string, SyncRecord>>;
export const emptyState = (): CrdtState => ({ boards: {}, columns: {}, cards: {}, activity: {} });
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
      && (store === 'boards' ? id === boardId : r.boardId === boardId || r.__deleted && r.boardId === undefined));
  });
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
