import React, { useState, useEffect, useRef } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import type { View } from '../types';

const headerBtn = "bg-transparent border-none text-[var(--text2)] cursor-pointer w-8 h-8 rounded-lg text-[15px] flex items-center justify-center transition-colors duration-150 hover:bg-[var(--bg3)] hover:text-[var(--text)]";
const mobileActionBtn = "block w-full text-left bg-[var(--bg3)] border border-[var(--border)] text-[var(--text)] px-3 py-2.5 rounded-lg cursor-pointer text-[13px] font-[var(--font-body)] transition-colors duration-150 mt-1.5 hover:border-[var(--accent)] hover:bg-[var(--bg4)]";
const sectionLabel = "text-[10px] font-bold tracking-[0.8px] uppercase text-[var(--text3)] font-[var(--font-mono)] mb-2";

export function Header() {
  const store = useFlowStore();
  const boards = useFlowStore((s) => s.boards);
  const activeBoardId = useFlowStore((s) => s.activeBoardId);
  const activeView = useFlowStore((s) => s.activeView);
  const workerStatus = useFlowStore((s) => s.workerStatus);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === '/' || e.key === 'f') && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        store.closeModal();
        setSearchVisible(false);
        store.setSearchQuery('');
        setMenuOpen(false);
      }
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        store.openModal('card', {});
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [store]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const toggleSearch = () => {
    const next = !searchVisible;
    setSearchVisible(next);
    if (!next) { setSearchVal(''); store.setSearchQuery(''); }
    else setTimeout(() => searchRef.current?.focus(), 50);
  };

  return (
    <>
      <header
        id="header"
        className="h-[var(--header-h)] bg-[var(--bg2)] border-b border-[var(--border)] flex items-center gap-2 px-3 flex-shrink-0 overflow-hidden"
      >
        {/* Desktop: logo */}
        <span
          id="logo"
          className="hidden sm:flex font-[var(--font-display)] font-extrabold text-base flex-shrink-0 tracking-tight"
          style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          FlowBoard
        </span>

        {/* Desktop: board tabs */}
        <div id="board-tabs" className="hidden sm:flex gap-1 overflow-x-auto flex-1 min-w-0">
          {boards.map((b) => (
            <div
              key={b.id}
              role="tab"
              aria-selected={b.id === activeBoardId}
              className={`group px-2.5 py-1 rounded-md cursor-pointer text-xs font-medium whitespace-nowrap flex items-center gap-1 transition-colors duration-150 ${
                b.id === activeBoardId
                  ? 'bg-[var(--accent-glow)] text-[var(--accent2)]'
                  : 'text-[var(--text2)] hover:bg-[var(--bg3)] hover:text-[var(--text)]'
              }`}
              onClick={() => store.setActiveBoard(b.id)}
              onDoubleClick={() => { const n = prompt('Rename board:', b.name); if (n?.trim()) store.renameBoard(b.id, n.trim()); }}
              title="Double-click to rename"
            >
              {b.name}
              <span
                className="opacity-0 group-hover:opacity-100 text-sm leading-none cursor-pointer text-[var(--text3)] transition-opacity duration-150"
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${b.name}"?`)) store.deleteBoard(b.id); }}
                title="Delete board"
              >
                ×
              </span>
            </div>
          ))}
        </div>

        {/* Desktop: add board */}
        <button
          id="add-board-btn"
          className="hidden sm:flex bg-transparent border border-[var(--border2)] text-[var(--text2)] w-6 h-6 rounded-md cursor-pointer text-base items-center justify-center flex-shrink-0 transition-colors duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]"
          onClick={() => store.openModal('addBoard', {})}
          aria-label="New board"
          title="New board"
        >
          +
        </button>

        <div className="hidden sm:flex flex-1" />

        {/* Mobile: hamburger */}
        <button
          id="hamburger-btn"
          className={`flex sm:hidden ${headerBtn} text-xl px-1`}
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
        >
          ☰
        </button>

        {/* View tabs */}
        <div className="flex gap-0.5 bg-[var(--bg3)] rounded-lg p-0.5 flex-shrink-0" role="tablist">
          {(['board', 'calendar', 'timeline'] as View[]).map((v) => (
            <div
              key={v}
              role="tab"
              aria-selected={activeView === v}
              className={`px-2.5 py-1 rounded-md cursor-pointer text-xs font-medium transition-colors duration-150 ${
                activeView === v
                  ? 'bg-[var(--surface)] text-[var(--text)]'
                  : 'text-[var(--text2)] hover:text-[var(--text)]'
              }`}
              onClick={() => store.setActiveView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </div>
          ))}
        </div>

        {/* Desktop: actions */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
          <button className={headerBtn} onClick={toggleSearch} aria-label="Search (/)" title="Search (/)">🔍</button>
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-[var(--font-mono)] cursor-pointer transition-colors duration-150 hover:bg-[var(--bg3)]"
            onClick={() => store.openModal('settings', {})}
            title="Click to open settings"
          >
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: workerStatus ? 'var(--green)' : 'var(--text3)' }} />
            <span className="text-[var(--text3)]">{workerStatus ? 'connected' : 'local'}</span>
          </div>
          <button className={headerBtn} onClick={() => store.openModal('theme', {})} aria-label="Switch theme" title="Switch theme">🎨</button>
          <button className={headerBtn} onClick={() => store.openModal('settings', {})} aria-label="Settings" title="Settings">⚙</button>
        </div>
      </header>

      {/* Search bar */}
      {searchVisible && (
        <div className="bg-[var(--bg2)] border-b border-[var(--border)] px-4 py-2 flex-shrink-0 max-sm:px-2 max-sm:py-1.5">
          <input
            ref={searchRef}
            id="search-input"
            value={searchVal}
            onChange={(e) => { setSearchVal(e.target.value); store.setSearchQuery(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchVisible(false); setSearchVal(''); store.setSearchQuery(''); } }}
            placeholder="Search cards by title, tag, description..."
            autoComplete="off"
            className="w-full bg-[var(--bg3)] border border-[var(--border2)] text-[var(--text)] rounded-lg px-3 py-2 text-[13px] font-[var(--font-body)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
          />
        </div>
      )}

      {/* Mobile slide-in menu */}
      {menuOpen && (
        <div
          id="mobile-menu-overlay"
          className="fixed inset-0 bg-black/55 z-[3000] flex items-stretch"
          onClick={() => setMenuOpen(false)}
        >
          <div
            id="mobile-menu"
            ref={menuRef}
            className="w-[min(300px,85vw)] bg-[var(--surface)] border-r border-[var(--border2)] flex flex-col overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Menu header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)] flex-shrink-0">
              <span
                className="font-[var(--font-display)] font-extrabold text-lg"
                style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
              >
                FlowBoard
              </span>
              <button
                className="bg-transparent border-none text-[var(--text3)] cursor-pointer text-lg px-2 py-1 rounded-md transition-colors duration-150 hover:text-[var(--text)] hover:bg-[var(--bg3)]"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className={sectionLabel}>Search</div>
              <input
                className="w-full bg-[var(--bg3)] border border-[var(--border2)] text-[var(--text)] rounded-[var(--radius)] px-2.5 py-2 text-[13px] font-[var(--font-body)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
                value={menuSearch}
                onChange={(e) => { setMenuSearch(e.target.value); store.setSearchQuery(e.target.value); }}
                placeholder="Search cards..."
                autoComplete="off"
              />
            </div>

            {/* Boards */}
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className={sectionLabel}>Boards</div>
              {boards.length === 0 && <div className="text-xs text-[var(--text3)] pt-1 pb-2">No boards yet</div>}
              {boards.map((b) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-2 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors duration-150 mb-1 ${b.id === activeBoardId ? 'bg-[var(--accent-glow)]' : 'hover:bg-[var(--bg3)]'}`}
                  onClick={() => { store.setActiveBoard(b.id); setMenuOpen(false); }}
                >
                  <span className="flex-1 text-[13px] text-[var(--text)] font-medium">{b.name}</span>
                  {b.id === activeBoardId && <span className="text-xs text-[var(--accent2)]">✓</span>}
                  <span
                    className="text-[13px] text-[var(--text3)] px-1 py-0.5 rounded transition-colors duration-150 hover:text-[var(--red)] hover:bg-red-500/10"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${b.name}"?`)) { store.deleteBoard(b.id); setMenuOpen(false); } }}
                  >✕</span>
                </div>
              ))}
              <button className={mobileActionBtn} onClick={() => { store.openModal('addBoard', {}); setMenuOpen(false); }}>
                + New Board
              </button>
            </div>

            {/* Status */}
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className={sectionLabel}>Status</div>
              <div
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--bg3)] border border-[var(--border)] cursor-pointer text-[13px] text-[var(--text2)] transition-colors duration-150 hover:border-[var(--accent)]"
                onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: workerStatus ? 'var(--green)' : 'var(--text3)' }} />
                <span>{workerStatus ? 'Connected to server' : 'Local only'}</span>
              </div>
            </div>

            {/* Options */}
            <div className="px-4 py-3">
              <div className={sectionLabel}>Options</div>
              <button className={mobileActionBtn} onClick={() => { store.openModal('theme', {}); setMenuOpen(false); }}>🎨 Switch Theme</button>
              <button className={mobileActionBtn} onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}>⚙ Settings</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
