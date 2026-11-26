/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Stripe Checkout with Managed Payments (Stripe, through Link, is the merchant of record: it collects and
// remits sales tax / VAT, handles fraud, disputes and payment support). No Stripe SDK: fetch + form encoding.
//
// Secrets (never logged, never sent to the browser):
//   CREDITS_STRIPE_SECRET_KEY      env, else Secret Manager "stripe-secret-key"      (projects/<GOOGLE_CLOUD_PROJECT>)
//   CREDITS_STRIPE_WEBHOOK_SECRET  env, else Secret Manager "stripe-webhook-secret"
// (CREDITS_ prefix: Eve's own subscription code uses STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.)
// Missing key: web checkout is simply unavailable (the balance answer says checkout: false).
//
// Prices are created once per pack by lookup key (stripeLookupKey) with the AIaaS tax code and
// tax_behavior "exclusive": the buyer pays tax on top of the US list price.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CUSTOM_PACK_ID, STRIPE_API_VERSION, STRIPE_SECRETS, STRIPE_TAX_CODE, TERMS_URL, stripeLookupKey } from './config.ts';

/** What a checkout sells: Sparks for this browser (default), a one-use gift code, or a tip with Sparks as thanks. */
export type CheckoutKind = 'sparks' | 'gift' | 'tip';
import type { PackInfo } from './config.ts';

export interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  mode?: string;
  /** open | complete | expired */
  status?: string;
  /** paid | unpaid | no_payment_required */
  payment_status?: string;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  /** Before tax (Managed Payments adds tax on top). */
  amount_subtotal?: number | null;
  currency?: string | null;
  livemode?: boolean;
}

export interface CheckoutInput {
  pack: PackInfo;
  walletId: string;
  /** Short app name for the ledger and Stripe metadata ("spinner"). */
  app: string;
  /** Absolute https URL the buyer returns to (validated by the caller). */
  returnUrl: string;
  /** Default 'sparks'. Gifts and tips are priced inline (no saved Stripe products needed). */
  kind?: CheckoutKind;
}

/** A Stripe event as delivered to the webhook (only the fields we read). */
export interface StripeEvent {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

export interface StripeApi {
  /** A secret key is available (checkout can work). */
  configured(): Promise<boolean>;
  createCheckoutSession(input: CheckoutInput): Promise<{ id: string; url: string }>;
  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  /** The webhook signing secret (null: webhooks are refused). */
  webhookSecret(): Promise<string | null>;
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`Stripe API error ${status} ${code}`);
    this.name = 'StripeApiError';
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- helpers

/** Stripe's form encoding: a[b][0][c]=v. */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
    else parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  };
  walk(obj, prefix);
  return parts.join('&');
}

