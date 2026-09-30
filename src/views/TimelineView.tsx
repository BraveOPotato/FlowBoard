import { useMemo, type ReactNode } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';
import { Icon } from '../components/Icon';
import { cx, dayKey, hasFilters, matchesCard } from '../utils';
import type { ActivityEvent } from '../types';
import s from './TimelineView.module.css';
import ui from '../components/ui.module.css';

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function describe(ev: ActivityEvent, title: string): ReactNode {
  const t = <strong>{title}</strong>;
  const col = (name?: string) => <span className={s.col}>{name || 'Backlog'}</span>;
  switch (ev.type) {
    case 'moved': return <>{t} moved from {col(ev.fromColName)} to {col(ev.toColName)}</>;
    case 'created': return <>{t} created in {col(ev.toColName)}</>;
    case 'deleted': return <>{t} deleted from {col(ev.fromColName)}</>;
    case 'due_set': return <>{t} due date {ev.dueDate ? <>set to <span className={s.col}>{ev.dueDate}</span></> : 'cleared'}</>;
    default: return <>{t} updated</>;
  }
}

export function TimelineView() {
  const activity = useFlowStore((st) => st.activity);
  const cards = useFlowStore((st) => st.cards);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const dueOnly = useFlowStore((st) => st.showDueDateOnly);
  const query = useFlowStore((st) => st.searchQuery).trim().toLowerCase();
  const filters = useFlowStore((st) => st.filters);
  const { toggleDueDateOnly, openModal } = useFlowStore.getState();
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const days = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    const evs = activity
      .filter((e) => (!activeBoardId || e.boardId === activeBoardId) && (!dueOnly || e.type === 'due_set'))
      .filter((e) => {
        const card = cardsById.get(e.cardId);
        return card ? matchesCard(card, query, filters) : !hasFilters(filters) && (!query || (e.cardTitle ?? '').toLowerCase().includes(query));
      })
      .sort((a, b) => b.ts - a.ts);
    for (const ev of evs) {
      const k = dayKey(ev.ts);
      const list = map.get(k);
      if (list) list.push(ev); else map.set(k, [ev]);
    }
    return [...map.entries()];
  }, [activity, cardsById, activeBoardId, dueOnly, query, filters]);

  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const dayLabel = (k: string, ts: number) =>
    k === todayKey ? 'Today' : k === yesterdayKey ? 'Yesterday' : new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className={s.timeline}>
      <div className={s.inner}>
        <div className={s.toolbar}>
          <div>
            <h2>Activity</h2>
            <p>Everything that happened on this board, newest first.</p>
          </div>
          <button className={cx(ui.btn, ui.sm, dueOnly ? ui.primary : ui.secondary)} onClick={toggleDueDateOnly} aria-pressed={dueOnly}>
            <Icon name="clock" size={14} /> Due dates only
          </button>
        </div>

        {days.length === 0 ? (
          <div className={s.empty}>
            <span className={s.emptyIcon}><Icon name="activity" size={22} /></span>
            <h3>{hasFilters(filters) || query ? 'No matching activity' : dueOnly ? 'No due date changes yet' : 'No activity yet'}</h3>
            <p>{hasFilters(filters) || query ? 'Try a different search or clear your filters.' : dueOnly ? 'Set due dates on cards to see them here.' : 'Create, move or edit cards to build a history.'}</p>
            {(hasFilters(filters) || query) && <button className={cx(ui.btn, ui.secondary)} onClick={() => useFlowStore.getState().clearFilters()}>Clear filters</button>}
          </div>
        ) : days.map(([k, evs]) => (
          <section key={k} className={s.day}>
            <h3 className={s.dayHead}>
              <span className={cx(k === todayKey && s.todayLabel)}>{dayLabel(k, evs[0].ts)}</span>
              <span className={s.dayCount}>{evs.length} event{evs.length === 1 ? '' : 's'}</span>
            </h3>
            <ol className={s.events}>
              {evs.map((ev) => {
                const meta = ACTIVITY_META[ev.type] ?? ACTIVITY_META.updated;
                const card = cardsById.get(ev.cardId);
                const title = card?.title ?? ev.cardTitle ?? 'Untitled card';
                const content = (
                  <>
                    <span className={s.icon} style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, var(--canvas))` }}>
                      <Icon name={meta.icon} size={13} strokeWidth={2} />
                    </span>
                    <span className={s.text}>{describe(ev, title)}</span>
                    <time className={s.time} dateTime={new Date(ev.ts).toISOString()}>{formatTime(ev.ts)}</time>
                  </>
                );
                return (
                  <li key={ev.id}>
                    {card
                      ? <button className={s.event} onClick={() => openModal('card', { card })}>{content}</button>
                      : <div className={cx(s.event, s.gone)} title="This card no longer exists">{content}</div>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
