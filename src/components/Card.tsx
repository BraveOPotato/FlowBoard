import { memo, type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../store/useFlowStore';
import { cx, formatDue, hue } from '../utils';
import { Icon } from './Icon';
import type { Card, Priority } from '../types';
import s from './Card.module.css';

const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low priority', medium: 'Medium priority', high: 'High priority' };

export function PriorityIcon({ priority }: { priority: Priority }) {
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  return (
    <span className={cx(s.priority, priority === 'high' && s.high)} title={PRIORITY_LABEL[priority]} aria-label={PRIORITY_LABEL[priority]}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= level ? s.on : undefined} />)}
    </span>
  );
}

export function Tag({ name }: { name: string }) {
  return <span className={s.tag} style={{ '--tag-h': hue(name) } as CSSProperties}>{name}</span>;
}

export function CardView({ card, variant }: { card: Card; variant?: 'placeholder' | 'overlay' }) {
  const due = formatDue(card.dueDate);
  const hasColor = card.color && card.color !== 'transparent';
  return (
    <div className={cx(s.card, variant && s[variant])}>
      {hasColor && <span className={s.stripe} style={{ background: card.color }} />}
      <div className={s.title}>{card.title}</div>
      {card.desc && <p className={s.desc}>{card.desc}</p>}
      <div className={s.meta}>
        <PriorityIcon priority={card.priority} />
        {due && (
          <span className={cx(s.due, s[due.state])}>
            <Icon name="clock" size={12} strokeWidth={2} />
            {due.label}
          </span>
        )}
        {card.tags.map((t) => <Tag key={t} name={t} />)}
      </div>
    </div>
  );
}

export const SortableCard = memo(function SortableCard({ card, className }: { card: Card; className?: string }) {
  const openModal = useFlowStore((st) => st.openModal);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'Card' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cx(s.sortable, className)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable card. Press Enter to open, Space to pick up."
      onClick={() => openModal('card', { card })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDragging) openModal('card', { card });
        else listeners?.onKeyDown?.(e);
      }}
    >
      <CardView card={card} variant={isDragging ? 'placeholder' : undefined} />
    </div>
  );
});