/** Add query parameters to a URL ({CHECKOUT_SESSION_ID} is kept literal for Stripe to fill in). */
export function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const k of ['mg_credits', 'mg_session']) u.searchParams.delete(k);
  let s = u.toString();
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${v === '{CHECKOUT_SESSION_ID}' ? v : encodeURIComponent(v)}`)
    .join('&');
  const hash = s.indexOf('#');
  const frag = hash >= 0 ? s.slice(hash) : '';
  if (hash >= 0) s = s.slice(0, hash);
  return s + (s.includes('?') ? '&' : '?') + q + frag;
}

/**
 * Verify a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=…]") over the RAW request body.
 * Throws on a bad or stale signature. Returns the parsed event.
 */
export function verifyStripeSignature(rawBody: string | Buffer, header: string, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): StripeEvent {
  if (!header || !secret) throw new StripeApiError(400, 'signature_missing');
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    const k = i > 0 ? part.slice(0, i).trim() : '';
    const v = i > 0 ? part.slice(i + 1).trim() : '';
    if (k === 't') t = v;
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || !sigs.length) throw new StripeApiError(400, 'signature_malformed');
  if (Math.abs(nowSec - Number(t)) > toleranceSec) throw new StripeApiError(400, 'signature_stale');
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new StripeApiError(400, 'signature_invalid');
  const event = JSON.parse(body) as StripeEvent;
  if (!event || typeof event.type !== 'string' || !event.data || typeof event.data.object !== 'object') throw new StripeApiError(400, 'event_malformed');
  return event;
}

/** Build a Stripe-Signature header (tests and local webhook replays). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------- secrets

type SecretSpec = { secret: string; env: string };
const SM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Reads a secret from the env, else Secret Manager (latest version). Caches values 10 min, misses 1 min. */
export class SecretSource {
  private readonly cache = new Map<string, { value: string | null; until: number }>();
  private clientPromise: Promise<{ getAccessToken(): Promise<{ token?: string | null }> }> | null = null;
  private readonly projectId: string;
  constructor(projectId = process.env.GOOGLE_CLOUD_PROJECT || 'public-mohit-260610') {
    this.projectId = projectId;
  }

  async get(spec: SecretSpec): Promise<string | null> {
    const fromEnv = process.env[spec.env]?.trim();
    if (fromEnv) return fromEnv;
    const hit = this.cache.get(spec.secret);
    if (hit && hit.until > Date.now()) return hit.value;
    let value: string | null = null;
    try {
      value = await this.access(spec.secret);
    } catch (err) {
      console.warn(`[credits] secret ${spec.secret} unavailable:`, (err as Error)?.message);
    }
    this.cache.set(spec.secret, { value, until: Date.now() + (value ? 10 * 60_000 : 60_000) });
    return value;
  }

  private async access(name: string): Promise<string | null> {
    if (process.env.CREDITS_STORE === 'memory') return null; // local dev: env only
    if (!this.clientPromise) {
      this.clientPromise = import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth({ scopes: [SM_SCOPE] }).getClient());
    }
    const { token } = await (await this.clientPromise).getAccessToken();
    if (!token) throw new Error('no access token from ADC');
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/secrets/${encodeURIComponent(name)}/versions/latest:access`;
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`Secret Manager HTTP ${res.status}` + (res.status === 403 ? ' (grant the runtime service account roles/secretmanager.secretAccessor on this secret)' : ''));
    }
    const j = (await res.json()) as { payload?: { data?: string } };
    const v = j.payload?.data ? Buffer.from(j.payload.data, 'base64').toString('utf8').trim() : '';
    return v || null;
  }
}

// ---------------------------------------------------------------- REST implementation

const API = 'https://api.stripe.com/v1/';

export class StripeRestApi implements StripeApi {
  private readonly secrets: SecretSource;
  private readonly priceIds = new Map<string, string>();
  /** Stripe refused Terms consent (no Terms URL in the Dashboard yet): skip it until then, per instance. */
  private consentOffUntil = 0;
  private readonly clock: () => number;
  constructor(secrets = new SecretSource(), clock: () => number = Date.now) {
    this.secrets = secrets;
    this.clock = clock;
  }

  configured(): Promise<boolean> {
    return this.secrets.get(STRIPE_SECRETS.apiKey).then((k) => !!k);
  }

