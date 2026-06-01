export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function formatDue(dateStr: string | null) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, cls: 'overdue' };
  if (diffDays === 0) return { label: 'Due today', cls: 'due-today' };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, cls: 'due-soon' };
  return { label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
}
