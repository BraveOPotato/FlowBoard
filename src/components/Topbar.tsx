import { useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { cx } from '../utils';
import { Icon, type IconName } from './Icon';
import type { View } from '../types';
import s from './Topbar.module.css';
import ui from './ui.module.css';

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'timeline', label: 'Activity', icon: 'activity' },
];

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

export function Topbar({ onOpenNav, sidebarHidden, onToggleSidebar, statsVisible, onToggleStats }: { onOpenNav: () => void; sidebarHidden: boolean; onToggleSidebar: () => void; statsVisible: boolean; onToggleStats: () => void }) {
  const board = useFlowStore((st) => st.boards.find((b) => b.id === st.activeBoardId));
  const activeView = useFlowStore((st) => st.activeView);
  const query = useFlowStore((st) => st.searchQuery);
  const { setActiveView, setSearchQuery, openModal } = useFlowStore.getState();
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const focusSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const st = useFlowStore.getState();
      if (e.key === 'Escape') {
        if (st.modal) st.closeModal();
        else if (document.activeElement === searchRef.current) {
          st.setSearchQuery('');
          searchRef.current?.blur();
          setSearchOpen(false);
        }
        return;
      }
      if (st.modal) return;
      if (e.target instanceof HTMLElement && e.target.closest('[role="menu"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'k' && mod) || ((e.key === '/' || e.key === 'f') && !mod && !e.altKey && !isTyping(e.target))) {
        e.preventDefault();
        focusSearch();
      } else if ((e.key === 'n' && mod) || (e.key === 'c' && !mod && !e.altKey && !isTyping(e.target))) {
        if (!st.activeBoardId) return;
        e.preventDefault();
        st.openModal('card', {});
      } else if (!mod && !e.altKey && !isTyping(e.target)) {
        if (e.key === '?') { e.preventDefault(); st.openModal('shortcuts', {}); }
        if (e.key === 'b' && st.activeView === 'board') { e.preventDefault(); st.toggleBacklog(); }
        if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); st.setActiveView(VIEWS[Number(e.key) - 1].id); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className={s.topbar}>
      <button className={cx(ui.iconBtn, s.sidebarBtn)} onClick={onToggleSidebar} aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={!sidebarHidden} aria-controls="workspace-sidebar">
        <Icon name="menu" size={18} />
      </button>
      <button className={cx(ui.iconBtn, s.navBtn)} onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>

      <div className={s.breadcrumb}><span>Workspace</span><Icon name="chevronRight" size={12} /><span className={s.title}>{board?.name ?? 'FlowBoard'}</span></div>

      <nav className={s.views} role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            id={`view-${v.id}`}
            aria-controls="main-content"
            aria-selected={activeView === v.id}
            tabIndex={activeView === v.id ? 0 : -1}
            className={cx(s.view, activeView === v.id && s.viewActive)}
            onClick={() => setActiveView(v.id)}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const index = VIEWS.findIndex((item) => item.id === v.id);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
              setActiveView(VIEWS[next].id);
              document.getElementById(`view-${VIEWS[next].id}`)?.focus();
            }}
            title={v.label}
          >
            <Icon name={v.icon} size={15} />
            <span className={s.viewLabel}>{v.label}</span>
          </button>
        ))}
      </nav>

      <div className={s.spacer} />

      <button className={cx(ui.btn, ui.sm, statsVisible ? s.statsActive : ui.ghost)} onClick={onToggleStats} aria-pressed={statsVisible} aria-expanded={statsVisible} aria-controls="board-toolbar" disabled={!board}>
        Stats
      </button>

      <div className={cx(s.search, (searchOpen || query) && s.searchOpen)}>
        <Icon name="search" size={15} className={s.searchIcon} />
        <input
          ref={searchRef}
          id="card-search"
          value={query}
          onChange={(e) => setSearchQuery(e.target.value)}
          onBlur={() => !query && setSearchOpen(false)}
          placeholder="Search cards…"
          aria-label="Search cards"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button className={cx(ui.iconBtn, ui.small)} onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }} aria-label="Clear search">
            <Icon name="x" size={14} />
          </button>
        ) : (
          <kbd className={cx(ui.kbd, s.searchKbd)}>/</kbd>
        )}
        <button className={cx(ui.iconBtn, ui.small, s.closeSearch)} onMouseDown={(e) => e.preventDefault()} onClick={() => { setSearchQuery(''); setSearchOpen(false); searchRef.current?.blur(); }} aria-label="Close search"><Icon name="x" size={14} /></button>
      </div>
      <button className={cx(ui.iconBtn, s.searchBtn)} onClick={focusSearch} aria-label="Search">
        <Icon name="search" size={17} />
      </button>

      <button className={cx(ui.btn, ui.primary, s.newBtn)} onClick={() => openModal('card', {})} disabled={!board} title="New card (C)">
        <Icon name="plus" size={15} strokeWidth={2.2} />
        <span className={s.newLabel}>New card</span>
      </button>
    </header>
  );
}
