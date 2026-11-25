import { useCallback, useEffect, useRef } from 'react';

/**
 * What is on screen, kept in localStorage so the page comes back exactly where it was after the browser
 * discards a background tab, Android kills the app's WebView, or a deploy forces a one-off reload.
 * Stored as { v, savedAt, data }: a different `v` (an older build), a bad shape or anything older than
 * 12 hours is dropped instead of restored. Never holds images (base64) or secrets.
 */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function readSnapshot<T>(
  key: string,
  v: number,
  isValid: (data: unknown) => data is T,
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; data?: unknown } | null;
    const age = s && typeof s.savedAt === 'number' ? Date.now() - s.savedAt : NaN;
    if (!s || s.v !== v || !(age >= -60_000 && age <= maxAgeMs) || !isValid(s.data)) {
      clearSnapshot(key);
      return null;
    }
    return s.data;
  } catch {
    clearSnapshot(key);
    return null;
  }
}

export function writeSnapshot(key: string, v: number, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v, savedAt: Date.now(), data }));
  } catch {
    /* storage full or blocked: the page just won't come back after a reload */
  }
}

export function clearSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Saves `data` (null clears the snapshot) about 300 ms after it changes, and immediately when the page
 * is hidden or unloaded (`pagehide`, `visibilitychange` to hidden), so nothing typed is lost when the
 * phone switches apps. Pass a memoized value: a new object every render would save every render.
 */
export function useSnapshot<T>(key: string, v: number, data: T | null, delayMs = 300): void {
  const latest = useRef<T | null>(data);
  latest.current = data;
  const dirty = useRef(false);

  const flush = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    if (latest.current == null) clearSnapshot(key);
    else writeSnapshot(key, v, latest.current);
  }, [key, v]);

  useEffect(() => {
    dirty.current = true;
    const t = setTimeout(flush, delayMs);
    return () => clearTimeout(t);
  }, [data, flush, delayMs]);

  useEffect(() => {
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);
}

export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
