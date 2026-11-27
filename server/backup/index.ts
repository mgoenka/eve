// Synced from app-platform/server-kit/backup/index.ts. Do not edit here. VERSION 1613fc1 2026-11-27T05:02:42Z
/**
 * Backup / sync server: a private-key record store (Firestore, or memory for local runs and tests) and an Express
 * router with rate limits, size caps and one-use link codes. The client is ui-kit/utils/backup.ts; the wire format
 * is ./protocol.ts (vendored from ui-kit/utils/backupProtocol.ts by scripts/sync-backup.sh).
 *
 *   import express from "express";
 *   import { backupRouter } from "./server/backup/index.ts";
 *   app.set("trust proxy", 1);
 *   app.use("/api/backup", backupRouter(express, { app: "spinner", allowedHosts: ["spinner.mohitgoenka.com"] }));
 *
 * Mount it BEFORE any other express.json() on that path (it parses up to LIMITS.bodyBytes itself).
 * Firestore layout (default; Scorer keeps its own top-level names):
 *   mgBackup/{app}/spaces/{sha256(app:key)}             { count, createdAt, lastSeenAt }
 *   mgBackup/{app}/spaces/{id}/records/{recordId}       { kind, updatedAt, deleted, data (JSON string), seq }
 *   mgBackup/{app}/links/{sha256(app-link:code)}        { key, expiresAt, expireAt }   one use, 10 minutes (TTL on expireAt)
 */
import { createHash, randomBytes } from "node:crypto";
import { isIPv6 } from "node:net";
import type { Firestore } from "@google-cloud/firestore";
import { APP_RE, LIMITS, LINK_CODE_LENGTH, LINK_TTL_MS, cleanFamilyRecord, cleanRecord, decodeFamilyCookie, encodeFamilyCookie, normalizeKey, normalizeLinkCode, randomCode, type SyncRecord, type SyncResponse } from "./protocol.ts";

export * from "./protocol.ts";

export interface BackupStore {
  readonly kind: "firestore" | "memory";
  sync(spaceId: string, incoming: SyncRecord[], since: number): Promise<SyncResponse>;
  createLink(key: string): Promise<{ code: string; expiresAt: number }>;
  redeemLink(code: string): Promise<string | null>;
  /** Delete every record of a space (account deletion). Returns how many were deleted. */
  erase(spaceId: string): Promise<number>;
}

export class SpaceFullError extends Error {}

export interface StoreNames {
  /** Prefix hashed with the key into the space id, e.g. "scorer" → sha256("scorer:<key>"). */
  salt: string;
  /** Firestore collection paths. */
  spaces: string;
  links: string;
}

export const defaultNames = (app: string): StoreNames => ({ salt: app, spaces: `mgBackup/${app}/spaces`, links: `mgBackup/${app}/links` });

/** Pulls start this far before the last answer so writes that were still committing are not missed. */
const CURSOR_MARGIN_MS = 5_000;

export const spaceIdOf = (names: StoreNames, key: string) => createHash("sha256").update(`${names.salt}:${key}`).digest("hex");
const codeIdOf = (names: StoreNames, code: string) => createHash("sha256").update(`${names.salt}-link:${code}`).digest("hex");
const newLinkCode = () => randomCode(LINK_CODE_LENGTH, (n) => randomBytes(n));

interface Stored {
  kind: string;
  updatedAt: number;
  deleted: boolean;
  data: string;
  seq: number;
}

const toRecord = (id: string, s: Stored): SyncRecord => ({
  id,
  kind: s.kind,
  updatedAt: s.updatedAt,
  ...(s.deleted ? { deleted: true } : {}),
  data: s.deleted ? null : JSON.parse(s.data),
});

/** Unique, increasing-per-request sequence numbers: ms * 1000 + index. */
const seqBase = () => Date.now() * 1000;

