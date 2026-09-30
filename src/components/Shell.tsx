import { Component, type ReactNode } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { Icon, type IconName } from './Icon';
import { cx } from '../utils';
import s from './Shell.module.css';

// The store's toast() takes a legacy emoji "icon"; map it to an icon + tone.
const TOAST_KIND: Record<string, { icon: IconName; tone: string }> = {
  '⚠': { icon: 'alert', tone: s.warning },
  '🗑': { icon: 'trash', tone: s.neutral },
};

export function ToastContainer() {
  const toasts = useFlowStore((st) => st.toasts);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      {toasts.map((t) => {
        const kind = TOAST_KIND[t.icon] ?? { icon: 'check', tone: s.success };
        return (
          <div key={t.id} className={s.toast}>
            <span className={cx(s.toastIcon, kind.tone)}><Icon name={kind.icon} size={14} strokeWidth={2.2} /></span>
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FullPageMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={s.fullPage}>
      <span className={s.fullPageIcon}><Icon name="alert" size={22} /></span>
      <h1>{title}</h1>
      {detail && <code>{detail}</code>}
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <FullPageMessage title="Something went wrong" detail={this.state.error.message} />;
    return this.props.children;
  }
}
