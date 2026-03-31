# FlowBoard

A fast, offline-first PWA Kanban board with optional cloud sync via Cloudflare Workers KV.

## Features

- **Multiple boards** — unlimited boards, each protected by a password
- **Unlimited columns** — drag & drop cards between them
- **Backlog** — collapsible tray for unassigned cards
- **Card details** — title, description, tags, due date, priority, color coding
- **3 Views** — Board, Calendar (activity + due dates), Timeline (activity log)
- **Offline-first** — everything stored in IndexedDB, works with no connection
- **PWA** — installable on desktop and mobile, works offline
- **Cloud sync** — optional Cloudflare Workers KV backend, 90-day TTL per board
- **Invite links** — share a board ID link; recipient enters the password to join
- **Mobile-friendly** — hamburger menu, responsive layout, touch drag support

---

## Quick Start (Local Only)

No server required. Open `client/index.html` in any modern browser, or serve it locally:

```bash
cd client
npx serve .
# Visit http://localhost:3000
```

All data is stored in the browser's IndexedDB. Create a board, set a password, and start working.

---

## Cloud Sync — Cloudflare Workers KV

Board data is synced to Cloudflare's edge network using Workers KV. Each board is stored under a key derived from `SHA-256(boardId:password)` — the password never leaves the browser in plain text, and the server never sees it.

Boards expire after **90 days of inactivity**. Every read or write resets the TTL.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)
- [Node.js](https://nodejs.org) 18+ installed
- Wrangler CLI:

```bash
npm install -g wrangler
wrangler login
```

---

### Step 1 — Create the KV Namespace

```bash
cd worker
wrangler kv:namespace create BOARDS
```

Wrangler will print something like:

```
Add the following to your configuration file in your kv_namespaces array:
{ binding = "BOARDS", id = "abc123def456..." }
```

Copy the `id` value.

---

### Step 2 — Configure wrangler.toml

Open `worker/wrangler.toml` and paste in your KV namespace ID:

```toml
[[kv_namespaces]]
binding = "BOARDS"
id = "PASTE_YOUR_ID_HERE"
```

Also set your worker name if you want a custom subdomain:

```toml
name = "flowboard-worker"
```

---

### Step 3 — Deploy the Worker

```bash
cd worker
wrangler deploy
```

Wrangler will output your worker's URL:

```
https://flowboard-worker.YOUR_SUBDOMAIN.workers.dev
```

---

### Step 4 — Point the Client at Your Worker

Open `client/app.js` and update the `WORKER_URL` constant near the top of the file:

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
- **Password** — used locally to derive the KV key hash. Cannot be recovered. Store it somewhere safe.
- **Confirm password**

FlowBoard creates the board locally and schedules an immediate push to KV.

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

The board is pulled from KV and saved locally. From that point forward, both users sync independently on the configured interval (default: every 10 minutes).

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
| Card created / moved / edited | Debounced push to KV after 1.5s |
| Periodic timer fires | Pull then push all synced boards |
| **↻** button clicked | Immediate full sync |
| App starts with saved boards | Fire-and-forget sync in background |

The sync interval is configurable in Settings (1 min → 1 hour). Default is **10 minutes**.

Sync is last-write-wins at the board level. If two users edit simultaneously between syncs, the last push wins. For most Kanban workflows this is fine — conflicts are rare when people work on different cards.

---

## Security Model

- Passwords never leave the browser in plain text
- The KV key is `SHA-256(boardId:password)` — a 64-character hex string
- Without the password, a KV key cannot be reversed to find the board
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
│   ├── index.js         # Cloudflare Worker — KV read/write/touch
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
