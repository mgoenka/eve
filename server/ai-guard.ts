// Synced from app-platform/server-kit/ai-guard. Do not edit here. VERSION 9935b39 2026-11-27T19:06:06Z
/**
 * ai-guard: keeps an app responsive when Gemini is overloaded or the project quota is used up.
 *
 * Use `guardedFetch` in place of `fetch` for every Gemini call on the server (or wrap SDK calls in `guardedCall`):
 *  - Concurrency cap per instance (AI_MAX_CONCURRENT, default 32). Callers past the cap wait in a short
 *    queue (AI_MAX_QUEUE, default 64; at most AI_QUEUE_WAIT_MS, default 15 s), then fail fast.
 *  - Circuit breaker, per model (guardedFetch: the model in the URL path; guardedCall: `key`, default 'default'):
 *    it opens after 3 busy answers (429 / 503 / RESOURCE_EXHAUSTED / overloaded) within 10 s, or at once on a 429
 *    that names a delay of 5 s or more (Retry-After header or RetryInfo.retryDelay: quota exhausted), for that
 *    delay (else 20 s for 429, 10 s for 503), clamped to 5-60 s. While open, calls for that model fail at once
 *    instead of hammering the quota (and never retry, which would triple upstream traffic). A lone busy answer
 *    fails only its own call (AiBusyError, retryAfter 2).
 *  - Failures throw AiBusyError; send it with `sendAiBusy(res, err)` (HTTP 503 + Retry-After) so the
 *    client can show "busy, try again in N s" or fall back to bundled content. Busy calls cost no Sparks
 *    (credits are charged only from a response that arrived).
 *
 * Free test mode (below): off Cloud Run, and for automated requests on it, every Gemini request answers with a
 * schema-shaped fixture and never reaches Google. See "Free AI test mode".
 *
 * Copied into each app as server/ai-guard.ts by scripts/sync-ai-guard.sh.
 * Source of truth: app-platform/server-kit/ai-guard/index.ts (tests: server-kit/test/ai-guard.test.ts).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export class AiBusyError extends Error {
  readonly retryAfter: number;
  readonly status = 503;
  constructor(retryAfter: number, message = 'AI is busy') {
    super(message);
    this.name = 'AiBusyError';
    this.retryAfter = Math.max(1, Math.round(retryAfter));
  }
}

export function isAiBusy(e: unknown): e is AiBusyError {
  return e instanceof AiBusyError || (e as { name?: string } | null)?.name === 'AiBusyError';
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const limits = {
  maxConcurrent: num(process.env.AI_MAX_CONCURRENT, 32),
  maxQueue: num(process.env.AI_MAX_QUEUE, 64),
  queueWaitMs: num(process.env.AI_QUEUE_WAIT_MS, 15_000),
};
const MIN_OPEN_S = 5;
const MAX_OPEN_S = 60;

/** Override the limits (tests, or an app that wants a different cap). Values ≤ 0 are ignored. */
export function configureAiGuard(o: { maxConcurrent?: number; maxQueue?: number; queueWaitMs?: number }): void {
  for (const k of ['maxConcurrent', 'maxQueue', 'queueWaitMs'] as const) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) limits[k] = v;
  }
}

interface Waiter {
  resolve: () => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}
let active = 0;
const queue: Waiter[] = [];
/** Per circuit key (model): open until (ms) and recent busy answers (ms). */
const circuits = new Map<string, { openUntil: number; busyAt: number[] }>();
const BUSY_WINDOW_MS = 10_000;
const BUSY_TRIP_COUNT = 3;
/** retryAfter of a lone busy answer that did not open the circuit. */
const LONE_RETRY_S = 2;
const circuit = (key: string) => {
  let c = circuits.get(key);
  if (!c) {
    if (circuits.size > 200) circuits.clear();
    c = { openUntil: 0, busyAt: [] };
    circuits.set(key, c);
  }
  return c;
};

