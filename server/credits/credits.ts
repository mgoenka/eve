/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Prepaid AI credits: the Android (Play) apps always; the websites once the web switch is on.
//
//  1. Wallets: walletFor(req) -> "android:<package>:<appUserId>" (Android app) or "web:<walletId>" (the
//     mg_wallet cookie on .mohitgoenka.com, shared by every app; credits.middleware mints it).
//  2. Who pays: ONE policy function, mustPay(). Default: Android requests with an app user id, and web
//     requests while aiCreditConfig/web.enabled is true. Switch off: the websites are free, as before.
//  3. Purchases: creditPurchase({ wallet, provider, externalId, packId }) is idempotent on (provider, externalId).
//     Adapters: verifyPlay (Play Billing token) and Stripe Checkout (confirm on return + signed webhook).
import { createHash, randomBytes } from 'node:crypto';
import {
  APP_USER_HEADER,
  APP_USER_RE,
  BALANCE_HEADER,
  CHARGED_HEADER,
  CREDIT_USD,
  HOLD_TTL_MS,
  NATIVE_UA_TOKEN,
  STARTER_CREDITS,
  WEB_COOKIE_DOMAIN,
  WEB_STARTER_PER_IP,
  WEB_STARTER_WINDOW_MS,
  WEB_WALLET_COOKIE,
  WEB_WALLET_MAX_AGE_S,
  packById,
  packsFor,
} from './config.ts';
import type { PaymentProvider } from './config.ts';
import { costOfCall, usageOf } from './pricing.ts';
import type { CallUsage } from './pricing.ts';
import { FirestoreCreditStore } from './firestore-store.ts';
import { MemoryCreditStore } from './store.ts';
import type { AccountMeta, CreditStore } from './store.ts';
import { GooglePlayApi, PlayApiError } from './play.ts';
import type { PlayApi } from './play.ts';
import { StripeApiError, StripeRestApi, verifyStripeSignature } from './stripe.ts';
import type { StripeApi, StripeCheckoutSession, StripeEvent } from './stripe.ts';

// ---------------------------------------------------------------- types (framework-agnostic)

/** Anything with Node/Express-style headers: Express Request, http.IncomingMessage, or a plain object. */
export interface ReqLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string | undefined;
  body?: unknown;
  socket?: { remoteAddress?: string | undefined } | undefined;
}
/** Express Response / anything with status().json() + setHeader(). */
export interface ResLike {
  status(code: number): ResLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string | number | string[]): unknown;
  getHeader?(name: string): unknown;
}

export type WalletKind = 'android' | 'web';

/** Who holds the credits. One Firestore account (balance + ledger) per wallet key. */
export interface Wallet {
  kind: WalletKind;
  /** "android:<package>:<appUserId>" | "web:<walletId>" — the Firestore doc id. */
  key: string;
  /** App user id (android) or web wallet id. */
  id: string;
  /** Android package; '*' for a web wallet (shared by every *.mohitgoenka.com app). */
  app: string;
  /** Where this wallet buys packs: Play inside the Android app, Stripe on the web. */
  provider: PaymentProvider;
  /** Client address of the request (web: limits starter grants per address). */
  address?: string;
}
/** Older name for a wallet the current request pays from. */
export type CreditContext = Wallet;

export const walletKey = {
  android: (packageName: string, appUserId: string) => `android:${packageName}:${appUserId}`,
  web: (walletId: string) => `web:${walletId}`,
};

/** Inputs of the "who must pay" policy. */
export interface PayContext {
  /** User agent carries MohitGoenkaApp/ (Android/iOS wrapper). */
  native: boolean;
  /** The wallet this request identified (null: none). */
  wallet: Wallet | null;
  packageName: string;
  /** The web credits switch is on. */
  webEnabled: boolean;
}
export type PayPolicy = (c: PayContext) => boolean;

/**
 * Android requests with an app user id pay. Web requests pay while the web switch is on (a web request
 * without a wallet cookie then gets 402 wallet_required; the kit fetches the balance, which mints one).
 */
export const defaultPayPolicy: PayPolicy = ({ native, wallet, webEnabled }) => (native ? wallet?.kind === 'android' : webEnabled);

export class CreditsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'CreditsError';
    this.status = status;
    this.code = code;
    this.body = { error: code, ...extra };
  }
}

export interface Meter {
  /** Record one generateContent response (uses response.modelVersion + usageMetadata + grounding). */
  add(response: unknown, requestedModel: string): void;
  /** Record a usage you computed yourself. */
  addUsage(usage: CallUsage): void;
  readonly calls: readonly CallUsage[];
}

export interface RunOptions {
  /** Short label for the ledger, e.g. 'wheel', 'name', 'board'. */
  action: string;
  /** Pre-check: the user needs at least this many available credits (min 1). Use estimateCredits(). */
  estimate: number;
}

