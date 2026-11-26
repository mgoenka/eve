/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Storage contract for balances + append-only ledger, and an in-memory implementation
// (tests and local runs without Firestore). The Firestore one is in firestore-store.ts.

export type LedgerType = 'grant' | 'purchase' | 'charge' | 'reversal' | 'merge';

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
  /** Owner wallet: the charge is logged (real AI cost) but not taken from the balance. */
  notDeducted?: boolean;
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
  /** Owner wallet (Mohit's own devices): AI is logged but never deducted or refused. */
  owner?: boolean;
  /** The wallet has bought Sparks at least once. */
  paid?: boolean;
  /**
   * Starter not granted yet: 'pending' (new account: granted on its next action), 'paused' (the global daily budget
   * was used up: tried again once there is budget) or 'address_limit' (final). Absent once granted (or for accounts
   * from before lazy starters, which got theirs at creation).
   */
  starterState?: StarterState;
}

export type StarterState = 'pending' | 'paused' | 'address_limit';
/** @deprecated Older name of StarterState. */
export type StarterMissed = StarterState;

/** What claimStarterGrant checks, all in one transaction. */
export interface StarterRule {
  /** Salted hash of the client address (IPv6 /64), per wallet kind. */
  addressKey: string;
  perAddress: number;
  windowMs: number;
  /** UTC day "YYYY-MM-DD" of the global budget. */
  day: string;
  dailyCap: number;
  shards: number;
}
export type StarterOutcome = 'granted' | 'already' | 'paused' | 'address_limit';

