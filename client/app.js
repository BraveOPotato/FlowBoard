/* FlowBoard — app.js */
'use strict';

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════
const DB_NAME = 'flowboard';
const DB_VERSION = 3; // bumped: added boardCreds store
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
];
// Set this to your deployed Cloudflare Worker URL
const WORKER_URL = 'https://flowboard-worker.abdullahalkafajy.workers.dev';

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let db = null;
let state = {
  boards: [],       // [{id, name, createdAt}]
  columns: [],      // [{id, boardId, name, order, color}]
  cards: [],        // [{id, boardId, columnId|null, title, desc, tags, color, priority, dueDate, order, createdAt}]
  activity: [],     // [{id, boardId, cardId, type, ts, fromColId, toColId, meta}]
  // boardCreds: stored in IDB 'boardCreds' store, not in state directly
  // { boardId, password, keyHash, name, lastSynced }
  activeBoardId: null,
  activeView: 'board',
  calendarDate: new Date(),
  backlogOpen: true,
  searchQuery: '',
  showDueDateOnly: false,
  syncQueue: [],
  workerUrl: WORKER_URL,
  syncInterval: 600,  // default 10 minutes
  activeTheme: 'void',
};

// ═══════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════
const THEMES = [
  // ── Dark ──
  { id: 'void',      label: 'Void',        section: 'dark',  bg: '#0a0a0f', surface: '#1e1e2a', accent: '#8b85ff', accent2: '#a78bfa', dot3: '#6c63ff' },
  { id: 'carbon',    label: 'Carbon',      section: 'dark',  bg: '#0d0f12', surface: '#1a1e2c', accent: '#38bdf8', accent2: '#7dd3fc', dot3: '#818cf8' },
  { id: 'obsidian',  label: 'Obsidian',    section: 'dark',  bg: '#111010', surface: '#201d1a', accent: '#f59e0b', accent2: '#fbbf24', dot3: '#f97316' },
  { id: 'noir',      label: 'Noir',        section: 'dark',  bg: '#080808', surface: '#161616', accent: '#e0e0e0', accent2: '#f5f5f5', dot3: '#a0a0a0' },
  { id: 'dracula',   label: 'Dracula',     section: 'dark',  bg: '#191921', surface: '#2b2d3e', accent: '#bd93f9', accent2: '#caa9fa', dot3: '#ff79c6' },
  { id: 'tokyo',     label: 'Tokyo Night', section: 'dark',  bg: '#0d0f17', surface: '#1e1f2e', accent: '#7aa2f7', accent2: '#89b4fa', dot3: '#bb9af7' },
  { id: 'nord',      label: 'Nord',        section: 'dark',  bg: '#1a1f2e', surface: '#252b3b', accent: '#88c0d0', accent2: '#8fbcbb', dot3: '#81a1c1' },
  { id: 'solarized', label: 'Solarized',   section: 'dark',  bg: '#001f26', surface: '#08384a', accent: '#268bd2', accent2: '#2aa198', dot3: '#859900' },
  // ── Light ──
  { id: 'snow',      label: 'Snow',        section: 'light', bg: '#f8fafc', surface: '#ffffff', accent: '#4f46e5', accent2: '#6366f1', dot3: '#7c3aed' },
  { id: 'paper',     label: 'Paper',       section: 'light', bg: '#faf7f0', surface: '#ffffff', accent: '#c05820', accent2: '#d97030', dot3: '#b87800' },
  { id: 'sage',      label: 'Sage',        section: 'light', bg: '#f4f6f2', surface: '#ffffff', accent: '#3d7a40', accent2: '#4e9452', dot3: '#2e7d32' },
];

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.bg;
  state.activeTheme = theme.id;
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === theme.id);
  });
}

function saveTheme(id) {
  dbPut('settings', { key: 'activeTheme', value: id });
  applyTheme(id);
}

function buildThemePanel() {
  const container = document.getElementById('theme-grid');
  if (!container) return;
  container.innerHTML = '';

  const sections = [
    { key: 'dark',  label: 'Dark' },
    { key: 'light', label: 'Light' },
  ];

  for (const sec of sections) {
    const secThemes = THEMES.filter(t => t.section === sec.key);
    if (!secThemes.length) continue;

    const secLabel = document.createElement('div');
    secLabel.className = 'theme-section-label';
    secLabel.textContent = sec.label;
    container.appendChild(secLabel);

    const grid = document.createElement('div');
    grid.className = 'theme-grid';

    for (const t of secThemes) {
      const swatch = document.createElement('div');
      swatch.className = 'theme-swatch' + (t.id === (state.activeTheme || 'void') ? ' active' : '');
      swatch.dataset.theme = t.id;
      swatch.innerHTML = `
        <div class="theme-swatch-dots">
          <div class="theme-swatch-dot" style="background:${t.accent}"></div>
          <div class="theme-swatch-dot" style="background:${t.accent2}"></div>
          <div class="theme-swatch-dot" style="background:${t.dot3}"></div>
        </div>
        <span class="theme-swatch-label">${t.label}</span>
        ${t.id === (state.activeTheme || 'void') ? '<span class="theme-swatch-sub">active</span>' : ''}
      `;
      swatch.addEventListener('click', () => {
        saveTheme(t.id);
        buildThemePanel(); // re-render to update active indicator
        toast(`Theme: ${t.label}`, '🎨');
      });
      grid.appendChild(swatch);
    }
    container.appendChild(grid);
  }
}

function toggleThemePanel() {
  const panel = document.getElementById('theme-panel');
  const overlay = document.getElementById('theme-overlay');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  overlay?.classList.toggle('open', !isOpen);
  if (!isOpen) buildThemePanel();
}

function closeThemePanel() {
  document.getElementById('theme-panel')?.classList.remove('open');
  document.getElementById('theme-overlay')?.classList.remove('open');
}


function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('boards')) {
        d.createObjectStore('boards', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('columns')) {
        const cs = d.createObjectStore('columns', { keyPath: 'id' });
        cs.createIndex('boardId', 'boardId');
      }
      if (!d.objectStoreNames.contains('cards')) {
        const cs = d.createObjectStore('cards', { keyPath: 'id' });
        cs.createIndex('boardId', 'boardId');
        cs.createIndex('columnId', 'columnId');
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!d.objectStoreNames.contains('activity')) {
        const as = d.createObjectStore('activity', { keyPath: 'id' });
        as.createIndex('boardId', 'boardId');
        as.createIndex('ts', 'ts');
      }
      if (!d.objectStoreNames.contains('boardCreds')) {
        // stores { boardId, password, keyHash, name, lastSynced }
        d.createObjectStore('boardCreds', { keyPath: 'boardId' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function loadAll() {
  const [boards, columns, cards, settings, activity] = await Promise.all([
    dbGetAll('boards'),
    dbGetAll('columns'),
    dbGetAll('cards'),
    dbGetAll('settings'),
    dbGetAll('activity'),
  ]);
  state.boards = boards.sort((a, b) => a.createdAt - b.createdAt);
  state.columns = columns.sort((a, b) => a.order - b.order);
  state.cards = cards.sort((a, b) => a.order - b.order);
  state.activity = activity.sort((a, b) => b.ts - a.ts);

  for (const s of settings) {
    if (s.key === 'activeBoardId') state.activeBoardId = s.value;
    if (s.key === 'workerUrl') state.workerUrl = s.value || WORKER_URL;
    if (s.key === 'backlogOpen') state.backlogOpen = s.value !== false;
    if (s.key === 'syncInterval') state.syncInterval = s.value || 600;
    if (s.key === 'activeTheme') state.activeTheme = s.value || 'void';
  }
}

function saveSetting(key, value) {
  dbPut('settings', { key, value });
  state[key] = value;
}

// ═══════════════════════════════════════════════════════
// ACTIVITY TRACKING
// ═══════════════════════════════════════════════════════
async function recordActivity(boardId, cardId, type, meta = {}) {
  const event = {
    id: uid(),
    boardId,
    cardId,
    type,   // 'created' | 'moved' | 'updated' | 'deleted' | 'due_set'
    ts: Date.now(),
    ...meta // fromColId, toColId, fromColName, toColName, cardTitle, dueDate, etc.
  };
  state.activity.unshift(event); // prepend — list is newest-first
  await dbPut('activity', event);
  syncToServer('upsertActivity', event);
  return event;
}

function colName(colId) {
  if (!colId) return 'Backlog';
  return state.columns.find(c => c.id === colId)?.name || 'Unknown';
}

// ═══════════════════════════════════════════════════════
// ID GENERATION
// ═══════════════════════════════════════════════════════
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ═══════════════════════════════════════════════════════
// SERVER SYNC
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// CRYPTO — board key hashing
// ═══════════════════════════════════════════════════════
// ─── Simple non-crypto fallback hash (used when crypto.subtle unavailable) ───
function _simpleHash(str) {
  // FNV-1a 64-bit (emulated in 32-bit pairs) — not cryptographic, but unique enough
  // for local-only use where cloud sync isn't available anyway
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8,'0') + h2.toString(16).padStart(8,'0')).repeat(4);
}

async function hashKey(boardId, password) {
  const raw = `${boardId}:${password}`;
  if (!crypto?.subtle) return _simpleHash(raw);
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return _simpleHash(raw); }
}

// ═══════════════════════════════════════════════════════
// AES-GCM ENCRYPTION
// ═══════════════════════════════════════════════════════
async function deriveEncKey(boardId, password) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const salt = new TextEncoder().encode(`flowboard:${boardId}`);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(boardId, password, data) {
  if (!crypto?.subtle) return data; // no encryption without crypto API
  try {
    const key = await deriveEncKey(boardId, password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { enc: 1, iv: toB64(iv), ct: toB64(ciphertext) };
  } catch { return data; }
}

async function decryptData(boardId, password, payload) {
  if (!payload?.enc) return payload; // legacy plaintext
  if (!crypto?.subtle) throw new Error('Encryption not available (requires HTTPS)');
  const key = await deriveEncKey(boardId, password);
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Decryption failed — wrong password?');
  }
}

// ═══════════════════════════════════════════════════════
// BOARD CREDENTIALS (per-board IDB store)
// ═══════════════════════════════════════════════════════
async function getBoardCreds(boardId) {
  return dbGet('boardCreds', boardId);
}

async function saveBoardCreds(boardId, password, keyHash, name) {
  await dbPut('boardCreds', { boardId, password, keyHash, name, lastSynced: null });
}

async function getAllBoardCreds() {
  return dbGetAll('boardCreds');
}

// ═══════════════════════════════════════════════════════
// KV WORKER SYNC
// ═══════════════════════════════════════════════════════
function workerUrl() {
  return (state.workerUrl || WORKER_URL).replace(/\/$/, '');
}

async function checkWorker() {} // no-op — connectivity determined by operation results
function checkServer() {}       // no-op shim

// Push a single board's data to KV
async function pushBoardToWorker(boardId) {
  const creds = await getBoardCreds(boardId);
  if (!creds) return false;
  const plainData = {
    boards:   state.boards.filter(b => b.id === boardId),
    columns:  state.columns.filter(c => c.boardId === boardId),
    cards:    state.cards.filter(c => c.boardId === boardId),
    activity: state.activity.filter(a => a.boardId === boardId),
  };
  try {
    const data = await encryptData(boardId, creds.password, plainData);
    const r = await fetch(`${workerUrl()}/api/board/put`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, keyHash: creds.keyHash, data }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      await dbPut('boardCreds', { ...creds, lastSynced: Date.now() });
      setWorkerStatus(true);
      return true;
    }
    console.warn('[kv] pushBoard returned', r.status);
    setWorkerStatus(false);
    return false;
  } catch (e) {
    console.warn('[kv] pushBoard failed', e.message);
    setWorkerStatus(false);
    return false;
  }
}

