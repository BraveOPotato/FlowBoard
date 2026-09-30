import type { ActivityType, ThemeDef } from './types';
import type { IconName } from './components/Icon';

export const DB_NAME = 'flowboard';
export const DB_VERSION = 4;
export const WORKER_URL = 'https://flowboard-worker.abdullahalkafajy.workers.dev';

export const CARD_COLORS = [
  { name: 'none', value: 'transparent' },
  { name: 'violet', value: '#6c63ff' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'green', value: '#22c55e' },
  { name: 'yellow', value: '#f59e0b' },
  { name: 'red', value: '#ef4444' },
  { name: 'pink', value: '#ec4899' },
  { name: 'orange', value: '#f97316' },
  { name: 'indigo', value: '#818cf8' },
  { name: 'teal', value: '#14b8a6' },
] as const;

export const COL_COLORS = ['#6c63ff', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#f97316'];

const darkLines = { hover: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.07)', lineStrong: 'rgba(255,255,255,0.12)' };

export const THEMES: ThemeDef[] = [
  { id: 'midnight', label: 'Midnight', scheme: 'dark', canvas: '#111315', sidebar: '#0c0e10', surface: '#171a1d', card: '#202428', raised: '#25292d', ...darkLines, fg: '#edf0ef', fgMuted: '#adb7b2', fgSubtle: '#89958f', accent: '#93c5b3', accentFg: '#13271f' },
  { id: 'graphite', label: 'Graphite', scheme: 'dark', canvas: '#111113', sidebar: '#0d0d0f', surface: '#18181b', card: '#1f1f23', raised: '#232327', ...darkLines, fg: '#fafafa', fgMuted: '#a1a1aa', fgSubtle: '#71717a', accent: '#3b82f6', accentFg: '#ffffff' },
  { id: 'tokyo', label: 'Tokyo Night', scheme: 'dark', canvas: '#1a1b26', sidebar: '#16161e', surface: '#1f2030', card: '#24283b', raised: '#292e42', hover: 'rgba(192,202,245,0.06)', line: 'rgba(192,202,245,0.08)', lineStrong: 'rgba(192,202,245,0.14)', fg: '#c0caf5', fgMuted: '#9aa5ce', fgSubtle: '#565f89', accent: '#7aa2f7', accentFg: '#1a1b26' },
  { id: 'mocha', label: 'Catppuccin', scheme: 'dark', canvas: '#1e1e2e', sidebar: '#181825', surface: '#232334', card: '#2c2d40', raised: '#313244', hover: 'rgba(205,214,244,0.06)', line: 'rgba(205,214,244,0.08)', lineStrong: 'rgba(205,214,244,0.14)', fg: '#cdd6f4', fgMuted: '#a6adc8', fgSubtle: '#6c7086', accent: '#cba6f7', accentFg: '#1e1e2e' },
  { id: 'rose', label: 'Rosé Pine', scheme: 'dark', canvas: '#191724', sidebar: '#16141f', surface: '#1f1d2e', card: '#26233a', raised: '#2a2740', hover: 'rgba(224,222,244,0.06)', line: 'rgba(224,222,244,0.08)', lineStrong: 'rgba(224,222,244,0.14)', fg: '#e0def4', fgMuted: '#908caa', fgSubtle: '#6e6a86', accent: '#ebbcba', accentFg: '#191724' },
  { id: 'ember', label: 'Ember', scheme: 'dark', canvas: '#14110f', sidebar: '#100e0c', surface: '#1b1815', card: '#241f1b', raised: '#29241f', hover: 'rgba(255,240,220,0.05)', line: 'rgba(255,230,200,0.07)', lineStrong: 'rgba(255,230,200,0.12)', fg: '#f3ece4', fgMuted: '#b0a497', fgSubtle: '#7a6f63', accent: '#f97316', accentFg: '#ffffff' },
  { id: 'forest', label: 'Forest', scheme: 'dark', canvas: '#0e1311', sidebar: '#0b0f0d', surface: '#141a17', card: '#1a221e', raised: '#1f2823', hover: 'rgba(220,255,235,0.05)', line: 'rgba(220,255,235,0.07)', lineStrong: 'rgba(220,255,235,0.12)', fg: '#e6efe9', fgMuted: '#9db0a5', fgSubtle: '#66786e', accent: '#34d399', accentFg: '#052e1c' },
  { id: 'daylight', label: 'Daylight', scheme: 'light', canvas: '#fbfbfc', sidebar: '#f4f4f6', surface: '#f0f0f3', card: '#ffffff', raised: '#ffffff', hover: 'rgba(15,15,30,0.045)', line: 'rgba(15,15,30,0.08)', lineStrong: 'rgba(15,15,30,0.14)', fg: '#18181b', fgMuted: '#52525b', fgSubtle: '#8b8b95', accent: '#5b5bd6', accentFg: '#ffffff' },
  { id: 'paper', label: 'Paper', scheme: 'light', canvas: '#faf8f4', sidebar: '#f3efe8', surface: '#efe9df', card: '#fffdfa', raised: '#fffdfa', hover: 'rgba(60,40,10,0.05)', line: 'rgba(60,40,10,0.09)', lineStrong: 'rgba(60,40,10,0.16)', fg: '#1f1a14', fgMuted: '#6b5f51', fgSubtle: '#9c8f80', accent: '#c2410c', accentFg: '#ffffff' },
  { id: 'latte', label: 'Latte', scheme: 'light', canvas: '#eff1f5', sidebar: '#e6e9ef', surface: '#e4e7ee', card: '#fafbfc', raised: '#ffffff', hover: 'rgba(76,79,105,0.06)', line: 'rgba(76,79,105,0.10)', lineStrong: 'rgba(76,79,105,0.18)', fg: '#4c4f69', fgMuted: '#6c6f85', fgSubtle: '#9ca0b0', accent: '#8839ef', accentFg: '#ffffff' },
  { id: 'mist', label: 'Mist', scheme: 'light', canvas: '#f5f7fa', sidebar: '#eef2f7', surface: '#e8edf4', card: '#ffffff', raised: '#ffffff', hover: 'rgba(20,40,80,0.05)', line: 'rgba(20,40,80,0.08)', lineStrong: 'rgba(20,40,80,0.14)', fg: '#0f172a', fgMuted: '#475569', fgSubtle: '#94a3b8', accent: '#0284c7', accentFg: '#ffffff' },
];

// Maps theme ids saved by older versions onto their closest new theme.
const LEGACY_THEMES: Record<string, string> = {
  void: 'midnight', carbon: 'graphite', noir: 'graphite', obsidian: 'ember', dracula: 'mocha',
  nord: 'tokyo', solarized: 'forest', snow: 'daylight', sage: 'mist',
};

export const resolveTheme = (id: string | null | undefined): ThemeDef =>
  THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === LEGACY_THEMES[id ?? '']) || THEMES[0];

export const ACTIVITY_META: Record<ActivityType, { icon: IconName; label: string; color: string }> = {
  created: { icon: 'sparkle', label: 'Created', color: '#22c55e' },
  moved: { icon: 'arrowRight', label: 'Moved', color: '#7c74ff' },
  updated: { icon: 'pencil', label: 'Updated', color: '#06b6d4' },
  deleted: { icon: 'trash', label: 'Deleted', color: '#ef4444' },
  due_set: { icon: 'clock', label: 'Due set', color: '#f59e0b' },
};
