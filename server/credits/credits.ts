/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Prepaid AI credits: the Android (Play) apps always; the websites once the web switch is on.
//
//  1. Wallets: walletFor(req) -> "android:<package>:<appUserId>" (Android app) or "web:<walletId>" (the
//     mg_wallet cookie on .mohitgoenka.com, shared by every app; credits.middleware mints it).
//  2. Who pays: ONE policy function, mustPay(). Default: Android requests with an app user id, and web
//     requests while aiCreditConfig/web.enabled is true. Switch off: the websites are free, as before.
//  3. Purchases: creditPurchase({ wallet, provider, externalId, packId }) is idempotent on (provider, externalId).
//     Adapters: verifyPlay (Play Billing token) and Stripe Checkout (confirm on return + signed webhook).
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  APP_USER_HEADER,
  APP_USER_RE,
  BALANCE_HEADER,
  CHARGED_HEADER,
  CREDIT_USD,
  HOLD_TTL_MS,
  NATIVE_UA_TOKEN,
  STARTER_BUDGET_SHARDS,
  STARTER_CREDITS,
  STARTER_PER_IP,
  STARTER_PER_IP_ANDROID,
  STARTER_WINDOW_MS,
  PLAY_VOIDED_SYNC_MS,
  starterDailyCap,
  WEB_COOKIE_DOMAIN,
  WEB_WALLET_COOKIE,
  WEB_WALLET_MAX_AGE_S,
  OWNER_CODE_SECRET,
  PROMO_CODE_RE,
  normalizePromoCode,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_MS,
  normalizeLinkCode,
  packById,
  packsFor,
  customPack,
  CUSTOM_PACK_ID,
  CUSTOM_MIN_CREDITS,
  CUSTOM_MAX_CREDITS,
  CUSTOM_CURVE,
} from './config.ts';
import type { PaymentProvider } from './config.ts';
import { costOfCall, usageOf } from './pricing.ts';
import type { CallUsage } from './pricing.ts';
import { FirestoreCreditStore } from './firestore-store.ts';
import { MemoryCreditStore, utcDay } from './store.ts';
import type { AccountMeta, CreditStore, StarterState } from './store.ts';
import { GooglePlayApi, PlayApiError } from './play.ts';
import type { PlayApi, VoidedPurchase } from './play.ts';
import { SecretSource, StripeApiError, StripeRestApi, verifyStripeSignature } from './stripe.ts';
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
  /** Client address of the request (limits starter grants per address: IPv4, IPv6 /64). */
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
  /** Secrets (owner code). Default: env, else Secret Manager. */
  secrets?: { get(spec: { secret: string; env: string }): Promise<string | null> };
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
  /** Global starter grants per UTC day across all apps. Default: env STARTER_DAILY_CAP, else 3000. 0 pauses them. */
  starterDailyCap?: number;
  /**
   * Reverse Play refunds / chargebacks (purchases.voidedpurchases.list), checked at most every 6 h per package,
   * kicked off in the background by Android balance and purchase requests. Default true.
   */
  playVoidedSync?: boolean;
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

/**
 * The key a client address is counted under: an IPv4 address as is (also IPv4-mapped IPv6), an IPv6 address by
 * its /64 (one home or phone gets a whole /64, so per-address limits must not be dodged by rotating the rest).
 */
/** Starter grants allowed per address in STARTER_WINDOW_MS for this wallet's kind. */
const perAddressOf = (w: { kind?: string }) => (w.kind === 'android' ? STARTER_PER_IP_ANDROID : STARTER_PER_IP);

export function ipKey(ip: string): string {
  let a = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = a.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1]!;
  if (!a.includes(':')) return a || 'unknown';
  // Embedded IPv4 tail (::ffff:0:1.2.3.4, 64:ff9b::1.2.3.4): as two hextets.
  const tail = a.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [b1, b2, b3, b4] = tail.slice(1).map(Number) as [number, number, number, number];
    a = a.slice(0, tail.index) + ((b1 << 8) | b2).toString(16) + ':' + ((b3 << 8) | b4).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return a;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(Math.max(0, 8 - head.length - rest.length)).fill('0'), ...rest] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return a;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}
