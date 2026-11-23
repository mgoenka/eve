/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Firestore implementation of CreditStore. Auth = ADC (Cloud Run runtime service account; locally
// `gcloud auth application-default login`), or the emulator when FIRESTORE_EMULATOR_HOST is set.
//
// aiCreditAccounts/{walletKey}                    { kind, app, id, balance, holds{}, totals{}, createdAt, updatedAt }
//   walletKey = "android:<package>:<appUserId>" or "web:<walletId>" (shared by every *.mohitgoenka.com app)
// aiCreditAccounts/{walletKey}/ledger/{autoId}    append-only LedgerEntry (never updated or deleted by code)
// aiCreditPurchases/{provider}:{sha256(extId)}    { account, provider, productId, orderId, credits, finalized, createdAt, finalizedAt }
// aiCreditOrders/{provider}:{secondaryId}         { purchaseKey, account }   (Play orderId / Stripe payment intent)
// aiCreditStarterIps/{sha256(salt+address)}       { count, windowStart }     (web starter grants per address)
// aiCreditConfig/web                              { enabled }                (the web credits switch)
// aiCreditPromos/{CODE}                           PromoCode { credits, maxRedemptions, redemptions, expiresAt, active, ... }
// aiCreditPromos/{CODE}/redemptions/{walletKey}   { account, credits, at, app }  (one per wallet)
// aiCreditLinkCodes/{sha256(code)}               { account, expiresAt, createdAt, usedAt? } (web linking, 10 min)
//
// Only the server touches these (no client SDK, no security-rule access needed). The package is
// imported lazily so web-only traffic and apps without Firestore never load it.
import type { DocumentReference, Firestore, Transaction } from '@google-cloud/firestore';
import { COLLECTIONS, WEB_SWITCH_DOC } from './config.ts';
import { liveHeld, promoProblem } from './store.ts';
import type { AccountMeta, AccountState, ChargeInput, CreditPurchaseInput, CreditStore, LedgerEntry, MergeResult, PromoCode, PromoResult, PurchaseRecord } from './store.ts';

type Holds = Record<string, { credits: number; expiresAt: number }>;
interface AccountDoc {
  kind: string;
  app: string;
  id: string;
  balance: number;
  holds: Holds;
  totals: { granted: number; purchased: number; spent: number; ownerSpent?: number };
  createdAt: string;
  updatedAt: string;
  /** Owner wallet: AI logged, never deducted (set by the owner code or scripts/credits-admin.mjs). */
  owner?: boolean;
  /** Linked into another web wallet (balance 0); late purchases and refunds follow it. */
  mergedInto?: string;
}

export interface FirestoreStoreOptions {
  /** Default: GOOGLE_CLOUD_PROJECT, else public-mohit-260610. */
  projectId?: string;
  databaseId?: string;
  /** Pass an existing client (tests). */
  firestore?: Firestore;
}

export class FirestoreCreditStore implements CreditStore {
  private dbPromise: Promise<Firestore> | null = null;
  private readonly opts: FirestoreStoreOptions;

  constructor(opts: FirestoreStoreOptions = {}) {
    this.opts = opts;
  }

  private db(): Promise<Firestore> {
    if (this.opts.firestore) return Promise.resolve(this.opts.firestore);
    if (!this.dbPromise) {
      this.dbPromise = import('@google-cloud/firestore').then(({ Firestore: F }) => {
        const settings: ConstructorParameters<typeof F>[0] = {
          projectId: this.opts.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'public-mohit-260610',
          // REST: faster cold start on Cloud Run than gRPC. The emulator needs gRPC (REST mode still asks ADC for a token).
          preferRest: !process.env.FIRESTORE_EMULATOR_HOST,
          ignoreUndefinedProperties: true,
        };
        if (this.opts.databaseId) settings.databaseId = this.opts.databaseId;
        return new F(settings);
      });
    }
    return this.dbPromise;
  }

  private async refs(key: string) {
    const db = await this.db();
    const account = db.collection(COLLECTIONS.accounts).doc(key);
    return { db, account, ledger: () => account.collection('ledger').doc() };
  }

  private static fresh(meta: AccountMeta, starter: number, now: Date): AccountDoc {
    const at = now.toISOString();
    return { kind: meta.kind, app: meta.app, id: meta.id, balance: starter, holds: {}, totals: { granted: starter, purchased: 0, spent: 0 }, createdAt: at, updatedAt: at };
  }

  /** Read-or-create inside a transaction. Writes the starter grant when creating. */
  private static async load(
    tx: Transaction,
    ref: DocumentReference,
    meta: AccountMeta,
    starter: number,
    now: Date,
  ): Promise<{ doc: AccountDoc; created: boolean }> {
    const snap = await tx.get(ref);
    if (snap.exists) return { doc: snap.data() as AccountDoc, created: false };
    return { doc: FirestoreCreditStore.fresh(meta, starter, now), created: true };
  }

  private static writeCreated(tx: Transaction, ref: DocumentReference, newLedger: () => DocumentReference, doc: AccountDoc, starter: number, now: Date) {
    tx.create(ref, doc);
    if (starter > 0) {
      const e: LedgerEntry = { type: 'grant', credits: starter, balanceAfter: starter, at: now.toISOString(), reason: 'starter' };
      tx.create(newLedger(), e);
    }
  }

  private static live(holds: Holds | undefined, nowMs: number): Holds {
    const out: Holds = {};
    for (const [id, h] of Object.entries(holds ?? {})) if (h && h.expiresAt > nowMs) out[id] = h;
    return out;
  }

  async ensure(key: string, meta: AccountMeta, starter: number, now: Date): Promise<AccountState> {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, starter, now);
      if (created) FirestoreCreditStore.writeCreated(tx, account, ledger, doc, starter, now);
      const holds = FirestoreCreditStore.live(doc.holds, now.getTime());
      return { balance: doc.balance, available: doc.balance - liveHeld(Object.values(holds), now.getTime()), created, owner: doc.owner === true };
    });
  }

  async reserve(key: string, meta: AccountMeta, starter: number, holdId: string, credits: number, ttlMs: number, now: Date) {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, starter, now);
      const holds = FirestoreCreditStore.live(doc.holds, now.getTime());
      const available = doc.balance - liveHeld(Object.values(holds), now.getTime());
      if (doc.owner === true) return { balance: doc.balance, available, created, ok: true, owner: true };
      const need = Math.max(1, credits);
      const ok = available >= need;
      if (ok) holds[holdId] = { credits: need, expiresAt: now.getTime() + ttlMs };
      if (created) FirestoreCreditStore.writeCreated(tx, account, ledger, { ...doc, holds }, starter, now);
      else if (ok) tx.update(account, { holds, updatedAt: now.toISOString() });
      return { balance: doc.balance, available: ok ? available - need : available, created, ok, owner: false };
    });
  }

  async settle(key: string, holdId: string, charge: ChargeInput, now: Date) {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(account);
      if (!snap.exists) throw new Error('settle on missing account');
      const doc = snap.data() as AccountDoc;
      const holds = FirestoreCreditStore.live(doc.holds, now.getTime());
      delete holds[holdId];
      const balance = charge.owner ? doc.balance : doc.balance - charge.credits;
      tx.update(
        account,
        charge.owner
          ? { holds, 'totals.ownerSpent': (doc.totals?.ownerSpent ?? 0) + charge.credits, updatedAt: now.toISOString() }
          : { balance, holds, 'totals.spent': (doc.totals?.spent ?? 0) + charge.credits, updatedAt: now.toISOString() },
      );
      const e: LedgerEntry = {
        type: 'charge',
        credits: -charge.credits,
        balanceAfter: balance,
        at: now.toISOString(),
        action: charge.action,
        costUsd: charge.costUsd,
        calls: charge.calls ?? [],
      };
      if (charge.owner) e.notDeducted = true;
      tx.create(ledger(), e);
      return { balance };
    });
  }

  async release(key: string, holdId: string) {
    const { db, account } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(account);
      if (!snap.exists) return { balance: 0 };
      const doc = snap.data() as AccountDoc;
      if (doc.holds && holdId in doc.holds) {
        const holds = { ...doc.holds };
        delete holds[holdId];
        tx.update(account, { holds });
      }
      return { balance: doc.balance };
    });
  }

  async creditPurchase(p: CreditPurchaseInput, now: Date) {
    const { db, account, ledger } = await this.refs(p.key);
    const purchaseRef = db.collection(COLLECTIONS.purchases).doc(p.purchaseKey);
    const secondaryRefs = p.secondaryKeys.map((k) => db.collection(COLLECTIONS.externalIds).doc(k));
    return db.runTransaction(async (tx) => {
      // Firestore transactions: every read before any write.
      const prior = await tx.get(purchaseRef);
      const priorSecondary = (await Promise.all(secondaryRefs.map((r) => tx.get(r)))).find((d) => d.exists);
      if (prior.exists || priorSecondary) {
        const rec = prior.exists ? (prior.data() as PurchaseRecord) : null;
        const accKey = rec?.account ?? (priorSecondary?.data() as { account?: string } | undefined)?.account ?? p.key;
        const accSnap = await tx.get(db.collection(COLLECTIONS.accounts).doc(accKey));
        return { balance: (accSnap.data() as AccountDoc | undefined)?.balance ?? 0, duplicate: true, finalized: rec?.finalized ?? true, account: accKey };
      }
      const { doc, created } = await FirestoreCreditStore.load(tx, account, p.meta, p.starter, now);
      const balance = doc.balance + p.credits;
      const at = now.toISOString();
      // One write per document: a new account is created with the purchase already added.
      if (created) FirestoreCreditStore.writeCreated(tx, account, ledger, { ...doc, balance, totals: { ...doc.totals, purchased: p.credits } }, p.starter, now);
      else tx.update(account, { balance, 'totals.purchased': (doc.totals?.purchased ?? 0) + p.credits, updatedAt: at });
      const e: LedgerEntry = { type: 'purchase', credits: p.credits, balanceAfter: balance, at, productId: p.productId, provider: p.provider };
      if (p.orderId) e.orderId = p.orderId;
      if (p.purchaseType !== undefined) e.purchaseType = p.purchaseType;
      tx.create(ledger(), e);
      const rec: PurchaseRecord = {
        account: p.key,
        provider: p.provider,
        productId: p.productId,
        orderId: p.orderId,
        credits: p.credits,
        finalized: p.finalized,
        createdAt: at,
      };
      tx.create(purchaseRef, rec);
      for (const r of secondaryRefs) tx.create(r, { purchaseKey: p.purchaseKey, account: p.key });
      return { balance, duplicate: false, finalized: p.finalized, account: p.key };
    });
  }

  async getPurchase(purchaseKey: string): Promise<PurchaseRecord | null> {
    const db = await this.db();
    const snap = await db.collection(COLLECTIONS.purchases).doc(purchaseKey).get();
    return snap.exists ? (snap.data() as PurchaseRecord) : null;
  }

  async markFinalized(purchaseKey: string, now: Date): Promise<void> {
    const db = await this.db();
    await db.collection(COLLECTIONS.purchases).doc(purchaseKey).update({ finalized: true, finalizedAt: now.toISOString() });
  }

  async grant(key: string, meta: AccountMeta, credits: number, reason: string, now: Date) {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, 0, now);
      const balance = doc.balance + credits;
      const at = now.toISOString();
      if (created) tx.create(account, { ...doc, balance, totals: { ...doc.totals, granted: credits } });
      else tx.update(account, { balance, 'totals.granted': (doc.totals?.granted ?? 0) + credits, updatedAt: at });
      const e: LedgerEntry = { type: 'grant', credits, balanceAfter: balance, at, reason };
      tx.create(ledger(), e);
      return { balance };
    });
  }

  async claimStarter(addressKey: string, limit: number, windowMs: number, now: Date) {
    const db = await this.db();
    const ref = db.collection(COLLECTIONS.starterIps).doc(addressKey);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const t = now.getTime();
      const cur = snap.exists ? (snap.data() as { count?: number; windowStart?: number }) : null;
      const fresh = !cur || (cur.windowStart ?? 0) + windowMs <= t;
      const count = fresh ? 0 : (cur?.count ?? 0);
      if (count >= limit) return false;
      tx.set(ref, { count: count + 1, windowStart: fresh ? t : (cur?.windowStart ?? t) });
      return true;
    });
  }

  async reversePurchase(find: { purchaseKey?: string; secondaryKey?: string }, fraction: number, reason: string, now: Date) {
    const db = await this.db();
    let purchaseKey = find.purchaseKey;
    if (!purchaseKey && find.secondaryKey) {
      const s = await db.collection(COLLECTIONS.externalIds).doc(find.secondaryKey).get();
      purchaseKey = (s.data() as { purchaseKey?: string } | undefined)?.purchaseKey;
    }
    if (!purchaseKey) return null;
    const purchaseRef = db.collection(COLLECTIONS.purchases).doc(purchaseKey);
    return db.runTransaction(async (tx) => {
      const pSnap = await tx.get(purchaseRef);
      if (!pSnap.exists) return null;
      const rec = pSnap.data() as PurchaseRecord;
      const accRef = db.collection(COLLECTIONS.accounts).doc(rec.account);
      const aSnap = await tx.get(accRef);
      if (!aSnap.exists) return null;
      let accRefNow = accRef;
      let doc = aSnap.data() as AccountDoc;
      for (let i = 0; i < 5 && doc.mergedInto; i++) {
        const nextRef = db.collection(COLLECTIONS.accounts).doc(doc.mergedInto);
        const next = await tx.get(nextRef);
        if (!next.exists) break;
        accRefNow = nextRef;
        doc = next.data() as AccountDoc;
      }
      const target = Math.min(rec.credits, Math.max(0, Math.round(rec.credits * Math.min(1, Math.max(0, fraction)))));
      const delta = target - (rec.reversedCredits ?? 0);
      if (delta <= 0) return { reversed: 0, balance: doc.balance, account: accRefNow.id };
      const balance = doc.balance - delta;
      const at = now.toISOString();
      tx.update(accRefNow, { balance, updatedAt: at });
      tx.update(purchaseRef, { reversedCredits: target, reversedAt: at });
      const e: LedgerEntry = { type: 'reversal', credits: -delta, balanceAfter: balance, at, reason, productId: rec.productId, provider: rec.provider };
      if (rec.orderId) e.orderId = rec.orderId;
      tx.create(accRefNow.collection('ledger').doc(), e);
      return { reversed: delta, balance, account: accRefNow.id };
    });
  }

  async setOwner(key: string, meta: AccountMeta, owner: boolean, reason: string, now: Date) {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, 0, now);
      const at = now.toISOString();
      if (created) tx.create(account, { ...doc, owner });
      else tx.update(account, { owner, updatedAt: at });
      const e: LedgerEntry = { type: 'grant', credits: 0, balanceAfter: doc.balance, at, reason: (owner ? 'owner on: ' : 'owner off: ') + reason };
      tx.create(ledger(), e);
      return { balance: doc.balance, owner };
    });
  }

  async redeemPromo(code: string, key: string, meta: AccountMeta, starter: number, now: Date): Promise<PromoResult> {
    const { db, account, ledger } = await this.refs(key);
    const promoRef = db.collection(COLLECTIONS.promos).doc(code);
    const redemptionRef = promoRef.collection('redemptions').doc(key);
    return db.runTransaction(async (tx): Promise<PromoResult> => {
      const pSnap = await tx.get(promoRef);
      const rSnap = await tx.get(redemptionRef);
      const promo = pSnap.exists ? (pSnap.data() as PromoCode) : null;
      const problem = promoProblem(promo, rSnap.exists, now);
      if (problem || !promo) return { ok: false, error: problem ?? 'promo_unknown' };
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, starter, now);
      const credits = Math.max(0, Math.floor(promo.credits));
      const balance = doc.balance + credits;
      const at = now.toISOString();
      if (created) {
        FirestoreCreditStore.writeCreated(tx, account, ledger, { ...doc, balance, totals: { ...doc.totals, granted: doc.totals.granted + credits } }, starter, now);
      } else tx.update(account, { balance, 'totals.granted': (doc.totals?.granted ?? 0) + credits, updatedAt: at });
      const e: LedgerEntry = { type: 'grant', credits, balanceAfter: balance, at, reason: `promo ${code}` };
      tx.create(ledger(), e);
      tx.create(redemptionRef, { account: key, credits, at, app: meta.app });
      tx.update(promoRef, { redemptions: (promo.redemptions ?? 0) + 1, lastRedeemedAt: at });
      return { ok: true, code, credits, balance };
    });
  }

  async createLinkCode(codeHash: string, key: string, expiresAt: Date, now: Date): Promise<void> {
    const db = await this.db();
    await db.collection(COLLECTIONS.linkCodes).doc(codeHash).create({ account: key, expiresAt: expiresAt.getTime(), createdAt: now.toISOString() });
  }

  async takeLinkCode(codeHash: string, now: Date): Promise<string | null> {
    const db = await this.db();
    const ref = db.collection(COLLECTIONS.linkCodes).doc(codeHash);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const c = snap.exists ? (snap.data() as { account?: string; expiresAt?: number; usedAt?: string }) : null;
      if (!c?.account || c.usedAt || (c.expiresAt ?? 0) <= now.getTime()) return null;
      tx.update(ref, { usedAt: now.toISOString() });
      return c.account;
    });
  }

  async mergeAccounts(fromKey: string, toKey: string, reason: string, now: Date): Promise<MergeResult> {
    const db = await this.db();
    const fromRef = db.collection(COLLECTIONS.accounts).doc(fromKey);
    const toRef = db.collection(COLLECTIONS.accounts).doc(toKey);
    return db.runTransaction(async (tx) => {
      const toSnap = await tx.get(toRef);
      if (!toSnap.exists) throw new Error('merge into a missing wallet');
      const to = toSnap.data() as AccountDoc;
      const fromSnap = fromKey === toKey ? null : await tx.get(fromRef);
      const from = fromSnap?.exists ? (fromSnap.data() as AccountDoc) : null;
      if (!from || from.mergedInto) return { balance: to.balance, moved: 0, owner: to.owner === true };
      const moved = from.balance;
      const balance = to.balance + moved;
      const owner = to.owner === true || from.owner === true;
      const at = now.toISOString();
      tx.update(toRef, { balance, owner, 'totals.merged': ((to.totals as { merged?: number } | undefined)?.merged ?? 0) + moved, updatedAt: at });
      tx.update(fromRef, { balance: 0, holds: {}, mergedInto: toKey, updatedAt: at });
      const inTo: LedgerEntry = { type: 'merge', credits: moved, balanceAfter: balance, at, reason: `linked ${reason}: from ${fromKey}` };
      const outFrom: LedgerEntry = { type: 'merge', credits: -moved, balanceAfter: 0, at, reason: `linked ${reason}: into ${toKey}` };
      tx.create(toRef.collection('ledger').doc(), inTo);
      tx.create(fromRef.collection('ledger').doc(), outFrom);
      return { balance, moved, owner };
    });
  }

  async resolveAccount(key: string): Promise<string> {
    const db = await this.db();
    let k = key;
    for (let i = 0; i < 5; i++) {
      const snap = await db.collection(COLLECTIONS.accounts).doc(k).get();
      const next = snap.exists ? (snap.data() as AccountDoc).mergedInto : undefined;
      if (!next) break;
      k = next;
    }
    return k;
  }

  async webEnabled(): Promise<boolean> {
    const db = await this.db();
    const snap = await db.collection(WEB_SWITCH_DOC.collection).doc(WEB_SWITCH_DOC.id).get();
    return snap.exists && (snap.data() as { enabled?: unknown }).enabled === true;
  }
}