  webhookSecret(): Promise<string | null> {
    return this.secrets.get(STRIPE_SECRETS.webhook);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>): Promise<T> {
    const key = await this.secrets.get(STRIPE_SECRETS.apiKey);
    if (!key) throw new StripeApiError(503, 'not_configured');
    const body = params ? formEncode(params) : '';
    const url = API + path + (method === 'GET' && body ? '?' + body : '');
    const headers: Record<string, string> = { Authorization: 'Bearer ' + key, 'Stripe-Version': STRIPE_API_VERSION };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Idempotency-Key'] = randomBytes(16).toString('hex');
    }
    const res = await fetch(url, { method, headers, ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as { error?: { type?: string; code?: string } } & T;
    if (!res.ok) throw new StripeApiError(res.status, json.error?.code || json.error?.type || 'error');
    return json;
  }

  /** The Price for a pack, created on first use (product with the AIaaS tax code, tax added on top). */
  async ensurePrice(pack: PackInfo): Promise<string> {
    // Test and live mode have different prices: cache per mode (never the key itself).
    const key = (await this.secrets.get(STRIPE_SECRETS.apiKey)) ?? '';
    const cacheKey = (/^(sk|rk)_live_/.test(key) ? 'live:' : 'test:') + pack.id;
    const cached = this.priceIds.get(cacheKey);
    if (cached) return cached;
    const lookup = stripeLookupKey(pack.id);
    const found = await this.call<{ data: Array<{ id: string }> }>('GET', 'prices', { 'lookup_keys[]': lookup, active: 'true', limit: 1 });
    let id = found.data?.[0]?.id;
    if (!id) {
      const credits = pack.credits.toLocaleString('en-US');
      const product = await this.call<{ id: string }>('POST', 'products', {
        name: `${credits} Sparks`,
        description: `${credits} Sparks for the magic features in Mohit's apps and games on mohitgoenka.com, kept in this browser as long as you use them at least once every 400 days.`,
        tax_code: STRIPE_TAX_CODE,
        metadata: { mg_pack: pack.id, mg_credits: pack.credits },
      });
      try {
        const price = await this.call<{ id: string }>('POST', 'prices', {
          product: product.id,
          currency: 'usd',
          unit_amount: Math.round(pack.priceUsd * 100),
          tax_behavior: 'exclusive',
          lookup_key: lookup,
          metadata: { mg_pack: pack.id, mg_credits: pack.credits },
        });
        id = price.id;
      } catch (err) {
        // Another instance created it first (lookup keys are unique): use theirs.
        const again = await this.call<{ data: Array<{ id: string }> }>('GET', 'prices', { 'lookup_keys[]': lookup, active: 'true', limit: 1 });
        id = again.data?.[0]?.id;
        if (!id) throw err;
      }
    }
    this.priceIds.set(cacheKey, id);
    return id;
  }

  async createCheckoutSession(input: CheckoutInput): Promise<{ id: string; url: string }> {
    // Fixed packs use their saved Price; a custom amount, a gift and a tip are priced inline (product made per checkout).
    const kind = input.kind ?? 'sparks';
    const price = kind !== 'sparks' ? customPriceData(input.pack, kind) : input.pack.id === CUSTOM_PACK_ID ? customPriceData(input.pack) : await this.ensurePrice(input.pack);
    const params = checkoutSessionParams(input, price);
    const { consent_collection: _c, custom_text: _t, ...withoutConsent } = params;
    let s: StripeCheckoutSession;
    if (this.clock() < this.consentOffUntil) {
      s = await this.call<StripeCheckoutSession>('POST', 'checkout/sessions', withoutConsent);
    } else {
      try {
        s = await this.call<StripeCheckoutSession>('POST', 'checkout/sessions', params);
      } catch (err) {
        // Terms consent needs a Terms of service URL in the Stripe Dashboard (Settings → Public details). Until it is
        // set, Stripe refuses consent_collection: keep checkout working without it, skip it for an hour, log once.
        if (!(err instanceof StripeApiError) || err.status !== 400) throw err;
        s = await this.call<StripeCheckoutSession>('POST', 'checkout/sessions', withoutConsent);
        this.consentOffUntil = this.clock() + 60 * 60_000;
        console.error('[credits] Stripe refused Terms consent at checkout (set the Terms of service URL in Dashboard → Settings → Public details); checkouts skip it for 1 h:', err.code);
      }
    }
    if (!s.id || !s.url) throw new StripeApiError(502, 'no_session_url');
    return { id: s.id, url: s.url };
  }

  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    return this.call<StripeCheckoutSession>('GET', 'checkout/sessions/' + encodeURIComponent(id));
  }
}

/** Checkout Session parameters (exported for tests): one pack, Managed Payments, Terms consent, return URLs. */
/**
 * Inline price for a custom amount (same product name, description, tax code and tax handling as the packs), a gift
 * code or a tip. Store text: never "free".
 */