function page(rows: [string, Stored][], since: number, sent: Map<string, number>, start: number, truncatedAt?: number): SyncResponse {
  const fresh = rows.filter(([id, s]) => s.seq >= since && sent.get(id) !== s.updatedAt).sort((a, b) => a[1].seq - b[1].seq);
  const out: [string, Stored][] = [];
  let bytes = 0;
  for (const row of fresh) {
    if (out.length >= LIMITS.recordsPerResponse) break;
    if (out.length && bytes + row[1].data.length > LIMITS.responseBytes) break;
    bytes += row[1].data.length;
    out.push(row);
  }
  const over = out.length < fresh.length;
  const more = over || truncatedAt !== undefined;
  const cursor = over ? out[out.length - 1]![1].seq : truncatedAt !== undefined ? truncatedAt : (start - CURSOR_MARGIN_MS) * 1000;
  return { cursor: Math.max(cursor, 0), records: out.map(([id, s]) => toRecord(id, s)), more };
}

export function createMemoryStore(): BackupStore {
  const spaces = new Map<string, Map<string, Stored>>();
  const links = new Map<string, { key: string; expiresAt: number }>();
  return {
    kind: "memory",
    async sync(spaceId, incoming, since) {
      const start = Date.now();
      let space = spaces.get(spaceId);
      if (!space) spaces.set(spaceId, (space = new Map()));
      const added = incoming.filter((r) => !space!.has(r.id)).length;
      if (space.size + added > LIMITS.recordsPerSpace) throw new SpaceFullError();
      const base = seqBase();
      incoming.forEach((r, i) => {
        const old = space!.get(r.id);
        if (old && old.updatedAt > r.updatedAt) return;
        space!.set(r.id, { kind: r.kind, updatedAt: r.updatedAt, deleted: !!r.deleted, data: JSON.stringify(r.data ?? null), seq: base + i });
      });
      const sent = new Map(incoming.map((r) => [r.id, r.updatedAt]));
      return page([...space.entries()], since, sent, start);
    },
    async createLink(key) {
      const now = Date.now();
      for (const [k, v] of links) if (v.expiresAt <= now) links.delete(k);
      const code = newLinkCode();
      const expiresAt = now + LINK_TTL_MS;
      links.set(code, { key, expiresAt });
      return { code, expiresAt };
    },
    async erase(spaceId) {
      const n = spaces.get(spaceId)?.size ?? 0;
      spaces.delete(spaceId);
      return n;
    },
    async redeemLink(code) {
      const hit = links.get(code);
      links.delete(code);
      return hit && hit.expiresAt > Date.now() ? hit.key : null;
    },
  };
}

export function createFirestoreStore(names: StoreNames, projectId?: string): BackupStore {
  let dbPromise: Promise<Firestore> | null = null;
  // The SDK (gRPC + protobufs) is heavy: load it on first use so cold starts stay fast.
  const db = () =>
    (dbPromise ??= import("@google-cloud/firestore").then(
      ({ Firestore }) => {
        const pid = projectId || process.env.GOOGLE_CLOUD_PROJECT;
        return new Firestore({ ...(pid ? { projectId: pid } : {}), ignoreUndefinedProperties: true });
      },
    ));

  return {
    kind: "firestore",
    async sync(spaceId, incoming, since) {
      const start = Date.now();
      const fs = await db();
      const { FieldValue } = await import("@google-cloud/firestore");
      const spaceRef = fs.collection(names.spaces).doc(spaceId);
      const recs = spaceRef.collection("records");

      if (incoming.length) {
        const refs = incoming.map((r) => recs.doc(r.id));
        const [spaceSnap, ...existing] = await fs.getAll(spaceRef, ...refs);
        const count = (spaceSnap?.get("count") as number | undefined) ?? 0;
        const added = existing.filter((s) => !s.exists).length;
        if (count + added > LIMITS.recordsPerSpace) throw new SpaceFullError();
        const batch = fs.batch();
        const base = seqBase();
        incoming.forEach((r, i) => {
          const old = existing[i];
          if (old?.exists && (old.get("updatedAt") as number) > r.updatedAt) return;
          const doc: Stored = { kind: r.kind, updatedAt: r.updatedAt, deleted: !!r.deleted, data: JSON.stringify(r.data ?? null), seq: base + i };
          batch.set(refs[i]!, doc);
        });
        batch.set(spaceRef, { lastSeenAt: start, count: FieldValue.increment(added), ...(spaceSnap?.exists ? {} : { createdAt: start }) }, { merge: true });
        await batch.commit();
      }

      const limit = LIMITS.recordsPerResponse + incoming.length;
      const snap = await recs.where("seq", ">=", since).orderBy("seq").limit(limit).get();
      const rows = snap.docs.map((d) => [d.id, d.data() as Stored] as [string, Stored]);
      const sent = new Map(incoming.map((r) => [r.id, r.updatedAt]));
      return page(rows, since, sent, start, snap.size === limit ? rows[rows.length - 1]![1].seq : undefined);
    },
    async createLink(key) {
      const fs = await db();
      const code = newLinkCode();
      const expiresAt = Date.now() + LINK_TTL_MS;
      // expireAt: a Firestore TTL policy (collection group "links", field expireAt) deletes codes nobody redeemed,
      // which otherwise keep the raw key (the one that decrypts an encrypted space) in Firestore for good.
      await fs.collection(names.links).doc(codeIdOf(names, code)).set({ key, expiresAt, expireAt: new Date(expiresAt) });
      return { code, expiresAt };
    },
    async erase(spaceId) {
      const fs = await db();
      const spaceRef = fs.collection(names.spaces).doc(spaceId);
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const snap = await spaceRef.collection("records").limit(400).get();
        if (snap.empty) break;
        const batch = fs.batch();
        for (const d of snap.docs) batch.delete(d.ref);
        await batch.commit();
        n += snap.size;
      }
      await spaceRef.delete();
      return n;
    },
    async redeemLink(code) {
      const fs = await db();
      const ref = fs.collection(names.links).doc(codeIdOf(names, code));
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        const expiresAt = snap.get("expiresAt") as number;
        return expiresAt > Date.now() ? (snap.get("key") as string) : null;
      });
    },
  };
}