// Pull a board from KV and merge into local state
async function pullBoardFromWorker(boardId) {
  const creds = await getBoardCreds(boardId);
  if (!creds) return false;
  try {
    const r = await fetch(`${workerUrl()}/api/board/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, keyHash: creds.keyHash }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { setWorkerStatus(false); return false; }
    const { found, data: rawData } = await r.json();
    if (!found) { setWorkerStatus(true); return false; } // reached worker, board just not found

    const data = await decryptData(boardId, creds.password, rawData);
    for (const b of data.boards  || []) { await dbPut('boards',   b); upsertInState('boards',   b, 'id'); }
    for (const c of data.columns || []) { await dbPut('columns',  c); upsertInState('columns',  c, 'id'); }
    for (const c of data.cards   || []) { await dbPut('cards',    c); upsertInState('cards',    c, 'id'); }
    for (const a of data.activity|| []) { await dbPut('activity', a); upsertInState('activity', a, 'id'); }

    state.boards.sort((a, b) => a.createdAt - b.createdAt);
    state.columns.sort((a, b) => a.order - b.order);
    state.cards.sort((a, b) => a.order - b.order);
    state.activity.sort((a, b) => b.ts - a.ts);

    await dbPut('boardCreds', { ...creds, lastSynced: Date.now() });
    setWorkerStatus(true);
    return true;
  } catch (e) {
    console.warn('[kv] pullBoard failed', e.message);
    setWorkerStatus(false);
    return false;
  }
}

function upsertInState(key, item, idField) {
  const arr = state[key];
  const i = arr.findIndex(x => x[idField] === item[idField]);
  if (i >= 0) arr[i] = item; else arr.push(item);
}

// Sync all boards that have credentials
async function syncAllBoards() {
  const allCreds = await getAllBoardCreds();
  if (!allCreds.length) return false;
  let anyOk = false;
  for (const creds of allCreds) {
    const pulled = await pullBoardFromWorker(creds.boardId);
    // Always push after pull so local changes reach KV
    const pushed = await pushBoardToWorker(creds.boardId);
    if (pulled || pushed) anyOk = true;
  }
  if (anyOk) { renderAll(); updateSyncTimestamp(); }
  return anyOk;
}

async function syncBidirectional() { return syncAllBoards(); }

// Per-mutation debounced push
async function syncToServer(type, data) {
  const boardId = data?.boardId || data?.id;
  if (!boardId) return;
  schedulePush(boardId);
}

const _pushTimers = {};
function schedulePush(boardId) {
  clearTimeout(_pushTimers[boardId]);
  _pushTimers[boardId] = setTimeout(() => pushBoardToWorker(boardId), 1500);
}

function pullFromServer() { return syncAllBoards(); }

// ═══════════════════════════════════════════════════════
// PERIODIC SYNC
// ═══════════════════════════════════════════════════════
let _syncTimer = null;

function startSyncTimer() {
  stopSyncTimer();
  const secs = Math.max(30, parseInt(state.syncInterval) || 600);
  _syncTimer = setInterval(async () => {
    const allCreds = await getAllBoardCreds();
    if (!allCreds.length) return;
    await syncAllBoards();
  }, secs * 1000);
}

function stopSyncTimer() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
}

function updateSyncTimestamp() {
  const txt = document.getElementById('server-status-text');
  if (!txt) return;
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  txt.textContent = `synced ${t}`;
}

// Status is updated by setWorkerStatus() after each actual operation
function updateServerStatus() {} // no-op shim
function updateOfflineBanner() {} // no-op shim

function setWorkerStatus(ok) {
  const el  = document.getElementById('server-status');
  const txt = document.getElementById('server-status-text');
  const syncBtn    = document.getElementById('sync-now-btn');
  const drawerSync = document.getElementById('drawer-sync-btn');
  if (!el) return;
  el.className = ok ? 'ok' : 'err';
  if (txt && !txt.textContent.startsWith('synced')) txt.textContent = ok ? 'connected' : 'local';
  if (syncBtn)    syncBtn.style.display    = ok ? '' : 'none';
  if (drawerSync) drawerSync.style.display = ok ? '' : 'none';
}

function isWorkerOk() {
  const el = document.getElementById('server-status');
  return el ? el.classList.contains('ok') : false;
}

// ═══════════════════════════════════════════════════════
// BOARD OPERATIONS
// ═══════════════════════════════════════════════════════
async function createBoard(name, password) {
  const boardId = uid();
  const keyHash = await hashKey(boardId, password);
  const board = { id: boardId, name: name || 'New Board', createdAt: Date.now() };
  await dbPut('boards', board);
  state.boards.push(board);
  await saveBoardCreds(boardId, password, keyHash, board.name);
  await setActiveBoard(board.id);
  schedulePush(boardId);
  renderBoardTabs();
  return board;
}

async function renameBoard(id, name) {
  const board = state.boards.find(b => b.id === id);
  if (!board) return;
  board.name = name;
  await dbPut('boards', board);
  syncToServer('upsertBoard', board);
  renderBoardTabs();
}

async function deleteBoard(id) {
  state.boards = state.boards.filter(b => b.id !== id);
  await dbDelete('boards', id);
  // Delete all columns and cards of this board
  const cols = state.columns.filter(c => c.boardId === id);
  const cards = state.cards.filter(c => c.boardId === id);
  for (const c of cols) { state.columns = state.columns.filter(x => x.id !== c.id); await dbDelete('columns', c.id); }
  for (const c of cards) { state.cards = state.cards.filter(x => x.id !== c.id); await dbDelete('cards', c.id); }
  syncToServer('deleteBoard', { id });
  if (state.activeBoardId === id) {
    await setActiveBoard(state.boards[0]?.id || null);
  }
  // Delete credentials too
  await dbDelete('boardCreds', id);
  renderAll();
}

async function setActiveBoard(id) {
  state.activeBoardId = id;
  await dbPut('settings', { key: 'activeBoardId', value: id });
}

// Change board password: re-hash key, re-encrypt, push to cloud under new key
async function changeBoardPassword(boardId, oldPassword, newPassword) {
  const creds = await getBoardCreds(boardId);
  if (!creds) throw new Error('Board credentials not found');
  // Verify old password by checking it matches stored
  const expectedOldHash = await hashKey(boardId, oldPassword);
  if (expectedOldHash !== creds.keyHash) throw new Error('Current password is incorrect');
  const newKeyHash = await hashKey(boardId, newPassword);
  // Update local creds
  const newCreds = { ...creds, password: newPassword, keyHash: newKeyHash };
  await dbPut('boardCreds', newCreds);
  // Delete old key from KV by pushing empty signal? No — just push under new key
  // We can't delete old key without a delete endpoint, so we just write new key
  await pushBoardToWorker(boardId); // uses updated creds from IDB
  return true;
}

// ═══════════════════════════════════════════════════════
// COLUMN OPERATIONS
// ═══════════════════════════════════════════════════════
const COL_COLORS = ['#6c63ff','#06b6d4','#22c55e','#f59e0b','#ef4444','#ec4899','#f97316'];
function nextColColor(boardId) {
  const count = state.columns.filter(c => c.boardId === boardId).length;
  return COL_COLORS[count % COL_COLORS.length];
}

async function createColumn(boardId, name) {
  const existing = state.columns.filter(c => c.boardId === boardId);
  const col = {
    id: uid(), boardId, name: name || 'New Column',
    order: existing.length, color: nextColColor(boardId),
    createdAt: Date.now(),
  };
  await dbPut('columns', col);
  state.columns.push(col);
  syncToServer('upsertColumn', col);
  renderBoardView();
  return col;
}

async function updateColumn(id, updates) {
  const col = state.columns.find(c => c.id === id);
  if (!col) return;
  Object.assign(col, updates);
  await dbPut('columns', col);
  syncToServer('upsertColumn', col);
}

async function deleteColumn(id) {
  const col = state.columns.find(c => c.id === id);
  if (!col) return;
  // Move cards to backlog
  const cards = state.cards.filter(c => c.columnId === id);
  for (const card of cards) {
    card.columnId = null;
    await dbPut('cards', card);
    syncToServer('upsertCard', card);
  }
  state.columns = state.columns.filter(c => c.id !== id);
  await dbDelete('columns', id);
  syncToServer('deleteColumn', { id });
  renderBoardView();
  renderBacklog();
}

// ═══════════════════════════════════════════════════════
// CARD OPERATIONS
// ═══════════════════════════════════════════════════════
async function createCard(boardId, columnId, data = {}) {
  const colCards = state.cards.filter(c => c.columnId === columnId);
  const card = {
    id: uid(), boardId, columnId,
    title: data.title || 'New Card',
    desc: data.desc || '',
    tags: data.tags || [],
    color: data.color || 'transparent',
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    order: colCards.length,
    createdAt: Date.now(),
  };
  await dbPut('cards', card);
  state.cards.push(card);
  await recordActivity(boardId, card.id, 'created', {
    cardTitle: card.title,
    toColId: columnId,
    toColName: colName(columnId),
  });
  syncToServer('upsertCard', card);
  renderBoardView();
  renderBacklog();
  refreshCalendar();
  refreshTimeline();
  return card;
}

async function updateCard(id, updates) {
  const card = state.cards.find(c => c.id === id);
  if (!card) return;
  const oldColId = card.columnId;
  const oldDue = card.dueDate;
  Object.assign(card, updates);
  await dbPut('cards', card);
  // Record column move if column changed
  if ('columnId' in updates && updates.columnId !== oldColId) {
    await recordActivity(card.boardId, id, 'moved', {
      cardTitle: card.title,
      fromColId: oldColId,
      fromColName: colName(oldColId),
      toColId: card.columnId,
      toColName: colName(card.columnId),
    });
  } else if ('dueDate' in updates && updates.dueDate !== oldDue) {
    await recordActivity(card.boardId, id, 'due_set', {
      cardTitle: card.title,
      dueDate: card.dueDate,
      toColId: card.columnId,
      toColName: colName(card.columnId),
    });
  } else {
    await recordActivity(card.boardId, id, 'updated', {
      cardTitle: card.title,
      toColId: card.columnId,
      toColName: colName(card.columnId),
    });
  }
  syncToServer('upsertCard', card);
  renderBoardView();
  renderBacklog();
  refreshCalendar();
  refreshTimeline();
}

async function deleteCard(id) {
  const card = state.cards.find(c => c.id === id);
  if (card) {
    await recordActivity(card.boardId, id, 'deleted', {
      cardTitle: card.title,
      fromColId: card.columnId,
      fromColName: colName(card.columnId),
    });
  }
  state.cards = state.cards.filter(c => c.id !== id);
  await dbDelete('cards', id);
  syncToServer('deleteCard', { id });
  renderBoardView();
  renderBacklog();
  refreshCalendar();
  refreshTimeline();
}

async function moveCard(cardId, targetColumnId, targetOrder) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  const oldColId = card.columnId;
  // Don't record if dropped in same column
  const didChangeCol = oldColId !== targetColumnId;
  card.columnId = targetColumnId;
  card.order = targetOrder;
  const siblings = state.cards.filter(c => c.columnId === targetColumnId && c.id !== cardId)
    .sort((a, b) => a.order - b.order);
  siblings.splice(targetOrder, 0, card);
  for (let i = 0; i < siblings.length; i++) {
    siblings[i].order = i;
    await dbPut('cards', siblings[i]);
  }
  if (didChangeCol) {
    await recordActivity(card.boardId, cardId, 'moved', {
      cardTitle: card.title,
      fromColId: oldColId,
      fromColName: colName(oldColId),
      toColId: targetColumnId,
      toColName: colName(targetColumnId),
    });
  }
  syncToServer('upsertCard', card);
  renderBoardView();
  renderBacklog();
  refreshCalendar();
  refreshTimeline();
}

// ═══════════════════════════════════════════════════════
// RENDER: BOARD TABS
// ═══════════════════════════════════════════════════════
function renderBoardTabs() {
  const container = document.getElementById('board-tabs');
  container.innerHTML = '';
  for (const board of state.boards) {
    const tab = document.createElement('div');
    tab.className = 'board-tab' + (board.id === state.activeBoardId ? ' active' : '');
    tab.innerHTML = `
      <span class="tab-dot"></span>
      <span class="tab-name">${escHtml(board.name)}</span>
      <span class="tab-close" data-id="${board.id}">✕</span>
    `;
    tab.addEventListener('click', async e => {
      if (e.target.classList.contains('tab-close')) {
        e.stopPropagation();
        if (confirm(`Delete board "${board.name}"?`)) await deleteBoard(board.id);
        return;
      }
      await setActiveBoard(board.id);
      renderAll();
    });
    // Double-click to rename
    tab.querySelector('.tab-name').addEventListener('dblclick', e => {
      e.stopPropagation();
      const name = prompt('Rename board:', board.name);
      if (name && name.trim()) renameBoard(board.id, name.trim());
    });
    container.appendChild(tab);
  }
}

// ═══════════════════════════════════════════════════════
// RENDER: BOARD VIEW
// ═══════════════════════════════════════════════════════
function getBoardCards(boardId) {
  let cards = state.cards.filter(c => c.boardId === boardId && c.columnId !== null);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    cards = cards.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.desc || '').toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  return cards;
}

function renderBoardView() {
  const area = document.getElementById('columns-area');
  if (!state.activeBoardId) {
    area.innerHTML = `<div class="empty-state" style="margin:auto"><div class="empty-state-icon">📋</div><div class="empty-state-title">No board selected</div><div class="empty-state-text">Create a board to get started</div></div>`;
    return;
  }
  const cols = state.columns.filter(c => c.boardId === state.activeBoardId).sort((a, b) => a.order - b.order);
  area.innerHTML = '';

  for (const col of cols) {
    const cards = getBoardCards(state.activeBoardId).filter(c => c.columnId === col.id).sort((a, b) => a.order - b.order);
    const colEl = buildColumnEl(col, cards);
    area.appendChild(colEl);
  }

  // Add column button
  const addBtn = document.createElement('div');
  addBtn.className = 'add-column-btn';
  addBtn.innerHTML = '<span style="font-size:18px">+</span> Add Column';
  addBtn.addEventListener('click', () => openAddColumnModal());
  area.appendChild(addBtn);
}

function buildColumnEl(col, cards) {
  const el = document.createElement('div');
  el.className = 'column';
  el.dataset.colId = col.id;

  el.innerHTML = `
    <div class="col-header">
      <span class="col-drag-handle" title="Drag to reorder">⠿</span>
      <div class="col-color-dot" style="background:${col.color}" title="Change color"></div>
      <input class="col-title" value="${escHtml(col.name)}" spellcheck="false">
      <span class="col-count">${cards.length}</span>
      <button class="col-menu-btn" data-id="${col.id}">⋯</button>
    </div>
    <div class="col-cards" data-col-id="${col.id}"></div>
    <button class="col-add-btn" data-col-id="${col.id}">
      <span>+</span> Add card
    </button>
  `;

  const cardsArea = el.querySelector('.col-cards');
  for (const card of cards) {
    cardsArea.appendChild(buildCardEl(card));
  }

  // Column rename
  const titleInput = el.querySelector('.col-title');
  titleInput.addEventListener('blur', () => {
    if (titleInput.value.trim()) updateColumn(col.id, { name: titleInput.value.trim() });
  });
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') titleInput.blur();
  });

  // Column menu
  el.querySelector('.col-menu-btn').addEventListener('click', e => {
    showCtxMenu(e, [
      { label: '✏ Rename', action: () => { titleInput.select(); titleInput.focus(); } },
      { sep: true },
      { label: '🗑 Delete column', cls: 'danger', action: () => {
        if (confirm(`Delete column "${col.name}"? Cards go to backlog.`)) deleteColumn(col.id);
      }},
    ]);
  });

  // Add card
  el.querySelector('.col-add-btn').addEventListener('click', () => {
    openCardModal(null, col.id, state.activeBoardId);
  });

  // Drag/drop cards
  setupColumnDrop(cardsArea, col.id);

  // Color dot picker
  el.querySelector('.col-color-dot').addEventListener('click', e => {
    e.stopPropagation();
    showColColorPicker(e.currentTarget, col);
  });

  // Column reorder drag
  initColumnDrag(el, col.id);

  return el;
}

function buildCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = card.id;

  const due = formatDue(card.dueDate);
  const tagsHtml = (card.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
  const priorityHtml = card.priority && card.priority !== 'medium'
    ? `<span class="priority-badge priority-${card.priority}">${card.priority.toUpperCase()}</span>`
    : '';

  el.innerHTML = `
    <div class="card-color-bar" style="background:${card.color === 'transparent' ? 'transparent' : card.color}"></div>
    <div class="card-title">${escHtml(card.title)}</div>
    ${card.desc ? `<div class="card-desc">${escHtml(card.desc)}</div>` : ''}
    ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
    <div class="card-footer">
      ${priorityHtml}
      ${due ? `<span class="card-due ${due.cls}">${due.label}</span>` : ''}
      <span class="card-footer-spacer"></span>
      <button class="card-edit-btn" title="Edit card">✏</button>
    </div>
  `;

  el.querySelector('.card-edit-btn').addEventListener('click', e => {
    e.stopPropagation();
    openCardModal(card);
  });

  el.addEventListener('click', () => openCardModal(card));

  // Pointer-based drag
  initCardDrag(el, card.id);

  return el;
}

// ═══════════════════════════════════════════════════════
// DRAG SYSTEM — mouse (pointerdown) + touch (touchstart) unified
// ═══════════════════════════════════════════════════════
let _drag = null;

function initCardDrag(el, cardId) {
  // ── Mouse drag ──────────────────────────────────────
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY, el, cardId);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // ── Touch drag ──────────────────────────────────────
  let _touchStartX = 0, _touchStartY = 0, _touchMoved = false;
  el.addEventListener('touchstart', e => {
    if (e.target.closest('button')) return;
    const t = e.touches[0];
    _touchStartX = t.clientX;
    _touchStartY = t.clientY;
    _touchMoved = false;
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const dx = t.clientX - _touchStartX;
    const dy = t.clientY - _touchStartY;

    if (!_drag && !_touchMoved) {
      // Commit to drag once moved > 8px
      if (Math.sqrt(dx*dx + dy*dy) > 8) {
        _touchMoved = true;
        e.preventDefault();
        startDrag(_touchStartX, _touchStartY, el, cardId);
      }
      return;
    }

    if (!_drag) return;
    e.preventDefault();
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchend', e => {
    if (_drag) {
      e.preventDefault();
      endDrag();
    }
    _touchMoved = false;
  }, { passive: false });

  el.addEventListener('touchcancel', () => {
    if (_drag) cancelDrag();
    _touchMoved = false;
  });
}

function startDrag(startX, startY, sourceEl, cardId) {
  const rect = sourceEl.getBoundingClientRect();
  const offsetX = startX - rect.left;
  const offsetY = startY - rect.top;

  const originalCard = state.cards.find(c => c.id === cardId);

  const ghost = sourceEl.cloneNode(true);
  ghost.style.cssText = `
    position:fixed;left:${rect.left}px;top:${rect.top}px;
    width:${rect.width}px;z-index:9999;pointer-events:none;touch-action:none;
    box-shadow:0 16px 48px rgba(0,0,0,0.55);opacity:0.94;
    animation:none;transition:none;margin:0;transform:rotate(2deg) scale(1.03);
  `;
  document.body.appendChild(ghost);

  sourceEl.style.display = 'none';

  const placeholder = document.createElement('div');
  placeholder.className = 'card-placeholder';
  placeholder.style.height = rect.height + 'px';

  _drag = {
    cardId, sourceEl, ghost, placeholder,
    offsetX, offsetY,
    originalNextSibling: sourceEl.nextSibling,
    originalParent: sourceEl.parentNode,
  };
}

function onMouseMove(e) {
  if (!_drag) return;
  moveDrag(e.clientX, e.clientY);
}

function onMouseUp() {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  if (_drag) endDrag();
}

function moveDrag(x, y) {
  const { ghost, placeholder, sourceEl } = _drag;

  ghost.style.left = (x - _drag.offsetX) + 'px';
  ghost.style.top  = (y - _drag.offsetY) + 'px';

  // Hit-test under ghost
  ghost.style.visibility = 'hidden';
  const target = document.elementFromPoint(x, y);
  ghost.style.visibility = '';

  document.querySelectorAll('.column.drag-over').forEach(c => c.classList.remove('drag-over'));
  const backlogEl = document.getElementById('backlog-area');
  backlogEl.style.outline = '';

  if (!target) return;

  const colCards = target.closest('.col-cards');
  const inBacklog = target.closest('#backlog-area');

  if (colCards) {
    colCards.closest('.column').classList.add('drag-over');
    // Find insertion point
    const cards = [...colCards.querySelectorAll('.card')].filter(c => c !== sourceEl);
    let insertBefore = null;
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (y < box.top + box.height / 2) { insertBefore = card; break; }
    }
    if (insertBefore) {
      if (placeholder.nextSibling !== insertBefore) colCards.insertBefore(placeholder, insertBefore);
    } else {
      if (colCards.lastElementChild !== placeholder) colCards.appendChild(placeholder);
    }
  } else if (inBacklog) {
    backlogEl.style.outline = '2px solid var(--accent)';
    backlogEl.style.outlineOffset = '-2px';
    document.getElementById('backlog-cards').appendChild(placeholder);
  }
}

async function endDrag() {
  if (!_drag) return;
  const { cardId, sourceEl, ghost, placeholder } = _drag;
  _drag = null;

  ghost.remove();
  document.querySelectorAll('.column.drag-over').forEach(c => c.classList.remove('drag-over'));
  document.getElementById('backlog-area').style.outline = '';

  const colCards = placeholder.closest('.col-cards');
  const inBacklog = placeholder.closest('#backlog-area');

  if (!colCards && !inBacklog) {
    placeholder.remove();
    sourceEl.style.display = '';
    return;
  }

  let targetColId = null, targetIdx = 0;
  if (colCards) {
    targetColId = colCards.dataset.colId;
    targetIdx = [...colCards.children].filter(c => c !== sourceEl).indexOf(placeholder);
    if (targetIdx < 0) targetIdx = [...colCards.querySelectorAll('.card')].filter(c => c !== sourceEl).length;
  }

  placeholder.remove();
  sourceEl.remove();
  await moveCard(cardId, targetColId, targetIdx);
}

function cancelDrag() {
  if (!_drag) return;
  const { ghost, placeholder, sourceEl } = _drag;
  _drag = null;
  ghost.remove();
  placeholder.remove();
  sourceEl.style.display = '';
  document.querySelectorAll('.column.drag-over').forEach(c => c.classList.remove('drag-over'));
  document.getElementById('backlog-area').style.outline = '';
}

// no-ops (kept for call-site compatibility)
function setupColumnDrop() {}
function initBacklogDrop() {}

// ═══════════════════════════════════════════════════════
// COLUMN COLOR PICKER
// ═══════════════════════════════════════════════════════
function showColColorPicker(dotEl, col) {
  // Remove any existing picker
  document.querySelector('.col-color-picker-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'col-color-picker-popup';

  const colors = CARD_COLORS.filter(c => c.value !== 'transparent');
  popup.innerHTML = colors.map(c => `
    <div class="col-color-picker-swatch ${col.color === c.value ? 'active' : ''}"
      data-color="${c.value}"
      style="background:${c.value}"
      title="${c.name}"></div>
  `).join('');

  // Position below the dot
  const rect = dotEl.getBoundingClientRect();
  popup.style.cssText = `
    position:fixed;
    top:${rect.bottom + 6}px;
    left:${rect.left}px;
    z-index:4000;
  `;

  popup.addEventListener('click', async e => {
    const swatch = e.target.closest('.col-color-picker-swatch');
    if (!swatch) return;
    const color = swatch.dataset.color;
    await updateColumn(col.id, { color });
    dotEl.style.background = color;
    popup.querySelectorAll('.col-color-picker-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
    popup.remove();
  });

  document.body.appendChild(popup);

  // Close on outside click
  const close = e => {
    if (!popup.contains(e.target) && e.target !== dotEl) {
      popup.remove();
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('touchstart', close, true);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close, true);
    document.addEventListener('touchstart', close, true);
  }, 0);
}

// ═══════════════════════════════════════════════════════
// COLUMN REORDER DRAG
// ═══════════════════════════════════════════════════════
let _colDrag = null;

function initColumnDrag(colEl, colId) {
  const handle = colEl.querySelector('.col-drag-handle');

  const startColDrag = (startX, startY) => {
    const area = document.getElementById('columns-area');
    const rect = colEl.getBoundingClientRect();

    const ghost = colEl.cloneNode(true);
    ghost.style.cssText = `
      position:fixed;left:${rect.left}px;top:${rect.top}px;
      width:${rect.width}px;height:${rect.height}px;
      z-index:9999;pointer-events:none;touch-action:none;
      opacity:0.85;box-shadow:0 16px 48px rgba(0,0,0,0.55);
      transform:rotate(1.5deg) scale(1.02);transition:none;
    `;
    document.body.appendChild(ghost);

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `flex:0 0 ${rect.width}px;height:${rect.height}px;
      border-radius:var(--radius-lg);background:var(--accent-glow);
      border:2px dashed var(--accent);`;
    colEl.parentNode.insertBefore(placeholder, colEl);
    colEl.style.display = 'none';

    _colDrag = {
      colId, colEl, ghost, placeholder,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
    };
  };

  const moveColDrag = (x, y) => {
    if (!_colDrag) return;
    const { ghost, placeholder, colEl } = _colDrag;
    ghost.style.left = (x - _colDrag.offsetX) + 'px';
    ghost.style.top  = (y - _colDrag.offsetY) + 'px';

    // Find insertion point among sibling columns
    ghost.style.visibility = 'hidden';
    const target = document.elementFromPoint(x, y);
    ghost.style.visibility = '';
    if (!target) return;

    const targetCol = target.closest('.column');
    if (targetCol && targetCol !== colEl) {
      const tRect = targetCol.getBoundingClientRect();
      if (x < tRect.left + tRect.width / 2) {
        targetCol.parentNode.insertBefore(placeholder, targetCol);
      } else {
        targetCol.parentNode.insertBefore(placeholder, targetCol.nextSibling);
      }
    }
  };

  const endColDrag = async () => {
    if (!_colDrag) return;
    const { colId, colEl, ghost, placeholder } = _colDrag;
    _colDrag = null;

    ghost.remove();
    placeholder.parentNode.insertBefore(colEl, placeholder);
    placeholder.remove();
    colEl.style.display = '';

    // Derive new order from DOM positions
    const area = document.getElementById('columns-area');
    const colEls = [...area.querySelectorAll('.column')];
    const updates = colEls.map((el, i) => ({ id: el.dataset.colId, order: i }));
    for (const { id, order } of updates) {
      await updateColumn(id, { order });
    }
  };

  const cancelColDrag = () => {
    if (!_colDrag) return;
    const { colEl, ghost, placeholder } = _colDrag;
    _colDrag = null;
    ghost.remove();
    placeholder.parentNode.insertBefore(colEl, placeholder);
    placeholder.remove();
    colEl.style.display = '';
  };

  // Mouse
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startColDrag(e.clientX, e.clientY);
    const onMove = e => moveColDrag(e.clientX, e.clientY);
    const onUp   = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      endColDrag();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch
  let _tStartX = 0, _tStartY = 0, _tMoved = false;
  handle.addEventListener('touchstart', e => {
    const t = e.touches[0];
    _tStartX = t.clientX; _tStartY = t.clientY; _tMoved = false;
  }, { passive: true });

  handle.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const dx = t.clientX - _tStartX, dy = t.clientY - _tStartY;
    if (!_colDrag && !_tMoved) {
      if (Math.sqrt(dx*dx + dy*dy) > 8) {
        _tMoved = true;
        e.preventDefault();
        startColDrag(_tStartX, _tStartY);
      }
      return;
    }
    if (!_colDrag) return;
    e.preventDefault();
    moveColDrag(t.clientX, t.clientY);
  }, { passive: false });

  handle.addEventListener('touchend', e => {
    if (_colDrag) { e.preventDefault(); endColDrag(); }
    _tMoved = false;
  }, { passive: false });

  handle.addEventListener('touchcancel', () => {
    if (_colDrag) cancelColDrag();
    _tMoved = false;
  });
}

// ═══════════════════════════════════════════════════════
// RENDER: BACKLOG
// ═══════════════════════════════════════════════════════
function renderBacklog() {
  if (!state.activeBoardId) return;
  const backlogCards = state.cards.filter(c => c.boardId === state.activeBoardId && !c.columnId);
  const container = document.getElementById('backlog-cards');
  const count = document.getElementById('backlog-count');
  count.textContent = backlogCards.length;
  container.innerHTML = '';
  if (backlogCards.length === 0) {
    container.innerHTML = `<div style="padding:16px 0;color:var(--text3);font-size:12px">No backlog items</div>`;
    return;
  }
  for (const card of backlogCards) {
    container.appendChild(buildCardEl(card));
  }
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  const label = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 0) return { cls: 'overdue', label: `⚠ ${label}` };
  if (diff < 3) return { cls: 'soon', label: `◷ ${label}` };
  return { cls: 'ok', label: `◷ ${label}` };
}

// ═══════════════════════════════════════════════════════
// ACTIVITY HELPERS (used by calendar modal + timeline)
// ═══════════════════════════════════════════════════════
const ACTIVITY_META = {
  moved:   { icon: '⇢', label: 'Moved',   color: 'var(--accent2)' },
  created: { icon: '✦', label: 'Created', color: 'var(--green)'   },
  updated: { icon: '✎', label: 'Edited',  color: 'var(--cyan)'    },
  deleted: { icon: '✕', label: 'Deleted', color: 'var(--red)'     },
  due_set: { icon: '◷', label: 'Due set', color: 'var(--yellow)'  },
};

function activityDescription(ev) {
  const card = state.cards.find(c => c.id === ev.cardId);
  const title = escHtml(ev.cardTitle || card?.title || 'Card');
  switch (ev.type) {
    case 'moved':
      return `<strong>${title}</strong> moved from <em>${escHtml(ev.fromColName || 'Backlog')}</em> → <em>${escHtml(ev.toColName || 'Backlog')}</em>`;
    case 'created':
      return `<strong>${title}</strong> created in <em>${escHtml(ev.toColName || 'Backlog')}</em>`;
    case 'updated':
      return `<strong>${title}</strong> edited in <em>${escHtml(ev.toColName || 'Backlog')}</em>`;
    case 'deleted':
      return `<strong>${title}</strong> deleted from <em>${escHtml(ev.fromColName || 'Backlog')}</em>`;
    case 'due_set':
      return `<strong>${title}</strong> due date set to <em>${escHtml(ev.dueDate || '—')}</em>`;
    default:
      return `<strong>${title}</strong>`;
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDayHeading(ts) {
  const d = new Date(ts);
  const today = new Date();
  const dKey = dayKey(ts);
  if (dKey === dayKey(today.getTime())) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dKey === dayKey(yesterday.getTime())) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════
// RENDER: CALENDAR
// ═══════════════════════════════════════════════════════
function refreshCalendar() {
  if (state.activeView === 'calendar') renderCalendar();
}

function openDayDetailModal(dateLabel, dayEvents, dayDueCards) {
  const hasEvents = dayEvents.length > 0 || dayDueCards.length > 0;
  if (!hasEvents) return;

  // Build activity entries for this day (timeline style)
  const eventRows = dayEvents.map(ev => {
    const card = state.cards.find(c => c.id === ev.cardId);
    const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
    const cardColor = (card?.color && card.color !== 'transparent') ? card.color : meta.color;
    return `
      <div class="tl-entry" style="margin-bottom:0">
        <div class="tl-entry-spine" style="padding-top:12px">
          <div class="tl-entry-dot" style="width:10px;height:10px;background:${cardColor};box-shadow:0 0 0 3px var(--bg2),0 0 0 4px ${cardColor}55"></div>
        </div>
        <div class="tl-entry-body${card ? ' clickable' : ''}" data-card-id="${card?.id || ''}" style="margin-bottom:8px">
          <div class="tl-entry-header">
            <span class="tl-entry-icon" style="color:${meta.color}">${meta.icon}</span>
            <span class="tl-entry-type" style="color:${meta.color}">${meta.label}</span>
            <span class="tl-entry-time">${formatTime(ev.ts)}</span>
          </div>
          <div class="tl-entry-desc">${activityDescription(ev)}</div>
          <div class="tl-entry-footer">
            ${card ? `<span class="tl-entry-card-link">Open card →</span>` : `<span class="tl-entry-card-deleted">Card no longer exists</span>`}
          </div>
        </div>
      </div>`;
  }).join('');

  const dueRows = dayDueCards.map(card => {
    const col = card.columnId ? state.columns.find(c => c.id === card.columnId) : null;
    const color = (card.color && card.color !== 'transparent') ? card.color : 'var(--yellow)';
    return `
      <div class="tl-entry" style="margin-bottom:0">
        <div class="tl-entry-spine" style="padding-top:12px">
          <div class="tl-entry-dot" style="width:10px;height:10px;background:${color};box-shadow:0 0 0 3px var(--bg2),0 0 0 4px ${color}55"></div>
        </div>
        <div class="tl-entry-body clickable" data-card-id="${card.id}" style="margin-bottom:8px">
          <div class="tl-entry-header">
            <span class="tl-entry-icon" style="color:var(--yellow)">◷</span>
            <span class="tl-entry-type" style="color:var(--yellow)">Due date</span>
          </div>
          <div class="tl-entry-desc"><strong>${escHtml(card.title)}</strong> due in <em>${escHtml(col?.name || 'Backlog')}</em></div>
          <div class="tl-entry-footer"><span class="tl-entry-card-link">Open card →</span></div>
        </div>
      </div>`;
  }).join('');

  const modal = openModal(`
    <div class="modal modal-lg day-detail-modal">
      <div class="modal-title">
        📅 ${escHtml(dateLabel)}
        <button class="modal-close">✕</button>
      </div>
      ${eventRows || dueRows
        ? `<div style="padding-left:8px">${eventRows}${dueRows}</div>`
        : `<div class="empty-state"><div class="empty-state-text">No activity this day</div></div>`
      }
    </div>
  `);

  modal.querySelector('.modal-close').addEventListener('click', closeModal);

  // Wire up card clicks
  modal.querySelectorAll('.tl-entry-body[data-card-id]').forEach(el => {
    const cardId = el.dataset.cardId;
    if (!cardId) return;
    const card = state.cards.find(c => c.id === cardId);
    if (card) el.addEventListener('click', () => { closeModal(); openCardModal(card); });
  });
}

function renderCalendar() {
  const d = state.calendarDate;
  const year = d.getFullYear();
  const month = d.getMonth();
  document.getElementById('cal-month-label').textContent =
    d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Sync toggle button state
  const toggleBtn = document.getElementById('cal-due-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', state.showDueDateOnly);
    toggleBtn.textContent = state.showDueDateOnly ? '◷ All activity' : '◷ Due only';
    toggleBtn.title = state.showDueDateOnly ? 'Show all activity' : 'Show due dates only';
  }

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const day of days) {
    const h = document.createElement('div');
    h.className = 'cal-day-header';
    h.textContent = day;
    grid.appendChild(h);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // All cards for this board — filter by dueDate only if toggle is on
  let allCards = state.activeBoardId
    ? state.cards.filter(c => c.boardId === state.activeBoardId)
    : [...state.cards];

  // Activity events for this board
  let boardActivity = state.activity.filter(e =>
    !state.activeBoardId || e.boardId === state.activeBoardId
  );

  // Build a lookup: columnId -> column name
  const colMap = {};
  for (const col of state.columns) colMap[col.id] = col;

  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    const prevDay = new Date(year, month, -firstDay + i + 1);
    cell.innerHTML = `<div class="cal-day-num">${prevDay.getDate()}</div>`;
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    cell.className = 'cal-day' + (isToday ? ' today' : '');
    cell.innerHTML = `<div class="cal-day-num">${day}</div>`;

    // Collect events and due cards for this day
    const dayEvents = boardActivity.filter(e => {
      if (state.showDueDateOnly && e.type !== 'due_set') return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const card = state.cards.find(c => c.id === e.cardId);
        if (!((e.cardTitle || card?.title || '').toLowerCase().includes(q) ||
              (card?.tags || []).some(t => t.toLowerCase().includes(q)) ||
              (card?.desc || '').toLowerCase().includes(q))) return false;
      }
      const ed = new Date(e.ts);
      return ed.getFullYear() === year && ed.getMonth() === month && ed.getDate() === day;
    });

    const dayDueCards = state.showDueDateOnly ? allCards.filter(c => {
      if (!c.dueDate) return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        if (!c.title.toLowerCase().includes(q) &&
            !(c.desc || '').toLowerCase().includes(q) &&
            !(c.tags || []).some(t => t.toLowerCase().includes(q))) return false;
      }
      const cd = new Date(c.dueDate);
      return cd.getFullYear() === year && cd.getMonth() === month && cd.getDate() === day;
    }) : [];

    // Deduplicate events: one dot per card, highest-priority event wins
    const priority = { moved: 5, created: 4, due_set: 3, updated: 2, deleted: 1 };
    const seenCards = new Map();
    for (const ev of dayEvents) {
      const prev = seenCards.get(ev.cardId);
      if (!prev || (priority[ev.type] || 0) > (priority[prev.type] || 0)) {
        seenCards.set(ev.cardId, ev);
      }
    }

    // Add due-date cards that aren't already represented by activity
    const dueOnlyCards = dayDueCards.filter(c => !seenCards.has(c.id));

    const totalDots = seenCards.size + dueOnlyCards.length;
    if (totalDots > 0) {
      cell.classList.add('has-events');

      const chipsRow = document.createElement('div');
      chipsRow.className = 'cal-chips';

      // Activity dots
      for (const ev of seenCards.values()) {
        const card = state.cards.find(c => c.id === ev.cardId);
        const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
        const dotColor = (card?.color && card.color !== 'transparent') ? card.color : meta.color;
        const dot = document.createElement('div');
        dot.className = 'cal-card-chip';
        dot.style.background = dotColor;
        dot.style.color = dotColor;
        dot.title = (() => {
          const t = ev.cardTitle || card?.title || 'Card';
          if (ev.type === 'moved') return `${t}: ${ev.fromColName || 'Backlog'} → ${ev.toColName || 'Backlog'}`;
          if (ev.type === 'created') return `${t}: Created in ${ev.toColName || 'Backlog'}`;
          if (ev.type === 'due_set') return `${t}: Due date set`;
          return `${t}: ${meta.label}`;
        })();
        chipsRow.appendChild(dot);
      }

      // Due-date-only dots
      for (const card of dueOnlyCards) {
        const col = card.columnId ? colMap[card.columnId] : null;
        const dotColor = (card.color && card.color !== 'transparent') ? card.color : (col?.color || 'var(--yellow)');
        const dot = document.createElement('div');
        dot.className = 'cal-card-chip';
        dot.style.background = dotColor;
        dot.style.color = dotColor;
        dot.style.opacity = '0.6';
        dot.title = `${card.title}: Due`;
        chipsRow.appendChild(dot);
      }

      cell.appendChild(chipsRow);

      // Day-click opens the detail modal — pass full dayEvents (all activity), not deduplicated dots
      const dateLabel = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      cell.addEventListener('click', () => openDayDetailModal(dateLabel, dayEvents, dayDueCards));
    }

    grid.appendChild(cell);
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 ? 7 - (totalCells % 7) : 0;
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = `<div class="cal-day-num">${i}</div>`;
    grid.appendChild(cell);
  }
}

// ═══════════════════════════════════════════════════════
// RENDER: TIMELINE (vertical activity log)
// ═══════════════════════════════════════════════════════
function refreshTimeline() {
  if (state.activeView === 'timeline') renderTimeline();
}

function renderTimeline() {
  const container = document.getElementById('tl-container');
  container.innerHTML = '';

  const toggleBtn = document.getElementById('tl-due-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', state.showDueDateOnly);
    toggleBtn.textContent = state.showDueDateOnly ? '◷ All activity' : '◷ Due only';
  }

  // Get activity for this board, filtered if needed
  let events = state.activity.filter(e =>
    !state.activeBoardId || e.boardId === state.activeBoardId
  );
  if (state.showDueDateOnly) {
    events = events.filter(e => e.type === 'due_set');
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    events = events.filter(e => {
      const card = state.cards.find(c => c.id === e.cardId);
      return (e.cardTitle || card?.title || '').toLowerCase().includes(q) ||
             (card?.desc || '').toLowerCase().includes(q) ||
             (card?.tags || []).some(t => t.toLowerCase().includes(q)) ||
             (e.fromColName || '').toLowerCase().includes(q) ||
             (e.toColName || '').toLowerCase().includes(q);
    });
  }
  // Already sorted newest-first; scrolling down = going back in time
  events = events.sort((a, b) => b.ts - a.ts);

  if (!events.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🕓</div>
        <div class="empty-state-title">${state.showDueDateOnly ? 'No due date activity' : 'No activity yet'}</div>
        <div class="empty-state-text">${state.showDueDateOnly ? 'Set due dates on cards to see them here' : 'Move, create, or edit cards to build a history'}</div>
      </div>`;
    return;
  }

  // Group events by calendar day
  const byDay = new Map(); // dayKey -> [events]
  for (const ev of events) {
    const k = dayKey(ev.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(ev);
  }

  for (const [dk, dayEvents] of byDay) {
    // Day section heading
    const isToday = dk === dayKey(Date.now());
    const dayHeading = document.createElement('div');
    dayHeading.className = 'tl-day-heading' + (isToday ? ' tl-day-today' : '');
    dayHeading.innerHTML = `
      <span class="tl-day-label">${formatDayHeading(dayEvents[0].ts)}</span>
      <span class="tl-day-count">${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}</span>
    `;
    container.appendChild(dayHeading);

    // Vertical line + events column
    const dayBlock = document.createElement('div');
    dayBlock.className = 'tl-day-block';

    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
      const card = state.cards.find(c => c.id === ev.cardId);
      const cardColor = card?.color && card.color !== 'transparent' ? card.color : meta.color;
      const isLast = i === dayEvents.length - 1;

      const entry = document.createElement('div');
      entry.className = 'tl-entry';

      entry.innerHTML = `
        <div class="tl-entry-spine${isLast ? ' tl-entry-spine-last' : ''}">
          <div class="tl-entry-dot" style="background:${cardColor};box-shadow:0 0 0 3px var(--bg2),0 0 0 5px ${cardColor}55"></div>
        </div>
        <div class="tl-entry-body${card ? ' clickable' : ''}">
          <div class="tl-entry-header">
            <span class="tl-entry-icon" style="color:${meta.color}">${meta.icon}</span>
            <span class="tl-entry-type" style="color:${meta.color}">${meta.label}</span>
            <span class="tl-entry-time">${formatTime(ev.ts)}</span>
          </div>
          <div class="tl-entry-desc">${activityDescription(ev)}</div>
          <div class="tl-entry-footer">
            ${card ? `<span class="tl-entry-card-link">Open card →</span>` : `<span class="tl-entry-card-deleted">Card no longer exists</span>`}
          </div>
        </div>
      `;

      if (card) {
        entry.querySelector('.tl-entry-body').addEventListener('click', () => openCardModal(card));
      }

      dayBlock.appendChild(entry);
    }

    container.appendChild(dayBlock);
  }
}

// ═══════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════
let activeModal = null;

function closeModal() {
  if (activeModal) {
    activeModal.remove();
    activeModal = null;
  }
}

function openModal(content) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = content;

  // Stop all clicks/taps that originate inside the modal box from reaching the overlay
  const modalBox = overlay.firstElementChild;
  if (modalBox) {
    modalBox.addEventListener('click', e => e.stopPropagation());
    modalBox.addEventListener('touchend', e => e.stopPropagation());
  }

  // Tap on bare overlay backdrop closes the modal
  overlay.addEventListener('click', () => closeModal());

  document.body.appendChild(overlay);
  activeModal = overlay;
  setTimeout(() => overlay.querySelector('input,textarea')?.focus(), 50);
  return overlay;
}

