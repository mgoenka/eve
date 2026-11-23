/* generated from app-platform/ui-kit — edit there and re-sync. */
// Web credits provider (the websites, never inside the Android app): Stripe Checkout with Managed Payments
// (Stripe, through Link, is the merchant of record and adds sales tax / VAT at checkout).
//
// The wallet is the httpOnly mg_wallet cookie on .mohitgoenka.com (set by the server, shared by every app),
// so no headers are needed. Buying: POST /api/credits/checkout -> redirect to Stripe -> back to the same
// page with ?mg_credits=paid&mg_session=cs_… -> POST /api/credits/stripe/confirm credits the pack (a signed
// Stripe webhook does the same if the buyer never comes back).
import { fetchJson, FetchError } from './fetchJson';
import { isNativeApp } from './native';
import { showToast } from './toastBus';
import { getCreditsState } from './credits';
import type { CreditsProvider, CreditsProviderEvents } from './credits';

export const CREDITS_CHECKOUT_URL = '/api/credits/checkout';
export const CREDITS_CONFIRM_URL = '/api/credits/stripe/confirm';
const RETURN_PARAMS = ['mg_credits', 'mg_session'] as const;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

function onSupportedHost(): boolean {
  try {
    const h = window.location.hostname;
    return h === 'mohitgoenka.com' || h.endsWith('.mohitgoenka.com') || h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

/** The current URL without the checkout return parameters (and without the fragment). */
function cleanUrl(): URL {
  const u = new URL(window.location.href);
  for (const p of RETURN_PARAMS) u.searchParams.delete(p);
  return u;
}

function dropReturnParams() {
  try {
    const u = cleanUrl();
    window.history.replaceState(window.history.state, '', u.pathname + u.search + window.location.hash);
  } catch {
    /* ignore */
  }
}

let events: CreditsProviderEvents | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Back from Stripe: credit the session (retrying while the payment is still processing). */
async function confirmReturn(sessionId: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetchJson<{ ok?: boolean; credited?: number; balance?: number; otherWallet?: boolean; error?: string }>(CREDITS_CONFIRM_URL, {
        method: 'POST',
        body: { sessionId },
        timeoutMs: 15000,
        retries: 1,
      });
      if (r?.error === 'payment_pending') {
        // HTTP 202: Stripe hasn't marked the session paid yet.
        events?.pending();
        await wait(2000 + attempt * 2000);
        continue;
      }
      if (r?.otherWallet) {
        showToast({ tone: 'info', message: 'Payment received. The Sparks went to the browser where you started the checkout.' });
        events?.done();
      } else {
        events?.credited({ credited: r?.credited ?? 0, ...(typeof r?.balance === 'number' ? { balance: r.balance } : {}) });
      }
      return;
    } catch (err) {
      if (err instanceof FetchError && err.status === 400) {
        showToast({ tone: 'error', message: 'That checkout couldn’t be found. If you were charged, your Sparks arrive within a few minutes.' });
        events?.done();
        return;
      }
      await wait(2000);
    }
  }
  // Still processing (some payment methods take a while): the webhook credits it later.
  events?.pending();
}

export const webCreditsProvider: CreditsProvider = {
  id: 'web',
  enabled: () => typeof window !== 'undefined' && !isNativeApp() && onSupportedHost(),
  headers: () => ({}),

  async loadPrices(packIds) {
    const s = getCreditsState();
    const prices: Record<string, string> = {};
    for (const p of s.packs) if (packIds.includes(p.id)) prices[p.id] = `$${p.priceUsd.toFixed(2)}`;
    return { ok: s.checkout !== false && Object.keys(prices).length > 0, prices };
  },

  async purchase(packId) {
    try {
      const r = await fetchJson<{ url?: string }>(CREDITS_CHECKOUT_URL, {
        method: 'POST',
        body: { packId, returnUrl: cleanUrl().toString() },
        timeoutMs: 20000,
        retries: 0,
      });
      if (!r?.url || !/^https:\/\/([a-z0-9-]+\.)*(stripe\.com|link\.com)\//.test(r.url)) throw new Error('no checkout url');
      window.location.assign(r.url);
    } catch (err) {
      const code = err instanceof FetchError ? (err.body as { error?: string } | null)?.error : undefined;
      showToast({
        tone: 'error',
        message: code === 'web_credits_off' ? 'Sparks aren’t on sale on the website yet.' : 'Checkout couldn’t open right now. Please try again in a moment.',
      });
      events?.done();
    }
  },

  start(e) {
    events = e;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    const state = params.get('mg_credits');
    const session = params.get('mg_session') ?? '';
    if (!state) return;
    dropReturnParams();
    if (state === 'paid' && SESSION_RE.test(session)) void confirmReturn(session);
    else e.done();
  },
};
