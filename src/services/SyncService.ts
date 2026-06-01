import { WORKER_URL } from '../constants';
import { uid } from '../utils';
import { CryptoService } from './CryptoService';
import type { DatabaseService } from './DatabaseService';
import type { Board, Column, Card, ActivityEvent, BoardCred, CrdtOp, FlowState } from '../types';

export class SyncService {
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
