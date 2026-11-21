/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../utils/cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = solid gold; secondary = dark surface; outline = gold outline on dark; ghost = text only; danger = rose. */
  variant?: ButtonVariant;
  /** sm 36px visual (44px hit area), md 44px, lg 52px. */
  size?: ButtonSize;
  /** Shows a spinner, disables the button, keeps its width. */
  loading?: boolean;
  /** Optional text for screen readers while loading. */
  loadingText?: string;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const base =
  'relative inline-flex items-center justify-center gap-2 select-none whitespace-nowrap font-semibold transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mg-gold';

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-mg-gold text-mg-on-gold hover:bg-mg-gold-hover border border-transparent',
  secondary: 'bg-mg-surface text-mg-text border border-mg-border hover:bg-mg-surface-2 hover:border-mg-border-strong',
  outline: 'bg-mg-surface text-mg-gold border border-mg-gold/30 hover:bg-mg-gold/10 hover:border-mg-gold/50',
  ghost: 'bg-transparent text-mg-muted border border-transparent hover:text-mg-text hover:bg-white/5',
  danger: 'bg-mg-danger/15 text-rose-300 border border-mg-danger/40 hover:bg-mg-danger/25 hover:text-rose-200',
};

export const buttonSizes: Record<ButtonSize, string> = {
  // sm: visual 36px; ::before extends the hit area to 44px.
  sm: 'h-9 px-3 text-sm rounded-mg before:absolute before:-inset-x-0 before:-inset-y-1 before:content-[""]',
  md: 'min-h-11 px-4 py-2.5 text-sm md:text-base rounded-mg',
  lg: 'min-h-13 px-6 py-3 text-base md:text-lg rounded-mg-lg',
};

/** The kit's button. Defaults: variant="primary", size="md", type="button". */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  fullWidth,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, buttonVariants[variant], buttonSizes[size], fullWidth && 'w-full', loading && 'disabled:opacity-100', className)}
      {...rest}
    >
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size === 'lg' ? 22 : 18} label={loadingText ?? 'Loading'} className={variant === 'primary' ? '[&_svg]:text-mg-on-gold' : ''} />
        </span>
      ) : null}
      <span className={cx('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
        {leftIcon ? <span className="inline-flex shrink-0" aria-hidden="true">{leftIcon}</span> : null}
        {children}
        {rightIcon ? <span className="inline-flex shrink-0" aria-hidden="true">{rightIcon}</span> : null}
      </span>
    </button>
  );
}
