import React from 'react';
import { useFlowStore } from '../store/useFlowStore';

export function ToastContainer() {
  const toasts = useFlowStore((s) => s.toasts);
  return (
    <div
      id="toast-container"
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-[9000] pointer-events-none max-sm:bottom-4 max-sm:left-4 max-sm:right-4 max-sm:translate-x-0"
    >
      {toasts.map((t) => (
        <div key={t.id} className="toast bg-[var(--surface)] border border-[var(--border2)] rounded-lg px-3.5 py-2 flex items-center gap-2 text-xs shadow-[var(--shadow)] whitespace-nowrap max-sm:whitespace-normal">
          <span className="text-sm">{t.icon}</span>
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
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-2 p-10">
          <div className="text-4xl opacity-40">⚠</div>
          <div className="text-[15px] font-semibold text-[var(--text2)] font-[var(--font-display)]">Something went wrong</div>
          <div className="text-xs text-[var(--text3)] text-center font-[var(--font-mono)] max-w-xl">{this.state.error?.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