/** Circuit key of a Gemini REST URL: the model in ".../models/<model>:<method>", else 'default'. */
export function aiGuardKeyOf(input: string | URL): string {
  const m = String(input).match(/\/models\/([^/:?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : 'default';
}

/** Seconds left on an open circuit (0 when closed): for one key, or the longest of all without one. */
export function aiCircuitOpenFor(key?: string, now = Date.now()): number {
  let until = 0;
  if (key !== undefined) until = circuits.get(key)?.openUntil ?? 0;
  else for (const c of circuits.values()) until = Math.max(until, c.openUntil);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** Calls running and waiting right now (for health checks and tests). */
export function aiGuardStats(): { active: number; queued: number; openFor: number } {
  return { active, queued: queue.length, openFor: aiCircuitOpenFor() };
}

/** Open the circuit of `key` (default 'default') for `seconds` (clamped 5-60). Exported for tests and SDK callers. */
export function tripAiCircuit(seconds: number, key = 'default', now = Date.now()): void {
  const s = Math.min(MAX_OPEN_S, Math.max(MIN_OPEN_S, Number.isFinite(seconds) ? seconds : 0));
  const c = circuit(key);
  c.openUntil = Math.max(c.openUntil, now + s * 1000);
  c.busyAt = [];
}

/**
 * One busy answer for `key`: opens the circuit on a quota 429 with an explicit delay ≥ 5 s, or on the third busy
 * answer within 10 s; otherwise only this call fails. Returns the AiBusyError to throw.
 */
function busy(key: string, status: number, delay: number | null, now = Date.now()): AiBusyError {
  const c = circuit(key);
  c.busyAt = c.busyAt.filter((t) => t > now - BUSY_WINDOW_MS);
  c.busyAt.push(now);
  const quota = status === 429 && delay != null && delay >= MIN_OPEN_S;
  if (quota || c.busyAt.length >= BUSY_TRIP_COUNT) {
    tripAiCircuit(delay ?? (status === 429 ? 20 : 10), key, now);
    const open = aiCircuitOpenFor(key, now);
    console.warn(`Gemini ${status || 'busy'} (${key}): pausing AI calls for ${open}s`);
    return new AiBusyError(open);
  }
  return new AiBusyError(LONE_RETRY_S);
}

/** Test helper: closes the circuit, forgets running calls, fails queued ones. */
export function resetAiGuard(): void {
  active = 0;
  circuits.clear();
  while (queue.length) queue[0]!.reject(new AiBusyError(1));
}

function parseDelay(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)s?$/);
  if (m) return Number(m[1]);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : null;
}

/** RetryInfo.retryDelay from a Google error body: { error: { details: [{ retryDelay: "7s" }] } } (or an array of those). */
function delayFromBody(body: unknown): number | null {
  const first: unknown = Array.isArray(body) ? body[0] : body;
  const err = (first as { error?: unknown } | null)?.error ?? first;
  const details = (err as { details?: unknown } | null)?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const r = parseDelay((d as { retryDelay?: unknown } | null)?.retryDelay);
    if (r != null) return r;
  }
  return null;
}

/** Retry delay (seconds) from a Retry-After header or a Google RetryInfo detail in the error body. */
export async function retryDelayFrom(res: Response): Promise<number | null> {
  const h = parseDelay(res.headers.get('retry-after'));
  if (h != null) return h;
  try {
    return delayFromBody(await res.clone().json());
  } catch {
    return null; // not JSON
  }
}

/**
 * Retry delay (seconds) from an SDK error (@google/genai ApiError and friends): a JSON body in `e.error` /
 * `e.message` (details[].retryDelay), else `retryDelay: "7s"` anywhere in the text, else "retry in 7.5s".
 */
export function retryDelayFromError(e: unknown): number | null {
  const x = e as { error?: unknown; message?: unknown; errorDetails?: unknown } | null;
  if (Array.isArray(x?.errorDetails)) {
    const r = delayFromBody({ error: { details: x.errorDetails } });
    if (r != null) return r;
  }
  const texts: string[] = [];
  for (const v of [x?.error, x?.message]) {
    if (v && typeof v === 'object') {
      const r = delayFromBody(v);
      if (r != null) return r;
    } else if (typeof v === 'string') texts.push(v);
  }
  for (const t of texts) {
    // The SDK message is often "got status: 429 … {json}": try the JSON part first.
    const i = t.search(/[[{]/);
    if (i >= 0) {
      try {
        const r = delayFromBody(JSON.parse(t.slice(i)));
        if (r != null) return r;
      } catch {
        /* not JSON */
      }
    }
    const m = t.match(/retryDelay\\?"?\s*[:=]\s*\\?"?(\d+(?:\.\d+)?)s/i) ?? t.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
    if (m) return Number(m[1]);
  }
  return null;
}

const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('Aborted', 'AbortError');

async function acquire(key: string, signal?: AbortSignal | null): Promise<void> {
  const open = aiCircuitOpenFor(key);
  if (open) throw new AiBusyError(open);
  if (signal?.aborted) throw abortReason(signal);
  if (active < limits.maxConcurrent) {
    active++;
    return;
  }
  if (queue.length >= limits.maxQueue) throw new AiBusyError(5);
  await new Promise<void>((resolve, reject) => {
    const leave = () => {
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      clearTimeout(entry.timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => entry.reject(abortReason(signal!));
    const entry: Waiter = {
      resolve: () => {
        leave();
        resolve();
      },
      reject: (e) => {
        leave();
        reject(e);
      },
      timer: setTimeout(() => entry.reject(new AiBusyError(5)), limits.queueWaitMs),
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(entry);
  });
  // A slot was handed over by release(): `active` already counts us.
  const stillOpen = aiCircuitOpenFor(key);
  if (stillOpen) {
    release();
    throw new AiBusyError(stillOpen);
  }
}

function release(): void {
  const next = queue.shift();
  if (next) next.resolve();
  else active = Math.max(0, active - 1);
}

/**
 * fetch() for Gemini with the concurrency cap and circuit breaker. Returns the Response as fetch would
 * (callers keep their own !res.ok handling), except that 429 / 503 trips the circuit and throws AiBusyError.
 * A request aborted while it waits in the queue leaves the queue at once.
 */
export async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const key = aiGuardKeyOf(input);
  await acquire(key, init?.signal);
  try {
    const res = await fetch(input, init);
    if (res.status === 429 || res.status === 503) {
      const delay = await retryDelayFrom(res);
      await res.body?.cancel().catch(() => {}); // free the connection
      throw busy(key, res.status, delay);
    }
    return res;
  } finally {
    release();
  }
}

/** HTTP-like status of an SDK error: `status` / `response.status` / `code` (gRPC 8 RESOURCE_EXHAUSTED → 429, 14 UNAVAILABLE → 503). */
function statusOf(e: unknown): number {
  const x = e as { status?: unknown; code?: unknown; response?: { status?: unknown } } | null;
  for (const v of [x?.status, x?.response?.status, x?.code]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n === 8 ? 429 : n === 14 ? 503 : n;
  }
  return 0;
}

/**
 * Wrap an SDK call (e.g. @google/genai) the same way; maps quota / overload errors (status 429 / 503, or
 * RESOURCE_EXHAUSTED / "overloaded" in the message) to AiBusyError. `key`: the circuit to use (e.g. the model).
 */
export async function guardedCall<T>(fn: () => Promise<T>, opts: { signal?: AbortSignal; key?: string } = {}): Promise<T> {
  const key = opts.key || 'default';
  await acquire(key, opts.signal);
  try {
    return await fn();
  } catch (e) {
    let status = statusOf(e);
    const text = String((e as { message?: unknown } | null)?.message ?? '');
    if (status !== 429 && status !== 503) {
      if (/RESOURCE_EXHAUSTED/i.test(text)) status = 429;
      else if (/overloaded/i.test(text)) status = 503;
      else throw e;
    }
    throw busy(key, status, retryDelayFromError(e));
  } finally {
    release();
  }
}

export const AI_BUSY_MESSAGE = 'Lots of people are using this right now. Please try again in a few seconds.';

/** Send an AiBusyError as HTTP 503 with Retry-After. Works with Express-like responses. */
export function sendAiBusy(
  res: { setHeader(name: string, value: string): unknown; status(code: number): { json(body: unknown): unknown } },
  err: AiBusyError,
): void {
  res.setHeader('Retry-After', String(err.retryAfter));
  res.status(503).json({ error: 'ai_busy', retryAfter: err.retryAfter, message: AI_BUSY_MESSAGE });
}

// ---------- Free AI test mode ----------
// Agents (Claude, Cursor) and Playwright drive these apps all day. None of that may spend money, so:
//  - Off Cloud Run (K_SERVICE unset: local dev, `npm start` with NODE_ENV=production, tests, CI) every request to
//    generativelanguage.googleapis.com is answered here with a deterministic fixture. Real Gemini runs locally only
//    with AI_LIVE=1. AI_FIXTURES=1 forces fixtures anywhere.
//  - On Cloud Run, requests from automation get fixtures too: header `x-mg-ai-test: 1` (the kit's client adds it
//    when navigator.webdriver is true; the smoke tests send it), or a HeadlessChrome / Playwright / Puppeteer user
//    agent. The app mounts `aiTestModeMiddleware` before its routes.
// The fetch patch covers @google/genai (it uses the global fetch) and raw fetch alike, and also the other paid
// Google APIs the apps call: Cloud Text-to-Speech (silent MP3) and Places (three test places). Fixtures follow the
// request's responseSchema / responseJsonSchema, so the app's own validation runs as usual; apps register exact
// shapes for strict routes with registerAiFixture(). Fixture text says it is a test answer.

export type AiMode = 'live' | 'fixture';
export const AI_TEST_HEADER = 'x-mg-ai-test';
export const AUTOMATION_UA = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Chrome-Lighthouse/i;

/** The process-wide mode: 'live' only on Cloud Run or with AI_LIVE=1. */
export function aiEnvMode(env: Record<string, string | undefined> = process.env): AiMode {
  if (env.AI_FIXTURES === '1') return 'fixture';
  if (env.AI_LIVE === '1') return 'live';
  return env.K_SERVICE ? 'live' : 'fixture';
}

const fixtureScope = new AsyncLocalStorage<boolean>();

type HeaderBag = Record<string, string | string[] | undefined>;
/** A request from a test browser or a smoke test (never charged, never sent to Gemini). */
export function isAutomatedRequest(req: { headers: HeaderBag }): boolean {
  const h = req.headers[AI_TEST_HEADER];
  if ((Array.isArray(h) ? h[0] : h) === '1') return true;
  const ua = req.headers['user-agent'];
  return AUTOMATION_UA.test(Array.isArray(ua) ? ua.join(' ') : ua || '');
}

/** Express middleware: runs automated requests in fixture mode. Mount once, before the AI routes. */
export function aiTestModeMiddleware(req: { headers: HeaderBag }, res: { setHeader(n: string, v: string): unknown }, next: () => void): void {
  if (!isAutomatedRequest(req)) { next(); return; }
  res.setHeader('X-MG-AI-Mode', 'fixture');
  fixtureScope.run(true, next);
}

/** Run `fn` with Gemini answered by fixtures (tests). */
export const withAiFixtures = <T>(fn: () => T): T => fixtureScope.run(true, fn);

/** True when a Gemini request made now would be answered by a fixture. */
export function aiFixturesActive(): boolean {
  return fixtureScope.getStore() === true || aiEnvMode() === 'fixture';
}
// For server/credits (synced separately, so no import): a fixture answer cost nothing, so it charges no Sparks
// and never answers 402 (credits.run reads this hook).
(globalThis as Record<symbol, unknown>)[Symbol.for('mg.aiFixtures.active')] = aiFixturesActive;

export interface AiFixtureRequest {
  /** Model in the URL (e.g. gemini-3.8-flash). */
  model: string;
  /** All prompt + system text, joined. */
  prompt: string;
  /** responseSchema or responseJsonSchema, if any. */
  schema: unknown;
  json: boolean;
  /** The parsed request body. */
  body: Record<string, any>;
}
type FixtureFn = (r: AiFixtureRequest) => unknown;
const customFixtures: FixtureFn[] = [];
/**
 * Register an exact fixture for requests the generic schema filler can't satisfy (counts, cross-field rules).
 * Return undefined to pass. A string is sent as the text; anything else is sent as JSON.
 */
export function registerAiFixture(fn: FixtureFn): void { customFixtures.push(fn); }

const WORDS = ['Apple', 'Bridge', 'Castle', 'Dragon', 'Eagle', 'Forest', 'Garden', 'Harbor', 'Island', 'Jungle', 'Kettle', 'Lantern',
  'Meadow', 'Needle', 'Orchid', 'Pepper', 'Quartz', 'River', 'Saddle', 'Tiger', 'Umbrella', 'Violin', 'Walnut', 'Yogurt', 'Zebra',
  'Anchor', 'Basket', 'Candle', 'Desert', 'Engine', 'Falcon', 'Glacier', 'Helmet', 'Igloo', 'Jacket', 'Koala', 'Ladder', 'Mirror',
  'Nutmeg', 'Oyster', 'Parrot', 'Rocket', 'Shadow', 'Tulip', 'Velvet', 'Window', 'Canyon', 'Pillow', 'Marble', 'Comet'];
const SENTENCE_KEY = /question|clue|text|message|explanation|description|summary|reason|tip|hint|note|prompt|line|sentence|story|advice|caption|detail|body|content|answer_?text|fact|insight|feedback|comment|subtitle|blurb|bio|instruction/i;
/** A distinct letters-only word for every i (base-50 digits as words: Apple, Bridge, …, Applebridge, …). */
const word = (i: number): string => {
  let out = WORDS[i % WORDS.length]!;
  for (let q = Math.floor(i / WORDS.length); q > 0; q = Math.floor(q / WORDS.length)) {
    q -= 1;
    out += WORDS[q % WORDS.length]!.toLowerCase();
  }
  return out;
};

function fill(schema: any, key: string, ctx: { n: number }, depth: number): unknown {
  if (!schema || typeof schema !== 'object' || depth > 12) return word(ctx.n++);
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[ctx.n++ % schema.enum.length];
  if (schema.const !== undefined) return schema.const;
  const alt = schema.anyOf || schema.oneOf;
  if (Array.isArray(alt) && alt.length) return fill(alt.find((a: any) => a?.type !== 'null') ?? alt[0], key, ctx, depth + 1);
  let type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
  type = String(type || (schema.properties ? 'object' : schema.items ? 'array' : 'string')).toLowerCase();
  const i = ctx.n++;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties || {})) out[k] = fill(v, k, ctx, depth + 1);
      return out;
    }
    case 'array': {
      const min = Number(schema.minItems) || 0;
      const max = Number(schema.maxItems) || 0;
      const len = max ? Math.max(min, Math.min(max, 30)) : Math.max(min, 30);
      const itemKey = key.replace(/(ies)$/, 'y').replace(/s$/, '');
      return Array.from({ length: len }, () => fill(schema.items, itemKey, ctx, depth + 1));
    }
    case 'integer':
    case 'number': {
      const lo = Number.isFinite(Number(schema.minimum)) ? Number(schema.minimum) : undefined;
      const hi = Number.isFinite(Number(schema.maximum)) ? Number(schema.maximum) : undefined;
      let v = /index|position|correct/i.test(key) ? 0 : /price|cost|amount|budget|value|usd|total/i.test(key) ? 10 * ((i % 9) + 1) + 0.99 : (i % 5) + 1;
      if (type === 'integer') v = Math.round(v);
      if (lo !== undefined && v < lo) v = lo;
      if (hi !== undefined && v > hi) v = hi;
      return v;
    }
    case 'boolean': return i % 2 === 0;
    default: {
      if (schema.format === 'date' || /date$/i.test(key)) return new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString().slice(0, 10);
      if (schema.format === 'date-time') return new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString();
      if (/url|uri|link|href/i.test(key)) return 'https://example.com/';
      if (/color|colour/i.test(key)) return ['#0ea5e9', '#f43f5e', '#22c55e', '#eab308'][i % 4];
      if (/emoji|icon/i.test(key)) return ['🍎', '🌉', '🏰', '🐉', '🦅', '🌲', '🌷', '⚓'][i % 8];
      return SENTENCE_KEY.test(key) ? `Test answer ${word(i)} (free AI test mode).` : word(i);
    }
  }
}

/** A fixture value for a request (exported for tests). */
export function aiFixtureFor(r: AiFixtureRequest): unknown {
  for (const fn of customFixtures) {
    const v = fn(r);
    if (v !== undefined) return v;
  }
  if (r.schema) return fill(r.schema, '', { n: 0 }, 0);
  if (r.json) return {};
  return 'This is a test answer from the free AI test mode (no Gemini call was made).';
}

// 0.25 s of 24 kHz 16-bit mono silence, and a 1x1 PNG.
const SILENT_PCM = Buffer.alloc(12_000).toString('base64');
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const GEMINI_HOST = /^https:\/\/generativelanguage\.googleapis\.com\//;
const TTS_HOST = /^https:\/\/texttospeech\.googleapis\.com\//;
const PLACES_HOST = /^https:\/\/(maps\.googleapis\.com\/maps\/api\/place\/|places\.googleapis\.com\/)/;

// ~0.26 s of silent MP3 (MPEG-1 Layer III frames, 128 kbps, 44.1 kHz mono, all-zero side info).
const MP3_FRAME = Buffer.alloc(417);
MP3_FRAME.set([0xff, 0xfb, 0x90, 0xc0]);
const SILENT_MP3 = Buffer.concat(Array(10).fill(MP3_FRAME)).toString('base64');

function placesFixture(url: URL): Response {
  if (/\/photo\b|\/media\b/.test(url.pathname)) return new Response(Buffer.from(PNG_1X1, 'base64'), { status: 200, headers: { 'content-type': 'image/png', 'x-mg-ai-mode': 'fixture' } });
  const [lat, lng] = (url.searchParams.get('location') || '30.27,-97.74').split(',').map(Number);
  const at = (n: number) => ({ lat: (lat || 30.27) + n * 0.001, lng: (lng || -97.74) + n * 0.001 });
  const type = url.searchParams.get('type') || 'restaurant';
  if (url.hostname === 'places.googleapis.com') {
    const places = [1, 2, 3].map((n) => ({ id: `test-place-${n}`, displayName: { text: `Test Place ${n} (free AI test mode)` }, formattedAddress: `${n} Test Street`, location: { latitude: at(n).lat, longitude: at(n).lng }, rating: 4.5, types: [type] }));
    return jsonResponse(/places\/[^/:]+$/.test(url.pathname) ? places[0] : { places });
  }
  const results = [1, 2, 3].map((n) => ({ place_id: `test-place-${n}`, name: `Test Place ${n} (free AI test mode)`, vicinity: `${n} Test Street`, formatted_address: `${n} Test Street, Test City`, rating: 4.5, user_ratings_total: 10 * n, types: [type], geometry: { location: at(n) } }));
  if (/details/.test(url.pathname)) return jsonResponse({ status: 'OK', result: results[0] });
  if (/findplacefromtext/.test(url.pathname)) return jsonResponse({ status: 'OK', candidates: results.slice(0, 1) });
  return jsonResponse({ status: 'OK', results });
}

async function bodyOf(input: unknown, init?: RequestInit): Promise<string> {
  const b = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  if (typeof b === 'string') return b;
  if (b instanceof Uint8Array) return Buffer.from(b).toString('utf8');
  if (b instanceof ArrayBuffer) return Buffer.from(b).toString('utf8');
  return '';
}

const jsonResponse = (v: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json', 'x-mg-ai-mode': 'fixture', ...headers } });

async function fixtureResponse(url: URL, input: unknown, init?: RequestInit): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  // Files API (uploads for PDFs/images): accept everything, report the file as ready.
  if (/\/files(\/|$)|\/upload\//.test(url.pathname)) {
    const file = { name: 'files/ai-fixture', uri: 'https://generativelanguage.googleapis.com/v1beta/files/ai-fixture', mimeType: 'application/pdf', state: 'ACTIVE', sizeBytes: '1' };
    if (url.pathname.startsWith('/upload/') && method === 'POST' && !url.searchParams.has('upload_id')) {
      const h = new Headers(init?.headers);
      if ((h.get('x-goog-upload-command') || '').includes('start')) {
        return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=ai-fixture', 'x-goog-upload-status': 'active' } });
      }
    }
    if (method === 'DELETE') return jsonResponse({});
    return jsonResponse(url.pathname.startsWith('/upload/') ? { file } : file, { 'x-goog-upload-status': 'final' });
  }
  const m = url.pathname.match(/\/models\/([^/:]+):(\w+)/);
  const model = m?.[1] ?? 'unknown';
  const op = m?.[2] ?? '';
  let body: Record<string, any> = {};
  try { body = JSON.parse(await bodyOf(input, init) || '{}'); } catch { /* not JSON */ }
  if (op === 'countTokens') return jsonResponse({ totalTokens: 0 });
  if (op === 'embedContent') return jsonResponse({ embedding: { values: Array.from({ length: 8 }, (_, i) => i / 8) } });
  const gc = body.generationConfig || body.config || {};
  const parts = (x: any): string[] => (Array.isArray(x) ? x.flatMap(parts) : x && typeof x === 'object' ? [typeof x.text === 'string' ? x.text : '', ...parts(x.parts), ...parts(x.contents)] : []);
  const prompt = [...parts(body.systemInstruction), ...parts(body.contents)].filter(Boolean).join('\n');
  const modalities = (gc.responseModalities || []).map((x: string) => String(x).toUpperCase());
  let outParts: unknown[];
  if (modalities.includes('AUDIO') || /tts/i.test(model)) {
    outParts = [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: SILENT_PCM } }];
  } else if (modalities.includes('IMAGE') || /image/i.test(model)) {
    outParts = [{ text: 'Test image (free AI test mode).' }, { inlineData: { mimeType: 'image/png', data: PNG_1X1 } }];
  } else {
    const schema = gc.responseSchema ?? gc.responseJsonSchema ?? gc.response_json_schema;
    const json = /json/i.test(gc.responseMimeType || '') || Boolean(schema);
    const v = aiFixtureFor({ model, prompt, schema, json, body });
    outParts = [{ text: typeof v === 'string' ? v : JSON.stringify(v) }];
  }
  const payload = {
    candidates: [{ content: { role: 'model', parts: outParts }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    modelVersion: model,
  };
  if (op === 'streamGenerateContent') {
    return new Response(`data: ${JSON.stringify(payload)}\r\n\r\n`, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-mg-ai-mode': 'fixture' } });
  }
  return jsonResponse(payload);
}

const PATCHED = Symbol.for('mg.aiFixtures.fetch');
/** Install the fetch interceptor (done on import; safe to call again). */
export function installAiFixtures(): void {
  const g = globalThis as typeof globalThis & { [PATCHED]?: boolean };
  if (g[PATCHED] || typeof g.fetch !== 'function') return;
  const realFetch = g.fetch.bind(g);
  g.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (aiFixturesActive()) {
      if (GEMINI_HOST.test(href)) return fixtureResponse(new URL(href), input, init);
      if (TTS_HOST.test(href)) return jsonResponse({ audioContent: SILENT_MP3 });
      if (PLACES_HOST.test(href)) return placesFixture(new URL(href));
    }
    return realFetch(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
  g[PATCHED] = true;
  if (aiEnvMode() === 'fixture') {
    // Apps refuse AI routes without a key; in test mode any value works (nothing reaches Google). Set before the
    // app's modules read it (this module is imported first by every AI module).
    if (!(process.env.GEMINI_API_KEY || '').trim()) process.env.GEMINI_API_KEY = 'free-test-mode';
    console.log('[ai] free test mode: Gemini answers with fixtures, no Gemini calls (AI_LIVE=1 for real calls)');
  }
}
installAiFixtures();
