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

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
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
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'k' && mod) || ((e.key === '/' || e.key === 'f') && !mod && !e.altKey && !isTyping(e.target))) {
        e.preventDefault();
        focusSearch();
      } else if ((e.key === 'n' && mod) || (e.key === 'c' && !mod && !e.altKey && !isTyping(e.target))) {
        if (!st.activeBoardId) return;
        e.preventDefault();
        st.openModal('card', {});
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className={s.topbar}>
      <button className={cx(ui.iconBtn, s.navBtn)} onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={18} />
      </button>

      <h1 className={s.title}>{board?.name ?? 'FlowBoard'}</h1>

      <nav className={s.views} role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={activeView === v.id}
            className={cx(s.view, activeView === v.id && s.viewActive)}
            onClick={() => setActiveView(v.id)}
            title={v.label}
          >
            <Icon name={v.icon} size={15} />
            <span className={s.viewLabel}>{v.label}</span>
          </button>
        ))}
      </nav>

      <div className={s.spacer} />

      <div className={cx(s.search, (searchOpen || query) && s.searchOpen)}>
        <Icon name="search" size={15} className={s.searchIcon} />
        <input
          ref={searchRef}
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
