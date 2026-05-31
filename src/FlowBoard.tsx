import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { create } from 'zustand';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ID = string;
type View = 'board' | 'calendar' | 'timeline';
type ActivityType = 'created' | 'moved' | 'updated' | 'deleted' | 'due_set';
type Priority = 'low' | 'medium' | 'high';
type StoreName = 'boards' | 'columns' | 'cards' | 'settings' | 'activity' | 'boardCreds' | 'crdtOps';

interface Board {
  id: ID;
  name: string;
  createdAt: number;
}

interface Column {
  id: ID;
  boardId: ID;
  name: string;
  order: number;
  color: string;
}

interface Card {
  id: ID;
  boardId: ID;
  columnId: ID | null;
  title: string;
  desc: string;
  tags: string[];
  color: string;
  priority: Priority;
  dueDate: string | null;
  order: number;
  createdAt: number;
}

interface ActivityEvent {
  id: ID;
  boardId: ID;
  cardId: ID;
  type: ActivityType;
  ts: number;
  cardTitle?: string;
  fromColId?: ID | null;
  toColId?: ID | null;
  fromColName?: string;
  toColName?: string;
  dueDate?: string | null;
}

interface BoardCred {
  boardId: ID;
  keyHash: string;
  name: string;
  lastSynced: number | null;
}

interface CrdtOp {
  opId: ID;
  type: string;
  ts: number;
  clientId: string;
  boardId: ID;
  payload: Record<string, unknown>;
}

interface ThemeDef {
  id: string;
  label: string;
  section: 'dark' | 'light';
  bg: string;
  surface: string;
  accent: string;
  accent2: string;
  dot3: string;
}

interface Toast {
  id: ID;
  message: string;
  icon: string;
}

interface ModalState {
  type: string;
  props?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'flowboard';
const DB_VERSION = 4;
const WORKER_URL = 'https://flowboard-worker.abdullahalkafajy.workers.dev';

const CARD_COLORS = [
  { name: 'none', value: 'transparent' },
  { name: 'violet', value: '#6c63ff' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'green', value: '#22c55e' },
  { name: 'yellow', value: '#f59e0b' },
  { name: 'red', value: '#ef4444' },
  { name: 'pink', value: '#ec4899' },
  { name: 'orange', value: '#f97316' },
  { name: 'indigo', value: '#818cf8' },
  { name: 'teal', value: '#14b8a6' },
] as const;

const COL_COLORS = ['#6c63ff', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#f97316'];

const THEMES: ThemeDef[] = [
  { id: 'void', label: 'Void', section: 'dark', bg: '#0a0a0f', surface: '#1e1e2a', accent: '#6c63ff', accent2: '#8b85ff', dot3: '#a78bfa' },
  { id: 'carbon', label: 'Carbon', section: 'dark', bg: '#0d0f12', surface: '#1a1e2c', accent: '#38bdf8', accent2: '#7dd3fc', dot3: '#818cf8' },
  { id: 'obsidian', label: 'Obsidian', section: 'dark', bg: '#111010', surface: '#201d1a', accent: '#f59e0b', accent2: '#fbbf24', dot3: '#f97316' },
  { id: 'noir', label: 'Noir', section: 'dark', bg: '#080808', surface: '#161616', accent: '#e0e0e0', accent2: '#f5f5f5', dot3: '#a0a0a0' },
  { id: 'dracula', label: 'Dracula', section: 'dark', bg: '#191921', surface: '#2b2d3e', accent: '#bd93f9', accent2: '#caa9fa', dot3: '#ff79c6' },
  { id: 'tokyo', label: 'Tokyo Night', section: 'dark', bg: '#0d0f17', surface: '#1e1f2e', accent: '#7aa2f7', accent2: '#89b4fa', dot3: '#bb9af7' },
  { id: 'nord', label: 'Nord', section: 'dark', bg: '#1a1f2e', surface: '#252b3b', accent: '#88c0d0', accent2: '#8fbcbb', dot3: '#81a1c1' },
  { id: 'solarized', label: 'Solarized', section: 'dark', bg: '#001f26', surface: '#08384a', accent: '#268bd2', accent2: '#2aa198', dot3: '#859900' },
  { id: 'snow', label: 'Snow', section: 'light', bg: '#f8fafc', surface: '#ffffff', accent: '#4f46e5', accent2: '#6366f1', dot3: '#7c3aed' },
  { id: 'paper', label: 'Paper', section: 'light', bg: '#faf7f0', surface: '#ffffff', accent: '#c05820', accent2: '#d97030', dot3: '#b87800' },
  { id: 'sage', label: 'Sage', section: 'light', bg: '#f4f6f2', surface: '#ffffff', accent: '#3d7a40', accent2: '#4e9452', dot3: '#2e7d32' },
];

const ACTIVITY_META: Record<ActivityType, { icon: string; label: string; color: string }> = {
  created: { icon: '✦', label: 'Created', color: '#22c55e' },
  moved: { icon: '→', label: 'Moved', color: '#6c63ff' },
  updated: { icon: '✎', label: 'Updated', color: '#06b6d4' },
  deleted: { icon: '✕', label: 'Deleted', color: '#ef4444' },
  due_set: { icon: '◷', label: 'Due set', color: '#f59e0b' },
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDue(dateStr: string | null) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, cls: 'overdue' };
  if (diffDays === 0) return { label: 'Due today', cls: 'due-today' };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, cls: 'due-soon' };
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SERVICE (batched writes)
// ─────────────────────────────────────────────────────────────────────────────

class DatabaseService {
  private db: IDBDatabase | null = null;

  async open(): Promise<this> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const stores: { name: StoreName; keyPath: string; indexes: string[] }[] = [
          { name: 'boards', keyPath: 'id', indexes: [] },
          { name: 'columns', keyPath: 'id', indexes: ['boardId'] },
          { name: 'cards', keyPath: 'id', indexes: ['boardId', 'columnId'] },
          { name: 'settings', keyPath: 'key', indexes: [] },
          { name: 'activity', keyPath: 'id', indexes: ['boardId', 'ts'] },
          { name: 'boardCreds', keyPath: 'boardId', indexes: [] },
          { name: 'crdtOps', keyPath: 'opId', indexes: ['boardId'] },
        ];
        for (const s of stores) {
          if (!db.objectStoreNames.contains(s.name)) {
            const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
            s.indexes.forEach((idx) => store.createIndex(idx, idx));
          }
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve(this);
      };
      req.onerror = () => reject(req.error);
    });
  }

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  put<T>(store: StoreName, obj: T): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }

  delete(store: StoreName, key: string): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  batchPut<T extends Record<string, unknown>>(store: StoreName, items: T[]): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const item of items) os.put(item);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO SERVICE (no plaintext passwords; in-memory key cache only)
// ─────────────────────────────────────────────────────────────────────────────

const keyCache = new Map<string, CryptoKey>();

class CryptoService {
  private static simpleHash(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c;
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return (
      h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
    ).repeat(4);
  }

