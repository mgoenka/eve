/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../utils/cx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required: what the button does, for screen readers (also used as the tooltip unless title is set). */
  'aria-label': string;
  /** The icon (an svg, or an emoji). */
  children: ReactNode;
  /** header = the dark square buttons in AppHeader; ghost = no chrome; gold = gold-outlined. Default header. */
  variant?: 'header' | 'ghost' | 'gold';
  /** sm 36px / md 40px (both have a 44px hit area) / lg 48px. Default md. */
  size?: 'sm' | 'md' | 'lg';
  /** Toggle buttons: pass true/false to expose aria-pressed. */
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const variants = {
  header: 'bg-mg-surface border border-mg-border text-mg-muted hover:bg-mg-surface-2 hover:text-mg-text',
  ghost: 'bg-transparent border border-transparent text-mg-muted hover:text-mg-text hover:bg-white/5',
  gold: 'bg-mg-surface border border-mg-gold/30 text-mg-gold hover:bg-mg-gold/10 hover:border-mg-gold/50',
} as const;

const sizes = {
  sm: 'h-9 w-9 rounded-mg before:absolute before:-inset-1 before:content-[""]',
  md: 'h-10 w-10 rounded-mg before:absolute before:-inset-0.5 before:content-[""]',
  lg: 'h-12 w-12 rounded-mg-lg',
} as const;

/** Square icon-only button. aria-label is required by the type. */
export function IconButton({ variant = 'header', size = 'md', pressed, className, title, type = 'button', ref, children, ...rest }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      title={title ?? rest['aria-label']}
      aria-pressed={pressed}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mg-gold',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
