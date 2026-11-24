/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export interface GameHeroProps {
  /** Big title, e.g. "Mohit's Bingo". */
  title: ReactNode;
  /** One line under it. */
  subtitle?: ReactNode;
  /** Emoji, logo image node, or null. */
  icon?: ReactNode;
  /** Buttons / setup under the title. */
  children?: ReactNode;
  /** Always compact (small icon, one-line title). Default: compact automatically on short screens (landscape phones, max-height 500px). */
  compact?: boolean;
  /** Heading level of the title. Default 1. */
  level?: 1 | 2;
  className?: string;
}

/** The title block of a start screen. Shrinks on landscape phones (max-height: 500px) so the buttons stay on screen. */
export function GameHero({ title, subtitle, icon, children, compact = false, level = 1, className }: GameHeroProps) {
  const H = level === 1 ? 'h1' : 'h2';
  // Class names are written out in full so Tailwind finds them ([@media(max-height:500px)] = landscape phones).
  return (
    <section className={cx('relative z-[1] mx-auto flex w-full max-w-mg-content flex-col items-center px-4 text-center', compact ? 'gap-2 py-3' : `gap-3 py-8 md:py-12 [@media(max-height:500px)]:gap-2 [@media(max-height:500px)]:py-3`, className)}>
      {icon ? (
        <div aria-hidden="true" className={cx('leading-none', compact ? 'text-4xl' : `text-6xl md:text-7xl [@media(max-height:500px)]:text-4xl`)}>
          {icon}
        </div>
      ) : null}
      <H className={cx('font-header font-extrabold tracking-tight text-mg-text text-balance', compact ? 'text-2xl' : `text-4xl md:text-5xl in-[.mg-tv]:text-6xl [@media(max-height:500px)]:text-2xl`)}>{title}</H>
      {subtitle ? <p className={cx('max-w-prose text-mg-muted text-pretty', compact ? 'text-sm' : `text-base md:text-lg [@media(max-height:500px)]:text-sm`)}>{subtitle}</p> : null}
      {children ? <div className={cx('flex w-full flex-col items-center', compact ? 'mt-1 gap-2' : `mt-3 gap-3 [@media(max-height:500px)]:mt-1 [@media(max-height:500px)]:gap-2`)}>{children}</div> : null}
    </section>
  );
}
