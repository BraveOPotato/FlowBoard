import { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { DEFAULT_FILTERS, cx, hasFilters, matchesCard } from '../utils';
import { Icon } from './Icon';
import type { CardFilters } from '../types';
import s from './BoardToolbar.module.css';
import ui from './ui.module.css';

export function BoardToolbar() {
  const boardId = useFlowStore((st) => st.activeBoardId);
  const allCards = useFlowStore((st) => st.cards);
  const allColumns = useFlowStore((st) => st.columns);
  const filters = useFlowStore((st) => st.filters);
  const query = useFlowStore((st) => st.searchQuery);
  const density = useFlowStore((st) => st.density);
  const view = useFlowStore((st) => st.activeView);
  const [expanded, setExpanded] = useState(false);
  const { setFilters, clearFilters, setDensity } = useFlowStore.getState();
  if (!boardId) return null;
  const cards = allCards.filter((c) => c.boardId === boardId);
  const columns = allColumns.filter((c) => c.boardId === boardId).sort((a, b) => a.order - b.order);
  const tags = [...new Set(cards.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b));
  const filtered = hasFilters(filters) || !!query.trim();
  const count = cards.filter((c) => matchesCard(c, query, filters)).length;
  const countDue = (due: CardFilters['due']) => cards.filter((c) => matchesCard(c, '', { ...DEFAULT_FILTERS, due })).length;
  const focus = (next: Partial<CardFilters>) => { clearFilters(); setFilters(next); setExpanded(true); };

  return (
    <section className={s.workspace} aria-label="Board overview and filters">
      <div className={s.toolbar}>
        <div className={s.context}><Icon name={view === 'board' ? 'board' : view === 'calendar' ? 'calendar' : 'activity'} size={16} /><strong>{view === 'board' ? 'Board' : view === 'calendar' ? 'Calendar' : 'Activity'}</strong><span className={s.divider} /><span className={s.result} aria-live="polite">{filtered ? `${count} of ${cards.length} cards` : 'All cards'}</span></div>
        <div className={s.stats} aria-label="Board statistics">
          <button className={s.stat} onClick={clearFilters} aria-label={`Show all ${cards.length} cards`}>
            <span><Icon name="board" size={14} /> Total cards</span><strong>{cards.length}</strong>
          </button>
          <button className={cx(s.stat, s.due)} onClick={() => focus({ due: 'today' })} aria-label={`Show ${countDue('today')} cards due today`}>
            <span><Icon name="calendar" size={14} /> Due today</span><strong>{countDue('today')}</strong>
          </button>
          <button className={cx(s.stat, s.overdue)} onClick={() => focus({ due: 'overdue' })} aria-label={`Show ${countDue('overdue')} overdue cards`}>
            <span><Icon name="clock" size={14} /> Overdue</span><strong>{countDue('overdue')}</strong>
          </button>
        </div>
        <div className={s.tools}>
          <button className={cx(ui.btn, ui.sm, filtered || expanded ? s.filterActive : ui.ghost)} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="card-filters">
            <Icon name="filter" size={15} /> Filter{hasFilters(filters) && <span className={s.activeDot} />}
          </button>
          {filtered && <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={clearFilters}>Clear<span className={s.clearLabel}> filters</span></button>}
          {view === 'board' && <div className={s.density} aria-label="Card density">
            {(['comfortable', 'compact'] as const).map((d) => <button key={d} className={cx(s.densityBtn, density === d && s.selected)} onClick={() => setDensity(d)} aria-pressed={density === d} aria-label={`${d === 'compact' ? 'Compact' : 'Comfortable'} layout`} title={`${d === 'compact' ? 'Compact' : 'Comfortable'} layout`}><Icon name={d} size={15} /></button>)}
          </div>}
        </div>
      </div>
      {expanded && <div id="card-filters" className={s.filters}>
        <label><Icon name="circle" size={13} /><select aria-label="Filter by status" value={filters.columnId} onChange={(e) => setFilters({ columnId: e.target.value })}><option value="all">All statuses</option><option value="backlog">Backlog</option>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><Icon name="alert" size={13} /><select aria-label="Filter by priority" value={filters.priority} onChange={(e) => setFilters({ priority: e.target.value as CardFilters['priority'] })}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></label>
        <label><Icon name="tag" size={13} /><select aria-label="Filter by label" value={filters.tag} onChange={(e) => setFilters({ tag: e.target.value })}><option value="">All labels</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
        <label><Icon name="calendar" size={13} /><select aria-label="Filter by due date" value={filters.due} onChange={(e) => setFilters({ due: e.target.value as CardFilters['due'] })}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option></select></label>
      </div>}
    </section>
  );
}
