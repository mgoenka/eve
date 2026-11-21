/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useId } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** A full-row toggle (whole row is the 44px+ tap target). role="switch". */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id + '-l'}
      aria-describedby={description ? id + '-d' : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('flex min-h-12 w-full items-center justify-between gap-4 rounded-mg px-3 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-50', className)}
    >
      <span className="min-w-0">
        <span id={id + '-l'} className="block text-sm font-medium text-mg-text">{label}</span>
        {description ? <span id={id + '-d'} className="mt-0.5 block text-xs text-mg-muted">{description}</span> : null}
      </span>
      <span aria-hidden="true" className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors', checked ? 'border-mg-gold bg-mg-gold' : 'border-mg-border-strong bg-mg-surface-3')}>
        <span className={cx('inline-block h-5 w-5 rounded-full shadow transition-transform', checked ? 'translate-x-5 bg-mg-on-gold' : 'translate-x-0.5 bg-mg-muted')} />
      </span>
    </button>
  );
}
