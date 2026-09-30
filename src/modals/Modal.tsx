import { useId, type FormEvent, type ReactNode } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Icon } from '../components/Icon';
import { cx } from '../utils';
import s from './Modal.module.css';
import ui from '../components/ui.module.css';

export function Modal({ title, description, size = 'md', footer, bare, onSubmit, ariaLabel, children }: {
  title?: ReactNode;
  ariaLabel?: string;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  /** Render children without the padded body wrapper (for custom layouts). */
  bare?: boolean;
  /** Renders the dialog as a <form> so Enter submits. */
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLElement>(true);
  const Root = onSubmit ? 'form' : 'div';
  const closeModal = useFlowStore((st) => st.closeModal);
  const titleId = useId();
  return (
    <Root
      ref={trapRef as never}
      onSubmit={onSubmit && ((e: FormEvent) => { e.preventDefault(); onSubmit(e); })}
      tabIndex={-1}
      className={cx(s.dialog, s[size])}
      role="dialog"
      aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
    >
      {title && (
        <header className={s.header}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className={ui.iconBtn} onClick={closeModal} aria-label="Close"><Icon name="x" /></button>
        </header>
      )}
      {bare ? children : <div className={s.body}>{children}</div>}
      {footer && <footer className={s.footer}>{footer}</footer>}
    </Root>
  );
}
