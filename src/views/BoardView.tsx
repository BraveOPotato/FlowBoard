import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor,
  closestCenter, getFirstCollision, pointerWithin, rectIntersection, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useFlowStore } from '../store/useFlowStore';
import { SortableColumn, ColumnOverlay } from '../components/Column';
import { CardView } from '../components/Card';
import { Backlog, BACKLOG_ID } from '../components/Backlog';
import { InlineInput } from '../components/InlineInput';
import { Icon, Logo } from '../components/Icon';
import { cx, matchesQuery } from '../utils';
import type { Card } from '../types';
import s from './BoardView.module.css';
import ui from '../components/ui.module.css';

/** Container id (column id or BACKLOG_ID) → ordered visible card ids. */
type Items = Record<string, string[]>;

const byOrder = (a: Card, b: Card) => a.order - b.order;
const findContainer = (items: Items, id: UniqueIdentifier) =>
  id in items ? String(id) : Object.keys(items).find((k) => items[k].includes(String(id)));

export function BoardView() {
  const cards = useFlowStore((st) => st.cards);
  const allColumns = useFlowStore((st) => st.columns);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const backlogOpen = useFlowStore((st) => st.backlogOpen);
  const query = useFlowStore((st) => st.searchQuery).trim().toLowerCase();
  const { moveCard, reorderColumns, toggleBacklog, openModal } = useFlowStore.getState();

  const columns = useMemo(
    () => allColumns.filter((c) => c.boardId === activeBoardId).sort((a, b) => a.order - b.order),
    [allColumns, activeBoardId],
  );
  const columnIds = useMemo(() => new Set<UniqueIdentifier>(columns.map((c) => c.id)), [columns]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const baseItems = useMemo(() => {
    const items: Items = { [BACKLOG_ID]: [] };
    for (const col of columns) items[col.id] = [];
    for (const c of cards.filter((c) => c.boardId === activeBoardId && matchesQuery(c, query)).sort(byOrder)) {
      items[c.columnId ?? BACKLOG_ID]?.push(c.id);
    }
    return items;
  }, [cards, columns, activeBoardId, query]);

  // While a card is dragged we render from a local copy so cross-container moves show live.
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const [active, setActive] = useState<{ id: string; type: 'Card' | 'Column' } | null>(null);
  const items = dragItems ?? baseItems;
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMoved = useRef(false);

  useEffect(() => {
    requestAnimationFrame(() => { recentlyMoved.current = false; });
  }, [dragItems]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // Multi-container strategy (from the dnd-kit examples): prefer the card under the pointer,
  // and when over a container, snap to its closest card so the insertion point is stable.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    if (active?.type === 'Column') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => columnIds.has(c.id)) });
    }
    // Only keyboard drags (no pointer) use rect intersection. With a pointer in the gap between
    // columns, intersecting the dragged card's rect flips between both neighbours after every
    // move and loops forever, so we keep the last target instead.
    let overId = getFirstCollision(args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args), 'id');
    if (overId != null) {
      const inside = overId in items ? items[overId] : null;
      if (inside?.length) {
        overId = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => inside.includes(String(c.id))),
        })[0]?.id ?? overId;
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }
    if (recentlyMoved.current) lastOverId.current = args.active.id;
    return lastOverId.current ? [{ id: lastOverId.current }] : [];
  }, [active, items, columnIds]);

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const type = a.data.current?.type === 'Column' ? 'Column' : 'Card';
    setActive({ id: String(a.id), type });
    lastOverId.current = null;
    if (type === 'Card') setDragItems(baseItems);
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || a.data.current?.type === 'Column') return;
    if (over.id === BACKLOG_ID && !backlogOpen) toggleBacklog();
    setDragItems((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, a.id);
      const to = findContainer(prev, over.id);
      if (!from || !to || from === to) return prev;
      const target = prev[to];
      let index = target.length;
      if (!(over.id in prev)) {
        const r = a.rect.current.translated;
        const after = r && (to === BACKLOG_ID
          ? r.left + r.width / 2 > over.rect.left + over.rect.width / 2
          : r.top + r.height / 2 > over.rect.top + over.rect.height / 2);
        const overIndex = target.indexOf(String(over.id));
        if (overIndex >= 0) index = overIndex + (after ? 1 : 0);
      }
      recentlyMoved.current = true;
      return {
        ...prev,
        [from]: prev[from].filter((id) => id !== a.id),
        [to]: [...target.slice(0, index), String(a.id), ...target.slice(index)],
      };
    });
  };

  const commitCard = (id: string, container: string, list: string[]) => {
    const card = cardsById.get(id);
    if (!card) return;
    const columnId = container === BACKLOG_ID ? null : container;
    // The visible list may be filtered by search, so anchor on the next visible card to find the real index.
    const nextId = list[list.indexOf(id) + 1];
    const siblings = cards.filter((c) => c.boardId === card.boardId && c.columnId === columnId && c.id !== id).sort(byOrder);
    const found = nextId ? siblings.findIndex((c) => c.id === nextId) : -1;
    const index = found >= 0 ? found : siblings.length;
    const currentIndex = card.columnId === columnId
      ? cards.filter((c) => c.boardId === card.boardId && c.columnId === columnId).sort(byOrder).indexOf(card)
      : -1;
    if (index !== currentIndex) moveCard(id, columnId, index);
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (over && a.data.current?.type === 'Column') {
      const from = columns.findIndex((c) => c.id === a.id);
      const to = columns.findIndex((c) => c.id === over.id);
      if (from >= 0 && to >= 0 && from !== to) reorderColumns(arrayMove(columns, from, to).map((c) => c.id));
    } else if (over && dragItems) {
      const container = findContainer(dragItems, a.id);
      if (container) {
        let list = dragItems[container];
        const from = list.indexOf(String(a.id));
        const to = list.indexOf(String(over.id));
        if (to >= 0 && from !== to) list = arrayMove(list, from, to);
        commitCard(String(a.id), container, list);
      }
    }
    setActive(null);
    setDragItems(null);
  };

  const onDragCancel = () => { setActive(null); setDragItems(null); };

  const cardsIn = (container: string) => (items[container] ?? []).map((id) => cardsById.get(id)).filter((c): c is Card => !!c);

  if (!activeBoardId) {
    return (
      <div className={s.welcome}>
        <Logo size={52} />
        <h2>Welcome to FlowBoard</h2>
        <p>Boards hold columns, and columns hold cards. Create your first board to get started.</p>
        <button className={cx(ui.btn, ui.primary)} onClick={() => openModal('addBoard', {})}>
          <Icon name="plus" size={15} /> Create a board
        </button>
      </div>
    );
  }

  const activeCol = active?.type === 'Column' ? columns.find((c) => c.id === active.id) : undefined;
  const activeCard = active?.type === 'Card' ? cardsById.get(active.id) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={s.board}>
        <div className={s.columns}>
          <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {columns.map((col) => <SortableColumn key={col.id} col={col} cards={cardsIn(col.id)} />)}
          </SortableContext>
          <AddColumn boardId={activeBoardId} />
        </div>
        <Backlog cards={cardsIn(BACKLOG_ID)} />
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activeCol ? <ColumnOverlay col={activeCol} cards={cardsIn(activeCol.id)} />
          : activeCard ? <CardView card={activeCard} variant="overlay" />
          : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumn({ boardId }: { boardId: string }) {
  const createColumn = useFlowStore((st) => st.createColumn);
  const [adding, setAdding] = useState(false);
  if (!adding) {
    return (
      <button className={s.addColumn} onClick={() => setAdding(true)}>
        <Icon name="plus" size={15} /> Add column
      </button>
    );
  }
  return (
    <div className={s.newColumn}>
      <InlineInput
        className={ui.input}
        ariaLabel="New column name"
        placeholder="Column name…"
        value=""
        onCommit={(name) => { createColumn(boardId, name); setAdding(false); }}
        onCancel={() => setAdding(false)}
      />
      <p className={ui.hint}>Enter to create · Esc to cancel</p>
    </div>
  );
}
