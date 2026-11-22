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

/** Payment providers that can sell credit packs. Play today; Stripe (web) is planned. */
export const PAYMENT_PROVIDERS = ['play', 'stripe'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** Stripe card fee (US): 2.9% + $0.30 per successful charge. Used once web checkout exists. */
export const STRIPE_FEE = { rate: 0.029, fixedUsd: 0.3 } as const;

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
  return PACKS.map((p) => ({ id: p.id, priceUsd: p.priceUsd, credits: creditsForPrice(p.priceUsd, provider), provider }));
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
  accounts: 'aiCreditAccounts', // doc id = wallet key ("android:<package>:<appUserId>", later "web:<walletId>"); subcollection "ledger"
  purchases: 'aiCreditPurchases', // doc id "<provider>:<sha256(externalId)>" (Play: purchase token; Stripe: checkout session id)
  externalIds: 'aiCreditOrders', // doc id "<provider>:<secondary id>" (Play orderId) — second idempotency key
} as const;

/** Web wallet cookie (planned): httpOnly, Secure, SameSite=Lax, Domain=.mohitgoenka.com, shared by every app. */
export const WEB_WALLET_COOKIE = 'mg_wallet';
