/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useCallback, useSyncExternalStore } from 'react';

/** Live result of a CSS media query, e.g. useMediaQuery('(min-width: 768px)'). */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : serverDefault),
    () => serverDefault,
  );
}

/** Tailwind's sm breakpoint is 640px; below it the kit treats the device as a phone. */
export function useIsPhone(): boolean {
  return !useMediaQuery('(min-width: 640px)', true);
}
