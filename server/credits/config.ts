/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Every business number of the AI credits system lives in this file.

/** 1 credit = this many US dollars of Mohit's real AI cost (Gemini API, Paid tier, Standard). */
export const CREDIT_USD = 0.001;

/**
 * Google Play's service fee on the packs. 0.30 until Mohit confirms the 15% program
 * (Play Console > Setup > "15% service fee" enrolment), then set 0.15.
 */
export const GOOGLE_FEE = 0.3;

/**
 * Pricing target the round packs were chosen against: revenue after fees ÷ the AI cost the Sparks can buy.
 * Packs are fixed round numbers (same on Play and the web) rather than derived from this; the test
 * checks every pack still earns at least MIN_MARGIN in the worst case (Play 30 %, Stripe worst case).
 */
export const MARGIN = 2;
/** Floor every pack must clear in the worst case (Play 30 % fee). */
export const MIN_MARGIN = 1.3;

/**
 * Free Sparks once per wallet (Android: package + app user id; web: browser), granted on the wallet's first
 * metered action or explicit claim (purchase, promo code, checkout), never on a plain balance read. Limited
 * per client address (STARTER_PER_IP) and by a global daily budget (STARTER_DAILY_CAP).
 */
export const STARTER_CREDITS = 100;

/**
 * Starter grants per client address (IPv4 address, IPv6 /64) per rolling STARTER_WINDOW_MS, counted separately
 * for Android wallets and web wallets. 5 a day lets a party on one Wi-Fi or a carrier NAT start with free
 * Sparks; clearing app data / cookies in a loop does not mint free AI. Later wallets from the address start at 0.
 */
export const STARTER_PER_IP = 5;
/**
 * Android wallets per address: phone carriers put many people behind one IPv4 address (CGNAT), and Android
 * users installed the app from Play, so they get a looser per-address limit (the global daily cap still applies).
 */
export const STARTER_PER_IP_ANDROID = 30;
export const STARTER_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Global backstop across every app: at most this many starter grants per UTC day (env STARTER_DAILY_CAP
 * overrides; 0 pauses starter grants). Kept in a sharded counter (STARTER_BUDGET_SHARDS docs per day, each
 * allowed ceil(cap / shards)) so no single Firestore doc gets hot. Exhausted: new wallets start at 0 and the
 * balance answer says starterPaused (the sheet explains it).
 */
export const STARTER_DAILY_CAP = 3000;
export const STARTER_BUDGET_SHARDS = 10;
export function starterDailyCap(env: string | undefined = process.env.STARTER_DAILY_CAP): number {
  const n = env === undefined || env.trim() === '' ? NaN : Number(env);
  return Number.isInteger(n) && n >= 0 ? n : STARTER_DAILY_CAP;
}

/** Play voided purchases (refunds, chargebacks) are fetched at most this often per package. */
export const PLAY_VOIDED_SYNC_MS = 6 * 60 * 60_000;

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
 * Sparks packs: one table for every provider, round numbers, more Sparks per dollar as packs grow
 * (303 / 401 / 500 per $). On Play these are one-time consumable products with the same ids in every app;
 * on the web they are Stripe prices (lookup key stripeLookupKey(id)). priceUsd = US list price.
 * Worst-case margin (revenue after fees ÷ AI cost): Play 30 % 2.3x / 1.75x / 1.4x; Stripe – / 2.15x / 1.8x.
 */
export const PACKS = [
  { id: 'ai_credits_099', priceUsd: 0.99, credits: 300 },
  { id: 'ai_credits_499', priceUsd: 4.99, credits: 2000 },
  { id: 'ai_credits_1999', priceUsd: 19.99, credits: 10000 },
] as const;

export type PackId = (typeof PACKS)[number]['id'];

const micros = (usd: number) => Math.round(usd * 1_000_000);

