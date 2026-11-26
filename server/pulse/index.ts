// Synced from app-platform/server-kit/pulse/index.ts. Do not edit here. VERSION a12e840 2026-11-26T20:11:30Z
/**
 * Pulse: anonymous, cookie-free usage counts for every app and the website.
 *
 * The browser side is ui-kit/pulse.js. vite-plugin-mg adds it to every app's index.html at build time, and the
 * website loads it by hand. It keeps a random device id in localStorage (no cookie) and sends tiny beacons:
 *   open  a session started (page load, or back after 30 minutes away)
 *   game  a game finished (ResultsCard)       use   something got made or done (apps call trackPulse("use"))
 *   time  seconds the page was visible since the last beacon
 * Nothing typed, no names, no IP stored. The device id is hashed with the app before it is stored.
 *
 *   import { pulseRouter } from "./server/pulse/index.ts";
 *   app.set("trust proxy", 1);
 *   app.use("/api/pulse", pulseRouter(express, { app: "spinner", allowedHosts: [...ALLOWED_HOSTS] }));
 *
 * Mount it before any catch-all; it reads its own (text/plain) body, so other parsers don't matter.
 * Off the network (no K_SERVICE) it counts in memory, so local runs and tests write nothing.
 *
 * Firestore (project public-mohit-260610), days in America/Chicago:
 *   pulse/{app}                    totals: users, sessions, games, uses, seconds, lastAt (last use by others), mine.{same}
 *   pulse/{app}/days/{YYYY-MM-DD}  users, newUsers, sessions, games, uses, seconds, platform.*, form.*, ref.*, tz.*, page.*, mine.{...}
 *   pulse/{app}/games/{fingerprint} at (so a party game shown on six phones counts once)
 *   pulse/{app}/devices/{id}       firstAt, lastAt, lastDay, days, sessions, games, uses, seconds, platform, form, tz, mine
 * Mohit's own devices ("mine": tagged with #mg-me in the URL, or from the stats page) count under mine.* only.
 */
import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import type { Firestore } from "@google-cloud/firestore";

export const PULSE_PROJECT = "public-mohit-260610";
export const APP_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const EVENTS = ["open", "game", "use", "time"] as const;
export type PulseEvent = (typeof EVENTS)[number];
export const PLATFORMS = ["web", "android", "tv"] as const;
export const FORMS = ["phone", "tablet", "desktop"] as const;
/** At most this many beacons per device per day are counted (a stuck loop can't inflate anything). */
/** Scrambled device records are deleted after this long without use (privacy policy, section 14). */
export const DEVICE_TTL_MS = 395 * 24 * 3600_000; // 13 months
/** Party-game fingerprints only dedupe screens of one game: keep them two days. */
export const GAME_TTL_MS = 2 * 24 * 3600_000;
export const DAILY_CAP = 400;
const MAX_BODY = 1024;

export interface Hit {
  /** Random device id from the browser (never stored as is). */
  d: string;
  e: PulseEvent;
  /** Seconds, for "time". */
  s?: number;
  p?: (typeof PLATFORMS)[number];
  f?: (typeof FORMS)[number];
  tz?: string;
  /** Referrer bucket (see refBucket), for "open". */
  r?: string;
  /** First path segment, for the website ("" = home). */
  pg?: string;
  /** Mohit's own device. */
  me?: boolean;
  /** Fingerprint of a finished game (every screen in a party game shows the same results), for "game". */
  g?: string;
}

export const dayKey = (t = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);

