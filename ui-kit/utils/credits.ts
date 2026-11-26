/* generated from app-platform/ui-kit — edit there and re-sync. */
// Prepaid AI credits client. Server side: app-platform/server-kit/credits.
//
// Payment goes through a CreditsProvider: Google Play (utils/creditsPlay.ts) inside the Android app,
// Stripe Checkout (utils/creditsWeb.ts) on the websites. Web checkout is never used inside the Android
// app (Play payments policy). On the website the chip and sheet appear only while the server meters the
// web (its web credits switch is on); otherwise the website behaves exactly as before.
import { fetchJson, FetchError } from './fetchJson';
import type { FetchJsonOptions } from './fetchJson';
import { isNativeApp } from './native';
import { showToast } from './toastBus';
import { playCreditsProvider } from './creditsPlay';
import { webCreditsProvider } from './creditsWeb';

/** Same ids and Play credit counts as server-kit/credits/config.ts (the server is the source of truth; its
 *  /api/credits/balance answer replaces these). Kept here for the rules text and the first paint. */
export const AI_CREDIT_PACKS: ReadonlyArray<{ id: string; credits: number; priceUsd: number }> = [
  { id: 'ai_credits_099', credits: 300, priceUsd: 0.99 },
  { id: 'ai_credits_299', credits: 1000, priceUsd: 2.99 },
  { id: 'ai_credits_499', credits: 2000, priceUsd: 4.99 },
  { id: 'ai_credits_999', credits: 4500, priceUsd: 9.99 },
  { id: 'ai_credits_1999', credits: 10000, priceUsd: 19.99 },
];
export const AI_STARTER_CREDITS = 100;
export const CREDITS_BALANCE_URL = '/api/credits/balance';
export const BALANCE_HEADER = 'X-MG-Credits-Balance';
export const CHARGED_HEADER = 'X-MG-Credits-Charged';
/** JSON `error` code of the server's HTTP 402. */
export const INSUFFICIENT_CREDITS = 'insufficient_credits';

// ---------------------------------------------------------------- providers

/** What the provider reports back to the credits store. */
export interface CreditsProviderEvents {
  /** A purchase was credited by the server. */
  credited(r: { credited: number; balance?: number }): void;
  /** Payment pending at the provider (credits come later). */
  pending(): void;
  /** The purchase flow ended without credits (cancel, failure). */
  done(): void;
}

/** A way to pay for credits: Play inside the Android app; Stripe Checkout on the website. */
export interface CreditsProvider {
  readonly id: 'play' | 'web';
  /** The page has a wallet with this provider (Play: wrapper bridge + app user id). */
  enabled(): boolean;
  /** Headers that identify the wallet to the server (Play: X-MG-App-User; web: none, the cookie does it). */
  headers(): Record<string, string>;
  /** Localized prices by pack id. ok:false = purchases unavailable here right now. */
  loadPrices(packIds: string[]): Promise<{ ok: boolean; prices: Record<string, string> }>;
  /** Start buying a pack. The outcome comes back through the events given to start(). */
  /** credits: a custom amount (website only, packId = the custom id). */
  purchase(packId: string, credits?: number): Promise<void>;
  /** Called once: listen for purchases and recover unfinished ones. */
  start(events: CreditsProviderEvents): void;
  /** The sheet opened: re-check unfinished purchases. */
  resume?(): void;
}

let webProvider: CreditsProvider | null | undefined;
/** Replace the web provider (default: Stripe Checkout, webCreditsProvider); null turns web checkout off. Ignored in the Android app. */
export function registerWebCreditsProvider(p: CreditsProvider | null): void {
  webProvider = p && p.id === 'web' ? p : null;
}

/** The provider for this page: Play in the Android app (never web checkout there), else the web one. */
export function activeCreditsProvider(): CreditsProvider | null {
  const p = isNativeApp() ? playCreditsProvider : webProvider === undefined ? webCreditsProvider : webProvider;
  try {
    return p && p.enabled() ? p : null;
  } catch {
    return null;
  }
}

