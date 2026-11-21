/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { useOnline } from '../hooks/useOnline';
import { cx } from '../utils/cx';
import { WifiOffIcon } from './icons';

export interface OfflineBannerProps {
  /** Default: "You're offline — some features won't work until you reconnect." */
  message?: ReactNode;
  /** Default 'bottom'. */
  position?: 'top' | 'bottom';
  className?: string;
}

/** Shows only while navigator.onLine is false. */
export function OfflineBanner({ message = "You're offline — some features won't work until you reconnect.", position = 'bottom', className }: OfflineBannerProps) {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className={cx(
        'fixed inset-x-0 z-[350] flex justify-center px-3',
        position === 'top' ? 'top-[max(0.5rem,env(safe-area-inset-top))]' : 'bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.25rem))]',
        className,
      )}
    >
      <div className="flex max-w-md items-center gap-2 rounded-mg border border-mg-warning/40 bg-mg-elevated/95 px-3 py-2 text-xs font-medium text-amber-300 shadow-mg-card backdrop-blur-md sm:text-sm">
        <WifiOffIcon size={16} className="shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}

/** The small "Offline" pill used in headers. */
export function OfflinePill({ className }: { className?: string }) {
  return (
    <span className={cx('whitespace-nowrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400 sm:px-2 sm:text-[10px]', className)}>
      Offline
    </span>
  );
}