/** Firestore on Cloud Run (or with FIRESTORE_EMULATOR_HOST / MG_BACKUP_STORE=firestore); memory everywhere else. */
export function createStore(names: StoreNames, opts: { projectId?: string; envPrefix?: string } = {}): BackupStore {
  const forced = process.env[`${opts.envPrefix ?? "MG_BACKUP"}_STORE`] ?? process.env.MG_BACKUP_STORE;
  const useFirestore = !!process.env.K_SERVICE || !!process.env.FIRESTORE_EMULATOR_HOST || forced === "firestore";
  if (forced === "memory" || !useFirestore) return createMemoryStore();
  return createFirestoreStore(names, opts.projectId);
}

// ---------- rate limits ----------

/** Fixed-window counter per key (e.g. per IP). Old windows are swept lazily; at most `maxKeys` are tracked. */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  constructor(limit: number, windowMs: number, maxKeys = 50_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** 0 when allowed, otherwise the seconds until the window resets. */
  hit(key: string): number {
    const now = Date.now();
    if (now - this.lastSweep > this.windowMs) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
      this.lastSweep = now;
    }
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.delete(key);
      while (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest === undefined) break;
        this.buckets.delete(oldest);
      }
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    b.count += 1;
    return b.count <= this.limit ? 0 : Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  }

  /** Take back one hit (an attempt counted up front that turned out not to count). */
  undo(key: string): void {
    const b = this.buckets.get(key);
    if (b && b.resetAt > Date.now() && b.count > 0) b.count -= 1;
  }
}

/** IPv4 as is; IPv6 by its /64 (one subscriber usually gets a whole /64). */
export function ipKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  const addr = ip.split("%")[0]!.toLowerCase();
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = addr.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":") + "::/64";
}

// ---------- router ----------

/** The bits of Express the router uses (so the kit needs no @types/express). */
interface Req {
  ip?: string | undefined;
  body?: any;
  get(name: string): string | undefined;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  set(name: string, value: string): unknown;
}
type Next = (err?: unknown) => void;
type Handler = (req: Req, res: Res, next: Next) => unknown;
interface RouterLike {
  use(...h: unknown[]): unknown;
  get(path: string, ...h: Handler[]): unknown;
  post(path: string, ...h: Handler[]): unknown;
}
interface ExpressLike<R> {
  Router(): R;
  json(opts: { limit: number; strict: boolean }): unknown;
}

