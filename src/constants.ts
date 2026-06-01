import type { ActivityType, ThemeDef } from '../types';

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

export const THEMES: ThemeDef[] = [
  { id: 'void', label: 'Void', section: 'dark', bg: '#0a0a0f', surface: '#1e1e2a', accent: '#6c63ff', accent2: '#8b85ff', dot3: '#a78bfa' },
  { id: 'carbon', label: 'Carbon', section: 'dark', bg: '#0d0f12', surface: '#1a1e2c', accent: '#38bdf8', accent2: '#7dd3fc', dot3: '#818cf8' },
  { id: 'obsidian', label: 'Obsidian', section: 'dark', bg: '#111010', surface: '#201d1a', accent: '#f59e0b', accent2: '#fbbf24', dot3: '#f97316' },
  { id: 'noir', label: 'Noir', section: 'dark', bg: '#080808', surface: '#161616', accent: '#e0e0e0', accent2: '#f5f5f5', dot3: '#a0a0a0' },
  { id: 'dracula', label: 'Dracula', section: 'dark', bg: '#191921', surface: '#2b2d3e', accent: '#bd93f9', accent2: '#caa9fa', dot3: '#ff79c6' },
  { id: 'tokyo', label: 'Tokyo Night', section: 'dark', bg: '#0d0f17', surface: '#1e1f2e', accent: '#7aa2f7', accent2: '#89b4fa', dot3: '#bb9af7' },
  { id: 'nord', label: 'Nord', section: 'dark', bg: '#1a1f2e', surface: '#252b3b', accent: '#88c0d0', accent2: '#8fbcbb', dot3: '#81a1c1' },
  { id: 'solarized', label: 'Solarized', section: 'dark', bg: '#001f26', surface: '#08384a', accent: '#268bd2', accent2: '#2aa198', dot3: '#859900' },
  { id: 'snow', label: 'Snow', section: 'light', bg: '#f8fafc', surface: '#ffffff', accent: '#4f46e5', accent2: '#6366f1', dot3: '#7c3aed' },
  { id: 'paper', label: 'Paper', section: 'light', bg: '#faf7f0', surface: '#ffffff', accent: '#c05820', accent2: '#d97030', dot3: '#b87800' },
  { id: 'sage', label: 'Sage', section: 'light', bg: '#f4f6f2', surface: '#ffffff', accent: '#3d7a40', accent2: '#4e9452', dot3: '#2e7d32' },
];

export const ACTIVITY_META: Record<ActivityType, { icon: string; label: string; color: string }> = {
  created: { icon: '✦', label: 'Created', color: '#22c55e' },
  moved: { icon: '→', label: 'Moved', color: '#6c63ff' },
  updated: { icon: '✎', label: 'Updated', color: '#06b6d4' },
  deleted: { icon: '✕', label: 'Deleted', color: '#ef4444' },
  due_set: { icon: '◷', label: 'Due set', color: '#f59e0b' },
};
