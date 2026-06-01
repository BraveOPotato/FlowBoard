import { create } from 'zustand';
import { WORKER_URL, THEMES, COL_COLORS } from '../constants';
import { uid } from '../utils';
import { DatabaseService } from '../services/DatabaseService';
import { SyncService } from '../services/SyncService';
import { CryptoService } from '../services/CryptoService';
import type {
  FlowState, Board, Column, Card, ActivityEvent, CrdtOp, View,
} from '../types';

const db = new DatabaseService();
const sync = new SyncService(db, WORKER_URL, (ok) => useFlowStore.setState({ workerStatus: ok }));

export { db, sync };

export const useFlowStore = create<FlowState>((set, get) => {
  const applyTheme = (id: string) => {
    const theme = THEMES.find((t) => t.id === id) || THEMES[0];
    document.documentElement.setAttribute('data-theme', theme.id);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme.bg;
  };

  const recordActivity = async (boardId: string, cardId: string, type: ActivityEvent['type'], meta: Partial<ActivityEvent> = {}) => {
    const event: ActivityEvent = { id: uid(), boardId, cardId, type, ts: Date.now(), ...meta };
    set((s) => ({ activity: [event, ...s.activity] }));
    await db.put('activity', event);
    await sync.emitOp(boardId, 'activity.create', { ...event });
  };

  const colName = (colId: string | null, columns: Column[]) => {
    if (!colId) return 'Backlog';
    return columns.find((c) => c.id === colId)?.name || 'Unknown';
  };

  return {
    boards: [],
    columns: [],
    cards: [],
    activity: [],
    activeBoardId: null,
    activeView: 'board',
    activeTheme: 'void',
    backlogOpen: true,
    searchQuery: '',
    showDueDateOnly: false,
    calendarDate: new Date(),
    modal: null,
    toasts: [],
    workerStatus: false,
    workerUrl: WORKER_URL,
    syncInterval: 600,
    isLoading: true,
    error: null,

    init: async () => {
      try {
        await db.open();
        const [boards, columns, cards, settings, activity] = await Promise.all([
          db.getAll<Board>('boards'),
          db.getAll<Column>('columns'),
          db.getAll<Card>('cards'),
          db.getAll<{ key: string; value: unknown }>('settings'),
          db.getAll<ActivityEvent>('activity'),
        ]);

        let activeBoardId: string | null = null;
        let workerUrl = WORKER_URL;
        let syncInterval = 600;
        let activeTheme = 'void';
        let backlogOpen = true;

        for (const s of settings) {
          if (s.key === 'activeBoardId') activeBoardId = s.value as string | null;
          if (s.key === 'workerUrl') workerUrl = (s.value as string) || WORKER_URL;
          if (s.key === 'syncInterval') syncInterval = (s.value as number) || 600;
          if (s.key === 'activeTheme') activeTheme = (s.value as string) || 'void';
          if (s.key === 'backlogOpen') backlogOpen = s.value !== false;
        }

        const sortedBoards = boards.sort((a, b) => a.createdAt - b.createdAt);
        if (sortedBoards.length && (!activeBoardId || !sortedBoards.find((b) => b.id === activeBoardId))) {
          activeBoardId = sortedBoards[0].id;
        }

        applyTheme(activeTheme);
        sync.setWorkerUrl(workerUrl);

        set({
          boards: sortedBoards,
          columns: columns.sort((a, b) => a.order - b.order),
          cards: cards.sort((a, b) => a.order - b.order),
          activity: activity.sort((a, b) => b.ts - a.ts),
          activeBoardId,
          activeTheme,
          workerUrl,
          syncInterval,
          backlogOpen,
          isLoading: false,
        });

        const creds = await sync.getAllBoardCreds();
        if (creds.length) {
          get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
        }

        const inviteId = new URLSearchParams(window.location.search).get('invite');
        if (inviteId) setTimeout(() => set({ modal: { type: 'joinInvite', props: { boardId: inviteId } } }), 400);
      } catch (e) {
        set({ error: (e as Error).message, isLoading: false });
      }
    },

    setActiveBoard: async (id) => {
      await db.put('settings', { key: 'activeBoardId', value: id });
      set({ activeBoardId: id });
    },

    setActiveView: (view: View) => set({ activeView: view }),
    setSearchQuery: (q) => set({ searchQuery: q }),

    toggleBacklog: async () => {
      const next = !get().backlogOpen;
      await db.put('settings', { key: 'backlogOpen', value: next });
      set({ backlogOpen: next });
    },

    toggleDueDateOnly: () => set((s) => ({ showDueDateOnly: !s.showDueDateOnly })),
    setCalendarDate: (d) => set({ calendarDate: d }),
    openModal: (type, props) => set({ modal: { type, props } }),
    closeModal: () => set({ modal: null }),

    toast: (message, icon = '✓') => {
      const id = uid();
      set((s) => ({ toasts: [...s.toasts, { id, message, icon }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 3000);
    },

    createBoard: async (name, password) => {
      const boardId = uid();
      const keyHash = await CryptoService.hashKey(boardId, password);
      const board: Board = { id: boardId, name: name || 'New Board', createdAt: Date.now() };
      await db.put('boards', board);
      await sync.saveBoardCreds(boardId, keyHash, board.name);
      set((s) => ({ boards: [...s.boards, board], activeBoardId: boardId }));
      await db.put('settings', { key: 'activeBoardId', value: boardId });
      await sync.emitOp(boardId, 'board.update', { boardId, ...board });
      const defaultCols = ['To Do', 'In Progress', 'Done'];
      const newCols = defaultCols.map((colName, i) => ({
        id: uid(), boardId, name: colName, order: i,
        color: COL_COLORS[i % COL_COLORS.length],
      }));
      for (const col of newCols) {
        await db.put('columns', col);
        await sync.emitOp(boardId, 'column.create', { ...col });
      }
      set((s) => ({ columns: [...s.columns, ...newCols] }));
    },

    renameBoard: async (id, name) => {
      const board = get().boards.find((b) => b.id === id);
      if (!board) return;
      const next = { ...board, name };
      await db.put('boards', next);
      set((s) => ({ boards: s.boards.map((b) => (b.id === id ? next : b)) }));
      await sync.emitOp(id, 'board.update', { boardId: id, name });
    },

    deleteBoard: async (id) => {
      const state = get();
      const nextBoards = state.boards.filter((b) => b.id !== id);
      const nextColumns = state.columns.filter((c) => c.boardId !== id);
      const nextCards = state.cards.filter((c) => c.boardId !== id);
      await db.delete('boards', id);
      await db.delete('boardCreds', id);
      const nextActive = state.activeBoardId === id ? nextBoards[0]?.id || null : state.activeBoardId;
      if (state.activeBoardId === id) {
        await db.put('settings', { key: 'activeBoardId', value: nextActive });
      }
      set({ boards: nextBoards, columns: nextColumns, cards: nextCards, activeBoardId: nextActive });
    },

    createColumn: async (boardId, name) => {
      const existing = get().columns.filter((c) => c.boardId === boardId);
      const col: Column = {
        id: uid(),
        boardId,
        name: name || 'New Column',
        order: existing.length,
        color: COL_COLORS[existing.length % COL_COLORS.length],
      };
      await db.put('columns', col);
      set((s) => ({ columns: [...s.columns, col] }));
      await sync.emitOp(boardId, 'column.create', { ...col });
    },

    updateColumn: async (id, updates) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      const next = { ...col, ...updates };
      await db.put('columns', next);
      set((s) => ({ columns: s.columns.map((c) => (c.id === id ? next : c)) }));
      await sync.emitOp(col.boardId, 'column.update', { ...next });
    },

    deleteColumn: async (id) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      const nextColumns = get().columns.filter((c) => c.id !== id);
      const nextCards = get().cards.map((c) => (c.columnId === id ? { ...c, columnId: null } : c));
      await db.delete('columns', id);
      const toUpdate = nextCards.filter((c) => c.columnId === null && get().cards.find((x) => x.id === c.id)?.columnId === id);
      await db.batchPut('cards', toUpdate);
      set({ columns: nextColumns, cards: nextCards });
      await sync.emitOp(col.boardId, 'column.delete', { id });
    },

    createCard: async (boardId, columnId, data) => {
      const colCards = get().cards.filter((c) => c.columnId === columnId);
      const card: Card = {
        id: uid(),
        boardId,
        columnId,
        title: data.title || 'New Card',
        desc: data.desc || '',
        tags: data.tags || [],
        color: data.color || 'transparent',
        priority: (data.priority) || 'medium',
        dueDate: data.dueDate || null,
        order: colCards.length,
        createdAt: Date.now(),
      };
      await db.put('cards', card);
      set((s) => ({ cards: [...s.cards, card] }));
      await recordActivity(boardId, card.id, 'created', {
        cardTitle: card.title,
        toColId: columnId,
        toColName: colName(columnId, get().columns),
      });
      await sync.emitOp(boardId, 'card.create', { ...card });
    },

    updateCard: async (id, updates) => {
      const card = get().cards.find((c) => c.id === id);
      if (!card) return;
      const oldColId = card.columnId;
      const oldDue = card.dueDate;
      const next = { ...card, ...updates };
      await db.put('cards', next);
      set((s) => ({ cards: s.cards.map((c) => (c.id === id ? next : c)) }));

      if ('columnId' in updates && updates.columnId !== oldColId) {
        await recordActivity(card.boardId, id, 'moved', {
          cardTitle: next.title,
          fromColId: oldColId,
          fromColName: colName(oldColId, get().columns),
          toColId: next.columnId,
          toColName: colName(next.columnId, get().columns),
        });
        await sync.emitOp(card.boardId, 'card.move', { ...next });
      } else if ('dueDate' in updates && updates.dueDate !== oldDue) {
        await recordActivity(card.boardId, id, 'due_set', {
          cardTitle: next.title,
          dueDate: next.dueDate,
          toColId: next.columnId,
          toColName: colName(next.columnId, get().columns),
        });
        await sync.emitOp(card.boardId, 'card.update', { ...next });
      } else {
        await recordActivity(card.boardId, id, 'updated', {
          cardTitle: next.title,
          toColId: next.columnId,
          toColName: colName(next.columnId, get().columns),
        });
        await sync.emitOp(card.boardId, 'card.update', { ...next });
      }
    },

    deleteCard: async (id) => {
      const card = get().cards.find((c) => c.id === id);
      if (card) {
        await recordActivity(card.boardId, id, 'deleted', {
          cardTitle: card.title,
          fromColId: card.columnId,
          fromColName: colName(card.columnId, get().columns),
        });
        await sync.emitOp(card.boardId, 'card.delete', { id });
      }
      set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
      await db.delete('cards', id);
    },

    moveCard: async (cardId, targetColumnId, targetIndex) => {
      const state = get();
      const card = state.cards.find((c) => c.id === cardId);
      if (!card) return;
      const oldColId = card.columnId;
      const isChangeCol = oldColId !== targetColumnId;

      const otherCards = state.cards.filter((c) => c.id !== cardId);
      const targetSiblings = otherCards
        .filter((c) => c.columnId === targetColumnId)
        .sort((a, b) => a.order - b.order);

      const nextTargetCol = [
        ...targetSiblings.slice(0, targetIndex),
        { ...card, columnId: targetColumnId, order: targetIndex },
        ...targetSiblings.slice(targetIndex),
      ].map((c, i) => ({ ...c, order: i }));

      const nextCardsMap = new Map<string, Card>();
      for (const c of otherCards) {
        if (c.columnId !== targetColumnId && c.columnId !== oldColId) {
          nextCardsMap.set(c.id, c);
        }
      }
      for (const c of nextTargetCol) nextCardsMap.set(c.id, c);

      if (isChangeCol) {
        const oldSiblings = otherCards
          .filter((c) => c.columnId === oldColId)
          .sort((a, b) => a.order - b.order)
          .map((c, i) => ({ ...c, order: i }));
        for (const c of oldSiblings) nextCardsMap.set(c.id, c);
      }

      const nextCards = Array.from(nextCardsMap.values());
      set({ cards: nextCards });

      const changed = nextCards.filter((c) => {
        const orig = state.cards.find((x) => x.id === c.id);
        return orig && (orig.order !== c.order || orig.columnId !== c.columnId);
      });
      await db.batchPut('cards', changed);

      if (isChangeCol) {
        await recordActivity(card.boardId, cardId, 'moved', {
          cardTitle: card.title,
          fromColId: oldColId,
          fromColName: colName(oldColId, state.columns),
          toColId: targetColumnId,
          toColName: colName(targetColumnId, state.columns),
        });
      }
      await sync.emitOp(card.boardId, 'card.move', { ...card, columnId: targetColumnId, order: targetIndex });
    },

    reorderColumns: async (orderedIds) => {
      const state = get();
      const nextColumns = state.columns.map((c) => {
        const idx = orderedIds.indexOf(c.id);
        if (idx === -1) return c;
        return { ...c, order: idx };
      });
      set({ columns: nextColumns });
      const changed = nextColumns.filter((c) => {
        const orig = state.columns.find((x) => x.id === c.id);
        return orig && orig.order !== c.order;
      });
      await db.batchPut('columns', changed);
      for (const c of changed) {
        await sync.emitOp(c.boardId, 'column.update', { ...c });
      }
    },

    saveTheme: async (id) => {
      await db.put('settings', { key: 'activeTheme', value: id });
      applyTheme(id);
      set({ activeTheme: id });
      get().toast(`Theme: ${THEMES.find((t) => t.id === id)?.label}`, '🎨');
    },

    saveSettings: async ({ workerUrl, syncInterval }) => {
      await db.put('settings', { key: 'workerUrl', value: workerUrl });
      await db.put('settings', { key: 'syncInterval', value: syncInterval });
      sync.setWorkerUrl(workerUrl);
      sync.stopTimer();
      const creds = await sync.getAllBoardCreds();
      for (const c of creds) {
        await sync.pullCrdtOps(c.boardId, '', (op, cid) => {
          const changed = get().applyCrdtOp(op, cid);
          if (changed) set({});
          return changed;
        });
        await sync.pushCrdtOps(c.boardId, '');
      }
      sync.startTimer(syncInterval, () => {
        get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
      });
      set({ workerUrl, syncInterval });
    },

    joinBoard: async (boardId, password) => {
      const keyHash = await CryptoService.hashKey(boardId, password);
      await sync.saveBoardCreds(boardId, keyHash, 'Remote Board');
      const ok = await sync.pullFromWorker(boardId, password, (data) => {
        const d = data as { boards?: Board[]; columns?: Column[]; cards?: Card[]; activity?: ActivityEvent[] };
        const state = get();
        const merge = <T extends { id: string }>(list: T[], incoming: T[] = []) => {
          const map = new Map(list.map((x) => [x.id, x]));
          for (const item of incoming) map.set(item.id, item);
          return Array.from(map.values());
        };
        set({
          boards: merge(state.boards, d.boards).sort((a, b) => (a as Board).createdAt - (b as Board).createdAt),
          columns: merge(state.columns, d.columns).sort((a, b) => (a as Column).order - (b as Column).order),
          cards: merge(state.cards, d.cards).sort((a, b) => (a as Card).order - (b as Card).order),
          activity: merge(state.activity, d.activity).sort((a, b) => (b as ActivityEvent).ts - (a as ActivityEvent).ts),
        });
      });
      if (ok && !get().boards.find((b) => b.id === boardId)) {
        get().toast('Board joined!', '✓');
      }
      return ok;
    },

    exportData: () => {
      const state = get();
      const data = { boards: state.boards, columns: state.columns, cards: state.cards, activity: state.activity };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `flowboard-export-${Date.now()}.json`;
      a.click();
    },

    importData: async (json) => {
      const data = JSON.parse(json) as { boards?: Board[]; columns?: Column[]; cards?: Card[]; activity?: ActivityEvent[] };
      const state = get();
      const merge = <T extends { id: string }>(list: T[], incoming: T[] = []) => {
        const map = new Map(list.map((x) => [x.id, x]));
        for (const item of incoming) map.set(item.id, item);
        return Array.from(map.values());
      };
      const nextBoards = merge(state.boards, data.boards);
      const nextColumns = merge(state.columns, data.columns);
      const nextCards = merge(state.cards, data.cards);
      const nextActivity = merge(state.activity, data.activity).sort((a, b) => (b as ActivityEvent).ts - (a as ActivityEvent).ts);
      set({ boards: nextBoards, columns: nextColumns, cards: nextCards, activity: nextActivity });
      for (const b of data.boards || []) await db.put('boards', b);
      for (const c of data.columns || []) await db.put('columns', c);
      for (const c of data.cards || []) await db.put('cards', c);
      for (const a of data.activity || []) await db.put('activity', a);
      get().toast('Data imported', '✓');
    },

    applyCrdtOp: (op: CrdtOp, clientId: string) => {
      if (clientId && op.clientId === clientId) return false;
      const { type, ts, payload } = op;
      const state = get();

      const upsert = <T extends { id: string }>(list: T[], incoming: T & { __ts?: number }): [T[], boolean] => {
        const idx = list.findIndex((x) => x.id === incoming.id);
        if (idx >= 0) {
          const existing = list[idx] as T & { __ts?: number };
          if (ts >= (existing.__ts || 0)) {
            const next = { ...incoming, __ts: ts };
            const nextList = list.slice();
            nextList[idx] = next as T;
            return [nextList, true];
          }
          return [list, false];
        }
        return [[...list, { ...incoming, __ts: ts } as T], true];
      };

      let changed = false;
      switch (type) {
        case 'board.update': {
          const { boardId, ...rest } = payload as { boardId: string } & Record<string, unknown>;
          const [next, c] = upsert(state.boards, { id: boardId, ...rest } as Board & { __ts?: number });
          if (c) {
            set({ boards: next });
            db.put('boards', next.find((b) => b.id === boardId)!);
            changed = true;
          }
          break;
        }
        case 'column.create':
        case 'column.update': {
          const [next, c] = upsert(state.columns, payload as Column & { __ts?: number });
          if (c) {
            set({ columns: next });
            db.put('columns', payload as Column);
            changed = true;
          }
          break;
        }
        case 'column.delete': {
          const { id } = payload as { id: string };
          if (state.columns.find((x) => x.id === id)) {
            set({ columns: state.columns.filter((x) => x.id !== id) });
            db.delete('columns', id);
            changed = true;
          }
          break;
        }
        case 'card.create':
        case 'card.update':
        case 'card.move': {
          const [next, c] = upsert(state.cards, payload as Card & { __ts?: number });
          if (c) {
            set({ cards: next });
            db.put('cards', payload as Card);
            changed = true;
          }
          break;
        }
        case 'card.delete': {
          const { id } = payload as { id: string };
          if (state.cards.find((x) => x.id === id)) {
            set({ cards: state.cards.filter((x) => x.id !== id) });
            db.delete('cards', id);
            changed = true;
          }
          break;
        }
        case 'activity.create': {
          const event = payload as ActivityEvent;
          if (!state.activity.find((a) => a.id === event.id)) {
            set({ activity: [event, ...state.activity] });
            db.put('activity', event);
            changed = true;
          }
          break;
        }
      }
      return changed;
    },
  };
});
