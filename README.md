# FlowBoard

A fast, offline-first PWA Kanban board with optional cloud sync via Cloudflare Workers and D1.

## Features

- **Multiple boards** — unlimited boards, each protected by a password
- **Unlimited columns** — drag & drop cards between them
- **Backlog** — collapsible tray for unassigned cards
- **Card details** — title, description, tags, due date, priority, color coding
- **Checklists** — editable tasks and completion progress on every card
- **Focused work** — combine status, priority, label and due-date filters with search across all three views
- **Quick actions** — duplicate cards, move without dragging, and undo card deletion
- **Deadline shortcuts** — live overdue and due-today counts in the filter bar, one click to focus on them
- **Layout preferences** — comfortable or compact cards, saved on this device
- **Keyboard access** — view navigation, card creation, search and drag/drop; press `?` for the shortcut guide
- **3 Views** — Board, Calendar (activity + due dates), Timeline (activity log)
- **Offline-first** — everything stored in IndexedDB, works with no connection
- **PWA** — installable on desktop and mobile, works offline
- **Cloud sync** — optional Cloudflare Workers D1 backend, 90-day idle TTL per board
- **Invite links** — share a board ID link; recipient enters the password to join
- **Mobile-friendly** — hamburger menu, responsive layout, touch drag support

---

## Quick Start (Local Only)

Use Node.js 22.18+ (or 24+) and npm:

```bash
npm install
npm run dev
# Open the local URL printed by Vite.
```

All data is stored in the browser's IndexedDB. Create a board, set a password, and start working.

Production and verification commands:

```bash
npm run build
npm run preview
npm run lint
npm test
npm run test:sync # real Chromium + IndexedDB; set CHROME_BIN if needed
```

## Everyday workflow