/** Where a visit came from, as one of a few buckets (so the stats never hold full URLs). */
export function refBucket(host: string | undefined | null, ownHost?: string): string {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return "direct";
  if (ownHost && h === ownHost.toLowerCase()) return "direct";
  if (h === "android-app") return "app";
  if (h === "mg-share") return "shared link";
  if (h === "mg-qr") return "qr code";
  const table: [RegExp, string][] = [
    [/(^|\.)mohitgoenka\.com$/, "mohitgoenka.com"],
    [/(^|\.)google\./, "google"],
    [/(^|\.)bing\.com$/, "bing"],
    [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
    [/(^|\.)yahoo\.com$/, "yahoo"],
    [/(^|\.)(facebook|fb)\.com$/, "facebook"],
    [/(^|\.)instagram\.com$/, "instagram"],
    [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
    [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
    [/(^|\.)reddit\.com$/, "reddit"],
    [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
    [/(^|\.)linkedin\.com$/, "linkedin"],
    [/(^|\.)(chatgpt\.com|openai\.com|claude\.ai|perplexity\.ai|gemini\.google\.com)$/, "ai-chat"],
  ];
  for (const [re, name] of table) if (re.test(h)) return name;
  return "other";
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|playwright|puppeteer|phantom|preview|facebookexternalhit|monitor|curl|wget|python|node-fetch|axios|go-http|java\//i;
export const isBotUa = (ua: string | undefined) => !ua || BOT_UA.test(ua);

/** Validates one beacon. Returns null for anything malformed. */
export function parseHit(raw: unknown, ownHost?: string): Hit | null {
  let v: any = raw;
  if (typeof v === "string") {
    if (v.length > MAX_BODY) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (typeof v.d !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(v.d)) return null;
  if (!EVENTS.includes(v.e)) return null;
  const hit: Hit = { d: v.d, e: v.e };
  if (hit.e === "time") {
    const s = Math.round(Number(v.s));
    if (!Number.isFinite(s) || s < 1) return null;
    hit.s = Math.min(s, 3600);
  }
  if (PLATFORMS.includes(v.p)) hit.p = v.p;
  if (FORMS.includes(v.f)) hit.f = v.f;
  if (typeof v.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(v.tz) && v.tz.length <= 40) hit.tz = v.tz;
  if (hit.e === "open") hit.r = refBucket(typeof v.r === "string" && v.r.length <= 100 ? v.r : "", ownHost);
  if (typeof v.pg === "string" && /^[a-z0-9-]{0,30}$/.test(v.pg)) hit.pg = v.pg || "home";
  if (v.me === true || v.me === 1) hit.me = true;
  if (hit.e === "game" && typeof v.g === "string" && /^[a-f0-9]{16}$/.test(v.g)) hit.g = v.g;
  return hit;
}

export const deviceIdOf = (app: string, d: string) => createHash("sha256").update(`pulse:${app}:${d}`).digest("hex").slice(0, 32);

// ---------- store ----------

export interface PulseStore {
  readonly kind: "firestore" | "memory";
  record(app: string, hit: Hit, now?: number): Promise<"counted" | "capped">;
}

interface Device {
  firstAt: number;
  lastAt: number;
  lastDay: string;
  dayHits: number;
  mine: boolean;
}

/**
 * What one beacon adds: the device's changes, and the counters for the day and the all-time totals.
 * freshGame=false: another screen already reported this game, so it counts for the device but not again as a game.
 */
export function plan(hit: Hit, dev: Device | null, now: number, freshGame = true) {
  const day = dayKey(now);
  const newDay = !dev || dev.lastDay !== day;
  const dayHits = newDay ? 0 : dev.dayHits;
  if (dayHits >= DAILY_CAP) return null;
  const mine = !!hit.me || !!dev?.mine;
  const isNew = !dev;
  const counter = { open: "sessions", game: "games", use: "uses", time: "seconds" }[hit.e];
  const amount = hit.e === "time" ? hit.s ?? 0 : 1;

  const n: Record<string, number> = hit.e === "game" && !freshGame ? {} : { [counter]: amount };
  if (newDay) n.users = 1;
  const dayCounts: Record<string, any> = { ...n };
  if (isNew) dayCounts.newUsers = 1;
  const dims: Record<string, Record<string, number>> = {};
  if (hit.e === "open" && !mine) {
    if (hit.p) dims.platform = { [hit.p]: 1 };
    if (hit.f) dims.form = { [hit.f]: 1 };
    dims.ref = { [hit.r || "direct"]: 1 };
    if (hit.tz) dims.tz = { [hit.tz]: 1 };
    if (hit.pg) dims.page = { [hit.pg]: 1 };
  }
  const totals: Record<string, number> = hit.e === "game" && !freshGame ? {} : { [counter]: amount };
  if (isNew) totals.users = 1;

  const device: Record<string, any> = { lastAt: now, lastDay: day, dayHits: dayHits + 1, [counter]: amount };
  if (isNew) Object.assign(device, { firstAt: now, mine });
  if (newDay) device.days = 1;
  if (hit.me && !dev?.mine) device.mine = true;
  if (hit.p) device.platform = hit.p;
  if (hit.f) device.form = hit.f;
  if (hit.tz) device.tz = hit.tz;
  return { day, mine, device, dayCounts, dims, totals, isNew };
}

export function createMemoryStore() {
  const devices = new Map<string, Device & Record<string, any>>();
  const days = new Map<string, Record<string, any>>();
  const totals = new Map<string, Record<string, any>>();
  const games = new Set<string>();
  const add = (into: Record<string, any>, from: Record<string, any>) => {
    for (const [k, v] of Object.entries(from)) {
      if (typeof v === "number") into[k] = (into[k] ?? 0) + v;
      else into[k] = add(into[k] ?? {}, v);
    }
    return into;
  };
  const store: PulseStore & { devices: typeof devices; days: typeof days; totals: typeof totals } = {
    kind: "memory",
    devices,
    days,
    totals,
    async record(app, hit, now = Date.now()) {
      const key = `${app}/${deviceIdOf(app, hit.d)}`;
      const dev = devices.get(key) ?? null;
      const gameKey = hit.g ? `${app}/${hit.g}` : null;
      const p = plan(hit, dev, now, !gameKey || !games.has(gameKey));
      if (!p) return "capped";
      if (gameKey) games.add(gameKey);
      const counted = ["sessions", "games", "uses", "seconds", "days"];
      const next: any = { ...(dev ?? {}) };
      for (const [k, v] of Object.entries(p.device)) next[k] = counted.includes(k) ? (next[k] ?? 0) + v : v;
      devices.set(key, next);
      const dk = `${app}/${p.day}`;
      const d = days.get(dk) ?? {};
      add(d, p.mine ? { mine: p.dayCounts } : { ...p.dayCounts, ...p.dims });
      days.set(dk, d);
      const t = totals.get(app) ?? {};
      add(t, p.mine ? { mine: p.totals } : p.totals);
      if (!p.mine) t.lastAt = Math.max(t.lastAt ?? 0, now);
      totals.set(app, t);
      return "counted";
    },
  };
  return store;
}

export function createFirestoreStore(projectId = PULSE_PROJECT): PulseStore {
  let dbPromise: Promise<Firestore> | null = null;
  // The SDK (gRPC + protobufs) is heavy: load it on first use so cold starts stay fast.
  const db = () =>
    (dbPromise ??= import("@google-cloud/firestore").then(({ Firestore }) => new Firestore({ projectId, ignoreUndefinedProperties: true })));

  return {
    kind: "firestore",
    async record(app, hit, now = Date.now()) {
      const fs = await db();
      const { FieldValue } = await import("@google-cloud/firestore");
      const inc = (o: Record<string, any>): Record<string, any> =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? FieldValue.increment(v) : inc(v)]));
      const appRef = fs.collection("pulse").doc(app);
      const devRef = appRef.collection("devices").doc(deviceIdOf(app, hit.d));
      const gameRef = hit.g ? appRef.collection("games").doc(hit.g) : null;
      return fs.runTransaction(async (tx) => {
        const [snap, gameSnap] = await Promise.all([tx.get(devRef), gameRef ? tx.get(gameRef) : null]);
        const dev = snap.exists ? (snap.data() as Device) : null;
        const p = plan(hit, dev, now, !gameSnap?.exists);
        if (!p) return "capped" as const;
        // expireAt: Firestore TTL policies (collection groups "devices" and "games") delete these on their own.
        if (gameRef && !gameSnap?.exists) tx.set(gameRef, { at: now, expireAt: new Date(Number(now) + GAME_TTL_MS) });
        const counted = ["sessions", "games", "uses", "seconds", "days"];
        const devDoc = Object.fromEntries(Object.entries(p.device).map(([k, v]) => [k, counted.includes(k) ? FieldValue.increment(v as number) : v]));
        tx.set(devRef, { ...devDoc, expireAt: new Date(Number(now) + DEVICE_TTL_MS) }, { merge: true });
        // set + merge with nested maps keeps keys like "America/Chicago" as they are (update() would split on dots).
        tx.set(appRef.collection("days").doc(p.day), inc(p.mine ? { mine: p.dayCounts } : { ...p.dayCounts, ...p.dims }), { merge: true });
        tx.set(appRef, { ...inc(p.mine ? { mine: p.totals } : p.totals), ...(p.mine ? {} : { lastAt: now }) }, { merge: true });
        return "counted" as const;
      });
    },
  };
}

export function createStore(opts: { projectId?: string } = {}): PulseStore {
  const forced = process.env.MG_PULSE_STORE;
  const useFirestore = !!process.env.K_SERVICE || !!process.env.FIRESTORE_EMULATOR_HOST || forced === "firestore";
  if (forced === "memory" || !useFirestore || process.env.PULSE_DISABLED === "1") return createMemoryStore();
  return createFirestoreStore(opts.projectId);
}

// ---------- rate limit ----------

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  constructor(limit: number, windowMs: number, maxKeys = 50_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }
  hit(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) this.buckets.clear();
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    return ++b.count <= this.limit;
  }
}

export function ipKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;
  return ip.split("%")[0]!.toLowerCase().split(":").slice(0, 4).join(":") + "::/64";
}

