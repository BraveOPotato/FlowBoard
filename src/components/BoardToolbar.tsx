import { useFlowStore } from '../store/useFlowStore';
import { DEFAULT_FILTERS, cx, hasFilters, matchesCard } from '../utils';
import { Icon } from './Icon';
import type { CardFilters } from '../types';
import s from './BoardToolbar.module.css';
import ui from './ui.module.css';

export function BoardToolbar({ hidden = false }: { hidden?: boolean }) {
  const boardId = useFlowStore((st) => st.activeBoardId);
  const allCards = useFlowStore((st) => st.cards);
  const allColumns = useFlowStore((st) => st.columns);
  const filters = useFlowStore((st) => st.filters);
  const query = useFlowStore((st) => st.searchQuery);
  const density = useFlowStore((st) => st.density);
  const view = useFlowStore((st) => st.activeView);
  const { setFilters, clearFilters, setDensity } = useFlowStore.getState();
  if (!boardId) return null;
  const cards = allCards.filter((c) => c.boardId === boardId);
  const columns = allColumns.filter((c) => c.boardId === boardId).sort((a, b) => a.order - b.order);
  const tags = [...new Set(cards.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b));
  const filtered = hasFilters(filters) || !!query.trim();
  const count = cards.filter((c) => matchesCard(c, query, filters)).length;
  const countDue = (due: CardFilters['due']) => cards.filter((c) => matchesCard(c, '', { ...DEFAULT_FILTERS, due })).length;
  const quick = (due: 'overdue' | 'today', label: string) => {
    const n = countDue(due);
    return (
      <button className={cx(s.quick, s[due], n > 0 && s.hasItems)} aria-pressed={filters.due === due} onClick={() => setFilters({ due: filters.due === due ? 'all' : due })}>
        {label}<strong>{n}</strong>
      </button>
    );
  };

  return (
    <section id="board-toolbar" className={s.bar} aria-label="Filters" hidden={hidden}>
      <div className={s.selects}>
        <label><Icon name="circle" size={13} /><select aria-label="Filter by status" value={filters.columnId} onChange={(e) => setFilters({ columnId: e.target.value })}><option value="all">All statuses</option><option value="backlog">Backlog</option>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><Icon name="alert" size={13} /><select aria-label="Filter by priority" value={filters.priority} onChange={(e) => setFilters({ priority: e.target.value as CardFilters['priority'] })}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></label>
        <label><Icon name="tag" size={13} /><select aria-label="Filter by label" value={filters.tag} onChange={(e) => setFilters({ tag: e.target.value })}><option value="">All labels</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
        <label><Icon name="calendar" size={13} /><select aria-label="Filter by due date" value={filters.due} onChange={(e) => setFilters({ due: e.target.value as CardFilters['due'] })}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option></select></label>
      </div>
      <div className={s.quickGroup} role="group" aria-label="Deadlines">
        {quick('overdue', 'Overdue')}
        {quick('today', 'Due today')}
      </div>
      <div className={s.tools}>
        <span className={s.result} aria-live="polite">{filtered ? `${count} of ${cards.length} cards` : `${cards.length} card${cards.length === 1 ? '' : 's'}`}</span>
        {filtered && <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={clearFilters}>Clear</button>}
        {view === 'board' && <div className={s.density} role="group" aria-label="Card density">
          {(['comfortable', 'compact'] as const).map((d) => <button key={d} className={cx(s.densityBtn, density === d && s.selected)} onClick={() => setDensity(d)} aria-pressed={density === d} aria-label={`${d === 'compact' ? 'Compact' : 'Comfortable'} layout`} title={`${d === 'compact' ? 'Compact' : 'Comfortable'} layout`}><Icon name={d} size={15} /></button>)}
        </div>}
      </div>
    </section>
  );
}
