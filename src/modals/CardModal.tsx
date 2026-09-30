import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { CARD_COLORS } from '../constants';
import { Icon, type IconName } from '../components/Icon';
import { PriorityIcon } from '../components/Card';
import { cx, hue, uid } from '../utils';
import { Modal } from './Modal';
import type { Card, Priority } from '../types';
import s from './CardModal.module.css';
import ui from '../components/ui.module.css';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

function Prop({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className={s.prop}>
      <span className={s.propLabel}><Icon name={icon} size={14} />{label}</span>
      <div className={s.propValue}>{children}</div>
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className={s.tags} onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <span key={t} className={s.chip} style={{ '--tag-h': hue(t) } as CSSProperties}>
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
            <Icon name="x" size={11} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        aria-label="Add tag"
        placeholder={tags.length ? '' : 'Add tags…'}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

export function CardModal({ card, defaultColId }: { card?: Card; defaultColId?: string }) {
  const columns = useFlowStore((st) => st.columns);
  const boards = useFlowStore((st) => st.boards);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const { closeModal, createCard, updateCard, deleteCard, openModal, toast } = useFlowStore.getState();

  const isNew = !card;
  const boardId = card?.boardId || activeBoardId || '';
  const boardCols = columns.filter((c) => c.boardId === boardId).sort((a, b) => a.order - b.order);
  const board = boards.find((b) => b.id === boardId);

  const [title, setTitle] = useState(card?.title ?? '');
  const [desc, setDesc] = useState(card?.desc ?? '');
  const [colId, setColId] = useState(card?.columnId ?? defaultColId ?? '');
  const [priority, setPriority] = useState<Priority>(card?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '');
  const [tags, setTags] = useState<string[]>(card?.tags ?? []);
  const [color, setColor] = useState(card?.color ?? 'transparent');
  const [checklist, setChecklist] = useState<Card['checklist']>(card?.checklist ?? []);
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const taskRef = useRef<HTMLInputElement>(null);
  const tasks = checklist ?? [];
  const done = tasks.filter((t) => t.done).length;
  const addTask = () => {
    if (!task.trim()) return;
    setChecklist([...tasks, { id: uid(), title: task.trim(), done: false }]);
    setTask('');
    taskRef.current?.focus();
  };

  const save = async () => {
    if (saving.current) return;
    if (!title.trim()) { setError('Give this card a title before saving.'); titleRef.current?.focus(); return; }
    const data: Partial<Card> = {
      title: title.trim(), desc: desc.trim(), columnId: colId || null, priority, dueDate: dueDate || null, tags, color,
      checklist: (task.trim() ? [...tasks, { id: uid(), title: task.trim(), done: false }] : tasks).map((t) => ({ ...t, title: t.title.trim() })).filter((t) => t.title),
    };
    saving.current = true;
    const currentModal = useFlowStore.getState().modal;
    setBusy(true);
    setError('');
    try {
      if (isNew) { await createCard(boardId, colId || null, data); toast('Card created'); }
      else { await updateCard(card.id, data); toast('Changes saved'); }
      if (useFlowStore.getState().modal === currentModal) closeModal();
    } catch { setError('Couldn’t save your changes. Your draft is still here. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  };

  const del = () => openModal('confirm', {
    title: 'Delete this card?',
    message: `“${card!.title}” will be removed. You can undo this right after deleting.`,
    confirmLabel: 'Delete card',
    onConfirm: () => deleteCard(card!.id),
  });

  const statusName = colId ? boardCols.find((c) => c.id === colId)?.name : 'Backlog';

  return (
    <Modal size="lg" bare ariaLabel={isNew ? 'Create card' : `Edit ${card.title}`} onSubmit={save}>
      <div
        className={s.wrap}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
      >
        <header className={s.top}>
          <div className={s.crumbs}>
            <span>{board?.name ?? 'Board'}</span>
            <Icon name="chevronRight" size={13} />
            <span className={s.crumbCurrent}>{isNew ? 'New card' : statusName}</span>
          </div>
          <button type="button" className={ui.iconBtn} onClick={closeModal} aria-label="Close"><Icon name="x" /></button>
        </header>

        <div className={s.layout}>
          <div className={s.main}>
            <textarea
              ref={titleRef}
              className={s.title}
              value={title}
              rows={1}
              placeholder="Card title"
              aria-label="Title"
              autoFocus={isNew}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
              aria-invalid={!!error && !title.trim()}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); save(); } }}
            />
            <textarea
              className={s.desc}
              value={desc}
              placeholder="Add a description…"
              aria-label="Description"
              onChange={(e) => setDesc(e.target.value)}
            />
            <section className={s.checklist} aria-label="Checklist">
              <div className={s.checkHead}><h3><Icon name="checklist" size={16} /> Checklist</h3><span>{done}/{tasks.length}</span></div>
              {!!tasks.length && <progress value={done} max={tasks.length} aria-label="Checklist completion" />}
              {tasks.map((t) => <div className={cx(s.task, t.done && s.taskDone)} key={t.id}>
                <input type="checkbox" checked={t.done} aria-label={`Complete ${t.title}`} onChange={(e) => setChecklist(tasks.map((item) => item.id === t.id ? { ...item, done: e.target.checked } : item))} />
                <input className={s.taskTitle} value={t.title} aria-label="Checklist item" onChange={(e) => setChecklist(tasks.map((item) => item.id === t.id ? { ...item, title: e.target.value } : item))} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
                <button type="button" className={cx(ui.iconBtn, ui.small)} onClick={() => setChecklist(tasks.filter((item) => item.id !== t.id))} aria-label={`Remove ${t.title}`}><Icon name="x" size={13} /></button>
              </div>)}
              <div className={s.addTask}><Icon name="plus" size={14} /><input ref={taskRef} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a checklist item…" aria-label="New checklist item" onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); addTask(); } }} /><button type="button" className={cx(ui.btn, ui.ghost, ui.sm)} disabled={!task.trim()} onClick={addTask}>Add</button></div>
            </section>
            {error && <p className={s.error} role="alert">{error}</p>}
          </div>

          <aside className={s.props}>
            <Prop icon="circle" label="Status">
              <select className={cx(ui.input, s.control)} value={colId} onChange={(e) => setColId(e.target.value)} aria-label="Status">
                <option value="">Backlog</option>
                {boardCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Prop>
            <Prop icon="alert" label="Priority">
              <div className={s.segmented} role="radiogroup" aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={priority === p} className={cx(s.segment, priority === p && s.segmentOn)} onClick={() => setPriority(p)}>
                    <PriorityIcon priority={p} />
                    {p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </Prop>
            <Prop icon="calendar" label="Due date">
              <div className={s.dateRow}>
                <input className={cx(ui.input, s.control)} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
                {dueDate && (
                  <button type="button" className={cx(ui.iconBtn, ui.small)} onClick={() => setDueDate('')} aria-label="Clear due date">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            </Prop>
            <Prop icon="tag" label="Tags">
              <TagInput tags={tags} onChange={setTags} />
            </Prop>
            <Prop icon="droplet" label="Color">
              <div className={ui.swatches}>
                {CARD_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={cx(ui.swatch, c.value === 'transparent' && ui.none, color === c.value && ui.selected)}
                    style={c.value === 'transparent' ? undefined : { background: c.value }}
                    onClick={() => setColor(c.value)}
                    aria-label={c.name === 'none' ? 'No color' : c.name}
                    aria-pressed={color === c.value}
                  >
                    {c.value === 'transparent' && <Icon name="x" size={11} />}
                  </button>
                ))}
              </div>
            </Prop>
            {card && (
              <p className={s.created}>Created {new Date(card.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            )}
          </aside>
        </div>

        <footer className={s.footer}>
          {!isNew && (
            <button type="button" className={cx(ui.btn, ui.ghost, s.deleteBtn)} onClick={del}>
              <Icon name="trash" size={15} /> Delete
            </button>
          )}
          <span className={s.hint}><kbd className={ui.kbd}>Ctrl</kbd><kbd className={ui.kbd}>↵</kbd></span>
          <button type="button" className={cx(ui.btn, ui.secondary)} onClick={closeModal}>Cancel</button>
          <button type="submit" className={cx(ui.btn, ui.primary)} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create card' : 'Save changes'}</button>
        </footer>
      </div>
    </Modal>
  );
}