/** What Mohit keeps from one sale, in micro-dollars (integer math: 0.99 never becomes 0.98999…). */
export function netRevenueMicros(provider: PaymentProvider, priceUsd: number, googleFee: number = GOOGLE_FEE): number {
  const price = micros(priceUsd);
  if (provider === 'play') return Math.floor((price * Math.round((1 - googleFee) * 10_000)) / 10_000); // price × (1 − fee)
  return price - Math.ceil(price * STRIPE_FEE.rate) - micros(STRIPE_FEE.fixedUsd); // price − (2.9% × price + $0.30)
}

/** Sparks a price would buy at exactly MARGIN (reference for choosing packs; packs are fixed in PACKS). */
/** Revenue after fees ÷ the AI cost of a pack's Sparks. */
export function marginOf(priceUsd: number, credits: number, provider: PaymentProvider, googleFee: number = GOOGLE_FEE): number {
  return netRevenueMicros(provider, priceUsd, googleFee) / (credits * micros(CREDIT_USD));
}

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
    credits: p.credits,
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
  promos: 'aiCreditPromos', // doc id = normalized promo code; subcollection "redemptions" (doc id = wallet key)
  linkCodes: 'aiCreditLinkCodes', // doc id = sha256(link code): { account, expiresAt, usedAt? } (web browser linking)
  starterBudget: 'aiCreditStarterBudget', // doc id = UTC day "YYYY-MM-DD"; subcollection "shards" (doc id 0..9): { count }
  sync: 'aiCreditSync', // doc id e.g. "play-voided:<package>": { lastRunAt, checkpoint } (background syncs)
} as const;

/** Promo codes are case-insensitive: stored and matched upper-case, spaces removed. Letters, digits, dashes. */
/** Link codes ("use your Sparks on another device", web only): 6 characters, no 0/O/1/I/L, 10 minutes, one use. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 6;
export const LINK_CODE_TTL_MS = 10 * 60_000;
export const normalizeLinkCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
export const normalizePromoCode = (raw: string): string => raw.trim().toUpperCase().replace(/\s+/g, '');

/** Web wallet cookie: httpOnly, Secure, SameSite=Lax, Domain=.mohitgoenka.com, shared by every app. */
export const WEB_WALLET_COOKIE = 'mg_wallet';
/** 400 days: the longest cookie lifetime Chrome keeps. Renewed on every metered visit. */
export const WEB_WALLET_MAX_AGE_S = 400 * 24 * 60 * 60;
/** Parent domain of every app: one web wallet works in all of them. */
export const WEB_COOKIE_DOMAIN = 'mohitgoenka.com';

/** Older names: web wallets follow the same per-address rule as Android ones (STARTER_PER_IP per STARTER_WINDOW_MS). */
export const WEB_STARTER_PER_IP = STARTER_PER_IP;
export const WEB_STARTER_WINDOW_MS = STARTER_WINDOW_MS;

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
/**
 * Price lookup keys: bump the version when a pack's credits or product name change (old prices stay for old
 * sessions; archive them in the Dashboard). v2: products named "N Sparks", Terms consent at checkout.
 */
export const stripeLookupKey = (packId: string) => `mg_${packId}_v2`;
/** Terms of service (consent at Stripe Checkout, links in the Sparks sheet). */
export const TERMS_URL = 'https://mohitgoenka.com/terms';
/** Secret Manager secret names (project public-mohit-260610); env vars of the same meaning override them. */
export const STRIPE_SECRETS = {
  apiKey: { secret: 'stripe-secret-key', env: 'CREDITS_STRIPE_SECRET_KEY' },
  webhook: { secret: 'stripe-webhook-secret', env: 'CREDITS_STRIPE_WEBHOOK_SECRET' },
} as const;

/**
 * Owner code (Mohit's own devices use AI without paying; charges are still logged). Set by Mohit in Secret
 * Manager; missing secret = owner enrolment off. Entered once per device/browser in the AI credits sheet.
 */
export const OWNER_CODE_SECRET = { secret: 'credits-owner-code', env: 'CREDITS_OWNER_CODE' } as const;
