/* generated from app-platform/ui-kit — edit there and re-sync. */
// Google Play credits provider (Android app only): window.MGNative from the wrapper's native-shell.js,
// backed by Play Billing in NativeShell.java. Purchase tokens go to the app's server, which verifies,
// credits and consumes them (server-kit/credits verifyPlay).
import { fetchJson, FetchError } from './fetchJson';
import { isNativeApp } from './native';
import { showToast } from './toastBus';
import type { CreditsProvider, CreditsProviderEvents } from './credits';

export const APP_USER_HEADER = 'X-MG-App-User';
export const CREDITS_PURCHASE_URL = '/api/credits/purchase';

export interface NativeProduct {
  id: string;
  title: string;
  /** Localized, e.g. "$0.99", "₹89.00", "0,99 €". */
  price: string;
  priceMicros: number;
  currency: string;
}
export interface NativePurchase {
  /** purchased / pending carry productId + purchaseToken; canceled / failed (the Play sheet closed) carry `error`. */
  state: 'purchased' | 'pending' | 'canceled' | 'failed';
  productId: string;
  purchaseToken: string;
  orderId?: string;
  error?: string;
}
export interface NativeBilling {
  getProducts(ids: string[]): Promise<{ ok: boolean; products: NativeProduct[]; error?: string }>;
  /** Opens Google Play's purchase sheet. The outcome arrives through onPurchase. */
  purchase(productId: string): Promise<{ ok: boolean; error?: string }>;
  /** Purchases Play still holds unconsumed (e.g. the app died mid-purchase). */
  restore(): Promise<{ ok: boolean; purchases: NativePurchase[]; error?: string }>;
  /** The server has credited (or rejected) this purchase: stop re-delivering it this session. */
  finish(purchaseToken: string): void;
  onPurchase(cb: (p: NativePurchase) => void): () => void;
}
export interface NativeBridge {
  version: number;
  getAppUserId(): string | null;
  billing?: NativeBilling;
}
declare global {
  interface Window {
    MGNative?: NativeBridge;
  }
}

export function nativeBridge(): NativeBridge | null {
  try {
    return typeof window !== 'undefined' && isNativeApp() && window.MGNative ? window.MGNative : null;
  } catch {
    return null;
  }
}

let cachedId: string | null = null;
/** The app's random 128-bit id (32 hex chars), from the Android shell. null on the web / old app builds. */
export function getAppUserId(): string | null {
  if (cachedId) return cachedId;
  try {
    const raw = nativeBridge()?.getAppUserId();
    if (typeof raw === 'string' && /^[0-9a-f]{32}$/.test(raw)) cachedId = raw;
  } catch {
    /* bridge not ready */
  }
  return cachedId;
}

const appUserHeaders = (): Record<string, string> => {
  const id = getAppUserId();
  return id ? { [APP_USER_HEADER]: id } : {};
};

const inFlight = new Set<string>();

async function redeem(p: NativePurchase, ev: CreditsProviderEvents): Promise<void> {
  const billing = nativeBridge()?.billing;
  if (!billing || !p) return;
  if (p.state === 'canceled' || p.state === 'failed') {
    ev.done();
    if (p.state === 'failed') showToast({ id: 'mg-credits-error', tone: 'error', message: 'The purchase didn’t go through. You weren’t charged.' });
    return;
  }
  if (!p.purchaseToken || inFlight.has(p.purchaseToken)) return;
  if (p.state === 'pending') {
    ev.pending();
    showToast({ id: 'mg-credits-pending', tone: 'info', message: 'Payment pending — your credits are added as soon as Google Play confirms it.' });
    return;
  }
  if (p.state !== 'purchased') return;
  inFlight.add(p.purchaseToken);
  try {
    const r = await fetchJson<{ ok?: boolean; error?: string; credited?: number; balance?: number }>(CREDITS_PURCHASE_URL, {
      method: 'POST',
      headers: appUserHeaders(),
      body: { productId: p.productId, purchaseToken: p.purchaseToken },
      timeoutMs: 20000,
      retries: 2,
    });
    if (!r?.ok) {
      // 202 purchase_pending: Google hasn't confirmed the payment yet; keep it for the next restore.
      ev.pending();
      return;
    }
    billing.finish(p.purchaseToken);
    ev.credited({ credited: r.credited ?? 0, ...(typeof r.balance === 'number' ? { balance: r.balance } : {}) });
  } catch (e) {
    ev.done();
    const status = e instanceof FetchError ? e.status : 0;
    if (status === 400 || status === 403 || status === 409) {
      // Terminal for this purchase; Play keeps it unconsumed, so Mohit can refund it from Play Console.
      billing.finish(p.purchaseToken);
      showToast({ id: 'mg-credits-error', tone: 'error', duration: 0, message: 'We couldn’t add credits for this purchase. Please contact mohit@mohitgoenka.com — you won’t be charged twice.' });
    } else {
      showToast({ id: 'mg-credits-error', tone: 'warning', message: 'Payment received — we’ll add your credits as soon as the connection is back.' });
    }
  } finally {
    inFlight.delete(p.purchaseToken);
  }
}

let events: CreditsProviderEvents | null = null;

async function restore(): Promise<void> {
  const billing = nativeBridge()?.billing;
  if (!billing || !events) return;
  try {
    const r = await billing.restore();
    for (const p of r?.purchases ?? []) await redeem(p, events);
  } catch {
    /* billing unavailable */
  }
}

/** Play Billing via the Android wrapper. The only provider ever used inside the app. */
export const playCreditsProvider: CreditsProvider = {
  id: 'play',
  enabled: () => isNativeApp() && getAppUserId() !== null,
  headers: appUserHeaders,
  async loadPrices(packIds) {
    const billing = nativeBridge()?.billing;
    if (!billing) return { ok: false, prices: {} };
    try {
      const r = await billing.getProducts(packIds);
      const prices: Record<string, string> = {};
      for (const p of r?.products ?? []) if (p && typeof p.id === 'string' && typeof p.price === 'string') prices[p.id] = p.price;
      return { ok: !!r?.ok && Object.keys(prices).length > 0, prices };
    } catch {
      return { ok: false, prices: {} };
    }
  },
  async purchase(packId) {
    const billing = nativeBridge()?.billing;
    if (!billing) {
      events?.done();
      showToast({ tone: 'error', message: 'Purchases are unavailable on this device right now.' });
      return;
    }
    try {
      const r = await billing.purchase(packId);
      if (!r?.ok) {
        events?.done();
        if (r?.error === 'item_already_owned') void restore();
        else if (r?.error !== 'user_canceled') showToast({ tone: 'error', message: r?.error === 'unavailable' ? 'Purchases are unavailable on this device right now.' : 'Couldn’t start the purchase. Please try again.' });
      }
      // On ok the outcome arrives through onPurchase.
    } catch {
      events?.done();
      showToast({ tone: 'error', message: 'Couldn’t start the purchase. Please try again.' });
    }
  },
  start(ev) {
    events = ev;
    nativeBridge()?.billing?.onPurchase((p) => void redeem(p, ev));
    void restore();
  },
  resume() {
    void restore();
  },
};
