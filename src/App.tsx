import { useEffect, useState } from 'react';
import { useFlowStore } from './store/useFlowStore';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { BoardToolbar } from './components/BoardToolbar';
import { FullPageMessage, ToastContainer } from './components/Shell';
import { Logo } from './components/Icon';
import { ModalRouter } from './modals';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { TimelineView } from './views/TimelineView';
import s from './App.module.css';

export function App() {
  const activeView = useFlowStore((st) => st.activeView);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const isLoading = useFlowStore((st) => st.isLoading);
  const error = useFlowStore((st) => st.error);
  const density = useFlowStore((st) => st.density);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { useFlowStore.getState().init(); }, []);

  if (isLoading) {
    return (
      <div className={s.splash} aria-busy="true" aria-label="Loading FlowBoard">
        <Logo size={40} />
      </div>
    );
  }

  if (error) return <FullPageMessage title="FlowBoard couldn't start" detail={error} />;

  return (
    <div className={s.app} data-density={density}>
      <a className={s.skip} href="#main-content">Skip to board</a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className={s.main}>
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <BoardToolbar />
        <main id="main-content" role="tabpanel" aria-labelledby={`view-${activeView}`} tabIndex={-1} className={s.content}>
          {!activeBoardId || activeView === 'board' ? <BoardView key={activeBoardId} /> : activeView === 'calendar' ? <CalendarView /> : <TimelineView />}
        </main>
      </div>
      <ModalRouter />
      <ToastContainer />
    </div>
  );
}
