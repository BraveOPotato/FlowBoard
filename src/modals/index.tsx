import { useState, type ReactNode } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { Modal } from './Modal';
import { cx, uid } from '../utils';
import { CardModal } from './CardModal';
import { ThemeModal } from './ThemeModal';
import { SettingsModal } from './SettingsModal';
import { DayDetailModal } from './DayDetailModal';
import type { ActivityEvent, Card } from '../types';
import s from './Modal.module.css';
import ui from '../components/ui.module.css';

function AddBoardModal() {
  const { closeModal, createBoard, toast } = useFlowStore.getState();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const create = async () => {
    if (!name.trim()) return toast('Give the board a name', '⚠');
    closeModal();
    await createBoard(name.trim(), pw || uid());
    toast(`Board “${name.trim()}” created`);
  };
  return (
    <Modal
      onSubmit={create}
      title="New board"
      description="Boards start with To Do, In Progress and Done columns."
      footer={<>
        <button type="button" className={cx(ui.btn, ui.secondary)} onClick={closeModal}>Cancel</button>
        <button type="submit" className={cx(ui.btn, ui.primary)}>Create board</button>
      </>}
    >
      <div className={ui.field}>
        <label className={ui.label} htmlFor="board-name">Name</label>
        <input id="board-name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product roadmap" autoFocus />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="board-pw">Sync password <span style={{ color: 'var(--fg-subtle)', fontWeight: 400 }}>(optional)</span></label>
        <input id="board-pw" className={ui.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Needed to share or sync across devices" autoComplete="new-password" />
        <p className={ui.hint}>Passwords can’t be recovered. Keep it somewhere safe.</p>
      </div>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm }: {
  title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => unknown;
}) {
  const closeModal = useFlowStore((st) => st.closeModal);
  return (
    <Modal
      size="sm"
      title={title}
      footer={<>
        <button className={cx(ui.btn, ui.secondary)} onClick={closeModal}>Cancel</button>
        <button className={cx(ui.btn, ui.danger)} autoFocus onClick={() => { closeModal(); onConfirm(); }}>{confirmLabel}</button>
      </>}
    >
      <p className={s.message}>{message}</p>
    </Modal>
  );
}

export function ModalRouter() {
  const modal = useFlowStore((st) => st.modal);
  const closeModal = useFlowStore((st) => st.closeModal);
  if (!modal) return null;
  const p = modal.props ?? {};

  const content = (() => {
    switch (modal.type) {
      case 'card': return <CardModal card={p.card as Card | undefined} defaultColId={p.defaultColId as string | undefined} />;
      case 'addBoard': return <AddBoardModal />;
      case 'confirm': return <ConfirmModal title={p.title as string} message={p.message as ReactNode} confirmLabel={p.confirmLabel as string} onConfirm={p.onConfirm as () => unknown} />;
      case 'theme': return <ThemeModal />;
      case 'settings': return <SettingsModal />;
      case 'joinInvite': return <SettingsModal inviteId={p.boardId as string} />;
      case 'dayDetail': return <DayDetailModal date={p.date as Date} events={p.events as ActivityEvent[]} dueCards={p.dueCards as Card[]} />;
      default: return null;
    }
  })();

  return (
    // Close only when the press starts on the backdrop, so drag-selecting text inside a field doesn't dismiss it.
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      {content}
    </div>
  );
}
