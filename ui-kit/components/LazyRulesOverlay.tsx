/* generated from app-platform/ui-kit — edit there and re-sync. */
import { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import type { RulesOverlayProps } from './RulesOverlay';

const RulesOverlayImpl = lazyWithRetry(() => import('./RulesOverlay').then((m) => ({ default: m.RulesOverlay })));

/**
 * The rules overlay in its own chunk (loaded the first time it opens). Same props as RulesOverlay; the kit index
 * exports it under both names, so `import { RulesOverlay } from './ui-kit'` is lazy too and nothing in the index
 * pulls components/RulesOverlay into the main bundle.
 */
export function LazyRulesOverlay(props: RulesOverlayProps) {
  if (props.open === false) return null;
  return (
    <Suspense fallback={null}>
      <RulesOverlayImpl {...props} />
    </Suspense>
  );
}
