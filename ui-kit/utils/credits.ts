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
  { id: 'ai_credits_099', credits: 346, priceUsd: 0.99 },
  { id: 'ai_credits_499', credits: 1746, priceUsd: 4.99 },
  { id: 'ai_credits_1999', credits: 6996, priceUsd: 19.99 },
];
export const AI_STARTER_CREDITS = 100;
export const CREDITS_BALANCE_URL = '/api/credits/balance';
export const BALANCE_HEADER = 'X-MG-Credits-Balance';
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
  purchase(packId: string): Promise<void>;
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

/** Re-read the balance (and pack list) from the server. No-op when credits are off. */
export async function refreshCredits(): Promise<void> {
  if (!creditsEnabled()) return;
  try {
    const r = await fetchJson<{ enforced?: boolean; balance?: number; packs?: CreditsState['packs']; checkout?: boolean; provider?: string; owner?: boolean }>(CREDITS_BALANCE_URL, {
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
      });
    } else if (r && r.enforced === false && state.enabled) {
      setState({ enabled: false, sheetOpen: false }); // web switch turned off
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
  /** Open the "Get AI credits" sheet on 402 (default true). Pass false for background calls (auto-naming…). */
  creditsSheet?: boolean;
}

/**
 * fetchJson for AI endpoints: adds the wallet headers, keeps the balance chip current, and opens the
 * "Get AI credits" sheet on HTTP 402 (then rethrows, so the caller just stops its spinner).
 * When credits are off (the website today) it is exactly fetchJson.
 */
export async function aiFetchJson<T = unknown>(url: string, options: AiFetchJsonOptions = {}): Promise<T> {
  const { creditsSheet = true, ...fetchOptions } = options;
  if (!creditsEnabled()) {
    try {
      return await fetchJson<T>(url, fetchOptions);
    } catch (err) {
      // An Android build from before AI credits (no app user id): the server answers 426.
      if (err instanceof FetchError && err.status === 426) {
        showToast({ message: 'Update the app from Google Play to use AI features.', tone: 'info' });
      }
      throw err;
    }
  }
  const headers = new Headers(fetchOptions.headers);
  for (const [k, v] of Object.entries(creditsHeaders())) headers.set(k, v);
  const userHook = fetchOptions.onResponse;
  const call = () =>
    fetchJson<T>(url, {
      ...fetchOptions,
      headers,
      onResponse: (res) => {
        readBalanceHeader(res);
        userHook?.(res);
      },
    });
  try {
    try {
      return await call();
    } catch (err) {
      if (!isWalletRequired(err)) throw err;
      await refreshCredits(); // sets the wallet cookie (and shows the chip), then try once more
      return await call();
    }
  } catch (err) {
    if (isInsufficientCredits(err)) {
      const body = (err as FetchError).body as { balance?: unknown; needed?: unknown };
      if (typeof body.balance === 'number') setState({ balance: body.balance });
      if (creditsSheet) openCreditsSheet('insufficient', typeof body.needed === 'number' ? body.needed : null);
    }
    throw err;
  }
}

/**
 * Owner code: marks this device's wallet as the owner's (AI free, usage still logged). The code rides on
 * the purchase route in the Android app and the checkout route on the web (no extra server routes).
 * Resolves true on success; shows a toast either way.
 */
export async function enterOwnerCode(code: string): Promise<boolean> {
  const url = isNativeApp() ? '/api/credits/purchase' : '/api/credits/checkout';
  try {
    await fetchJson<{ ok?: boolean }>(url, { method: 'POST', body: { ownerCode: code }, headers: creditsHeaders(), timeoutMs: 15000, retries: 0 });
    setState({ owner: true });
    showToast({ id: 'mg-credits-owner', tone: 'success', message: 'Owner mode is on for this device: AI is free here.' });
    void refreshCredits();
    return true;
  } catch (err) {
    const code2 = err instanceof FetchError ? (err.body as { error?: string } | null)?.error : undefined;
    const message =
      code2 === 'wrong_code' ? 'That code isn’t right.' : code2 === 'rate_limited' ? 'Too many tries. Please wait a while.' : code2 === 'owner_unavailable' ? 'Owner mode isn’t set up.' : 'Couldn’t check the code right now.';
    showToast({ id: 'mg-credits-owner', tone: 'error', message });
    return false;
  }
}

/** Buy a pack with the active provider. */
export async function buyCredits(packId: string): Promise<void> {
  const provider = activeCreditsProvider();
  if (!provider) {
    showToast({ tone: 'error', message: 'Purchases are unavailable on this device right now.' });
    return;
  }
  setState({ buying: packId });
  await provider.purchase(packId);
}

let started = false;
/** Wire the provider, recover unfinished purchases, fetch the balance. Idempotent; AiCreditsHost calls it. */
export function initCredits(): void {
  const provider = activeCreditsProvider();
  if (started || !provider) return;
  started = true;
  provider.start({
    credited: ({ credited, balance }) => {
      setState({ pending: false, buying: null, ...(typeof balance === 'number' ? { balance } : {}) });
      if (credited > 0) {
        showToast({ id: 'mg-credits-added', tone: 'success', message: `+${credited.toLocaleString()} AI credits added. Thank you!` });
        if (state.sheetReason === 'insufficient') closeCreditsSheet();
      }
    },
    pending: () => setState({ pending: true, buying: null }),
    done: () => setState({ buying: null }),
  });
  void refreshCredits();
}
