import { useEffect, useRef, useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../store/useFlowStore';
import { CARD_COLORS } from '../constants';
import { cx } from '../utils';
import { Icon } from './Icon';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { InlineInput } from './InlineInput';
import { CardView, SortableCard } from './Card';
import type { Card, Column } from '../types';
import s from './Column.module.css';
import ui from './ui.module.css';

export function SortableColumn({ col, cards }: { col: Column; cards: Card[] }) {
  const { openModal, updateColumn, deleteColumn, toast } = useFlowStore.getState();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
    data: { type: 'Column' },
  });
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  const confirmDelete = () => openModal('confirm', {
    title: `Delete “${col.name}”?`,
    message: cards.length ? `Its ${cards.length} card${cards.length === 1 ? '' : 's'} will move to the backlog.` : 'This column is empty.',
    confirmLabel: 'Delete column',
    onConfirm: async () => { await deleteColumn(col.id); toast('Column deleted', '🗑'); },
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(s.column, isDragging && s.placeholder)}
      aria-label={col.name}
    >
      <header className={s.header}>
        <div className={s.handle} {...attributes} {...listeners} aria-roledescription="Draggable column">
          <span className={s.dot} style={{ background: col.color }} />
          {renaming ? (
            <InlineInput
              className={s.renameInput}
              ariaLabel="Column name"
              value={col.name}
              onCommit={(name) => { updateColumn(col.id, { name }); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h3 className={s.name} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{col.name}</h3>
          )}
          <span className={ui.count}>{cards.length}</span>
        </div>
        <button className={cx(ui.iconBtn, ui.small, s.action)} onClick={() => setAdding(true)} aria-label={`Add card to ${col.name}`} title="Add card">
          <Icon name="plus" size={15} />
        </button>
        <button className={cx(ui.iconBtn, ui.small, s.action, menu && s.actionActive)} onClick={(e) => setMenu(menu ? null : e.currentTarget)} aria-label="Column options" aria-haspopup="menu">
          <Icon name="more" size={15} />
        </button>
      </header>

      <div className={s.list}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => <SortableCard key={card.id} card={card} />)}
        </SortableContext>
        {cards.length === 0 && !adding && <div className={s.empty}>Drop cards here</div>}
        {adding && <QuickAdd boardId={col.boardId} columnId={col.id} onDone={() => setAdding(false)} />}
      </div>

      {!adding && (
        <button className={s.addCard} onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> Add card
        </button>
      )}

      {menu && (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          <MenuItem icon="pencil" onClick={() => { setMenu(null); setRenaming(true); }}>Rename</MenuItem>
          <MenuItem icon="plus" onClick={() => { setMenu(null); setAdding(true); }}>Add card</MenuItem>
          <MenuSeparator />
          <MenuLabel>Color</MenuLabel>
          <div className={cx(ui.swatches, s.menuSwatches)}>
            {CARD_COLORS.filter((c) => c.value !== 'transparent').map((c) => (
              <button
                key={c.value}
                className={cx(ui.swatch, col.color === c.value && ui.selected)}
                style={{ background: c.value }}
                aria-label={c.name}
                onClick={() => updateColumn(col.id, { color: c.value })}
              />
            ))}
          </div>
          <MenuSeparator />
          <MenuItem icon="trash" danger onClick={() => { setMenu(null); confirmDelete(); }}>Delete column</MenuItem>
        </Menu>
      )}
    </section>
  );
}

function QuickAdd({ boardId, columnId, onDone }: { boardId: string; columnId: string | null; onDone: () => void }) {
  const createCard = useFlowStore((st) => st.createCard);
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [title]);

  const submit = async () => {
    if (!title.trim()) return onDone();
    await createCard(boardId, columnId, { title: title.trim() });
    setTitle('');
  };

  return (
    <div className={s.quickAdd}>
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        className={s.quickInput}
        placeholder="Card title…"
        aria-label="New card title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onDone()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
        }}
      />
      <div className={s.quickActions}>
        <button className={cx(ui.btn, ui.primary, ui.sm)} onMouseDown={(e) => e.preventDefault()} onClick={submit}>Add card</button>
        <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={onDone}>Cancel</button>
        <span className={s.quickHint}><kbd className={ui.kbd}>↵</kbd> to add</span>
      </div>
    </div>
  );
}

export function ColumnOverlay({ col, cards }: { col: Column; cards: Card[] }) {
  return (
    <section className={cx(s.column, s.overlay)}>
      <header className={s.header}>
        <div className={s.handle}>
          <span className={s.dot} style={{ background: col.color }} />
          <h3 className={s.name}>{col.name}</h3>
          <span className={ui.count}>{cards.length}</span>
        </div>
      </header>
      <div className={s.list}>
        {cards.map((c) => <CardView key={c.id} card={c} />)}
      </div>
    </section>
  );
}
