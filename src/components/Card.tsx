import { memo, useState, type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../store/useFlowStore';
import { cx, formatDue, hue, uid } from '../utils';
import { Icon } from './Icon';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';
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

export function CardView({ card, variant, compact = false }: { card: Card; variant?: 'placeholder' | 'overlay'; compact?: boolean }) {
  const due = formatDue(card.dueDate);
  const hasColor = card.color && card.color !== 'transparent';
  const checklist = card.checklist ?? [];
  const done = checklist.filter((t) => t.done).length;
  return (
    <div className={cx(s.card, variant && s[variant], compact && s.compactCard)}>
      {hasColor && <span className={s.stripe} style={{ background: card.color }} />}
      {card.tags.length > 0 && <div className={s.labels}>{card.tags.slice(0, 3).map((t) => <Tag key={t} name={t} />)}{card.tags.length > 3 && <span className={s.extraTags} title={card.tags.slice(3).join(', ')}>+{card.tags.length - 3}</span>}</div>}
      <div className={s.title}>{card.title}</div>
      {card.desc && <p className={s.desc}>{card.desc}</p>}
      <div className={s.meta}>
        <span className={cx(s.priorityLabel, card.priority === 'high' && s.urgent)}><PriorityIcon priority={card.priority} />{card.priority === 'high' ? 'High' : card.priority === 'medium' ? 'Medium' : 'Low'}</span>
        {due && (
          <span className={cx(s.due, s[due.state])}>
            <Icon name="clock" size={12} strokeWidth={2} />
            {due.label}
          </span>
        )}
        {!!checklist.length && <span className={cx(s.checklist, done === checklist.length && s.complete)} title={`${done} of ${checklist.length} tasks complete`}><Icon name="checklist" size={13} />{done}/{checklist.length}</span>}
      </div>
      {!!checklist.length && <progress className={s.progress} value={done} max={checklist.length} aria-label="Checklist progress" />}
    </div>
  );
}

export const SortableCard = memo(function SortableCard({ card, className, compact }: { card: Card; className?: string; compact?: boolean }) {
  const openModal = useFlowStore((st) => st.openModal);
  const columns = useFlowStore((st) => st.columns);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'Card' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cx(s.sortable, className)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div
        ref={setActivatorNodeRef}
        className={s.openCard}
        {...attributes}
        {...listeners}
        aria-label={card.title}
        aria-roledescription="Draggable card. Press Enter to open, Space to pick up."
        onClick={() => !isDragging && openModal('card', { card })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isDragging) { e.preventDefault(); openModal('card', { card }); }
          else listeners?.onKeyDown?.(e);
        }}
      ><CardView card={card} variant={isDragging ? 'placeholder' : undefined} compact={compact} /></div>
      {!isDragging && <button className={cx(s.options, menu && s.optionsOpen)} onClick={(e) => setMenu(menu ? null : e.currentTarget)} aria-label={`Actions for ${card.title}`} aria-haspopup="menu" aria-expanded={!!menu}><Icon name="more" size={15} /></button>}
      {menu && <Menu anchor={menu} onClose={() => setMenu(null)}>
        <MenuItem icon="pencil" onClick={() => { setMenu(null); openModal('card', { card }); }}>Edit card</MenuItem>
        <MenuItem icon="copy" onClick={async () => {
          setMenu(null);
          try {
            await useFlowStore.getState().createCard(card.boardId, card.columnId, { ...card, title: `${card.title} (copy)`, checklist: card.checklist?.map((t) => ({ ...t, id: uid(), done: false })) });
            useFlowStore.getState().toast('Card duplicated');
          } catch { useFlowStore.getState().toast('Couldn’t duplicate the card. Try again.', '⚠'); }
        }}>Duplicate card</MenuItem>
        <MenuSeparator /><MenuLabel>Move to</MenuLabel>
        {[{ id: null, name: 'Backlog' }, ...columns.filter((c) => c.boardId === card.boardId).sort((a, b) => a.order - b.order)].filter((c) => c.id !== card.columnId).map((c) => <MenuItem key={c.id ?? 'backlog'} icon="arrowRight" onClick={async () => {
          setMenu(null);
          const st = useFlowStore.getState();
          const count = st.cards.filter((x) => x.boardId === card.boardId && x.columnId === c.id).length;
          try { await st.moveCard(card.id, c.id, count); st.toast(`Moved to ${c.name}`); }
          catch { st.toast('Couldn’t move the card. Try again.', '⚠'); }
        }}>{c.name}</MenuItem>)}
        <MenuSeparator />
        <MenuItem icon="trash" danger onClick={() => { setMenu(null); openModal('confirm', { title: 'Delete this card?', message: `“${card.title}” will be removed. You can undo this right after deleting.`, confirmLabel: 'Delete card', onConfirm: () => useFlowStore.getState().deleteCard(card.id) }); }}>Delete card</MenuItem>
      </Menu>}
    </div>
  );
});