// ─── Card Modal ───
function openCardModal(card, defaultColId, defaultBoardId) {
  const isNew = !card;
  const boardId = card?.boardId || defaultBoardId || state.activeBoardId;
  const columnId = card?.columnId ?? defaultColId ?? null;

  const cols = state.columns.filter(c => c.boardId === boardId);
  const colOptions = cols.map(c =>
    `<option value="${c.id}" ${c.id === columnId ? 'selected' : ''}>${escHtml(c.name)}</option>`
  ).join('');

  const colorPickerHtml = CARD_COLORS.map(c =>
    `<div class="color-option ${(card?.color || 'transparent') === c.value ? 'selected' : ''}"
      data-color="${c.value}"
      style="background:${c.value === 'transparent' ? 'var(--bg4)' : c.value}${c.value === 'transparent' ? ';border:1px solid var(--border2)' : ''}"
      title="${c.name}"></div>`
  ).join('');

  const tagsVal = (card?.tags || []).join(', ');

  const modal = openModal(`
    <div class="modal modal-lg">
      <div class="modal-title">
        ${isNew ? '＋ New Card' : '✏ Edit Card'}
        <button class="modal-close">✕</button>
      </div>
      <div class="form-group">
        <label class="form-label">Title</label>
        <input class="form-input" id="card-title" placeholder="Card title..." value="${escHtml(card?.title || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="card-desc" placeholder="Details, notes, links...">${escHtml(card?.desc || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Column</label>
          <select class="form-select" id="card-col">
            <option value="">— Backlog —</option>
            ${colOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select class="form-select" id="card-priority">
            <option value="low" ${card?.priority==='low'?'selected':''}>Low</option>
            <option value="medium" ${(!card?.priority||card?.priority==='medium')?'selected':''}>Medium</option>
            <option value="high" ${card?.priority==='high'?'selected':''}>High</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input class="form-input" type="date" id="card-due" value="${card?.dueDate || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Tags (comma separated)</label>
          <input class="form-input" id="card-tags" placeholder="bug, urgent, ui..." value="${tagsVal}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div class="color-picker" id="color-picker">${colorPickerHtml}</div>
      </div>
      <div class="modal-actions">
        ${!isNew ? `<button class="btn btn-danger" id="card-delete-btn">🗑 Delete</button>` : ''}
        <button class="btn btn-secondary" id="card-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="card-save-btn">${isNew ? 'Create Card' : 'Save Changes'}</button>
      </div>
    </div>
  `);

  // Color selection
  let selectedColor = card?.color || 'transparent';
  modal.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedColor = opt.dataset.color;
    });
  });

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#card-cancel-btn').addEventListener('click', closeModal);

  if (!isNew) {
    modal.querySelector('#card-delete-btn').addEventListener('click', async () => {
      if (confirm('Delete this card?')) {
        await deleteCard(card.id);
        closeModal();
        toast('Card deleted', '🗑');
      }
    });
  }

  modal.querySelector('#card-save-btn').addEventListener('click', async () => {
    const title = modal.querySelector('#card-title').value.trim();
    if (!title) { toast('Title required', '⚠'); return; }
    const colId = modal.querySelector('#card-col').value || null;
    const tags = modal.querySelector('#card-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    const data = {
      title,
      desc: modal.querySelector('#card-desc').value.trim(),
      columnId: colId,
      priority: modal.querySelector('#card-priority').value,
      dueDate: modal.querySelector('#card-due').value || null,
      tags,
      color: selectedColor,
    };
    // Close first so the modal is gone before async re-renders fire
    closeModal();
    if (isNew) {
      await createCard(boardId, colId, data);
      toast('Card created', '✓');
    } else {
      await updateCard(card.id, data);
      toast('Saved', '✓');
    }
  });
}

