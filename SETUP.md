# Eve · Setup

The product is fully running today on the Gemini API alone. Three new capabilities ship in code but require external account setup before they activate. Each falls back gracefully when the env vars aren\u2019t set, so the app never breaks.

## 1. Stripe — paid subscriptions

**What activates:** the *Start Diner Premium* and *Start Restaurant Pro* buttons on `/pricing` redirect to a real Stripe Checkout session and trigger subscription state changes via webhook.

**Steps:**

1. Create a Stripe account (or open the existing one).
2. Create two **products** with **monthly recurring** prices:
   - `Restaurant Pro` — $99 / month
   - `Diner Premium` — $4.99 / month
3. Copy each product\u2019s **price ID** (looks like `price_1Pxxx...`).
4. In **Developers → Webhooks**, create an endpoint at `https://eve.mohitgoenka.com/api/stripe/webhook` and subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   Copy the signing secret (`whsec_...`).
5. Add the four env vars to Cloud Run (Secret Manager recommended):
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_RESTAURANT_PRO=price_...
   STRIPE_PRICE_DINER_PREMIUM=price_...
   ```
6. Redeploy. The pricing buttons now lead to live Stripe Checkout.

**Until configured:** `/api/stripe/create-checkout-session` returns a friendly 503 and the pricing page surfaces *"Checkout not yet enabled — check back soon."*

## 2. Firestore — persistent dining index + restaurant brands

**What activates:** restaurant brand profiles, the dining-index `Eve Originals` badge, and analytics survive process restarts and scale beyond a single Cloud Run instance.

**Steps:**

1. Enable Firestore on your GCP project: `gcloud firestore databases create --location=us-west1`.
2. Grant the Cloud Run service account permission: `roles/datastore.user`.
3. The Cloud Run service account is auto-detected via the metadata server in production. No extra env var needed.
4. (Optional, for local dev) `gcloud auth application-default login` — the Firestore client picks up your user credentials.

**Until configured:** the in-memory fallback in `lib/firestore.ts` keeps everything working — specials, brands, metrics — but resets on each cold start.

## 3. Instagram — direct one-click publishing

**What activates:** the *Post to IG* button in the restaurant content pack publishes directly via Meta\u2019s Graph API instead of falling back to copy + paste. Restaurant owners click *Connect IG* once, complete OAuth, and every subsequent post is one click.

**Steps:**

1. Create a Meta App at https://developers.facebook.com/apps (type: **Business**).
2. Add the **Facebook Login** product. Set the OAuth redirect URI to:
   ```
   https://eve.mohitgoenka.com/api/auth/instagram/callback
   ```
3. Add the **Instagram Graph API** product.
4. Request these permissions (App Review required for production):
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
5. Add env vars to Cloud Run:
   ```
   META_APP_ID=...
   META_APP_SECRET=...
   META_REDIRECT_URI=https://eve.mohitgoenka.com/api/auth/instagram/callback
   ```
6. Redeploy. Restaurants see *"Connect IG"* on the content-pack card. After OAuth, *"Post to IG"* publishes directly.

**Until configured:** the existing copy-and-share fallback (clipboard + open Instagram in a new tab) still works.

## 4. Reservations — works today, no setup

OpenTable / Resy / Tock deep-links are pure URL builders in `lib/reservations.ts`. They require no API keys — every food / drink / live-music stop on a diner plan now shows three booking buttons. URLs include the restaurant name, city, party size, date, and start time pre-filled.

## 5. City landing pages — works today, no setup

`/sf`, `/nyc`, `/austin`, `/la`, `/seattle`, `/chicago` are all live with curated featured restaurants. The `sitemap.xml` endpoint enumerates them for search-engine discovery. Add a new city by appending an entry to `data/cities.ts` and adding the slug to the `CITY_SLUGS` set in `App.tsx`.

## Checklist for going live

- [ ] Stripe products + webhook + env vars in Cloud Run
- [ ] Firestore database created in `us-west1`
- [ ] Meta App created, OAuth redirect set, env vars in Cloud Run
- [ ] Run `BASE_URL=https://eve.mohitgoenka.com bash scripts/seed-demo.sh` once to populate the Eve Originals index for the Bay Area
- [ ] Submit `https://eve.mohitgoenka.com/sitemap.xml` to Google Search Console
