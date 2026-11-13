import { normalizeWebhookUrl } from './services/WebhookService.ts';
import type { Board, CrdtOp } from './types';

type Client = typeof import('./store/useFlowStore.ts');

export async function checkWebhooks(load: (name: string, storage: string) => Promise<Client>): Promise<string> {
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(`Webhook: ${message}`); };
  const a = await load('webhooks-a', 'webhooks-a');
  const store = a.useFlowStore;
  const realFetch = window.fetch;
  const originalSchedule = a.sync.scheduleSync.bind(a.sync);
  const originalUpdate = a.db.updateSyncState.bind(a.db);
  const deliveries: { url: string; op: CrdtOp }[] = [];
  const order: string[] = [];
  const persisted: Promise<void>[] = [];
  let committed = false;
  let failure: 'http' | 'network' | 'pending' | null = null;
  let finishPending: (() => void) | undefined;
  let b: Client | undefined;
  let reloaded: Client | undefined;
  const previousUrl = location.href;
  const endpoint = `${location.origin}/webhooks/first`;
  const otherEndpoint = `${location.origin}/webhooks/second`;
  a.db.updateSyncState = async (...args) => {
    committed = false;
    const state = await originalUpdate(...args);
    committed = true;
    return state;
  };
  a.sync.scheduleSync = () => { order.push('schedule'); };
  window.fetch = async (...args) => {
    const url = String(args[0]);
    if (!url.startsWith(`${location.origin}/webhooks/`)) return realFetch(...args);
    const init = args[1]!;
    const op = JSON.parse(String(init.body)) as CrdtOp;
    assert(committed, 'requests start only after the local transaction finishes');
    assert(init.method === 'POST' && new Headers(init.headers).get('Content-Type') === 'application/json', 'POST activity as JSON');
    assert(init.credentials === 'omit', 'do not send browser credentials');
    order.push('webhook');
    deliveries.push({ url, op });
    if (op.type !== 'board.remove') persisted.push(a.db.getSyncOutbox(op.boardId).then(outbox => {
      assert(outbox.ops.some(pending => JSON.stringify(pending) === JSON.stringify(op)), 'send exactly the operation saved in the durable outbox');
    }));
    if (failure === 'http') return new Response('unavailable', { status: 503 });
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (failure === 'pending') await new Promise<void>(resolve => { finishPending = resolve; });
    return new Response(null, { status: 204 });
  };
  try {
    for (const value of ['invalid', '/relative', 'ftp://example.com', 'javascript:alert(1)', 'https://user:password@example.com']) {
      let rejected = false;
      try { normalizeWebhookUrl(value); } catch { rejected = true; }
      assert(rejected, `reject invalid endpoint ${value}`);
    }
    assert(normalizeWebhookUrl('   ') === '' && normalizeWebhookUrl(' http://localhost/hook ') === 'http://localhost/hook', 'allow HTTP endpoints and disabling');
    await store.getState().createBoard('Webhook board', 'test-password');
    const boardId = store.getState().activeBoardId!;
    const credentials = await a.sync.getBoardCreds(boardId);
    await store.getState().renameBoard(boardId, 'No webhook yet');
    assert(deliveries.length === 0, 'unconfigured boards do not send');
    order.length = 0;
    await store.getState().saveBoardWebhook(boardId, ` ${endpoint} `);
    assert(order.join(',') === 'webhook,schedule', 'dispatch precedes worker scheduling');
    assert(deliveries[0].op.type === 'board.update' && deliveries[0].op.payload.webhookUrl === endpoint, 'saving immediately uses the new endpoint');
    assert((await a.db.get<Board>('boards', boardId))?.webhookUrl === endpoint, 'URL belongs to the board record');
    assert(!(await a.db.getAll<{ key: string }>('settings')).some(row => row.key === 'webhookUrl'), 'URL is not a device setting');

    const originalBlobUrl = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    let backup: Blob | undefined;
    try {
      URL.createObjectURL = blob => { backup = blob as Blob; return originalBlobUrl(blob); };
      HTMLAnchorElement.prototype.click = () => {};
      store.getState().exportData();
    } finally {
      URL.createObjectURL = originalBlobUrl;
      HTMLAnchorElement.prototype.click = originalClick;
    }
    const exported = JSON.parse(await backup!.text()) as { boards: Board[] };
    assert(exported.boards.find(board => board.id === boardId)?.webhookUrl === endpoint, 'backups include the board webhook');
    await store.getState().saveBoardWebhook(boardId, '');
    await store.getState().importData(JSON.stringify(exported));
    assert(store.getState().boards.find(board => board.id === boardId)?.webhookUrl === endpoint, 'import restores the board webhook');
    await store.getState().importData(JSON.stringify({ boards: [{ id: boardId, name: 'Older export', createdAt: 1 }] }));
    assert(store.getState().boards.find(board => board.id === boardId)?.webhookUrl === endpoint, 'older exports without a webhook preserve the setting');

    // Exercise ordinary changes with neither a worker URL nor saved sync credentials.
    store.setState({ workerUrl: '' });
    await a.db.delete('boardCreds', boardId);
    const columnId = store.getState().columns.find(c => c.boardId === boardId)!.id;
    await store.getState().createCard(boardId, columnId, { title: 'Webhook card' });
    const cardId = store.getState().cards.find(c => c.boardId === boardId)!.id;
    await store.getState().updateCard(cardId, { desc: 'Changed', dueDate: '2030-01-01', checklist: [{ id: 'task', title: 'Checklist task', done: true }] });
    await store.getState().moveCard(cardId, null, 0);
    await store.getState().deleteCard(cardId);
    await store.getState().toasts.find(t => t.action?.label === 'Undo')!.action!.run();
    await store.getState().createColumn(boardId, 'Temporary');
    const column = store.getState().columns.find(c => c.name === 'Temporary')!;
    await store.getState().updateColumn(column.id, { name: 'Renamed column' });
    await store.getState().reorderColumns(store.getState().columns.filter(c => c.boardId === boardId).map(c => c.id).reverse());
    await store.getState().deleteColumn(column.id);
    await store.getState().renameBoard(boardId, 'Renamed board');
    for (const type of ['board.update', 'card.create', 'card.update', 'card.move', 'card.delete', 'column.create', 'column.update', 'column.delete', 'activity.create']) {
      assert(deliveries.some(d => d.op.type === type), `cover ${type} without worker configuration`);
    }
    assert(new Set(deliveries.map(d => d.op.opId)).size === deliveries.length, 'each new local operation is delivered once');

    const beforeFailure = deliveries.length;
    a.db.updateSyncState = async () => { throw new Error('disk failure'); };
    let failed = false;
    try { await store.getState().renameBoard(boardId, 'Failed write'); } catch { failed = true; }
    assert(failed && deliveries.length === beforeFailure, 'failed writes never send a webhook');
    a.db.updateSyncState = originalUpdate;
    for (const mode of ['http', 'network', 'pending'] as const) {
      failure = mode;
      await store.getState().renameBoard(boardId, mode);
      assert((await a.db.get<Board>('boards', boardId))?.name === mode, `${mode} delivery does not roll back or block edits`);
      finishPending?.();
    }
    failure = null;
    await Promise.all(persisted);
    persisted.length = 0;

    // Board selection must never redirect another board's activity.
    await store.getState().createBoard('Other board', 'other-password');
    const otherId = store.getState().activeBoardId!;
    const beforeOther = deliveries.length;
    await store.getState().renameBoard(otherId, 'Other board, unconfigured');
    assert(deliveries.length === beforeOther, 'each board has its own optional endpoint');
    await store.getState().saveBoardWebhook(otherId, otherEndpoint);
    await store.getState().renameBoard(boardId, 'Original board while another is active');
    assert(deliveries.at(-1)?.url === endpoint, 'use the changed board rather than the active board');
    await Promise.all(persisted);
    persisted.length = 0;

    await a.db.put('boardCreds', credentials!);
    const syncA = async () => { await store.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 }); a.sync.stopTimer(); };
    await syncA();
    reloaded = await load('webhooks-reload', 'webhooks-a');
    await reloaded.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
    reloaded.sync.stopTimer();
    assert(reloaded.useFlowStore.getState().boards.find(board => board.id === otherId)?.webhookUrl === otherEndpoint, 'configuration survives reload');
    const beforeJoin = deliveries.length;
    b = await load('webhooks-b', 'webhooks-b');
    assert(await b.useFlowStore.getState().joinBoard(boardId, 'test-password'), 'another device joins');
    b.sync.stopTimer();
    assert(b.useFlowStore.getState().boards.find(board => board.id === boardId)?.webhookUrl === endpoint, 'webhook URL syncs with the board');
    assert(deliveries.length === beforeJoin, 'sync and joins never replay received activity');
    await store.getState().saveBoardWebhook(boardId, '');
    await syncA();
    await b.useFlowStore.getState().saveSettings({ workerUrl: location.origin, syncInterval: 3600 });
    b.sync.stopTimer();
    assert(b.useFlowStore.getState().boards.find(board => board.id === boardId)?.webhookUrl === '', 'disabling propagates to other devices');
    const beforeDisabled = deliveries.length;
    await store.getState().renameBoard(boardId, 'Disabled');
    assert(deliveries.length === beforeDisabled, 'blank URL stops delivery immediately');

    // Removing a board also notifies it, after the local deletion succeeds.
    await store.getState().deleteBoard(otherId);
    assert(deliveries.at(-1)?.op.type === 'board.remove' && deliveries.at(-1)?.url === otherEndpoint, 'local board removal notifies its endpoint');
    assert(!await a.db.get('boards', otherId), 'board is removed locally before notification');
    return 'Webhooks: all local mutations, post-commit ordering, no worker, board isolation, URL validation, failures, sync, reload, backups, disabling and no remote replay';
  } finally {
    window.fetch = realFetch;
    a.db.updateSyncState = originalUpdate;
    a.sync.scheduleSync = originalSchedule;
    a.sync.stopTimer();
    b?.sync.stopTimer();
    reloaded?.sync.stopTimer();
    history.replaceState(null, '', previousUrl);
  }
}