// ─── Add Column Modal ───
function openAddColumnModal() {
  const modal = openModal(`
    <div class="modal">
      <div class="modal-title">＋ New Column <button class="modal-close">✕</button></div>
      <div class="form-group">
        <label class="form-label">Column Name</label>
        <input class="form-input" id="col-name" placeholder="e.g. In Review, Done, Testing...">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="col-cancel">Cancel</button>
        <button class="btn btn-primary" id="col-create">Create Column</button>
      </div>
    </div>
  `);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#col-cancel').addEventListener('click', closeModal);
  modal.querySelector('#col-create').addEventListener('click', async () => {
    const name = modal.querySelector('#col-name').value.trim();
    if (!name) return;
    await createColumn(state.activeBoardId, name);
    closeModal();
    toast(`Column "${name}" created`, '✓');
  });
  modal.querySelector('#col-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') modal.querySelector('#col-create').click();
  });
}

// ─── Add Board Modal ───
function openAddBoardModal() {
  const modal = openModal(`
    <div class="modal">
      <div class="modal-title">＋ New Board <button class="modal-close">✕</button></div>
      <div class="form-group">
        <label class="form-label">Board Name</label>
        <input class="form-input" id="board-name" placeholder="e.g. Product Roadmap, Sprint 14...">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="board-password" type="password" placeholder="Protect this board with a password...">
        <p style="font-size:11px;color:var(--text3);margin-top:5px">Required to sync across devices. Cannot be recovered — save it somewhere safe.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Confirm Password</label>
        <input class="form-input" id="board-password-confirm" type="password" placeholder="Confirm password...">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="b-cancel">Cancel</button>
        <button class="btn btn-primary" id="b-create">Create Board</button>
      </div>
    </div>
  `);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#b-cancel').addEventListener('click', closeModal);
  modal.querySelector('#b-create').addEventListener('click', async () => {
    const name = modal.querySelector('#board-name').value.trim();
    const pw   = modal.querySelector('#board-password').value;
    const pw2  = modal.querySelector('#board-password-confirm').value;
    if (!name) { toast('Board name required', '⚠'); return; }
    if (!pw)   { toast('Password required', '⚠'); return; }
    if (pw !== pw2) { toast('Passwords do not match', '⚠'); return; }
    closeModal();
    const board = await createBoard(name, pw);
    await createColumn(board.id, 'To Do');
    await createColumn(board.id, 'In Progress');
    await createColumn(board.id, 'Done');
    renderAll();
    toast(`Board "${name}" created`, '✓');
  });
  modal.querySelector('#board-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') modal.querySelector('#board-password').focus();
  });
  modal.querySelector('#board-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') modal.querySelector('#board-password-confirm').focus();
  });
  modal.querySelector('#board-password-confirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') modal.querySelector('#b-create').click();
  });
}

