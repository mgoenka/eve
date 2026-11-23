/* generated from app-platform/ui-kit — edit there and re-sync. */
import { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import type { ShareSheetProps } from './ShareSheet';

const ShareSheetImpl = lazyWithRetry(() => import('./ShareSheet'));

/** ShareSheet with the card renderer + QR encoder split into their own chunk; renders nothing until opened. */
export function LazyShareSheet(props: ShareSheetProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <ShareSheetImpl {...props} />
    </Suspense>
  );
}
