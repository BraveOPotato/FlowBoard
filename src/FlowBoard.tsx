import React from 'react';
import { ErrorBoundary } from './components/Shell';
import { App } from './App';

// Theme CSS vars + rules with no Tailwind equivalent:
// - theme data-attribute selectors
// - scrollbar styling
// - keyframe animations
// - CSS pseudo-elements (::after on tl-entry-spine)
// - backlog max-height transition trick
// - card -webkit-line-clamp
const THEME_VARS = `
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

  /* Scrollbar styling — no Tailwind equivalent */
  #board-tabs::-webkit-scrollbar{display:none}
  #columns-area::-webkit-scrollbar{height:6px}
  #columns-area::-webkit-scrollbar-track{background:transparent}
  #columns-area::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
  .col-cards::-webkit-scrollbar{width:4px}
  .col-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
  #backlog-cards::-webkit-scrollbar{height:4px}
  #backlog-cards::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}

  /* Animations */
  @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .toast{animation:toastIn .2s ease}
  @keyframes slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
  #mobile-menu{animation:slideInLeft .2s ease}

  /* Backlog collapse — max-height transition */
  #backlog-area{max-height:var(--backlog-h);transition:max-height .25s}
  #backlog-area:not(.open){max-height:40px}
  #backlog-area.drag-over{border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent-glow)}
  #backlog-toggle-icon{transition:transform .2s}
  #backlog-area:not(.open) #backlog-toggle-icon{transform:rotate(180deg)}

  /* Timeline spine pseudo-element */
  .tl-entry-spine::after{content:'';width:1px;flex:1;background:var(--border);margin-top:6px}
  .tl-entry-spine-last::after{display:none}

  /* Card line-clamp */
  .card-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

  /* Touch device card active state */
  @media (pointer:coarse){
    .card:active{box-shadow:0 0 0 2px var(--accent),var(--shadow);border-color:var(--accent);transition:box-shadow .3s,border-color .3s}
  }

  /* Mobile overrides */
  @media (max-width:640px){
    :root{--col-w:260px;--header-h:48px;--backlog-h:180px}
  }
`;

export default function FlowBoard() {
  return (
    <ErrorBoundary>
      <div id="app" className="flex flex-col h-screen overflow-hidden">
        <style>{THEME_VARS}</style>
        <App />
      </div>
    </ErrorBoundary>
  );
}
