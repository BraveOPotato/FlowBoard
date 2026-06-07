import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowStore } from '../store/useFlowStore';
import { formatDue } from '../utils';
import type { Card, Column } from '../types';

export function SortableCard({ card }: { card: Card }) {
  const store = useFlowStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'Card', card },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    touchAction: isDragging ? 'none' : 'manipulation',
  };
  const due = formatDue(card.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-[var(--surface2)] border border-[var(--border)] rounded-[var(--radius)] cursor-grab transition-colors duration-150 relative overflow-hidden select-none flex flex-col hover:border-[var(--border2)] hover:shadow-[var(--shadow)]"
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) store.openModal('card', { card }); }}
    >
      <div
        className="h-[3px] w-full flex-shrink-0"
        style={{ background: card.color === 'transparent' ? 'transparent' : card.color }}
      />
      <div className="flex gap-2 items-start px-2.5 pt-2.5 pb-2 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[var(--text)] leading-snug break-words">{card.title}</div>
          {card.desc && (
            <div className="card-desc text-[11px] text-[var(--text2)] mt-1 leading-snug break-words">{card.desc}</div>
          )}
          {card.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1.5">
              {card.tags.map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-glow)] text-[var(--accent2)] font-[var(--font-mono)]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            {card.priority !== 'medium' && (
              <span
                className={`text-[9px] px-1 py-px rounded font-[var(--font-mono)] font-semibold ${
                  card.priority === 'high'
                    ? 'bg-red-500/20 text-[var(--red)]'
                    : 'bg-green-500/15 text-[var(--green)]'
                }`}
              >
                {card.priority.toUpperCase()}
              </span>
            )}
            {due && (
              <span
                className={`text-[10px] font-[var(--font-mono)] ${
                  due.cls === 'overdue' ? 'text-[var(--red)]'
                  : due.cls === 'due-today' ? 'text-[var(--yellow)]'
                  : due.cls === 'due-soon' ? 'text-[var(--orange)]'
                  : 'text-[var(--text3)]'
                }`}
              >
                {due.label}
              </span>
            )}
            <span className="flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SortableColumn({ col, cards }: { col: Column; cards: Card[] }) {
  const store = useFlowStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
    data: { type: 'Column' },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex-[0_0_var(--col-w)] flex flex-col bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--border)] max-h-full overflow-hidden transition-colors duration-200 ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 border-b border-[var(--border)] flex-shrink-0">
        <button
          className="cursor-grab text-[var(--text3)] text-sm flex-shrink-0 px-0.5 bg-transparent border-none touch-none active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder column"
          title="Drag"
        >
          ⠿
        </button>
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer transition-transform duration-150 hover:scale-125"
          style={{ background: col.color }}
          onClick={() => store.openModal('colColor', { col })}
          title="Change color"
        />
        <span
          className="text-[13px] font-semibold text-[var(--text)] font-[var(--font-display)] flex-1 cursor-default"
          onDoubleClick={() => store.openModal('renameCol', { col })}
        >
          {col.name}
        </span>
        <span className="text-[11px] text-[var(--text3)] font-[var(--font-mono)] bg-[var(--bg3)] px-1.5 py-0.5 rounded-full">
          {cards.length}
        </span>
        <button
          className="bg-transparent border-none text-[var(--text3)] cursor-pointer text-lg px-0.5 leading-none transition-colors duration-150 hover:text-[var(--text)]"
          onClick={() => store.openModal('colMenu', { col })}
          aria-label="Column options"
          title="Options"
        >
          ⋯
        </button>
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="col-cards flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} />
          ))}
        </div>
      </SortableContext>

      <button
        className="mx-2 mb-2 mt-1 bg-transparent border border-dashed border-[var(--border)] text-[var(--text3)] rounded-[var(--radius)] p-1.5 text-xs cursor-pointer transition-colors duration-150 text-left hover:border-[var(--accent)] hover:text-[var(--accent)]"
        onClick={() => store.openModal('card', { defaultColId: col.id })}
      >
        + Add card
      </button>
    </div>
  );
}