/** Headers that identify the wallet (empty when credits are off on this page). */
export function creditsHeaders(): Record<string, string> {
  return activeCreditsProvider()?.headers() ?? {};
}

/** True when this page can meter AI with credits (Android app with a working bridge, or a *.mohitgoenka.com page). */
export function creditsEnabled(): boolean {
  return activeCreditsProvider() !== null;
}

// ---------------------------------------------------------------- store

export type PricesStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export interface CreditsState {
  /** The server meters this page (balance known) — the chip and sheet show only then. */
  enabled: boolean;
  balance: number | null;
  packs: ReadonlyArray<{ id: string; credits: number; priceUsd: number }>;
  /** Localized prices from the provider, by pack id. */
  prices: Readonly<Record<string, string>>;
  pricesStatus: PricesStatus;
  sheetOpen: boolean;
  /** Why the sheet opened: the user tapped the chip, or an AI action needed more credits. */
  sheetReason: 'manual' | 'insufficient';
  /** Credits the blocked action needed (from the 402). */
  needed: number | null;
  /** Pack id whose purchase is in progress. */
  buying: string | null;
  /** Web: the server can open Stripe Checkout right now. */
  checkout: boolean;
  /** 'play' (Android app) or 'stripe' (website), from the server. */
  provider: 'play' | 'stripe' | null;
  /** Owner wallet (Mohit's own device): AI is free here, usage still logged. */
  owner: boolean;
  /** A payment is pending at the provider. */
  pending: boolean;
  /** The balance answer arrived at least once (enabled or not). */
  loaded: boolean;
  /** The wallet has bought Sparks before. */
  paid: boolean;
  /** New wallet: the starter Sparks (in `balance`) are granted on its first AI action. */
  starterPending: boolean;
  /** Free starter Sparks are paused for today (global daily allowance used up). */
  starterPaused: boolean;
  /** This network (IP address) already used its free starter Sparks. */
  starterLimited: boolean;
  /** Website: buyers can pick their own amount, priced on this curve ([Sparks, US$] anchors). */
  custom: CustomAmount | null;
}

export interface CustomAmount {
  id: string;
  min: number;
  max: number;
  curve: ReadonlyArray<readonly [number, number]>;
}

/** Price for a custom amount on the server's curve (same math as server-kit customPriceUsd), or null. */
export function customAmountPrice(c: CustomAmount, credits: number): number | null {
  if (!Number.isInteger(credits) || credits < c.min || credits > c.max) return null;
  for (let i = 1; i < c.curve.length; i++) {
    const [c0, p0] = c.curve[i - 1]!;
    const [c1, p1] = c.curve[i]!;
    if (credits <= c1) return Math.ceil(Math.round((p0 + ((credits - c0) / (c1 - c0)) * (p1 - p0)) * 1e6) / 1e4) / 100;
  }
  return null;
}

