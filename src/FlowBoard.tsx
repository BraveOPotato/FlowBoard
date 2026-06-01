import React from 'react';
import { ErrorBoundary } from './components/Shell';
import { App } from './App';

const GLOBAL_STYLES = `
  /* ── THEME VARS ── */
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root,[data-theme="void"]{--bg:#0a0a0f;--bg2:#111118;--bg3:#1a1a24;--bg4:#22222e;--surface:#1e1e2a;--surface2:#282836;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.13);--text:#e8e8f0;--text2:#8888a4;--text3:#50506a;--accent:#6c63ff;--accent2:#8b85ff;--accent-glow:rgba(108,99,255,0.22);--green:#22c55e;--red:#ef4444;--yellow:#f59e0b;--cyan:#06b6d4;--pink:#ec4899;--orange:#f97316;--logo-a:#8b85ff;--logo-b:#a78bfa;--radius:10px;--radius-lg:16px;--shadow:0 4px 24px rgba(0,0,0,0.4);--shadow-lg:0 8px 48px rgba(0,0,0,0.6);--font-display:'Syne',sans-serif;--font-body:'DM Sans',sans-serif;--font-mono:'DM Mono',monospace;--col-w:280px;--backlog-h:200px;--header-h:52px}
  [data-theme="carbon"]{--bg:#0d0f12;--bg2:#141720;--bg3:#1c2030;--bg4:#242838;--surface:#1a1e2c;--surface2:#222638;--border:rgba(148,163,184,0.08);--border2:rgba(148,163,184,0.15);--text:#e2e8f0;--text2:#64748b;--text3:#374151;--accent:#38bdf8;--accent2:#7dd3fc;--accent-glow:rgba(56,189,248,0.18);--green:#34d399;--red:#f87171;--yellow:#fbbf24;--cyan:#22d3ee;--pink:#f472b6;--orange:#fb923c;--logo-a:#38bdf8;--logo-b:#818cf8}
  [data-theme="obsidian"]{--bg:#111010;--bg2:#181614;--bg3:#221f1c;--bg4:#2c2824;--surface:#201d1a;--surface2:#2a2622;--border:rgba(255,200,120,0.07);--border2:rgba(255,200,120,0.13);--text:#f5ede0;--text2:#8a7060;--text3:#504030;--accent:#f59e0b;--accent2:#fbbf24;--accent-glow:rgba(245,158,11,0.20);--green:#86efac;--red:#fca5a5;--yellow:#fde68a;--cyan:#67e8f9;--pink:#fda4af;--orange:#fed7aa;--logo-a:#fbbf24;--logo-b:#f97316}
  [data-theme="noir"]{--bg:#080808;--bg2:#101010;--bg3:#181818;--bg4:#202020;--surface:#161616;--surface2:#1e1e1e;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.14);--text:#f0f0f0;--text2:#707070;--text3:#404040;--accent:#e0e0e0;--accent2:#f5f5f5;--accent-glow:rgba(255,255,255,0.10);--green:#86efac;--red:#f87171;--yellow:#fde047;--cyan:#67e8f9;--pink:#f9a8d4;--orange:#fdba74;--logo-a:#e0e0e0;--logo-b:#a0a0a0}
  [data-theme="dracula"]{--bg:#191921;--bg2:#21222c;--bg3:#282a36;--bg4:#343746;--surface:#2b2d3e;--surface2:#363a4f;--border:rgba(189,147,249,0.09);--border2:rgba(189,147,249,0.17);--text:#f8f8f2;--text2:#6272a4;--text3:#404558;--accent:#bd93f9;--accent2:#caa9fa;--accent-glow:rgba(189,147,249,0.22);--green:#50fa7b;--red:#ff5555;--yellow:#f1fa8c;--cyan:#8be9fd;--pink:#ff79c6;--orange:#ffb86c;--logo-a:#bd93f9;--logo-b:#ff79c6}
  [data-theme="tokyo"]{--bg:#0d0f17;--bg2:#13151f;--bg3:#1a1b27;--bg4:#21223a;--surface:#1e1f2e;--surface2:#252739;--border:rgba(122,162,247,0.09);--border2:rgba(122,162,247,0.17);--text:#c0caf5;--text2:#565f89;--text3:#3b4261;--accent:#7aa2f7;--accent2:#89b4fa;--accent-glow:rgba(122,162,247,0.22);--green:#9ece6a;--red:#f7768e;--yellow:#e0af68;--cyan:#7dcfff;--pink:#bb9af7;--orange:#ff9e64;--logo-a:#7aa2f7;--logo-b:#bb9af7}
  [data-theme="nord"]{--bg:#1a1f2e;--bg2:#1f2535;--bg3:#252d3e;--bg4:#2c3550;--surface:#252b3b;--surface2:#2d3548;--border:rgba(136,192,208,0.10);--border2:rgba(136,192,208,0.18);--text:#eceff4;--text2:#7b8fa6;--text3:#4c5e74;--accent:#88c0d0;--accent2:#8fbcbb;--accent-glow:rgba(136,192,208,0.20);--green:#a3be8c;--red:#bf616a;--yellow:#ebcb8b;--cyan:#81d4e6;--pink:#b48ead;--orange:#d08770;--logo-a:#88c0d0;--logo-b:#81a1c1}
  [data-theme="solarized"]{--bg:#001f26;--bg2:#002b36;--bg3:#073642;--bg4:#0d4555;--surface:#08384a;--surface2:#0e4558;--border:rgba(131,148,150,0.12);--border2:rgba(131,148,150,0.22);--text:#fdf6e3;--text2:#839496;--text3:#4e686a;--accent:#268bd2;--accent2:#2aa198;--accent-glow:rgba(38,139,210,0.22);--green:#859900;--red:#dc322f;--yellow:#b58900;--cyan:#2aa198;--pink:#d33682;--orange:#cb4b16;--logo-a:#268bd2;--logo-b:#2aa198}
  [data-theme="snow"]{--bg:#f8fafc;--bg2:#f1f5f9;--bg3:#e8eef4;--bg4:#dde5ee;--surface:#ffffff;--surface2:#f8fafc;--border:rgba(15,23,42,0.08);--border2:rgba(15,23,42,0.14);--text:#0f172a;--text2:#475569;--text3:#94a3b8;--accent:#4f46e5;--accent2:#6366f1;--accent-glow:rgba(79,70,229,0.15);--green:#16a34a;--red:#dc2626;--yellow:#ca8a04;--cyan:#0891b2;--pink:#db2777;--orange:#ea580c;--logo-a:#4f46e5;--logo-b:#7c3aed}
  [data-theme="paper"]{--bg:#faf7f0;--bg2:#f3ede2;--bg3:#ebe3d4;--bg4:#e0d6c2;--surface:#ffffff;--surface2:#faf7f0;--border:rgba(60,40,10,0.09);--border2:rgba(60,40,10,0.16);--text:#1c1409;--text2:#7a6040;--text3:#b8a080;--accent:#c05820;--accent2:#d97030;--accent-glow:rgba(192,88,32,0.15);--green:#2d6a2d;--red:#b82020;--yellow:#b87800;--cyan:#1a6b7a;--pink:#a0205a;--orange:#c45010;--logo-a:#c05820;--logo-b:#d97030}
  [data-theme="sage"]{--bg:#f4f6f2;--bg2:#edf0e8;--bg3:#e2e8db;--bg4:#d4dccb;--surface:#ffffff;--surface2:#f4f6f2;--border:rgba(30,50,20,0.09);--border2:rgba(30,50,20,0.16);--text:#1a2414;--text2:#5a7050;--text3:#90a880;--accent:#3d7a40;--accent2:#4e9452;--accent-glow:rgba(61,122,64,0.15);--green:#2e7d32;--red:#c62828;--yellow:#f57f17;--cyan:#00838f;--pink:#ad1457;--orange:#e65100;--logo-a:#3d7a40;--logo-b:#66bb6a}

  body{background:var(--bg);color:var(--text);font-family:var(--font-body);font-size:14px;overflow:hidden;height:100vh}
  #app{display:flex;flex-direction:column;height:100vh;overflow:hidden}

  /* Header */
  #header{height:var(--header-h);background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:0 12px;flex-shrink:0;overflow:hidden}
  #logo{font-family:var(--font-display);font-weight:800;font-size:16px;color:var(--accent2);letter-spacing:-0.5px;flex-shrink:0}
  #board-tabs{display:flex;gap:4px;overflow-x:auto;flex:1;min-width:0}
  #board-tabs::-webkit-scrollbar{display:none}
  .board-tab{padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:var(--text2);white-space:nowrap;display:flex;align-items:center;gap:4px;transition:background .15s,color .15s}
  .board-tab:hover{background:var(--bg3);color:var(--text)}
  .board-tab.active{background:var(--accent-glow);color:var(--accent2)}
  .board-tab-del{opacity:0;font-size:14px;line-height:1;cursor:pointer;color:var(--text3);transition:opacity .15s}
  .board-tab:hover .board-tab-del{opacity:1}
  #add-board-btn{background:none;border:1px solid var(--border2);color:var(--text2);width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s}
  #add-board-btn:hover{border-color:var(--accent);color:var(--accent)}
  .header-spacer{flex:1}
  .view-tabs{display:flex;gap:2px;background:var(--bg3);border-radius:8px;padding:2px;flex-shrink:0}
  .view-tab{padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;color:var(--text2);transition:background .15s,color .15s}
  .view-tab.active{background:var(--surface);color:var(--text)}
  #header-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
  .header-btn{background:none;border:none;color:var(--text2);cursor:pointer;width:30px;height:30px;border-radius:8px;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
  .header-btn:hover{background:var(--bg3);color:var(--text)}
  #server-status{display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;font-size:11px;font-family:var(--font-mono);cursor:pointer;transition:background .15s}
  #server-status:hover{background:var(--bg3)}
  #server-status.ok .dot{background:var(--green)}
  #server-status.err .dot{background:var(--text3)}
  .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  #server-status-text{color:var(--text3)}

  /* Search */
  #search-bar{background:var(--bg2);border-bottom:1px solid var(--border);padding:8px 16px;flex-shrink:0}
  #search-input{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;font-family:var(--font-body);outline:none;transition:border-color .15s}
  #search-input:focus{border-color:var(--accent)}

  /* Main layout */
  #main{flex:1;overflow:hidden;position:relative;display:flex;flex-direction:column}
  .active-view{display:flex;flex-direction:column;width:100%;height:100%}
  .hidden-view{display:none}

  /* Board */
  #board-view{display:flex;flex-direction:column;height:100%;overflow:hidden}
  #columns-area{display:flex;gap:12px;padding:16px;overflow-x:auto;flex:1;align-items:flex-start;min-height:0}
  #columns-area::-webkit-scrollbar{height:6px}
  #columns-area::-webkit-scrollbar-track{background:transparent}
  #columns-area::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
  .add-col-btn{flex:0 0 auto;height:36px;padding:0 16px;background:transparent;border:1px dashed var(--border2);color:var(--text3);border-radius:var(--radius);cursor:pointer;font-size:13px;white-space:nowrap;transition:border-color .15s,color .15s;align-self:flex-start;margin-top:0}
  .add-col-btn:hover{border-color:var(--accent);color:var(--accent)}

  /* Column */
  .column{flex:0 0 var(--col-w);display:flex;flex-direction:column;background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);max-height:100%;overflow:hidden;transition:border-color .2s}
  .column.dragging{opacity:0.5}
  .column.drag-over{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
  .col-header{display:flex;align-items:center;gap:6px;padding:12px 12px 8px;border-bottom:1px solid var(--border);flex-shrink:0}
  .col-drag-handle{cursor:grab;color:var(--text3);font-size:14px;flex-shrink:0;padding:0 2px;background:none;border:none;touch-action:none}
  .col-drag-handle:active{cursor:grabbing}
  .col-color-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;cursor:pointer;transition:transform .15s}
  .col-color-dot:hover{transform:scale(1.3)}
  .col-name{font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-display);flex:1;cursor:default}
  .col-count{font-size:11px;color:var(--text3);font-family:var(--font-mono);background:var(--bg3);padding:2px 6px;border-radius:10px}
  .col-menu-btn{background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color .15s}
  .col-menu-btn:hover{color:var(--text)}
  .col-cards{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px}
  .col-cards::-webkit-scrollbar{width:4px}
  .col-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
  .col-add-btn{margin:4px 8px 8px;background:none;border:1px dashed var(--border);color:var(--text3);border-radius:var(--radius);padding:6px;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;text-align:left}
  .col-add-btn:hover{border-color:var(--accent);color:var(--accent)}
  .col-menu-item{display:block;width:100%;text-align:left;background:none;border:none;padding:8px 12px;color:var(--text);cursor:pointer;font-size:13px;border-radius:6px;transition:background .15s}
  .col-menu-item:hover{background:var(--bg3)}

  /* Card */
  .card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0;cursor:grab;transition:border-color .15s,box-shadow .15s;position:relative;overflow:hidden;user-select:none;display:flex;flex-direction:column}
  @media (pointer:coarse){.card:active{box-shadow:0 0 0 2px var(--accent),var(--shadow);border-color:var(--accent);transition:box-shadow .3s,border-color .3s}}
  .card:hover{border-color:var(--border2);box-shadow:var(--shadow)}
  .card.dragging{opacity:0.5}
  .card-color-bar{height:3px;width:100%;flex-shrink:0}
  .card-body-row{display:flex;gap:8px;align-items:flex-start;padding:10px 10px 8px;flex:1;min-width:0}
  .card-inner{flex:1;min-width:0}
  .card-title{font-size:13px;font-weight:500;color:var(--text);line-height:1.4;word-break:break-word}
  .card-desc{font-size:11px;color:var(--text2);margin-top:4px;line-height:1.4;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
  .tag{font-size:10px;padding:2px 6px;border-radius:4px;background:var(--accent-glow);color:var(--accent2);font-family:var(--font-mono)}
  .card-footer{display:flex;align-items:center;gap:6px;margin-top:8px}
  .card-footer-spacer{flex:1}
  .priority-badge{font-size:9px;padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-weight:600}
  .priority-badge.priority-high{background:rgba(239,68,68,.2);color:var(--red)}
  .priority-badge.priority-low{background:rgba(34,197,94,.15);color:var(--green)}
  .card-due{font-size:10px;font-family:var(--font-mono);color:var(--text3)}
  .card-due.overdue{color:var(--red)}
  .card-due.due-today{color:var(--yellow)}
  .card-due.due-soon{color:var(--orange)}

  /* Desktop/Mobile visibility helpers */
  .desktop-only{display:flex}
  .mobile-only{display:none}

  /* Mobile hamburger menu */
  #hamburger-btn{font-size:20px;padding:0 4px}
  #mobile-menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:3000;display:flex;align-items:stretch}
  #mobile-menu{width:min(300px,85vw);background:var(--surface);border-right:1px solid var(--border2);display:flex;flex-direction:column;overflow-y:auto;animation:slideInLeft .2s ease}
  @keyframes slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
  #mobile-menu-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border);flex-shrink:0}
  #mobile-menu-logo{font-family:var(--font-display);font-weight:800;font-size:18px}
  #mobile-menu-close{background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:4px 8px;border-radius:6px;transition:color .15s}
  #mobile-menu-close:hover{color:var(--text);background:var(--bg3)}
  .mobile-menu-section{padding:12px 16px;border-bottom:1px solid var(--border)}
  .mobile-menu-section-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--text3);font-family:var(--font-mono);margin-bottom:8px}
  .mobile-menu-empty{font-size:12px;color:var(--text3);padding:4px 0 8px}
  .mobile-menu-board-item{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background .15s;margin-bottom:4px}
  .mobile-menu-board-item:hover{background:var(--bg3)}
  .mobile-menu-board-item.active{background:var(--accent-glow)}
  .mobile-menu-board-name{flex:1;font-size:13px;color:var(--text);font-weight:500}
  .mobile-menu-board-check{font-size:12px;color:var(--accent2)}
  .mobile-menu-board-del{font-size:13px;color:var(--text3);padding:2px 4px;border-radius:4px;transition:color .15s,background .15s}
  .mobile-menu-board-del:hover{color:var(--red);background:rgba(239,68,68,.1)}
  .mobile-menu-action-btn{display:block;width:100%;text-align:left;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-family:var(--font-body);transition:border-color .15s,background .15s;margin-top:6px}
  .mobile-menu-action-btn:hover{border-color:var(--accent);background:var(--bg4)}
  .mobile-menu-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--text2);transition:border-color .15s}
  .mobile-menu-status:hover{border-color:var(--accent)}
  .mobile-menu-status.ok .dot{background:var(--green)}
  .mobile-menu-status.err .dot{background:var(--text3)}

  /* Mobile */
  @media (max-width: 640px) {
    :root{--col-w:260px;--header-h:48px;--backlog-h:180px}
    #header{padding:0 10px;gap:8px;justify-content:space-between}
    .desktop-only{display:none!important}
    .mobile-only{display:flex!important}
    #search-bar{padding:6px 8px}
    #columns-area{padding:8px;gap:8px}
    .column{flex:0 0 var(--col-w)}
    .col-cards{padding:6px}
    .card-body-row{padding:8px 8px 6px}
    .modal{padding:16px;width:100%;max-width:100%;border-radius:12px 12px 0 0}
    .modal-lg{width:100%;max-width:100%}
    .modal-overlay{padding:0;align-items:flex-end}
    #toast-container{bottom:16px;width:calc(100% - 32px);left:16px;transform:none}
    .toast{white-space:normal}
    #backlog-cards{padding:6px 8px}
    .tl-container{padding:0 12px 24px}
    .tl-header{padding:12px 12px 8px}
    .form-row{flex-direction:column;gap:0}
    .cal-day{min-height:52px;padding:4px}
    .cal-day-num{font-size:10px}
    .view-tabs{gap:1px}
    .view-tab{padding:4px 10px;font-size:12px}
  }

  /* Backlog */
  #backlog-area{background:var(--bg2);border-top:1px solid var(--border);flex-shrink:0;max-height:var(--backlog-h);transition:max-height .25s}
  #backlog-area:not(.open){max-height:40px}
  #backlog-area.drag-over{border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent-glow)}
  #backlog-header{display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;border-bottom:1px solid var(--border)}
  #backlog-toggle-icon{color:var(--text3);font-size:10px;transition:transform .2s;cursor:pointer}
  #backlog-area:not(.open) #backlog-toggle-icon{transform:rotate(180deg)}
  #backlog-label{font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text3);font-family:var(--font-mono)}
  #backlog-count{font-size:11px;color:var(--text3);background:var(--bg3);padding:1px 6px;border-radius:8px;font-family:var(--font-mono)}
  #backlog-add-btn{margin-left:auto;background:none;border:1px solid var(--border2);color:var(--text2);padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;transition:border-color .15s,color .15s}
  #backlog-add-btn:hover{border-color:var(--accent);color:var(--accent)}
  #backlog-cards{display:flex;gap:8px;padding:8px 16px;overflow-x:auto;height:calc(var(--backlog-h) - 40px)}
  #backlog-cards::-webkit-scrollbar{height:4px}
  #backlog-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
  #backlog-cards .card{flex:0 0 220px}

  /* Calendar */
  #calendar-view{height:100%;display:flex;flex-direction:column;overflow:hidden;padding:16px}
  .cal-nav{display:flex;align-items:center;margin-bottom:12px;gap:8px}
  .cal-month-label{font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);flex:1}
  .cal-nav-btn{background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:border-color .15s,color .15s}
  .cal-nav-btn:hover,.cal-nav-btn.active{border-color:var(--accent);color:var(--accent)}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;flex:1;overflow:auto}
  .cal-day-header{font-size:10px;font-weight:600;letter-spacing:.5px;color:var(--text3);font-family:var(--font-mono);text-align:center;padding:6px 0;background:var(--bg2);position:sticky;top:0}
  .cal-day{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px;min-height:72px;transition:border-color .15s}
  .cal-day.today{border-color:var(--accent);background:var(--accent-glow)}
  .cal-day.other-month{background:var(--bg2);opacity:.4}
  .cal-day.has-events{cursor:pointer}
  .cal-day.has-events:hover{border-color:var(--border2)}
  .cal-day-num{font-size:11px;color:var(--text3);font-family:var(--font-mono);margin-bottom:4px}
  .cal-chips{display:flex;gap:3px;flex-wrap:wrap}
  .cal-card-chip{width:12px;height:12px;border-radius:3px}

  /* Timeline */
  #timeline-view{height:100%;display:flex;flex-direction:column;overflow:hidden}
  .tl-header{display:flex;align-items:center;padding:16px 20px 12px;flex-shrink:0;border-bottom:1px solid var(--border)}
  .tl-title{font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text)}
  .tl-subtitle{font-size:11px;color:var(--text3);margin-top:2px}
  .tl-container{flex:1;overflow-y:auto;padding:0 20px 32px;max-width:860px;margin:0 auto;width:100%}
  .tl-day-heading{display:flex;align-items:center;justify-content:space-between;padding:16px 0 8px;border-bottom:1px solid var(--border);margin-bottom:12px}
  .tl-day-label{font-size:12px;font-weight:600;color:var(--text);font-family:var(--font-display)}
  .tl-day-today .tl-day-label{color:var(--accent2)}
  .tl-day-count{font-size:10px;color:var(--text3);font-family:var(--font-mono)}
  .tl-day-block{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
  .tl-entry{display:flex;gap:12px}
  .tl-entry-spine{display:flex;flex-direction:column;align-items:center;width:16px;flex-shrink:0;padding-top:4px}
  .tl-entry-spine::after{content:'';width:1px;flex:1;background:var(--border);margin-top:6px}
  .tl-entry-spine-last::after{display:none}
  .tl-entry-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .tl-entry-body{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;transition:border-color .15s}
  .tl-entry-body.clickable{cursor:pointer}
  .tl-entry-body.clickable:hover{border-color:var(--border2)}
  .tl-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:4px}
  .tl-entry-icon{font-size:12px}
  .tl-entry-type{font-size:11px;font-weight:600;font-family:var(--font-mono)}
  .tl-entry-time{font-size:10px;color:var(--text3);font-family:var(--font-mono);margin-left:auto}
  .tl-entry-desc{font-size:12px;color:var(--text2);line-height:1.4}
  .tl-entry-footer{margin-top:6px}
  .tl-entry-card-link{font-size:11px;color:var(--accent2);cursor:pointer}
  .tl-entry-card-deleted{font-size:11px;color:var(--text3)}

  /* Modals */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px}
  .modal{background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius-lg);padding:22px;width:400px;max-width:100%;max-height:90vh;overflow-y:auto;box-shadow:var(--shadow-lg)}
  .modal-lg{width:560px}
  .modal-title{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
  .modal-close{background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;transition:color .15s}
  .modal-close:hover{color:var(--text);background:var(--bg3)}
  .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
  .form-group{margin-bottom:14px}
  .form-row{display:flex;gap:12px;margin-bottom:0}
  .form-row .form-group{flex:1}
  .form-label{display:block;font-size:11px;font-weight:600;letter-spacing:.4px;color:var(--text3);font-family:var(--font-mono);margin-bottom:6px;text-transform:uppercase}
  .form-input,.form-textarea,.form-select{width:100%;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:var(--radius);padding:8px 10px;font-size:13px;font-family:var(--font-body);outline:none;transition:border-color .15s}
  .form-input:focus,.form-textarea:focus,.form-select:focus{border-color:var(--accent)}
  .form-textarea{min-height:80px;resize:vertical}
  .color-picker{display:flex;gap:6px;flex-wrap:wrap}
  .color-option{width:24px;height:24px;border-radius:50%;cursor:pointer;transition:transform .15s,box-shadow .15s;border:2px solid transparent}
  .color-option:hover{transform:scale(1.15)}
  .color-option.selected{box-shadow:0 0 0 2px var(--text),0 0 0 4px var(--accent);transform:scale(1.1)}
  .btn{padding:8px 14px;border-radius:var(--radius);font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s,opacity .15s;font-family:var(--font-body)}
  .btn:disabled{opacity:.5;cursor:default}
  .btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .btn-primary:hover:not(:disabled){background:var(--accent2);border-color:var(--accent2)}
  .btn-secondary{background:transparent;color:var(--text2);border-color:var(--border2)}
  .btn-secondary:hover{background:var(--bg3);color:var(--text)}
  .btn-danger{background:rgba(239,68,68,.15);color:var(--red);border-color:rgba(239,68,68,.3)}
  .btn-danger:hover{background:rgba(239,68,68,.25)}

  /* Settings */
  .settings-section{margin-bottom:20px}
  .settings-section-title{font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--text3);font-family:var(--font-mono);text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
  .server-indicator{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)}

  /* Theme panel */
  .theme-section-label{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-family:var(--font-mono);margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border)}
  .theme-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
  .theme-swatch{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;border:2px solid transparent;transition:border-color .15s,background .15s;background:var(--bg3)}
  .theme-swatch:hover{border-color:var(--border2);background:var(--bg4)}
  .theme-swatch.active{border-color:var(--accent2);background:var(--bg4)}
  .theme-swatch-dots{display:flex;gap:3px;flex-shrink:0}
  .theme-swatch-dot{width:8px;height:8px;border-radius:50%}
  .theme-swatch-label{font-size:12px;color:var(--text);font-family:var(--font-body);font-weight:500}
  .theme-swatch-sub{font-size:10px;color:var(--text3);font-family:var(--font-mono);margin-left:auto}

  /* Toast */
  #toast-container{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:9000;pointer-events:none}
  .toast{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px;font-size:12px;box-shadow:var(--shadow);animation:toastIn .2s ease;white-space:nowrap}
  .toast-icon{font-size:14px}
  @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

  /* Empty state */
  .empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;padding:40px}
  .empty-state-icon{font-size:36px;opacity:.4}
  .empty-state-title{font-size:15px;font-weight:600;color:var(--text2);font-family:var(--font-display)}
  .empty-state-text{font-size:12px;color:var(--text3);text-align:center}
`;

export default function FlowBoard() {
  return (
    <ErrorBoundary>
      <div id="app">
        <style>{GLOBAL_STYLES}</style>
        <App />
      </div>
    </ErrorBoundary>
  );
}
