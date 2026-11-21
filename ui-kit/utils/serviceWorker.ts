/* generated from app-platform/ui-kit — edit there and re-sync. */
/// <reference types="vite/client" />
import { dismissToast, showToast } from './toastBus';

export interface RegisterServiceWorkerOptions {
  /** Default '/sw.js'. */
  url?: string;
  scope?: string;
  /** Default: only on https (or localhost) production builds. Pass true to force (e.g. smoke tests). */
  enabled?: boolean;
  /** Called when a new version is waiting. Return false to suppress the default toast. */
  onUpdate?: (registration: ServiceWorkerRegistration, applyUpdate: () => void) => void | boolean;
  /** Toast text. */
  message?: string;
  /** How often to check for a new version while the tab is open. Default 30 min; 0 disables. */
  checkIntervalMs?: number;
}

let reloading = false;

/**
 * Registers the service worker and shows a sticky "Update available — Reload" toast when a new
 * version is waiting. Clicking Reload activates the waiting worker (SKIP_WAITING) and reloads once.
 */
export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): Promise<ServiceWorkerRegistration | null> {
  const { url = '/sw.js', scope, onUpdate, message = 'Update available', checkIntervalMs = 30 * 60_000 } = options;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const enabled = options.enabled ?? (import.meta.env.PROD && (location.protocol === 'https:' || isLocal));
  if (!enabled) return Promise.resolve(null);

  const announce = (reg: ServiceWorkerRegistration) => {
    const waiting = reg.waiting;
    if (!waiting) return;
    const apply = () => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      }, { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
      // Fallback if controllerchange never fires (e.g. worker already active).
      setTimeout(() => { if (!reloading) { reloading = true; window.location.reload(); } }, 3000);
    };
    const custom = onUpdate?.(reg, apply);
    if (custom === false) return;
    showToast({
      id: 'mg-sw-update',
      message,
      tone: 'info',
      duration: 0,
      action: { label: 'Reload', onClick: () => { dismissToast('mg-sw-update'); apply(); } },
    });
  };

  const register = async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      const reg = await navigator.serviceWorker.register(url, scope ? { scope } : undefined);
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) announce(reg);
        });
      });
      const check = () => { reg.update().catch(() => { /* offline */ }); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      if (checkIntervalMs > 0) setInterval(check, checkIntervalMs);
      return reg;
    } catch {
      return null;
    }
  };

  if (document.readyState === 'complete') return register();
  return new Promise((resolve) => {
    window.addEventListener('load', () => { void register().then(resolve); }, { once: true });
  });
}