/** Result of linking one web wallet into another. */
export interface MergeResult {
  /** Balance of the wallet everything went into. */
  balance: number;
  /** Sparks moved from the joining wallet. */
  moved: number;
  owner: boolean;
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
  /** Reversals applied once each (Play voided purchase records), by id → credits. */
  reversals?: Record<string, number>;
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

/** aiCreditPromos/{CODE}: grants `credits` once per wallet, at most `maxRedemptions` times, until `expiresAt`. */
export interface PromoCode {
  code: string;
  credits: number;
  /** null (or missing) = no limit: then the redemptions counter is not kept (no hot doc for big public codes). */
  maxRedemptions: number | null;
  redemptions: number;
  /** ISO time; null = no expiry. */
  expiresAt: string | null;
  /** false = revoked. */
  active: boolean;
  createdAt: string;
  note?: string;
}

export type PromoError = 'promo_unknown' | 'promo_inactive' | 'promo_expired' | 'promo_used_up' | 'promo_already_redeemed';
export type PromoResult = { ok: true; code: string; credits: number; balance: number } | { ok: false; error: PromoError };

/** True when the code has a redemption limit (maxRedemptions is a number). */
export function hasPromoLimit(p: PromoCode): p is PromoCode & { maxRedemptions: number } {
  return typeof p.maxRedemptions === 'number' && Number.isFinite(p.maxRedemptions);
}

/** UTC day "YYYY-MM-DD" (starter budget doc id). */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Rolling-window claims of one address: timestamps still inside the window (legacy { count, windowStart } docs too). */
export function liveClaims(doc: { claims?: unknown; count?: unknown; windowStart?: unknown } | null | undefined, windowMs: number, nowMs: number): number[] {
  if (!doc) return [];
  const raw = Array.isArray(doc.claims) ? doc.claims : Array.from({ length: Math.max(0, Math.min(1000, Number(doc.count) || 0)) }, () => Number(doc.windowStart) || 0);
  return raw.filter((t): t is number => typeof t === 'number' && t > nowMs - windowMs && t <= nowMs + 60_000);
}

/** Shared validity check (both stores). */
export function promoProblem(p: PromoCode | null, alreadyRedeemed: boolean, now: Date): PromoError | null {
  if (!p) return 'promo_unknown';
  if (!p.active) return 'promo_inactive';
  if (p.expiresAt && Date.parse(p.expiresAt) <= now.getTime()) return 'promo_expired';
  if (alreadyRedeemed) return 'promo_already_redeemed';
  if (hasPromoLimit(p) && (p.redemptions ?? 0) >= p.maxRedemptions) return 'promo_used_up';
  return null;
}

export interface ChargeInput {
  credits: number;
  action: string;
  costUsd: number;
  calls: LedgerEntry['calls'];
  /** Owner wallet: log the charge, don't deduct it. */
  owner?: boolean;
}

export interface CreditStore {
  /** Create the account with the starter grant if it doesn't exist; return its state. */
  ensure(key: string, meta: AccountMeta, starter: number, now: Date): Promise<AccountState>;
  /** The account's state without creating it (null: no such wallet yet). */
  getAccount(key: string, now: Date): Promise<AccountState | null>;
  /**
   * The starter grant, in ONE transaction: for an account whose starterState is 'pending' or 'paused' (created
   * 'pending' if missing), claim one address slot (rolling window) and one unit of today's sharded budget, add
   * `credits` (ledger 'grant' "starter") and clear the state. Address full → state 'address_limit'; budget full →
   * 'paused'; nothing is counted unless the grant happens. Already granted (or settled): 'already', no change.
   * Concurrent first actions of one wallet: one grants, the others see 'already' after it.
   */
  claimStarterGrant(key: string, meta: AccountMeta, credits: number, rule: StarterRule, now: Date): Promise<{ outcome: StarterOutcome; balance: number }>;
  /**
   * Take one starter grant from today's global budget (`day` = UTC "YYYY-MM-DD"): `shards` counters, each
   * allowed ceil(cap / shards). False when every shard is full (or cap is 0).
   */
  claimStarterBudget(day: string, cap: number, shards: number, now: Date): Promise<boolean>;
  /** Starter grants taken from `day`'s budget so far. */
  starterBudgetUsed(day: string): Promise<number>;
  /**
   * A background job may run now (no run within `minIntervalMs`, across instances): records the run and
   * returns the last saved checkpoint. ok: false when another run is too recent.
   */
  claimSyncRun(name: string, minIntervalMs: number, now: Date): Promise<{ ok: boolean; checkpoint: number | null }>;
  saveSyncCheckpoint(name: string, checkpoint: number, now: Date): Promise<void>;
  /** Let the job run again from `at` (e.g. 10 min after a failed run instead of the full interval). */
  deferSyncRun(name: string, at: Date): Promise<void>;
  /**
   * Take back `credits` of a purchase once per `reversalId` (e.g. one Play voided-purchase record), never more than
   * the purchase still has. Repeating the same id reverses nothing more. Null: purchase unknown.
   */
  reversePurchaseOnce(
    find: { purchaseKey?: string; secondaryKey?: string },
    reversalId: string,
    credits: number,
    reason: string,
    now: Date,
  ): Promise<{ reversed: number; balance: number; account: string } | null>;
  /** Hold `credits` if available >= credits (and > 0). Creates the account first if needed. Owner wallets: ok, no hold. */
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
   * Count one more starter grant for this address key; true while fewer than `limit` were claimed in the last
   * `windowMs` (rolling). `dryRun`: only check, count nothing.
   */
  claimStarter(addressKey: string, limit: number, windowMs: number, now: Date, dryRun?: boolean): Promise<boolean>;
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
  /** Mark (or unmark) an owner wallet; creates the account (no starter) if needed. Logged in the ledger. */
  setOwner(key: string, meta: AccountMeta, owner: boolean, reason: string, now: Date): Promise<{ balance: number; owner: boolean }>;
  /**
   * Redeem a promo code (already normalized) for this wallet in one transaction: checks it is active, not
   * expired, not used up and not yet redeemed by this wallet, then adds its credits (ledger 'grant',
   * reason "promo <CODE>") and counts the redemption. Creates the account (with `starter`) if needed.
   */
  redeemPromo(code: string, key: string, meta: AccountMeta, starter: number, now: Date): Promise<PromoResult>;
  /** Store a one-use link code (by hash) for this wallet. */
  createLinkCode(codeHash: string, key: string, expiresAt: Date, now: Date): Promise<void>;
  /** Use a link code once: the wallet key it was made for, or null (unknown, expired or used). */
  takeLinkCode(codeHash: string, now: Date): Promise<string | null>;
  /**
   * Link wallets: move `fromKey`'s balance (and owner flag) into `toKey`, log both sides ('merge'), leave
   * `fromKey` at 0 with mergedInto = toKey (late purchases and refunds of `fromKey` follow it).
   * No-op if `fromKey` doesn't exist, is `toKey`, or was already merged. `toKey` must exist.
   */
  mergeAccounts(fromKey: string, toKey: string, reason: string, now: Date): Promise<MergeResult>;
  /** Follow mergedInto (a few hops) to the wallet that holds the Sparks now. */
  resolveAccount(key: string): Promise<string>;
}

interface MemAccount {
  mergedInto?: string;
  starterGrantedAt?: string;
  starterState?: StarterState;
  meta: AccountMeta;
  balance: number;
  holds: Map<string, { credits: number; expiresAt: number }>;
  ledger: LedgerEntry[];
  totals: { granted: number; purchased: number; spent: number; ownerSpent?: number };
  owner?: boolean;
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
  readonly starterIps = new Map<string, { claims: number[] }>();
  readonly starterBudget = new Map<string, number[]>();
  readonly syncs = new Map<string, { nextRunAt: number; checkpoint: number | null }>();
  /** The web switch for tests. */
  webSwitch = false;
  readonly promos = new Map<string, PromoCode>();
  readonly linkCodes = new Map<string, { account: string; expiresAt: number; usedAt?: number }>();
  readonly promoRedemptions = new Map<string, Set<string>>();

