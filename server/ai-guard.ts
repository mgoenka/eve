// Synced from app-platform/server-kit/ai-guard. Do not edit here. VERSION 99fa344 2026-11-24T04:49:20Z
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
 * Copied into each app as server/ai-guard.ts by scripts/sync-ai-guard.sh.
 * Source of truth: app-platform/server-kit/ai-guard/index.ts (tests: server-kit/test/ai-guard.test.ts).
 */

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
