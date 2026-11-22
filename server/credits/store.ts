/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Storage contract for balances + append-only ledger, and an in-memory implementation
// (tests and local runs without Firestore). The Firestore one is in firestore-store.ts.

export type LedgerType = 'grant' | 'purchase' | 'charge' | 'reversal';

export interface LedgerEntry {
  type: LedgerType;
  /** Signed: + for grants/purchases, − for charges and reversals (refunds, disputes). */
  credits: number;
  balanceAfter: number;
  at: string;
  action?: string;
  /** Per-model-call breakdown of a charge. */
  calls?: Array<{ model: string; priced: string; usd: number; credits: number }>;
  costUsd?: number;
  /** Pack id (purchase entries). */
  productId?: string;
  /** Payment provider of a purchase ('play' | 'stripe'). */
  provider?: string;
  /** Provider's human-facing order id (Play orderId, Stripe payment intent), for support lookups. */
  orderId?: string;
  /** Play purchaseType: 0 = test (license tester), 1 = promo, 2 = rewarded; absent = real. */
  purchaseType?: number;
  reason?: string;
}

/** Stored on the account doc. kind 'android': app = package, id = app user id; kind 'web': app = '*', id = wallet id. */
export interface AccountMeta {
  kind: 'android' | 'web';
  app: string;
  id: string;
}

export interface AccountState {
  balance: number;
  /** balance minus live holds (what a new action may use). */
  available: number;
  /** True when this call created the account (and granted the starter credits). */
  created: boolean;
}

export interface PurchaseRecord {
  /** Wallet key credited. */
  account: string;
  provider: string;
  productId: string;
  orderId: string | null;
  credits: number;
  /** Provider-side follow-up done (Play: consumed). Stripe purchases are final when credited. */
  finalized: boolean;
  createdAt: string;
  /** Credits taken back after a refund or dispute (cumulative). */
  reversedCredits?: number;
}

export interface CreditPurchaseInput {
  /** Wallet key to credit. */
  key: string;
  meta: AccountMeta;
  starter: number;
  provider: string;
  /** "<provider>:<sha256(externalId)>" — the idempotency key. */
  purchaseKey: string;
  /** More "<provider>:<id>" keys that must also be unique (Play orderId). */
  secondaryKeys: string[];
  orderId: string | null;
  productId: string;
  credits: number;
  /** Already final at the provider (no consume step). */
  finalized: boolean;
  purchaseType?: number;
}

export interface ChargeInput {
  credits: number;
  action: string;
  costUsd: number;
  calls: LedgerEntry['calls'];
}

export interface CreditStore {
  /** Create the account with the starter grant if it doesn't exist; return its state. */
  ensure(key: string, meta: AccountMeta, starter: number, now: Date): Promise<AccountState>;
  /** Hold `credits` if available >= credits (and > 0). Creates the account first if needed. */
  reserve(key: string, meta: AccountMeta, starter: number, holdId: string, credits: number, ttlMs: number, now: Date): Promise<AccountState & { ok: boolean }>;
  /** Drop the hold and charge the actual cost (balance may go below zero by at most one action's overrun). */
  settle(key: string, holdId: string, charge: ChargeInput, now: Date): Promise<{ balance: number }>;
  /** Drop the hold without charging (failed action / cached result). */
  release(key: string, holdId: string): Promise<{ balance: number }>;
  /** Idempotent on purchaseKey and every secondary key: credits at most once. */
  creditPurchase(p: CreditPurchaseInput, now: Date): Promise<{ balance: number; duplicate: boolean; finalized: boolean; account: string }>;
  getPurchase(purchaseKey: string): Promise<PurchaseRecord | null>;
  markFinalized(purchaseKey: string, now: Date): Promise<void>;
  /** Add credits (owner top-ups, web starter grants). Creates the account (without a starter) if needed. */
  grant(key: string, meta: AccountMeta, credits: number, reason: string, now: Date): Promise<{ balance: number }>;
  /**
   * Count one more starter grant for this address key; true while fewer than `limit` were claimed in the
   * current window (the window restarts `windowMs` after its first claim).
   */
  claimStarter(addressKey: string, limit: number, windowMs: number, now: Date): Promise<boolean>;
  /**
   * Take back credits of a refunded or disputed purchase so that, in total, round(credits × fraction) are
   * reversed (idempotent: repeating an event reverses nothing more). Finds the purchase by its key or a
   * secondary key ("stripe:<payment intent>"). The balance may go below zero. Null: purchase unknown.
   */
  reversePurchase(
    find: { purchaseKey?: string; secondaryKey?: string },
    fraction: number,
    reason: string,
    now: Date,
  ): Promise<{ reversed: number; balance: number; account: string } | null>;
  /** The web credits switch (aiCreditConfig/web.enabled). */
  webEnabled(): Promise<boolean>;
}