  private ensureSync(key: string, meta: AccountMeta, starter: number, now: Date): { acc: MemAccount; created: boolean } {
    const existing = this.accounts.get(key);
    if (existing) return { acc: existing, created: false };
    const acc: MemAccount = { meta, balance: starter, holds: new Map(), ledger: [], totals: { granted: starter, purchased: 0, spent: 0 } };
    if (starter > 0) {
      acc.ledger.push({ type: 'grant', credits: starter, balanceAfter: starter, at: now.toISOString(), reason: 'starter' });
      acc.starterGrantedAt = now.toISOString();
    } else acc.starterState = 'pending'; // the starter comes on its first action (claimStarterGrant)
    this.accounts.set(key, acc);
    return { acc, created: true };
  }

  private state(acc: MemAccount, created: boolean, now: Date): AccountState {
    for (const [id, h] of acc.holds) if (h.expiresAt <= now.getTime()) acc.holds.delete(id);
    return {
      balance: acc.balance,
      available: acc.balance - liveHeld(acc.holds.values(), now.getTime()),
      created,
      owner: acc.owner === true,
      ...(acc.totals.purchased > 0 ? { paid: true } : {}),
      ...(acc.starterState && !acc.starterGrantedAt ? { starterState: acc.starterState } : {}),
    };
  }

  async getAccount(key: string, now: Date): Promise<AccountState | null> {
    const acc = this.accounts.get(key);
    return acc ? this.state(acc, false, now) : null;
  }

  async claimStarterGrant(key: string, meta: AccountMeta, credits: number, rule: StarterRule, now: Date) {
    const { acc } = this.ensureSync(key, meta, 0, now);
    if (acc.starterGrantedAt || (acc.starterState !== 'pending' && acc.starterState !== 'paused')) return { outcome: 'already' as const, balance: acc.balance };
    const t = now.getTime();
    const claims = liveClaims(this.starterIps.get(rule.addressKey), rule.windowMs, t);
    if (claims.length >= rule.perAddress) {
      acc.starterState = 'address_limit';
      return { outcome: 'address_limit' as const, balance: acc.balance };
    }
    const n = Math.max(1, Math.floor(rule.shards));
    const per = Math.ceil(rule.dailyCap / n);
    const counts = this.starterBudget.get(rule.day) ?? Array.from({ length: n }, () => 0);
    const start = Math.floor(Math.random() * n);
    const shard = per <= 0 ? -1 : Array.from({ length: n }, (_, k) => (start + k) % n).find((i) => (counts[i] ?? 0) < per) ?? -1;
    if (shard < 0) {
      acc.starterState = 'paused';
      return { outcome: 'paused' as const, balance: acc.balance };
    }
    counts[shard] = (counts[shard] ?? 0) + 1;
    this.starterBudget.set(rule.day, counts);
    this.starterIps.set(rule.addressKey, { claims: [...claims, t] });
    acc.balance += credits;
    acc.totals.granted += credits;
    acc.starterGrantedAt = now.toISOString();
    delete acc.starterState;
    acc.ledger.push({ type: 'grant', credits, balanceAfter: acc.balance, at: now.toISOString(), reason: 'starter' });
    return { outcome: 'granted' as const, balance: acc.balance };
  }

  async claimStarterBudget(day: string, cap: number, shards: number) {
    const n = Math.max(1, Math.floor(shards));
    const per = Math.ceil(cap / n);
    const counts = this.starterBudget.get(day) ?? Array.from({ length: n }, () => 0);
    this.starterBudget.set(day, counts);
    const order = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of order) {
      if ((counts[i] ?? 0) < per) {
        counts[i] = (counts[i] ?? 0) + 1;
        return true;
      }
    }
    return false;
  }

