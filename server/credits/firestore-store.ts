/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Firestore implementation of CreditStore. Auth = ADC (Cloud Run runtime service account; locally
// `gcloud auth application-default login`), or the emulator when FIRESTORE_EMULATOR_HOST is set.
//
// aiCreditAccounts/{walletKey}                    { kind, app, id, balance, holds{}, totals{}, createdAt, updatedAt }
//   walletKey = "android:<package>:<appUserId>" (later "web:<walletId>")
// aiCreditAccounts/{walletKey}/ledger/{autoId}    append-only LedgerEntry (never updated or deleted by code)
// aiCreditPurchases/{provider}:{sha256(extId)}    { account, provider, productId, orderId, credits, finalized, createdAt, finalizedAt }
// aiCreditOrders/{provider}:{secondaryId}         { purchaseKey, account }   (Play orderId: second idempotency key)
//
// Only the server touches these (no client SDK, no security-rule access needed). The package is
// imported lazily so web-only traffic and apps without Firestore never load it.
import type { DocumentReference, Firestore, Transaction } from '@google-cloud/firestore';
import { COLLECTIONS } from './config.ts';
import { liveHeld } from './store.ts';
import type { AccountMeta, AccountState, ChargeInput, CreditPurchaseInput, CreditStore, LedgerEntry, PurchaseRecord } from './store.ts';

type Holds = Record<string, { credits: number; expiresAt: number }>;
interface AccountDoc {
  kind: string;
  app: string;
  id: string;
  balance: number;
  holds: Holds;
  totals: { granted: number; purchased: number; spent: number };
  createdAt: string;
  updatedAt: string;
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
      return { balance: doc.balance, available: doc.balance - liveHeld(Object.values(holds), now.getTime()), created };
    });
  }

  async reserve(key: string, meta: AccountMeta, starter: number, holdId: string, credits: number, ttlMs: number, now: Date) {
    const { db, account, ledger } = await this.refs(key);
    return db.runTransaction(async (tx) => {
      const { doc, created } = await FirestoreCreditStore.load(tx, account, meta, starter, now);
      const holds = FirestoreCreditStore.live(doc.holds, now.getTime());
      const available = doc.balance - liveHeld(Object.values(holds), now.getTime());
      const need = Math.max(1, credits);
      const ok = available >= need;
      if (ok) holds[holdId] = { credits: need, expiresAt: now.getTime() + ttlMs };
      if (created) FirestoreCreditStore.writeCreated(tx, account, ledger, { ...doc, holds }, starter, now);
      else if (ok) tx.update(account, { holds, updatedAt: now.toISOString() });
      return { balance: doc.balance, available: ok ? available - need : available, created, ok };
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
      const balance = doc.balance - charge.credits;
      tx.update(account, {
        balance,
        holds,
        'totals.spent': (doc.totals?.spent ?? 0) + charge.credits,
        updatedAt: now.toISOString(),
      });
      const e: LedgerEntry = {
        type: 'charge',
        credits: -charge.credits,
        balanceAfter: balance,
        at: now.toISOString(),
        action: charge.action,
        costUsd: charge.costUsd,
        calls: charge.calls ?? [],
      };
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
}
