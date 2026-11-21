/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { safeGet, safeRemove, safeSet } from '../utils/storage';

export interface UseLocalStorageOptions<T> {
  /** Bump when the stored shape changes; old versions are ignored (and removed). Default 1. */
  version?: number;
  /** Optional guard: return false to discard a stored value that doesn't look right. */
  validate?: (value: unknown) => value is T;
}

/**
 * useState persisted to localStorage under `${key}:v${version}`. Never throws (private mode, quota),
 * syncs across tabs. Returns [value, setValue, clear].
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T),
  options: UseLocalStorageOptions<T> = {},
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const version = options.version ?? 1;
  const fullKey = key + ':v' + version;
  const validateRef = useRef(options.validate);
  validateRef.current = options.validate;

  const read = useCallback((): T => {
    const fallback = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    const raw = safeGet(fullKey);
    if (raw == null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      const v = validateRef.current;
      if (v && !v(parsed)) return fallback;
      return parsed as T;
    } catch {
      return fallback;
    }
    // initialValue intentionally not a dependency (like useState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  const [value, setValue] = useState<T>(read);

  // Re-read if the key changes.
  const keyRef = useRef(fullKey);
  useEffect(() => {
    if (keyRef.current !== fullKey) {
      keyRef.current = fullKey;
      setValue(read());
    }
  }, [fullKey, read]);

  // Remove older versions once.
  useEffect(() => {
    for (let v = 0; v < version; v++) safeRemove(key + ':v' + v);
    if (version > 1) safeRemove(key);
  }, [key, version]);

  // Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === fullKey) setValue(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [fullKey, read]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          safeSet(fullKey, JSON.stringify(resolved));
        } catch {
          /* unserialisable — keep in memory only */
        }
        return resolved;
      });
    },
    [fullKey],
  );

  const clear = useCallback(() => {
    safeRemove(fullKey);
    setValue(typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  return [value, set, clear];
}