// ---------- router ----------

interface Req {
  ip?: string | undefined;
  body?: any;
  get(name: string): string | undefined;
  on(event: string, cb: (chunk?: any) => void): unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  set(name: string, value: string): unknown;
  end(): unknown;
}
type Next = (err?: unknown) => void;
type Handler = (req: Req, res: Res, next: Next) => unknown;
interface RouterLike {
  get(path: string, ...h: Handler[]): unknown;
  post(path: string, ...h: Handler[]): unknown;
  options(path: string, ...h: Handler[]): unknown;
}
interface ExpressLike<R> {
  Router(): R;
}

export interface PulseRouterOptions {
  /** App id, e.g. "spinner". Omit with originApps (the stats service takes beacons for several sites). */
  app?: string;
  /** Hosts allowed to send beacons (Origin / Referer). localhost and 127.0.0.1 are always allowed. */
  allowedHosts?: string[];
  /** Cross-site mode: Origin host → app id; answers CORS for exactly these origins. */
  originApps?: Record<string, string>;
  projectId?: string;
  store?: PulseStore;
  /** Beacons per IP per minute (default 60). */
  perMinute?: number;
  /** Where GET /public reads the rounded totals (default: the pulse service). */
  publicUrl?: string;
}

/** The pulse service's rounded public totals. */
export const PUBLIC_URL = "https://pulse-4161275924.us-west1.run.app/api/public";

