import { create } from 'zustand';
import { WORKER_URL, COL_COLORS, resolveTheme } from '../constants.ts';
import { DEFAULT_FILTERS, planMove, uid } from '../utils.ts';
import { DatabaseService } from '../services/DatabaseService.ts';
import type { SyncRecovery, SyncWriteOptions } from '../services/DatabaseService.ts';
import { SyncService } from '../services/SyncService.ts';
import { CryptoService } from '../services/CryptoService.ts';
import { boardIdFromPath, setBoardUrl } from '../boardRouting.ts';
import { SYNC_PROTOCOL, applyOp, emptyState, generationOf, materialize, mergeStates, parseSnapshot, stripMeta, validId, validOp, type CrdtState } from '../services/crdt.ts';
import type {
  FlowState, Board, Column, Card, ActivityEvent, CrdtOp, View,
} from '../types';

const db = new DatabaseService();
const sync = new SyncService(db, WORKER_URL, (ok) => useFlowStore.setState({ workerStatus: ok }));

export { db, sync };

const THEME_CACHE_KEY = 'flowboard-theme';

const applyTheme = (id: string | null) => {
  const theme = resolveTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  const vars: Record<string, string> = {
    canvas: theme.canvas, sidebar: theme.sidebar, surface: theme.surface, card: theme.card, raised: theme.raised,
    hover: theme.hover, line: theme.line, 'line-strong': theme.lineStrong,
    fg: theme.fg, 'fg-muted': theme.fgMuted, 'fg-subtle': theme.fgSubtle, accent: theme.accent, 'accent-fg': theme.accentFg,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.sidebar);
  localStorage.setItem(THEME_CACHE_KEY, theme.id);
  return theme.id;
};

// Paint the last-used theme before IndexedDB finishes loading, so there's no flash.
applyTheme(localStorage.getItem(THEME_CACHE_KEY));

