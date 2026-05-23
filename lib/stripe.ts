// Stripe checkout helper. Two product tiers — Restaurant Pro and Diner
// Premium. Each maps to a Stripe Price ID set via env. Webhooks update
// the brand doc's subscription status.
//
// Setup required (one-time, in Stripe dashboard):
//   - Create two Products: "Restaurant Pro" ($99/mo) and "Diner Premium"
//     ($4.99/mo). Each gets a recurring monthly Price ID.
//   - Add a webhook endpoint: https://<your-domain>/api/stripe/webhook
//     subscribed to: checkout.session.completed, customer.subscription.updated,
//     customer.subscription.deleted, invoice.payment_failed
//
// Env vars:
//   STRIPE_SECRET_KEY                — sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET            — whsec_... from the webhook endpoint
//   STRIPE_PRICE_RESTAURANT_PRO      — price_... for $99/mo restaurant tier
//   STRIPE_PRICE_DINER_PREMIUM       — price_... for $4.99/mo diner tier
//
// Without these, /api/stripe/create-checkout-session returns a 503 with a
// helpful "not configured" message and the pricing page surfaces it.

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_RESTAURANT_PRO = process.env.STRIPE_PRICE_RESTAURANT_PRO || '';
const STRIPE_PRICE_DINER_PREMIUM = process.env.STRIPE_PRICE_DINER_PREMIUM || '';

let stripe: Stripe | null = null;
if (STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
}

export function isStripeConfigured(): boolean {
  return !!(STRIPE_SECRET_KEY && STRIPE_PRICE_RESTAURANT_PRO && STRIPE_PRICE_DINER_PREMIUM);
}

export function getStripe(): Stripe | null {
  return stripe;
}

export type Tier = 'restaurant' | 'diner';

export function priceIdForTier(tier: Tier): string {
  if (tier === 'restaurant') return STRIPE_PRICE_RESTAURANT_PRO;
  return STRIPE_PRICE_DINER_PREMIUM;
}

export async function createCheckoutSession(opts: {
  tier: Tier;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  if (!stripe) throw new Error('Stripe not configured');
  const priceId = priceIdForTier(opts.tier);
  if (!priceId) throw new Error(`Price ID for tier "${opts.tier}" not configured`);
  return await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.customerEmail,
    metadata: { tier: opts.tier, ...(opts.metadata || {}) },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    automatic_tax: { enabled: false },
  });
}
