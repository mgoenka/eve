/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * On-device AI: run a feature on the device's own model when there is one, so it costs no Sparks.
 *
 * Engines (picked automatically, first that is available):
 *  - "browser": the Prompt API (`LanguageModel`) built into Chrome 148+ on desktop (Gemini Nano) and Edge (Phi).
 *  - "android": Gemini Nano through ML Kit, via the Android wrapper's `window.MGLocalAI` bridge (wrapper 1.3+,
 *    supported phones only: Pixel 9+, Galaxy S25+ and other AICore devices).
 *
 * Features call `runLocalFirst({ local, server })`: when the setting "Use this device's AI" is on (default) and an
 * engine is ready, `local()` runs first; if it returns null (bad output, too slow, engine error) the server path runs
 * and charges Sparks as before. Nothing is sent anywhere by the local path.
 * Only use it for features where a small model is good enough: creative text, short lists, classification, or
 * work grounded in text the user supplied. Keep fact-critical answer keys, prices, places and health data on the server.
 */
import { getSettings, subscribeSettings } from './settingsStore';

export type LocalAiState = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';
export type LocalAiEngine = 'browser' | 'android';

export interface LocalAiInfo {
  state: LocalAiState;
  engine: LocalAiEngine | null;
  /** Image input supported. */
  image: boolean;
  /** Visible output the engine can produce in one call (tokens). Features needing more should chunk or skip. */
  maxOutputTokens: number;
  /** Download progress 0..1 while state is 'downloading'. */
  progress: number | null;
  /** Features that ran on the device this session (shown in the Sparks sheet). */
  freeRuns: number;
}

