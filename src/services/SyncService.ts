import { WORKER_URL } from '../constants.ts';
import { uid } from '../utils.ts';
import { CryptoService } from './CryptoService.ts';
import { SYNC_PROTOCOL, generationOf, materialize, validState, type CrdtState } from './crdt.ts';
import type { DatabaseService, SyncRecovery } from './DatabaseService';
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

  async isSyncPaused(boardId: string): Promise<boolean> {
    const recovery = await this.db.get<{ value: SyncRecovery }>('settings', `syncRecovery:${boardId}`);
    if (recovery) return !recovery.value.resolved;
    return !(await this.db.get('settings', `crdtState:${boardId}`)) && !!(await this.db.get('boards', boardId));
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
    if (await this.isSyncPaused(boardId)) return false;
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
      const r = await this.fetchJson('/api/board/put', { boardId, keyHash: creds.keyHash, data, protocolVersion: SYNC_PROTOCOL });
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
    if (!key) throw new Error('No sync credentials are saved for this board. Enter its ID and password to join.');
    try {
      const r = await this.fetchJson('/api/board/get', { boardId, keyHash: key }).catch(() => {
        throw new Error('Unable to reach the cloud worker. Check the Worker URL and connection, then retry.');
      });
      if (!r.ok) throw new Error(`The cloud worker returned HTTP ${r.status}. Check its URL and deployment, then retry.`);
      const reply = await r.json().catch(() => { throw new Error('The Worker URL did not return a valid sync response. Check that it points to the sync worker, not the frontend.'); });
      if (!reply || typeof reply.found !== 'boolean') throw new Error('Invalid board response from the cloud worker. Check its URL and deployment.');
      const { found, data: rawData, state, protocolVersion } = reply as { found: boolean; data: unknown; state?: unknown; protocolVersion?: number };
      if (protocolVersion !== SYNC_PROTOCOL) throw new Error('Cloud sync versions do not match. Deploy the updated sync worker against the existing D1 database, then reload FlowBoard.');
      if (!found) {
        this.onStatusChange(true);
        return false;
      }
      if (state && !validState(state, boardId)) throw new Error('Invalid sync state');
      // Merge the legacy baseline and versioned state in one local transaction.
      await mergeCallback(await CryptoService.decrypt(boardId, password, rawData), state as CrdtState | undefined);
      this.onStatusChange(true);
      return true;
    } catch (error) {
      this.onStatusChange(false);
      throw error;
    }
  }

  async pushCrdtOps(boardId: string): Promise<boolean> {
    if (await this.isSyncPaused(boardId)) return false;
    const creds = await this.getBoardCreds(boardId);
    if (!creds) return false;
    const { generation, ops: pending } = await this.db.getSyncOutbox(boardId);
    if (!pending.length) return false;
    try {
      for (let i = 0; i < pending.length; i += 100) {
        const batch = pending.slice(i, i + 100);
        const r = await this.fetchJson('/api/crdt/ops/push', { boardId, keyHash: creds.keyHash, ops: batch, generation, protocolVersion: SYNC_PROTOCOL });
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

  async readCrdtState(boardId: string): Promise<CrdtState | null> {
    const creds = await this.getBoardCreds(boardId);
    if (!creds) throw new Error('Missing board credentials');
    // ponytail: O(board size) per poll; add a server-revision cursor if large boards need incremental reads.
    // Client clocks cannot be arrival cursors, and pruned ops cannot recover a long-offline device.
    const r = await this.fetchJson('/api/crdt/state/get', { boardId, keyHash: creds.keyHash });
    if (!r.ok) throw new Error('Cloud state is unavailable. Check the connection and upgrade the worker first.');
    const { found, state, protocolVersion } = (await r.json()) as { found: boolean; state: unknown; protocolVersion?: number };
    if (protocolVersion !== SYNC_PROTOCOL) throw new Error('Upgrade the worker before syncing');
    if (!found) return null;
    if (!validState(state, boardId)) throw new Error('Invalid sync state; upgrade the worker first');
    return state;
  }

  async overwriteBoard(boardId: string, snapshot: CrdtState, expected: CrdtState | null): Promise<CrdtState> {
    if (!await this.isSyncPaused(boardId)) throw new Error('Pause this board for repair before overwriting it.');
    const creds = await this.getBoardCreds(boardId);
    if (!creds) throw new Error('Missing board credentials. Join the board before repairing it.');
    const resetId = uid();
    const r = await this.fetchJson('/api/crdt/state/replace', { boardId, keyHash: creds.keyHash, resetId, expected,
      snapshot: materialize(snapshot), protocolVersion: SYNC_PROTOCOL });
    const reply = await r.json().catch(() => null);
    if (!r.ok) throw new Error(r.status === 413 ? 'The snapshot and expected cloud state exceed the worker’s 1 MB request limit.'
      : reply?.error ?? 'Overwrite could not be confirmed. Upgrade the worker and retry; this board remains paused.');
    if (reply?.ok !== true || reply.protocolVersion !== SYNC_PROTOCOL || !validState(reply.state, boardId)
      || generationOf(reply.state, boardId) !== resetId) throw new Error('Invalid overwrite response. This board remains paused; check the worker before retrying.');
    return reply.state;
  }

  async pullCrdtState(boardId: string, mergeCallback: (state: CrdtState) => Promise<void>): Promise<boolean> {
    try {
      const state = await this.readCrdtState(boardId);
      if (state) await mergeCallback(state);
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