export const useFlowStore = create<FlowState>((set, get) => {

  let writes = Promise.resolve();
  let syncWork = Promise.resolve();
  const persist = (boardId: string, update: (state: CrdtState) => CrdtOp[], options?: SyncWriteOptions) => {
    const work = writes.then(async () => {
      const initial = emptyState();
      const current = get();
      for (const store of ['boards', 'columns', 'cards', 'activity'] as const) {
        for (const row of current[store]) {
          if (store === 'boards' ? row.id === boardId : 'boardId' in row && row.boardId === boardId) {
            initial[store][row.id] = { __ts: 0, ...row };
          }
        }
      }
      const state = await db.updateSyncState(boardId, initial, update, options);
      const recovery = await db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${boardId}`);
      const data = materialize(state) as unknown as Pick<FlowState, 'boards' | 'columns' | 'cards' | 'activity'>;
      const latest = get();
      set({
        syncRecoveryBoardIds: [...latest.syncRecoveryBoardIds.filter(id => id !== boardId), ...(recovery && !recovery.value.resolved ? [boardId] : [])],
        boards: [...latest.boards.filter(b => b.id !== boardId), ...data.boards].sort((a, b) => a.createdAt - b.createdAt),
        columns: [...latest.columns.filter(c => c.boardId !== boardId), ...data.columns].sort((a, b) => a.order - b.order),
        cards: [...latest.cards.filter(c => c.boardId !== boardId), ...data.cards].sort((a, b) => a.order - b.order),
        activity: [...latest.activity.filter(a => a.boardId !== boardId), ...data.activity].sort((a, b) => b.ts - a.ts),
      });
      if (recovery && !recovery.value.resolved && !latest.syncRecoveryBoardIds.includes(boardId)) {
        get().toast('Cloud sync paused to protect an older board. Review recovery in Settings.', '⚠', {
          label: 'Review', run: async () => { get().openModal('settings'); },
        });
      }
    });
    writes = work.catch(() => {});
    return work;
  };
  const commit = (boardId: string, changes: { type: string; payload: Record<string, unknown> }[]) => persist(boardId, state => {
    let after = 0;
    for (const map of Object.values(state)) for (const row of Object.values(map)) after = Math.max(after, row.__ts ?? 0);
    return changes.map(({ type, payload }) => {
      const op = sync.createOp(boardId, type, type === 'board.update' && generationOf(state, boardId)
        ? { ...payload, syncGeneration: generationOf(state, boardId) } : payload, after);
      if (!validOp(op, boardId)) throw new Error('Invalid local operation');
      after = op.ts;
      applyOp(state, op);
      return op;
    });
  }).then(() => sync.scheduleSync(() => {
    const { workerUrl, syncInterval } = get();
    get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
  }));
  const mergeRemote = (boardId: string, remote: CrdtState) => persist(boardId, state => { mergeStates(state, remote); return []; }, { remote: true, remoteState: remote });

  const download = (data: unknown, filename: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const recordActivity = async (boardId: string, cardId: string, type: ActivityEvent['type'], meta: Partial<ActivityEvent> = {}) => {
    const event: ActivityEvent = { id: uid(), boardId, cardId, type, ts: Date.now(), ...meta };
    await commit(boardId, [{ type: 'activity.create', payload: { ...event } }]);
  };

  const parseData = (data: unknown, boardId?: string): CrdtState => {
    if (!data || typeof data !== 'object') throw new Error('Invalid board data');
    const state = emptyState();
    for (const store of Object.keys(state) as (keyof CrdtState)[]) {
      const rows = (data as Record<string, unknown>)[store] ?? [];
      if (!Array.isArray(rows)) throw new Error('Invalid board records');
      for (const row of rows) {
        if (!row || !validId(row.id) || (store !== 'boards' && !validId(row.boardId))
          || boardId && (store === 'boards' ? row.id !== boardId : row.boardId !== boardId)) throw new Error('Invalid or cross-board record');
        const fields = stripMeta(row);
        state[store][row.id] = { ...fields, __ts: 0, __opId: '' };
      }
    }
    return state;
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
    activeTheme: 'midnight',
    backlogOpen: true,
    searchQuery: '',
    filters: { ...DEFAULT_FILTERS },
    density: 'comfortable',
    showDueDateOnly: false,
    calendarDate: new Date(),
    modal: null,
    toasts: [],
    workerStatus: false,
    syncRecoveryBoardIds: [],
    workerUrl: WORKER_URL,
    syncInterval: 600,
    isLoading: true,
    error: null,

    init: async () => {
      // Best effort: reduce storage eviction without blocking startup or requiring support.
      try { void navigator.storage?.persist?.().catch(() => {}); }
      catch { /* Storage permissions must not prevent opening existing boards. */ }
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
        let activeTheme = 'midnight';
        let backlogOpen = true;
        let density: FlowState['density'] = 'comfortable';

        for (const s of settings) {
          if (s.key === 'activeBoardId') activeBoardId = s.value as string | null;
          if (s.key === 'workerUrl') workerUrl = (s.value as string) || WORKER_URL;
          if (s.key === 'syncInterval') syncInterval = (s.value as number) || 600;
          if (s.key === 'activeTheme') activeTheme = s.value as string;
          if (s.key === 'backlogOpen') backlogOpen = s.value !== false;
          if (s.key === 'density' && s.value === 'compact') density = 'compact';
        }

        const sortedBoards = boards.sort((a, b) => a.createdAt - b.createdAt);
        if (!sortedBoards.some((b) => b.id === activeBoardId)) {
          activeBoardId = sortedBoards[0]?.id ?? null;
        }

        activeTheme = applyTheme(activeTheme);
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
          density,
          isLoading: false,
          syncRecoveryBoardIds: settings.filter(s => s.key.startsWith('syncRecovery:') && !(s.value as SyncRecovery).resolved).map(s => s.key.slice('syncRecovery:'.length)).filter(id => boards.some(b => b.id === id)),
        });

        await get().setActiveBoard(boardIdFromPath(window.location.pathname) ?? activeBoardId, true);

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

    setActiveBoard: async (id, replace = false) => {
      if (id && !get().boards.some((b) => b.id === id)) {
        const boardId = id;
        get().toast('This board isn’t on this device. Join it with its password.', '⚠', {
          label: 'Join board', run: async () => { get().openModal('joinInvite', { boardId }); },
        });
        id = null;
        replace = true;
      }
      setBoardUrl(id, replace);
      set({ activeBoardId: id, filters: { ...DEFAULT_FILTERS }, searchQuery: '' });
      await db.put('settings', { key: 'activeBoardId', value: id });
    },

    setActiveView: (view: View) => set({ activeView: view }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setFilters: (filters) => set((s) => ({ filters: { ...s.filters, ...filters } })),
    clearFilters: () => set({ filters: { ...DEFAULT_FILTERS }, searchQuery: '' }),
    setDensity: async (density) => {
      set({ density });
      await db.put('settings', { key: 'density', value: density });
    },

    toggleBacklog: async () => {
      const next = !get().backlogOpen;
      await db.put('settings', { key: 'backlogOpen', value: next });
      set({ backlogOpen: next });
    },

    toggleDueDateOnly: () => set((s) => ({ showDueDateOnly: !s.showDueDateOnly })),
    setCalendarDate: (d) => set({ calendarDate: d }),
    openModal: (type, props) => set({ modal: { type, props } }),
    closeModal: () => set({ modal: null }),

    toast: (message, icon = '✓', action) => {
      const id = uid();
      set((s) => ({ toasts: [...s.toasts, { id, message, icon, action }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, action ? 10000 : 4000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    createBoard: async (name, password) => {
      const boardId = uid();
      const keyHash = await CryptoService.hashKey(boardId, password);
      const board: Board = { id: boardId, name: name || 'New Board', createdAt: Date.now() };
      await sync.saveBoardCreds(boardId, keyHash, board.name, password);
      const defaultCols = ['To Do', 'In Progress', 'Done'];
      const newCols = defaultCols.map((colName, i) => ({
        id: uid(), boardId, name: colName, order: i,
        color: COL_COLORS[i % COL_COLORS.length],
      }));
      await commit(boardId, [{ type: 'board.update', payload: { boardId, ...board } }, ...newCols.map(c => ({ type: 'column.create', payload: { ...c } }))]);
      await get().setActiveBoard(boardId);
    },

    renameBoard: async (id, name) => {
      const board = get().boards.find((b) => b.id === id);
      if (!board) return;
      const next = { ...board, name };
      await commit(id, [{ type: 'board.update', payload: { ...next, boardId: id } }]);
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
        setBoardUrl(nextActive, true);
      }
      set({ boards: nextBoards, columns: nextColumns, cards: nextCards, activeBoardId: nextActive, syncRecoveryBoardIds: state.syncRecoveryBoardIds.filter(boardId => boardId !== id), filters: { ...DEFAULT_FILTERS }, searchQuery: '' });
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
      await commit(boardId, [{ type: 'column.create', payload: { ...col } }]);
    },

    updateColumn: async (id, updates) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      const next = { ...col, ...updates };
      await commit(col.boardId, [{ type: 'column.update', payload: { ...next } }]);
    },

    deleteColumn: async (id) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      // ponytail: O(n²) column deletion reuses ordering/sync; batch-plan moves if columns reach thousands of cards.
      for (const card of get().cards.filter((c) => c.columnId === id).sort((a, b) => a.order - b.order)) {
        const count = get().cards.filter((c) => c.boardId === col.boardId && c.columnId === null).length;
        await get().moveCard(card.id, null, count);
      }
      await commit(col.boardId, [{ type: 'column.delete', payload: { id, boardId: col.boardId } }]);
      set(s => ({ filters: { ...s.filters, columnId: s.filters.columnId === id ? 'all' : s.filters.columnId } }));
    },

    createCard: async (boardId, columnId, data) => {
      const colCards = get().cards.filter((c) => c.columnId === columnId && c.boardId === boardId);
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
        checklist: data.checklist ?? [],
        order: colCards.length ? Math.max(...colCards.map((c) => c.order)) + 1 : 0,
        createdAt: Date.now(),
      };
      await commit(boardId, [{ type: 'card.create', payload: { ...card } }]);
      await recordActivity(boardId, card.id, 'created', {
        cardTitle: card.title,
        toColId: columnId,
        toColName: colName(columnId, get().columns),
      });
    },

    updateCard: async (id, updates) => {
      const card = get().cards.find((c) => c.id === id);
      if (!card) return;
      const oldColId = card.columnId;
      const oldDue = card.dueDate;
      // Every status change goes through the same ordering path, including edits in the card editor.
      const { columnId, ...details } = updates;
      if (columnId !== undefined && columnId !== oldColId) {
        const count = get().cards.filter((c) => c.boardId === card.boardId && c.columnId === columnId).length;
        await get().moveCard(id, columnId, count);
      }
      const next = { ...get().cards.find((c) => c.id === id)!, ...details };
      await commit(card.boardId, [{ type: 'card.update', payload: { ...next } }]);

      if ('dueDate' in updates && updates.dueDate !== oldDue) {
        await recordActivity(card.boardId, id, 'due_set', {
          cardTitle: next.title,
          dueDate: next.dueDate,
          toColId: next.columnId,
          toColName: colName(next.columnId, get().columns),
        });
      } else {
        await recordActivity(card.boardId, id, 'updated', {
          cardTitle: next.title,
          toColId: next.columnId,
          toColName: colName(next.columnId, get().columns),
        });
      }
    },

    deleteCard: async (id) => {
      const card = get().cards.find((c) => c.id === id);
      if (!card) return;
      const position = get().cards.filter((c) => c.boardId === card.boardId && c.columnId === card.columnId).sort((a, b) => a.order - b.order).findIndex((c) => c.id === id);
      await commit(card.boardId, [{ type: 'card.delete', payload: { id, boardId: card.boardId } }]);
      await recordActivity(card.boardId, id, 'deleted', {
        cardTitle: card.title,
        fromColId: card.columnId,
        fromColName: colName(card.columnId, get().columns),
      });
      get().toast('Card deleted', '🗑', { label: 'Undo', run: async () => {
        const state = get();
        if (!state.boards.some((b) => b.id === card.boardId)) return;
        if (state.cards.some((c) => c.id === id)) return;
        const columnId = state.columns.some((c) => c.id === card.columnId) ? card.columnId : null;
        const restored = { ...card, columnId };
        const updates = planMove([...state.cards, restored], id, columnId, position);
        await commit(card.boardId, [...updates.values()].map(c => ({ type: c.id === id ? 'card.create' : 'card.update', payload: { ...c } })));
        await recordActivity(card.boardId, id, 'created', { cardTitle: card.title, toColId: columnId, toColName: colName(columnId, get().columns) });
        get().toast('Card restored');
      } });
    },

    moveCard: async (cardId, targetColumnId, targetIndex) => {
      const state = get();
      const card = state.cards.find((c) => c.id === cardId);
      if (!card) return;
      if (targetColumnId && !state.columns.some((c) => c.id === targetColumnId && c.boardId === card.boardId)) throw new Error('The destination column no longer exists.');
      const oldColId = card.columnId;
      const isChangeCol = oldColId !== targetColumnId;

      const updates = planMove(state.cards, cardId, targetColumnId, targetIndex);
      await commit(card.boardId, [...updates.values()].map(c => ({ type: c.id === cardId ? 'card.move' : 'card.update', payload: { ...c } })));

      if (isChangeCol) {
        await recordActivity(card.boardId, cardId, 'moved', {
          cardTitle: card.title,
          fromColId: oldColId,
          fromColName: colName(oldColId, state.columns),
          toColId: targetColumnId,
          toColName: colName(targetColumnId, state.columns),
        });
      }
    },

    reorderColumns: async (orderedIds) => {
      const state = get();
      const nextColumns = state.columns.map((c) => {
        const idx = orderedIds.indexOf(c.id);
        if (idx === -1) return c;
        return { ...c, order: idx };
      });
      const changed = nextColumns.filter((c) => {
        const orig = state.columns.find((x) => x.id === c.id);
        return orig && orig.order !== c.order;
      });
      for (const boardId of new Set(changed.map(c => c.boardId))) {
        await commit(boardId, changed.filter(c => c.boardId === boardId).map(c => ({ type: 'column.update', payload: { ...c } })));
      }
    },

    saveTheme: async (id) => {
      applyTheme(id);
      set({ activeTheme: id });
      await db.put('settings', { key: 'activeTheme', value: id });
    },

    saveSettings: ({ workerUrl, syncInterval }) => {
      // Debounced edits must use the latest requested endpoint, not queue an obsolete setting.
      sync.stopTimer();
      set({ workerUrl, syncInterval });
      const run = syncWork.catch(() => {}).then(async () => {
        if (get().workerUrl !== workerUrl || get().syncInterval !== syncInterval) return;
        await db.put('settings', { key: 'workerUrl', value: workerUrl });
        await db.put('settings', { key: 'syncInterval', value: syncInterval });
        sync.setWorkerUrl(workerUrl);
        sync.stopTimer();
        const creds = await sync.getAllBoardCreds();
        for (const c of creds) {
          if (!get().boards.some(b => b.id === c.boardId)) continue;
          await persist(c.boardId, () => []);
          if (await sync.isSyncPaused(c.boardId)) continue;
          if (!await sync.pullCrdtState(c.boardId, state => get().boards.some(b => b.id === c.boardId) ? mergeRemote(c.boardId, state) : Promise.resolve())) continue;
          await sync.pushCrdtOps(c.boardId);
        }
        sync.startTimer(syncInterval, () => {
          get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
        });
      });
      syncWork = run;
      return run;
    },

    joinBoard: async (boardId, password) => {
      if (get().boards.some(b => b.id === boardId)) {
        await persist(boardId, () => []);
        if (await sync.isSyncPaused(boardId)) {
          get().openModal('settings');
          throw new Error('This board is already on this device. Sync is paused to protect its data. Review Sync recovery in Settings before rejoining.');
        }
      }
      const keyHash = await CryptoService.hashKey(boardId, password);
      const ok = await sync.pullFromWorker(boardId, password, async (data, remote) => {
        const baseline = parseData(data, boardId);
        await persist(boardId, state => {
          mergeStates(state, baseline);
          if (remote) mergeStates(state, remote);
          // Carry legacy-only records into the operation log without giving stale data a new clock.
          const seeds: CrdtOp[] = [];
          for (const [store, type] of [['boards', 'board.update'], ['columns', 'column.create'], ['cards', 'card.create'], ['activity', 'activity.create']] as const) {
            for (const row of Object.values(baseline[store])) {
              if (remote?.[store][row.id] || state[store][row.id]?.__ts) continue;
              const seed = { boardId, opId: uid(), clientId: '', ts: 0, type, payload: { ...stripMeta(row), boardId } };
              applyOp(state, seed);
              seeds.push(seed);
            }
          }
          return seeds;
        }, { remote: true, remoteState: remote });
      }, keyHash);
      if (!ok) return false;
      // Boards whose server history lost the board record still need a sidebar entry.
      if (!get().boards.some((b) => b.id === boardId)) {
        await commit(boardId, [{ type: 'board.update', payload: { id: boardId, boardId, name: 'Shared board', createdAt: Date.now() } }]);
      }
      await sync.saveBoardCreds(boardId, keyHash, get().boards.find(b => b.id === boardId)!.name, password);
      await get().setActiveBoard(boardId);
      const { workerUrl, syncInterval } = get();
      get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
      return true;
    },

    beginSyncRepair: async (boardId) => {
      if (!get().boards.some(b => b.id === boardId)) throw new Error('Select an existing board to repair.');
      await persist(boardId, () => [], { pause: true });
    },

    overwriteImport: async (boardId, json) => {
      // Validate before pausing or writing anything, including multi-board exports.
      const snapshot = parseSnapshot(JSON.parse(json), boardId);
      for (const store of ['columns', 'cards', 'activity'] as const) {
        if (get()[store].some(row => row.boardId !== boardId && Object.hasOwn(snapshot[store], row.id))) throw new Error('Snapshot record IDs conflict with another board. No data was changed.');
      }
      await get().beginSyncRepair(boardId);
      const remote = await sync.readCrdtState(boardId);
      const saved = (await db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${boardId}`))!.value;
      await db.put('settings', { key: `syncRepairBackup:${boardId}:${uid()}`, value: { boardId, ...saved, remote, imported: snapshot } });
      const replacement = await sync.overwriteBoard(boardId, snapshot, remote);
      await persist(boardId, () => [], { replaceWith: replacement, resolveWith: remote ?? emptyState() });
      get().clearFilters();
      const { workerUrl, syncInterval } = get();
      await get().saveSettings({ workerUrl, syncInterval });
    },

    resolveSyncRecovery: async (boardId, source) => {
      const remote = await sync.readCrdtState(boardId);
      if (source === 'cloud' && !remote?.boards[boardId]) throw new Error('No complete cloud board is available. Keep this device’s copy or restore a backup.');
      const saved = await db.get<{ value: CrdtState }>('settings', `crdtState:${boardId}`);
      if (source === 'cloud' && generationOf(remote, boardId) && generationOf(saved?.value, boardId) !== generationOf(remote, boardId)) {
        // Accept a reset exactly, without relabelling old pending ops or resurrecting its Timeline.
        await persist(boardId, () => [], { replaceWith: remote!, resolveWith: remote! });
        const { workerUrl, syncInterval } = get();
        await get().saveSettings({ workerUrl, syncInterval });
        return;
      }
      await persist(boardId, state => {
        const chosen = source === 'local' ? structuredClone(state) : remote!;
        let after = 0;
        for (const version of [state, remote ?? emptyState()]) {
          for (const map of Object.values(version)) for (const row of Object.values(map)) after = Math.max(after, row.__ts ?? 0);
        }
        const ops: CrdtOp[] = [];
        for (const [store, type] of [['boards', 'board.update'], ['columns', 'column.create'], ['cards', 'card.create'], ['activity', 'activity.create']] as const) {
          // Activity is an audit trail, not a board position: retain both histories.
          const rows = store === 'activity' ? mergeStates(emptyState(), state).activity : chosen[store];
          if (store === 'activity') Object.assign(rows, remote?.activity);
          for (const id of new Set([...Object.keys(state[store]), ...Object.keys(remote?.[store] ?? {})])) {
            const row = rows[id];
            const deleted = !row || row.__deleted;
            if (deleted && (store === 'boards' || store === 'activity')) continue;
            const op = sync.createOp(boardId, deleted ? `${store === 'cards' ? 'card' : 'column'}.delete` : type,
              deleted ? { id, boardId } : { ...stripMeta(row), boardId, ...(store === 'boards' ? { syncProtocol: SYNC_PROTOCOL,
                ...(generationOf(remote, boardId) ? { syncGeneration: generationOf(remote, boardId) } : {}) } : {}) }, after);
            if (!validOp(op, boardId)) throw new Error('Invalid recovery operation');
            after = op.ts;
            applyOp(state, op);
            ops.push(op);
          }
        }
        return ops;
      }, { resolveWith: remote ?? emptyState() });
      const { workerUrl, syncInterval } = get();
      await get().saveSettings({ workerUrl, syncInterval });
    },

    exportSyncRecovery: async (boardId) => {
      const saved = await db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${boardId}`);
      if (!saved) throw new Error('No recovery backup is available.');
      // Include the cloud without merging it. A failed read must not prevent exporting the local backup.
      const remote = await sync.readCrdtState(boardId).catch(() => null);
      const current = get();
      const backups = (await db.getAll<{ key: string; value: { boardId?: string } }>('settings'))
        .filter(s => s.key.startsWith('syncRepairBackup:') && s.value.boardId === boardId).map(s => s.value);
      download({ boards: current.boards.filter(b => b.id === boardId), columns: current.columns.filter(c => c.boardId === boardId),
        cards: current.cards.filter(c => c.boardId === boardId), activity: current.activity.filter(a => a.boardId === boardId),
        recovery: { boardId, ...saved.value, remote: remote ?? saved.value.remote, backups } }, `flowboard-recovery-${boardId}-${Date.now()}.json`);
    },

    exportData: () => {
      const state = get();
      const data = { boards: state.boards, columns: state.columns, cards: state.cards, activity: state.activity };
      download(data, `flowboard-export-${Date.now()}.json`);
    },

    importData: async (json) => {
      const data = parseData(JSON.parse(json));
      const grouped = new Map<string, { type: string; payload: Record<string, unknown> }[]>();
      // Merging adds and edits records but never restores deleted ones; Overwrite import does.
      for (const [store, type] of [['boards', 'board.update'], ['columns', 'column.update'], ['cards', 'card.update'], ['activity', 'activity.create']] as const) {
        for (const row of Object.values(data[store]).map(stripMeta)) {
          // A regular additive import cannot change a board's repair generation.
          if (store === 'boards') delete row.syncGeneration;
          const boardId = String(store === 'boards' ? row.id : row.boardId);
          const list = grouped.get(boardId) ?? [];
          list.push({ type, payload: { ...row, boardId } });
          grouped.set(boardId, list);
        }
      }
      for (const [boardId, ops] of grouped) await commit(boardId, ops);
      get().toast('Data imported', '✓');
    },
  };
});
