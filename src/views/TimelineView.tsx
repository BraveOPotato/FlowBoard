import React, { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';

export function TimelineView() {
  const store = useFlowStore();
  const activity = store.activity;
  const cards = store.cards;
  const activeBoardId = store.activeBoardId;
  const showDueOnly = store.showDueDateOnly;
  const query = store.searchQuery.toLowerCase();

  const events = useMemo(() => {
    let evs = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);
    if (showDueOnly) evs = evs.filter((e) => e.type === 'due_set');
    if (query) {
      evs = evs.filter((e) => {
        const card = cards.find((c) => c.id === e.cardId);
        return (
          (e.cardTitle || card?.title || '').toLowerCase().includes(query) ||
          (card?.desc || '').toLowerCase().includes(query) ||
          (card?.tags || []).some((t) => t.toLowerCase().includes(query))
        );
      });
    }
    return evs.sort((a, b) => b.ts - a.ts);
  }, [activity, cards, activeBoardId, showDueOnly, query]);

  const dayKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

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
    const today = new Date();
    if (dayKey(ts) === dayKey(today.getTime())) return 'Today';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div id="timeline-view">
      <div className="tl-header">
        <div>
          <div className="tl-title">Activity</div>
          <div className="tl-subtitle">Board history · scroll down for older events</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className={`cal-nav-btn${showDueOnly ? ' active' : ''}`} onClick={() => store.toggleDueDateOnly()}>
            {showDueOnly ? '◷ All activity' : '◷ Due only'}
          </button>
        </div>
      </div>
      <div className="tl-container">
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🕓</div>
            <div className="empty-state-title">{showDueOnly ? 'No due date activity' : 'No activity yet'}</div>
            <div className="empty-state-text">
              {showDueOnly ? 'Set due dates on cards to see them here' : 'Move, create, or edit cards to build a history'}
            </div>
          </div>
        ) : (
          Array.from(byDay.entries()).map(([dk, dayEvs]) => {
            const isToday = dk === dayKey(Date.now());
            return (
              <div key={dk}>
                <div className={`tl-day-heading${isToday ? ' tl-day-today' : ''}`}>
                  <span className="tl-day-label">{formatDayH(dayEvs[0].ts)}</span>
                  <span className="tl-day-count">
                    {dayEvs.length} event{dayEvs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="tl-day-block">
                  {dayEvs.map((ev, i) => {
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const card = cards.find((c) => c.id === ev.cardId);
                    const cardColor = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    const isLast = i === dayEvs.length - 1;
                    return (
                      <div key={ev.id} className="tl-entry">
                        <div className={`tl-entry-spine${isLast ? ' tl-entry-spine-last' : ''}`}>
                          <div
                            className="tl-entry-dot"
                            style={{
                              background: cardColor,
                              boxShadow: `0 0 0 3px var(--bg2),0 0 0 5px ${cardColor}55`,
                            }}
                          />
                        </div>
                        <div
                          className={`tl-entry-body${card ? ' clickable' : ''}`}
                          onClick={card ? () => store.openModal('card', { card }) : undefined}
                        >
                          <div className="tl-entry-header">
                            <span className="tl-entry-icon" style={{ color: meta.color }}>{meta.icon}</span>
                            <span className="tl-entry-type" style={{ color: meta.color }}>{meta.label}</span>
                            <span className="tl-entry-time">{formatTime(ev.ts)}</span>
                          </div>
                          <div className="tl-entry-desc">
                            {ev.type === 'moved'
                              ? `${ev.cardTitle || card?.title}: ${ev.fromColName || 'Backlog'} → ${ev.toColName || 'Backlog'}`
                              : ev.type === 'created'
                              ? `${ev.cardTitle || card?.title} added to ${ev.toColName || 'Backlog'}`
                              : ev.type === 'deleted'
                              ? `${ev.cardTitle || 'Card'} removed from ${ev.fromColName || 'Backlog'}`
                              : ev.type === 'due_set'
                              ? `${ev.cardTitle || card?.title}: due date set`
                              : `${ev.cardTitle || card?.title} updated`}
                          </div>
                          <div className="tl-entry-footer">
                            {card ? (
                              <span className="tl-entry-card-link">Open card →</span>
                            ) : (
                              <span className="tl-entry-card-deleted">Card no longer exists</span>
                            )}
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
