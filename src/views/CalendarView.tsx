import React, { useCallback, useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';
import type { Card, ActivityEvent } from '../types';

export function CalendarView() {
  const store = useFlowStore();
  const calendarDate = store.calendarDate;
  const cards = store.cards;
  const activity = store.activity;
  const activeBoardId = store.activeBoardId;
  const showDueOnly = store.showDueDateOnly;
  const query = store.searchQuery.toLowerCase();

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const boardCards = cards.filter((c) => !activeBoardId || c.boardId === activeBoardId);
  const boardActivity = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);

  const matchesQuery = useCallback(
    (c: Card | undefined, ev: ActivityEvent | undefined) => {
      if (!query) return true;
      const q = query;
      return (
        (c?.title || '').toLowerCase().includes(q) ||
        (c?.desc || '').toLowerCase().includes(q) ||
        (c?.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (ev?.cardTitle || '').toLowerCase().includes(q)
      );
    },
    [query]
  );

  const days = useMemo(() => {
    const cells: Array<
      | { type: 'prev' | 'next'; day: number }
      | {
          type: 'current';
          day: number;
          isToday: boolean;
          seenCards: Map<string, ActivityEvent>;
          dueOnlyCards: Card[];
        }
    > = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ type: 'prev', day: new Date(year, month, -firstDay + i + 1).getDate() });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const dayEvents = boardActivity.filter((e) => {
        if (showDueOnly && e.type !== 'due_set') return false;
        const ed = new Date(e.ts);
        return ed.getFullYear() === year && ed.getMonth() === month && ed.getDate() === d;
      });
      const dayDueCards = showDueOnly
        ? boardCards.filter((c) => {
            if (!c.dueDate) return false;
            const cd = new Date(c.dueDate);
            return cd.getFullYear() === year && cd.getMonth() === month && cd.getDate() === d && matchesQuery(c, undefined);
          })
        : [];

      const priority = { moved: 5, created: 4, due_set: 3, updated: 2, deleted: 1 } as Record<string, number>;
      const seenCards = new Map<string, ActivityEvent>();
      for (const ev of dayEvents) {
        const prev = seenCards.get(ev.cardId);
        if (!prev || (priority[ev.type] || 0) > (priority[prev.type] || 0)) {
          const c = boardCards.find((x) => x.id === ev.cardId);
          if (matchesQuery(c, ev)) seenCards.set(ev.cardId, ev);
        }
      }
      const dueOnlyCards = dayDueCards.filter((c) => !seenCards.has(c.id));
      cells.push({ type: 'current', day: d, isToday, seenCards, dueOnlyCards });
    }
    const total = firstDay + daysInMonth;
    const remaining = total % 7 ? 7 - (total % 7) : 0;
    for (let i = 1; i <= remaining; i++) cells.push({ type: 'next', day: i });
    return cells;
  }, [firstDay, daysInMonth, year, month, boardCards, boardActivity, showDueOnly, matchesQuery]);

  const prevMonth = () => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() - 1);
    store.setCalendarDate(d);
  };
  const nextMonth = () => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() + 1);
    store.setCalendarDate(d);
  };

  return (
    <div id="calendar-view">
      <div className="cal-nav">
        <div className="cal-month-label">{monthLabel}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button className={`cal-nav-btn${showDueOnly ? ' active' : ''}`} onClick={() => store.toggleDueDateOnly()}>
            ◷ Due only
          </button>
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <button className="cal-nav-btn" onClick={() => store.setCalendarDate(new Date())}>Today</button>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
      </div>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="cal-day-header">{d}</div>
        ))}
        {days.map((cell, i) => {
          if (cell.type !== 'current') {
            return (
              <div key={i} className="cal-day other-month">
                <div className="cal-day-num">{cell.day}</div>
              </div>
            );
          }
          const hasEvents = cell.seenCards.size + cell.dueOnlyCards.length > 0;
          return (
            <div
              key={i}
              className={`cal-day${cell.isToday ? ' today' : ''}${hasEvents ? ' has-events' : ''}`}
              onClick={
                hasEvents
                  ? () =>
                      store.openModal('dayDetail', {
                        day: cell.day,
                        month,
                        year,
                        dayEvents: Array.from(cell.seenCards.values()),
                        dayDueCards: cell.dueOnlyCards,
                      })
                  : undefined
              }
            >
              <div className="cal-day-num">{cell.day}</div>
              {hasEvents && (
                <div className="cal-chips">
                  {Array.from(cell.seenCards.values()).map((ev) => {
                    const card = boardCards.find((c) => c.id === ev.cardId);
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const color = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    return <div key={ev.id} className="cal-card-chip" style={{ background: color }} title={card?.title} />;
                  })}
                  {cell.dueOnlyCards.map((card) => (
                    <div
                      key={card.id}
                      className="cal-card-chip"
                      style={{ background: card.color !== 'transparent' ? card.color : 'var(--yellow)', opacity: 0.6 }}
                      title={`${card.title}: Due`}
                    />
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
