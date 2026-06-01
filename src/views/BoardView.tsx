import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useFlowStore } from '../store/useFlowStore';
import { SortableColumn, DragOverlayContent, Backlog } from '../components/DndComponents';
import type { Card } from '../types';

export function BoardView() {
  const store = useFlowStore();
  const activeBoardId = store.activeBoardId;
  const columns = useMemo(
    () => store.columns.filter((c) => c.boardId === activeBoardId).sort((a, b) => a.order - b.order),
    [store.columns, activeBoardId]
  );
  const cards = store.cards;
  const query = store.searchQuery.toLowerCase();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const collisionDetection = useCallback(
    (args: Parameters<typeof pointerWithin>[0]) => {
      const pw = pointerWithin(args);
      if (pw.length > 0) return pw;
      return rectIntersection(args);
    },
    []
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (e: DragOverEvent) => {
      const overId = e.over?.id as string | undefined;
      if (overId === 'backlog' && !store.backlogOpen) {
        store.toggleBacklog();
      }
    },
    [store]
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      setActiveId(null);
      if (!over) return;

      const activeType = (active.data.current as { type?: string })?.type;
      const overId = over.id as string;

      if (activeType === 'Column') {
        const overType = (over.data.current as { type?: string })?.type;
        if (overType === 'Column' && active.id !== over.id) {
          const oldIndex = columns.findIndex((c) => c.id === active.id);
          const newIndex = columns.findIndex((c) => c.id === overId);
          const newOrder = arrayMove(columns, oldIndex, newIndex).map((c) => c.id);
          store.reorderColumns(newOrder);
        }
        return;
      }

      if (activeType === 'Card') {
        const card = (active.data.current as { card: Card }).card;
        const overCard = cards.find((c) => c.id === overId);
        let targetColumnId: string | null = null;
        let targetIndex = 0;

        if (overCard) {
          targetColumnId = overCard.columnId;
          const siblings = cards
            .filter((c) => c.columnId === targetColumnId && c.id !== card.id)
            .sort((a, b) => a.order - b.order);
          targetIndex = siblings.findIndex((c) => c.id === overId);
          if (targetIndex === -1) targetIndex = siblings.length;
        } else if (overId === 'backlog' || overId === 'backlog-sentinel') {
          targetColumnId = null;
          targetIndex = cards.filter((c) => !c.columnId && c.id !== card.id).length;
        } else {
          const overCol = columns.find((c) => c.id === overId);
          if (overCol) {
            targetColumnId = overCol.id;
            targetIndex = cards.filter((c) => c.columnId === targetColumnId).length;
          }
        }

        if (card.columnId !== targetColumnId || card.order !== targetIndex) {
          store.moveCard(card.id, targetColumnId, targetIndex);
        }
      }
    },
    [columns, cards, store]
  );

  if (!activeBoardId) {
    return (
      <div id="board-view">
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No boards yet</div>
          <button className="btn btn-secondary" onClick={() => store.openModal('addBoard', {})}>Create a board</button>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div id="board-view">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          <div id="columns-area">
            {columns.map((col) => {
              const colCards = cards
                .filter((c) => c.columnId === col.id)
                .filter((c) => {
                  if (!query) return true;
                  return (
                    c.title.toLowerCase().includes(query) ||
                    c.desc.toLowerCase().includes(query) ||
                    c.tags.some((t) => t.toLowerCase().includes(query))
                  );
                })
                .sort((a, b) => a.order - b.order);
              return <SortableColumn key={col.id} col={col} cards={colCards} />;
            })}
            <button className="add-col-btn" onClick={() => store.openModal('addColumn', { boardId: activeBoardId })}>
              + Add Column
            </button>
          </div>
        </SortableContext>
        <Backlog />
      </div>
      <DragOverlay>
        {activeId ? <DragOverlayContent id={activeId} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