interface MemAccount {
  meta: AccountMeta;
  balance: number;
  holds: Map<string, { credits: number; expiresAt: number }>;
  ledger: LedgerEntry[];
  totals: { granted: number; purchased: number; spent: number };
}

export function liveHeld(holds: Iterable<{ credits: number; expiresAt: number }>, nowMs: number): number {
  let s = 0;
  for (const h of holds) if (h.expiresAt > nowMs) s += h.credits;
  return s;
}

/** In-memory store (single process). Same semantics as the Firestore store. */
export class MemoryCreditStore implements CreditStore {
  readonly accounts = new Map<string, MemAccount>();
  readonly purchases = new Map<string, PurchaseRecord>();
  readonly orders = new Map<string, string>();
  readonly starterIps = new Map<string, { count: number; windowStart: number }>();
  /** The web switch for tests. */
  webSwitch = false;

  private ensureSync(key: string, meta: AccountMeta, starter: number, now: Date): { acc: MemAccount; created: boolean } {
    const existing = this.accounts.get(key);
    if (existing) return { acc: existing, created: false };
    const acc: MemAccount = { meta, balance: starter, holds: new Map(), ledger: [], totals: { granted: starter, purchased: 0, spent: 0 } };
    if (starter > 0) acc.ledger.push({ type: 'grant', credits: starter, balanceAfter: starter, at: now.toISOString(), reason: 'starter' });
    this.accounts.set(key, acc);
    return { acc, created: true };
  }

  private state(acc: MemAccount, created: boolean, now: Date): AccountState {
    for (const [id, h] of acc.holds) if (h.expiresAt <= now.getTime()) acc.holds.delete(id);
    return { balance: acc.balance, available: acc.balance - liveHeld(acc.holds.values(), now.getTime()), created };
  }

  async ensure(key: string, meta: AccountMeta, starter: number, now: Date): Promise<AccountState> {
    const { acc, created } = this.ensureSync(key, meta, starter, now);
    return this.state(acc, created, now);
  }

  async reserve(key: string, meta: AccountMeta, starter: number, holdId: string, credits: number, ttlMs: number, now: Date) {
    const { acc, created } = this.ensureSync(key, meta, starter, now);
    const s = this.state(acc, created, now);
    const need = Math.max(1, credits);
    if (s.available < need) return { ...s, ok: false };
    acc.holds.set(holdId, { credits: need, expiresAt: now.getTime() + ttlMs });
    return { ...s, available: s.available - need, ok: true };
  }

  async settle(key: string, holdId: string, charge: ChargeInput, now: Date) {
    const acc = this.accounts.get(key);
    if (!acc) throw new Error('settle on missing account');
    acc.holds.delete(holdId);
    acc.balance -= charge.credits;
    acc.totals.spent += charge.credits;
    acc.ledger.push({
      type: 'charge',
      credits: -charge.credits,
      balanceAfter: acc.balance,
      at: now.toISOString(),
      action: charge.action,
      costUsd: charge.costUsd,
      calls: charge.calls ?? [],
    });
    return { balance: acc.balance };
  }

