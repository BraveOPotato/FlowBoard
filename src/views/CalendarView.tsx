import React, { useCallback, useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';
import type { Card, ActivityEvent } from '../types';

export function CalendarView() {
  const store = useFlowStore();
  const { calendarDate, cards, activity, activeBoardId, showDueDateOnly: showDueOnly, searchQuery } = store;
  const query = searchQuery.toLowerCase();
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const boardCards = cards.filter((c) => !activeBoardId || c.boardId === activeBoardId);
  const boardActivity = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);

  const matchesQuery = useCallback((c: Card | undefined, ev: ActivityEvent | undefined) => {
    if (!query) return true;
    return (c?.title || '').toLowerCase().includes(query) || (c?.desc || '').toLowerCase().includes(query)
      || (c?.tags || []).some((t) => t.toLowerCase().includes(query)) || (ev?.cardTitle || '').toLowerCase().includes(query);
  }, [query]);

  const days = useMemo(() => {
    const cells: Array<{ type: 'prev' | 'next'; day: number } | { type: 'current'; day: number; isToday: boolean; seenCards: Map<string, ActivityEvent>; dueOnlyCards: Card[] }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ type: 'prev', day: new Date(year, month, -firstDay + i + 1).getDate() });
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const dayEvents = boardActivity.filter((e) => {
        if (showDueOnly && e.type !== 'due_set') return false;
        const ed = new Date(e.ts);
        return ed.getFullYear() === year && ed.getMonth() === month && ed.getDate() === d;
      });
      const dayDueCards = showDueOnly ? boardCards.filter((c) => {
        if (!c.dueDate) return false;
        const cd = new Date(c.dueDate);
        return cd.getFullYear() === year && cd.getMonth() === month && cd.getDate() === d && matchesQuery(c, undefined);
      }) : [];
      const priority = { moved: 5, created: 4, due_set: 3, updated: 2, deleted: 1 } as Record<string, number>;
      const seenCards = new Map<string, ActivityEvent>();
      for (const ev of dayEvents) {
        const prev = seenCards.get(ev.cardId);
        if (!prev || (priority[ev.type] || 0) > (priority[prev.type] || 0)) {
          const c = boardCards.find((x) => x.id === ev.cardId);
          if (matchesQuery(c, ev)) seenCards.set(ev.cardId, ev);
        }
      }
      cells.push({ type: 'current', day: d, isToday, seenCards, dueOnlyCards: dayDueCards.filter((c) => !seenCards.has(c.id)) });
    }
    const total = firstDay + daysInMonth;
    const remaining = total % 7 ? 7 - (total % 7) : 0;
    for (let i = 1; i <= remaining; i++) cells.push({ type: 'next', day: i });
    return cells;
  }, [firstDay, daysInMonth, year, month, boardCards, boardActivity, showDueOnly, matchesQuery]);

  const prevMonth = () => { const d = new Date(calendarDate); d.setMonth(d.getMonth() - 1); store.setCalendarDate(d); };
  const nextMonth = () => { const d = new Date(calendarDate); d.setMonth(d.getMonth() + 1); store.setCalendarDate(d); };
  const navBtn = (active?: boolean) =>
    `bg-[var(--bg3)] border border-[var(--border)] text-[var(--text2)] px-2.5 py-1 rounded-md cursor-pointer text-xs transition-colors duration-150 ${active ? 'border-[var(--accent)] text-[var(--accent)]' : 'hover:border-[var(--accent)] hover:text-[var(--accent)]'}`;

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Nav */}
      <div className="flex items-center mb-3 gap-2">
        <div className="font-[var(--font-display)] text-lg font-bold text-[var(--text)] flex-1">{monthLabel}</div>
        <div className="flex gap-2 ml-auto">
          <button className={navBtn(showDueOnly)} onClick={() => store.toggleDueDateOnly()}>◷ Due only</button>
          <button className={navBtn()} onClick={prevMonth}>‹</button>
          <button className={navBtn()} onClick={() => store.setCalendarDate(new Date())}>Today</button>
          <button className={navBtn()} onClick={nextMonth}>›</button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5 flex-1 overflow-auto">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-[10px] font-semibold tracking-wider text-[var(--text3)] font-[var(--font-mono)] text-center py-1.5 bg-[var(--bg2)] sticky top-0">
            {d}
          </div>
        ))}
        {days.map((cell, i) => {
          if (cell.type !== 'current') {
            return (
              <div key={i} className="bg-[var(--bg2)] border border-[var(--border)] rounded-md p-1.5 min-h-[72px] opacity-40 max-sm:min-h-[52px] max-sm:p-1">
                <div className="text-[11px] text-[var(--text3)] font-[var(--font-mono)] mb-1 max-sm:text-[10px]">{cell.day}</div>
              </div>
            );
          }
          const hasEvents = cell.seenCards.size + cell.dueOnlyCards.length > 0;
          return (
            <div
              key={i}
              className={`border rounded-md p-1.5 min-h-[72px] transition-colors duration-150 max-sm:min-h-[52px] max-sm:p-1 ${
                cell.isToday ? 'border-[var(--accent)] bg-[var(--accent-glow)]' : 'bg-[var(--surface)] border-[var(--border)]'
              } ${hasEvents ? 'cursor-pointer hover:border-[var(--border2)]' : ''}`}
              onClick={hasEvents ? () => store.openModal('dayDetail', {
                day: cell.day, month, year,
                dayEvents: Array.from(cell.seenCards.values()),
                dayDueCards: cell.dueOnlyCards,
              }) : undefined}
            >
              <div className="text-[11px] text-[var(--text3)] font-[var(--font-mono)] mb-1 max-sm:text-[10px]">{cell.day}</div>
              {hasEvents && (
                <div className="flex gap-[3px] flex-wrap">
                  {Array.from(cell.seenCards.values()).map((ev) => {
                    const card = boardCards.find((c) => c.id === ev.cardId);
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const color = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    return <div key={ev.id} className="w-3 h-3 rounded-[3px]" style={{ background: color }} title={card?.title} />;
                  })}
                  {cell.dueOnlyCards.map((card) => (
                    <div key={card.id} className="w-3 h-3 rounded-[3px] opacity-60" style={{ background: card.color !== 'transparent' ? card.color : 'var(--yellow)' }} title={`${card.title}: Due`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
