import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { cx } from '../utils';
import s from './Menu.module.css';

/** Popover anchored to an element. Closes on outside click, Escape, scroll or resize. */
export function Menu({ anchor, onClose, children, align = 'end' }: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(align === 'end' ? a.right - m.width : a.left, innerWidth - m.width - 8));
    let top = a.bottom + 6;
    if (top + m.height > innerHeight - 8) top = Math.max(8, a.top - m.height - 6);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, visibility: 'visible' });
    el.querySelector<HTMLElement>('button, input')?.focus();
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor.focus();
    };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div ref={ref} className={s.menu} role="menu" onKeyDown={onKeyDown}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: IconName; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" className={cx(s.item, danger && s.danger)} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export const MenuSeparator = () => <div className={s.separator} role="separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className={s.label}>{children}</div>;
