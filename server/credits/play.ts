/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Google Play Developer API (androidpublisher v3) for one-time products, via ADC.
// The runtime service account must be invited in Play Console (Users and permissions) with
// "View financial data, orders and cancellation survey responses" + "Manage orders and subscriptions"
// for the apps that sell credits. No key files: GoogleAuth picks up the Cloud Run identity.
//   GET  .../applications/{pkg}/purchases/products/{productId}/tokens/{token}           purchases.products.get
//   POST .../applications/{pkg}/purchases/products/{productId}/tokens/{token}:consume   purchases.products.consume
//   GET  .../applications/{pkg}/purchases/voidedpurchases?startTime&endTime&token          purchases.voidedpurchases.list

/** Fields of ProductPurchase we use (https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products). */
export interface ProductPurchase {
  kind?: string;
  /** 0 Purchased, 1 Canceled, 2 Pending */
  purchaseState?: number;
  /** 0 Yet to be consumed, 1 Consumed */
  consumptionState?: number;
  /** 0 Yet to be acknowledged, 1 Acknowledged */
  acknowledgementState?: number;
  orderId?: string;
  productId?: string;
  /** 0 Test (license tester), 1 Promo, 2 Rewarded; absent for real purchases. */
  purchaseType?: number;
  obfuscatedExternalAccountId?: string;
  quantity?: number;
  regionCode?: string;
  purchaseTimeMillis?: string;
}

/** One refunded / charged-back / revoked purchase (https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases). */
export interface VoidedPurchase {
  kind?: string;
  purchaseToken: string;
  orderId?: string;
  purchaseTimeMillis?: string;
  voidedTimeMillis?: string;
  /** 0 user, 1 developer, 2 Google */
  voidedSource?: number;
  /** 0 other, 1 remorse, 2 not received, 3 defective, 4 accidental, 5 fraud, 6 friendly fraud, 7 chargeback, 8 unacknowledged */
  voidedReason?: number;
  /** Quantity refunded (quantity-based partial refunds). */
  voidedQuantity?: number;
}

export interface VoidedPage {
  voidedPurchases: VoidedPurchase[];
  nextPageToken: string | null;
}

export interface PlayApi {
  getProductPurchase(packageName: string, productId: string, token: string): Promise<ProductPurchase>;
  consumeProductPurchase(packageName: string, productId: string, token: string): Promise<void>;
  /** One page of voided one-time purchases voided in [startTime, endTime] (ms; Play keeps 30 days). */
  listVoidedPurchases?(packageName: string, q: { startTime: number; endTime: number; token?: string | null }): Promise<VoidedPage>;
}

export class PlayApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PlayApiError';
    this.status = status;
  }
}

const BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** Real implementation: google-auth-library ADC + fetch, 10 s timeout, no token/id ever logged. */
export class GooglePlayApi implements PlayApi {
  private clientPromise: Promise<{ getAccessToken(): Promise<{ token?: string | null }> }> | null = null;

  private async token(): Promise<string> {
    if (!this.clientPromise) {
      this.clientPromise = import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth({ scopes: [SCOPE] }).getClient());
    }
    const client = await this.clientPromise;
    const { token } = await client.getAccessToken();
    if (!token) throw new PlayApiError(503, 'no access token from ADC');
    return token;
  }

  private url(pkg: string, productId: string, token: string) {
    return BASE + encodeURIComponent(pkg) + '/purchases/products/' + encodeURIComponent(productId) + '/tokens/' + encodeURIComponent(token);
  }

  private async call(url: string, method: 'GET' | 'POST'): Promise<Response> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + (await this.token()), Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Body may echo the token in some errors: read only the status line text.
      await res.body?.cancel().catch(() => {});
      throw new PlayApiError(res.status, 'Play API ' + method + ' failed with HTTP ' + res.status);
    }
    return res;
  }

  async getProductPurchase(packageName: string, productId: string, token: string): Promise<ProductPurchase> {
    const res = await this.call(this.url(packageName, productId, token), 'GET');
    return (await res.json()) as ProductPurchase;
  }

  async consumeProductPurchase(packageName: string, productId: string, token: string): Promise<void> {
    const res = await this.call(this.url(packageName, productId, token) + ':consume', 'POST');
    await res.body?.cancel().catch(() => {});
  }

  async listVoidedPurchases(packageName: string, q: { startTime: number; endTime: number; token?: string | null }): Promise<VoidedPage> {
    // includeQuantityBasedPartialRefund: also list partial refunds of multi-quantity purchases (one record each).
    const params = new URLSearchParams({
      startTime: String(Math.floor(q.startTime)),
      endTime: String(Math.floor(q.endTime)),
      maxResults: '1000',
      type: '0',
      includeQuantityBasedPartialRefund: 'true',
    });
    if (q.token) params.set('token', q.token);
    const res = await this.call(BASE + encodeURIComponent(packageName) + '/purchases/voidedpurchases?' + params.toString(), 'GET');
    const j = (await res.json()) as { voidedPurchases?: VoidedPurchase[]; tokenPagination?: { nextPageToken?: string } };
    return { voidedPurchases: Array.isArray(j.voidedPurchases) ? j.voidedPurchases : [], nextPageToken: j.tokenPagination?.nextPageToken || null };
  }
}

/** Test double: register purchases by token; records consumes. */
export class FakePlayApi implements PlayApi {
  readonly purchases = new Map<string, ProductPurchase & { packageName: string }>();
  readonly consumed: string[] = [];
  failConsume = false;
  /** Voided purchases the fake reports (by package), and the queries it received. */
  readonly voided: Array<VoidedPurchase & { packageName: string }> = [];
  readonly voidedQueries: Array<{ packageName: string; startTime: number; endTime: number; token: string | null }> = [];
  failVoided = false;
  /** Page size of the fake (tests pagination). */
  voidedPageSize = 1000;

  add(packageName: string, token: string, p: ProductPurchase) {
    this.purchases.set(token, { packageName, kind: 'androidpublisher#productPurchase', consumptionState: 0, acknowledgementState: 0, ...p });
  }

  async getProductPurchase(packageName: string, productId: string, token: string): Promise<ProductPurchase> {
    const p = this.purchases.get(token);
    if (!p || p.packageName !== packageName || (p.productId && p.productId !== productId)) throw new PlayApiError(404, 'not found');
    const { packageName: _pkg, ...rest } = p;
    return rest;
  }

  async consumeProductPurchase(packageName: string, productId: string, token: string): Promise<void> {
    if (this.failConsume) throw new PlayApiError(503, 'consume failed (fake)');
    const p = this.purchases.get(token);
    if (!p || p.packageName !== packageName) throw new PlayApiError(404, 'not found');
    p.consumptionState = 1;
    this.consumed.push(productId + ':' + token.slice(0, 6));
  }

  async listVoidedPurchases(packageName: string, q: { startTime: number; endTime: number; token?: string | null }): Promise<VoidedPage> {
    this.voidedQueries.push({ packageName, startTime: q.startTime, endTime: q.endTime, token: q.token ?? null });
    if (this.failVoided) throw new PlayApiError(503, 'voided list failed (fake)');
    const all = this.voided.filter((v) => v.packageName === packageName && Number(v.voidedTimeMillis ?? 0) >= q.startTime && Number(v.voidedTimeMillis ?? 0) <= q.endTime);
    const from = q.token ? Number(q.token) : 0;
    const page = all.slice(from, from + this.voidedPageSize).map(({ packageName: _p, ...v }) => v);
    return { voidedPurchases: page, nextPageToken: from + this.voidedPageSize < all.length ? String(from + this.voidedPageSize) : null };
  }
}
