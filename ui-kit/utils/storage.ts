/* generated from app-platform/ui-kit — edit there and re-sync. */
/** localStorage / sessionStorage access that never throws (private mode, quota, disabled storage). */
export function safeGet(key: string, store: 'local' | 'session' = 'local'): string | null {
  try {
    return (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
export function safeSet(key: string, value: string, store: 'local' | 'session' = 'local'): boolean {
  try {
    (store === 'local' ? window.localStorage : window.sessionStorage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export function safeRemove(key: string, store: 'local' | 'session' = 'local'): void {
  try {
    (store === 'local' ? window.localStorage : window.sessionStorage).removeItem(key);
  } catch {
    /* ignore */
  }
}
export function readJson<T>(key: string, fallback: T, store: 'local' | 'session' = 'local'): T {
  const raw = safeGet(key, store);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