// ─── Settings Modal ───
function openContactModal() {
  const modal = openModal(`
    <div class="modal">
      <div class="modal-title">✉ Contact Developer <button class="modal-close">✕</button></div>
      <div class="form-group">
        <label class="form-label">Reason</label>
        <select class="form-select" id="contact-reason">
          <option value="Feature Request">Feature Request</option>
          <option value="Bug">Bug</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Message (optional)</label>
        <textarea class="form-textarea" id="contact-message" placeholder="Describe your request or issue..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="contact-cancel">Cancel</button>
        <button class="btn btn-primary" id="contact-submit">Open Email Client</button>
      </div>
    </div>
  `);

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#contact-cancel').addEventListener('click', closeModal);
  modal.querySelector('#contact-submit').addEventListener('click', () => {
    const reason  = modal.querySelector('#contact-reason').value;
    const message = modal.querySelector('#contact-message').value.trim();
    const subject = encodeURIComponent(`FlowBoard.cc - Feedback - ${reason}`);
    const body    = encodeURIComponent(message);
    window.location.href = `mailto:abdullah@alkhafaji.dev?subject=${subject}${body ? `&body=${body}` : ''}`;
    closeModal();
  });
}

async function openSettingsModal() {
  const allCreds = await getAllBoardCreds();
  const secs = parseInt(state.syncInterval) || 600;

  const credsRows = allCreds.length ? allCreds.map(c => `
    <div class="board-cred-row" data-board-id="${escHtml(c.boardId)}">
      <span class="board-cred-name">${escHtml(c.name || c.boardId)}</span>
      <span style="font-size:10px;color:var(--text3);font-family:var(--font-mono)">${c.lastSynced ? 'synced ' + new Date(c.lastSynced).toLocaleDateString() : 'never synced'}</span>
      <span style="font-size:10px;color:var(--green);font-family:var(--font-mono);padding:1px 6px;background:rgba(34,197,94,0.1);border-radius:4px">🔒 encrypted</span>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-invite="${escHtml(c.boardId)}">🔗 Invite</button>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" data-change-pw="${escHtml(c.boardId)}">🔑 Change Password</button>
      <button class="btn btn-danger"    style="padding:3px 8px;font-size:11px" data-remove="${escHtml(c.boardId)}">✕</button>
    </div>
  `).join('') : '<p style="font-size:12px;color:var(--text3)">No synced boards yet.</p>';

  const modal = openModal(`
    <div class="modal modal-lg">
      <div class="modal-title">⚙ Settings <button class="modal-close">✕</button></div>

      <div class="settings-section">
        <div class="settings-section-title">Cloud Sync (Cloudflare KV)</div>
        <div class="server-indicator" id="settings-worker-indicator">
          <div class="dot" style="width:8px;height:8px;border-radius:50%;background:${isWorkerOk() ? 'var(--green)' : 'var(--red)'}"></div>
          <span id="settings-worker-status">${isWorkerOk() ? 'Worker reachable' : 'Worker unreachable'}</span>
        </div>
        <br>
        <div class="form-group">
          <label class="form-label">Worker URL</label>
          <input class="form-input" id="settings-worker-url" value="${escHtml(state.workerUrl || WORKER_URL)}" placeholder="https://flowboard-worker.*.workers.dev">
        </div>
        <div style="display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap">
        <div class="form-group">
          <label class="form-label">Sync Interval</label>
          <select class="form-select" id="settings-sync-interval" style="width:200px">
            <option value="60"  ${secs===60?'selected':''}>Every minute</option>
            <option value="300" ${secs===300?'selected':''}>Every 5 minutes</option>
            <option value="600" ${secs===600||(!secs)?'selected':''}>Every 10 minutes</option>
            <option value="1800" ${secs===1800?'selected':''}>Every 30 minutes</option>
            <option value="3600" ${secs===3600?'selected':''}>Every hour</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Version</label>
          <button class="btn btn-secondary" id="settings-check-update" style="display:flex;align-items:center;gap:6px">
            <span id="settings-update-icon">🔄</span>
            <span id="settings-update-label">Check &amp; Update</span>
          </button>
        </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Synced Boards</div>
        <div id="creds-list" style="display:flex;flex-direction:column;gap:8px">${credsRows}</div>
      </div>

      <div class="settings-section" style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <details>
          <summary style="cursor:pointer;padding:12px 14px;font-size:12px;font-weight:600;letter-spacing:0.5px;color:var(--text2);list-style:none;display:flex;align-items:center;gap:8px;background:var(--bg3)">
            <span>▸</span> ADVANCED
          </summary>
          <div style="padding:14px">
            <div class="settings-section-title" style="margin-bottom:10px">Join a Board</div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Board ID</label>
                <input class="form-input" id="join-board-id" placeholder="Paste board ID from invite link...">
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <input class="form-input" id="join-password" type="password" placeholder="Board password...">
              </div>
            </div>
            <button class="btn btn-primary" id="join-board-btn" style="width:100%">Join Board</button>
          </div>
        </details>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Data</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary" id="export-btn">Export JSON</button>
          <button class="btn btn-secondary" id="import-btn">Import JSON</button>
          <input id="import-file" type="file" accept=".json" style="display:none">
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="contact-dev-btn" style="margin-right:auto">✉ Contact Developer</button>
        <button class="btn btn-secondary" id="settings-close">Close</button>
        <button class="btn btn-primary" id="settings-save">Save Settings</button>
      </div>
    </div>
  `);

  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#settings-close').addEventListener('click', closeModal);

  // Check & Update App — triggers SW update check then reloads when a new version activates
  modal.querySelector('#settings-check-update').addEventListener('click', async () => {
    const btn   = modal.querySelector('#settings-check-update');
    const icon  = modal.querySelector('#settings-update-icon');
    const label = modal.querySelector('#settings-update-label');

    btn.disabled = true;
    icon.textContent  = '⏳';
    label.textContent = 'Checking…';

    if (!('serviceWorker' in navigator)) {
      icon.textContent  = '⚠️';
      label.textContent = 'SW not supported';
      btn.disabled = false;
      return;
    }

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        icon.textContent  = '⚠️';
        label.textContent = 'No SW registered';
        btn.disabled = false;
        return;
      }

      // If a new SW is already waiting, skip it straight to active and reload
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await new Promise(r => setTimeout(r, 400));
        window.location.reload();
        return;
      }

      // Ask the SW to check for an update from the network
      await reg.update();

      if (reg.waiting) {
        // Update was already downloaded — activate and reload
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await new Promise(r => setTimeout(r, 400));
        window.location.reload();
        return;
      }

      // Listen for a new SW installing during this check
      let settled = false;
      const onUpdate = (newReg) => {
        const sw = newReg.installing || newReg.waiting;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && !settled) {
            settled = true;
            sw.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(() => window.location.reload(), 400);
          }
        });
      };

      reg.addEventListener('updatefound', () => onUpdate(reg));

      // Give it 5 seconds; if nothing new found, report up-to-date
      await new Promise(r => setTimeout(r, 5000));
      if (!settled) {
        icon.textContent  = '✅';
        label.textContent = 'Already up to date';
        btn.disabled = false;
      }
    } catch (err) {
      console.error('[FlowBoard] Update check failed:', err);
      icon.textContent  = '❌';
      label.textContent = 'Update check failed';
      btn.disabled = false;
    }
  });
  modal.querySelector('#contact-dev-btn').addEventListener('click', openContactModal);

  function setWorkerIndicator(ok, msg) {
    const ind = modal.querySelector('#settings-worker-indicator');
    if (!ind) return;
    ind.querySelector('.dot').style.background = ok ? 'var(--green)' : 'var(--red)';
    modal.querySelector('#settings-worker-status').textContent = msg;
  }

  // Save settings
  modal.querySelector('#settings-save').addEventListener('click', async () => {
    const url = modal.querySelector('#settings-worker-url').value.trim();
    const interval = parseInt(modal.querySelector('#settings-sync-interval').value) || 600;
    await dbPut('settings', { key: 'workerUrl',    value: url });
    await dbPut('settings', { key: 'syncInterval', value: interval });
    state.workerUrl    = url;
    state.syncInterval = interval;
    stopSyncTimer();
    setWorkerIndicator(false, 'Syncing…');
    const ok = await syncAllBoards();
    setWorkerIndicator(ok, ok ? 'Connected ✓' : 'Unreachable — saved locally');
    startSyncTimer();
    toast(ok ? 'Settings saved — synced ✓' : 'Settings saved — worker unreachable', ok ? '✓' : '⚠');
    closeModal();
  });

  // Join board
  modal.querySelector('#join-board-btn').addEventListener('click', async () => {
    const boardId = modal.querySelector('#join-board-id').value.trim();
    const pw      = modal.querySelector('#join-password').value;
    if (!boardId || !pw) { toast('Board ID and password required', '⚠'); return; }
    const btn = modal.querySelector('#join-board-btn');
    btn.textContent = 'Joining…'; btn.disabled = true;

    const keyHash = await hashKey(boardId, pw);
    try {
      const r = await fetch(`${workerUrl()}/api/board/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, keyHash }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { found, data: rawPayload } = await r.json();
      if (!found) { toast('Board not found — check ID and password', '⚠'); btn.textContent = 'Join Board'; btn.disabled = false; return; }

      // Decrypt board data
      let data;
      try {
        data = await decryptData(boardId, pw, rawPayload);
      } catch (decErr) {
        toast('Wrong password or corrupted data', '⚠'); btn.textContent = 'Join Board'; btn.disabled = false; return;
      }
      const boardName = data.boards?.[0]?.name || 'Imported Board';
      for (const b of data.boards  || []) { await dbPut('boards',   b); upsertInState('boards',   b, 'id'); }
      for (const c of data.columns || []) { await dbPut('columns',  c); upsertInState('columns',  c, 'id'); }
      for (const c of data.cards   || []) { await dbPut('cards',    c); upsertInState('cards',    c, 'id'); }
      for (const a of data.activity|| []) { await dbPut('activity', a); upsertInState('activity', a, 'id'); }
      state.boards.sort((a,b) => a.createdAt - b.createdAt);
      state.columns.sort((a,b) => a.order - b.order);
      state.cards.sort((a,b) => a.order - b.order);

      await saveBoardCreds(boardId, pw, keyHash, boardName);
      if (data.boards?.[0]) await setActiveBoard(data.boards[0].id);
      renderAll();
      closeModal();
      toast(`Joined "${boardName}" ✓`, '✓');
    } catch (e) {
      toast('Failed to join board: ' + e.message, '⚠');
      btn.textContent = 'Join Board'; btn.disabled = false;
    }
  });

  // (Invite links now handled by openInviteJoinModal — no prefill needed here)

  // Invite links
  modal.querySelectorAll('[data-invite]').forEach(btn => {
    btn.addEventListener('click', () => {
      const boardId = btn.dataset.invite;
      const base = window.location.origin + window.location.pathname;
      const link = `${base}?invite=${encodeURIComponent(boardId)}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      toast('Invite link copied! Share it — recipient enters the password to join.', '🔗');
    });
  });

  // Change password
  modal.querySelectorAll('[data-change-pw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const boardId = btn.dataset.changePw;
      openChangePwModal(boardId);
    });
  });

  // Remove board credentials
  modal.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const boardId = btn.dataset.remove;
      if (!confirm('Remove this board from sync? Local data is kept.')) return;
      await dbDelete('boardCreds', boardId);
      btn.closest('.board-cred-row').remove();
      toast('Board removed from sync', '✓');
    });
  });

  // Export
  modal.querySelector('#export-btn').addEventListener('click', () => {
    const data = JSON.stringify({ boards: state.boards, columns: state.columns, cards: state.cards }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `flowboard-${Date.now()}.json`;
    a.click();
    toast('Exported', '✓');
  });

  modal.querySelector('#import-btn').addEventListener('click', () => modal.querySelector('#import-file').click());
  modal.querySelector('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (data.boards)  for (const b of data.boards)  await dbPut('boards',  b);
      if (data.columns) for (const c of data.columns) await dbPut('columns', c);
      if (data.cards)   for (const c of data.cards)   await dbPut('cards',   c);
      await loadAll(); renderAll(); closeModal();
      toast('Imported successfully', '✓');
    } catch { toast('Invalid JSON file', '⚠'); }
  });
}

