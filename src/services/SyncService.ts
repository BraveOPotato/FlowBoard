import { WORKER_URL } from '../constants.ts';
import { uid } from '../utils.ts';
import { CryptoService } from './CryptoService.ts';
import { validState, type CrdtState } from './crdt.ts';
import type { DatabaseService } from './DatabaseService';
import type { BoardCred, CrdtOp, FlowState } from '../types';

export class SyncService {
  private db: DatabaseService;
  private workerUrl: string;
  private clientId: string;
  private onStatusChange: (ok: boolean) => void;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSync: ReturnType<typeof setTimeout> | null = null;
  private lastIssued = 0;

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

  createOp(boardId: string, type: string, payload: Record<string, unknown>, after: number): CrdtOp {
    this.lastIssued = Math.max(Date.now(), this.lastIssued + 1, after + 1);
    return {
      opId: uid(),
      type,
      ts: this.lastIssued,
      clientId: this.clientId,
      boardId,
      payload,
    };
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

  async pullFromWorker(boardId: string, password: string, mergeCallback: (data: unknown, state?: CrdtState) => Promise<void>, keyHash?: string): Promise<boolean> {
    const key = keyHash ?? (await this.getBoardCreds(boardId))?.keyHash;
    if (!key) return false;
    try {
      const r = await this.fetchJson('/api/board/get', { boardId, keyHash: key });
      if (!r.ok) {
        this.onStatusChange(false);
        return false;
      }
      const { found, data: rawData, state } = (await r.json()) as { found: boolean; data: unknown; state?: unknown };
      if (!found) {
        this.onStatusChange(true);
        return false;
      }
      if (state && !validState(state, boardId)) throw new Error('Invalid sync state');
      // Merge the legacy baseline and versioned state in one local transaction.
      await mergeCallback(await CryptoService.decrypt(boardId, password, rawData), state as CrdtState | undefined);
      this.onStatusChange(true);
      return true;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  async pushCrdtOps(boardId: string): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    const allOps = await this.db.getAll<CrdtOp>('crdtOps');
    const pending = allOps.filter((o) => o.boardId === boardId);
    if (!pending.length) return false;
    try {
      for (let i = 0; i < pending.length; i += 100) {
        const batch = pending.slice(i, i + 100);
        const r = await this.fetchJson('/api/crdt/ops/push', { boardId, keyHash: creds.keyHash, ops: batch });
        if (!r.ok || (await r.json()).ok !== true) throw new Error('Push not acknowledged');
        for (const op of batch) await this.db.delete('crdtOps', op.opId);
      }
      this.onStatusChange(true);
      return true;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  async pullCrdtState(boardId: string, mergeCallback: (state: CrdtState) => Promise<void>): Promise<boolean> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    try {
      // ponytail: O(board size) per poll; add a server-revision cursor if large boards need incremental reads.
      // Client clocks cannot be arrival cursors, and pruned ops cannot recover a long-offline device.
      const r = await this.fetchJson('/api/crdt/state/get', { boardId, keyHash: creds.keyHash });
      if (!r.ok) {
        this.onStatusChange(false);
        return false;
      }
      const { found, state } = (await r.json()) as { found: boolean; state: unknown };
      if (!found) return false;
      if (!validState(state, boardId)) throw new Error('Invalid sync state; upgrade the worker first');
      await mergeCallback(state);
      this.onStatusChange(true);
      return true;
    } catch {
      this.onStatusChange(false);
      return false;
    }
  }

  startTimer(intervalSecs: number, callback: () => void) {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(callback, intervalSecs * 1000);
  }

  scheduleSync(callback: () => void) {
    if (this.pendingSync) clearTimeout(this.pendingSync);
    this.pendingSync = setTimeout(() => { this.pendingSync = null; callback(); }, 1500);
  }

  stopTimer() {
    if (this.pendingSync) { clearTimeout(this.pendingSync); this.pendingSync = null; }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}
