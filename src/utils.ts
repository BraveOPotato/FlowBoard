import type { Card } from './types';

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

/** Stable hue (0-359) derived from a string, used to colour tags and board avatars. */
export const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

export const matchesQuery = (c: Card, q: string) =>
  !q || c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q));

/**
 * Moves a card to `targetIndex` within `targetColumnId` (null = backlog) and returns every card
 * whose column or order changed, keyed by id. Orders are re-packed to 0..n-1 in both lists.
 */
export function planMove(cards: Card[], cardId: string, targetColumnId: string | null, targetIndex: number) {
  const updates = new Map<string, Card>();
  const card = cards.find((c) => c.id === cardId);
  if (!card) return updates;
  // Backlog cards share columnId=null across boards, so siblings must be scoped to the board.
  const siblingsOf = (colId: string | null) => cards
    .filter((c) => c.id !== cardId && c.boardId === card.boardId && c.columnId === colId)
    .sort((a, b) => a.order - b.order);
  const reindex = (list: Card[]) => list.forEach((c, i) => {
    if (c.order !== i || c.id === cardId) updates.set(c.id, { ...c, order: i });
  });
  const target = siblingsOf(targetColumnId);
  target.splice(targetIndex, 0, { ...card, columnId: targetColumnId });
  reindex(target);
  if (card.columnId !== targetColumnId) reindex(siblingsOf(card.columnId));
  return updates;
}

export const dayKey = (d: Date | number) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
};

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

/** Parses a 'YYYY-MM-DD' due date as local midnight (new Date() would treat it as UTC and shift the day). */
export const parseDay = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function formatDue(dateStr: string | null): { label: string; state: DueState } | null {
  if (!dateStr) return null;
  const due = parseDay(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: `${-diffDays}d overdue`, state: 'overdue' };
  if (diffDays === 0) return { label: 'Today', state: 'today' };
  if (diffDays === 1) return { label: 'Tomorrow', state: 'soon' };
  if (diffDays <= 3) return { label: `In ${diffDays}d`, state: 'soon' };
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), state: 'later' };
}