  async starterBudgetUsed(day: string) {
    return (this.starterBudget.get(day) ?? []).reduce((a, b) => a + b, 0);
  }

  async claimSyncRun(name: string, minIntervalMs: number, now: Date) {
    const cur = this.syncs.get(name);
    if (cur && cur.nextRunAt > now.getTime()) return { ok: false, checkpoint: cur.checkpoint };
    this.syncs.set(name, { nextRunAt: now.getTime() + minIntervalMs, checkpoint: cur?.checkpoint ?? null });
    return { ok: true, checkpoint: cur?.checkpoint ?? null };
  }

  async saveSyncCheckpoint(name: string, checkpoint: number, now: Date) {
    const cur = this.syncs.get(name);
    this.syncs.set(name, { nextRunAt: cur?.nextRunAt ?? now.getTime(), checkpoint });
  }

  async deferSyncRun(name: string, at: Date) {
    const cur = this.syncs.get(name);
    this.syncs.set(name, { nextRunAt: at.getTime(), checkpoint: cur?.checkpoint ?? null });
  }

  async reversePurchaseOnce(find: { purchaseKey?: string; secondaryKey?: string }, reversalId: string, credits: number, reason: string, now: Date) {
    const key = find.purchaseKey ?? (find.secondaryKey ? this.orders.get(find.secondaryKey) : undefined);
    const rec = key ? this.purchases.get(key) : undefined;
    if (!rec) return null;
    const accountKey = await this.resolveAccount(rec.account);
    const acc = this.accounts.get(accountKey);
    if (!acc) return null;
    if (rec.reversals?.[reversalId] !== undefined) return { reversed: 0, balance: acc.balance, account: accountKey };
    const delta = Math.max(0, Math.min(Math.floor(credits), rec.credits - (rec.reversedCredits ?? 0)));
    rec.reversals = { ...rec.reversals, [reversalId]: delta };
    if (delta <= 0) return { reversed: 0, balance: acc.balance, account: accountKey };
    rec.reversedCredits = (rec.reversedCredits ?? 0) + delta;
    acc.balance -= delta;
    acc.ledger.push({ type: 'reversal', credits: -delta, balanceAfter: acc.balance, at: now.toISOString(), reason, productId: rec.productId, provider: rec.provider, ...(rec.orderId ? { orderId: rec.orderId } : {}) });
    return { reversed: delta, balance: acc.balance, account: accountKey };
  }

  async ensure(key: string, meta: AccountMeta, starter: number, now: Date): Promise<AccountState> {
    const { acc, created } = this.ensureSync(key, meta, starter, now);
    return this.state(acc, created, now);
  }

  async reserve(key: string, meta: AccountMeta, starter: number, holdId: string, credits: number, ttlMs: number, now: Date) {
    const { acc, created } = this.ensureSync(key, meta, starter, now);
    const s = this.state(acc, created, now);
    if (s.owner) return { ...s, ok: true };
    const need = Math.max(1, credits);
    if (s.available < need) return { ...s, ok: false };
    acc.holds.set(holdId, { credits: need, expiresAt: now.getTime() + ttlMs });
    return { ...s, available: s.available - need, ok: true };
  }

