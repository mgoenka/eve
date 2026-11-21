/* generated from app-platform/ui-kit — edit there and re-sync. */
import { cx } from '../utils/cx';

export interface SpinnerProps {
  /** px, default 20 */
  size?: number;
  className?: string;
  /** Screen-reader text. Default "Loading". Pass '' when a visible label is next to it. */
  label?: string;
}

/** Gold ring spinner (inherits currentColor for the arc if you set a text color). */
export function Spinner({ size = 20, className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className={cx('inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-mg-gold motion-reduce:animate-[spin_1.5s_linear_infinite]" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export interface LoadingDotsProps {
  className?: string;
  /** Optional visible text before the dots, e.g. "Generating board". */
  text?: string;
  /** dot color utility, default bg-mg-gold */
  dotClassName?: string;
}

/** The three bouncing gold dots the apps already use while AI is thinking. */
export function LoadingDots({ className, text, dotClassName = 'bg-mg-gold' }: LoadingDotsProps) {
  return (
    <span role="status" aria-live="polite" className={cx('inline-flex items-center gap-2 text-sm text-mg-muted', className)}>
      {text ? <span>{text}</span> : <span className="sr-only">Loading</span>}
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className={cx('h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:-0.3s]', dotClassName)} />
        <span className={cx('h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:-0.15s]', dotClassName)} />
        <span className={cx('h-1.5 w-1.5 rounded-full animate-bounce', dotClassName)} />
      </span>
    </span>
  );
}
