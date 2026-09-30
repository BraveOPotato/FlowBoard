import { useFlowStore } from '../store/useFlowStore';
import { ACTIVITY_META } from '../constants';
import { Icon } from '../components/Icon';
import { Modal } from './Modal';
import type { ActivityEvent, Card } from '../types';
import s from './Modal.module.css';

export function DayDetailModal({ date, events, dueCards }: { date: Date; events: ActivityEvent[]; dueCards: Card[] }) {
  const cards = useFlowStore((st) => st.cards);
  const openModal = useFlowStore((st) => st.openModal);
  const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const colorOf = (card: Card | undefined, fallback: string) => (card?.color && card.color !== 'transparent' ? card.color : fallback);

  return (
    <Modal size="md" title={label} description={`${events.length + dueCards.length} item${events.length + dueCards.length === 1 ? '' : 's'}`}>
      {dueCards.length > 0 && (
        <>
          <h3 className={s.listTitle}>Due</h3>
          {dueCards.map((card) => (
            <button key={card.id} className={s.listRow} onClick={() => openModal('card', { card })}>
              <span className={s.dot} style={{ background: colorOf(card, 'var(--warning)') }} />
              <span className={s.grow}>{card.title}</span>
              <span className={s.meta} style={{ color: 'var(--warning)' }}><Icon name="clock" size={13} /> Due</span>
            </button>
          ))}
        </>
      )}
      {events.length > 0 && (
        <>
          <h3 className={s.listTitle}>Activity</h3>
          {events.map((ev) => {
            const card = cards.find((c) => c.id === ev.cardId);
            const meta = ACTIVITY_META[ev.type] ?? ACTIVITY_META.updated;
            const body = (
              <>
                <span className={s.dot} style={{ background: colorOf(card, meta.color) }} />
                <span className={s.grow}>{card?.title ?? ev.cardTitle ?? 'Deleted card'}</span>
                <span className={s.meta} style={{ color: meta.color }}><Icon name={meta.icon} size={13} /> {meta.label}</span>
              </>
            );
            return card
              ? <button key={ev.id} className={s.listRow} onClick={() => openModal('card', { card })}>{body}</button>
              : <div key={ev.id} className={s.listRow}>{body}</div>;
          })}
        </>
      )}
    </Modal>
  );
}
