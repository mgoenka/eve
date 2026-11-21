/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export interface EmptyStateProps {
  /** Emoji or icon node. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a <Button>. */
  action?: ReactNode;
  className?: string;
  /** Smaller padding for inline use. */
  compact?: boolean;
}

/** "Nothing here yet" block with an optional call to action. */
export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12', className)}>
      {icon ? (
        <div className={cx('flex items-center justify-center rounded-full border-2 border-mg-gold/40 bg-mg-gold/15 text-mg-gold', compact ? 'h-10 w-10 text-lg' : 'h-14 w-14 text-2xl')} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className={cx('font-display font-extrabold text-mg-text', compact ? 'text-base' : 'text-lg')}>{title}</h3>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-mg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