  static async hashKey(boardId: string, password: string): Promise<string> {
    const raw = `${boardId}:${password}`;
    if (!crypto?.subtle) return this.simpleHash(raw);
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return this.simpleHash(raw);
    }
  }

  private static async deriveKey(boardId: string, password: string): Promise<CryptoKey> {
    const mat = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(`flowboard:${boardId}`),
        iterations: 100000,
        hash: 'SHA-256',
      },
      mat,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async getKey(boardId: string, password: string): Promise<CryptoKey> {
    const cacheKey = `${boardId}:${password}`;
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)!;
    const key = await this.deriveKey(boardId, password);
    keyCache.set(cacheKey, key);
    return key;
  }

  static async encrypt(boardId: string, password: string, data: unknown): Promise<unknown> {
    if (!crypto?.subtle) return data;
    try {
      const key = await this.getKey(boardId, password);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(data))
      );
      const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { enc: 1, iv: toB64(iv), ct: toB64(ct) };
    } catch {
      return data;
    }
  }

  static async decrypt(boardId: string, password: string, payload: unknown): Promise<unknown> {
    const p = payload as { enc?: number; iv?: string; ct?: string } | null;
    if (!p?.enc) return payload;
    if (!crypto?.subtle) throw new Error('Encryption requires HTTPS');
    const key = await this.getKey(boardId, password);
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(p.iv!) },
        key,
        fromB64(p.ct!)
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('Decryption failed — wrong password?');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class SyncService {
  private db: DatabaseService;
  private workerUrl: string;
  private clientId: string;
  private onStatusChange: (ok: boolean) => void;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: DatabaseService, workerUrl: string, onStatusChange: (ok: boolean) => void) {
    this.db = db;
    this.workerUrl = (workerUrl || WORKER_URL).replace(/\/$/, '');
    this.onStatusChange = onStatusChange;
    this.clientId = localStorage.getItem('fbClientId') || (() => {
      const id = uid();
      localStorage.setItem('fbClientId', id);
      return id;
    })();
  }

  setWorkerUrl(url: string) {
    this.workerUrl = (url || WORKER_URL).replace(/\/$/, '');
  }

  private url(path: string) {
    return `${this.workerUrl}${path}`;
  }

  private async fetchJson(path: string, body: unknown, timeout = 8000) {
    const r = await fetch(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return r;
  }

  async getBoardCreds(boardId: string): Promise<BoardCred | undefined> {
    return this.db.get('boardCreds', boardId);
  }

  async getAllBoardCreds(): Promise<BoardCred[]> {
    return this.db.getAll('boardCreds');
  }

  async saveBoardCreds(boardId: string, keyHash: string, name: string) {
    await this.db.put('boardCreds', { boardId, keyHash, name, lastSynced: null });
  }

  async emitOp(boardId: string, type: string, payload: Record<string, unknown>) {
    const op: CrdtOp = {
      opId: uid(),
      type,
      ts: Date.now(),
      clientId: this.clientId,
      boardId,
      payload,
    };
    await this.db.put('crdtOps', op);
  }

  async pushToWorker(boardId: string, state: Pick<FlowState, 'boards' | 'columns' | 'cards' | 'activity'>, password: string): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    const plainData = {
      boards: state.boards.filter((b) => b.id === boardId),
      columns: state.columns.filter((c) => c.boardId === boardId),
      cards: state.cards.filter((c) => c.boardId === boardId),
      activity: state.activity.filter((a) => a.boardId === boardId),
    };
    try {
      const data = await CryptoService.encrypt(boardId, password, plainData);
      const r = await this.fetchJson('/api/board/put', { boardId, keyHash: creds.keyHash, data });
      if (r.ok) {
        await this.db.put('boardCreds', { ...creds, lastSynced: Date.now() });
        this.onStatusChange(true);
        return true;
      }
      this.onStatusChange(false);
      return false;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  async pullFromWorker(boardId: string, password: string, mergeCallback: (data: unknown) => void): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    try {
      const r = await this.fetchJson('/api/board/get', { boardId, keyHash: creds.keyHash });
      if (!r.ok) {
        this.onStatusChange(false);
        return false;
      }
      const { found, data: rawData } = (await r.json()) as { found: boolean; data: unknown };
      if (!found) {
        this.onStatusChange(true);
        return false;
      }
      const data = await CryptoService.decrypt(boardId, password, rawData);
      mergeCallback(data);
      this.onStatusChange(true);
      return true;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  async pushCrdtOps(boardId: string, password: string): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    const allOps = await this.db.getAll<CrdtOp>('crdtOps');
    const pending = allOps.filter((o) => o.boardId === boardId);
    if (!pending.length) return false;
    try {
      const r = await this.fetchJson('/api/crdt/ops/push', { boardId, keyHash: creds.keyHash, ops: pending });
      if (r.ok) {
        for (const op of pending) await this.db.delete('crdtOps', op.opId);
        this.onStatusChange(true);
        return true;
      }
      this.onStatusChange(false);
      return false;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  async pullCrdtOps(boardId: string, password: string, applyCallback: (op: CrdtOp, clientId: string) => boolean): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    const metaKey = `crdtMeta:${boardId}`;
    const metaRow = await this.db.get<{ key: string; value: { lastPulledTs: number } }>('settings', metaKey);
    const since = metaRow?.value?.lastPulledTs || 0;
    try {
      const r = await this.fetchJson('/api/crdt/ops/pull', { boardId, keyHash: creds.keyHash, since });
      if (!r.ok) {
        this.onStatusChange(false);
        return false;
      }
      const { ops } = (await r.json()) as { ops?: CrdtOp[] };
      if (ops?.length) {
        const changed = ops.reduce((acc, op) => applyCallback(op, this.clientId) || acc, false);
        const maxTs = Math.max(...ops.map((o) => o.ts));
        await this.db.put('settings', { key: metaKey, value: { lastPulledTs: maxTs } });
        this.onStatusChange(true);
        return changed;
      }
      this.onStatusChange(true);
      return false;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  startTimer(intervalSecs: number, callback: () => void) {
    this.stopTimer();
    this.syncTimer = setInterval(callback, intervalSecs * 1000);
  }

  stopTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZUSTAND STORE
// ─────────────────────────────────────────────────────────────────────────────

interface FlowState {
  boards: Board[];
  columns: Column[];
  cards: Card[];
  activity: ActivityEvent[];
  activeBoardId: string | null;
  activeView: View;
  activeTheme: string;
  backlogOpen: boolean;
  searchQuery: string;
  showDueDateOnly: boolean;
  calendarDate: Date;
  modal: ModalState | null;
  toasts: Toast[];
  workerStatus: boolean;
  workerUrl: string;
  syncInterval: number;
  isLoading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setActiveBoard: (id: string | null) => Promise<void>;
  setActiveView: (view: View) => void;
  setSearchQuery: (q: string) => void;
  toggleBacklog: () => Promise<void>;
  toggleDueDateOnly: () => void;
  setCalendarDate: (d: Date) => void;
  openModal: (type: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  toast: (message: string, icon?: string) => void;
  createBoard: (name: string, password: string) => Promise<void>;
  renameBoard: (id: string, name: string) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  createColumn: (boardId: string, name: string) => Promise<void>;
  updateColumn: (id: string, updates: Partial<Column>) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  createCard: (boardId: string, columnId: string | null, data: Partial<Card>) => Promise<void>;
  updateCard: (id: string, updates: Partial<Card>) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (cardId: string, targetColumnId: string | null, targetIndex: number) => Promise<void>;
  reorderColumns: (orderedIds: string[]) => Promise<void>;
  saveTheme: (id: string) => Promise<void>;
  saveSettings: (settings: { workerUrl: string; syncInterval: number }) => Promise<void>;
  joinBoard: (boardId: string, password: string) => Promise<boolean>;
  exportData: () => void;
  importData: (json: string) => Promise<void>;
  applyCrdtOp: (op: CrdtOp, clientId: string) => boolean;
}

const db = new DatabaseService();
const sync = new SyncService(db, WORKER_URL, (ok) => useFlowStore.setState({ workerStatus: ok }));

export const useFlowStore = create<FlowState>((set, get) => {
  const applyTheme = (id: string) => {
    const theme = THEMES.find((t) => t.id === id) || THEMES[0];
    document.documentElement.setAttribute('data-theme', theme.id);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme.bg;
  };

  const recordActivity = async (boardId: string, cardId: string, type: ActivityType, meta: Partial<ActivityEvent> = {}) => {
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

    setActiveView: (view) => set({ activeView: view }),
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
      // Seed default columns
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
        priority: (data.priority as Priority) || 'medium',
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

      // Build next state functionally
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

    applyCrdtOp: (op, clientId) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// DND COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SortableCard({ card }: { card: Card }) {
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

function SortableColumn({ col, cards }: { col: Column; cards: Card[] }) {
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

function DragOverlayContent({ id }: { id: string }) {
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

// ─────────────────────────────────────────────────────────────────────────────
// VIEWS
// ─────────────────────────────────────────────────────────────────────────────

function BoardView() {
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

  // Custom collision: pointer-within first (catches large empty droppables like backlog),
  // fall back to rect-intersection so column/card sorting still works.
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
      // Auto-open backlog when a card is dragged over it
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

function BacklogDropSentinel() {
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

function Backlog() {
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

function CalendarView() {
  const store = useFlowStore();
  const calendarDate = store.calendarDate;
  const cards = store.cards;
  const activity = store.activity;
  const activeBoardId = store.activeBoardId;
  const showDueOnly = store.showDueDateOnly;
  const query = store.searchQuery.toLowerCase();

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const boardCards = cards.filter((c) => !activeBoardId || c.boardId === activeBoardId);
  const boardActivity = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);

  const matchesQuery = useCallback(
    (c: Card | undefined, ev: ActivityEvent | undefined) => {
      if (!query) return true;
      const q = query;
      return (
        (c?.title || '').toLowerCase().includes(q) ||
        (c?.desc || '').toLowerCase().includes(q) ||
        (c?.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (ev?.cardTitle || '').toLowerCase().includes(q)
      );
    },
    [query]
  );

  const days = useMemo(() => {
    const cells: Array<
      | { type: 'prev' | 'next'; day: number }
      | {
          type: 'current';
          day: number;
          isToday: boolean;
          seenCards: Map<string, ActivityEvent>;
          dueOnlyCards: Card[];
        }
    > = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ type: 'prev', day: new Date(year, month, -firstDay + i + 1).getDate() });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const dayEvents = boardActivity.filter((e) => {
        if (showDueOnly && e.type !== 'due_set') return false;
        const ed = new Date(e.ts);
        return ed.getFullYear() === year && ed.getMonth() === month && ed.getDate() === d;
      });
      const dayDueCards = showDueOnly
        ? boardCards.filter((c) => {
            if (!c.dueDate) return false;
            const cd = new Date(c.dueDate);
            return cd.getFullYear() === year && cd.getMonth() === month && cd.getDate() === d && matchesQuery(c, undefined);
          })
        : [];

      const priority = { moved: 5, created: 4, due_set: 3, updated: 2, deleted: 1 } as Record<string, number>;
      const seenCards = new Map<string, ActivityEvent>();
      for (const ev of dayEvents) {
        const prev = seenCards.get(ev.cardId);
        if (!prev || (priority[ev.type] || 0) > (priority[prev.type] || 0)) {
          const c = boardCards.find((x) => x.id === ev.cardId);
          if (matchesQuery(c, ev)) seenCards.set(ev.cardId, ev);
        }
      }
      const dueOnlyCards = dayDueCards.filter((c) => !seenCards.has(c.id));
      cells.push({ type: 'current', day: d, isToday, seenCards, dueOnlyCards });
    }
    const total = firstDay + daysInMonth;
    const remaining = total % 7 ? 7 - (total % 7) : 0;
    for (let i = 1; i <= remaining; i++) cells.push({ type: 'next', day: i });
    return cells;
  }, [firstDay, daysInMonth, year, month, boardCards, boardActivity, showDueOnly, matchesQuery]);

  const prevMonth = () => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() - 1);
    store.setCalendarDate(d);
  };
  const nextMonth = () => {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() + 1);
    store.setCalendarDate(d);
  };

  return (
    <div id="calendar-view">
      <div className="cal-nav">
        <div className="cal-month-label">{monthLabel}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button className={`cal-nav-btn${showDueOnly ? ' active' : ''}`} onClick={() => store.toggleDueDateOnly()}>
            ◷ Due only
          </button>
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <button className="cal-nav-btn" onClick={() => store.setCalendarDate(new Date())}>Today</button>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
      </div>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="cal-day-header">{d}</div>
        ))}
        {days.map((cell, i) => {
          if (cell.type !== 'current') {
            return (
              <div key={i} className="cal-day other-month">
                <div className="cal-day-num">{cell.day}</div>
              </div>
            );
          }
          const hasEvents = cell.seenCards.size + cell.dueOnlyCards.length > 0;
          return (
            <div
              key={i}
              className={`cal-day${cell.isToday ? ' today' : ''}${hasEvents ? ' has-events' : ''}`}
              onClick={
                hasEvents
                  ? () =>
                      store.openModal('dayDetail', {
                        day: cell.day,
                        month,
                        year,
                        dayEvents: Array.from(cell.seenCards.values()),
                        dayDueCards: cell.dueOnlyCards,
                      })
                  : undefined
              }
            >
              <div className="cal-day-num">{cell.day}</div>
              {hasEvents && (
                <div className="cal-chips">
                  {Array.from(cell.seenCards.values()).map((ev) => {
                    const card = boardCards.find((c) => c.id === ev.cardId);
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const color = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    return <div key={ev.id} className="cal-card-chip" style={{ background: color }} title={card?.title} />;
                  })}
                  {cell.dueOnlyCards.map((card) => (
                    <div
                      key={card.id}
                      className="cal-card-chip"
                      style={{ background: card.color !== 'transparent' ? card.color : 'var(--yellow)', opacity: 0.6 }}
                      title={`${card.title}: Due`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineView() {
  const store = useFlowStore();
  const activity = store.activity;
  const cards = store.cards;
  const activeBoardId = store.activeBoardId;
  const showDueOnly = store.showDueDateOnly;
  const query = store.searchQuery.toLowerCase();

  const events = useMemo(() => {
    let evs = activity.filter((e) => !activeBoardId || e.boardId === activeBoardId);
    if (showDueOnly) evs = evs.filter((e) => e.type === 'due_set');
    if (query) {
      evs = evs.filter((e) => {
        const card = cards.find((c) => c.id === e.cardId);
        return (
          (e.cardTitle || card?.title || '').toLowerCase().includes(query) ||
          (card?.desc || '').toLowerCase().includes(query) ||
          (card?.tags || []).some((t) => t.toLowerCase().includes(query))
        );
      });
    }
    return evs.sort((a, b) => b.ts - a.ts);
  }, [activity, cards, activeBoardId, showDueOnly, query]);

  const dayKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const byDay = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const ev of events) {
      const k = dayKey(ev.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    }
    return map;
  }, [events]);

  const formatDayH = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    if (dayKey(ts) === dayKey(today.getTime())) return 'Today';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div id="timeline-view">
      <div className="tl-header">
        <div>
          <div className="tl-title">Activity</div>
          <div className="tl-subtitle">Board history · scroll down for older events</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className={`cal-nav-btn${showDueOnly ? ' active' : ''}`} onClick={() => store.toggleDueDateOnly()}>
            {showDueOnly ? '◷ All activity' : '◷ Due only'}
          </button>
        </div>
      </div>
      <div className="tl-container">
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🕓</div>
            <div className="empty-state-title">{showDueOnly ? 'No due date activity' : 'No activity yet'}</div>
            <div className="empty-state-text">
              {showDueOnly ? 'Set due dates on cards to see them here' : 'Move, create, or edit cards to build a history'}
            </div>
          </div>
        ) : (
          Array.from(byDay.entries()).map(([dk, dayEvs]) => {
            const isToday = dk === dayKey(Date.now());
            return (
              <div key={dk}>
                <div className={`tl-day-heading${isToday ? ' tl-day-today' : ''}`}>
                  <span className="tl-day-label">{formatDayH(dayEvs[0].ts)}</span>
                  <span className="tl-day-count">
                    {dayEvs.length} event{dayEvs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="tl-day-block">
                  {dayEvs.map((ev, i) => {
                    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
                    const card = cards.find((c) => c.id === ev.cardId);
                    const cardColor = card?.color && card.color !== 'transparent' ? card.color : meta.color;
                    const isLast = i === dayEvs.length - 1;
                    return (
                      <div key={ev.id} className="tl-entry">
                        <div className={`tl-entry-spine${isLast ? ' tl-entry-spine-last' : ''}`}>
                          <div
                            className="tl-entry-dot"
                            style={{
                              background: cardColor,
                              boxShadow: `0 0 0 3px var(--bg2),0 0 0 5px ${cardColor}55`,
                            }}
                          />
                        </div>
                        <div
                          className={`tl-entry-body${card ? ' clickable' : ''}`}
                          onClick={card ? () => store.openModal('card', { card }) : undefined}
                        >
                          <div className="tl-entry-header">
                            <span className="tl-entry-icon" style={{ color: meta.color }}>{meta.icon}</span>
                            <span className="tl-entry-type" style={{ color: meta.color }}>{meta.label}</span>
                            <span className="tl-entry-time">{formatTime(ev.ts)}</span>
                          </div>
                          <div className="tl-entry-desc">
                            {ev.type === 'moved'
                              ? `${ev.cardTitle || card?.title}: ${ev.fromColName || 'Backlog'} → ${ev.toColName || 'Backlog'}`
                              : ev.type === 'created'
                              ? `${ev.cardTitle || card?.title} added to ${ev.toColName || 'Backlog'}`
                              : ev.type === 'deleted'
                              ? `${ev.cardTitle || 'Card'} removed from ${ev.fromColName || 'Backlog'}`
                              : ev.type === 'due_set'
                              ? `${ev.cardTitle || card?.title}: due date set`
                              : `${ev.cardTitle || card?.title} updated`}
                          </div>
                          <div className="tl-entry-footer">
                            {card ? (
                              <span className="tl-entry-card-link">Open card →</span>
                            ) : (
                              <span className="tl-entry-card-deleted">Card no longer exists</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODALS
// ─────────────────────────────────────────────────────────────────────────────

function CardModal({ card, defaultColId, defaultBoardId }: { card?: Card; defaultColId?: string; defaultBoardId?: string }) {
  const store = useFlowStore();
  const columns = store.columns;
  const activeBoardId = store.activeBoardId;
  const boardId = card?.boardId || defaultBoardId || activeBoardId || '';
  const isNew = !card;
  const boardCols = columns.filter((c) => c.boardId === boardId);
  const trapRef = useFocusTrap(true);

  const [title, setTitle] = useState(card?.title || '');
  const [desc, setDesc] = useState(card?.desc || '');
  const [colId, setColId] = useState(card?.columnId ?? defaultColId ?? '');
  const [priority, setPriority] = useState<Priority>(card?.priority || 'medium');
  const [dueDate, setDueDate] = useState(card?.dueDate || '');
  const [tags, setTags] = useState((card?.tags || []).join(', '));
  const [color, setColor] = useState(card?.color || 'transparent');

  const save = async () => {
    if (!title.trim()) {
      store.toast('Title required', '⚠');
      return;
    }
    const data: Partial<Card> = {
      title: title.trim(),
      desc: desc.trim(),
      columnId: colId || null,
      priority,
      dueDate: dueDate || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      color,
    };
    store.closeModal();
    if (isNew) {
      await store.createCard(boardId, colId || null, data);
      store.toast('Card created', '✓');
    } else {
      await store.updateCard(card!.id, data);
      store.toast('Saved', '✓');
    }
  };

  const del = async () => {
    if (confirm('Delete this card?')) {
      await store.deleteCard(card!.id);
      store.closeModal();
      store.toast('Card deleted', '🗑');
    }
  };

  return (
    <div className="modal modal-lg" ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">
        {isNew ? '＋ New Card' : '✏ Edit Card'}
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className="form-group">
        <label className="form-label">Title</label>
        <input
          className="form-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Card title..."
          autoFocus
        />
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea
          className="form-textarea"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Details, notes, links..."
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Column</label>
          <select className="form-select" value={colId} onChange={(e) => setColId(e.target.value)}>
            <option value="">— Backlog —</option>
            {boardCols.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Priority</label>
          <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Due Date</label>
          <input className="form-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Tags (comma separated)</label>
          <input
            className="form-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="bug, urgent, ui..."
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Color</label>
        <div className="color-picker">
          {CARD_COLORS.map((c) => (
            <div
              key={c.value}
              className={`color-option${color === c.value ? ' selected' : ''}`}
              style={{
                background: c.value === 'transparent' ? 'var(--bg4)' : c.value,
                border: c.value === 'transparent' ? '1px solid var(--border2)' : 'none',
              }}
              title={c.name}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>
      </div>
      <div className="modal-actions">
        {!isNew && (
          <button className="btn btn-danger" onClick={del}>🗑 Delete</button>
        )}
        <button className="btn btn-secondary" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? 'Create Card' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

function AddColumnModal({ boardId }: { boardId: string }) {
  const store = useFlowStore();
  const [name, setName] = useState('');
  const trapRef = useFocusTrap(true);
  const create = async () => {
    if (!name.trim()) return;
    store.closeModal();
    await store.createColumn(boardId, name.trim());
    store.toast('Column added', '✓');
  };
  return (
    <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">
        ＋ New Column
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className="form-group">
        <label className="form-label">Column Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. In Review, Done, Testing..."
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={create}>Create Column</button>
      </div>
    </div>
  );
}

function AddBoardModal() {
  const store = useFlowStore();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const trapRef = useFocusTrap(true);
  const create = async () => {
    if (!name.trim()) {
      store.toast('Name required', '⚠');
      return;
    }
    store.closeModal();
    await store.createBoard(name.trim(), pw || uid());
    store.toast(`Board "${name}" created`, '✓');
  };
  return (
    <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">
        ＋ New Board
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className="form-group">
        <label className="form-label">Board Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project..."
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Sync Password (optional)</label>
        <input
          className="form-input"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="For cloud sync across devices..."
        />
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={create}>Create Board</button>
      </div>
    </div>
  );
}

function ColColorModal({ col }: { col: Column }) {
  const store = useFlowStore();
  const trapRef = useFocusTrap(true);
  return (
    <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()} style={{ width: '260px' }}>
      <div className="modal-title">
        Column Color
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className="color-picker">
        {CARD_COLORS.filter((c) => c.value !== 'transparent').map((c) => (
          <div
            key={c.value}
            className={`color-option${col.color === c.value ? ' selected' : ''}`}
            style={{ background: c.value }}
            title={c.name}
            onClick={async () => {
              await store.updateColumn(col.id, { color: c.value });
              store.closeModal();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ColMenuModal({ col }: { col: Column }) {
  const store = useFlowStore();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(col.name);
  const trapRef = useFocusTrap(true);

  if (renaming) {
    return (
      <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Rename Column
          <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
        </div>
        <div className="form-group">
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                await store.updateColumn(col.id, { name });
                store.closeModal();
              }
            }}
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => store.closeModal()}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await store.updateColumn(col.id, { name });
              store.closeModal();
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()} style={{ width: '220px', padding: '8px' }}>
      <button className="modal-close" onClick={() => store.closeModal()} style={{ marginLeft: 'auto', display: 'block' }} aria-label="Close">
        ✕
      </button>
      <button className="col-menu-item" onClick={() => setRenaming(true)}>✏ Rename</button>
      <button
        className="col-menu-item"
        onClick={async () => {
          if (confirm('Delete column? Cards move to backlog.')) {
            store.closeModal();
            await store.deleteColumn(col.id);
            store.toast('Column deleted', '🗑');
          }
        }}
      >
        🗑 Delete Column
      </button>
    </div>
  );
}

function ThemeModal() {
  const store = useFlowStore();
  const activeTheme = store.activeTheme;
  const trapRef = useFocusTrap(true);
  return (
    <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()} style={{ width: '340px' }}>
      <div className="modal-title">
        🎨 Themes
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      {(['dark', 'light'] as const).map((section) => {
        const sectionThemes = THEMES.filter((t) => t.section === section);
        return (
          <div key={section}>
            <div className="theme-section-label">{section === 'dark' ? 'Dark' : 'Light'}</div>
            <div className="theme-grid">
              {sectionThemes.map((t) => (
                <div
                  key={t.id}
                  className={`theme-swatch${activeTheme === t.id ? ' active' : ''}`}
                  onClick={() => store.saveTheme(t.id)}
                >
                  <div className="theme-swatch-dots">
                    <div className="theme-swatch-dot" style={{ background: t.accent }} />
                    <div className="theme-swatch-dot" style={{ background: t.accent2 }} />
                    <div className="theme-swatch-dot" style={{ background: t.dot3 }} />
                  </div>
                  <span className="theme-swatch-label">{t.label}</span>
                  {activeTheme === t.id && <span className="theme-swatch-sub">active</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsModal() {
  const store = useFlowStore();
  const workerUrl = store.workerUrl;
  const syncInterval = store.syncInterval;
  const workerStatus = store.workerStatus;
  const [url, setUrl] = useState(workerUrl || WORKER_URL);
  const [syncIntervalVal, setSyncIntervalVal] = useState(syncInterval || 600);
  const [joinId, setJoinId] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [saving, setSaving] = useState(false);
  const trapRef = useFocusTrap(true);

  const save = async () => {
    setSaving(true);
    await store.saveSettings({ workerUrl: url, syncInterval: parseInt(String(syncIntervalVal)) });
    store.toast('Settings saved', '✓');
    setSaving(false);
  };

  const join = async () => {
    if (!joinId || !joinPw) {
      store.toast('Board ID and password required', '⚠');
      return;
    }
    const ok = await store.joinBoard(joinId.trim(), joinPw);
    store.toast(ok ? 'Board joined!' : 'Could not find board', ok ? '✓' : '⚠');
    if (ok) store.closeModal();
  };

  return (
    <div className="modal modal-lg" ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">
        ⚙ Settings
        <button className="modal-close" onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Cloud Sync</div>
        <div className="server-indicator">
          <div
            className="dot"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: workerStatus ? 'var(--green)' : 'var(--red)',
            }}
          />
          <span>{workerStatus ? 'Worker reachable' : 'Worker unreachable'}</span>
        </div>
        <div className="form-group">
          <label className="form-label">Worker URL</label>
          <input className="form-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={WORKER_URL} />
        </div>
        <div className="form-group">
          <label className="form-label">Sync Interval</label>
          <select
            className="form-select"
            value={syncIntervalVal}
            onChange={(e) => setSyncIntervalVal(e.target.value)}
            style={{ width: '200px' }}
          >
            <option value={60}>Every minute</option>
            <option value={300}>Every 5 minutes</option>
            <option value={600}>Every 10 minutes</option>
            <option value={1800}>Every 30 minutes</option>
            <option value={3600}>Every hour</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Join a Board</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Board ID</label>
            <input className="form-input" value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Paste board ID..." />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={joinPw}
              onChange={(e) => setJoinPw(e.target.value)}
              placeholder="Board password..."
            />
          </div>
        </div>
        <button className="btn btn-primary" onClick={join} style={{ width: '100%' }}>
          Join Board
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Data</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => store.exportData()}>Export JSON</button>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Import JSON
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                await store.importData(text);
              }}
            />
          </label>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => store.closeModal()}>Close</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function DayDetailModal({ day, month, year, dayEvents, dayDueCards }: {
  day: number; month: number; year: number;
  dayEvents: ActivityEvent[]; dayDueCards: Card[];
}) {
  const store = useFlowStore();
  const label = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-title">
        <span>{label}</span>
        <button className="modal-close" onClick={() => store.closeModal()}>✕</button>
      </div>
      {dayEvents.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Activity</div>
          {dayEvents.map((ev) => {
            const card = store.cards.find((c) => c.id === ev.cardId);
            const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
            const color = card?.color && card.color !== 'transparent' ? card.color : meta.color;
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border)', cursor: card ? 'pointer' : 'default' }}
                onClick={() => card && (store.closeModal(), setTimeout(() => store.openModal('card', { card }), 50))}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card?.title ?? ev.cardTitle ?? 'Deleted card'}
                </span>
                <span style={{ fontSize: 10, color: meta.color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{meta.icon} {meta.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {dayDueCards.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Due</div>
          {dayDueCards.map((card) => (
            <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => (store.closeModal(), setTimeout(() => store.openModal('card', { card }), 50))}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: card.color !== 'transparent' ? card.color : 'var(--yellow)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{card.title}</span>
              <span style={{ fontSize: 10, color: 'var(--yellow)', fontFamily: 'var(--font-mono)' }}>◷ Due</span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => store.closeModal()}>Close</button>
      </div>
    </div>
  );
}

function ModalRouter() {
  const store = useFlowStore();
  const modal = store.modal;
  if (!modal) return null;

  const renderContent = () => {
    switch (modal.type) {
      case 'dayDetail':
        return (
          <DayDetailModal
            day={modal.props?.day as number}
            month={modal.props?.month as number}
            year={modal.props?.year as number}
            dayEvents={modal.props?.dayEvents as ActivityEvent[]}
            dayDueCards={modal.props?.dayDueCards as Card[]}
          />
        );
      case 'card':
        return (
          <CardModal
            card={modal.props?.card as Card}
            defaultColId={modal.props?.defaultColId as string}
            defaultBoardId={modal.props?.defaultBoardId as string}
          />
        );
      case 'addColumn':
        return <AddColumnModal boardId={(modal.props?.boardId as string) || ''} />;
      case 'addBoard':
        return <AddBoardModal />;
      case 'colColor':
        return <ColColorModal col={modal.props?.col as Column} />;
      case 'colMenu':
      case 'renameCol':
        return <ColMenuModal col={modal.props?.col as Column} />;
      case 'theme':
        return <ThemeModal />;
      case 'settings':
        return <SettingsModal />;
      default:
        return null;
    }
  };

  return (
    <div className="modal-overlay" onClick={() => store.closeModal()} role="dialog" aria-modal="true">
      {renderContent()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHELL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function ToastContainer() {
  const toasts = useFlowStore((s) => s.toasts);
  return (
    <div id="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-icon">{t.icon}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function Header() {
  const store = useFlowStore();
  const boards = useFlowStore((s) => s.boards);
  const activeBoardId = useFlowStore((s) => s.activeBoardId);
  const activeView = useFlowStore((s) => s.activeView);
  const workerStatus = useFlowStore((s) => s.workerStatus);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === '/' || e.key === 'f') && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        store.closeModal();
        setSearchVisible(false);
        store.setSearchQuery('');
        setMenuOpen(false);
      }
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        store.openModal('card', {});
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [store]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const toggleSearch = () => {
    const next = !searchVisible;
    setSearchVisible(next);
    if (!next) {
      setSearchVal('');
      store.setSearchQuery('');
    } else {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  };

  const [menuSearch, setMenuSearch] = useState('');

  return (
    <>
      <header id="header">
        {/* Desktop: logo + board tabs + add board */}
        <span id="logo" className="desktop-only" style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>FlowBoard</span>
        <div id="board-tabs" role="tablist" className="desktop-only">
          {boards.map((b) => (
            <div
              key={b.id}
              role="tab"
              aria-selected={b.id === activeBoardId}
              className={`board-tab${b.id === activeBoardId ? ' active' : ''}`}
              onClick={() => store.setActiveBoard(b.id)}
              onDoubleClick={() => {
                const n = prompt('Rename board:', b.name);
                if (n?.trim()) store.renameBoard(b.id, n.trim());
              }}
              title="Double-click to rename"
            >
              {b.name}
              <span
                className="board-tab-del"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${b.name}"?`)) store.deleteBoard(b.id);
                }}
                title="Delete board"
              >
                ×
              </span>
            </div>
          ))}
        </div>
        <button id="add-board-btn" className="desktop-only" onClick={() => store.openModal('addBoard', {})} aria-label="New board" title="New board">
          +
        </button>
        <div className="header-spacer desktop-only" />

        {/* Mobile: hamburger button (left) */}
        <button id="hamburger-btn" className="mobile-only header-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
          ☰
        </button>

        {/* View tabs – always visible */}
        <div className="view-tabs" role="tablist">
          {(['board', 'calendar', 'timeline'] as View[]).map((v) => (
            <div
              key={v}
              role="tab"
              aria-selected={activeView === v}
              className={`view-tab${activeView === v ? ' active' : ''}`}
              onClick={() => store.setActiveView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </div>
          ))}
        </div>

        {/* Desktop: actions */}
        <div id="header-actions" className="desktop-only">
          <button className="header-btn" onClick={toggleSearch} aria-label="Search (/)" title="Search (/)">
            🔍
          </button>
          <div
            id="server-status"
            className={workerStatus ? 'ok' : 'err'}
            onClick={() => store.openModal('settings', {})}
            title="Click to open settings"
          >
            <div className="dot" />
            <span id="server-status-text">{workerStatus ? 'connected' : 'local'}</span>
          </div>
          <button className="header-btn" onClick={() => store.openModal('theme', {})} aria-label="Switch theme" title="Switch theme">
            🎨
          </button>
          <button className="header-btn" onClick={() => store.openModal('settings', {})} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {/* Desktop search bar */}
      {searchVisible && (
        <div id="search-bar">
          <input
            ref={searchRef}
            id="search-input"
            value={searchVal}
            onChange={(e) => {
              setSearchVal(e.target.value);
              store.setSearchQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchVisible(false);
                setSearchVal('');
                store.setSearchQuery('');
              }
            }}
            placeholder="Search cards by title, tag, description..."
            autoComplete="off"
          />
        </div>
      )}

      {/* Mobile slide-in menu */}
      {menuOpen && (
        <div id="mobile-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div id="mobile-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <div id="mobile-menu-header">
              <span id="mobile-menu-logo" style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>FlowBoard</span>
              <button id="mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
            </div>

            {/* Search */}
            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Search</div>
              <input
                ref={menuSearchRef}
                className="form-input"
                value={menuSearch}
                onChange={(e) => { setMenuSearch(e.target.value); store.setSearchQuery(e.target.value); }}
                placeholder="Search cards..."
                autoComplete="off"
              />
            </div>

            {/* Boards */}
            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Boards</div>
              {boards.length === 0 && <div className="mobile-menu-empty">No boards yet</div>}
              {boards.map((b) => (
                <div
                  key={b.id}
                  className={`mobile-menu-board-item${b.id === activeBoardId ? ' active' : ''}`}
                  onClick={() => { store.setActiveBoard(b.id); setMenuOpen(false); }}
                >
                  <span className="mobile-menu-board-name">{b.name}</span>
                  {b.id === activeBoardId && <span className="mobile-menu-board-check">✓</span>}
                  <span
                    className="mobile-menu-board-del"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${b.name}"?`)) { store.deleteBoard(b.id); setMenuOpen(false); } }}
                  >✕</span>
                </div>
              ))}
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('addBoard', {}); setMenuOpen(false); }}>
                + New Board
              </button>
            </div>

            {/* Server status */}
            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Status</div>
              <div className={`mobile-menu-status${workerStatus ? ' ok' : ' err'}`} onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}>
                <div className="dot" />
                <span>{workerStatus ? 'Connected to server' : 'Local only'}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Options</div>
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('theme', {}); setMenuOpen(false); }}>
                🎨 Switch Theme
              </button>
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}>
                ⚙ Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="empty-state" style={{ height: '100vh' }}>
          <div className="empty-state-icon">⚠</div>
          <div className="empty-state-title">Something went wrong</div>
          <div className="empty-state-text" style={{ fontFamily: 'var(--font-mono)', maxWidth: '600px' }}>
            {this.state.error?.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const store = useFlowStore();
  const activeView = store.activeView;
  const isLoading = store.isLoading;
  const error = store.error;

  useEffect(() => {
    store.init();
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text2)',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          letterSpacing: '0.5px',
        }}
      >
        Loading FlowBoard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ height: '100vh' }}>
        <div className="empty-state-icon">⚠</div>
        <div className="empty-state-title">Failed to initialize</div>
        <div className="empty-state-text">{error}</div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <div id="main">
        <div className={activeView === 'board' ? 'active-view' : 'hidden-view'}>
          <BoardView />
        </div>
        <div className={activeView === 'calendar' ? 'active-view' : 'hidden-view'}>
          <CalendarView />
        </div>
        <div className={activeView === 'timeline' ? 'active-view' : 'hidden-view'}>
          <TimelineView />
        </div>
      </div>
      <ModalRouter />
      <ToastContainer />
    </>
  );
}

export default function FlowBoard() {
  return (
    <ErrorBoundary>
      <div id="app">
        <style>{`
          /* ── THEME VARS ── */
          @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
          :root,[data-theme="void"]{--bg:#0a0a0f;--bg2:#111118;--bg3:#1a1a24;--bg4:#22222e;--surface:#1e1e2a;--surface2:#282836;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.13);--text:#e8e8f0;--text2:#8888a4;--text3:#50506a;--accent:#6c63ff;--accent2:#8b85ff;--accent-glow:rgba(108,99,255,0.22);--green:#22c55e;--red:#ef4444;--yellow:#f59e0b;--cyan:#06b6d4;--pink:#ec4899;--orange:#f97316;--logo-a:#8b85ff;--logo-b:#a78bfa;--radius:10px;--radius-lg:16px;--shadow:0 4px 24px rgba(0,0,0,0.4);--shadow-lg:0 8px 48px rgba(0,0,0,0.6);--font-display:'Syne',sans-serif;--font-body:'DM Sans',sans-serif;--font-mono:'DM Mono',monospace;--col-w:280px;--backlog-h:200px;--header-h:52px}
          [data-theme="carbon"]{--bg:#0d0f12;--bg2:#141720;--bg3:#1c2030;--bg4:#242838;--surface:#1a1e2c;--surface2:#222638;--border:rgba(148,163,184,0.08);--border2:rgba(148,163,184,0.15);--text:#e2e8f0;--text2:#64748b;--text3:#374151;--accent:#38bdf8;--accent2:#7dd3fc;--accent-glow:rgba(56,189,248,0.18);--green:#34d399;--red:#f87171;--yellow:#fbbf24;--cyan:#22d3ee;--pink:#f472b6;--orange:#fb923c;--logo-a:#38bdf8;--logo-b:#818cf8}
          [data-theme="obsidian"]{--bg:#111010;--bg2:#181614;--bg3:#221f1c;--bg4:#2c2824;--surface:#201d1a;--surface2:#2a2622;--border:rgba(255,200,120,0.07);--border2:rgba(255,200,120,0.13);--text:#f5ede0;--text2:#8a7060;--text3:#504030;--accent:#f59e0b;--accent2:#fbbf24;--accent-glow:rgba(245,158,11,0.20);--green:#86efac;--red:#fca5a5;--yellow:#fde68a;--cyan:#67e8f9;--pink:#fda4af;--orange:#fed7aa;--logo-a:#fbbf24;--logo-b:#f97316}
          [data-theme="noir"]{--bg:#080808;--bg2:#101010;--bg3:#181818;--bg4:#202020;--surface:#161616;--surface2:#1e1e1e;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.14);--text:#f0f0f0;--text2:#707070;--text3:#404040;--accent:#e0e0e0;--accent2:#f5f5f5;--accent-glow:rgba(255,255,255,0.10);--green:#86efac;--red:#f87171;--yellow:#fde047;--cyan:#67e8f9;--pink:#f9a8d4;--orange:#fdba74;--logo-a:#e0e0e0;--logo-b:#a0a0a0}
          [data-theme="dracula"]{--bg:#191921;--bg2:#21222c;--bg3:#282a36;--bg4:#343746;--surface:#2b2d3e;--surface2:#363a4f;--border:rgba(189,147,249,0.09);--border2:rgba(189,147,249,0.17);--text:#f8f8f2;--text2:#6272a4;--text3:#404558;--accent:#bd93f9;--accent2:#caa9fa;--accent-glow:rgba(189,147,249,0.22);--green:#50fa7b;--red:#ff5555;--yellow:#f1fa8c;--cyan:#8be9fd;--pink:#ff79c6;--orange:#ffb86c;--logo-a:#bd93f9;--logo-b:#ff79c6}
          [data-theme="tokyo"]{--bg:#0d0f17;--bg2:#13151f;--bg3:#1a1b27;--bg4:#21223a;--surface:#1e1f2e;--surface2:#252739;--border:rgba(122,162,247,0.09);--border2:rgba(122,162,247,0.17);--text:#c0caf5;--text2:#565f89;--text3:#3b4261;--accent:#7aa2f7;--accent2:#89b4fa;--accent-glow:rgba(122,162,247,0.22);--green:#9ece6a;--red:#f7768e;--yellow:#e0af68;--cyan:#7dcfff;--pink:#bb9af7;--orange:#ff9e64;--logo-a:#7aa2f7;--logo-b:#bb9af7}
          [data-theme="nord"]{--bg:#1a1f2e;--bg2:#1f2535;--bg3:#252d3e;--bg4:#2c3550;--surface:#252b3b;--surface2:#2d3548;--border:rgba(136,192,208,0.10);--border2:rgba(136,192,208,0.18);--text:#eceff4;--text2:#7b8fa6;--text3:#4c5e74;--accent:#88c0d0;--accent2:#8fbcbb;--accent-glow:rgba(136,192,208,0.20);--green:#a3be8c;--red:#bf616a;--yellow:#ebcb8b;--cyan:#81d4e6;--pink:#b48ead;--orange:#d08770;--logo-a:#88c0d0;--logo-b:#81a1c1}
          [data-theme="solarized"]{--bg:#001f26;--bg2:#002b36;--bg3:#073642;--bg4:#0d4555;--surface:#08384a;--surface2:#0e4558;--border:rgba(131,148,150,0.12);--border2:rgba(131,148,150,0.22);--text:#fdf6e3;--text2:#839496;--text3:#4e686a;--accent:#268bd2;--accent2:#2aa198;--accent-glow:rgba(38,139,210,0.22);--green:#859900;--red:#dc322f;--yellow:#b58900;--cyan:#2aa198;--pink:#d33682;--orange:#cb4b16;--logo-a:#268bd2;--logo-b:#2aa198}
          [data-theme="snow"]{--bg:#f8fafc;--bg2:#f1f5f9;--bg3:#e8eef4;--bg4:#dde5ee;--surface:#ffffff;--surface2:#f8fafc;--border:rgba(15,23,42,0.08);--border2:rgba(15,23,42,0.14);--text:#0f172a;--text2:#475569;--text3:#94a3b8;--accent:#4f46e5;--accent2:#6366f1;--accent-glow:rgba(79,70,229,0.15);--green:#16a34a;--red:#dc2626;--yellow:#ca8a04;--cyan:#0891b2;--pink:#db2777;--orange:#ea580c;--logo-a:#4f46e5;--logo-b:#7c3aed}
          [data-theme="paper"]{--bg:#faf7f0;--bg2:#f3ede2;--bg3:#ebe3d4;--bg4:#e0d6c2;--surface:#ffffff;--surface2:#faf7f0;--border:rgba(60,40,10,0.09);--border2:rgba(60,40,10,0.16);--text:#1c1409;--text2:#7a6040;--text3:#b8a080;--accent:#c05820;--accent2:#d97030;--accent-glow:rgba(192,88,32,0.15);--green:#2d6a2d;--red:#b82020;--yellow:#b87800;--cyan:#1a6b7a;--pink:#a0205a;--orange:#c45010;--logo-a:#c05820;--logo-b:#d97030}
          [data-theme="sage"]{--bg:#f4f6f2;--bg2:#edf0e8;--bg3:#e2e8db;--bg4:#d4dccb;--surface:#ffffff;--surface2:#f4f6f2;--border:rgba(30,50,20,0.09);--border2:rgba(30,50,20,0.16);--text:#1a2414;--text2:#5a7050;--text3:#90a880;--accent:#3d7a40;--accent2:#4e9452;--accent-glow:rgba(61,122,64,0.15);--green:#2e7d32;--red:#c62828;--yellow:#f57f17;--cyan:#00838f;--pink:#ad1457;--orange:#e65100;--logo-a:#3d7a40;--logo-b:#66bb6a}

          body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:14px;overflow:hidden;height:100vh}
          #app{display:flex;flex-direction:column;height:100vh;overflow:hidden}

          /* Header */
          #header{height:var(--header-h);background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:0 12px;flex-shrink:0;overflow:hidden}
          #logo{font-family:var(--font-display);font-weight:800;font-size:16px;color:var(--accent2);letter-spacing:-0.5px;flex-shrink:0}
          #board-tabs{display:flex;gap:4px;overflow-x:auto;flex:1;min-width:0}
          #board-tabs::-webkit-scrollbar{display:none}
          .board-tab{padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:var(--text2);white-space:nowrap;display:flex;align-items:center;gap:4px;transition:background .15s,color .15s}
          .board-tab:hover{background:var(--bg3);color:var(--text)}
          .board-tab.active{background:var(--accent-glow);color:var(--accent2)}
          .board-tab-del{opacity:0;font-size:14px;line-height:1;cursor:pointer;color:var(--text3);transition:opacity .15s}
          .board-tab:hover .board-tab-del{opacity:1}
          #add-board-btn{background:none;border:1px solid var(--border2);color:var(--text2);width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s}
          #add-board-btn:hover{border-color:var(--accent);color:var(--accent)}
          .header-spacer{flex:1}
          .view-tabs{display:flex;gap:2px;background:var(--bg3);border-radius:8px;padding:2px;flex-shrink:0}
          .view-tab{padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:var(--text2);transition:background .15s,color .15s}
          .view-tab.active{background:var(--surface);color:var(--text)}
          #header-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
          .header-btn{background:none;border:none;color:var(--text2);cursor:pointer;width:30px;height:30px;border-radius:8px;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
          .header-btn:hover{background:var(--bg3);color:var(--text)}
          #server-status{display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;font-size:11px;font-family:var(--font-mono);cursor:pointer;transition:background .15s}
          #server-status:hover{background:var(--bg3)}
          #server-status.ok .dot{background:var(--green)}
          #server-status.err .dot{background:var(--text3)}
          .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
          #server-status-text{color:var(--text3)}

          /* Search */
          #search-bar{background:var(--bg2);border-bottom:1px solid var(--border);padding:8px 16px;flex-shrink:0}
          #search-input{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;font-family:var(--font-body);outline:none;transition:border-color .15s}
          #search-input:focus{border-color:var(--accent)}

          /* Main layout */
          #main{flex:1;overflow:hidden;position:relative;display:flex;flex-direction:column}
          .active-view{display:flex;flex-direction:column;width:100%;height:100%}
          .hidden-view{display:none}

          /* Board */
          #board-view{display:flex;flex-direction:column;height:100%;overflow:hidden}
          #columns-area{display:flex;gap:12px;padding:16px;overflow-x:auto;flex:1;align-items:flex-start;min-height:0}
          #columns-area::-webkit-scrollbar{height:6px}
          #columns-area::-webkit-scrollbar-track{background:transparent}
          #columns-area::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
          .add-col-btn{flex:0 0 auto;height:36px;padding:0 16px;background:transparent;border:1px dashed var(--border2);color:var(--text3);border-radius:var(--radius);cursor:pointer;font-size:13px;white-space:nowrap;transition:border-color .15s,color .15s;align-self:flex-start;margin-top:0}
          .add-col-btn:hover{border-color:var(--accent);color:var(--accent)}

          /* Column */
          .column{flex:0 0 var(--col-w);display:flex;flex-direction:column;background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);max-height:100%;overflow:hidden;transition:border-color .2s}
          .column.dragging{opacity:0.5}
          .column.drag-over{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
          .col-header{display:flex;align-items:center;gap:6px;padding:12px 12px 8px;border-bottom:1px solid var(--border);flex-shrink:0}
          .col-drag-handle{cursor:grab;color:var(--text3);font-size:14px;flex-shrink:0;padding:0 2px;background:none;border:none;touch-action:none}
          .col-drag-handle:active{cursor:grabbing}
          .col-color-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;cursor:pointer;transition:transform .15s}
          .col-color-dot:hover{transform:scale(1.3)}
          .col-name{font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-display);flex:1;cursor:default}
          .col-count{font-size:11px;color:var(--text3);font-family:var(--font-mono);background:var(--bg3);padding:2px 6px;border-radius:10px}
          .col-menu-btn{background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color .15s}
          .col-menu-btn:hover{color:var(--text)}
          .col-cards{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
          .col-cards::-webkit-scrollbar{width:4px}
          .col-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
          .col-add-btn{margin:4px 8px 8px;background:none;border:1px dashed var(--border);color:var(--text3);border-radius:var(--radius);padding:6px;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;text-align:left}
          .col-add-btn:hover{border-color:var(--accent);color:var(--accent)}
          .col-menu-item{display:block;width:100%;text-align:left;background:none;border:none;padding:8px 12px;color:var(--text);cursor:pointer;font-size:13px;border-radius:6px;transition:background .15s}
          .col-menu-item:hover{background:var(--bg3)}

          /* Card */
          .card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0;cursor:grab;transition:border-color .15s,box-shadow .15s;position:relative;overflow:hidden;user-select:none;display:flex;flex-direction:column}
          @media (pointer:coarse){.card:active{box-shadow:0 0 0 2px var(--accent),var(--shadow);border-color:var(--accent);transition:box-shadow .3s,border-color .3s}}
          .card:hover{border-color:var(--border2);box-shadow:var(--shadow)}
          .card.dragging{opacity:0.5}
          .card-color-bar{height:3px;width:100%;flex-shrink:0}
          .card-body-row{display:flex;gap:8px;align-items:flex-start;padding:10px 10px 8px;flex:1;min-width:0}
          .card-inner{flex:1;min-width:0}
          .card-title{font-size:13px;font-weight:500;color:var(--text);line-height:1.4;word-break:break-word}
          .card-desc{font-size:11px;color:var(--text2);margin-top:4px;line-height:1.4;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
          .card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
          .tag{font-size:10px;padding:2px 6px;border-radius:4px;background:var(--accent-glow);color:var(--accent2);font-family:var(--font-mono)}
          .card-footer{display:flex;align-items:center;gap:6px;margin-top:8px}
          .card-footer-spacer{flex:1}
          .priority-badge{font-size:9px;padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-weight:600}
          .priority-badge.priority-high{background:rgba(239,68,68,.2);color:var(--red)}
          .priority-badge.priority-low{background:rgba(34,197,94,.15);color:var(--green)}
          .card-due{font-size:10px;font-family:var(--font-mono);color:var(--text3)}
          .card-due.overdue{color:var(--red)}
          .card-due.due-today{color:var(--yellow)}
          .card-due.due-soon{color:var(--orange)}
          /* Desktop/Mobile visibility helpers */
          .desktop-only{display:flex}
          .mobile-only{display:none}

          /* Mobile hamburger menu */
          #hamburger-btn{font-size:20px;padding:0 4px}
          #mobile-menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:stretch}
          #mobile-menu{width:min(300px,85vw);background:var(--surface);border-right:1px solid var(--border2);display:flex;flex-direction:column;overflow-y:auto;animation:slideInLeft .2s ease}
          @keyframes slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
          #mobile-menu-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border);flex-shrink:0}
          #mobile-menu-logo{font-family:var(--font-display);font-weight:800;font-size:18px}
          #mobile-menu-close{background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:4px 8px;border-radius:6px;transition:color .15s}
          #mobile-menu-close:hover{color:var(--text);background:var(--bg3)}
          .mobile-menu-section{padding:12px 16px;border-bottom:1px solid var(--border)}
          .mobile-menu-section-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--text3);font-family:var(--font-mono);margin-bottom:8px}
          .mobile-menu-empty{font-size:12px;color:var(--text3);padding:4px 0 8px}
          .mobile-menu-board-item{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s;margin-bottom:4px}
          .mobile-menu-board-item:hover{background:var(--bg3)}
          .mobile-menu-board-item.active{background:var(--accent-glow)}
          .mobile-menu-board-name{flex:1;font-size:13px;color:var(--text);font-weight:500}
          .mobile-menu-board-check{font-size:12px;color:var(--accent2)}
          .mobile-menu-board-del{font-size:13px;color:var(--text3);padding:2px 4px;border-radius:4px;transition:color .15s,background .15s}
          .mobile-menu-board-del:hover{color:var(--red);background:rgba(239,68,68,.1)}
          .mobile-menu-action-btn{display:block;width:100%;text-align:left;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:var(--font-body);transition:border-color .15s,background .15s;margin-top:6px}
          .mobile-menu-action-btn:hover{border-color:var(--accent);background:var(--bg4)}
          .mobile-menu-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--text2);transition:border-color .15s}
          .mobile-menu-status:hover{border-color:var(--accent)}
          .mobile-menu-status.ok .dot{background:var(--green)}
          .mobile-menu-status.err .dot{background:var(--text3)}

          /* Mobile */
          @media (max-width: 640px) {
            :root{--col-w:260px;--header-h:48px;--backlog-h:180px}
            #header{padding:0 10px;gap:8px;justify-content:space-between}
            .desktop-only{display:none!important}
            .mobile-only{display:flex!important}
            #search-bar{padding:6px 8px}
            #columns-area{padding:8px;gap:8px}
            .column{flex:0 0 var(--col-w)}
            .col-cards{padding:6px}
            .card-body-row{padding:8px 8px 6px}
            .modal{padding:16px;width:100%;max-width:100%;border-radius:12px 12px 0 0}
            .modal-lg{width:100%;max-width:100%}
            .modal-overlay{padding:0;align-items:flex-end}
            #toast-container{bottom:16px;width:calc(100% - 32px);left:16px;transform:none}
            .toast{white-space:normal}
            #backlog-cards{padding:6px 8px}
            .tl-container{padding:0 12px 24px}
            .tl-header{padding:12px 12px 8px}
            .form-row{flex-direction:column;gap:0}
            .cal-day{min-height:52px;padding:4px}
            .cal-day-num{font-size:10px}
            .view-tabs{gap:1px}
            .view-tab{padding:4px 10px;font-size:12px}
          }

          /* Backlog */
          #backlog-area{background:var(--bg2);border-top:1px solid var(--border);flex-shrink:0;max-height:var(--backlog-h);transition:max-height .25s}
          #backlog-area:not(.open){max-height:40px}
          #backlog-area.drag-over{border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent-glow)}
          #backlog-header{display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;border-bottom:1px solid var(--border)}
          #backlog-toggle-icon{color:var(--text3);font-size:10px;transition:transform .2s;cursor:pointer}
          #backlog-area:not(.open) #backlog-toggle-icon{transform:rotate(180deg)}
          #backlog-label{font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text3);font-family:var(--font-mono)}
          #backlog-count{font-size:11px;color:var(--text3);background:var(--bg3);padding:1px 6px;border-radius:8px;font-family:var(--font-mono)}
          #backlog-add-btn{margin-left:auto;background:none;border:1px solid var(--border2);color:var(--text2);padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;transition:border-color .15s,color .15s}
          #backlog-add-btn:hover{border-color:var(--accent);color:var(--accent)}
          #backlog-cards{display:flex;gap:8px;padding:8px 16px;overflow-x:auto;height:calc(var(--backlog-h) - 40px)}
          #backlog-cards::-webkit-scrollbar{height:4px}
          #backlog-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
          #backlog-cards .card{flex:0 0 220px}

          /* Calendar */
          #calendar-view{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:16px}
          .cal-nav{display:flex;align-items:center;margin-bottom:12px;gap:8px}
          .cal-month-label{font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);flex:1}
          .cal-nav-btn{background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:border-color .15s,color .15s}
          .cal-nav-btn:hover,.cal-nav-btn.active{border-color:var(--accent);color:var(--accent)}
          .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;flex:1;overflow:auto}
          .cal-day-header{font-size:10px;font-weight:600;letter-spacing:.5px;color:var(--text3);font-family:var(--font-mono);text-align:center;padding:6px 0;background:var(--bg2);position:sticky;top:0}
          .cal-day{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px;min-height:72px;transition:border-color .15s}
          .cal-day.today{border-color:var(--accent);background:var(--accent-glow)}
          .cal-day.other-month{background:var(--bg2);opacity:.4}
          .cal-day.has-events{cursor:pointer}
          .cal-day.has-events:hover{border-color:var(--border2)}
          .cal-day-num{font-size:11px;color:var(--text3);font-family:var(--font-mono);margin-bottom:4px}
          .cal-chips{display:flex;gap:3px;flex-wrap:wrap}
          .cal-card-chip{width:12px;height:12px;border-radius:3px}

          /* Timeline */
          #timeline-view{height:100%;display:flex;flex-direction:column;overflow:hidden}
          .tl-header{display:flex;align-items:center;padding:16px 20px 12px;flex-shrink:0;border-bottom:1px solid var(--border)}
          .tl-title{font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text)}
          .tl-subtitle{font-size:11px;color:var(--text3);margin-top:2px}
          .tl-container{flex:1;overflow-y:auto;padding:0 20px 32px; max-width: 860px; margin: 0 auto;width: 100%;}
          .tl-day-heading{display:flex;align-items:center;justify-content:space-between;padding:16px 0 8px;border-bottom:1px solid var(--border);margin-bottom:12px}
          .tl-day-label{font-size:12px;font-weight:600;color:var(--text);font-family:var(--font-display)}
          .tl-day-today .tl-day-label{color:var(--accent2)}
          .tl-day-count{font-size:10px;color:var(--text3);font-family:var(--font-mono)}
          .tl-day-block{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
          .tl-entry{display:flex;gap:12px}
          .tl-entry-spine{display:flex;flex-direction:column;align-items:center;width:16px;flex-shrink:0;padding-top:4px}
          .tl-entry-spine::after{content:'';width:1px;flex:1;background:var(--border);margin-top:6px}
          .tl-entry-spine-last::after{display:none}
          .tl-entry-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
          .tl-entry-body{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;transition:border-color .15s}
          .tl-entry-body.clickable{cursor:pointer}
          .tl-entry-body.clickable:hover{border-color:var(--border2)}
          .tl-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:4px}
          .tl-entry-icon{font-size:12px}
          .tl-entry-type{font-size:11px;font-weight:600;font-family:var(--font-mono)}
          .tl-entry-time{font-size:10px;color:var(--text3);font-family:var(--font-mono);margin-left:auto}
          .tl-entry-desc{font-size:12px;color:var(--text2);line-height:1.4}
          .tl-entry-footer{margin-top:6px}
          .tl-entry-card-link{font-size:11px;color:var(--accent2);cursor:pointer}
          .tl-entry-card-deleted{font-size:11px;color:var(--text3)}

          /* Modals */
          .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px}
          .modal{background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:22px;width:400px;max-width:100%;max-height:90vh;overflow-y:auto;box-shadow:var(--shadow-lg)}
          .modal-lg{width:560px}
          .modal-title{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
          .modal-close{background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;transition:color .15s}
          .modal-close:hover{color:var(--text);background:var(--bg3)}
          .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
          .form-group{margin-bottom:14px}
          .form-row{display:flex;gap:12px;margin-bottom:0}
          .form-row .form-group{flex:1}
          .form-label{display:block;font-size:11px;font-weight:600;letter-spacing:.4px;color:var(--text3);font-family:var(--font-mono);margin-bottom:6px;text-transform:uppercase}
          .form-input,.form-textarea,.form-select{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--radius);padding:8px 10px;font-size:13px;font-family:var(--font-body);outline:none;transition:border-color .15s}
          .form-input:focus,.form-textarea:focus,.form-select:focus{border-color:var(--accent)}
          .form-textarea{min-height:80px;resize:vertical}
          .color-picker{display:flex;gap:6px;flex-wrap:wrap}
          .color-option{width:24px;height:24px;border-radius:50%;cursor:pointer;transition:transform .15s,box-shadow .15s;border:2px solid transparent}
          .color-option:hover{transform:scale(1.15)}
          .color-option.selected{box-shadow:0 0 0 2px var(--text),0 0 0 4px var(--accent);transform:scale(1.1)}
          .btn{padding:8px 14px;border-radius:var(--radius);font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s,opacity .15s;font-family:var(--font-body)}
          .btn:disabled{opacity:.5;cursor:default}
          .btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
          .btn-primary:hover:not(:disabled){background:var(--accent2);border-color:var(--accent2)}
          .btn-secondary{background:transparent;color:var(--text2);border-color:var(--border2)}
          .btn-secondary:hover{background:var(--bg3);color:var(--text)}
          .btn-danger{background:rgba(239,68,68,.15);color:var(--red);border-color:rgba(239,68,68,.3)}
          .btn-danger:hover{background:rgba(239,68,68,.25)}

          /* Settings */
          .settings-section{margin-bottom:20px}
          .settings-section-title{font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--text3);font-family:var(--font-mono);text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
          .server-indicator{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)}

          /* Theme panel */
          .theme-section-label{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-family:var(--font-mono);margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border)}
          .theme-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
          .theme-swatch{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;border:2px solid transparent;transition:border-color .15s,background .15s;background:var(--bg3)}
          .theme-swatch:hover{border-color:var(--border2);background:var(--bg4)}
          .theme-swatch.active{border-color:var(--accent2);background:var(--bg4)}
          .theme-swatch-dots{display:flex;gap:3px;flex-shrink:0}
          .theme-swatch-dot{width:8px;height:8px;border-radius:50%}
          .theme-swatch-label{font-size:12px;color:var(--text);font-family:var(--font-body);font-weight:500}
          .theme-swatch-sub{font-size:10px;color:var(--text3);font-family:var(--font-mono);margin-left:auto}

          /* Toast */
          #toast-container{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:9000;pointer-events:none}
          .toast{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px;font-size:12px;box-shadow:var(--shadow);animation:toastIn .2s ease;white-space:nowrap}
          .toast-icon{font-size:14px}
          @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

          /* Empty state */
          .empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;padding:40px}
          .empty-state-icon{font-size:36px;opacity:.4}
          .empty-state-title{font-size:15px;font-weight:600;color:var(--text2);font-family:var(--font-display)}
          .empty-state-text{font-size:12px;color:var(--text3);text-align:center}
        `}</style>
        <App />
      </div>
    </ErrorBoundary>
  );
}