export interface LocalPromptOptions {
  system?: string;
  prompt: string;
  /** JSON Schema; the browser engine enforces it, Android gets it as an instruction (output is still validated). */
  schema?: Record<string, unknown>;
  /** One image (Blob/File) for engines with image input. */
  image?: Blob | null;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Default 60 s (first runs on Android warm the model up). */
  timeoutMs?: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let info: LocalAiInfo = { state: 'unsupported', engine: null, image: false, maxOutputTokens: 0, progress: null, freeRuns: 0 };
let probing: Promise<LocalAiInfo> | null = null;

function set(patch: Partial<LocalAiInfo>) {
  const next = { ...info, ...patch };
  if ((Object.keys(next) as Array<keyof LocalAiInfo>).every((k) => next[k] === info[k])) return;
  info = next;
  listeners.forEach((l) => l());
}

export function getLocalAiInfo(): LocalAiInfo {
  return info;
}
export function subscribeLocalAi(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
let settingWanted = false;
/**
 * The app has AI features: SettingsSheet then shows the "Use this device's AI" switch. Called by AiCreditsHost
 * (every app with Sparks) and by the local-AI helpers when a feature uses them; call it yourself to show the switch
 * in an app with neither.
 */
export function enableLocalAiSetting(): void {
  settingWanted = true;
}
/** True once enableLocalAiSetting() ran (see there). */
export function localAiSettingEnabled(): boolean {
  return settingWanted;
}

/** The user setting (Settings → "Use this device's AI"). Default on. */
export function localAiEnabled(): boolean {
  return getSettings().onDeviceAi !== false;
}

// ---- browser engine (Prompt API) -------------------------------------------------------------------------
interface LmSession {
  prompt(input: unknown, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
  /** Chrome 142+: tokens the session can hold, tokens used so far (system prompt), and a dry-run count. */
  contextWindow?: number;
  contextUsage?: number;
  measureContextUsage?(input: unknown, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<number> | number;
  /** Older Chrome names for the same thing. */
  inputQuota?: number;
  inputUsage?: number;
  measureInputUsage?(input: unknown, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<number> | number;
}
interface LmStatic {
  availability(opts?: unknown): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: unknown): Promise<LmSession>;
}
const lm = (): LmStatic | null => {
  const g = globalThis as unknown as { LanguageModel?: LmStatic };
  return g.LanguageModel && typeof g.LanguageModel.availability === 'function' ? g.LanguageModel : null;
};
/** Output the browser engine is assumed to manage in one call (Gemini Nano / Phi); the Prompt API has no output cap. */
const BROWSER_MAX_OUTPUT = 4000;
/** LanguageModel.create() can hang while the model loads; give up after this and use the server. */
const CREATE_TIMEOUT_MS = 20_000;
const TEXT_IO = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const IMAGE_IO = { expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

// ---- android engine (wrapper bridge) ---------------------------------------------------------------------
interface AndroidLlmRequest {
  system?: string | undefined;
  prompt: string;
  /** Data URL or Blob; the shim downsizes it to a ≤1024 px JPEG (wrapper builds whose status reports image: true). */
  image?: Blob | string | undefined;
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
  /** Native deadline (the wrapper clamps it to 5-120 s and replies error 'timeout'). Older wrappers ignore it. */
  timeoutMs?: number | undefined;
  /** Aborting it cancels the native call (MGNativeAndroid.llmCancel) and the reply is error 'aborted'. */
  signal?: AbortSignal | undefined;
}
type AndroidLlmReply = { ok: boolean; text?: string; error?: string };
interface AndroidLlm {
  status(): Promise<{ status: number; image?: boolean; maxOutputTokens?: number }>;
  download(onProgress?: (p: number | null) => void): Promise<boolean>;
  generate(req: AndroidLlmRequest): Promise<AndroidLlmReply>;
}
const android = (): AndroidLlm | null => {
  const g = globalThis as unknown as { MGLocalAI?: AndroidLlm };
  return g.MGLocalAI && typeof g.MGLocalAI.status === 'function' ? g.MGLocalAI : null;
};

const ANDROID_STATES: LocalAiState[] = ['unavailable', 'downloadable', 'downloading', 'available'];

const abortError = () => new DOMException('Aborted', 'AbortError');
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

/**
 * One Android generation through the wrapper's shim. Our own controller (caller's signal + the timeout) goes to
 * the shim, which cancels the native call when it fires (wrapper builds with llmCancel); for older wrappers the
 * JS timer alone gives up. Rejects local_ai_timeout or AbortError; resolves the reply otherwise.
 */
async function androidGenerate(req: AndroidLlmRequest, ms: number, signal?: AbortSignal): Promise<AndroidLlmReply> {
  if (signal?.aborted) throw abortError();
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // The wrapper enforces `timeoutMs` natively (reply 'timeout'); the JS timer is the backstop for older wrappers.
    const r = await withTimeout(android()!.generate({ ...req, timeoutMs: ms, signal: ctl.signal }), ms + 2000, ctl);
    if (signal?.aborted) throw abortError();
    if (!r.ok && (r.error === 'timeout' || r.error === 'aborted' || r.error === 'cancelled')) throw new Error('local_ai_timeout');
    return r;
  } catch (e) {
    throw signal?.aborted ? abortError() : e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

let probed = false;
let probeDone = false;
let probedAt = 0;
/** Other states than 'available' are re-checked after this (phones without AICore must not pay a probe per call). */
const RECHECK_MS = 45_000;
/**
 * Detects the engine and its state. Cheap. Lazy: nothing is probed until a feature, the setting or the Sparks
 * sheet asks. 'available' is cached for the session; any other state for 45 s (a download may finish), and
 * again when the page becomes visible or the setting is turned on. `force` always probes again.
 */
export function refreshLocalAi(force = false): Promise<LocalAiInfo> {
  if (probing && !force && (!probeDone || info.state === 'available' || Date.now() - probedAt < RECHECK_MS)) return probing;
  probed = true;
  probeDone = false;
  probedAt = Date.now();
  const p: Promise<LocalAiInfo> = (async () => {
    try {
      const a = android();
      if (a) {
        const s = await a.status();
        const state = ANDROID_STATES[s.status] ?? 'unavailable';
        set({ state, engine: state === 'unavailable' ? null : 'android', image: !!s.image, maxOutputTokens: s.maxOutputTokens || 256 });
        return info;
      }
      const L = lm();
      if (L) {
        // Chrome may reject (and log) when it can't create a text session on this device: that just means "unavailable".
        const state = await L.availability(TEXT_IO).catch(() => 'unavailable' as const);
        let image = false;
        if (state === 'available') image = (await L.availability(IMAGE_IO).catch(() => 'unavailable')) === 'available';
        set({ state, engine: state === 'unavailable' ? null : 'browser', image, maxOutputTokens: BROWSER_MAX_OUTPUT });
        return info;
      }
      set({ state: 'unsupported', engine: null });
    } catch {
      set({ state: 'unavailable', engine: null });
    }
    return info;
  })().finally(() => {
    if (probing === p) {
      probeDone = true;
      probedAt = Date.now();
    }
  });
  probing = p;
  return p;
}

/**
 * Starts the one-time model download. Call it from a click (the browser requires a user gesture).
 * Resolves true once the model is ready.
 */
export async function prepareLocalAi(): Promise<boolean> {
  const cur = await refreshLocalAi();
  if (cur.state === 'available') return true;
  if (cur.state !== 'downloadable' && cur.state !== 'downloading') return false;
  set({ state: 'downloading', progress: 0 });
  try {
    if (cur.engine === 'android') {
      const ok = await android()!.download((p) => set({ progress: p }));
      await refreshLocalAi(true);
      return ok && info.state === 'available';
    }
    const L = lm()!;
    const s = await L.create({
      ...TEXT_IO,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => set({ progress: (e as unknown as { loaded: number }).loaded }));
      },
    });
    s.destroy();
    await refreshLocalAi(true);
    return info.state === 'available';
  } catch {
    await refreshLocalAi(true);
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, ctl?: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      ctl?.abort();
      reject(new Error('local_ai_timeout'));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * One prompt on the device's model. Throws when no engine is ready, the input doesn't fit, the engine fails or
 * it takes longer than `timeoutMs` (`local_ai_timeout`). An aborted `signal` rejects with an AbortError.
 */
export async function localPrompt(o: LocalPromptOptions): Promise<string> {
  settingWanted = true;
  if (o.signal?.aborted) throw abortError();
  const cur = await refreshLocalAi();
  if (cur.state !== 'available' || !cur.engine) throw new Error('local_ai_unavailable');
  if (o.image && !cur.image) throw new Error('local_ai_no_image');
  const ms = o.timeoutMs ?? 60_000;
  if (cur.engine === 'android') {
    const schemaHint = o.schema ? '\n\nReply with ONLY JSON (no code fences) matching this JSON Schema:\n' + JSON.stringify(o.schema) : '';
    const r = await androidGenerate(
      {
        system: o.system,
        prompt: o.prompt + schemaHint,
        image: o.image ?? undefined,
        temperature: o.temperature,
        maxOutputTokens: Math.min(o.maxOutputTokens ?? cur.maxOutputTokens, cur.maxOutputTokens),
        timeoutMs: ms,
      },
      ms,
      o.signal,
    );
    if (!r.ok || typeof r.text !== 'string') throw new Error(r.error || 'local_ai_failed');
    return r.text;
  }
  const L = lm()!;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (o.signal?.aborted) ctl.abort();
  else o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const created = L.create({
      ...(o.image ? IMAGE_IO : TEXT_IO),
      initialPrompts: o.system ? [{ role: 'system', content: o.system }] : undefined,
      signal: ctl.signal,
    });
    let session: LmSession;
    try {
      session = await withTimeout(created, Math.min(CREATE_TIMEOUT_MS, ms), ctl);
    } catch (e) {
      void created.then((s) => s.destroy(), () => {});
      throw o.signal?.aborted ? abortError() : e;
    }
    try {
      const input = o.image ? [{ role: 'user', content: [{ type: 'text', value: o.prompt }, { type: 'image', value: o.image }] }] : o.prompt;
      if (!(await fitsContext(session, input, o))) throw new Error('local_ai_too_long');
      return await withTimeout(session.prompt(input, { responseConstraint: o.schema, signal: ctl.signal }), ms, ctl);
    } finally {
      session.destroy();
    }
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Will the prompt (plus the caller's maxOutputTokens, when given) fit in the session's context window?
 * Chrome 142+: measureContextUsage / contextWindow / contextUsage; older: measureInputUsage / inputQuota / inputUsage.
 * Unknown (API missing or measuring fails): assume it fits and let the engine decide.
 */
async function fitsContext(session: LmSession, input: unknown, o: LocalPromptOptions): Promise<boolean> {
  try {
    const opts = o.schema ? { responseConstraint: o.schema } : undefined;
    let used = 0;
    let size: number | undefined;
    let window: number | undefined;
    if (typeof session.measureContextUsage === 'function' && typeof session.contextWindow === 'number') {
      size = await session.measureContextUsage(input, opts);
      window = session.contextWindow;
      used = session.contextUsage ?? 0;
    } else if (typeof session.measureInputUsage === 'function' && typeof session.inputQuota === 'number') {
      size = await session.measureInputUsage(input, opts);
      window = session.inputQuota;
      used = session.inputUsage ?? 0;
    }
    if (typeof size !== 'number' || typeof window !== 'number' || !Number.isFinite(window)) return true;
    return used + size + (o.maxOutputTokens ?? 0) <= window;
  } catch {
    return true;
  }
}

/** Pulls the first JSON object/array out of model text (handles ```json fences and chatter). */
export function parseLooseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const close = t[start] === '{' ? '}' : ']';
  for (let end = t.lastIndexOf(close); end > start; end = t.lastIndexOf(close, end - 1)) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* try a shorter slice */
    }
  }
  return null;
}

/**
 * JSON from the device's model, checked by `validate` (return null to reject). Tries again only when the output
 * fails validation (`attempts`, default 2); a timeout or an engine error (busy, battery quota, app in the
 * background…) resolves null at once, so callers fall back to the server without waiting twice.
 * An aborted `signal` rejects with an AbortError (never null: an aborted request must not go to the server).
 */
export async function localJson<T>(o: LocalPromptOptions & { validate: (v: unknown) => T | null; attempts?: number }): Promise<T | null> {
  const attempts = o.attempts ?? 2;
  for (let i = 0; i < attempts; i++) {
    let text: string;
    try {
      text = await localPrompt(o);
    } catch (e) {
      if (o.signal?.aborted) throw isAbort(e) ? e : abortError();
      return null;
    }
    const v = o.validate(parseLooseJson(text));
    if (v != null) return v;
  }
  return null;
}

export interface RunLocalFirstOptions<T> {
  /** Device path: resolve the result, or null to use the server. Don't throw for bad output; return null. */
  local: () => Promise<T | null>;
  /** Server path (charges Sparks as before). */
  server: () => Promise<T>;
  /** Skip the device when its engine can't produce this many output tokens in one call. */
  minOutputTokens?: number;
  /** The feature sends an image. */
  needsImage?: boolean;
  /** The caller's AbortSignal: once aborted, neither path runs any more and the AbortError is rethrown. */
  signal?: AbortSignal;
}

/** Can this feature run on the device right now? (Setting on, engine ready, big enough.) */
export async function canRunLocally(o: { minOutputTokens?: number; needsImage?: boolean } = {}): Promise<boolean> {
  settingWanted = true;
  if (!localAiEnabled()) return false;
  const cur = await refreshLocalAi();
  if (cur.state !== 'available') return false;
  if (o.needsImage && !cur.image) return false;
  if (o.minOutputTokens && cur.maxOutputTokens < o.minOutputTokens) return false;
  return true;
}

/** Runs a feature on the device when possible (free), otherwise on the server (Sparks). */
export async function runLocalFirst<T>(o: RunLocalFirstOptions<T>): Promise<T> {
  if (o.signal?.aborted) throw abortError();
  if (await canRunLocally(o)) {
    try {
      const v = await o.local();
      if (v != null) {
        set({ freeRuns: info.freeRuns + 1 });
        return v;
      }
    } catch (e) {
      // An aborted request never falls back to the paid server call. Any other failure (even an AbortError the
      // engine raised by itself) falls back to the server.
      if (o.signal?.aborted) throw isAbort(e) ? e : abortError();
    }
  }
  if (o.signal?.aborted) throw abortError();
  return o.server();
}

if (typeof window !== 'undefined') {
  // No probe on load (it is lazy). Once something has asked: check again when the setting is turned back on,
  // and when the page becomes visible again (a download may have finished meanwhile), at most every 30 s.
  subscribeSettings(() => {
    if (probed && localAiEnabled()) void refreshLocalAi(true);
  });
  let lastVisible = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !probed || !localAiEnabled()) return;
    if (Date.now() - lastVisible < 30_000) return;
    lastVisible = Date.now();
    void refreshLocalAi(true);
  });
}