/** Rate-limit key of a request: its address, IPv6 by /64. */
const ipOf = (req: ReqLike) => ipKey(clientIp(req));
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

/**
 * Starter-grant counter key for a client address (IPv4 as is, IPv6 by its /64), counted separately for web and
 * Android wallets. Salted hash, never the address.
 */
function addressKey(ip: string, kind: WalletKind = 'web'): string {
  return sha256('mg-credits-starter:' + (kind === 'android' ? 'android:' : '') + ipKey(ip));
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
  /** Like hit() but without counting: 0 = a hit would be allowed now. */
  peek(key: string, now = Date.now()): number {
    const b = this.hits.get(key);
    if (!b || b.resetAt <= now || b.count < this.limit) return 0;
    return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  }
}

const TOKEN_RE = /^[A-Za-z0-9._:\-]{20,4096}$/;
/** The redeem field: `{ code }` (current clients) or `{ ownerCode }` (older ones). */
const codeOf = (body: unknown): string | undefined => {
  const b = body as { code?: unknown; ownerCode?: unknown } | undefined;
  return typeof b?.code === 'string' ? b.code : typeof b?.ownerCode === 'string' ? b.ownerCode : undefined;
};

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
  const ownerIpLimit = new Window(5, 60 * 60_000);
  const ownerWalletLimit = new Window(5, 24 * 60 * 60_000);
  const linkCreateLimit = new Window(10, 60 * 60_000);
  const secrets = options.secrets ?? new SecretSource();

  const meta = (w: Wallet): AccountMeta => ({ kind: w.kind, app: w.app, id: w.id });
  const webWallet = (id: string, address?: string): Wallet => ({ kind: 'web', key: walletKey.web(id), id, app: '*', provider: 'stripe', ...(address ? { address } : {}) });

  // ---- starter Sparks: per address (rolling 24 h) + a global daily budget; granted lazily (prepareWallet).
  const dailyCap = options.starterDailyCap ?? starterDailyCap();
  const perShard = Math.ceil(dailyCap / STARTER_BUDGET_SHARDS);
  /** Today's budget as this instance knows it: full = no more grants today (re-read at most once a minute). */
  const budget = { day: '', full: false, checkedAt: 0 };
  const budgetToday = () => {
    const day = utcDay(now());
    if (budget.day !== day) Object.assign(budget, { day, full: false, checkedAt: 0 });
    return day;
  };
  /** Cheap view: false once a claim failed today (or the cap is 0). With `read`, also checks the shared counter (≤ 1/min). */
  async function budgetOpen(read = false): Promise<boolean> {
    if (dailyCap <= 0) return false;
    const day = budgetToday();
    if (budget.full) return false;
    if (read && Date.now() - budget.checkedAt > 60_000) {
      budget.checkedAt = Date.now();
      try {
        budget.full = (await store.starterBudgetUsed(day)) >= perShard * STARTER_BUDGET_SHARDS;
      } catch (err) {
        console.warn('[credits] starter budget read failed', (err as Error)?.message);
      }
    }
    return !budget.full;
  }
  /** What a balance read shows a wallet whose starter is still open (nothing is written). */
  async function starterPreview(w: Wallet): Promise<'granted' | 'paused' | 'address_limit'> {
    if (!(await budgetOpen(true))) return 'paused';
    const ok = await store.claimStarter(addressKey(w.address ?? 'unknown', w.kind), perAddressOf(w), STARTER_WINDOW_MS, now(), true).catch(() => true);
    return ok ? 'granted' : 'address_limit';
  }

  /** Wallets whose account exists and whose starter question is settled (skips a Firestore round trip per AI call). */
  const known = new Set<string>();
  /** One prepare per wallet at a time on this instance (concurrent first actions share it). */
  const preparing = new Map<string, Promise<void>>();
  /**
   * Before a wallet's first metered action or explicit claim (purchase, checkout, promo code, link code): make sure
   * its account exists (created with starterState 'pending' in the same transaction) and, while the starter is
   * 'pending' or 'paused', run the one-transaction grant (address slot + daily budget + Sparks together; nothing is
   * counted unless the grant happens). Every caller awaits it, so a second concurrent first action reserves against
   * the granted balance, not 0 (across instances the transaction makes it 'already'). A 'paused' wallet is tried
   * again on a later action once there is budget; 'pending' stays until the grant or a definite refusal.
   */
  function prepareWallet(w: Wallet): Promise<void> {
    if (known.has(w.key)) return Promise.resolve();
    let p = preparing.get(w.key);
    if (!p) {
      p = prepareOnce(w).finally(() => preparing.delete(w.key));
      preparing.set(w.key, p);
    }
    return p;
  }
  async function prepareOnce(w: Wallet): Promise<void> {
    const s = await store.ensure(w.key, meta(w), 0, now());
    const state = s.starterState;
    if (state === 'pending' || state === 'paused') {
      if (state === 'paused' && !(await budgetOpen())) return; // still paused today
      const { outcome } = await store.claimStarterGrant(
        w.key,
        meta(w),
        STARTER_CREDITS,
        { addressKey: addressKey(w.address ?? 'unknown', w.kind), perAddress: perAddressOf(w), windowMs: STARTER_WINDOW_MS, day: budgetToday(), dailyCap, shards: STARTER_BUDGET_SHARDS },
        now(),
      );
      if (outcome === 'paused') {
        if (!budget.full) console.warn(`[credits] starter budget for ${budget.day} used up (${dailyCap}/day): new wallets start at 0`);
        budget.full = true;
      }
      if (outcome !== 'already') console.log(`[credits] ${app}: ${state} ${w.kind} wallet ${mask(w.id)} (${outcome === 'granted' ? '+' + STARTER_CREDITS + ' starter' : 'no starter: ' + outcome})`);
      if (outcome === 'paused') return;
    }
    if (known.size > 50_000) known.clear();
    known.add(w.key);
  }

  /**
   * Linked browsers: a web wallet that joined another one (mergedInto) is followed, so every browser in a
   * linked group keeps spending the same Sparks even after the group itself joins another device.
   * Cached per instance: a followed link for a day, "not linked" for a minute.
   */
  const webLinks = new Map<string, { to: string; until: number }>();
  async function currentWeb(w: Wallet): Promise<Wallet> {
    if (w.kind !== 'web') return w;
    const t = Date.now();
    let to = webLinks.get(w.key);
    if (!to || to.until <= t) {
      const resolved = await store.resolveAccount(w.key);
      if (webLinks.size > 50_000) webLinks.clear();
      to = { to: resolved, until: t + (resolved === w.key ? 60_000 : 24 * 60 * 60_000) };
      webLinks.set(w.key, to);
    }
    return to.to === w.key ? w : webWallet(to.to.slice('web:'.length), w.address);
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
      return { kind: 'android', key: walletKey.android(pkg, id), id, app: pkg, provider: 'play', address: clientIp(req) };
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
    wallet = await currentWeb(wallet).catch(() => wallet!);

    const holdId = randomBytes(9).toString('hex');
    const estimate = Math.max(1, Math.ceil(Number.isFinite(opts.estimate) ? opts.estimate : 1));
    let reserved;
    try {
      await prepareWallet(wallet);
      reserved = await store.reserve(wallet.key, meta(wallet), 0, holdId, estimate, HOLD_TTL_MS, now());
    } catch (err) {
      console.error('[credits] reserve failed for', mask(wallet.id), (err as Error)?.message);
      throw new CreditsError(503, 'credits_unavailable');
    }
    const owner = reserved.owner === true;
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
          owner,
        },
        at,
      );
      return { value, charged: owner ? 0 : credits, balance };
    } catch (err) {
      // The user already has the result; the hold expires on its own. Log loudly, don't fail the request.
      console.error('[credits] settle failed for', mask(wallet.id), credits, 'credits', (err as Error)?.message);
      return { value, charged: 0, balance: owner ? reserved.balance : reserved.balance - estimate };
    }
  }

  /**
   * Balance answer. A wallet without an account yet is NOT created here (a balance read never grants the
   * starter): it shows the starter it will get on its first AI action (starterPending), or 0 with the reason.
   */
  async function balance(wallet: Wallet) {
    const s = await store.getAccount(wallet.key, now());
    // No account yet = 'pending'. Pending / paused: show what the next action will get (or why not).
    const state: StarterState | undefined = s ? s.starterState : 'pending';
    let missed: 'paused' | 'address_limit' | null = state === 'address_limit' ? 'address_limit' : null;
    let pending = false;
    if (state === 'pending' || state === 'paused') {
      const preview = await starterPreview(wallet);
      pending = preview === 'granted';
      missed = pending ? null : preview === 'granted' ? null : preview;
    }
    const bal = (s?.balance ?? 0) + (pending ? STARTER_CREDITS : 0);
    const avail = (s?.available ?? 0) + (pending ? STARTER_CREDITS : 0);
    const body: Record<string, unknown> = {
      enforced: true,
      balance: bal,
      available: avail,
      starterCredits: STARTER_CREDITS,
      creditUsd: CREDIT_USD,
      provider: wallet.provider,
      packs: packsFor(wallet.provider).map((p) => ({ id: p.id, credits: p.credits, priceUsd: p.priceUsd })),
    };
    if (s?.owner) body.owner = true;
    if (s?.paid) body.paid = true; // has bought Sparks (the kit allows speculative AI for paying users)
    if (pending) body.starterPending = true;
    if (missed === 'paused') body.starterPaused = true; // free starter Sparks are paused for today (global budget)
    if (missed === 'address_limit') body.starterLimited = true; // this network already used its free starters
    if (wallet.kind === 'web') {
      body.checkout = await stripe()
        .configured()
        .catch(() => false);
      body.taxNote = 'Taxes (like VAT) are added at checkout and shown before you pay.';
      // "Choose your amount": any whole number of Sparks in range, priced on one curve through the fixed packs.
      body.custom = { id: CUSTOM_PACK_ID, min: CUSTOM_MIN_CREDITS, max: CUSTOM_MAX_CREDITS, curve: CUSTOM_CURVE };
    }
    return body as { enforced: true; balance: number; available: number } & Record<string, unknown>;
  }

  const purchaseKeyOf = (provider: PaymentProvider, externalId: string) => `${provider}:${sha256(externalId)}`;

  /**
   * Credit a verified payment to a wallet, at most once per (provider, externalId) and per secondary id.
   * Provider-agnostic: call it from the Play adapter (verifyPlay) or a Stripe webhook.
   */
  async function creditPurchase(p: CreditPurchaseInput) {
    // Custom web amounts (Stripe only) carry their Sparks in p.credits, checked against the curve.
    const pack = p.packId === CUSTOM_PACK_ID && p.provider === 'stripe' ? customPack(p.credits) : packById(p.packId, p.provider);
    if (!pack) throw new Error('creditPurchase: unknown pack ' + String(p.packId));
    const credits = p.credits ?? pack.credits;
    if (!Number.isInteger(credits) || credits <= 0) throw new Error('creditPurchase: invalid credits');
    const secondaryKeys = (p.secondaryIds ?? []).filter((s) => SECONDARY_RE.test(s)).map((s) => `${p.provider}:${s}`);
    // A web wallet that was linked into another one: its late purchases go to the wallet it joined.
    const key = p.wallet.kind === 'web' ? await store.resolveAccount(p.wallet.key) : p.wallet.key;
    const result = await store.creditPurchase(
      {
        key,
        meta: meta(p.wallet),
        starter: 0,
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
    await prepareWallet(wallet); // buying is an explicit claim: the starter comes first

    // Already credited (retry after a lost response or a crash before consume): finish the consume, report ok.
    const prior = await store.getPurchase(purchaseKey);
    if (prior) {
      if (prior.account !== wallet.key) return { status: 403, body: { error: 'account_mismatch' } };
      if (!prior.finalized) await consume(pack.id, token, purchaseKey);
      const s = await store.ensure(wallet.key, meta(wallet), 0, now());
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

  // ---- Play refunds: voided purchases (refund, chargeback, revoke) take their Sparks back.

  const VOIDED_SYNC = `play-voided:${pkg}`;
  const VOIDED_MAX_AGE_MS = 30 * 24 * 60 * 60_000 - 60_000; // the API answers at most 30 days back
  const VOIDED_OVERLAP_MS = 60 * 60_000; // re-read the last hour (reversal is idempotent)
  const VOIDED_RETRY_MS = 10 * 60_000; // after a failed run
  const VOIDED_REASONS: Record<number, string> = { 1: 'remorse', 2: 'not received', 3: 'defective', 4: 'accidental', 5: 'fraud', 6: 'friendly fraud', 7: 'chargeback', 8: 'unacknowledged' };

  async function reverseVoided(v: VoidedPurchase): Promise<number> {
    const token = typeof v.purchaseToken === 'string' ? v.purchaseToken : '';
    const reason = 'play refund' + (typeof v.voidedReason === 'number' && VOIDED_REASONS[v.voidedReason] ? ` (${VOIDED_REASONS[v.voidedReason]})` : '');
    // One reversal per voided record (a purchase can have several quantity-based partial refunds), idempotent on
    // the record: token + voided time + quantity. A record without voidedQuantity takes back what is left.
    const q = Number(v.voidedQuantity);
    const partial = Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
    const reversalId = sha256(`play-voided|${token || v.orderId || ''}|${v.voidedTimeMillis ?? ''}|${partial || 'all'}`).slice(0, 24);
    let r: Awaited<ReturnType<CreditStore['reversePurchaseOnce']>> = null;
    if (TOKEN_RE.test(token)) {
      const purchaseKey = purchaseKeyOf('play', token);
      const rec = await store.getPurchase(purchaseKey);
      if (rec) {
        const pack = packById(rec.productId, 'play');
        const credits = partial && pack ? partial * pack.credits : rec.credits;
        r = await store.reversePurchaseOnce({ purchaseKey }, reversalId, credits, reason, now());
      }
    }
    if (!r && typeof v.orderId === 'string' && SECONDARY_RE.test(v.orderId)) {
      // Token not in our ledger (another token of the same order): find it by the Play orderId, take back what is left.
      r = await store.reversePurchaseOnce({ secondaryKey: `play:${v.orderId}` }, reversalId, Number.MAX_SAFE_INTEGER, reason, now());
    }
    if (r?.reversed) console.log(`[credits] ${app}: -${r.reversed} (${reason}) for ${mask(r.account.split(':').pop() ?? '')}, balance ${r.balance}`);
    return r?.reversed ?? 0;
  }

  /**
   * Fetch this app's voided Play purchases since the last checkpoint (Firestore aiCreditSync/play-voided:<pkg>)
   * and reverse their Sparks (idempotent, like Stripe refunds; the balance may go negative). Runs at most once per
   * PLAY_VOIDED_SYNC_MS across all instances unless `force`. Uses the same ADC / Play API access as verifyPlay.
   */
  async function syncPlayVoided(opts: { force?: boolean } = {}): Promise<{ ran: boolean; voided: number; reversed: number }> {
    if (typeof play.listVoidedPurchases !== 'function') return { ran: false, voided: 0, reversed: 0 };
    if (opts.force) await store.deferSyncRun(VOIDED_SYNC, now());
    const lease = await store.claimSyncRun(VOIDED_SYNC, PLAY_VOIDED_SYNC_MS, now());
    if (!lease.ok) return { ran: false, voided: 0, reversed: 0 };
    const endTime = now().getTime();
    const startTime = Math.max(endTime - VOIDED_MAX_AGE_MS, (lease.checkpoint ?? 0) - VOIDED_OVERLAP_MS);
    let token: string | null = null;
    let voided = 0;
    let reversed = 0;
    try {
      for (let page = 0; page < 20; page++) {
        const res = await play.listVoidedPurchases(pkg, { startTime, endTime, token });
        for (const v of res.voidedPurchases) {
          voided++;
          reversed += await reverseVoided(v);
        }
        token = res.nextPageToken;
        if (!token) break;
      }
      await store.saveSyncCheckpoint(VOIDED_SYNC, endTime, now());
    } catch (err) {
      // A failed run is tried again in ~10 minutes (any instance), not after the full 6 h; the checkpoint stays.
      await store.deferSyncRun(VOIDED_SYNC, new Date(now().getTime() + VOIDED_RETRY_MS)).catch(() => {});
      throw err;
    }
    if (voided) console.log(`[credits] ${app}: Play voided purchases: ${voided} seen, ${reversed} Sparks reversed`);
    return { ran: true, voided, reversed };
  }

  /** Fire-and-forget voided sync (no scheduler): at most every 6 h per instance; errors are logged and retried in 10 min. */
  let voidedNextAt = 0;
  function maybeSyncPlayVoided() {
    if (options.playVoidedSync === false || typeof play.listVoidedPurchases !== 'function') return;
    const t = Date.now();
    if (t < voidedNextAt) return;
    voidedNextAt = t + PLAY_VOIDED_SYNC_MS;
    void syncPlayVoided().catch((err) => {
      voidedNextAt = Date.now() + VOIDED_RETRY_MS;
      const status = err instanceof PlayApiError ? err.status : 0;
      console.warn('[credits] Play voided purchases sync failed', status || (err as Error)?.message);
    });
  }

  // ---- Stripe adapter (web): Checkout Session -> credits, once per session id and payment intent.

  /** Credit a Checkout Session the server created (metadata is server-set, so it is trusted once retrieved or signed). */
  async function fulfillSession(s: StripeCheckoutSession): Promise<{ status: number; body: Record<string, unknown>; account?: string }> {
    const md = s.metadata ?? {};
    const walletId = typeof md.mg_wallet === 'string' ? md.mg_wallet : '';
    const pack = md.mg_pack === CUSTOM_PACK_ID ? customPack(md.mg_credits) : packById(md.mg_pack, 'stripe');
    if ((s.mode && s.mode !== 'payment') || !WEB_WALLET_RE.test(walletId) || !pack) return { status: 400, body: { error: 'invalid_session' } };
    // Custom amounts: the price paid (before tax) must match the curve for the Sparks promised.
    if (pack.id === CUSTOM_PACK_ID && typeof s.amount_subtotal === 'number' && s.amount_subtotal !== Math.round(pack.priceUsd * 100)) {
      console.error(`[credits] ${app}: custom session ${mask(s.id)} paid ${s.amount_subtotal}¢ for ${pack.credits} Sparks (curve ${Math.round(pack.priceUsd * 100)}¢)`);
      return { status: 400, body: { error: 'invalid_session' } };
    }
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
      case 'charge.dispute.closed': {
        // Won disputes (status "won"): Stripe returns the money, so the Sparks the dispute took come back.
        // Needs the charge.dispute.closed event enabled on the webhook endpoint in the Stripe Dashboard.
        if (obj.status !== 'won') return 'ignored (dispute not won)';
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : '';
        if (!pi) return 'ignored (no payment intent)';
        const r = await store.reversePurchase({ secondaryKey: `stripe:${pi}` }, 0, 'dispute_won', now());
        if (!r) return 'ignored (unknown purchase)';
        if (r.reversed < 0) console.log(`[credits] ${app}: +${-r.reversed} (dispute won) for ${mask(r.account.replace(/^web:/, ''))}, balance ${r.balance}`);
        return `dispute won restored ${-r.reversed}`;
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

  // ---- Owner code: Mohit's own devices use AI without paying (charges still logged, never deducted).

  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  /** Check an owner code and mark the wallet as owner. Answers like the other handlers. */
  /**
   * The "Have a promo code?" field: the owner code (wallet becomes an owner wallet: AI free, still logged)
   * or a promo code from aiCreditPromos (adds its credits once per wallet). Rate limited per IP and wallet.
   */
  async function redeemCode(wallet: Wallet, raw: unknown, req: ReqLike): Promise<{ status: number; body: Record<string, unknown> }> {
    const code = typeof raw === 'string' ? raw.trim() : '';
    // Only unknown codes count (5 per hour per address, 5 per day per wallet): friends redeeming a shared code
    // on one Wi-Fi aren't blocked (nor by an expired or used-up code), guessing is.
    const wait = Math.max(ownerIpLimit.peek(ipOf(req)), ownerWalletLimit.peek(wallet.key));
    if (wait) return { status: 429, body: { error: 'rate_limited', retryAfter: wait } };
    const miss = (error: string) => {
      if (error === 'wrong_code') {
        ownerIpLimit.hit(ipOf(req));
        ownerWalletLimit.hit(wallet.key);
      }
      return { status: 403, body: { error } };
    };
    if (!code || code.length > 200) return { status: 400, body: { error: 'invalid' } };
    let secret: string | null = null;
    try {
      secret = await secrets.get(OWNER_CODE_SECRET);
    } catch {
      secret = null;
    }
    const prepare = () => prepareWallet(wallet);
    if (secret && timingSafeEqual(sha(code), sha(secret))) {
      await prepare();
      const r = await store.setOwner(wallet.key, meta(wallet), true, `code (${app})`, now());
      console.log(`[credits] ${app}: owner mode on for ${wallet.kind} wallet ${mask(wallet.id)}`);
      return { status: 200, body: { ok: true, owner: true, balance: r.balance } };
    }
    const promo = normalizePromoCode(code);
    if (!PROMO_CODE_RE.test(promo)) return miss('wrong_code');
    await prepare();
    const r = await store.redeemPromo(promo, wallet.key, meta(wallet), 0, now());
    if (r.ok === false) {
      console.warn(`[credits] ${app}: promo ${r.error === 'promo_unknown' ? 'unknown code' : `${promo} ${r.error}`} for ${wallet.kind} wallet ${mask(wallet.id)}`);
      return miss(r.error === 'promo_unknown' ? 'wrong_code' : r.error);
    }
    console.log(`[credits] ${app}: promo ${promo} +${r.credits} for ${wallet.kind} wallet ${mask(wallet.id)}`);
    return { status: 200, body: { ok: true, promo: true, credited: r.credits, balance: r.balance } };
  }

  /**
   * "Use your Sparks on another device" (web only). `create`: a 6-character code for this browser's wallet,
   * valid 10 minutes, one use (stored as a hash). `join`: this browser joins the wallet the code was made
   * for: its own Sparks (and owner flag) move there and its mg_wallet cookie switches to that wallet, so
   * both browsers spend one balance in every *.mohitgoenka.com app. Only wrong codes count toward the limit.
   */
  async function linkWeb(req: ReqLike, res: ResLike, body: { linkAction?: unknown; linkCode?: unknown }): Promise<{ status: number; body: Record<string, unknown> }> {
    if (isNativeRequest(req)) return { status: 403, body: { error: 'web_only' } };
    if (!(await webEnabled())) return { status: 403, body: { error: 'web_credits_off' } };
    let wallet = walletFor(req);
    if (body.linkAction === 'create') {
      if (!wallet || wallet.kind !== 'web') return { status: 402, body: { error: 'wallet_required' } };
      const wait = linkCreateLimit.hit(wallet.key);
      if (wait) return { status: 429, body: { error: 'rate_limited', retryAfter: wait } };
      await prepareWallet(wallet);
      const target = await store.resolveAccount(wallet.key);
      const code = Array.from({ length: LINK_CODE_LENGTH }, () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)]).join('');
      await store.createLinkCode(createHash('sha256').update(code).digest('hex'), target, new Date(now().getTime() + LINK_CODE_TTL_MS), now());
      console.log(`[credits] ${app}: link code made for web wallet ${mask(wallet.id)}`);
      return { status: 200, body: { ok: true, code, expiresInSeconds: Math.round(LINK_CODE_TTL_MS / 1000) } };
    }
    const code = typeof body.linkCode === 'string' ? normalizeLinkCode(body.linkCode) : '';
    const ip = clientIp(req);
    const waitIp = ownerIpLimit.peek(ipKey(ip));
    if (waitIp) return { status: 429, body: { error: 'rate_limited', retryAfter: waitIp } };
    if (code.length !== LINK_CODE_LENGTH) return { status: 400, body: { error: 'invalid' } };
    const targetKey = await store.takeLinkCode(createHash('sha256').update(code).digest('hex'), now());
    if (!targetKey || !targetKey.startsWith('web:')) {
      ownerIpLimit.hit(ipKey(ip));
      return { status: 403, body: { error: 'wrong_link_code' } };
    }
    if (!wallet || wallet.kind !== 'web') {
      const fresh = randomBytes(24).toString('base64url');
      wallet = webWallet(fresh, ip);
    }
    // The whole group this browser is in joins (its other linked browsers follow on their next visit).
    const group = await currentWeb(wallet);
    if (group.key === targetKey) return { status: 200, body: { ok: true, linked: true, moved: 0, alreadyLinked: true } };
    const r = await store.mergeAccounts(group.key, targetKey, app, now());
    webLinks.set(group.key, { to: targetKey, until: Date.now() + 24 * 60 * 60_000 });
    webLinks.delete(wallet.key);
    const targetId = targetKey.slice('web:'.length);
    appendCookie(res, walletCookie(req, targetId));
    console.log(`[credits] ${app}: web wallet ${mask(wallet.id)} linked into ${mask(targetId)} (+${r.moved})`);
    return { status: 200, body: { ok: true, linked: true, moved: r.moved, balance: r.balance, owner: r.owner } };
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
      const wait = balanceLimit.hit(ipOf(req));
      if (wait) return limited(res, wait);
      try {
        if (!isNativeRequest(req)) await webEnabled();
        const wallet = identify(req);
        if (!wallet) {
          res.status(200).json({ enforced: false });
          return;
        }
        if (wallet.kind === 'android') maybeSyncPlayVoided();
        const current = await currentWeb(wallet);
        const body = await balance(current);
        // Renew the 400-day cookie; a browser whose wallet was linked into another switches to it here.
        if (current.kind === 'web') appendCookie(res, walletCookie(req, current.id));
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
      const wait = purchaseIpLimit.hit(ipOf(req));
      if (wait) return limited(res, wait);
      try {
        const wallet = walletFor(req);
        if (!wallet || wallet.kind !== 'android') {
          res.status(403).json({ error: 'native_only' });
          return;
        }
        const code = codeOf(req.body);
        if (code !== undefined) {
          // Owner / promo codes ride on this route so apps need no extra wiring (same-origin, JSON, native wallet).
          const o = await redeemCode(wallet, code, req);
          res.status(o.status).json(o.body);
          return;
        }
        const w2 = purchaseUserLimit.hit(wallet.id);
        if (w2) return limited(res, w2);
        maybeSyncPlayVoided();
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
      const wait = checkoutIpLimit.hit(ipOf(req));
      if (wait) return limited(res, wait);
      try {
        const lb = (req.body ?? {}) as { linkAction?: unknown; linkCode?: unknown };
        if (lb.linkAction === 'create' || typeof lb.linkCode === 'string') {
          // Browser linking rides on this route too (same-origin, JSON): no extra wiring in the apps.
          const o = await linkWeb(req, res, lb);
          res.status(o.status).json(o.body);
          return;
        }
        const ownerCode = codeOf(req.body);
        if (ownerCode !== undefined && !isNativeRequest(req)) {
          // Owner / promo codes on the web ride on this route (same-origin, JSON). Works with the web switch off
          // too: the wallet cookie is minted here if needed, so the wallet is ready before the switch goes on.
          let wallet = walletFor(req);
          if (!wallet || wallet.kind !== 'web') {
            const fresh = randomBytes(24).toString('base64url');
            appendCookie(res, walletCookie(req, fresh));
            wallet = webWallet(fresh, clientIp(req));
          }
          const o = await redeemCode(wallet, ownerCode, req);
          res.status(o.status).json(o.body);
          return;
        }
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
        await prepareWallet(wallet); // the buyer's address: starter credits before the first purchase
        const b = (req.body ?? {}) as { packId?: unknown; credits?: unknown; returnUrl?: unknown };
        const pack = b.packId === CUSTOM_PACK_ID ? customPack(b.credits) : packById(b.packId, 'stripe');
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
        console.log(`[credits] ${app}: checkout ${pack.id}${pack.id === CUSTOM_PACK_ID ? ' ' + pack.credits : ''} for ${mask(wallet.id)}`);
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
      const wait = confirmIpLimit.hit(ipOf(req));
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
    syncPlayVoided,
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
