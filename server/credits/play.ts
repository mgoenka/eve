/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Google Play Developer API (androidpublisher v3) for one-time products, via ADC.
// The runtime service account must be invited in Play Console (Users and permissions) with
// "View financial data, orders and cancellation survey responses" + "Manage orders and subscriptions"
// for the apps that sell credits. No key files: GoogleAuth picks up the Cloud Run identity.
//   GET  .../applications/{pkg}/purchases/products/{productId}/tokens/{token}           purchases.products.get
//   POST .../applications/{pkg}/purchases/products/{productId}/tokens/{token}:consume   purchases.products.consume

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

export interface PlayApi {
  getProductPurchase(packageName: string, productId: string, token: string): Promise<ProductPurchase>;
  consumeProductPurchase(packageName: string, productId: string, token: string): Promise<void>;
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
}

/** Test double: register purchases by token; records consumes. */
export class FakePlayApi implements PlayApi {
  readonly purchases = new Map<string, ProductPurchase & { packageName: string }>();
  readonly consumed: string[] = [];
  failConsume = false;

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
}
