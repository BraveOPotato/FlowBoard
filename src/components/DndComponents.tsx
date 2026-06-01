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
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, touchAction: isDragging ? 'none' : 'manipulation' };
  const due = formatDue(card.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card"
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) store.openModal('card', { card }); }}
    >
      <div className="card-color-bar" style={{ background: card.color === 'transparent' ? 'transparent' : card.color }} />
      <div className="card-body-row">
        <div className="card-inner">
          <div className="card-title">{card.title}</div>
          {card.desc && <div className="card-desc">{card.desc}</div>}
          {card.tags.length > 0 && (
            <div className="card-tags">{card.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
          )}
          <div className="card-footer">
            {card.priority !== 'medium' && (
              <span className={`priority-badge priority-${card.priority}`}>{card.priority.toUpperCase()}</span>
            )}
            {due && <span className={`card-due ${due.cls}`}>{due.label}</span>}
            <span className="card-footer-spacer" />
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
    <div ref={setNodeRef} style={style} className={`column${isDragging ? ' dragging' : ''}`}>
      <div className="col-header">
        <button className="col-drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder column" title="Drag">
          ⠿
        </button>
        <div className="col-color-dot" style={{ background: col.color }} onClick={() => store.openModal('colColor', { col })} title="Change color" />
        <span className="col-name" onDoubleClick={() => store.openModal('renameCol', { col })}>{col.name}</span>
        <span className="col-count">{cards.length}</span>
        <button className="col-menu-btn" onClick={() => store.openModal('colMenu', { col })} aria-label="Column options" title="Options">
          ⋯
        </button>
      </div>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="col-cards">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} />
          ))}
        </div>
      </SortableContext>
      <button className="col-add-btn" onClick={() => store.openModal('card', { defaultColId: col.id })}>
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
      <div className="column dragging" style={{ opacity: 0.9, boxShadow: 'var(--shadow-lg)' }}>
        <div className="col-header">
          <div className="col-drag-handle">⠿</div>
          <div className="col-color-dot" style={{ background: col.color }} />
          <span className="col-name">{col.name}</span>
          <span className="col-count">{cards.length}</span>
        </div>
        <div className="col-cards">
          {cards.map((c) => (
            <div key={c.id} className="card" style={{ cursor: 'grabbing' }}>
              <div className="card-title">{c.title}</div>
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
      <div className="card" style={{ opacity: 0.9, boxShadow: 'var(--shadow-lg)', cursor: 'grabbing' }}>
        <div className="card-color-bar" style={{ background: card.color === 'transparent' ? 'transparent' : card.color }} />
        <div className="card-body-row">
          <div className="card-inner">
            <div className="card-title">{card.title}</div>
            {card.desc && <div className="card-desc">{card.desc}</div>}
            {card.tags.length > 0 && (
              <div className="card-tags">{card.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            )}
            <div className="card-footer">
              {card.priority !== 'medium' && (
                <span className={`priority-badge priority-${card.priority}`}>{card.priority.toUpperCase()}</span>
              )}
              {due && <span className={`card-due ${due.cls}`}>{due.label}</span>}
              <span className="card-footer-spacer" />
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
      style={{
        minWidth: 120,
        minHeight: '100%',
        flexShrink: 0,
        borderRadius: 8,
        border: isOver ? '2px dashed var(--accent)' : '2px dashed transparent',
        transition: 'border-color .15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isOver && <span style={{ fontSize: 11, color: 'var(--accent2)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>Drop here</span>}
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
      className={`${backlogOpen ? 'open' : ''} ${isOver ? 'drag-over' : ''}`}
    >
      <div id="backlog-header" onClick={() => store.toggleBacklog()}>
        <span id="backlog-toggle-icon">{backlogOpen ? '▲' : '▼'}</span>
        <span id="backlog-label">BACKLOG</span>
        <span id="backlog-count">{backlogCards.length}</span>
        <button
          id="backlog-add-btn"
          onClick={(e) => {
            e.stopPropagation();
            store.openModal('card', { defaultBoardId: activeBoardId });
          }}
        >
          + Add item
        </button>
      </div>
      <div id="backlog-cards">
        <SortableContext items={backlogCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {backlogCards.length === 0 ? (
            <div style={{ padding: '16px 0', color: 'var(--text3)', fontSize: '12px' }}>No backlog items</div>
          ) : (
            backlogCards.map((card) => <SortableCard key={card.id} card={card} />)
          )}
        </SortableContext>
        <BacklogDropSentinel />
      </div>
    </div>
  );
}
