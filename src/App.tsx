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
  const activeView = store.activeView;
  const isLoading = store.isLoading;
  const error = store.error;

  useEffect(() => {
    store.init();
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text2)',
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          letterSpacing: '0.5px',
        }}
      >
        Loading FlowBoard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ height: '100vh' }}>
        <div className="empty-state-icon">⚠</div>
        <div className="empty-state-title">Failed to initialize</div>
        <div className="empty-state-text">{error}</div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <div id="main">
        <div className={activeView === 'board' ? 'active-view' : 'hidden-view'}>
          <BoardView />
        </div>
        <div className={activeView === 'calendar' ? 'active-view' : 'hidden-view'}>
          <CalendarView />
        </div>
        <div className={activeView === 'timeline' ? 'active-view' : 'hidden-view'}>
          <TimelineView />
        </div>
      </div>
      <ModalRouter />
      <ToastContainer />
    </>
  );
}
