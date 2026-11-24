/* generated from app-platform/ui-kit — edit there and re-sync. */
import { HUB_URL } from './constants';

/**
 * The Android (and future iOS) wrappers load the live site in a WebView and append this token to the
 * user agent, e.g. "… Chrome/140 Mobile Safari/537.36 MohitGoenkaApp/Android".
 */
export const NATIVE_UA_TOKEN = 'MohitGoenkaApp/';

/** True inside Mohit's native app wrappers (user agent contains "MohitGoenkaApp/"). Never throws; false during SSR. */
export function isNativeApp(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.includes(NATIVE_UA_TOKEN);
  } catch {
    return false;
  }
}

/** 'android' / 'ios' inside a wrapper (from "MohitGoenkaApp/<Platform>"), otherwise null. */
export function nativePlatform(): 'android' | 'ios' | null {
  if (!isNativeApp()) return null;
  const m = /MohitGoenkaApp\/([A-Za-z]+)/.exec(navigator.userAgent);
  const p = m?.[1]?.toLowerCase();
  return p === 'ios' ? 'ios' : 'android';
}

/**
 * Leave the app for the "Apps and Games" hub — on the web only. Inside the native app (one app per store
 * listing) there is no hub to go back to, so this does nothing and returns false.
 */
export function goToHub(options: { newTab?: boolean } = {}): boolean {
  if (isNativeApp() || typeof window === 'undefined') return false;
  if (options.newTab) window.open(HUB_URL, '_blank', 'noopener,noreferrer');
  else window.location.href = HUB_URL;
  return true;
}

// ---------------------------------------------------------------- TV and big screens

const TV_UA_RE = /Chromecast|\bAFT|GoogleTV|Google TV|Android TV|AndroidTV|BRAVIA|SMART-TV|SmartTV/i;

/**
 * True on a TV: Android TV / Google TV / Fire TV (AFT…) / Chromecast user agents, or the Android wrapper's TV
 * shim (window.__mgTv). Never throws; false during SSR.
 */
export function isTvDevice(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if ((window as unknown as { __mgTv?: unknown }).__mgTv) return true;
    return typeof navigator !== 'undefined' && TV_UA_RE.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/**
 * Sets <html class="mg-tv"> on TVs (theme.css then scales the root font to 150% and widens --mg-content-max).
 * Runs once when the kit loads; call again if the bridge appears late. Returns isTvDevice().
 */
export function applyTvClass(): boolean {
  const tv = isTvDevice();
  try {
    if (tv && typeof document !== 'undefined') document.documentElement.classList.add('mg-tv');
  } catch {
    /* ignore */
  }
  return tv;
}
applyTvClass();

/** Fields whose value the D-pad's Up/Down would change: on a TV those keys should move focus instead. */
const DPAD_FIELD_TYPES = /^(number|date|time|datetime-local|month|week|range)$/i;
const isDpadField = (el: Element | null): el is HTMLInputElement | HTMLSelectElement =>
  !!el && ((el.tagName === 'INPUT' && DPAD_FIELD_TYPES.test((el as HTMLInputElement).type)) || (el.tagName === 'SELECT' && (el as HTMLSelectElement).size <= 1));
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

function moveFocus(from: Element, dir: 1 | -1): boolean {
  const scope = from.closest('[role=dialog],[aria-modal=true],dialog[open]') ?? document.body;
  const list = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && !el.closest('[inert],[hidden],[aria-hidden=true]');
  });
  const i = list.indexOf(from as HTMLElement);
  const next = i < 0 ? null : list[i + dir];
  if (!next) return false;
  next.focus();
  try {
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch {
    /* ignore */
  }
  return true;
}

let dpadCleanup: (() => void) | null = null;
/**
 * D-pad in form fields, on TVs only (no-op elsewhere; idempotent; returns an uninstall function).
 * Up/Down on a number / date / time / range input or a select moves to the previous / next control instead of
 * changing the value. Enter starts editing it (then the arrows change the value) until Enter, Escape or leaving
 * the field. With the Android wrapper's TV shim (window.__mgTv) the shim keeps doing spatial navigation; this
 * only lets arrows through to a field being edited. Runs as a window bubble listener after the page's own
 * handlers (a key the page handled, defaultPrevented, is left alone) and before the shim's decision, which it
 * skips with stopImmediatePropagation.
 */
export function installDpadNav(): () => void {
  if (dpadCleanup) return dpadCleanup;
  if (typeof document === 'undefined' || !isTvDevice()) return () => {};
  const shim = !!(window as unknown as { __mgTv?: unknown }).__mgTv;
  let editing: Element | null = null;
  let enterAt = 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = document.activeElement;
    if (e.key === 'Enter') {
      if (isDpadField(t)) {
        editing = editing === t ? null : t;
        if (t.tagName === 'INPUT') e.preventDefault(); // Enter would submit the form
        e.stopImmediatePropagation();
      } else enterAt = Date.now(); // the shim may focus a field on this Enter: edit it then
      return;
    }
    if (e.key === 'Escape' && editing && editing === t) {
      editing = null;
      e.stopImmediatePropagation();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!isDpadField(t)) return;
    if (editing === t) {
      e.stopImmediatePropagation(); // the field changes its value; the shim must not move focus
      return;
    }
    if (shim) return; // the shim moves focus (and prevents the value change)
    e.preventDefault();
    moveFocus(t, e.key === 'ArrowDown' ? 1 : -1);
  };
  const onFocusIn = (e: FocusEvent) => {
    if (e.target !== editing) editing = null;
    if (isDpadField(e.target as Element) && Date.now() - enterAt < 400) editing = e.target as Element;
  };
  window.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn, true);
  dpadCleanup = () => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn, true);
    dpadCleanup = null;
  };
  return dpadCleanup;
}
// On TVs the kit installs it by itself (no-op everywhere else); apps may call it again safely.
if (typeof window !== 'undefined') installDpadNav();
