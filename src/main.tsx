import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/Shell'
import { App } from './App'
import { useFlowStore } from './store/useFlowStore'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let controlled = !!navigator.serviceWorker.controller;
  let updateReady = false;
  const notifyUpdate = () => useFlowStore.getState().toast('FlowBoard updated. Save any draft, then reload.', '✓', {
    label: 'Reload', run: async () => window.location.reload(),
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) {
      updateReady = true;
      notifyUpdate();
    }
    controlled = true;
  });
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
    const checkUpdate = () => {
      if (document.visibilityState !== 'visible') return;
      if (updateReady) notifyUpdate();
      void registration.update().catch((error) => console.warn('FlowBoard update check failed:', error));
    };
    document.addEventListener('visibilitychange', checkUpdate);
    window.addEventListener('online', checkUpdate);
  }).catch((error) => console.warn('FlowBoard service worker registration failed:', error));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
