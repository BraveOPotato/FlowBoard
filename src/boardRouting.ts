export const boardPath = (id: string | null) => id === null ? '/' : `/board/${encodeURIComponent(id)}`;

export function boardIdFromPath(path: string): string | null {
  const match = /^\/board\/([^/]+)\/?$/.exec(path);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

export function setBoardUrl(id: string | null, replace = false) {
  const path = boardPath(id);
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', `${path}${window.location.search}${window.location.hash}`);
}
