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
  info = { ...info, ...patch };
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
/** The user setting (Settings → "Use this device's AI"). Default on. */
export function localAiEnabled(): boolean {
  return getSettings().onDeviceAi !== false;
}

// ---- browser engine (Prompt API) -------------------------------------------------------------------------
interface LmSession {
  prompt(input: unknown, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LmStatic {
  availability(opts?: unknown): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: unknown): Promise<LmSession>;
}
const lm = (): LmStatic | null => {
  const g = globalThis as unknown as { LanguageModel?: LmStatic };
  return g.LanguageModel && typeof g.LanguageModel.availability === 'function' ? g.LanguageModel : null;
};
const TEXT_IO = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const IMAGE_IO = { expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

// ---- android engine (wrapper bridge) ---------------------------------------------------------------------
interface AndroidLlm {
  status(): Promise<{ status: number; image?: boolean; maxOutputTokens?: number }>;
  download(onProgress?: (p: number | null) => void): Promise<boolean>;
  generate(req: { system?: string; prompt: string; image?: string; temperature?: number; maxOutputTokens?: number }): Promise<{ ok: boolean; text?: string; error?: string }>;
}
const android = (): AndroidLlm | null => {
  const g = globalThis as unknown as { MGLocalAI?: AndroidLlm };
  return g.MGLocalAI && typeof g.MGLocalAI.status === 'function' ? g.MGLocalAI : null;
};
const ANDROID_STATES: LocalAiState[] = ['unavailable', 'downloadable', 'downloading', 'available'];

/** Detects the engine and its state. Cheap; cached until refresh is forced. */
export function refreshLocalAi(force = false): Promise<LocalAiInfo> {
  if (probing && !force) return probing;
  probing = (async () => {
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
        const state = await L.availability(TEXT_IO);
        let image = false;
        if (state === 'available') image = (await L.availability(IMAGE_IO).catch(() => 'unavailable')) === 'available';
        set({ state, engine: state === 'unavailable' ? null : 'browser', image, maxOutputTokens: 4000 });
        return info;
      }
      set({ state: 'unsupported', engine: null });
    } catch {
      set({ state: 'unavailable', engine: null });
    }
    return info;
  })();
  return probing;
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

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(b);
  });

/** One prompt on the device's model. Throws when no engine is ready or the engine fails. */
export async function localPrompt(o: LocalPromptOptions): Promise<string> {
  const cur = await refreshLocalAi();
  if (cur.state !== 'available' || !cur.engine) throw new Error('local_ai_unavailable');
  if (o.image && !cur.image) throw new Error('local_ai_no_image');
  const ms = o.timeoutMs ?? 60_000;
  if (cur.engine === 'android') {
    const schemaHint = o.schema ? '\n\nReply with ONLY JSON (no code fences) matching this JSON Schema:\n' + JSON.stringify(o.schema) : '';
    const r = await withTimeout(
      android()!.generate({
        system: o.system,
        prompt: o.prompt + schemaHint,
        image: o.image ? await blobToDataUrl(o.image) : undefined,
        temperature: o.temperature,
        maxOutputTokens: Math.min(o.maxOutputTokens ?? cur.maxOutputTokens, cur.maxOutputTokens),
      }),
      ms,
    );
    if (!r.ok || typeof r.text !== 'string') throw new Error(r.error || 'local_ai_failed');
    return r.text;
  }
  const L = lm()!;
  const ctl = new AbortController();
  if (o.signal) o.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  const session = await L.create({
    ...(o.image ? IMAGE_IO : TEXT_IO),
    initialPrompts: o.system ? [{ role: 'system', content: o.system }] : undefined,
    signal: ctl.signal,
  });
  try {
    const input = o.image ? [{ role: 'user', content: [{ type: 'text', value: o.prompt }, { type: 'image', value: o.image }] }] : o.prompt;
    return await withTimeout(session.prompt(input, { responseConstraint: o.schema, signal: ctl.signal }), ms, ctl);
  } finally {
    session.destroy();
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
 * JSON from the device's model, checked by `validate` (return null to reject). Retries once on bad output.
 * Resolves null instead of throwing, so callers can fall back to the server.
 */
export async function localJson<T>(o: LocalPromptOptions & { validate: (v: unknown) => T | null; attempts?: number }): Promise<T | null> {
  const attempts = o.attempts ?? 2;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await localPrompt(o);
      const v = o.validate(parseLooseJson(text));
      if (v != null) return v;
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg === 'local_ai_unavailable' || msg === 'local_ai_no_image' || (e as Error)?.name === 'AbortError') return null;
    }
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
}

/** Can this feature run on the device right now? (Setting on, engine ready, big enough.) */
export async function canRunLocally(o: { minOutputTokens?: number; needsImage?: boolean } = {}): Promise<boolean> {
  if (!localAiEnabled()) return false;
  const cur = await refreshLocalAi();
  if (cur.state !== 'available') return false;
  if (o.needsImage && !cur.image) return false;
  if (o.minOutputTokens && cur.maxOutputTokens < o.minOutputTokens) return false;
  return true;
}

/** Runs a feature on the device when possible (free), otherwise on the server (Sparks). */
export async function runLocalFirst<T>(o: RunLocalFirstOptions<T>): Promise<T> {
  if (await canRunLocally(o)) {
    try {
      const v = await o.local();
      if (v != null) {
        set({ freeRuns: info.freeRuns + 1 });
        return v;
      }
    } catch {
      /* fall back to the server */
    }
  }
  return o.server();
}

if (typeof window !== 'undefined') {
  // Probe once the page is idle, and again if the setting is turned back on.
  setTimeout(() => void refreshLocalAi(), 1500);
  subscribeSettings(() => {
    if (localAiEnabled()) void refreshLocalAi(true);
  });
}
