import React, { useState, useEffect, useRef } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import type { View } from '../types';

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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const toggleSearch = () => {
    const next = !searchVisible;
    setSearchVisible(next);
    if (!next) {
      setSearchVal('');
      store.setSearchQuery('');
    } else {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  };

  return (
    <>
      <header id="header">
        {/* Desktop: logo + board tabs + add board */}
        <span
          id="logo"
          className="desktop-only"
          style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          FlowBoard
        </span>
        <div id="board-tabs" role="tablist" className="desktop-only">
          {boards.map((b) => (
            <div
              key={b.id}
              role="tab"
              aria-selected={b.id === activeBoardId}
              className={`board-tab${b.id === activeBoardId ? ' active' : ''}`}
              onClick={() => store.setActiveBoard(b.id)}
              onDoubleClick={() => {
                const n = prompt('Rename board:', b.name);
                if (n?.trim()) store.renameBoard(b.id, n.trim());
              }}
              title="Double-click to rename"
            >
              {b.name}
              <span
                className="board-tab-del"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${b.name}"?`)) store.deleteBoard(b.id);
                }}
                title="Delete board"
              >
                ×
              </span>
            </div>
          ))}
        </div>
        <button id="add-board-btn" className="desktop-only" onClick={() => store.openModal('addBoard', {})} aria-label="New board" title="New board">
          +
        </button>
        <div className="header-spacer desktop-only" />

        {/* Mobile: hamburger button */}
        <button id="hamburger-btn" className="mobile-only header-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
          ☰
        </button>

        {/* View tabs */}
        <div className="view-tabs" role="tablist">
          {(['board', 'calendar', 'timeline'] as View[]).map((v) => (
            <div
              key={v}
              role="tab"
              aria-selected={activeView === v}
              className={`view-tab${activeView === v ? ' active' : ''}`}
              onClick={() => store.setActiveView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </div>
          ))}
        </div>

        {/* Desktop: actions */}
        <div id="header-actions" className="desktop-only">
          <button className="header-btn" onClick={toggleSearch} aria-label="Search (/)" title="Search (/)">
            🔍
          </button>
          <div
            id="server-status"
            className={workerStatus ? 'ok' : 'err'}
            onClick={() => store.openModal('settings', {})}
            title="Click to open settings"
          >
            <div className="dot" />
            <span id="server-status-text">{workerStatus ? 'connected' : 'local'}</span>
          </div>
          <button className="header-btn" onClick={() => store.openModal('theme', {})} aria-label="Switch theme" title="Switch theme">
            🎨
          </button>
          <button className="header-btn" onClick={() => store.openModal('settings', {})} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {/* Desktop search bar */}
      {searchVisible && (
        <div id="search-bar">
          <input
            ref={searchRef}
            id="search-input"
            value={searchVal}
            onChange={(e) => {
              setSearchVal(e.target.value);
              store.setSearchQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchVisible(false);
                setSearchVal('');
                store.setSearchQuery('');
              }
            }}
            placeholder="Search cards by title, tag, description..."
            autoComplete="off"
          />
        </div>
      )}

      {/* Mobile slide-in menu */}
      {menuOpen && (
        <div id="mobile-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div id="mobile-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <div id="mobile-menu-header">
              <span
                id="mobile-menu-logo"
                style={{ background: 'linear-gradient(135deg, var(--logo-a), var(--logo-b))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
              >
                FlowBoard
              </span>
              <button id="mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
            </div>

            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Search</div>
              <input
                className="form-input"
                value={menuSearch}
                onChange={(e) => { setMenuSearch(e.target.value); store.setSearchQuery(e.target.value); }}
                placeholder="Search cards..."
                autoComplete="off"
              />
            </div>

            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Boards</div>
              {boards.length === 0 && <div className="mobile-menu-empty">No boards yet</div>}
              {boards.map((b) => (
                <div
                  key={b.id}
                  className={`mobile-menu-board-item${b.id === activeBoardId ? ' active' : ''}`}
                  onClick={() => { store.setActiveBoard(b.id); setMenuOpen(false); }}
                >
                  <span className="mobile-menu-board-name">{b.name}</span>
                  {b.id === activeBoardId && <span className="mobile-menu-board-check">✓</span>}
                  <span
                    className="mobile-menu-board-del"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${b.name}"?`)) { store.deleteBoard(b.id); setMenuOpen(false); } }}
                  >✕</span>
                </div>
              ))}
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('addBoard', {}); setMenuOpen(false); }}>
                + New Board
              </button>
            </div>

            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Status</div>
              <div className={`mobile-menu-status${workerStatus ? ' ok' : ' err'}`} onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}>
                <div className="dot" />
                <span>{workerStatus ? 'Connected to server' : 'Local only'}</span>
              </div>
            </div>

            <div className="mobile-menu-section">
              <div className="mobile-menu-section-label">Options</div>
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('theme', {}); setMenuOpen(false); }}>
                🎨 Switch Theme
              </button>
              <button className="mobile-menu-action-btn" onClick={() => { store.openModal('settings', {}); setMenuOpen(false); }}>
                ⚙ Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