  async release(key: string, holdId: string) {
    const acc = this.accounts.get(key);
    if (!acc) return { balance: 0 };
    acc.holds.delete(holdId);
    return { balance: acc.balance };
  }

  async creditPurchase(p: CreditPurchaseInput, now: Date) {
    const viaSecondary = p.secondaryKeys.map((k) => this.orders.get(k)).find((k) => k !== undefined);
    const prior = this.purchases.get(p.purchaseKey) ?? (viaSecondary ? this.purchases.get(viaSecondary) : undefined);
    if (prior) {
      const acc = this.accounts.get(prior.account);
      return { balance: acc?.balance ?? 0, duplicate: true, finalized: prior.finalized, account: prior.account };
    }
    const { acc } = this.ensureSync(p.key, p.meta, p.starter, now);
    acc.balance += p.credits;
    acc.totals.purchased += p.credits;
    const entry: LedgerEntry = { type: 'purchase', credits: p.credits, balanceAfter: acc.balance, at: now.toISOString(), productId: p.productId, provider: p.provider };
    if (p.orderId) entry.orderId = p.orderId;
    if (p.purchaseType !== undefined) entry.purchaseType = p.purchaseType;
    acc.ledger.push(entry);
    this.purchases.set(p.purchaseKey, {
      account: p.key,
      provider: p.provider,
      productId: p.productId,
      orderId: p.orderId,
      credits: p.credits,
      finalized: p.finalized,
      createdAt: now.toISOString(),
    });
    for (const k of p.secondaryKeys) this.orders.set(k, p.purchaseKey);
    return { balance: acc.balance, duplicate: false, finalized: p.finalized, account: p.key };
  }

  async getPurchase(purchaseKey: string) {
    return this.purchases.get(purchaseKey) ?? null;
  }

  async markFinalized(purchaseKey: string) {
    const p = this.purchases.get(purchaseKey);
    if (p) p.finalized = true;
  }

  async grant(key: string, meta: AccountMeta, credits: number, reason: string, now: Date) {
    const { acc } = this.ensureSync(key, meta, 0, now);
    acc.balance += credits;
    acc.totals.granted += credits;
    acc.ledger.push({ type: 'grant', credits, balanceAfter: acc.balance, at: now.toISOString(), reason });
    return { balance: acc.balance };
  }

  async claimStarter(addressKey: string, limit: number, windowMs: number, now: Date) {
    const t = now.getTime();
    const cur = this.starterIps.get(addressKey);
    const fresh = !cur || cur.windowStart + windowMs <= t;
    const count = fresh ? 0 : cur.count;
    if (count >= limit) return false;
    this.starterIps.set(addressKey, { count: count + 1, windowStart: fresh ? t : cur.windowStart });
    return true;
  }

  async reversePurchase(find: { purchaseKey?: string; secondaryKey?: string }, fraction: number, reason: string, now: Date) {
    const key = find.purchaseKey ?? (find.secondaryKey ? this.orders.get(find.secondaryKey) : undefined);
    const rec = key ? this.purchases.get(key) : undefined;
    if (!rec) return null;
    const target = Math.min(rec.credits, Math.max(0, Math.round(rec.credits * Math.min(1, Math.max(0, fraction)))));
    const delta = target - (rec.reversedCredits ?? 0);
    const acc = this.accounts.get(rec.account);
    if (!acc) return null;
    if (delta <= 0) return { reversed: 0, balance: acc.balance, account: rec.account };
    rec.reversedCredits = target;
    acc.balance -= delta;
    acc.ledger.push({ type: 'reversal', credits: -delta, balanceAfter: acc.balance, at: now.toISOString(), reason, productId: rec.productId, provider: rec.provider, ...(rec.orderId ? { orderId: rec.orderId } : {}) });
    return { reversed: delta, balance: acc.balance, account: rec.account };
  }

  async webEnabled() {
    return this.webSwitch;
  }
}