export interface RunResult<T> {
  value: T;
  /** Credits charged (0 when not paying, for cached results, or when no model call was made). */
  charged: number;
  /** Balance after the charge (null when the request doesn't pay). */
  balance: number | null;
}

export interface CreditPurchaseInput {
  wallet: Wallet;
  provider: PaymentProvider;
  /** Provider's unique id for this payment (Play purchase token, Stripe checkout session id). Hashed before storing. */
  externalId: string;
  packId: string;
  /** Default: the pack's credits for this provider. */
  credits?: number;
  /** Extra provider ids that must also be unique (Play orderId). Stored as "<provider>:<id>". */
  secondaryIds?: string[];
  /** Human-facing order id for support (stored in the ledger). */
  orderId?: string | null;
  /** True when nothing more must happen at the provider (Stripe). Play: false until consumed. */
  finalized?: boolean;
  purchaseType?: number;
}

export interface CreditsOptions {
  /** Android package, e.g. 'com.mohitgoenka.spinner' (must match android-apps.json). */
  packageName: string;
  /** Storage. Default: Firestore (ADC), or memory when CREDITS_STORE=memory (local dev only). */
  store?: CreditStore;
  /** Play Developer API. Default: GooglePlayApi (ADC). */
  play?: PlayApi;
  /** Who must pay. Default defaultPayPolicy. */
  mustPay?: PayPolicy;
  /** Web wallet id from the request. Default: the mg_wallet cookie. */
  resolveWebWallet?: (req: ReqLike) => string | null;
  /** Stripe Checkout (web packs). Default: StripeRestApi (keys from env or Secret Manager). */
  stripe?: StripeApi;
  /**
   * Web credits: 'switch' (default) follows Firestore aiCreditConfig/web.enabled (cached 1 min);
   * 'on' / 'off' force it (also CREDITS_WEB=on|off in the environment).
   */
  web?: 'switch' | 'on' | 'off';
  /**
   * Native user agent WITHOUT an app user id (app builds from before AI credits): 'free' treats them
   * like the website (default, so old installs keep working); 'block' answers 426 update_required.
   */
  legacyNativeClients?: 'free' | 'block';
  now?: () => Date;
}

// ---------------------------------------------------------------- small helpers

