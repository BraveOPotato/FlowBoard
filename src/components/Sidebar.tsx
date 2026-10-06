import { useState, type CSSProperties } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { cx, hue } from '../utils';
import { Icon, Logo } from './Icon';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { InlineInput } from './InlineInput';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { Board } from '../types';
import s from './Sidebar.module.css';
import ui from './ui.module.css';

function Avatar({ board }: { board: Board }) {
  return <span className={s.avatar} style={{ '--h': hue(board.id) } as CSSProperties}>{board.name.trim()[0]?.toUpperCase() || '#'}</span>;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const boards = useFlowStore((st) => st.boards);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const workerStatus = useFlowStore((st) => st.workerStatus);
  const { setActiveBoard, openModal, renameBoard, deleteBoard, toast } = useFlowStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; board: Board } | null>(null);
  const trapRef = useFocusTrap<HTMLElement>(open);

  const go = (fn: () => void) => () => { fn(); onClose(); };

  const copyInvite = async (b: Board) => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}?invite=${b.id}`);
    toast('Invite link copied. Share it along with the board password.');
  };

  const confirmDelete = (b: Board) => openModal('confirm', {
    title: `Delete “${b.name}”?`,
    message: 'The board, its columns and cards are removed from this device. This can’t be undone.',
    confirmLabel: 'Delete board',
    onConfirm: () => deleteBoard(b.id),
  });

  return (
    <>
      <aside ref={trapRef} tabIndex={-1} className={cx(s.sidebar, open && s.open)} aria-label="Navigation" role={open ? 'dialog' : undefined} aria-modal={open || undefined} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className={s.brand}>
          <Logo />
          <span className={s.brandName}>FlowBoard</span>
          <button className={cx(ui.iconBtn, s.close)} onClick={onClose} aria-label="Close navigation">
            <Icon name="x" />
          </button>
        </div>

        <div className={s.sectionHead}>
          <span>Boards</span>
          <button className={cx(ui.iconBtn, ui.small)} onClick={go(() => openModal('addBoard', {}))} aria-label="New board" title="New board">
            <Icon name="plus" size={15} />
          </button>
        </div>

        <ul className={s.boards}>
          {boards.map((b) => (
            <li key={b.id} className={cx(s.boardRow, b.id === activeBoardId && s.active, menu?.board.id === b.id && s.menuOpen)}>
              {renaming === b.id ? (
                <div className={s.boardBtn}>
                  <Avatar board={b} />
                  <InlineInput
                    className={s.renameInput}
                    ariaLabel="Board name"
                    value={b.name}
                    onCommit={(name) => { renameBoard(b.id, name); setRenaming(null); }}
                    onCancel={() => setRenaming(null)}
                  />
                </div>
              ) : (
                <button
                  className={s.boardBtn}
                  onClick={go(() => setActiveBoard(b.id))}
                  onDoubleClick={() => setRenaming(b.id)}
                  aria-current={b.id === activeBoardId ? 'page' : undefined}
                >
                  <Avatar board={b} />
                  <span className={s.boardName}>{b.name}</span>
                </button>
              )}
              <button
                className={cx(ui.iconBtn, ui.small, s.rowMenuBtn)}
                onClick={(e) => setMenu(menu ? null : { anchor: e.currentTarget, board: b })}
                aria-label={`Options for ${b.name}`}
                aria-haspopup="menu"
              >
                <Icon name="more" size={15} />
              </button>
            </li>
          ))}
        </ul>
        {boards.length === 0 && (
          <button className={s.emptyBoards} onClick={go(() => openModal('addBoard', {}))}>
            <Icon name="plus" size={15} /> Create your first board
          </button>
        )}

        <div className={s.footer}>
          <button className={s.navItem} onClick={go(() => openModal('theme', {}))}>
            <Icon name="palette" /> Themes
          </button>
          <button className={s.navItem} onClick={go(() => openModal('settings', {}))}>
            <Icon name="settings" /> Settings
          </button>
          <button className={s.navItem} onClick={go(() => openModal('shortcuts', {}))}><Icon name="help" /> Keyboard shortcuts<kbd className={cx(ui.kbd, s.shortcutKey)}>?</kbd></button>
          <button className={s.sync} onClick={go(() => openModal('settings', {}))} title="Cloud sync status">
            <span className={cx(s.syncDot, workerStatus && s.online)} />
            {workerStatus ? 'Cloud sync on' : 'Local only'}
          </button>
        </div>
      </aside>
      {open && <div className={s.scrim} onClick={onClose} />}

      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)} align="start">
          <MenuItem icon="pencil" onClick={() => { setRenaming(menu.board.id); setMenu(null); }}>Rename</MenuItem>
          <MenuItem icon="link" onClick={() => { copyInvite(menu.board); setMenu(null); }}>Copy invite link</MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash" danger onClick={() => { confirmDelete(menu.board); setMenu(null); }}>Delete board</MenuItem>
        </Menu>
      )}
    </>
  );
}
