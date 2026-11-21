/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { CSSProperties } from 'react';
import { cx } from '../utils/cx';

export interface SkeletonProps {
  className?: string;
  /** Tailwind classes control size: e.g. "h-6 w-32". Or pass width/height. */
  width?: number | string;
  height?: number | string;
  /** Default 'md' (rounded-mg). */
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  style?: CSSProperties;
}

const R = { sm: 'rounded-mg-sm', md: 'rounded-mg', lg: 'rounded-mg-lg', full: 'rounded-full' } as const;

/** Shimmering placeholder block. Reserve the final size to avoid layout shift. */
export function Skeleton({ className, width, height, rounded = 'md', style }: SkeletonProps) {
  const s: CSSProperties = { ...style };
  if (width !== undefined) s.width = width;
  if (height !== undefined) s.height = height;
  return <span aria-hidden="true" className={cx('mg-skeleton block', R[rounded], height === undefined && !className?.includes('h-') ? 'h-4' : '', className)} style={s} />;
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** A few lines of text placeholder; last line shorter. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span role="status" aria-label="Loading" className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} rounded="sm" />
      ))}
    </span>
  );
}