export function DragOverlayContent({ id }: { id: string }) {
  const state = useFlowStore();
  const col = state.columns.find((c) => c.id === id);
  if (col) {
    const cards = state.cards.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order);
    return (
      <div
        className="flex-[0_0_var(--col-w)] flex flex-col bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden opacity-90"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 border-b border-[var(--border)] flex-shrink-0">
          <div className="text-[var(--text3)] text-sm px-0.5">⠿</div>
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color }} />
          <span className="text-[13px] font-semibold text-[var(--text)] font-[var(--font-display)] flex-1">{col.name}</span>
          <span className="text-[11px] text-[var(--text3)] font-[var(--font-mono)] bg-[var(--bg3)] px-1.5 py-0.5 rounded-full">{cards.length}</span>
        </div>
        <div className="flex flex-col gap-1.5 p-2">
          {cards.map((c) => (
            <div key={c.id} className="bg-[var(--surface2)] border border-[var(--border)] rounded-[var(--radius)] p-2 cursor-grabbing">
              <div className="text-[13px] font-medium text-[var(--text)]">{c.title}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const card = state.cards.find((c) => c.id === id);
  if (card) {
    const due = formatDue(card.dueDate);
    return (
      <div
        className="bg-[var(--surface2)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden flex flex-col opacity-90 cursor-grabbing"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="h-[3px] w-full" style={{ background: card.color === 'transparent' ? 'transparent' : card.color }} />
        <div className="flex gap-2 items-start px-2.5 pt-2.5 pb-2 flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-[var(--text)] leading-snug break-words">{card.title}</div>
            {card.desc && <div className="card-desc text-[11px] text-[var(--text2)] mt-1 leading-snug break-words">{card.desc}</div>}
            {card.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1.5">
                {card.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-glow)] text-[var(--accent2)] font-[var(--font-mono)]">{t}</span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-2">
              {card.priority !== 'medium' && (
                <span className={`text-[9px] px-1 py-px rounded font-[var(--font-mono)] font-semibold ${card.priority === 'high' ? 'bg-red-500/20 text-[var(--red)]' : 'bg-green-500/15 text-[var(--green)]'}`}>
                  {card.priority.toUpperCase()}
                </span>
              )}
              {due && <span className="text-[10px] font-[var(--font-mono)] text-[var(--text3)]">{due.label}</span>}
              <span className="flex-1" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export function BacklogDropSentinel() {
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog-sentinel', data: { type: 'BacklogSentinel' } });
  return (
    <div
      ref={setNodeRef}
      className={`min-w-[120px] min-h-full flex-shrink-0 rounded-lg border-2 border-dashed flex items-center justify-center transition-colors duration-150 ${isOver ? 'border-[var(--accent)]' : 'border-transparent'}`}
    >
      {isOver && (
        <span className="text-[11px] text-[var(--accent2)] font-[var(--font-mono)] whitespace-nowrap">Drop here</span>
      )}
    </div>
  );
}

export function Backlog() {
  const store = useFlowStore();
  const activeBoardId = store.activeBoardId;
  const backlogOpen = store.backlogOpen;
  const query = store.searchQuery.toLowerCase();
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog', data: { type: 'Column' } });

  const backlogCards = useMemo(() => {
    return store.cards
      .filter((c) => c.boardId === activeBoardId && !c.columnId)
      .filter((c) => {
        if (!query) return true;
        return (
          c.title.toLowerCase().includes(query) ||
          c.desc.toLowerCase().includes(query) ||
          c.tags.some((t) => t.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => a.order - b.order);
  }, [store.cards, activeBoardId, query]);

  return (
    <div
      ref={setNodeRef}
      id="backlog-area"
      className={`bg-[var(--bg2)] border-t border-[var(--border)] flex-shrink-0 ${backlogOpen ? 'open' : ''} ${isOver ? 'drag-over' : ''}`}
    >
      <div
        id="backlog-header"
        className="flex items-center gap-2 px-4 py-2 cursor-pointer border-b border-[var(--border)]"
        onClick={() => store.toggleBacklog()}
      >
        <span id="backlog-toggle-icon" className="text-[var(--text3)] text-[10px] cursor-pointer">
          {backlogOpen ? '▲' : '▼'}
        </span>
        <span className="text-[10px] font-bold tracking-widest text-[var(--text3)] font-[var(--font-mono)]">BACKLOG</span>
        <span className="text-[11px] text-[var(--text3)] bg-[var(--bg3)] px-1.5 py-px rounded-full font-[var(--font-mono)]">{backlogCards.length}</span>
        <button
          className="ml-auto bg-transparent border border-[var(--border2)] text-[var(--text2)] px-2 py-0.5 rounded-md cursor-pointer text-[11px] transition-colors duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]"
          onClick={(e) => {
            e.stopPropagation();
            store.openModal('card', { defaultBoardId: activeBoardId });
          }}
        >
          + Add item
        </button>
      </div>
      <div
        id="backlog-cards"
        className="flex gap-2 px-4 py-2 overflow-x-auto max-sm:px-2 max-sm:py-1.5"
        style={{ height: 'calc(var(--backlog-h) - 40px)' }}
      >
        <SortableContext items={backlogCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {backlogCards.length === 0 ? (
            <div className="py-4 text-[var(--text3)] text-xs">No backlog items</div>
          ) : (
            backlogCards.map((card) => (
              <div key={card.id} className="flex-[0_0_220px]">
                <SortableCard card={card} />
              </div>
            ))
          )}
        </SortableContext>
        <BacklogDropSentinel />
      </div>
    </div>
  );
}
