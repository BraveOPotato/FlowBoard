import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragStartEvent, type DragEndEvent, type DragOverEvent,
  pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
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

  const collisionDetection = useCallback((args: Parameters<typeof pointerWithin>[0]) => {
    const pw = pointerWithin(args);
    if (pw.length > 0) return pw;
    return rectIntersection(args);
  }, []);

  const handleDragStart = useCallback((e: DragStartEvent) => { setActiveId(e.active.id as string); }, []);

  const handleDragOver = useCallback((e: DragOverEvent) => {
    const overId = e.over?.id as string | undefined;
    if (overId === 'backlog' && !store.backlogOpen) store.toggleBacklog();
  }, [store]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
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
        store.reorderColumns(arrayMove(columns, oldIndex, newIndex).map((c) => c.id));
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
        const siblings = cards.filter((c) => c.columnId === targetColumnId && c.id !== card.id).sort((a, b) => a.order - b.order);
        targetIndex = siblings.findIndex((c) => c.id === overId);
        if (targetIndex === -1) targetIndex = siblings.length;
      } else if (overId === 'backlog' || overId === 'backlog-sentinel') {
        targetColumnId = null;
        targetIndex = cards.filter((c) => !c.columnId && c.id !== card.id).length;
      } else {
        const overCol = columns.find((c) => c.id === overId);
        if (overCol) { targetColumnId = overCol.id; targetIndex = cards.filter((c) => c.columnId === targetColumnId).length; }
      }

      if (card.columnId !== targetColumnId || card.order !== targetIndex) {
        store.moveCard(card.id, targetColumnId, targetIndex);
      }
    }
  }, [columns, cards, store]);

  if (!activeBoardId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col items-center justify-center h-full gap-2 p-10">
          <div className="text-4xl opacity-40">📋</div>
          <div className="text-[15px] font-semibold text-[var(--text2)] font-[var(--font-display)]">No boards yet</div>
          <button
            className="px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer border border-[var(--border2)] bg-transparent text-[var(--text2)] transition-colors duration-150 hover:bg-[var(--bg3)] hover:text-[var(--text)]"
            onClick={() => store.openModal('addBoard', {})}
          >
            Create a board
          </button>
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full overflow-hidden">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          <div
            id="columns-area"
            className="flex gap-3 p-4 overflow-x-auto flex-1 items-start min-h-0 max-sm:p-2 max-sm:gap-2"
          >
            {columns.map((col) => {
              const colCards = cards
                .filter((c) => c.columnId === col.id)
                .filter((c) => {
                  if (!query) return true;
                  return c.title.toLowerCase().includes(query) || c.desc.toLowerCase().includes(query) || c.tags.some((t) => t.toLowerCase().includes(query));
                })
                .sort((a, b) => a.order - b.order);
              return <SortableColumn key={col.id} col={col} cards={colCards} />;
            })}
            <button
              className="flex-none h-9 px-4 bg-transparent border border-dashed border-[var(--border2)] text-[var(--text3)] rounded-[var(--radius)] cursor-pointer text-[13px] whitespace-nowrap transition-colors duration-150 self-start hover:border-[var(--accent)] hover:text-[var(--accent)]"
              onClick={() => store.openModal('addColumn', { boardId: activeBoardId })}
            >
              + Add Column
            </button>
          </div>
        </SortableContext>
        <Backlog />
      </div>
      <DragOverlay>{activeId ? <DragOverlayContent id={activeId} /> : null}</DragOverlay>
    </DndContext>
  );
}
