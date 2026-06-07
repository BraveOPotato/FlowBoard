import React, { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';

export function TimelineView() {
  const store = useFlowStore();
  const { activity, cards, activeBoardId, showDueDateOnly: showDueOnly, searchQuery } = store;
  const query = searchQuery.toLowerCase();

  const events = useMemo(() => {
    let evs = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);
    if (showDueOnly) evs = evs.filter((e) => e.type === 'due_set');
    if (query) {
      evs = evs.filter((e) => {
        const card = cards.find((c) => c.id === e.cardId);
        return (e.cardTitle || card?.title || '').toLowerCase().includes(query)
          || (card?.desc || '').toLowerCase().includes(query)
          || (card?.tags || []).some((t) => t.toLowerCase().includes(query));
      });
    }
    return evs.sort((a, b) => b.ts - a.ts);
  }, [activity, cards, activeBoardId, showDueOnly, query]);

  const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const byDay = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const ev of events) {
      const k = dayKey(ev.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    }
    return map;
  }, [events]);

  const formatDayH = (ts: number) => {
    const d = new Date(ts);
    if (dayKey(ts) === dayKey(Date.now())) return 'Today';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const navBtn = `bg-[var(--bg3)] border border-[var(--border)] text-[var(--text2)] px-2.5 py-1 rounded-md cursor-pointer text-xs transition-colors duration-150`;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-5 pt-4 pb-3 flex-shrink-0 border-b border-[var(--border)] max-sm:px-3 max-sm:pt-3 max-sm:pb-2">
        <div>
          <div className="font-[var(--font-display)] text-base font-bold text-[var(--text)]">Activity</div>
          <div className="text-[11px] text-[var(--text3)] mt-0.5">Board history · scroll down for older events</div>
        </div>
        <div className="ml-auto">
          <button
            className={`${navBtn} ${showDueOnly ? 'border-[var(--accent)] text-[var(--accent)]' : 'hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
            onClick={() => store.toggleDueDateOnly()}
          >
            {showDueOnly ? '◷ All activity' : '◷ Due only'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-8 max-w-[860px] mx-auto w-full max-sm:px-3">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-10">
            <div className="text-4xl opacity-40">🕓</div>
            <div className="text-[15px] font-semibold text-[var(--text2)] font-[var(--font-display)]">
              {showDueOnly ? 'No due date activity' : 'No activity yet'}
            </div>
            <div className="text-xs text-[var(--text3)] text-center">
              {showDueOnly ? 'Set due dates on cards to see them here' : 'Move, create, or edit cards to build a history'}
            </div>
          </div>
        ) : (
          Array.from(byDay.entries()).map(([dk, dayEvs]) => {
            const isToday = dk === dayKey(Date.now());
            return (
              <div key={dk}>
                {/* Day heading */}
                <div className="flex items-center justify-between py-4 pb-2 border-b border-[var(--border)] mb-3">
                  <span className={`text-xs font-semibold font-[var(--font-display)] ${isToday ? 'text-[var(--accent2)]' : 'text-[var(--text)]'}`}>
                    {formatDayH(dayEvs[0].ts)}
                  </span>
                  <span className="text-[10px] text-[var(--text3)] font-[var(--font-mono)]">
                    {dayEvs.length} event{dayEvs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Events */}
                <div className="flex flex-col gap-2 mb-4">
                  {dayEvs.map((ev, i) => {
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const card = cards.find((c) => c.id === ev.cardId);
                    const cardColor = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    const isLast = i === dayEvs.length - 1;
                    return (
                      <div key={ev.id} className="flex gap-3">
                        {/* Spine */}
                        <div className={`tl-entry-spine flex flex-col items-center w-4 flex-shrink-0 pt-1 ${isLast ? 'tl-entry-spine-last' : ''}`}>
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: cardColor, boxShadow: `0 0 0 3px var(--bg2),0 0 0 5px ${cardColor}55` }}
                          />
                        </div>
                        {/* Body */}
                        <div
                          className={`flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2.5 transition-colors duration-150 ${card ? 'cursor-pointer hover:border-[var(--border2)]' : ''}`}
                          onClick={card ? () => store.openModal('card', { card }) : undefined}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs" style={{ color: meta.color }}>{meta.icon}</span>
                            <span className="text-[11px] font-semibold font-[var(--font-mono)]" style={{ color: meta.color }}>{meta.label}</span>
                            <span className="text-[10px] text-[var(--text3)] font-[var(--font-mono)] ml-auto">{formatTime(ev.ts)}</span>
                          </div>
                          <div className="text-xs text-[var(--text2)] leading-snug">
                            {ev.type === 'moved' ? `${ev.cardTitle || card?.title}: ${ev.fromColName || 'Backlog'} → ${ev.toColName || 'Backlog'}`
                            : ev.type === 'created' ? `${ev.cardTitle || card?.title} added to ${ev.toColName || 'Backlog'}`
                            : ev.type === 'deleted' ? `${ev.cardTitle || 'Card'} removed from ${ev.fromColName || 'Backlog'}`
                            : ev.type === 'due_set' ? `${ev.cardTitle || card?.title}: due date set`
                            : `${ev.cardTitle || card?.title} updated`}
                          </div>
                          <div className="mt-1.5">
                            {card
                              ? <span className="text-[11px] text-[var(--accent2)] cursor-pointer">Open card →</span>
                              : <span className="text-[11px] text-[var(--text3)]">Card no longer exists</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
