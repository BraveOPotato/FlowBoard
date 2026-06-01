import { DB_NAME, DB_VERSION } from '../constants';
import type { StoreName } from '../types';

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