export interface BackupRouterOptions {
  /** App id, e.g. "spinner" (lowercase). Namespaces the space ids, the link codes and the Firestore paths. */
  app: string;
  /** Hosts allowed to call (Origin / Referer). localhost and 127.0.0.1 are always allowed. */
  allowedHosts: string[];
  /** Record kinds this app accepts (default: any kind matching KIND_RE). */
  kinds?: readonly string[];
  /** Header carrying the key. Default "x-mg-backup-key". */
  keyHeader?: string;
  /** Firestore names (default defaultNames(app)). */
  names?: StoreNames;
  /** Default: createStore(names). */
  store?: BackupStore;
  projectId?: string;
  /** Per-IP limits. */
  syncPerMinute?: number;
  linkPerMinute?: number;
  wrongCodesPerHour?: number;
  globalPerMinute?: number;
}

// ---------- backup family cookie ----------
export const FAMILY_COOKIE = "mg_bk";
/** 400 days: the longest cookie lifetime Chrome keeps (re-set whenever an app publishes). */
const FAMILY_MAX_AGE_S = 400 * 24 * 3600;
const FAMILY_SITE = "mohitgoenka.com";
/** ".mohitgoenka.com" on the live hosts (shared by every app), null elsewhere (a host-only cookie: localhost, tests). */
export function familyCookieDomain(host: string | undefined): string | null {
  const h = String(host ?? "").toLowerCase().replace(/:\d+$/, "");
  return h === FAMILY_SITE || h.endsWith(`.${FAMILY_SITE}`) ? `.${FAMILY_SITE}` : null;
}
function cookieOf(req: Req, name: string): string {
  for (const part of String(req.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** Returns express.Router() (typed as the app's own Router) with the routes on it, plus `.store`. */
export function backupRouter<R>(express: ExpressLike<R>, opts: BackupRouterOptions): R & { store: BackupStore } {
  if (!APP_RE.test(opts.app)) throw new Error(`backupRouter: bad app id ${opts.app}`);
  const names = opts.names ?? defaultNames(opts.app);
  const store = opts.store ?? createStore(names, opts.projectId ? { projectId: opts.projectId } : {});
  const keyHeader = opts.keyHeader ?? "x-mg-backup-key";
  const isProd = process.env.NODE_ENV === "production";
  const allowed = new Set(["localhost", "127.0.0.1", ...opts.allowedHosts.map((h) => h.toLowerCase())]);

  const syncPerMinute = new RateLimiter(opts.syncPerMinute ?? 90, 60_000);
  const linkPerMinute = new RateLimiter(opts.linkPerMinute ?? 10, 60_000);
  const wrongCodesPerHour = new RateLimiter(opts.wrongCodesPerHour ?? 12, 60 * 60_000);
  const globalPerMinute = new RateLimiter(opts.globalPerMinute ?? 3000, 60_000);

  const hostOf = (h: string | undefined) => {
    if (!h) return null;
    try {
      return new URL(h).hostname.toLowerCase();
    } catch {
      return null;
    }
  };
  const tooMany = (res: Res, wait: number) => {
    res.set("Retry-After", String(wait));
    res.status(429).json({ error: "rate_limited", retryAfter: wait });
  };
  const limit = (limiter: RateLimiter): Handler => (req, res, next) => {
    const wait = globalPerMinute.hit("all") || limiter.hit(ipKey(req.ip));
    if (wait) return tooMany(res, wait);
    next();
  };
  const keyOf = (req: Req) => normalizeKey(String(req.get(keyHeader) ?? ""));
  const unavailable = (res: Res, what: string, err: unknown) => {
    console.error(`[backup] ${opts.app}: ${what} failed`, (err as Error)?.message);
    res.status(503).json({ error: "sync_unavailable" });
  };

  const router = express.Router();
  const r = router as unknown as RouterLike;
  // Health check: no data, so no origin check (some apps send no Referer on same-origin GETs).
  r.get("/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, store: store.kind });
  });
  r.use((req: Req, res: Res, next: Next) => {
    res.set("Cache-Control", "no-store");
    // Same-origin only: browsers send Origin on POST; anything from another site is refused.
    const source = hostOf(req.get("origin")) ?? hostOf(req.get("referer"));
    if (source ? !allowed.has(source) : isProd) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
  r.use(express.json({ limit: LIMITS.bodyBytes, strict: true }));


  r.post("/sync", limit(syncPerMinute), async (req, res) => {
    const key = keyOf(req);
    const since = req.body?.since;
    const raw = req.body?.records;
    if (!key || typeof since !== "number" || !Number.isFinite(since) || since < 0 || !Array.isArray(raw) || raw.length > LIMITS.recordsPerRequest) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const records: SyncRecord[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      const clean = cleanRecord(v, opts.kinds);
      if (!clean || seen.has(clean.id)) {
        res.status(400).json({ error: "invalid_record" });
        return;
      }
      seen.add(clean.id);
      records.push(clean);
    }
    try {
      res.json(await store.sync(spaceIdOf(names, key), records, since));
    } catch (err) {
      if (err instanceof SpaceFullError) {
        res.status(413).json({ error: "space_full" });
        return;
      }
      unavailable(res, "sync", err);
    }
  });

  r.post("/erase", limit(linkPerMinute), async (req, res) => {
    const key = keyOf(req);
    if (!key) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    try {
      res.json({ ok: true, deleted: await store.erase(spaceIdOf(names, key)) });
    } catch (err) {
      unavailable(res, "erase", err);
    }
  });

  r.post("/link/create", limit(linkPerMinute), async (req, res) => {
    const key = keyOf(req);
    if (!key) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    try {
      res.json(await store.createLink(key));
    } catch (err) {
      unavailable(res, "link create", err);
    }
  });

  r.post("/link/redeem", limit(linkPerMinute), async (req, res) => {
    const ip = ipKey(req.ip);
    const code = normalizeLinkCode(String(req.body?.code ?? ""));
    if (!code) {
      res.status(400).json({ error: "wrong_code" });
      return;
    }
    // Counted BEFORE the lookup and given back unless it was a wrong code: past the limit a guess is refused
    // without being tried (checking only after the lookup still let every guess through), and parallel guesses
    // can't all pass a check made before any of them was counted.
    const wait = wrongCodesPerHour.hit(ip);
    if (wait) {
      wrongCodesPerHour.undo(ip);
      return tooMany(res, wait);
    }
    try {
      const key = await store.redeemLink(code);
      if (!key) {
        res.status(404).json({ error: "wrong_code" });
        return;
      }
      wrongCodesPerHour.undo(ip);
      res.json({ key });
    } catch (err) {
      wrongCodesPerHour.undo(ip);
      unavailable(res, "link redeem", err);
    }
  });

  // ---------- backup family (docs/backup-family.md): one key for every app on *.mohitgoenka.com ----------
  // The record lives in an httpOnly cookie on the parent domain, so every app in this browser shares it;
  // mg_bk_on=1 (readable) only tells the page there is one, so apps without it skip this request.
  r.get("/family", limit(syncPerMinute), (req, res) => {
    res.json(decodeFamilyCookie(cookieOf(req, FAMILY_COOKIE)) ?? {});
  });
  r.post("/family", limit(syncPerMinute), (req, res) => {
    const rec = cleanFamilyRecord(req.body?.record);
    if (!rec) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const domain = familyCookieDomain(req.get("host"));
    const tail = `Path=/; Max-Age=${FAMILY_MAX_AGE_S}; SameSite=Lax${domain ? `; Domain=${domain}; Secure` : ""}`;
    res.set("Set-Cookie", [`${FAMILY_COOKIE}=${encodeFamilyCookie(rec)}; HttpOnly; ${tail}`, `${FAMILY_COOKIE}_on=1; ${tail}`] as unknown as string);
    res.json({ ok: true });
  });

  // Errors from the JSON parser (too large / bad JSON) inside this router.
  r.use((err: { status?: number; type?: string }, _req: Req, res: Res, next: Next) => {
    if (!err) return next();
    const tooLarge = err.status === 413;
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "too_large" : "invalid" });
  });

  return Object.assign(router as R & object, { store }) as R & { store: BackupStore };
}
