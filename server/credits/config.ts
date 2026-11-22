/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Every business number of the AI credits system lives in this file.

/** 1 credit = this many US dollars of Mohit's real AI cost (Gemini API, Paid tier, Standard). */
export const CREDIT_USD = 0.001;

/**
 * Google Play's service fee on the packs. 0.30 until Mohit confirms the 15% program
 * (Play Console > Setup > "15% service fee" enrolment), then set 0.15.
 */
export const GOOGLE_FEE = 0.3;

/** Mohit earns at least this multiple of his AI cost on every credit sold (after GOOGLE_FEE). */
export const MARGIN = 2;

/** Free credits once per app identity (package + app user id). Covered by the $0.99 app price. */
export const STARTER_CREDITS = 100;

/** Payment providers that sell credit packs: Play in the Android apps, Stripe Checkout on the websites. */
export const PAYMENT_PROVIDERS = ['play', 'stripe'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * What Stripe keeps from a web sale, priced for the worst common case so the 2x margin always holds:
 * card processing 2.9% + $0.30, Managed Payments (Stripe as merchant of record: sales tax/VAT, fraud,
 * disputes) 3.5%, and a 1.5% cushion for international cards. Tax itself is added on top of the price
 * at checkout (tax_behavior "exclusive"), so the buyer pays it, not Mohit.
 */
export const STRIPE_FEE = { rate: 0.029 + 0.035 + 0.015, fixedUsd: 0.3 } as const;

/** Smallest pack sold on the web: Stripe's fixed $0.30 would eat a third of a $0.99 pack. */
export const WEB_MIN_PACK_USD = 4.99;

/**
 * Credit packs: one table for every provider. On Play these are one-time consumable products with the
 * same ids in every app; on the web they will map to Stripe prices. priceUsd = US list price.
 */
export const PACKS = [
  { id: 'ai_credits_099', priceUsd: 0.99 },
  { id: 'ai_credits_499', priceUsd: 4.99 },
  { id: 'ai_credits_1999', priceUsd: 19.99 },
] as const;

export type PackId = (typeof PACKS)[number]['id'];

const micros = (usd: number) => Math.round(usd * 1_000_000);

/** What Mohit keeps from one sale, in micro-dollars (integer math: 0.99 never becomes 0.98999…). */
export function netRevenueMicros(provider: PaymentProvider, priceUsd: number, googleFee: number = GOOGLE_FEE): number {
  const price = micros(priceUsd);
  if (provider === 'play') return Math.floor((price * Math.round((1 - googleFee) * 10_000)) / 10_000); // price × (1 − fee)
  return price - Math.ceil(price * STRIPE_FEE.rate) - micros(STRIPE_FEE.fixedUsd); // price − (2.9% × price + $0.30)
}

/** Credits for a pack: floor(net revenue / MARGIN / CREDIT_USD). */
export function creditsForPrice(priceUsd: number, provider: PaymentProvider = 'play', googleFee: number = GOOGLE_FEE): number {
  return Math.max(0, Math.floor(netRevenueMicros(provider, priceUsd, googleFee) / MARGIN / micros(CREDIT_USD)));
}

export interface PackInfo {
  id: PackId;
  priceUsd: number;
  credits: number;
  provider: PaymentProvider;
}

export function packsFor(provider: PaymentProvider): PackInfo[] {
  return PACKS.filter((p) => provider !== 'stripe' || p.priceUsd >= WEB_MIN_PACK_USD).map((p) => ({
    id: p.id,
    priceUsd: p.priceUsd,
    credits: creditsForPrice(p.priceUsd, provider),
    provider,
  }));
}

/** Play packs (what the Android apps sell). */
export const PACK_INFO: readonly PackInfo[] = packsFor('play');

export function packById(id: unknown, provider: PaymentProvider = 'play'): PackInfo | undefined {
  return typeof id === 'string' ? packsFor(provider).find((p) => p.id === id) : undefined;
}

/** How long a pre-check hold on an estimate lives if the process dies before settling. */
export const HOLD_TTL_MS = 5 * 60_000;

/** User agent token the Android/iOS wrappers append ("MohitGoenkaApp/Android"). */
export const NATIVE_UA_TOKEN = 'MohitGoenkaApp/';

/** Header the native app sends with its app user id (32 lowercase hex chars = 128 random bits). */
export const APP_USER_HEADER = 'x-mg-app-user';
export const APP_USER_RE = /^[0-9a-f]{32}$/;

/** Response headers the kit's credits client reads to update the balance chip. */
export const BALANCE_HEADER = 'X-MG-Credits-Balance';
export const CHARGED_HEADER = 'X-MG-Credits-Charged';

/** Firestore collections (database "(default)" in public-mohit-260610). */
export const COLLECTIONS = {
  accounts: 'aiCreditAccounts', // doc id = wallet key ("android:<package>:<appUserId>" or "web:<walletId>"); subcollection "ledger"
  purchases: 'aiCreditPurchases', // doc id "<provider>:<sha256(externalId)>" (Play: purchase token; Stripe: checkout session id)
  externalIds: 'aiCreditOrders', // doc id "<provider>:<secondary id>" (Play orderId, Stripe payment intent) — second idempotency key
  starterIps: 'aiCreditStarterIps', // doc id sha256(salt + IP): web starter grants per address
} as const;

/** Web wallet cookie: httpOnly, Secure, SameSite=Lax, Domain=.mohitgoenka.com, shared by every app. */
export const WEB_WALLET_COOKIE = 'mg_wallet';
/** 400 days: the longest cookie lifetime Chrome keeps. Renewed on every metered visit. */
export const WEB_WALLET_MAX_AGE_S = 400 * 24 * 60 * 60;
/** Parent domain of every app: one web wallet works in all of them. */
export const WEB_COOKIE_DOMAIN = 'mohitgoenka.com';

/**
 * Starter credits for a new web wallet, at most WEB_STARTER_PER_IP new wallets per IP address per
 * WEB_STARTER_WINDOW_MS (clearing cookies must not mint free AI). Later wallets from that address start at 0.
 */
export const WEB_STARTER_PER_IP = 3;
export const WEB_STARTER_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * The one switch for web credits, read by every app (cached ~1 min): Firestore doc
 * aiCreditConfig/web { enabled: true }. Off (or missing): the websites stay free, exactly as before.
 * CREDITS_WEB=on|off in the environment overrides it (local dev, tests).
 */
export const WEB_SWITCH_DOC = { collection: 'aiCreditConfig', id: 'web' } as const;

/** Stripe: API version pinned for every request (Managed Payments needs 2025-03-31.basil or later). */
export const STRIPE_API_VERSION = '2025-03-31.basil';
/**
 * Stripe product tax code for the packs: "Artificial Intelligence as a Service (AIaaS) - Cloud Based -
 * Personal Use", one of the codes Managed Payments accepts. Confirm with Stripe before going live.
 */
export const STRIPE_TAX_CODE = 'txcd_10105001';
/** Price lookup keys: bump the version when a pack's credits change (old prices stay for old sessions). */
export const stripeLookupKey = (packId: string) => `mg_${packId}_v1`;
/** Secret Manager secret names (project public-mohit-260610); env vars of the same meaning override them. */
export const STRIPE_SECRETS = {
  apiKey: { secret: 'stripe-secret-key', env: 'STRIPE_SECRET_KEY' },
  webhook: { secret: 'stripe-webhook-secret', env: 'STRIPE_WEBHOOK_SECRET' },
} as const;
