/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Prepaid AI credits. Today only the Android (Play) apps pay; the website is never affected.
//
// Three seams keep web credits (Stripe Checkout + a shared web wallet cookie) a small follow-up:
//  1. Wallets: walletFor(req) -> "android:<package>:<appUserId>" today, "web:<walletId>" later (resolveWebWallet).
//  2. Who pays: ONE policy function, mustPay(). Default: only native-app requests with an app user id.
//  3. Purchases: creditPurchase({ wallet, provider, externalId, packId }) is idempotent on (provider, externalId);
//     Play verification (verifyPlay) is one adapter in front of it, Stripe webhooks will be another.
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
  setHeader(name: string, value: string | number): unknown;
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
}
export type PayPolicy = (c: PayContext) => boolean;

/** Today's rule: only requests from the Android app with an app user id pay. The website stays free. */
export const defaultPayPolicy: PayPolicy = ({ native, wallet }) => native && wallet?.kind === 'android';

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
  /** Who must pay. Default defaultPayPolicy (native app only). Switch web on per app later. */
  mustPay?: PayPolicy;
  /** Web wallet id from the request (later: the shared mg_wallet cookie). Default: no web wallets. */
  resolveWebWallet?: (req: ReqLike) => string | null;
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
  const mustPay = options.mustPay ?? defaultPayPolicy;
  const legacy = options.legacyNativeClients ?? 'block';
  if (process.env.CREDITS_STORE === 'memory' && process.env.NODE_ENV === 'production') {
    console.error('[credits] CREDITS_STORE=memory in production: balances are lost on restart');
  }

  const balanceLimit = new Window(60, 60_000);
  const purchaseIpLimit = new Window(10, 60_000);
  const purchaseUserLimit = new Window(30, 60 * 60_000);

  const meta = (w: Wallet): AccountMeta => ({ kind: w.kind, app: w.app, id: w.id });

  /**
   * The wallet a request identifies, whether or not it must pay. Android: UA token + valid X-MG-App-User.
   * Web: options.resolveWebWallet (none today). Throws CreditsError 400 for a malformed app user id,
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
    const webId = options.resolveWebWallet?.(req) ?? null;
    if (webId && WEB_WALLET_RE.test(webId)) return { kind: 'web', key: walletKey.web(webId), id: webId, app: '*', provider: 'stripe' };
    return null;
  }

  /**
   * The wallet this request must pay from, or null when it doesn't pay (the website today).
   * Throws 402 wallet_required if the policy says pay but the request has no wallet (future web enforcement).
   */
  function identify(req: ReqLike): Wallet | null {
    const wallet = walletFor(req);
    if (!mustPay({ native: isNativeRequest(req), wallet, packageName: pkg })) return null;
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
      reserved = await store.reserve(wallet.key, meta(wallet), STARTER_CREDITS, holdId, estimate, HOLD_TTL_MS, now());
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
    const s = await store.ensure(wallet.key, meta(wallet), STARTER_CREDITS, now());
    if (s.created) console.log(`[credits] ${app}: new ${wallet.kind} wallet ${mask(wallet.id)} (+${STARTER_CREDITS} starter)`);
    return {
      enforced: true,
      balance: s.balance,
      available: s.available,
      starterCredits: STARTER_CREDITS,
      creditUsd: CREDIT_USD,
      provider: wallet.provider,
      packs: packsFor(wallet.provider).map((p) => ({ id: p.id, credits: p.credits, priceUsd: p.priceUsd })),
    };
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
        starter: STARTER_CREDITS,
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

  // ---------------------------------------------------------------- HTTP glue (Express-compatible)

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
        const wallet = identify(req);
        if (!wallet) {
          res.status(200).json({ enforced: false });
          return;
        }
        const body = await balance(wallet);
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
  };

  return { packageName: pkg, walletFor, identify, run, balance, creditPurchase, verifyPlay, applyHeaders, sendError, handlers, store };
}

export type Credits = ReturnType<typeof createCredits>;
