import { useState, type SyntheticEvent } from 'react';

/**
 * Autofocused text input for inline renaming. Enter/blur commits, Escape cancels.
 * Stops pointer/key events so a surrounding drag handle doesn't start a drag while typing.
 */
export function InlineInput({ value, onCommit, onCancel, className, ariaLabel, placeholder }: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
  ariaLabel: string;
}) {
  const [v, setV] = useState(value);
  const commit = () => (v.trim() && v.trim() !== value ? onCommit(v.trim()) : onCancel());
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <input
      autoFocus
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={className}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}
