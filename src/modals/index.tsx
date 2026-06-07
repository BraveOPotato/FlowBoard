import React, { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { CARD_COLORS, THEMES, ACTIVITY_META, WORKER_URL } from '../constants';
import { uid } from '../utils';
import type { Card, Column, ActivityEvent, Priority } from '../types';

// ── Shared Tailwind class strings ─────────────────────────────────────────────
const CLS = {
  overlay: 'fixed inset-0 bg-black/60 flex items-center justify-center z-[2000] p-5 max-sm:p-0 max-sm:items-end',
  modal:   'bg-[var(--surface)] border border-[var(--border2)] rounded-[var(--radius-lg)] p-5 w-[400px] max-w-full max-h-[90vh] overflow-y-auto shadow-[var(--shadow-lg)] max-sm:w-full max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:p-4',
  modalLg: 'bg-[var(--surface)] border border-[var(--border2)] rounded-[var(--radius-lg)] p-5 w-[560px] max-w-full max-h-[90vh] overflow-y-auto shadow-[var(--shadow-lg)] max-sm:w-full max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:p-4',
  title:   'font-[var(--font-display)] text-[15px] font-bold text-[var(--text)] mb-4 flex items-center justify-between',
  close:   'bg-transparent border-none text-[var(--text3)] cursor-pointer text-base px-1.5 py-0.5 rounded transition-colors duration-150 hover:text-[var(--text)] hover:bg-[var(--bg3)]',
  actions: 'flex gap-2 justify-end mt-5',
  group:   'mb-3.5',
  row:     'flex gap-3 max-sm:flex-col max-sm:gap-0',
  label:   'block text-[11px] font-semibold tracking-wider text-[var(--text3)] font-[var(--font-mono)] mb-1.5 uppercase',
  input:   'w-full bg-[var(--bg3)] border border-[var(--border2)] text-[var(--text)] rounded-[var(--radius)] px-2.5 py-2 text-[13px] font-[var(--font-body)] outline-none transition-colors duration-150 focus:border-[var(--accent)]',
  textarea:'w-full bg-[var(--bg3)] border border-[var(--border2)] text-[var(--text)] rounded-[var(--radius)] px-2.5 py-2 text-[13px] font-[var(--font-body)] outline-none transition-colors duration-150 focus:border-[var(--accent)] min-h-[80px] resize-y',
  select:  'w-full bg-[var(--bg3)] border border-[var(--border2)] text-[var(--text)] rounded-[var(--radius)] px-2.5 py-2 text-[13px] font-[var(--font-body)] outline-none transition-colors duration-150 focus:border-[var(--accent)]',
  btnPrimary:   'px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer border border-transparent transition-colors duration-150 font-[var(--font-body)] bg-[var(--accent)] text-white hover:bg-[var(--accent2)] disabled:opacity-50 disabled:cursor-default',
  btnSecondary: 'px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer border border-[var(--border2)] transition-colors duration-150 font-[var(--font-body)] bg-transparent text-[var(--text2)] hover:bg-[var(--bg3)] hover:text-[var(--text)]',
  btnDanger:    'px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer border transition-colors duration-150 font-[var(--font-body)] bg-red-500/15 text-[var(--red)] border-red-500/30 hover:bg-red-500/25',
  sectionTitle: 'text-[11px] font-bold tracking-widest text-[var(--text3)] font-[var(--font-mono)] uppercase mb-2.5 pb-1.5 border-b border-[var(--border)]',
  colorDot: (selected: boolean) => `w-6 h-6 rounded-full cursor-pointer transition-transform duration-150 border-2 hover:scale-110 ${selected ? 'shadow-[0_0_0_2px_var(--text),0_0_0_4px_var(--accent)] scale-110 border-transparent' : 'border-transparent'}`,
};

// ── Card Modal ────────────────────────────────────────────────────────────────
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
    if (!title.trim()) { store.toast('Title required', '⚠'); return; }
    const data: Partial<Card> = {
      title: title.trim(), desc: desc.trim(), columnId: colId || null, priority,
      dueDate: dueDate || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), color,
    };
    store.closeModal();
    if (isNew) { await store.createCard(boardId, colId || null, data); store.toast('Card created', '✓'); }
    else { await store.updateCard(card!.id, data); store.toast('Saved', '✓'); }
  };

  const del = async () => {
    if (confirm('Delete this card?')) {
      await store.deleteCard(card!.id);
      store.closeModal();
      store.toast('Card deleted', '🗑');
    }
  };

  return (
    <div className={CLS.modalLg} ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className={CLS.title}>
        {isNew ? '＋ New Card' : '✏ Edit Card'}
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Title</label>
        <input className={CLS.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title..." autoFocus />
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Description</label>
        <textarea className={CLS.textarea} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Details, notes, links..." />
      </div>
      <div className={`${CLS.row} mb-3.5`}>
        <div className={`${CLS.group} flex-1`}>
          <label className={CLS.label}>Column</label>
          <select className={CLS.select} value={colId} onChange={(e) => setColId(e.target.value)}>
            <option value="">— Backlog —</option>
            {boardCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className={`${CLS.group} flex-1`}>
          <label className={CLS.label}>Priority</label>
          <select className={CLS.select} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className={`${CLS.row} mb-3.5`}>
        <div className={`${CLS.group} flex-1`}>
          <label className={CLS.label}>Due Date</label>
          <input className={CLS.input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className={`${CLS.group} flex-1`}>
          <label className={CLS.label}>Tags (comma separated)</label>
          <input className={CLS.input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="bug, urgent, ui..." />
        </div>
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Color</label>
        <div className="flex gap-1.5 flex-wrap">
          {CARD_COLORS.map((c) => (
            <div
              key={c.value}
              className={CLS.colorDot(color === c.value)}
              style={{
                background: c.value === 'transparent' ? 'var(--bg4)' : c.value,
                border: c.value === 'transparent' ? '1px solid var(--border2)' : undefined,
              }}
              title={c.name}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>
      </div>
      <div className={CLS.actions}>
        {!isNew && <button className={CLS.btnDanger} onClick={del}>🗑 Delete</button>}
        <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Cancel</button>
        <button className={CLS.btnPrimary} onClick={save}>{isNew ? 'Create Card' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ── Add Column Modal ──────────────────────────────────────────────────────────
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
    <div className={CLS.modal} ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className={CLS.title}>
        ＋ New Column
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Column Name</label>
        <input className={CLS.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. In Review, Done, Testing..." autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
      </div>
      <div className={CLS.actions}>
        <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Cancel</button>
        <button className={CLS.btnPrimary} onClick={create}>Create Column</button>
      </div>
    </div>
  );
}

// ── Add Board Modal ───────────────────────────────────────────────────────────
export function AddBoardModal() {
  const store = useFlowStore();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const trapRef = useFocusTrap(true);
  const create = async () => {
    if (!name.trim()) { store.toast('Name required', '⚠'); return; }
    store.closeModal();
    await store.createBoard(name.trim(), pw || uid());
    store.toast(`Board "${name}" created`, '✓');
  };
  return (
    <div className={CLS.modal} ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className={CLS.title}>
        ＋ New Board
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Board Name</label>
        <input className={CLS.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Project..." autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
      </div>
      <div className={CLS.group}>
        <label className={CLS.label}>Sync Password (optional)</label>
        <input className={CLS.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="For cloud sync across devices..." />
      </div>
      <div className={CLS.actions}>
        <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Cancel</button>
        <button className={CLS.btnPrimary} onClick={create}>Create Board</button>
      </div>
    </div>
  );
}

// ── Column Color Modal ────────────────────────────────────────────────────────
export function ColColorModal({ col }: { col: Column }) {
  const store = useFlowStore();
  const trapRef = useFocusTrap(true);
  return (
    <div className={CLS.modal} ref={trapRef} onClick={(e) => e.stopPropagation()} style={{ width: '260px' }}>
      <div className={CLS.title}>
        Column Color
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {CARD_COLORS.filter((c) => c.value !== 'transparent').map((c) => (
          <div
            key={c.value}
            className={CLS.colorDot(col.color === c.value)}
            style={{ background: c.value }}
            title={c.name}
            onClick={async () => { await store.updateColumn(col.id, { color: c.value }); store.closeModal(); }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Column Menu Modal ─────────────────────────────────────────────────────────
export function ColMenuModal({ col }: { col: Column }) {
  const store = useFlowStore();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(col.name);
  const trapRef = useFocusTrap(true);
  const menuItem = "block w-full text-left bg-transparent border-none px-3 py-2 text-[var(--text)] cursor-pointer text-[13px] rounded-md transition-colors duration-150 hover:bg-[var(--bg3)]";

  if (renaming) {
    return (
      <div className={CLS.modal} ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <div className={CLS.title}>
          Rename Column
          <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
        </div>
        <div className={CLS.group}>
          <input className={CLS.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={async (e) => { if (e.key === 'Enter') { await store.updateColumn(col.id, { name }); store.closeModal(); } }}
          />
        </div>
        <div className={CLS.actions}>
          <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Cancel</button>
          <button className={CLS.btnPrimary} onClick={async () => { await store.updateColumn(col.id, { name }); store.closeModal(); }}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border2)] rounded-[var(--radius-lg)] p-2 shadow-[var(--shadow-lg)] w-[220px]" ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <button className={`${CLS.close} ml-auto block`} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      <button className={menuItem} onClick={() => setRenaming(true)}>✏ Rename</button>
      <button className={menuItem} onClick={async () => {
        if (confirm('Delete column? Cards move to backlog.')) {
          store.closeModal();
          await store.deleteColumn(col.id);
          store.toast('Column deleted', '🗑');
        }
      }}>🗑 Delete Column</button>
    </div>
  );
}

// ── Theme Modal ───────────────────────────────────────────────────────────────
export function ThemeModal() {
  const store = useFlowStore();
  const activeTheme = store.activeTheme;
  const trapRef = useFocusTrap(true);
  return (
    <div className={CLS.modal} ref={trapRef} onClick={(e) => e.stopPropagation()} style={{ width: '340px' }}>
      <div className={CLS.title}>
        🎨 Themes
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>
      {(['dark', 'light'] as const).map((section) => {
        const sectionThemes = THEMES.filter((t) => t.section === section);
        return (
          <div key={section}>
            <div className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text3)] font-[var(--font-mono)] mt-3 mb-1.5 pb-1 border-b border-[var(--border)]">
              {section === 'dark' ? 'Dark' : 'Light'}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {sectionThemes.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer border-2 transition-colors duration-150 bg-[var(--bg3)] ${
                    activeTheme === t.id
                      ? 'border-[var(--accent2)] bg-[var(--bg4)]'
                      : 'border-transparent hover:border-[var(--border2)] hover:bg-[var(--bg4)]'
                  }`}
                  onClick={() => store.saveTheme(t.id)}
                >
                  <div className="flex gap-[3px] flex-shrink-0">
                    <div className="w-2 h-2 rounded-full" style={{ background: t.accent }} />
                    <div className="w-2 h-2 rounded-full" style={{ background: t.accent2 }} />
                    <div className="w-2 h-2 rounded-full" style={{ background: t.dot3 }} />
                  </div>
                  <span className="text-xs text-[var(--text)] font-medium font-[var(--font-body)]">{t.label}</span>
                  {activeTheme === t.id && <span className="text-[10px] text-[var(--text3)] font-[var(--font-mono)] ml-auto">active</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
export function SettingsModal() {
  const store = useFlowStore();
  const workerStatus = store.workerStatus;
  const [url, setUrl] = useState(store.workerUrl || WORKER_URL);
  const [syncIntervalVal, setSyncIntervalVal] = useState(store.syncInterval || 600);
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
    if (!joinId || !joinPw) { store.toast('Board ID and password required', '⚠'); return; }
    const ok = await store.joinBoard(joinId.trim(), joinPw);
    store.toast(ok ? 'Board joined!' : 'Could not find board', ok ? '✓' : '⚠');
    if (ok) store.closeModal();
  };

  return (
    <div className={CLS.modalLg} ref={trapRef} onClick={(e) => e.stopPropagation()}>
      <div className={CLS.title}>
        ⚙ Settings
        <button className={CLS.close} onClick={() => store.closeModal()} aria-label="Close">✕</button>
      </div>

      <div className="mb-5">
        <div className={CLS.sectionTitle}>Cloud Sync</div>
        <div className="flex items-center gap-2 text-xs text-[var(--text2)] mb-3.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: workerStatus ? 'var(--green)' : 'var(--red)' }} />
          <span>{workerStatus ? 'Worker reachable' : 'Worker unreachable'}</span>
        </div>
        <div className={CLS.group}>
          <label className={CLS.label}>Worker URL</label>
          <input className={CLS.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={WORKER_URL} />
        </div>
        <div className={CLS.group}>
          <label className={CLS.label}>Sync Interval</label>
          <select className={CLS.select} value={syncIntervalVal} onChange={(e) => setSyncIntervalVal(e.target.value as unknown as number)} style={{ maxWidth: '200px' }}>
            <option value={60}>Every minute</option>
            <option value={300}>Every 5 minutes</option>
            <option value={600}>Every 10 minutes</option>
            <option value={1800}>Every 30 minutes</option>
            <option value={3600}>Every hour</option>
          </select>
        </div>
      </div>

      <div className="mb-5">
        <div className={CLS.sectionTitle}>Join a Board</div>
        <div className={`${CLS.row} mb-3.5`}>
          <div className={`${CLS.group} flex-1`}>
            <label className={CLS.label}>Board ID</label>
            <input className={CLS.input} value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Paste board ID..." />
          </div>
          <div className={`${CLS.group} flex-1`}>
            <label className={CLS.label}>Password</label>
            <input className={CLS.input} type="password" value={joinPw} onChange={(e) => setJoinPw(e.target.value)} placeholder="Board password..." />
          </div>
        </div>
        <button className={`${CLS.btnPrimary} w-full`} onClick={join}>Join Board</button>
      </div>

      <div className="mb-5">
        <div className={CLS.sectionTitle}>Data</div>
        <div className="flex gap-2 flex-wrap">
          <button className={CLS.btnSecondary} onClick={() => store.exportData()}>Export JSON</button>
          <label className={`${CLS.btnSecondary} cursor-pointer`}>
            Import JSON
            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const text = await f.text();
              await store.importData(text);
            }} />
          </label>
        </div>
      </div>

      <div className={CLS.actions}>
        <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Close</button>
        <button className={CLS.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
      </div>
    </div>
  );
}

// ── Day Detail Modal ──────────────────────────────────────────────────────────
export function DayDetailModal({ day, month, year, dayEvents, dayDueCards }: {
  day: number; month: number; year: number; dayEvents: ActivityEvent[]; dayDueCards: Card[];
}) {
  const store = useFlowStore();
  const label = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const row = "flex items-center gap-2 py-1.5 border-b border-[var(--border)]";
  return (
    <div className={CLS.modal} onClick={(e) => e.stopPropagation()}>
      <div className={CLS.title}>
        <span>{label}</span>
        <button className={CLS.close} onClick={() => store.closeModal()}>✕</button>
      </div>
      {dayEvents.length > 0 && (
        <div className="mb-5">
          <div className={CLS.sectionTitle}>Activity</div>
          {dayEvents.map((ev) => {
            const card = store.cards.find((c) => c.id === ev.cardId);
            const meta = ACTIVITY_META[ev.type] || ACTIVITY_META.updated;
            const color = card?.color && card.color !== 'transparent' ? card.color : meta.color;
            return (
              <div key={ev.id} className={`${row} ${card ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => card && (store.closeModal(), setTimeout(() => store.openModal('card', { card }), 50))}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs text-[var(--text)] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {card?.title ?? ev.cardTitle ?? 'Deleted card'}
                </span>
                <span className="text-[10px] flex-shrink-0 font-[var(--font-mono)]" style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {dayDueCards.length > 0 && (
        <div className="mb-5">
          <div className={CLS.sectionTitle}>Due</div>
          {dayDueCards.map((card) => (
            <div key={card.id} className={`${row} cursor-pointer`}
              onClick={() => (store.closeModal(), setTimeout(() => store.openModal('card', { card }), 50))}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: card.color !== 'transparent' ? card.color : 'var(--yellow)' }} />
              <span className="text-xs text-[var(--text)] flex-1">{card.title}</span>
              <span className="text-[10px] text-[var(--yellow)] font-[var(--font-mono)]">◷ Due</span>
            </div>
          ))}
        </div>
      )}
      <div className={CLS.actions}>
        <button className={CLS.btnSecondary} onClick={() => store.closeModal()}>Close</button>
      </div>
    </div>
  );
}

// ── Modal Router ──────────────────────────────────────────────────────────────
export function ModalRouter() {
  const store = useFlowStore();
  const modal = store.modal;
  if (!modal) return null;

  const renderContent = () => {
    switch (modal.type) {
      case 'dayDetail': return <DayDetailModal day={modal.props?.day as number} month={modal.props?.month as number} year={modal.props?.year as number} dayEvents={modal.props?.dayEvents as ActivityEvent[]} dayDueCards={modal.props?.dayDueCards as Card[]} />;
      case 'card': return <CardModal card={modal.props?.card as Card} defaultColId={modal.props?.defaultColId as string} defaultBoardId={modal.props?.defaultBoardId as string} />;
      case 'addColumn': return <AddColumnModal boardId={(modal.props?.boardId as string) || ''} />;
      case 'addBoard': return <AddBoardModal />;
      case 'colColor': return <ColColorModal col={modal.props?.col as Column} />;
      case 'colMenu':
      case 'renameCol': return <ColMenuModal col={modal.props?.col as Column} />;
      case 'theme': return <ThemeModal />;
      case 'settings': return <SettingsModal />;
      default: return null;
    }
  };

  return (
    <div className={CLS.overlay} onClick={() => store.closeModal()} role="dialog" aria-modal="true">
      {renderContent()}
    </div>
  );
}