/** Most Sparks a budget buys on the curve, or null below the smallest price. */
export function customAmountForBudget(c: CustomAmount, usd: number): number | null {
  const minP = customAmountPrice(c, c.min);
  const maxP = customAmountPrice(c, c.max);
  if (!Number.isFinite(usd) || minP === null || maxP === null || usd < minP) return null;
  if (usd >= maxP) return c.max;
  let lo = c.min;
  let hi = c.max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((customAmountPrice(c, mid) ?? Infinity) <= usd + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

let state: CreditsState = {
  enabled: false,
  balance: null,
  packs: AI_CREDIT_PACKS,
  prices: {},
  pricesStatus: 'idle',
  sheetOpen: false,
  sheetReason: 'manual',
  needed: null,
  buying: null,
  pending: false,
  checkout: true,
  provider: null,
  owner: false,
  loaded: false,
  paid: false,
  starterPending: false,
  starterPaused: false,
  starterLimited: false,
  custom: null,
};
const listeners = new Set<() => void>();
function setState(patch: Partial<CreditsState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export function getCreditsState(): CreditsState {
  return state;
}
export function subscribeCredits(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function readBalanceHeader(res: Response) {
  const v = res.headers.get(BALANCE_HEADER);
  if (v !== null && /^-?\d+$/.test(v)) setState({ balance: Number(v) });
}

let refreshing: Promise<void> | null = null;
/** Re-read the balance (and pack list) from the server. No-op when credits are off. Concurrent calls share one request. */
export function refreshCredits(): Promise<void> {
  if (!creditsEnabled()) return Promise.resolve();
  refreshing ??= loadBalance().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function loadBalance(): Promise<void> {
  try {
    const r = await fetchJson<{
      enforced?: boolean;
      balance?: number;
      packs?: CreditsState['packs'];
      checkout?: boolean;
      provider?: string;
      owner?: boolean;
      paid?: boolean;
      starterPending?: boolean;
      starterPaused?: boolean;
      starterLimited?: boolean;
      custom?: CustomAmount;
    }>(CREDITS_BALANCE_URL, {
      headers: creditsHeaders(),
      timeoutMs: 10000,
      retries: 1,
    });
    if (r?.enforced && typeof r.balance === 'number') {
      setState({
        enabled: true,
        balance: r.balance,
        ...(Array.isArray(r.packs) && r.packs.length ? { packs: r.packs } : {}),
        ...(typeof r.checkout === 'boolean' ? { checkout: r.checkout } : {}),
        ...(r.provider === 'play' || r.provider === 'stripe' ? { provider: r.provider } : {}),
        owner: r.owner === true,
        loaded: true,
        paid: r.paid === true,
        starterPending: r.starterPending === true,
        starterPaused: r.starterPaused === true,
        starterLimited: r.starterLimited === true,
        custom:
          r.custom && Number.isInteger(r.custom.min) && Number.isInteger(r.custom.max) && Array.isArray(r.custom.curve) && r.custom.curve.length >= 2 ? r.custom : null,
      });
    } else if (r && r.enforced === false) {
      setState({ loaded: true, ...(state.enabled ? { enabled: false, sheetOpen: false } : {}) }); // web switch off
    }
  } catch {
    /* keep the last known balance */
  }
}

let pricesPromise: Promise<void> | null = null;
export function loadPrices(force = false): Promise<void> {
  const provider = activeCreditsProvider();
  if (!provider) {
    setState({ pricesStatus: 'unavailable' });
    return Promise.resolve();
  }
  if (pricesPromise && !force && state.pricesStatus === 'ready') return pricesPromise;
  setState({ pricesStatus: 'loading' });
  pricesPromise = provider
    .loadPrices(state.packs.map((p) => p.id))
    .then((r) => setState({ prices: r.prices, pricesStatus: r.ok ? 'ready' : 'unavailable' }))
    .catch(() => setState({ pricesStatus: 'unavailable' }));
  return pricesPromise;
}

export function openCreditsSheet(reason: 'manual' | 'insufficient' = 'manual', needed: number | null = null): void {
  const provider = activeCreditsProvider();
  if (!provider) return;
  setState({ sheetOpen: true, sheetReason: reason, needed });
  void loadPrices();
  void refreshCredits();
  provider.resume?.();
}
export function closeCreditsSheet(): void {
  setState({ sheetOpen: false });
}

/** HTTP 402 wallet_required: a web request without the wallet cookie (the balance call mints it). */
function isWalletRequired(err: unknown): boolean {
  return err instanceof FetchError && err.status === 402 && (err.body as { error?: unknown } | null)?.error === 'wallet_required';
}

/** True for the FetchError of an AI call refused for lack of credits (HTTP 402). */
export function isInsufficientCredits(err: unknown): boolean {
  return err instanceof FetchError && err.status === 402 && (err.body as { error?: unknown } | null)?.error === INSUFFICIENT_CREDITS;
}

export interface AiFetchJsonOptions extends FetchJsonOptions {
  /**
   * 'action' (default): the user asked for this (a tap) — a 402 opens the "Get Sparks" sheet, ai_busy shows a toast.
   * 'background': speculative / automatic calls (loading tips, prefetch, auto-naming) — never opens the sheet,
   * never toasts; the caller falls back quietly. Gate them with speculativeAiAllowed().
   */
  ai?: 'action' | 'background';
  /** Open the "Get Sparks" sheet on 402 (default: true for ai 'action', false for 'background'). */
  creditsSheet?: boolean;
  /** Toast "Lots of people are using this right now…" on HTTP 503 ai_busy (default: as creditsSheet). Pass false when the app shows its own message. */
  toastOnBusy?: boolean;
}

/** JSON `error` code of the server's HTTP 503 when Gemini is overloaded (server/ai-guard.ts sendAiBusy). */
export const AI_BUSY = 'ai_busy';

/** Thrown by aiFetchJson on HTTP 503 ai_busy (still a FetchError: status 503, body from the server). */
export class AiBusyError extends FetchError {
  /** Seconds the server asked to wait (Retry-After), at least 1. */
  readonly retryAfter: number;
  constructor(err: FetchError, retryAfter: number) {
    super('http', busyMessage(retryAfter), { status: err.status, url: err.url, body: err.body, attempts: err.attempts });
    this.name = 'AiBusyError';
    this.retryAfter = retryAfter;
  }
}

/** True for an AI call refused because the AI is overloaded right now (fall back to bundled content, or retry later). */
export function isAiBusyError(err: unknown): err is AiBusyError {
  return err instanceof AiBusyError || (err instanceof FetchError && err.status === 503 && (err.body as { error?: unknown } | null)?.error === AI_BUSY);
}

const busyMessage = (s: number) => `Lots of people are using this right now. Try again in ${s} second${s === 1 ? '' : 's'}.`;

function toBusyError(err: unknown, retryHeader: string | null): AiBusyError | null {
  if (!(err instanceof FetchError) || err.status !== 503 || (err.body as { error?: unknown } | null)?.error !== AI_BUSY) return null;
  const fromBody = Number((err.body as { retryAfter?: unknown }).retryAfter);
  const fromHeader = Number(retryHeader);
  const s = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 10;
  return new AiBusyError(err, Math.max(1, Math.min(600, Math.round(s))));
}

/**
 * May the app make an AI call the user didn't ask for (loading tips, prefetching the next round)? Such calls spend
 * Sparks, so: on the website only while the web is free (switch off) or the balance is above 0; in the Android app
 * only for owners, paying users, or with at least 50 Sparks. Unknown balance (not loaded yet): false.
 */
/**
 * Resolves once the balance answer has arrived (so speculativeAiAllowed() knows), at once on pages without credits,
 * and after `timeoutMs` (default 8 s) at the latest — it never rejects. Starts the balance request if none is running.
 */
export function whenCreditsLoaded(timeoutMs = 8000): Promise<void> {
  if (state.loaded || !creditsEnabled()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      unsub();
      resolve();
    };
    const t = setTimeout(done, timeoutMs);
    const unsub = subscribeCredits(() => {
      if (state.loaded) done();
    });
    void refreshCredits().then(() => {
      if (state.loaded) done();
    });
  });
}

/** speculativeAiAllowed() after waiting for the balance (whenCreditsLoaded): `if (await speculativeAiAllowedAsync()) loadTips();` */
export async function speculativeAiAllowedAsync(timeoutMs?: number): Promise<boolean> {
  await whenCreditsLoaded(timeoutMs);
  return speculativeAiAllowed();
}

export function speculativeAiAllowed(): boolean {
  const s = state;
  // Never spend a player's Sparks (free starter or bought) on something they didn't ask for.
  if (isNativeApp()) {
    if (!creditsEnabled() || !s.loaded) return false;
    return s.owner;
  }
  if (!creditsEnabled()) return true; // not a metered page: AI is free here
  if (!s.loaded) return false;
  if (!s.enabled) return true; // web switch off: the website is free
  // Metered: background AI would spend the player's own Sparks on content they may never use, so it runs
  // only for the owner (whose AI isn't deducted). Everyone else gets content when they ask for it.
  return s.owner;
}

/**
 * fetchJson for AI endpoints: adds the wallet headers, keeps the balance chip current, and opens the
 * "Get AI credits" sheet on HTTP 402 (then rethrows, so the caller just stops its spinner).
 * When credits are off (the website today) it is exactly fetchJson.
 */
export async function aiFetchJson<T = unknown>(url: string, options: AiFetchJsonOptions = {}): Promise<T> {
  const { ai = 'action', creditsSheet = ai !== 'background', toastOnBusy = creditsSheet && ai !== 'background', ...fetchOptions } = options;
  let retryHeader: string | null = null;
  const userHook = fetchOptions.onResponse;
  const metered = creditsEnabled();
  const headers = new Headers(fetchOptions.headers);
  if (metered) for (const [k, v] of Object.entries(creditsHeaders())) headers.set(k, v);
  const call = () =>
    fetchJson<T>(url, {
      ...fetchOptions,
      headers,
      onResponse: (res) => {
        retryHeader = res.headers.get('Retry-After');
        if (metered) {
          readBalanceHeader(res);
          // Say what an action cost, so Sparks never feel like a black box (background calls stay quiet).
          const used = Number(res.headers.get(CHARGED_HEADER));
          if (ai === 'action' && used > 0 && !state.owner) showToast({ id: 'mg-sparks-used', tone: 'info', message: `✨ ${used} Sparks used`, duration: 2500 });
        }
        userHook?.(res);
      },
    });
  try {
    try {
      return await call();
    } catch (err) {
      if (!metered || !isWalletRequired(err)) throw err;
      await refreshCredits(); // sets the wallet cookie (and shows the chip), then try once more
      return await call();
    }
  } catch (err) {
    const busy = toBusyError(err, retryHeader);
    if (busy) {
      if (toastOnBusy) showToast({ id: 'mg-ai-busy', tone: 'info', message: busy.message });
      throw busy;
    }
    // An Android build from before AI credits (no app user id): the server answers 426.
    if (!metered && err instanceof FetchError && err.status === 426) {
      showToast({ message: 'Update the app from Google Play to use this feature.', tone: 'info' });
    }
    if (metered && isInsufficientCredits(err)) {
      const body = (err as FetchError).body as { balance?: unknown; needed?: unknown };
      if (typeof body.balance === 'number') setState({ balance: body.balance });
      if (creditsSheet) openCreditsSheet('insufficient', typeof body.needed === 'number' ? body.needed : null);
    }
    throw err;
  }
}

const PROMO_ERRORS: Record<string, string> = {
  wrong_code: 'That promo code isn’t valid.',
  promo_expired: 'That promo code has expired.',
  promo_used_up: 'That promo code has been fully claimed.',
  promo_already_redeemed: 'You’ve already used that promo code.',
  promo_inactive: 'That promo code is no longer active.',
  rate_limited: 'Too many tries. Please wait a while.',
  owner_unavailable: 'Promo codes aren’t available right now.',
};

/**
 * "Have a promo code?": a promo code adds its Sparks (once per wallet: each Android app on a device, each browser); the owner code makes this
 * wallet an owner wallet (unlimited, usage still logged). Rides on the purchase route in the Android app and
 * the checkout route on the web (no extra server routes). Resolves true on success; shows a toast either way.
 */
export async function redeemPromoCode(code: string): Promise<boolean> {
  const url = isNativeApp() ? '/api/credits/purchase' : '/api/credits/checkout';
  try {
    // `ownerCode` too, for servers that predate promo codes.
    const r = await fetchJson<{ ok?: boolean; owner?: boolean; promo?: boolean; credited?: number; balance?: number }>(url, {
      method: 'POST',
      body: { code, ownerCode: code },
      headers: creditsHeaders(),
      timeoutMs: 15000,
      retries: 0,
    });
    if (r.owner) {
      setState({ owner: true });
      showToast({ id: 'mg-credits-owner', tone: 'success', message: 'Promo code applied: unlimited Sparks on this device.' });
    } else {
      setState({ ...(typeof r.balance === 'number' ? { balance: r.balance } : {}) });
      showToast({ id: 'mg-credits-owner', tone: 'success', message: `Promo code applied: +${(r.credited ?? 0).toLocaleString()} Sparks!` });
      if (state.sheetReason === 'insufficient') closeCreditsSheet();
    }
    void refreshCredits();
    return true;
  } catch (err) {
    const code2 = err instanceof FetchError ? (err.body as { error?: string } | null)?.error : undefined;
    showToast({ id: 'mg-credits-owner', tone: 'error', message: (code2 && PROMO_ERRORS[code2]) || 'Couldn’t check the promo code right now.' });
    return false;
  }
}
/** @deprecated Use redeemPromoCode (same thing; the field takes owner and promo codes). */
export const enterOwnerCode = redeemPromoCode;

const LINK_ERRORS: Record<string, string> = {
  wrong_link_code: 'That code didn’t work. Codes work once, for 10 minutes: get a new one on your other device.',
  invalid: 'Enter the 6-character code from your other device.',
  rate_limited: 'Too many tries. Please wait a while.',
  web_credits_off: 'Sparks aren’t on the website yet.',
  wallet_required: 'Reload the page and try again.',
};
const linkErrorOf = (err: unknown) => {
  const c = err instanceof FetchError ? (err.body as { error?: string } | null)?.error : undefined;
  return (c && LINK_ERRORS[c]) || 'Couldn’t link right now. Please try again.';
};

/**
 * Website only: a one-use code (6 characters, 10 minutes) that lets another browser share this browser's
 * Sparks. Resolves the code, or null after showing an error toast.
 */
export async function createDeviceLinkCode(): Promise<string | null> {
  try {
    const r = await fetchJson<{ code?: string }>('/api/credits/checkout', { method: 'POST', body: { linkAction: 'create' }, headers: creditsHeaders(), timeoutMs: 15000, retries: 0 });
    return typeof r.code === 'string' ? r.code : null;
  } catch (err) {
    showToast({ id: 'mg-credits-link', tone: 'error', message: linkErrorOf(err) });
    return null;
  }
}

/** Website only: join the Sparks of the browser that made `code`. This browser's own Sparks move there too. */
export async function linkThisDevice(code: string): Promise<boolean> {
  try {
    const r = await fetchJson<{ moved?: number; balance?: number; owner?: boolean; alreadyLinked?: boolean }>('/api/credits/checkout', {
      method: 'POST',
      body: { linkCode: code },
      headers: creditsHeaders(),
      timeoutMs: 15000,
      retries: 0,
    });
    setState({ ...(typeof r.balance === 'number' ? { balance: r.balance } : {}), ...(r.owner ? { owner: true } : {}) });
    const moved = r.moved ?? 0;
    showToast({
      id: 'mg-credits-link',
      tone: 'success',
      message: r.alreadyLinked
        ? 'This browser already shares those Sparks.'
        : moved > 0
          ? `Linked! The ${moved.toLocaleString()} Sparks from this browser were added. Both devices now share one balance.`
          : 'Linked! This browser now shares your Sparks.',
    });
    void refreshCredits();
    return true;
  } catch (err) {
    showToast({ id: 'mg-credits-link', tone: 'error', message: linkErrorOf(err) });
    return false;
  }
}

/** Buy a pack with the active provider. */
export async function buyCredits(packId: string, credits?: number): Promise<void> {
  const provider = activeCreditsProvider();
  if (!provider) {
    showToast({ tone: 'error', message: 'Purchases are unavailable on this device right now.' });
    return;
  }
  setState({ buying: packId });
  await provider.purchase(packId, credits);
}

let started = false;
/** Wire the provider, recover unfinished purchases, fetch the balance. Idempotent; AiCreditsHost calls it. */
export function initCredits(): void {
  const provider = activeCreditsProvider();
  if (started || !provider) return;
  started = true;
  provider.start({
    credited: ({ credited, balance }) => {
      setState({ pending: false, buying: null, ...(typeof balance === 'number' ? { balance } : {}), ...(credited > 0 ? { paid: true } : {}) });
      if (credited > 0) {
        showToast({ id: 'mg-credits-added', tone: 'success', message: `+${credited.toLocaleString()} Sparks added. Thank you!` });
        if (state.sheetReason === 'insufficient') closeCreditsSheet();
      }
    },
    pending: () => setState({ pending: true, buying: null }),
    done: () => setState({ buying: null }),
  });
  void refreshCredits();
}