// ─── Change Board Password Modal ───
function openChangePwModal(boardId) {
  const board = state.boards.find(b => b.id === boardId);
  const modal = openModal(`
    <div class="modal">
      <div class="modal-title">🔑 Change Password <button class="modal-close">✕</button></div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">Changing the password re-encrypts your board in the cloud under a new key. Anyone with the old invite link will need the new password to sync.</p>
      <div class="form-group">
        <label class="form-label">Board</label>
        <input class="form-input" value="${escHtml(board?.name || boardId)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Current Password</label>
        <input class="form-input" id="cpw-old" type="password" placeholder="Current password...">
      </div>
      <div class="form-group">
        <label class="form-label">New Password</label>
        <input class="form-input" id="cpw-new" type="password" placeholder="New password...">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm New Password</label>
        <input class="form-input" id="cpw-confirm" type="password" placeholder="Confirm new password...">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cpw-cancel">Cancel</button>
        <button class="btn btn-primary" id="cpw-save">Change Password</button>
      </div>
    </div>
  `);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#cpw-cancel').addEventListener('click', closeModal);
  modal.querySelector('#cpw-save').addEventListener('click', async () => {
    const oldPw  = modal.querySelector('#cpw-old').value;
    const newPw  = modal.querySelector('#cpw-new').value;
    const confPw = modal.querySelector('#cpw-confirm').value;
    if (!oldPw || !newPw) { toast('All fields required', '⚠'); return; }
    if (newPw !== confPw) { toast('New passwords do not match', '⚠'); return; }
    if (newPw === oldPw)  { toast('New password must differ from current', '⚠'); return; }
    const btn = modal.querySelector('#cpw-save');
    btn.textContent = 'Updating…'; btn.disabled = true;
    try {
      await changeBoardPassword(boardId, oldPw, newPw);
      closeModal();
      toast('Password changed and board re-encrypted in cloud ✓', '✓');
    } catch (e) {
      toast(e.message || 'Failed to change password', '⚠');
      btn.textContent = 'Change Password'; btn.disabled = false;
    }
  });
}

