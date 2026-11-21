/* generated from app-platform/ui-kit — edit there and re-sync. */
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { safeGet, safeRemove, safeSet } from './storage';

const RELOAD_KEY = 'mg:chunk-reload-at';
const LOOP_GUARD_MS = 30_000;

/** True for the errors browsers throw when a hashed chunk vanished after a deploy. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message + ' ' + e.name : String(e);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload CSS|Load failed/i.test(msg);
}

/**
 * Reload the page once to pick up the new deploy. Returns false (and does nothing) if we already
 * reloaded in the last 30 s — so a genuinely broken chunk can't cause a reload loop.
 */
export function reloadOnceForNewVersion(): boolean {
  const last = Number(safeGet(RELOAD_KEY, 'session') ?? '0');
  if (Date.now() - last < LOOP_GUARD_MS) return false;
  safeSet(RELOAD_KEY, String(Date.now()), 'session');
  window.location.reload();
  return true;
}

/** Wrap a dynamic import: on chunk-load failure, reload once (loop-guarded); otherwise rethrow. */
export function importWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  return factory().then(
    (mod) => {
      safeRemove(RELOAD_KEY, 'session');
      return mod;
    },
    (err: unknown) => {
      if (isChunkLoadError(err) && reloadOnceForNewVersion()) {
        return new Promise<T>(() => { /* page is reloading */ });
      }
      throw err;
    },
  );
}

/**
 * React.lazy that survives deploys: `const Rules = lazyWithRetry(() => import('./Rules'))`.
 * Wrap the usage in <Suspense fallback={...}>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(factory));
}
