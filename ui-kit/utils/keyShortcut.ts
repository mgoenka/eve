/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Single-key shortcuts (Space = next ball, N = new round…) that are safe to hold down: key repeats are ignored,
 * presses closer than `minGapMs` are dropped, and typing in a field, IME composition or a Ctrl/⌘/Alt chord never
 * fires them. A held Space used to call the handler ~30 times a second, and each call set state (Bingo's host hit
 * React error #185, "Maximum update depth exceeded"). React: useKeyShortcut (hooks/useKeyShortcut.ts).
 */
export interface KeyShortcutOptions {
  /** Least time between two calls (ms). Default 250. */
  minGapMs?: number;
  /** Off while false (e.g. only on the host screen, or while a dialog is open). Default true. */
  enabled?: boolean;
  /** Also fire while focus is in an input, textarea, select or editable element. Default false. */
  allowInInputs?: boolean;
  /** Call preventDefault() on a handled press (stops Space scrolling the page or clicking the focused button). Default true. */
  preventDefault?: boolean;
  /** Clock (tests). */
  now?: () => number;
}

/** Keys as written: 'n', 'N', ' ', 'Space', 'Enter', 'ArrowRight'… Letters match either case; Space by key or code. */
export type ShortcutKey = string | readonly string[];

const norm = (k: string) => (k === 'Space' || k === 'Spacebar' ? ' ' : k.length === 1 ? k.toLowerCase() : k);

function inField(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * A keydown listener for `key`: returns true when it called `handler`. Use it directly with addEventListener, or
 * through useKeyShortcut in React.
 */
export function createKeyShortcut(key: ShortcutKey, handler: (e: KeyboardEvent) => void, opts: KeyShortcutOptions = {}) {
  const keys = new Set((typeof key === 'string' ? [key] : [...key]).map(norm));
  const gap = Math.max(0, opts.minGapMs ?? 250);
  const now = opts.now ?? Date.now;
  let last = -Infinity;
  return (e: KeyboardEvent): boolean => {
    if (opts.enabled === false || e.defaultPrevented) return false;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = norm(e.key ?? '');
    if (!keys.has(k) && !(keys.has(' ') && e.code === 'Space')) return false;
    if (!opts.allowInInputs && inField(e.target)) return false;
    // Ours, even when dropped below: a held Space must not scroll the page or re-press the focused button.
    if (opts.preventDefault !== false) e.preventDefault();
    if (e.repeat) return false;
    const t = now();
    if (t - last < gap) return false;
    last = t;
    handler(e);
    return true;
  };
}