export function customPriceData(pack: PackInfo, kind: CheckoutKind = 'sparks'): Record<string, unknown> {
  const credits = pack.credits.toLocaleString('en-US');
  const product =
    kind === 'gift'
      ? {
          name: `Gift code: ${credits} Sparks`,
          description: `A one-use gift code for ${credits} Sparks in Mohit's apps and games (mohitgoenka.com and his Android apps). Valid for 1 year.`,
        }
      : kind === 'tip'
        ? {
            name: `Support Mohit's apps (includes ${credits} Sparks)`,
            description: `An optional tip that supports Mohit's apps and games, with ${credits} Sparks as thanks, kept in this browser as long as you use them at least once every 400 days.`,
          }
        : {
            name: `${credits} Sparks`,
            description: `${credits} Sparks for the magic features in Mohit's apps and games on mohitgoenka.com, kept in this browser as long as you use them at least once every 400 days.`,
          };
  return {
    currency: 'usd',
    unit_amount: Math.round(pack.priceUsd * 100),
    tax_behavior: 'exclusive',
    product_data: {
      ...product,
      tax_code: STRIPE_TAX_CODE,
      metadata: { mg_pack: pack.id, mg_credits: String(pack.credits), ...(kind !== 'sparks' ? { mg_kind: kind } : {}) },
    },
  };
}

/** Session metadata (server-set, trusted once retrieved or signed). Gifts carry mg_gift=1, tips mg_tip=1. */
export function sessionMetadata(input: CheckoutInput): Record<string, string> {
  const kind = input.kind ?? 'sparks';
  return {
    mg_wallet: input.walletId,
    mg_pack: input.pack.id,
    mg_credits: String(input.pack.credits),
    mg_app: input.app,
    ...(kind === 'gift' ? { mg_gift: '1' } : {}),
    ...(kind === 'tip' ? { mg_tip: '1' } : {}),
  };
}

export function checkoutSessionParams(input: CheckoutInput, price: string | Record<string, unknown>): Record<string, unknown> {
  return {
    mode: 'payment',
    line_items: [typeof price === 'string' ? { price, quantity: 1 } : { price_data: price, quantity: 1 }],
    managed_payments: { enabled: true },
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: `I agree to the [Terms](${TERMS_URL}).` } },
    success_url: withParams(input.returnUrl, { mg_credits: 'paid', mg_session: '{CHECKOUT_SESSION_ID}' }),
    cancel_url: withParams(input.returnUrl, { mg_credits: 'cancel' }),
    metadata: sessionMetadata(input),
  };
}

// ---------------------------------------------------------------- test double

export class FakeStripeApi implements StripeApi {
  readonly sessions = new Map<string, StripeCheckoutSession & { input: CheckoutInput }>();
  key: string | null = 'sk_test_fake';
  secret: string | null = 'whsec_test_fake';
  private n = 0;

  async configured() {
    return !!this.key;
  }
  async webhookSecret() {
    return this.secret;
  }
  async createCheckoutSession(input: CheckoutInput) {
    if (!this.key) throw new StripeApiError(503, 'not_configured');
    const id = `cs_test_${(++this.n).toString().padStart(4, '0')}${randomBytes(6).toString('hex')}`;
    const url = `https://checkout.stripe.test/${id}`;
    this.sessions.set(id, {
      id,
      url,
      input,
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: null,
      metadata: sessionMetadata(input),
      amount_subtotal: Math.round(input.pack.priceUsd * 100),
      livemode: false,
    });
    return { id, url };
  }
  /** Simulate the buyer paying. */
  complete(id: string, paymentStatus: 'paid' | 'unpaid' = 'paid') {
    const s = this.sessions.get(id);
    if (!s) throw new Error('no session ' + id);
    s.status = 'complete';
    s.payment_status = paymentStatus;
    s.payment_intent = 'pi_' + id.slice(8);
    return s;
  }
  async retrieveCheckoutSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new StripeApiError(404, 'resource_missing');
    const { input: _i, ...rest } = s;
    return rest;
  }
}