const header = (req: ReqLike, name: string): string => {
  const v = req.headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
export const isNativeRequest = (req: ReqLike) => header(req, 'user-agent').includes(NATIVE_UA_TOKEN);
/** For logs only: never log ids or tokens in full. */
export const mask = (s: string) => (s ? s.slice(0, 6) + '…' : '');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const clientIp = (req: ReqLike) => req.ip || req.socket?.remoteAddress || 'unknown';
const WEB_WALLET_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

/** Value of one cookie from the Cookie header ('' when absent). */
export function readCookie(req: ReqLike, name: string): string {
  for (const part of header(req, 'cookie').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

const hostOf = (req: ReqLike) => header(req, 'host').toLowerCase().replace(/:\d+$/, '');
const onAppDomain = (host: string) => host === WEB_COOKIE_DOMAIN || host.endsWith('.' + WEB_COOKIE_DOMAIN);
const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** Set-Cookie value for the web wallet: on *.mohitgoenka.com shared by every app (Domain=.mohitgoenka.com). */
export function walletCookie(req: ReqLike, id: string): string {
  const host = hostOf(req);
  const base = `${WEB_WALLET_COOKIE}=${id}; Path=/; Max-Age=${WEB_WALLET_MAX_AGE_S}; HttpOnly; SameSite=Lax`;
  if (onAppDomain(host)) return `${base}; Domain=.${WEB_COOKIE_DOMAIN}; Secure`;
  return isLocalHost(host) ? base : `${base}; Secure`;
}

function appendCookie(res: ResLike, cookie: string) {
  const prev = res.getHeader?.('Set-Cookie');
  const name = cookie.slice(0, cookie.indexOf('=') + 1);
  const list = (prev === undefined || prev === null ? [] : Array.isArray(prev) ? prev.map(String) : [String(prev)]).filter((c) => !c.startsWith(name));
  res.setHeader('Set-Cookie', list.length ? [...list, cookie] : cookie);
}

/** Starter-grant counter key for a client address: IPv4 as is, IPv6 by its /64. Salted hash, never the address. */
function addressKey(ip: string): string {
  let a = ip.replace(/^::ffff:/, '');
  if (a.includes(':')) a = a.split(':').slice(0, 4).join(':') + '::/64';
  return sha256('mg-credits-starter:' + a);
}

/** returnUrl for Stripe: https on *.mohitgoenka.com (or localhost outside production), no fragment. */
export function safeReturnUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    const prod = u.protocol === 'https:' && onAppDomain(h);
    const local = process.env.NODE_ENV !== 'production' && isLocalHost(h) && (u.protocol === 'http:' || u.protocol === 'https:');
    if (!prod && !local) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
const SECONDARY_RE = /^[A-Za-z0-9.\-_]{1,100}$/;

class Window {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly ms: number;
  constructor(limit: number, ms: number) {
    this.limit = limit;
    this.ms = ms;
  }
  /** 0 = allowed, else seconds to wait. */
  hit(key: string, now = Date.now()): number {
    if (this.hits.size > 5000) for (const [k, b] of this.hits) if (b.resetAt <= now) this.hits.delete(k);
    const b = this.hits.get(key);
    if (!b || b.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.ms });
      return 0;
    }
    b.count += 1;
    return b.count <= this.limit ? 0 : Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  }
}

const TOKEN_RE = /^[A-Za-z0-9._:\-]{20,4096}$/;

// ---------------------------------------------------------------- the service

export function createCredits(options: CreditsOptions) {
  const pkg = options.packageName;
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(pkg)) throw new Error('createCredits: invalid packageName');
  const app = pkg.split('.').pop() ?? pkg;
  const now = options.now ?? (() => new Date());
  const store: CreditStore = options.store ?? (process.env.CREDITS_STORE === 'memory' ? new MemoryCreditStore() : new FirestoreCreditStore());
  const play: PlayApi = options.play ?? new GooglePlayApi();
  let stripeApi: StripeApi | null = options.stripe ?? null;
  const stripe = () => (stripeApi ??= new StripeRestApi());
  const mustPay = options.mustPay ?? defaultPayPolicy;
  const legacy = options.legacyNativeClients ?? 'block';
  const resolveWebWallet = options.resolveWebWallet ?? ((req: ReqLike) => readCookie(req, WEB_WALLET_COOKIE) || null);

  // ---- the web switch (one Firestore doc for every app, cached 1 min; errors keep the last value)
  const envWeb = process.env.CREDITS_WEB === 'on' ? 'on' : process.env.CREDITS_WEB === 'off' ? 'off' : null;
  const webMode = options.web ?? envWeb ?? 'switch';
  let webOn = webMode === 'on';
  let webCheckedAt = 0;
  let webRefresh: Promise<boolean> | null = null;
  function webEnabled(): Promise<boolean> {
    if (webMode !== 'switch') return Promise.resolve(webMode === 'on');
    if (Date.now() - webCheckedAt < 60_000) return Promise.resolve(webOn);
    webRefresh ??= store
      .webEnabled()
      .then((v) => {
        if (v !== webOn) console.log(`[credits] ${app}: web credits ${v ? 'ON' : 'off'}`);
        webOn = v;
        webCheckedAt = Date.now();
        return v;
      })
      .catch((err) => {
        console.warn('[credits] web switch read failed', (err as Error)?.message);
        webCheckedAt = Date.now() - 45_000; // retry in ~15 s
        return webOn;
      })
      .finally(() => {
        webRefresh = null;
      });
    return webRefresh;
  }
  /** Synchronous view (refreshes in the background when stale). */
  const webEnabledNow = () => {
    if (webMode !== 'switch') return webMode === 'on';
    if (Date.now() - webCheckedAt >= 60_000) void webEnabled();
    return webOn;
  };
  if (webMode === 'switch') void webEnabled();
  if (process.env.CREDITS_STORE === 'memory' && process.env.NODE_ENV === 'production') {
    console.error('[credits] CREDITS_STORE=memory in production: balances are lost on restart');
  }

  const balanceLimit = new Window(60, 60_000);
  const purchaseIpLimit = new Window(10, 60_000);
  const purchaseUserLimit = new Window(30, 60 * 60_000);
  const checkoutIpLimit = new Window(10, 60_000);
  const checkoutWalletLimit = new Window(20, 60 * 60_000);
  const confirmIpLimit = new Window(30, 60_000);

  const meta = (w: Wallet): AccountMeta => ({ kind: w.kind, app: w.app, id: w.id });
  /** Android wallets get the starter on creation; web wallets only through the per-address claim (prepareWeb). */
  const starterFor = (w: Wallet) => (w.kind === 'web' ? 0 : STARTER_CREDITS);
  const webWallet = (id: string, address?: string): Wallet => ({ kind: 'web', key: walletKey.web(id), id, app: '*', provider: 'stripe', ...(address ? { address } : {}) });

  /** Web wallets known to exist on this instance (skips a Firestore round trip per AI call). */
  const knownWeb = new Set<string>();
  /** Create a new web wallet; it gets the starter credits only while its address hasn't claimed WEB_STARTER_PER_IP. */
  async function prepareWeb(wallet: Wallet) {
    if (wallet.kind !== 'web' || knownWeb.has(wallet.key)) return;
    const s = await store.ensure(wallet.key, meta(wallet), 0, now());
    if (s.created) {
      const ok = await store.claimStarter(addressKey(wallet.address ?? 'unknown'), WEB_STARTER_PER_IP, WEB_STARTER_WINDOW_MS, now());
      if (ok) await store.grant(wallet.key, meta(wallet), STARTER_CREDITS, 'starter', now());
      console.log(`[credits] ${app}: new web wallet ${mask(wallet.id)} (${ok ? '+' + STARTER_CREDITS + ' starter' : 'no starter: address limit'})`);
    }
    if (knownWeb.size > 50_000) knownWeb.clear();
    knownWeb.add(wallet.key);
  }

  /**
   * The wallet a request identifies, whether or not it must pay. Android: UA token + valid X-MG-App-User.
   * Web: the mg_wallet cookie (resolveWebWallet). Throws CreditsError 400 for a malformed app user id,
   * 426 for app builds without an id when legacyNativeClients is 'block'.
   */
  function walletFor(req: ReqLike): Wallet | null {
    if (isNativeRequest(req)) {
      const raw = header(req, APP_USER_HEADER).trim();
      if (!raw) {
        if (legacy === 'block') throw new CreditsError(426, 'update_required');
        return null;
      }
      const id = raw.toLowerCase();
      if (!APP_USER_RE.test(id)) throw new CreditsError(400, 'invalid_app_user');
      return { kind: 'android', key: walletKey.android(pkg, id), id, app: pkg, provider: 'play' };
    }
    const webId = resolveWebWallet(req);
    if (webId && WEB_WALLET_RE.test(webId)) return webWallet(webId, clientIp(req));
    return null;
  }

  /**
   * The wallet this request must pay from, or null when it doesn't pay (web with the switch off).
   * Throws 402 wallet_required if the policy says pay but the request has no wallet (web without a cookie).
   */
  function identify(req: ReqLike): Wallet | null {
    const wallet = walletFor(req);
    if (!mustPay({ native: isNativeRequest(req), wallet, packageName: pkg, webEnabled: webEnabledNow() })) return null;
    if (!wallet) throw new CreditsError(402, 'wallet_required');
    return wallet;
  }

  function newMeter(): Meter & { calls: CallUsage[] } {
    const calls: CallUsage[] = [];
    return {
      calls,
      add(response, requestedModel) {
        calls.push(usageOf(response, requestedModel));
      },
      addUsage(u) {
        calls.push(u);
      },
    };
  }

  /**
   * Run an AI action. Not paying (wallet null): just runs fn. Paying: hold `estimate` (402
   * insufficient_credits if the balance can't cover it), run fn, charge the actual cost of every model call
   * recorded on the meter. A failed fn (throws) or one that recorded no model call (cache hit, shared
   * in-flight result) costs nothing.
   */
  async function run<T>(wallet: Wallet | null, opts: RunOptions, fn: (meter: Meter) => Promise<T>): Promise<RunResult<T>> {
    const meter = newMeter();
    if (!wallet) return { value: await fn(meter), charged: 0, balance: null };

    const holdId = randomBytes(9).toString('hex');
    const estimate = Math.max(1, Math.ceil(Number.isFinite(opts.estimate) ? opts.estimate : 1));
    let reserved;
    try {
      await prepareWeb(wallet);
      reserved = await store.reserve(wallet.key, meta(wallet), starterFor(wallet), holdId, estimate, HOLD_TTL_MS, now());
    } catch (err) {
      console.error('[credits] reserve failed for', mask(wallet.id), (err as Error)?.message);
      throw new CreditsError(503, 'credits_unavailable');
    }
    if (reserved.created) console.log(`[credits] ${app}: new ${wallet.kind} wallet ${mask(wallet.id)} (+${STARTER_CREDITS} starter)`);
    if (!reserved.ok) throw new CreditsError(402, 'insufficient_credits', { balance: reserved.balance, available: reserved.available, needed: estimate });

    let value: T;
    try {
      value = await fn(meter);
    } catch (err) {
      await store.release(wallet.key, holdId).catch(() => {});
      throw err;
    }
    if (meter.calls.length === 0) {
      const r = await store.release(wallet.key, holdId).catch(() => ({ balance: reserved.balance }));
      return { value, charged: 0, balance: r.balance };
    }
    const at = now();
    const costs = meter.calls.map((c) => costOfCall(c, at));
    const credits = costs.reduce((s, c) => s + c.credits, 0);
    const costUsd = Math.round(costs.reduce((s, c) => s + c.usd, 0) * 1e8) / 1e8;
    try {
      const { balance } = await store.settle(
        wallet.key,
        holdId,
        {
          credits,
          action: `${app}:${opts.action}`,
          costUsd,
          calls: costs.map((c) => ({ model: c.model.slice(0, 80), priced: c.priced, usd: Math.round(c.usd * 1e8) / 1e8, credits: c.credits })),
        },
        at,
      );
      return { value, charged: credits, balance };
    } catch (err) {
      // The user already has the result; the hold expires on its own. Log loudly, don't fail the request.
      console.error('[credits] settle failed for', mask(wallet.id), credits, 'credits', (err as Error)?.message);
      return { value, charged: 0, balance: reserved.balance - estimate };
    }
  }

  async function balance(wallet: Wallet) {
    await prepareWeb(wallet);
    const s = await store.ensure(wallet.key, meta(wallet), starterFor(wallet), now());
    if (s.created) console.log(`[credits] ${app}: new ${wallet.kind} wallet ${mask(wallet.id)} (+${starterFor(wallet)} starter)`);
    const body: Record<string, unknown> = {
      enforced: true,
      balance: s.balance,
      available: s.available,
      starterCredits: STARTER_CREDITS,
      creditUsd: CREDIT_USD,
      provider: wallet.provider,
      packs: packsFor(wallet.provider).map((p) => ({ id: p.id, credits: p.credits, priceUsd: p.priceUsd })),
    };
    if (wallet.kind === 'web') {
      body.checkout = await stripe()
        .configured()
        .catch(() => false);
      body.taxNote = 'Prices in US dollars; sales tax or VAT is added at checkout where it applies.';
    }
    return body as { enforced: true; balance: number; available: number } & Record<string, unknown>;
  }

  const purchaseKeyOf = (provider: PaymentProvider, externalId: string) => `${provider}:${sha256(externalId)}`;

  /**
   * Credit a verified payment to a wallet, at most once per (provider, externalId) and per secondary id.
   * Provider-agnostic: call it from the Play adapter (verifyPlay) or a Stripe webhook.
   */
  async function creditPurchase(p: CreditPurchaseInput) {
    const pack = packById(p.packId, p.provider);
    if (!pack) throw new Error('creditPurchase: unknown pack ' + String(p.packId));
    const credits = p.credits ?? pack.credits;
    if (!Number.isInteger(credits) || credits <= 0) throw new Error('creditPurchase: invalid credits');
    const secondaryKeys = (p.secondaryIds ?? []).filter((s) => SECONDARY_RE.test(s)).map((s) => `${p.provider}:${s}`);
    const result = await store.creditPurchase(
      {
        key: p.wallet.key,
        meta: meta(p.wallet),
        starter: starterFor(p.wallet),
        provider: p.provider,
        purchaseKey: purchaseKeyOf(p.provider, p.externalId),
        secondaryKeys,
        orderId: p.orderId && SECONDARY_RE.test(p.orderId) ? p.orderId : null,
        productId: pack.id,
        credits,
        finalized: p.finalized ?? false,
        ...(typeof p.purchaseType === 'number' ? { purchaseType: p.purchaseType } : {}),
      },
      now(),
    );
    if (!result.duplicate) console.log(`[credits] ${app}: +${credits} for ${mask(p.wallet.id)} (${p.provider} ${pack.id}${p.purchaseType === 0 ? ', test' : ''})`);
    return { ...result, credited: result.duplicate ? 0 : credits };
  }

  // ---- Play adapter: verify the token with the Play Developer API, credit, consume.

  /** Verify a Play purchase token, credit the pack once, consume it. Returns an HTTP status + JSON body. */
  async function verifyPlay(wallet: Wallet, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    if (wallet.kind !== 'android') return { status: 403, body: { error: 'native_only' } };
    const b = (body ?? {}) as { productId?: unknown; purchaseToken?: unknown };
    const pack = packById(b.productId, 'play');
    const token = typeof b.purchaseToken === 'string' ? b.purchaseToken.trim() : '';
    if (!pack || !TOKEN_RE.test(token)) return { status: 400, body: { error: 'invalid' } };
    const purchaseKey = purchaseKeyOf('play', token);

    // Already credited (retry after a lost response or a crash before consume): finish the consume, report ok.
    const prior = await store.getPurchase(purchaseKey);
    if (prior) {
      if (prior.account !== wallet.key) return { status: 403, body: { error: 'account_mismatch' } };
      if (!prior.finalized) await consume(pack.id, token, purchaseKey);
      const s = await store.ensure(wallet.key, meta(wallet), STARTER_CREDITS, now());
      return { status: 200, body: { ok: true, credited: 0, alreadyProcessed: true, balance: s.balance } };
    }

    let p;
    try {
      p = await play.getProductPurchase(pkg, pack.id, token);
    } catch (err) {
      const status = err instanceof PlayApiError ? err.status : 0;
      if (status === 400 || status === 404 || status === 410) return { status: 400, body: { error: 'invalid_purchase' } };
      if (status === 401 || status === 403) {
        console.error(`[credits] Play API ${status}: grant the runtime service account access to ${pkg} in Play Console (Users and permissions)`);
      } else console.error('[credits] Play API error', status || (err as Error)?.message);
      return { status: 503, body: { error: 'verify_unavailable' } };
    }

    if (p.kind && p.kind !== 'androidpublisher#productPurchase') return { status: 400, body: { error: 'invalid_purchase' } };
    if (p.productId && p.productId !== pack.id) return { status: 400, body: { error: 'invalid_purchase' } };
    if (p.purchaseState === 2) return { status: 202, body: { error: 'purchase_pending' } };
    if (p.purchaseState !== 0) return { status: 409, body: { error: 'purchase_canceled' } };
    if ((p.obfuscatedExternalAccountId ?? '') !== wallet.id) {
      // Only the buyer's own Play account can hand this token to the app, so a mismatch means the app user
      // id changed (app data cleared before a backup ran). Credit the presenter: creditPurchase is
      // idempotent on the token and the orderId, so a purchase is still credited at most once.
      console.warn(`[credits] ${app}: purchase ${mask(p.orderId ?? '')} made under another app user id; crediting ${mask(wallet.id)}`);
    }
    if (p.consumptionState === 1) {
      // Consumed but not in our ledger: someone consumed it elsewhere. Never credit twice.
      console.warn(`[credits] ${app}: consumed purchase ${mask(p.orderId ?? '')} not in ledger`);
      return { status: 409, body: { error: 'already_consumed' } };
    }
    const quantity = Math.min(10, Math.max(1, Math.floor(p.quantity ?? 1)));
    const orderId = typeof p.orderId === 'string' ? p.orderId : null;
    const applied = await creditPurchase({
      wallet,
      provider: 'play',
      externalId: token,
      packId: pack.id,
      credits: pack.credits * quantity,
      secondaryIds: orderId ? [orderId] : [],
      orderId,
      finalized: false,
      ...(typeof p.purchaseType === 'number' ? { purchaseType: p.purchaseType } : {}),
    });
    if (applied.duplicate && applied.account !== wallet.key) return { status: 403, body: { error: 'account_mismatch' } };
    if (!applied.finalized) await consume(pack.id, token, purchaseKey);
    return { status: 200, body: { ok: true, credited: applied.credited, alreadyProcessed: applied.duplicate, balance: applied.balance } };
  }

  /** Consume so the user can buy the same pack again. Failure is fine: the app re-sends unconsumed purchases on start. */
  async function consume(productId: string, token: string, purchaseKey: string) {
    try {
      await play.consumeProductPurchase(pkg, productId, token);
      await store.markFinalized(purchaseKey, now());
    } catch (err) {
      console.warn('[credits] consume failed (will retry on next app start):', err instanceof PlayApiError ? err.status : (err as Error)?.message);
    }
  }

  // ---- Stripe adapter (web): Checkout Session -> credits, once per session id and payment intent.

  /** Credit a Checkout Session the server created (metadata is server-set, so it is trusted once retrieved or signed). */
  async function fulfillSession(s: StripeCheckoutSession): Promise<{ status: number; body: Record<string, unknown>; account?: string }> {
    const md = s.metadata ?? {};
    const walletId = typeof md.mg_wallet === 'string' ? md.mg_wallet : '';
    const pack = packById(md.mg_pack, 'stripe');
    if ((s.mode && s.mode !== 'payment') || !WEB_WALLET_RE.test(walletId) || !pack) return { status: 400, body: { error: 'invalid_session' } };
    if (s.payment_status !== 'paid') return { status: 202, body: { error: 'payment_pending' } };
    const promised = typeof md.mg_credits === 'string' && /^\d{1,7}$/.test(md.mg_credits) ? Number(md.mg_credits) : pack.credits;
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : null;
    const applied = await creditPurchase({
      wallet: webWallet(walletId),
      provider: 'stripe',
      externalId: s.id,
      packId: pack.id,
      credits: promised > 0 ? promised : pack.credits,
      secondaryIds: pi ? [pi] : [],
      orderId: pi,
      finalized: true,
      ...(s.livemode === false ? { purchaseType: 0 } : {}),
    });
    return { status: 200, body: { ok: true, credited: applied.credited, alreadyProcessed: applied.duplicate, balance: applied.balance }, account: applied.account };
  }

  /** Apply one verified Stripe event. Throws on storage errors (Stripe retries the webhook). */
  async function handleStripeEvent(event: StripeEvent): Promise<string> {
    const obj = event.data.object as Record<string, unknown>;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = obj as unknown as StripeCheckoutSession;
        if (!s.metadata || typeof s.metadata.mg_wallet !== 'string') return 'ignored (not a credits session)';
        const out = await fulfillSession(s);
        return out.status === 200 ? `credited ${String(out.body.credited)}` : String(out.body.error);
      }
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : '';
        if (!pi) return 'ignored (no payment intent)';
        let fraction = 1;
        if (event.type === 'charge.refunded') {
          const amount = Number(obj.amount);
          const refunded = Number(obj.amount_refunded);
          fraction = amount > 0 && Number.isFinite(refunded) ? refunded / amount : 1;
        }
        const reason = event.type === 'charge.refunded' ? 'refund' : 'dispute';
        const r = await store.reversePurchase({ secondaryKey: `stripe:${pi}` }, fraction, reason, now());
        if (!r) return 'ignored (unknown purchase)';
        if (r.reversed) console.log(`[credits] ${app}: -${r.reversed} (${reason}) for ${mask(r.account.replace(/^web:/, ''))}, balance ${r.balance}`);
        return `${reason} reversed ${r.reversed}`;
      }
      default:
        return 'ignored';
    }
  }

  // ---------------------------------------------------------------- HTTP glue (Express-compatible)

  /**
   * Express middleware for the app's /api router: when web credits are on, gives a web request without a
   * wallet a new mg_wallet cookie (and adds it to this request, so the same call can already pay).
   */
  async function middleware(req: ReqLike, res: ResLike, next: () => void) {
    try {
      if (!isNativeRequest(req) && (await webEnabled())) {
        const id = resolveWebWallet(req);
        if (!id || !WEB_WALLET_RE.test(id)) {
          const fresh = randomBytes(24).toString('base64url');
          appendCookie(res, walletCookie(req, fresh));
          const prev = header(req, 'cookie');
          req.headers.cookie = `${WEB_WALLET_COOKIE}=${fresh}` + (prev ? '; ' + prev : '');
        }
      }
    } catch (err) {
      console.warn('[credits] wallet middleware', (err as Error)?.message);
    }
    next();
  }

  function applyHeaders(res: ResLike, result: { charged: number; balance: number | null }) {
    if (result.balance === null) return;
    res.setHeader(BALANCE_HEADER, String(result.balance));
    res.setHeader(CHARGED_HEADER, String(result.charged));
  }

  /** Writes CreditsError responses (402 / 400 / 426 / 503). Returns false for other errors. */
  function sendError(res: ResLike, err: unknown): boolean {
    if (!(err instanceof CreditsError)) return false;
    if (typeof err.body.balance === 'number') res.setHeader(BALANCE_HEADER, String(err.body.balance));
    res.status(err.status).json(err.body);
    return true;
  }

  const limited = (res: ResLike, wait: number) => {
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: 'rate_limited', retryAfter: wait });
  };

  const handlers = {
    /** GET /api/credits/balance — { enforced: false } unless this request pays. */
    async balance(req: ReqLike, res: ResLike) {
      res.setHeader('Cache-Control', 'no-store');
      const wait = balanceLimit.hit(clientIp(req));
      if (wait) return limited(res, wait);
      try {
        if (!isNativeRequest(req)) await webEnabled();
        const wallet = identify(req);
        if (!wallet) {
          res.status(200).json({ enforced: false });
          return;
        }
        const body = await balance(wallet);
        if (wallet.kind === 'web') appendCookie(res, walletCookie(req, wallet.id)); // renew the 400-day cookie
        res.setHeader(BALANCE_HEADER, String(body.balance));
        res.status(200).json(body);
      } catch (err) {
        if (sendError(res, err)) return;
        console.error('[credits] balance failed', (err as Error)?.message);
        res.status(503).json({ error: 'credits_unavailable' });
      }
    },

    /** POST /api/credits/purchase { productId, purchaseToken } — Play purchases from the Android app. */
    async purchase(req: ReqLike, res: ResLike) {
      res.setHeader('Cache-Control', 'no-store');
      const wait = purchaseIpLimit.hit(clientIp(req));
      if (wait) return limited(res, wait);
      try {
        const wallet = walletFor(req);
        if (!wallet || wallet.kind !== 'android') {
          res.status(403).json({ error: 'native_only' });
          return;
        }
        const w2 = purchaseUserLimit.hit(wallet.id);
        if (w2) return limited(res, w2);
        const out = await verifyPlay(wallet, req.body);
        if (typeof out.body.balance === 'number') res.setHeader(BALANCE_HEADER, String(out.body.balance));
        res.status(out.status).json(out.body);
      } catch (err) {
        if (sendError(res, err)) return;
        console.error('[credits] purchase failed', (err as Error)?.message);
        res.status(503).json({ error: 'credits_unavailable' });
      }
    },

    /** POST /api/credits/checkout { packId, returnUrl } — web: start a Stripe Checkout, answer { url }. */
    async checkout(req: ReqLike, res: ResLike) {
      res.setHeader('Cache-Control', 'no-store');
      const wait = checkoutIpLimit.hit(clientIp(req));
      if (wait) return limited(res, wait);
      try {
        if (isNativeRequest(req)) {
          res.status(403).json({ error: 'web_only' }); // Play Billing only inside the Android app
          return;
        }
        if (!(await webEnabled())) {
          res.status(403).json({ error: 'web_credits_off' });
          return;
        }
        const wallet = walletFor(req);
        if (!wallet || wallet.kind !== 'web') {
          res.status(402).json({ error: 'wallet_required' });
          return;
        }
        const w2 = checkoutWalletLimit.hit(wallet.id);
        if (w2) return limited(res, w2);
        await prepareWeb(wallet); // the buyer's address: starter credits before the first purchase
        const b = (req.body ?? {}) as { packId?: unknown; returnUrl?: unknown };
        const pack = packById(b.packId, 'stripe');
        const returnUrl = safeReturnUrl(b.returnUrl);
        if (!pack || !returnUrl) {
          res.status(400).json({ error: 'invalid' });
          return;
        }
        if (!(await stripe().configured())) {
          res.status(503).json({ error: 'checkout_unavailable' });
          return;
        }
        const s = await stripe().createCheckoutSession({ pack, walletId: wallet.id, app, returnUrl });
        console.log(`[credits] ${app}: checkout ${pack.id} for ${mask(wallet.id)}`);
        res.status(200).json({ url: s.url });
      } catch (err) {
        if (sendError(res, err)) return;
        console.error('[credits] checkout failed', err instanceof StripeApiError ? `${err.status} ${err.code}` : (err as Error)?.message);
        res.status(503).json({ error: 'checkout_unavailable' });
      }
    },

    /** POST /api/credits/stripe/confirm { sessionId } — the buyer is back from Checkout: credit now (the webhook is the backup). */
    async confirm(req: ReqLike, res: ResLike) {
      res.setHeader('Cache-Control', 'no-store');
      const wait = confirmIpLimit.hit(clientIp(req));
      if (wait) return limited(res, wait);
      try {
        const sessionId = typeof (req.body as { sessionId?: unknown } | undefined)?.sessionId === 'string' ? (req.body as { sessionId: string }).sessionId.trim() : '';
        if (!SESSION_RE.test(sessionId)) {
          res.status(400).json({ error: 'invalid' });
          return;
        }
        let session: StripeCheckoutSession;
        try {
          session = await stripe().retrieveCheckoutSession(sessionId);
        } catch (err) {
          if (err instanceof StripeApiError && (err.status === 404 || err.status === 400)) {
            res.status(400).json({ error: 'invalid_session' });
            return;
          }
          throw err;
        }
        const out = await fulfillSession(session);
        const wallet = isNativeRequest(req) ? null : walletFor(req);
        if (out.status === 200 && out.account && wallet?.key !== out.account) {
          // Paid in another browser: credited to the wallet that started the checkout.
          res.status(200).json({ ok: true, credited: out.body.credited, alreadyProcessed: out.body.alreadyProcessed, otherWallet: true });
          return;
        }
        if (typeof out.body.balance === 'number') res.setHeader(BALANCE_HEADER, String(out.body.balance));
        res.status(out.status).json(out.body);
      } catch (err) {
        if (sendError(res, err)) return;
        console.error('[credits] confirm failed', err instanceof StripeApiError ? `${err.status} ${err.code}` : (err as Error)?.message);
        res.status(503).json({ error: 'credits_unavailable' });
      }
    },

    /**
     * POST /api/credits/stripe/webhook — Stripe events, signature-checked over the RAW body: mount with
     * express.raw({ type: 'application/json' }) BEFORE any JSON parser. Register it once (any one app).
     */
    async webhook(req: ReqLike, res: ResLike) {
      const raw = req.body;
      if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) {
        console.error('[credits] Stripe webhook: mount with express.raw({ type: "application/json" }) before express.json()');
        res.status(400).json({ error: 'raw_body_required' });
        return;
      }
      const secret = await stripe()
        .webhookSecret()
        .catch(() => null);
      if (!secret) {
        res.status(503).json({ error: 'webhook_not_configured' });
        return;
      }
      let event: StripeEvent;
      try {
        event = verifyStripeSignature(raw, header(req, 'stripe-signature'), secret);
      } catch (err) {
        console.warn('[credits] Stripe webhook rejected:', err instanceof StripeApiError ? err.code : 'bad payload');
        res.status(400).json({ error: 'bad_signature' });
        return;
      }
      try {
        const what = await handleStripeEvent(event);
        if (!what.startsWith('ignored')) console.log(`[credits] Stripe ${event.type}: ${what}`);
        res.status(200).json({ received: true });
      } catch (err) {
        console.error('[credits] Stripe webhook processing failed', event.type, (err as Error)?.message);
        res.status(500).json({ error: 'processing_failed' });
      }
    },
  };

  /** Add credits to a wallet by hand (owner top-ups, goodwill). */
  async function grant(wallet: Wallet, credits: number, reason: string) {
    if (!Number.isInteger(credits) || credits <= 0) throw new Error('grant: invalid credits');
    return store.grant(wallet.key, meta(wallet), credits, reason.slice(0, 80), now());
  }

  return {
    packageName: pkg,
    walletFor,
    identify,
    run,
    balance,
    creditPurchase,
    verifyPlay,
    applyHeaders,
    sendError,
    handlers,
    middleware,
    webEnabled,
    grant,
    handleStripeEvent,
    store,
  };
}

export type Credits = ReturnType<typeof createCredits>;