// ─── Invite Join Modal (shown when arriving via ?invite=) ───
function openInviteJoinModal(boardId) {
  const modal = openModal(`
    <div class="modal">
      <div class="modal-title">🔗 Join Shared Board <button class="modal-close">✕</button></div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">You've been invited to join a board. Enter the password the board owner shared with you.</p>
      <div class="form-group">
        <label class="form-label">Board ID</label>
        <input class="form-input" id="invite-board-id" value="${escHtml(boardId)}" readonly style="opacity:0.6;font-family:var(--font-mono);font-size:11px">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input class="form-input" id="invite-password" type="password" placeholder="Enter board password..." autofocus>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="invite-cancel">Cancel</button>
        <button class="btn btn-primary" id="invite-join">Join Board</button>
      </div>
    </div>
  `);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#invite-cancel').addEventListener('click', closeModal);

  const doJoin = async () => {
    const pw  = modal.querySelector('#invite-password').value;
    if (!pw) { toast('Password required', '⚠'); return; }
    const btn = modal.querySelector('#invite-join');
    btn.textContent = 'Joining…'; btn.disabled = true;
    const keyHash = await hashKey(boardId, pw);
    try {
      const r = await fetch(`${workerUrl()}/api/board/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, keyHash }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { found, data: rawPayload } = await r.json();
      if (!found) { toast('Board not found — check the password', '⚠'); btn.textContent = 'Join Board'; btn.disabled = false; return; }
      let data;
      try { data = await decryptData(boardId, pw, rawPayload); }
      catch { toast('Wrong password or corrupted data', '⚠'); btn.textContent = 'Join Board'; btn.disabled = false; return; }
      const boardName = data.boards?.[0]?.name || 'Imported Board';
      for (const b of data.boards   || []) { await dbPut('boards',   b); upsertInState('boards',   b, 'id'); }
      for (const c of data.columns  || []) { await dbPut('columns',  c); upsertInState('columns',  c, 'id'); }
      for (const c of data.cards    || []) { await dbPut('cards',    c); upsertInState('cards',    c, 'id'); }
      for (const a of data.activity || []) { await dbPut('activity', a); upsertInState('activity', a, 'id'); }
      state.boards.sort((a,b) => a.createdAt - b.createdAt);
      state.columns.sort((a,b) => a.order - b.order);
      state.cards.sort((a,b) => a.order - b.order);
      await saveBoardCreds(boardId, pw, keyHash, boardName);
      if (data.boards?.[0]) await setActiveBoard(data.boards[0].id);
      // Clean up invite param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      history.replaceState({}, '', url);
      renderAll();
      closeModal();
      toast(`Joined "${boardName}" ✓`, '✓');
    } catch (e) {
      toast('Failed to join: ' + e.message, '⚠');
      btn.textContent = 'Join Board'; btn.disabled = false;
    }
  };

  modal.querySelector('#invite-join').addEventListener('click', doJoin);
  modal.querySelector('#invite-password').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
}

// ═══════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════
function showCtxMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.cls ? ' ' + item.cls : '');
    el.textContent = item.label;
    el.addEventListener('click', () => { menu.remove(); item.action(); });
    menu.appendChild(el);
  }

  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.children.length * 36 - 20)}px`;
  document.body.appendChild(menu);

  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
function toast(msg, icon = 'ℹ') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="ti">${icon}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

// ═══════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════
function switchView(view) {
  state.activeView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  const bv = document.getElementById('board-view');
  bv.style.display = view === 'board' ? 'flex' : 'none';
  bv.style.flexDirection = 'column';
  bv.style.flex = '1';
  bv.style.overflow = 'hidden';
  const cv = document.getElementById('calendar-view');
  cv.style.display = view === 'calendar' ? 'block' : 'none';
  const tv = document.getElementById('timeline-view');
  tv.style.display = view === 'timeline' ? 'flex' : 'none';
  tv.style.flexDirection = 'column';
  tv.style.flex = '1';
  tv.style.overflowY = 'auto';
  tv.style.overflowX = 'hidden';
  document.getElementById('backlog-area').style.display = view === 'board' ? '' : 'none';
  if (view === 'calendar') renderCalendar();
  if (view === 'timeline') renderTimeline();
}

// ═══════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════
function renderAll() {
  renderBoardTabs();
  renderBoardView();
  renderBacklog();
  if (state.activeView === 'calendar') renderCalendar();
  if (state.activeView === 'timeline') renderTimeline();
}

// ═══════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════
function bindEvents() {
  document.getElementById('add-board-btn').addEventListener('click', openAddBoardModal);
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);

  // Theme button — use pointerup so we can set a flag before the click bubbles
  let _themePanelJustOpened = false;
  document.getElementById('theme-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleThemePanel();
    _themePanelJustOpened = true;
    setTimeout(() => { _themePanelJustOpened = false; }, 50);
  });
  document.getElementById('theme-overlay')?.addEventListener('click', closeThemePanel);
  // Close on outside click/tap — but ignore the tap that just opened it
  document.addEventListener('click', e => {
    if (_themePanelJustOpened) return;
    const panel = document.getElementById('theme-panel');
    if (!panel?.classList.contains('open')) return;
    if (!panel.contains(e.target) && e.target.id !== 'theme-btn') {
      closeThemePanel();
    }
  });

  // ── Hamburger menu (mobile only) ──────────────────────
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const drawer = document.getElementById('hamburger-drawer');
  const overlay = document.getElementById('hamburger-overlay');

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    renderDrawerBoardTabs();
    // Mirror sync/install visibility into drawer
    const drawerSync = document.getElementById('drawer-sync-btn');
    const drawerInstall = document.getElementById('drawer-install-btn');
    if (drawerSync) drawerSync.style.display = isWorkerOk() ? '' : 'none';
    if (drawerInstall) drawerInstall.style.display = isAppInstalled() ? 'none' : '';
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  function renderDrawerBoardTabs() {
    const container = document.getElementById('drawer-board-tabs');
    if (!container) return;
    container.innerHTML = '';
    for (const board of state.boards) {
      const btn = document.createElement('button');
      btn.className = 'drawer-action';
      btn.style.cssText = 'padding:7px 10px;font-size:12px;';
      const isActive = board.id === state.activeBoardId;
      if (isActive) btn.style.borderColor = 'var(--accent)';
      btn.innerHTML = `
        <span class="da-icon" style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;flex-shrink:0"></span>
        <span class="da-label">${escHtml(board.name)}</span>
        ${isActive ? '<span class="da-badge">active</span>' : ''}
        <span class="drawer-board-delete" data-id="${board.id}" title="Delete board" style="margin-left:auto;padding:2px 6px;border-radius:5px;color:var(--text3);font-size:14px;line-height:1;flex-shrink:0">✕</span>
      `;
      btn.addEventListener('click', async e => {
        if (e.target.closest('.drawer-board-delete')) {
          e.stopPropagation();
          if (confirm(`Delete board "${board.name}"?`)) {
            await deleteBoard(board.id);
            closeDrawer();
          }
          return;
        }
        await setActiveBoard(board.id);
        renderAll();
        closeDrawer();
      });
      container.appendChild(btn);
    }
  }

  hamburgerBtn.addEventListener('click', () => {
    drawer.classList.contains('open') ? closeDrawer() : openDrawer();
  });
  overlay.addEventListener('click', closeDrawer);

  document.getElementById('drawer-add-board-btn').addEventListener('click', () => {
    closeDrawer();
    openAddBoardModal();
  });
  document.getElementById('drawer-search-btn').addEventListener('click', () => {
    closeDrawer();
    const searchBar = document.getElementById('search-bar');
    searchBar.classList.add('visible');
    document.getElementById('search-input')?.focus();
  });
  document.getElementById('drawer-settings-btn').addEventListener('click', () => {
    closeDrawer();
    openSettingsModal();
  });
  document.getElementById('drawer-theme-btn').addEventListener('click', () => {
    closeDrawer();
    // Small delay so the drawer overlay click doesn't immediately close the theme panel
    setTimeout(() => toggleThemePanel(), 80);
  });
  document.getElementById('drawer-sync-btn').addEventListener('click', async () => {
    closeDrawer();
    document.getElementById('sync-now-btn').click();
  });
  document.getElementById('drawer-install-btn').addEventListener('click', () => {
    closeDrawer();
    document.getElementById('install-btn').click();
  });
  // ─────────────────────────────────────────────────────

  // Manual sync-now button
  document.getElementById('sync-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-now-btn');
    const txt = document.getElementById('server-status-text');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    if (txt) txt.textContent = 'syncing…';
    const ok = await syncAllBoards();
    if (ok) { updateSyncTimestamp(); toast('Synced ✓', '✓'); }
    else toast('Could not reach worker', '⚠');
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  });

  // PWA install button
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (_installPrompt) {
      _installPrompt.prompt();
      const { outcome } = await _installPrompt.userChoice;
      if (outcome === 'accepted') {
        _installPrompt = null;
        updateInstallBtn();
      }
    } else {
      // Browser doesn't expose the prompt (e.g. already dismissed, Firefox, Safari)
      // Give the user manual instructions
      toast('To install: use your browser menu → "Install app" or "Add to Home Screen"', 'ℹ');
    }
  });
  // Initial check (covers case where prompt fired before bindEvents)
  updateInstallBtn();

  document.querySelectorAll('.view-tab').forEach(t => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

  // Backlog toggle
  const backlogHeader = document.getElementById('backlog-header');
  const backlogArea   = document.getElementById('backlog-area');

  function toggleBacklog(e) {
    // Don't toggle if the tap was on the add button
    if (e.target.closest('#backlog-add-btn')) return;
    state.backlogOpen = !state.backlogOpen;
    backlogArea.classList.toggle('open', state.backlogOpen);
    saveSetting('backlogOpen', state.backlogOpen);
  }

  // Use both click (desktop) and touchstart (mobile — fires before any card touchstart)
  backlogHeader.querySelector('#backlog-toggle-icon').addEventListener('click', toggleBacklog);
  backlogHeader.querySelector('#backlog-toggle-icon').addEventListener('touchstart', e => {
    e.preventDefault(); // prevent the subsequent click from double-toggling
    toggleBacklog(e);
  }, { passive: false });

  document.getElementById('backlog-add-btn').addEventListener('click', e => {
    e.stopPropagation();
    openCardModal(null, null, state.activeBoardId);
  });

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    state.calendarDate = new Date();
    renderCalendar();
  });
  document.getElementById('cal-due-toggle').addEventListener('click', () => {
    state.showDueDateOnly = !state.showDueDateOnly;
    renderCalendar();
  });
  document.getElementById('tl-due-toggle').addEventListener('click', () => {
    state.showDueDateOnly = !state.showDueDateOnly;
    renderTimeline();
  });

  // Search
  const searchToggle = document.getElementById('search-toggle-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('#search-input') || document.getElementById('search-input');
  searchToggle.addEventListener('click', () => {
    searchBar.classList.toggle('visible');
    if (searchBar.classList.contains('visible')) searchInput?.focus();
    else {
      state.searchQuery = '';
      renderBoardView();
      refreshCalendar();
      refreshTimeline();
    }
  });
  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderBoardView();
    refreshCalendar();
    refreshTimeline();
  });
  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      searchBar.classList.remove('visible');
      state.searchQuery = '';
      renderBoardView();
      refreshCalendar();
      refreshTimeline();
    }
  });

  // Server status click -> settings
  document.getElementById('server-status').addEventListener('click', openSettingsModal);

  // Retry
  document.getElementById('offline-retry').addEventListener('click', async () => {
    const ok = await syncAllBoards();
    toast(ok ? 'Synced ✓' : 'Still unreachable', ok ? '✓' : '⚠');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.key === '/' || e.key === 'f') && !e.ctrlKey && !e.metaKey && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchBar.classList.add('visible');
      searchInput?.focus();
    }
    if (e.key === 'Escape') closeModal();
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openCardModal(null, null, state.activeBoardId); }
  });

}