const readBody = (req: Req): Promise<string | null> =>
  new Promise((resolve) => {
    if (typeof req.body === "string") return resolve(req.body);
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length) return resolve(JSON.stringify(req.body));
    let size = 0;
    const parts: Buffer[] = [];
    let done = false;
    const finish = (v: string | null) => {
      if (!done) (done = true), resolve(v);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return finish(null);
      parts.push(c);
    });
    req.on("end", () => finish(Buffer.concat(parts).toString("utf8")));
    req.on("error", () => finish(null));
  });

/** POST /hit (204 always, so a beacon never shows an error) and GET /status. */
export function pulseRouter<R>(express: ExpressLike<R>, opts: PulseRouterOptions): R & { store: PulseStore } {
  if (opts.app && !APP_RE.test(opts.app)) throw new Error(`pulseRouter: bad app id ${opts.app}`);
  if (!opts.app && !opts.originApps) throw new Error("pulseRouter: app or originApps is required");
  const store = opts.store ?? createStore(opts.projectId ? { projectId: opts.projectId } : {});
  const isProd = process.env.NODE_ENV === "production";
  const allowed = new Set(["localhost", "127.0.0.1", ...(opts.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const perIp = new RateLimiter(opts.perMinute ?? 60, 60_000);
  const global = new RateLimiter(5000, 60_000);
  const hostOf = (h: string | undefined) => {
    try {
      return h ? new URL(h).hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  const appFor = (req: Req): { app: string; host: string } | null => {
    const source = hostOf(req.get("origin")) ?? hostOf(req.get("referer"));
    if (opts.originApps) {
      const app = source ? opts.originApps[source] : undefined;
      return app ? { app, host: source! } : null;
    }
    if (source ? !allowed.has(source) : isProd) return null;
    return { app: opts.app!, host: source ?? "" };
  };

  const router = express.Router();
  const r = router as unknown as RouterLike;
  r.get("/status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, store: store.kind });
  });
  // GET /public: this app's rounded public totals from the pulse service (cached 10 min), so the page can show
  // "2,600 games played" without talking to another origin. Values below the public thresholds come back null.
  let pub: { at: number; body: unknown } | null = null;
  r.get("/public", async (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    const empty = { app: null, total: null };
    if (!opts.app) return res.json(empty);
    if (!pub || Date.now() - pub.at > 10 * 60_000) {
      try {
        const ctrl = AbortSignal.timeout(4000);
        const r2 = await fetch(opts.publicUrl ?? PUBLIC_URL, { signal: ctrl });
        const j = (await r2.json()) as { total?: unknown; apps?: Record<string, unknown> };
        pub = { at: Date.now(), body: { app: j.apps?.[opts.app] ?? null, total: j.total ?? null } };
      } catch {
        if (!pub) return res.json(empty);
      }
    }
    res.json(pub.body);
  });
  if (opts.originApps) {
    r.options("/hit", (req, res) => {
      const origin = req.get("origin");
      if (origin && hostOf(origin) && opts.originApps![hostOf(origin)!]) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Methods", "POST");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        res.set("Access-Control-Max-Age", "86400");
        res.set("Vary", "Origin");
      }
      res.status(204).end();
    });
  }
  r.post("/hit", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    if (opts.originApps && origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    // Answer only after the count is saved: Cloud Run stops giving the instance CPU once the response is sent.
    try {
      const target = appFor(req);
      const body = await readBody(req);
      if (!target || body == null || isBotUa(req.get("user-agent"))) return;
      if (!global.hit("all") || !perIp.hit(ipKey(req.ip))) return;
      const hit = parseHit(body, target.host);
      if (!hit) return;
      await store.record(target.app, hit);
    } catch (err) {
      console.error(`[pulse] record failed`, (err as Error)?.message);
    } finally {
      res.status(204).end();
    }
  });
  return Object.assign(router as object, { store }) as R & { store: PulseStore };
}
