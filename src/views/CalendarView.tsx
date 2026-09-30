import { useMemo, type CSSProperties } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';
import { Icon } from '../components/Icon';
import { cx, dayKey, matchesQuery, parseDay } from '../utils';
import type { ActivityEvent, Card } from '../types';
import s from './CalendarView.module.css';
import ui from '../components/ui.module.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;
const RANK: Record<ActivityEvent['type'], number> = { moved: 5, created: 4, due_set: 3, updated: 2, deleted: 1 };

const push = <T,>(map: Map<string, T[]>, key: string, v: T) => { const l = map.get(key); if (l) l.push(v); else map.set(key, [v]); };

export function CalendarView() {
  const calendarDate = useFlowStore((st) => st.calendarDate);
  const cards = useFlowStore((st) => st.cards);
  const activity = useFlowStore((st) => st.activity);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const dueOnly = useFlowStore((st) => st.showDueDateOnly);
  const query = useFlowStore((st) => st.searchQuery).trim().toLowerCase();
  const { setCalendarDate, toggleDueDateOnly, openModal } = useFlowStore.getState();

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const todayKey = dayKey(new Date());

  const { byId, dueByDay, eventsByDay } = useMemo(() => {
    const inBoard = (boardId: string) => !activeBoardId || boardId === activeBoardId;
    const byId = new Map(cards.filter((c) => inBoard(c.boardId)).map((c) => [c.id, c]));
    const dueByDay = new Map<string, Card[]>();
    for (const c of byId.values()) if (c.dueDate && matchesQuery(c, query)) push(dueByDay, dayKey(parseDay(c.dueDate)), c);

    // One entry per card per day, keeping its most significant event.
    const best = new Map<string, ActivityEvent>();
    if (!dueOnly) {
      for (const ev of activity) {
        if (!inBoard(ev.boardId)) continue;
        const card = byId.get(ev.cardId);
        if (query && !(card ? matchesQuery(card, query) : (ev.cardTitle ?? '').toLowerCase().includes(query))) continue;
        const k = `${dayKey(ev.ts)}|${ev.cardId}`;
        const prev = best.get(k);
        if (!prev || RANK[ev.type] > RANK[prev.type]) best.set(k, ev);
      }
    }
    const eventsByDay = new Map<string, ActivityEvent[]>();
    for (const [k, ev] of best) push(eventsByDay, k.split('|')[0], ev);
    return { byId, dueByDay, eventsByDay };
  }, [cards, activity, activeBoardId, dueOnly, query]);

  const firstDay = new Date(year, month, 1).getDay();
  const weeks = Math.ceil((firstDay + new Date(year, month + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(year, month, 1 - firstDay + i));

  const shift = (delta: number) => setCalendarDate(new Date(year, month + delta, 1));
  const colorOf = (c: Card | undefined, fallback: string) => (c?.color && c.color !== 'transparent' ? c.color : fallback);

  return (
    <div className={s.calendar}>
      <div className={s.toolbar}>
        <h2 className={s.month}>
          {calendarDate.toLocaleDateString('en-US', { month: 'long' })} <span>{year}</span>
        </h2>
        <button className={cx(ui.btn, ui.sm, dueOnly ? ui.primary : ui.secondary)} onClick={toggleDueDateOnly} aria-pressed={dueOnly}>
          <Icon name="clock" size={14} /> Due dates only
        </button>
        <div className={s.nav}>
          <button className={cx(ui.iconBtn, ui.small)} onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
          <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => setCalendarDate(new Date())}>Today</button>
          <button className={cx(ui.iconBtn, ui.small)} onClick={() => shift(1)} aria-label="Next month"><Icon name="chevronRight" /></button>
        </div>
      </div>

      <div className={s.weekdays}>
        {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
      </div>

      <div className={s.grid} style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((date) => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === month;
          const due = inMonth ? dueByDay.get(key) ?? [] : [];
          const events = inMonth ? eventsByDay.get(key) ?? [] : [];
          const total = due.length + events.length;
          const chips = [
            ...due.map((c) => ({ id: `d${c.id}`, card: c, title: c.title, color: colorOf(c, 'var(--warning)'), due: true })),
            ...events.map((ev) => {
              const c = byId.get(ev.cardId);
              return { id: ev.id, card: c, title: c?.title ?? ev.cardTitle ?? 'Deleted card', color: colorOf(c, ACTIVITY_META[ev.type]?.color ?? 'var(--fg-subtle)'), due: false };
            }),
          ];
          return (
            <div
              key={key}
              className={cx(s.cell, !inMonth && s.outside, key === todayKey && s.today, total > 0 && s.clickable)}
              onClick={total ? () => openModal('dayDetail', { date, events, dueCards: due }) : undefined}
            >
              <span className={s.dayNum}>{date.getDate()}</span>
              <div className={s.chips}>
                {chips.slice(0, MAX_CHIPS).map((chip) => (
                  <button
                    key={chip.id}
                    className={cx(s.chip, chip.due && s.dueChip)}
                    style={{ '--chip': chip.color } as CSSProperties}
                    title={chip.title}
                    tabIndex={chip.card ? 0 : -1}
                    onClick={(e) => { e.stopPropagation(); if (chip.card) openModal('card', { card: chip.card }); }}
                  >
                    {chip.due ? <Icon name="clock" size={11} strokeWidth={2.2} /> : <i />}
                    <span>{chip.title}</span>
                  </button>
                ))}
                {total > MAX_CHIPS && <span className={s.more}>+{total - MAX_CHIPS} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