// ═══════════════════════════════════════════════════════
// PWA INSTALL
// ═══════════════════════════════════════════════════════
let _installPrompt = null;

function isAppInstalled() {
  // True if running as standalone PWA, or on iOS in standalone mode
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function updateInstallBtn() {
  const btn = document.getElementById('install-btn');
  const drawerBtn = document.getElementById('drawer-install-btn');
  const show = !isAppInstalled();
  if (btn) btn.style.display = show ? '' : 'none';
  if (drawerBtn) drawerBtn.style.display = show ? '' : 'none';
}

// Browser fires this when the app is installable
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();          // stop automatic mini-infobar
  _installPrompt = e;
  updateInstallBtn();
});

// Browser fires this after the user installs — hide the button immediately
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  updateInstallBtn();
});

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  db = await openDB();
  await loadAll();

  // Apply saved theme immediately
  applyTheme(state.activeTheme || 'void');

  // Set active board if we have boards
  if (state.boards.length > 0) {
    if (!state.activeBoardId || !state.boards.find(b => b.id === state.activeBoardId)) {
      await setActiveBoard(state.boards[0].id);
    }
  }

  // Backlog init
  const backlog = document.getElementById('backlog-area');
  if (!state.backlogOpen) backlog.classList.remove('open');
  initBacklogDrop();

  bindEvents();
  renderAll();
  switchView('board');

  // Start sync if boards have credentials — syncAllBoards handles unreachable worker gracefully
  const allCreds = await getAllBoardCreds();
  if (allCreds.length) {
    syncAllBoards(); // fire-and-forget on startup
    startSyncTimer();
  }

  // Handle invite link (?invite=boardId) — show dedicated password modal
  const inviteId = new URLSearchParams(window.location.search).get('invite');
  if (inviteId) {
    setTimeout(() => openInviteJoinModal(inviteId), 400);
  }
}

init().catch(console.error);