  async settle(key: string, holdId: string, charge: ChargeInput, now: Date) {
    const acc = this.accounts.get(key);
    if (!acc) throw new Error('settle on missing account');
    acc.holds.delete(holdId);
    // Never below zero: when the real cost tops the hold, the part the balance can't cover is on us.
    const credits = charge.owner ? charge.credits : Math.min(charge.credits, Math.max(0, acc.balance));
    if (charge.owner) acc.totals.ownerSpent = (acc.totals.ownerSpent ?? 0) + credits;
    else {
      acc.balance -= credits;
      acc.totals.spent += credits;
    }
    acc.ledger.push({
      type: 'charge',
      credits: -credits,
      balanceAfter: acc.balance,
      at: now.toISOString(),
      action: charge.action,
      costUsd: charge.costUsd,
      calls: charge.calls ?? [],
      ...(charge.owner ? { notDeducted: true } : {}),
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

  async claimStarter(addressKey: string, limit: number, windowMs: number, now: Date, dryRun = false) {
    const t = now.getTime();
    const claims = liveClaims(this.starterIps.get(addressKey), windowMs, t);
    if (claims.length >= limit) return false;
    if (!dryRun) this.starterIps.set(addressKey, { claims: [...claims, t] });
    return true;
  }

  async reversePurchase(find: { purchaseKey?: string; secondaryKey?: string }, fraction: number, reason: string, now: Date) {
    const key = find.purchaseKey ?? (find.secondaryKey ? this.orders.get(find.secondaryKey) : undefined);
    const rec = key ? this.purchases.get(key) : undefined;
    if (!rec) return null;
    const target = Math.min(rec.credits, Math.max(0, Math.round(rec.credits * Math.min(1, Math.max(0, fraction)))));
    const delta = target - (rec.reversedCredits ?? 0);
    const accountKey = await this.resolveAccount(rec.account);
    const acc = this.accounts.get(accountKey);
    if (!acc) return null;
    // delta < 0 gives Sparks back (a dispute Mohit won: fraction 0 restores what the dispute took).
    if (delta === 0) return { reversed: 0, balance: acc.balance, account: accountKey };
    rec.reversedCredits = target;
    acc.balance -= delta;
    acc.ledger.push({ type: 'reversal', credits: -delta, balanceAfter: acc.balance, at: now.toISOString(), reason, productId: rec.productId, provider: rec.provider, ...(rec.orderId ? { orderId: rec.orderId } : {}) });
    return { reversed: delta, balance: acc.balance, account: accountKey };
  }

  async webEnabled() {
    return this.webSwitch;
  }

  async setOwner(key: string, meta: AccountMeta, owner: boolean, reason: string, now: Date) {
    const { acc } = this.ensureSync(key, meta, 0, now);
    acc.owner = owner;
    acc.ledger.push({ type: 'grant', credits: 0, balanceAfter: acc.balance, at: now.toISOString(), reason: (owner ? 'owner on: ' : 'owner off: ') + reason });
    return { balance: acc.balance, owner };
  }

  async redeemPromo(code: string, key: string, meta: AccountMeta, starter: number, now: Date): Promise<PromoResult> {
    const p = this.promos.get(code) ?? null;
    const used = this.promoRedemptions.get(code) ?? new Set<string>();
    const problem = promoProblem(p, used.has(key), now);
    if (problem || !p) return { ok: false, error: problem ?? 'promo_unknown' };
    const { acc } = this.ensureSync(key, meta, starter, now);
    acc.balance += p.credits;
    acc.totals.granted += p.credits;
    acc.ledger.push({ type: 'grant', credits: p.credits, balanceAfter: acc.balance, at: now.toISOString(), reason: `promo ${code}` });
    if (hasPromoLimit(p)) p.redemptions += 1; // no limit: no counter (same as the Firestore store)
    used.add(key);
    this.promoRedemptions.set(code, used);
    return { ok: true, code, credits: p.credits, balance: acc.balance };
  }

  async createLinkCode(codeHash: string, key: string, expiresAt: Date) {
    this.linkCodes.set(codeHash, { account: key, expiresAt: expiresAt.getTime() });
  }

  async takeLinkCode(codeHash: string, now: Date) {
    const c = this.linkCodes.get(codeHash);
    if (!c || c.usedAt || c.expiresAt <= now.getTime()) return null;
    c.usedAt = now.getTime();
    return c.account;
  }

  async mergeAccounts(fromKey: string, toKey: string, reason: string, now: Date): Promise<MergeResult> {
    const to = this.accounts.get(toKey);
    if (!to) throw new Error('merge into a missing wallet');
    const from = this.accounts.get(fromKey);
    if (!from || fromKey === toKey || from.mergedInto) return { balance: to.balance, moved: 0, owner: to.owner === true };
    const moved = from.balance;
    const at = now.toISOString();
    to.balance += moved;
    if (from.owner) to.owner = true;
    to.ledger.push({ type: 'merge', credits: moved, balanceAfter: to.balance, at, reason: `linked ${reason}: from ${fromKey}` });
    from.ledger.push({ type: 'merge', credits: -moved, balanceAfter: 0, at, reason: `linked ${reason}: into ${toKey}` });
    from.balance = 0;
    from.holds.clear();
    from.mergedInto = toKey;
    return { balance: to.balance, moved, owner: to.owner === true };
  }

  async resolveAccount(key: string) {
    let k = key;
    for (let i = 0; i < 5; i++) {
      const next = this.accounts.get(k)?.mergedInto;
      if (!next) break;
      k = next;
    }
    return k;
  }
}
