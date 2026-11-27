/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef } from 'react';
import { createKeyShortcut } from '../utils/keyShortcut';
import type { KeyShortcutOptions, ShortcutKey } from '../utils/keyShortcut';

/**
 * A single-key shortcut on window: ignores key repeats (holding the key), presses closer than `minGapMs` (250),
 * typing in fields and Ctrl/⌘/Alt chords. The latest `handler` is always used, so an inline arrow is fine (the
 * listener is not re-attached every render).
 *
 *   useKeyShortcut([' ', 'n'], () => drawNext(), { enabled: isHost && !showRules });
 */
export function useKeyShortcut(key: ShortcutKey, handler: (e: KeyboardEvent) => void, opts: KeyShortcutOptions = {}): void {
  const latest = useRef(handler);
  latest.current = handler;
  const keyId = typeof key === 'string' ? key : key.join('\u0000');
  const { minGapMs, enabled = true, allowInInputs, preventDefault } = opts;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = createKeyShortcut(keyId.split('\u0000'), (e) => latest.current(e), {
      ...(minGapMs !== undefined ? { minGapMs } : {}),
      ...(allowInInputs !== undefined ? { allowInInputs } : {}),
      ...(preventDefault !== undefined ? { preventDefault } : {}),
    });
    const listener = (e: KeyboardEvent) => void onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [keyId, enabled, minGapMs, allowInInputs, preventDefault]);
}
