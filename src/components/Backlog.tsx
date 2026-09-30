import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useFlowStore } from '../store/useFlowStore';
import { cx } from '../utils';
import { Icon } from './Icon';
import { SortableCard } from './Card';
import type { Card } from '../types';
import s from './Backlog.module.css';
import ui from './ui.module.css';

export const BACKLOG_ID = 'backlog';

export function Backlog({ cards }: { cards: Card[] }) {
  const open = useFlowStore((st) => st.backlogOpen);
  const { toggleBacklog, openModal } = useFlowStore.getState();
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG_ID, data: { type: 'Container' } });

  return (
    <section ref={setNodeRef} className={cx(s.backlog, open && s.open, isOver && s.over)} aria-label="Backlog">
      <header className={s.header}>
        <button className={s.toggle} onClick={toggleBacklog} aria-expanded={open}>
          <Icon name="chevronDown" size={15} className={s.chevron} />
          <Icon name="inbox" size={15} />
          <span className={s.title}>Backlog</span>
          <span className={ui.count}>{cards.length}</span>
        </button>
        <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => openModal('card', {})}>
          <Icon name="plus" size={14} /> Add item
        </button>
      </header>
      <div className={s.body}>
        <div className={s.inner}>
          <div className={s.track}>
            <SortableContext items={cards.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              {cards.map((card) => <SortableCard key={card.id} card={card} className={s.item} />)}
            </SortableContext>
            {cards.length === 0 && <div className={s.empty}>Park ideas and unscheduled work here. Drag cards in or out.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
