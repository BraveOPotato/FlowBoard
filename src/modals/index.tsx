import React, { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { CARD_COLORS, THEMES, ACTIVITY_META, WORKER_URL } from '../constants';
import { uid } from '../utils';
import type { Card, Column, ActivityEvent, Priority } from '../types';

// ─── Card Modal ───────────────────────────────────────────────────────────────

export function CardModal({ card, defaultColId, defaultBoardId }: { card?: Card; defaultColId?: string; defaultBoardId?: string }) {
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

// ─── Add Column Modal ─────────────────────────────────────────────────────────

export function AddColumnModal({ boardId }: { boardId: string }) {
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

// ─── Add Board Modal ──────────────────────────────────────────────────────────

export function AddBoardModal() {
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

// ─── Column Color Modal ───────────────────────────────────────────────────────

export function ColColorModal({ col }: { col: Column }) {
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

// ─── Column Menu Modal ────────────────────────────────────────────────────────

export function ColMenuModal({ col }: { col: Column }) {
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

// ─── Theme Modal ──────────────────────────────────────────────────────────────

export function ThemeModal() {
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

// ─── Settings Modal ───────────────────────────────────────────────────────────

export function SettingsModal() {
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
            onChange={(e) => setSyncIntervalVal(e.target.value as unknown as number)}
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

// ─── Day Detail Modal ─────────────────────────────────────────────────────────

export function DayDetailModal({ day, month, year, dayEvents, dayDueCards }: {
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

// ─── Modal Router ─────────────────────────────────────────────────────────────

export function ModalRouter() {
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
