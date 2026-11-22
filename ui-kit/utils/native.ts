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
