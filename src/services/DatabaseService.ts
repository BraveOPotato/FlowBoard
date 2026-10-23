import { DB_NAME, DB_VERSION } from '../constants.ts';
import { applyOp, generationOf, mergeStates, type CrdtState } from './crdt.ts';
import type { CrdtOp, StoreName } from '../types';
import { uid } from '../utils.ts';

export type SyncRecovery = { local: CrdtState; beforeResolution?: CrdtState; remote?: CrdtState; pending?: CrdtOp[]; resolved?: boolean };
export type SyncWriteOptions = { remote?: boolean; remoteState?: CrdtState; resolveWith?: CrdtState; pause?: boolean; replaceWith?: CrdtState };

export class DatabaseService {
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
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Write aborted'));
    });
  }

  delete(store: StoreName, key: string): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Delete aborted'));
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

  batchPut<T>(store: StoreName, items: T[]): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const item of items) os.put(item);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Batch aborted'));
    });
  }

  // Read the generation and outbox together: another tab can reset both atomically.
  getSyncOutbox(boardId: string): Promise<{ generation: string; ops: CrdtOp[] }> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not open'));
      const tx = this.db.transaction(['settings', 'crdtOps'], 'readonly');
      const state = tx.objectStore('settings').get(`crdtState:${boardId}`);
      const ops = tx.objectStore('crdtOps').index('boardId').getAll(boardId);
      tx.oncomplete = () => resolve({ generation: generationOf(state.result?.value, boardId), ops: ops.result });
      tx.onabort = () => reject(tx.error ?? new Error('Outbox read aborted'));
    });
  }

  // Native IDB transaction serializes concurrent tabs and commits records, versions, tombstones
  // and the outbox together. Never acknowledge a remote read before this transaction completes.
  updateSyncState(boardId: string, initial: CrdtState, update: (state: CrdtState) => CrdtOp[], options: SyncWriteOptions = {}): Promise<CrdtState> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not open'));
      const tx = this.db.transaction(['settings', 'boards', 'columns', 'cards', 'activity', 'crdtOps'], 'readwrite');
      const key = `crdtState:${boardId}`;
      const read = tx.objectStore('settings').get(key);
      const recoveryKey = `syncRecovery:${boardId}`;
      const recoveryRead = tx.objectStore('settings').get(recoveryKey);
      const pending = tx.objectStore('crdtOps').index('boardId').getAll(boardId);
      let next: CrdtState;
      // Requests execute in order; include the durable outbox when upgrading an old client.
      pending.onsuccess = () => {
        try {
          const stored = read.result?.value as CrdtState | undefined;
          // A stale tab's materialized rows are not a baseline for a different history.
          next = stored && generationOf(stored, boardId) !== generationOf(initial, boardId)
            ? structuredClone(stored) : stored ? mergeStates(initial, stored) : initial;
          for (const op of pending.result as CrdtOp[]) applyOp(next, op);
          let recovery = recoveryRead.result?.value as SyncRecovery | undefined;
          // A missing old-client row is not a tombstone, and an unversioned row is not
          // older than the cloud. Keep an atomic backup and require an explicit choice.
          const legacy = read.result
            ? Object.values(read.result.value as CrdtState).some(map => Object.values(map).some(row => !row.__opId && !row.__ts))
            : !!initial.boards[boardId];
          const reset = !!next.boards[boardId] && !!options.remoteState
            && generationOf(next, boardId) !== generationOf(options.remoteState, boardId);
          if (options.pause || options.replaceWith || reset) {
            tx.objectStore('settings').put({ key: `syncRepairBackup:${boardId}:${uid()}`,
              value: { boardId, local: structuredClone(next), pending: pending.result, remote: options.resolveWith ?? options.remoteState } });
          }
          if (options.pause || reset || !recovery && legacy) {
            recovery = { ...recovery, local: recovery?.local ?? structuredClone(next), pending: pending.result, resolved: false,
              ...(reset ? { remote: options.remoteState } : {}) };
            tx.objectStore('settings').put({ key: recoveryKey, value: recovery });
          }
          if (options.resolveWith && (!recovery || recovery.resolved)) throw new Error('This board no longer needs sync recovery.');
          const beforeResolution = options.resolveWith ? structuredClone(next) : undefined;
          if (options.replaceWith) {
            next = structuredClone(options.replaceWith);
            for (const op of pending.result as CrdtOp[]) tx.objectStore('crdtOps').delete(op.opId);
            tx.objectStore('settings').delete(`crdtMeta:${boardId}`);
            for (const store of ['columns', 'cards', 'activity'] as const) {
              const os = tx.objectStore(store);
              const keys = os.index('boardId').getAllKeys(boardId);
              keys.onsuccess = () => { for (const id of keys.result) if (!Object.hasOwn(next[store], String(id))) os.delete(id); };
            }
          }
          const ops = options.remote && recovery && !recovery.resolved ? [] : update(next);
          if (options.resolveWith) tx.objectStore('settings').put({ key: recoveryKey, value: { ...recovery, beforeResolution, remote: options.resolveWith, resolved: true } });
          for (const store of ['boards', 'columns', 'cards', 'activity'] as const) {
            for (const row of Object.values(next[store])) {
              const os = tx.objectStore(store);
              const existing = os.get(row.id);
              existing.onsuccess = () => {
                if (existing.result && store !== 'boards' && existing.result.boardId !== boardId) { tx.abort(); return; }
                if (row.__deleted) os.delete(row.id);
                else os.put(row);
              };
            }
          }
          tx.objectStore('settings').put({ key, value: next });
          for (const op of ops) tx.objectStore('crdtOps').put(op);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(tx.error ?? new Error('Sync transaction aborted'));
    });
  }
}