- Use **Filter** to narrow work by status, priority, label, or deadline. Filters combine with search and carry between views; switching boards resets them.
- Open **Filter** and click **Overdue** or **Due today** for a deadline-focused view. A badge on **Filter** shows how many filters are active.
- Open a card to add checklist items, edit them, or mark them complete. Progress appears on the board. **Ctrl/⌘+Enter** saves your changes.
- Open a card's **⋯** menu to duplicate it or move it to another column. Duplicates start with unchecked, independent checklist items.
- After deleting a card, click **Undo** in the notification within 10 seconds to restore it. If its column has been deleted, it returns to the backlog.
- Use the layout buttons next to **Filter** to choose comfortable or compact cards.
- Press **C** to create a card, **/** to search, **1 / 2 / 3** to switch views, **B** to toggle the backlog, or **?** for all shortcuts. On a focused card, **Enter** opens it; **Space**, arrow keys, then **Space** provide keyboard drag-and-drop.

The React frontend uses native Vite CSS Modules, with shared theme variables in `src/global.css`.

---

## Cloud Sync — Cloudflare Workers D1

Operations and snapshots are stored in D1, keyed by `SHA-256(boardId:password)`. The password is not sent to the worker. The hash is an access credential: do not publish it.

**Operation payloads are plaintext on the worker, not end-to-end encrypted.** Encrypted full-state rows from older versions can still be read when joining a board.

Boards expire after **90 days without reads or writes**. Local data is unaffected by cloud expiry. Export a backup before upgrades.

### Upgrading an existing deployment

1. Back up the existing D1 database (Cloudflare D1 export/Time Travel) and export important boards from the app.
2. Set `database_id` in `worker/wrangler.toml` to the **existing** production D1 ID. Do not replace it with a new empty database. The binding must be `flowboard_db`.
3. Deploy the worker **before** the frontend. No schema changes are needed for existing D1 deployments.
4. Deploy the frontend and reload every active client/PWA. The worker rejects writes from older clients with HTTP 409, leaving their pending operations on the device until it is updated. Updated clients also refuse to sync with an older worker.
5. If **Sync recovery needed** appears, open **Settings → Advanced**. Legacy boards without reliable conflict metadata are backed up in IndexedDB and paused before any cloud merge or upload. Local editing remains available, and the pause survives reloads.
6. **Export recovery backup** before resolving a paused board. The JSON contains the current board (importable as a regular export), the original local version, and the cloud state if reachable. Compare these with any known-good device/export. **Use this device** explicitly makes its current cards and columns authoritative, deleting cloud-only cards/columns; **Use cloud** explicitly replaces local cards/columns with the fetched cloud version. Neither choice is automatic. Both histories and the pre-resolution local version remain backed up on the device. Do not clear browser storage. Update/close every other client first, and resolve any other paused device using the recovered cloud version rather than publishing its stale local copy.
7. Smoke-test joining, editing from two devices, deletion/Undo, and an offline edit followed by reconnecting. Historical data already lost by the old GC or an earlier upgrade must be restored from a backup; these fixes cannot recreate it.

The worker keeps legacy data readable, but both write endpoints require the current sync protocol. New clients use versioned state reads, including tombstones, so they can recover after operation-log pruning. Snapshots and pruning commit atomically with compare-and-swap protection against concurrent snapshots. Client records, conflict versions, pending operations and recovery decisions commit in one IndexedDB transaction.

After an explicit recovery, the chosen versioned board becomes authoritative for new joins. Stale full-state rows remain in D1 for backup purposes but are not reapplied to the recovered board.

### Repairing an already-upgraded or rejoined board

1. Open **Settings → Advanced**, select the affected board, and click **Repair this board**. This saves a local recovery backup and pauses only that board, even when its sync metadata looks valid.
2. Export the recovery backup. Compare it with a known-good device or JSON export before choosing **Use this device**, **Use cloud**, or **Overwrite import**.
3. **Overwrite import** accepts a FlowBoard JSON export containing the selected board's exact ID (including a multi-board export or the normal board portion of a recovery export). Only that board is replaced. Cards, columns, and Timeline activity become exactly the snapshot; missing activity means an empty Timeline. This is not the additive **Import JSON** action.
4. After validation and explicit confirmation, overwrite replaces the cloud snapshot and removes its old live operation log in one transaction. A new board generation rejects pre-repair uploads, including from clients running the same protocol version. If the cloud changes during repair, the overwrite is rejected rather than erasing concurrent work. The complete request, including the expected cloud state, must fit the worker's 1 MB limit.
5. Previous local data, pending operations, and the fetched cloud state remain in separate IndexedDB recovery backups, included in **Export recovery backup**. A failed or unconfirmed overwrite leaves the board paused. Do not clear browser storage. If the cloud replacement succeeded but the local commit failed, **Use cloud** adopts the repaired board.
6. Update/reload other devices. They pause on a changed generation; **Use cloud** adopts the replacement exactly, including its Timeline, while archiving the superseded local outbox. Do not publish stale device copies unless you explicitly intend to replace the repaired board again.

Deploy the updated worker before the frontend. This repair endpoint uses the existing D1 schema; no database recreation or migration is required.

### Offline repair from exported activity

The offline tool creates a repaired JSON snapshot and a separate `.report.json` audit file. It does not change its inputs or contact the worker. It works with one corrupted export, or can merge a known-good baseline by record ID:

```bash
npm run repair:board -- current.json repaired.json --baseline good.json
```

By default, it removes cards with an unambiguous terminal deletion and corrects destinations from the latest usable activity. It keeps ticket descriptions, checklists and other payload fields, retains all activity, and quarantines records whose board no longer exists. Same-title tickets with different IDs remain separate. Contradictory activity, baseline-only records, newer record versions and conflicting full payloads are flagged for review rather than guessed.

For the confirmed resurrection pattern—deleted tickets returning through stale moves/updates—an explicit policy can repair from the corrupted export alone:

```bash
npm run repair:board -- current.json repaired-auto.json --deleted-unless-restored
```

This policy treats deletion as effective until a later explicit `created`/Undo event. It still flags newer record metadata and equal-time conflicts. Use it only when this matches the intended board state; an unlogged intentional restore/import cannot be distinguished from corruption. Individual `--keep CARD_ID` and `--delete CARD_ID` decisions override the policy. The report records decisions, event IDs, quarantined records and input/output SHA-256 hashes. Existing output files are never overwritten.

Review the report, then apply the candidate through **Settings → Advanced → Overwrite import**, not the additive importer. Activity is not a complete operation log: it cannot recreate missing descriptions/checklists or the exact historical drag order. Within affected columns, the tool keeps the relative order of existing cards and appends repaired arrivals in event order. An export timestamp is not a sync watermark, and absence from an older snapshot alone is not evidence of deletion. This is intentionally an offline review tool, not a silent background repair.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)
- [Node.js](https://nodejs.org) 22.18+ installed (24+ recommended)
- Wrangler CLI:

```bash
npm install -g wrangler
wrangler login
```

---

### Step 1 — Create D1 (new installations only)

```bash
cd worker
wrangler d1 create flowboard-db
```

Wrangler will print something like:

```
Add the following to your configuration file in your kv_namespaces array:
  { binding = "flowboard_db", database_name = "flowboard-db", database_id = "..." }
```

Copy the `database_id` value.

---

### Step 2 — Configure wrangler.toml

Open `worker/wrangler.toml` and paste in your D1 database ID:

```toml
[[d1_databases]]
binding = "flowboard_db"
database_name = "flowboard-db"
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"
```

Also set your worker name if you want a custom subdomain:

```toml
name = "flowboard-worker"
```

---

### Step 3 — Deploy the Worker

```bash
cd worker
wrangler d1 execute flowboard-db --remote --file migrations/schema.sql
wrangler deploy
```

Wrangler will output your worker's URL:

```
https://flowboard-worker.YOUR_SUBDOMAIN.workers.dev
```

---

### Step 4 — Point the Client at Your Worker

Open `src/constants.ts` and update `WORKER_URL`, or set the Worker URL in the app's Settings:

```js
const WORKER_URL = '<WORKER_URL>';
```

Redeploy or re-serve the client after saving.

---

### Step 5 — Connect from the App

1. Open FlowBoard in your browser
2. Click **⚙ Settings**
3. Under **Cloud Sync**, paste your Worker URL
4. Click **Save Settings** — FlowBoard will attempt a sync immediately
5. The status dot in the header turns **green** on success

---

## Creating a Board

When you click **+ New Board**, you'll be prompted for:

- **Board name**
- **Sync password** — optional, but set one if you plan to share the board. It derives the D1 access key and cannot be recovered. Use a strong, unique password.
- **Confirm password**

FlowBoard creates the board locally and schedules a debounced operation push to D1.

---

## Sharing a Board (Invite Links)

1. Open **⚙ Settings**
2. Find the board under **Synced Boards**
3. Click **🔗 Invite** — this copies a link to your clipboard:
   ```
   https://yourapp.com/?invite=<boardId>
   ```
4. Send the link to your collaborator
5. They open the link, FlowBoard opens Settings with the board ID pre-filled
6. They enter the board password and click **Join Board**

The board is pulled from D1 and saved locally. Edits trigger a debounced sync; background reads also run at the configured interval (default: every 10 minutes).

---

## Joining a Board Manually

1. Open **⚙ Settings → Join a Board**
2. Enter the **Board ID** (from the board creator)
3. Enter the **Password**
4. Click **Join Board**

---

## Sync Behaviour

| Event | What happens |
|---|---|
| Card created / moved / edited | Debounced operation sync after 1.5s |
| Periodic timer fires | Pull then push all synced boards |
| **↻** button clicked | Immediate full sync |
| App starts with saved boards | Fire-and-forget sync in background |

The sync interval is configurable in Settings (1 min → 1 hour). Default is **10 minutes**.

Sync is last-write-wins per record (board, column, card or activity event), ordered by operation timestamp with an operation-ID tie-breaker. Concurrent edits to the same card are not field-merged. Deletes retain conflict metadata, and Undo emits a newer operation. Pending local operations survive failed requests and reloads.

---

## Security Model

- Passwords never leave the browser in plain text
- The access key is `SHA-256(boardId:password)`, a 64-character hex string
- Use HTTPS and strong passwords; weak passwords can be guessed offline if an access hash leaks
- Board IDs in invite links do not grant access on their own — the password is always required
- Boards are not listed or discoverable; only someone with both the board ID and password can access one

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` or `f` | Open search |
| `Ctrl+N` | New card |
| `Esc` | Close modal / cancel |

---

## File Structure

```
flowboard/
├── client/
│   ├── index.html       # App UI + all CSS
│   ├── app.js           # All client logic (IndexedDB, sync, drag, views)
│   ├── sw.js            # Service worker — bump VERSION on each release
│   └── manifest.json    # PWA manifest
├── worker/
│   ├── index.js         # Cloudflare Worker — D1 operations/snapshots/TTL
│   └── wrangler.toml    # Wrangler deployment config
└── README.md
```

---

## Releasing Updates

Bump the `VERSION` constant in `client/sw.js` before each deployment:

```js
const VERSION = '1.0.1'; // was 1.0.0
```

This invalidates the service worker cache so all users receive the updated files automatically on their next visit.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
