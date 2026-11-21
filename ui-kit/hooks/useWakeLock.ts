/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef, useState } from 'react';

/**
 * Keeps the screen awake while `enabled` is true (host / TV screens during a game).
 * Re-acquires after the tab becomes visible again. Silently no-ops where unsupported.
 */
export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false);
  const sentinel = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel.current) return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel.current = s;
        setActive(true);
        s.addEventListener('release', () => {
          sentinel.current = null;
          setActive(false);
        });
      } catch {
        setActive(false);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      const s = sentinel.current;
      sentinel.current = null;
      if (s) void s.release().catch(() => {});
      setActive(false);
    };
  }, [enabled, supported]);

  return { supported, active };
}
