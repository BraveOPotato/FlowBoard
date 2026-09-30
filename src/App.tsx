import { useEffect, useState } from 'react';
import { useFlowStore } from './store/useFlowStore';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { FullPageMessage, ToastContainer } from './components/Shell';
import { Logo } from './components/Icon';
import { ModalRouter } from './modals';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { TimelineView } from './views/TimelineView';
import s from './App.module.css';

export function App() {
  const activeView = useFlowStore((st) => st.activeView);
  const isLoading = useFlowStore((st) => st.isLoading);
  const error = useFlowStore((st) => st.error);
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
    <div className={s.app}>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className={s.main}>
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className={s.content}>
          {activeView === 'board' ? <BoardView /> : activeView === 'calendar' ? <CalendarView /> : <TimelineView />}
        </main>
      </div>
      <ModalRouter />
      <ToastContainer />
    </div>
  );
}
