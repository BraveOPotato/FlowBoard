import React from 'react';
import { useFlowStore } from '../store/useFlowStore';

export function ToastContainer() {
  const toasts = useFlowStore((s) => s.toasts);
  return (
    <div id="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-icon">{t.icon}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="empty-state" style={{ height: '100vh' }}>
          <div className="empty-state-icon">⚠</div>
          <div className="empty-state-title">Something went wrong</div>
          <div className="empty-state-text" style={{ fontFamily: 'var(--font-mono)', maxWidth: '600px' }}>
            {this.state.error?.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
