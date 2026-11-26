/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Prepaid AI credits: Play in the Android apps, Stripe Checkout on the websites. See app-platform/README.md ("AI credits").
export { createCredits, CreditsError, defaultPayPolicy, ipKey, isNativeRequest, mask, readCookie, safeReturnUrl, walletCookie, walletKey } from './credits.ts';
export type {
  CreditContext,
  CreditPurchaseInput,
  Credits,
  CreditsOptions,
  Meter,
  PayContext,
  PayPolicy,
  ReqLike,
  ResLike,
  RunOptions,
  RunResult,
  Wallet,
  WalletKind,
} from './credits.ts';
export {
  APP_USER_HEADER,
  BALANCE_HEADER,
  CHARGED_HEADER,
  CREDIT_USD,
  GOOGLE_FEE,
  MARGIN,
  MIN_MARGIN,
  PACKS,
  PACK_INFO,
  PAYMENT_PROVIDERS,
  PROMO_CODE_RE,
  LINK_CODE_TTL_MS,
  STARTER_BUDGET_SHARDS,
  STARTER_CREDITS,
  STARTER_DAILY_CAP,
  STARTER_PER_IP,
  STARTER_PER_IP_ANDROID,
  STARTER_WINDOW_MS,
  STRIPE_FEE,
  TERMS_URL,
  starterDailyCap,
  stripeLookupKey,
  STRIPE_TAX_CODE,
  WEB_MIN_PACK_USD,
  WEB_STARTER_PER_IP,
  WEB_SWITCH_DOC,
  WEB_WALLET_COOKIE,
  creditsForPrice,
  customPack,
  customPriceUsd,
  customCreditsForUsd,
  CUSTOM_PACK_ID,
  CUSTOM_MIN_CREDITS,
  CUSTOM_MAX_CREDITS,
  CUSTOM_CURVE,
  marginOf,
  netRevenueMicros,
  normalizePromoCode,
  normalizeLinkCode,
  packById,
  packsFor,
} from './config.ts';
export type { PackId, PackInfo, PaymentProvider } from './config.ts';
export { PRICE_TABLE, PRICING_SOURCE, costOfCall, creditsForUsd, estimateCredits, usageOf, groundedRequestsOf, searchQueriesOf } from './pricing.ts';
export type { CallUsage, ModelPrice, Rates, UsageMetadata } from './pricing.ts';
export { MemoryCreditStore } from './store.ts';
export type { CreditStore, LedgerEntry, MergeResult, PromoCode, PromoError, PromoResult, StarterMissed, StarterOutcome, StarterRule, StarterState } from './store.ts';
export { FirestoreCreditStore } from './firestore-store.ts';
export { GooglePlayApi, FakePlayApi, PlayApiError } from './play.ts';
export type { PlayApi, ProductPurchase, VoidedPage, VoidedPurchase } from './play.ts';
export { FakeStripeApi, SecretSource, checkoutSessionParams, StripeApiError, StripeRestApi, formEncode, signStripePayload, verifyStripeSignature, withParams } from './stripe.ts';
export type { CheckoutInput, StripeApi, StripeCheckoutSession, StripeEvent } from './stripe.ts';
