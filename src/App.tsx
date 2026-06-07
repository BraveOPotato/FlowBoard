import React, { useEffect } from 'react';
import { useFlowStore } from './store/useFlowStore';
import { Header } from './components/Header';
import { ToastContainer } from './components/Shell';
import { ModalRouter } from './modals';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { TimelineView } from './views/TimelineView';

export function App() {
  const store = useFlowStore();
  const { activeView, isLoading, error } = store;

  useEffect(() => { store.init(); }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text2)] font-[var(--font-mono)] text-[13px] tracking-wide">
        Loading FlowBoard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2 p-10">
        <div className="text-4xl opacity-40">⚠</div>
        <div className="text-[15px] font-semibold text-[var(--text2)] font-[var(--font-display)]">Failed to initialize</div>
        <div className="text-xs text-[var(--text3)] text-center">{error}</div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <div id="main" className="flex-1 overflow-hidden relative flex flex-col">
        <div className={activeView === 'board' ? 'flex flex-col w-full h-full' : 'hidden'}>
          <BoardView />
        </div>
        <div className={activeView === 'calendar' ? 'flex flex-col w-full h-full' : 'hidden'}>
          <CalendarView />
        </div>
        <div className={activeView === 'timeline' ? 'flex flex-col w-full h-full' : 'hidden'}>
          <TimelineView />
        </div>
      </div>
      <ModalRouter />
      <ToastContainer />
    </>
  );
}
