import type {
  Vibe,
  DietaryPreference,
  ExperienceStop,
  StopKind,
  Cuisine,
  ContentPack,
  PostedSpecial,
  EveStory,
} from '@/types';
import { aiFetchJson, canRunLocally, fetchJson, FetchError, runLocalFirst } from '../ui-kit';
import { LOCAL_TOKENS, localIntro, localNarration, localOutro, localPackText, localParseIntent, localStory } from './localEve';

// ---------- Image budget (shown in the UI) ----------
// Image responses (and the 429 when it runs out) carry the visitor's
// remaining hourly image budget; components subscribe to show "N left".
export interface ImageLimit {
  limit: number;
  remaining: number;
  resetInSec: number;
}
let imageLimit: ImageLimit | null = null;
const limitListeners = new Set<(l: ImageLimit) => void>();

function publishLimit(raw: unknown) {
  const l = raw as Partial<ImageLimit> | null | undefined;
  if (!l || typeof l.limit !== 'number' || typeof l.remaining !== 'number') return;
  imageLimit = { limit: l.limit, remaining: l.remaining, resetInSec: typeof l.resetInSec === 'number' ? l.resetInSec : 0 };
  limitListeners.forEach((fn) => fn(imageLimit!));
}

export function subscribeImageLimit(fn: (l: ImageLimit) => void): () => void {
  limitListeners.add(fn);
  if (imageLimit) fn(imageLimit);
  return () => limitListeners.delete(fn);
}

/** Reservation platforms that list a venue (Gemini + Google Search); background, never opens the credits sheet. */
export async function checkReservations(input: { restaurantName: string; city: string }): Promise<{ opentable: boolean; resy: boolean; tock: boolean }> {
  return call('/api/reservations/check', input, { timeoutMs: 45_000, retries: 0, ai: 'background' });
}

/** Error with a user-safe message plus the server's code (e.g. 'image_limit'). */
export interface EveError extends Error {
  code?: string;
  status?: number;
  retryable?: boolean;
}

// Messages for the AI-credits answers (Android app only; the website never gets them).
const CREDIT_MESSAGES: Record<string, string> = {
  insufficient_credits: 'You\u2019re out of Sparks. Tap the \u2728 chip at the top to get more.',
  credits_unavailable: 'Sparks are temporarily unavailable. Please try again in a minute.',
  update_required: 'Update Eve from Google Play to use this feature.',
};

// All API calls go through the kit's fetchJson: per-attempt timeout and
// bounded retries (timeouts / network / 429 / 5xx). AI calls are slow
// (search grounding, image generation), so each call sets its own timeout.
// AI calls (`ai`) use aiFetchJson: inside the Android app it sends the app
// user id (prepaid AI credits), keeps the coin chip current and opens the
// "Get AI credits" sheet on HTTP 402, except for background calls
// (ai: 'background'). On the website it is exactly fetchJson.
async function call<T>(
  url: string,
  body: unknown,
  opts: { timeoutMs: number; retries?: number; ai?: true | 'background' }
): Promise<T> {
  try {
    const request = {
      method: body === undefined ? 'GET' : 'POST',
      body,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries ?? 1,
      backoffMs: 1200,
    };
    const data = opts.ai
      ? await aiFetchJson<T>(url, { ...request, creditsSheet: opts.ai !== 'background' })
      : await fetchJson<T>(url, request);
    publishLimit((data as any)?.imageLimit);
    return data;
  } catch (e) {
    if (e instanceof FetchError) {
      const b = (e.body && typeof e.body === 'object' ? e.body : {}) as { code?: string; error?: unknown; imageLimit?: unknown };
      publishLimit(b.imageLimit);
      const creditCode = typeof b.error === 'string' && CREDIT_MESSAGES[b.error] ? b.error : undefined;
      if (creditCode) {
        const err = new Error(CREDIT_MESSAGES[creditCode]) as EveError;
        err.code = creditCode;
        err.status = e.status;
        err.retryable = creditCode === 'credits_unavailable';
        throw err;
      }
      const message =
        e.status === 503
          ? 'Eve is resting right now. Please try again in a little while.'
          : e.kind === 'timeout'
            ? 'Eve took too long to answer. Please try again.'
            : e.message;
      const err = new Error(message) as EveError;
      err.code = b.code;
      err.status = e.status;
      err.retryable = e.retryable;
      throw err;
    }
    throw e;
  }
}

export async function refreshImageLimit(): Promise<void> {
  try {
    const data = await call<{ images: ImageLimit }>('/api/limits', undefined, { timeoutMs: 8_000, retries: 0 });
    publishLimit(data?.images);
  } catch {}
}


export interface PlanSkeletonRequest {
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetPerPersonUSD: number;
  freeText: string;
  cuisinePref?: string;
  whenISO?: string;
  startTime?: string;       // 24-hour "HH:MM", e.g. "19:30"
  durationHours?: number;    // total hours the evening should run
}

export interface PlanSkeletonResponse {
  title: string;
  stops: Array<Omit<ExperienceStop, 'status' | 'imageData' | 'imageMime' | 'error'>>;
  groundedSearchUsed?: boolean;
  groundedSources?: string[];
}

export async function planSkeleton(req: PlanSkeletonRequest): Promise<PlanSkeletonResponse> {
  return call('/api/plan-experience/skeleton', req, { timeoutMs: 75_000, retries: 0, ai: true });
}

export interface StopImageRequest {
  name: string;
  kind: StopKind;
  oneLineVibe: string;
  city: string;
  vibe: Vibe;
}

export async function stopImage(req: StopImageRequest): Promise<{ imageData: string; imageMime: string }> {
  return call('/api/plan-experience/stop-image', req, { timeoutMs: 120_000, retries: 0, ai: true });
}

export interface NarrationRequest {
  title: string;
  stops: ExperienceStop[];
  vibe: Vibe;
}

export async function narrationText(req: NarrationRequest): Promise<{ narration: string }> {
  return runLocalFirst({
    minOutputTokens: LOCAL_TOKENS.narration,
    local: () => localNarration(req),
    server: () => call('/api/plan-experience/narration', req, { timeoutMs: 45_000, ai: 'background' }),
  });
}

export async function synthesize(
  text: string,
  voiceMode: 'eve' | 'reel' = 'eve'
): Promise<{ audioData: string; audioMime: string }> {
  return call('/api/tts', { text, voiceMode }, { timeoutMs: 25_000, ai: 'background' });
}

export interface ContentPackRequest {
  /** Skip the server cache ("Regenerate tonight's look"). */
  fresh?: boolean;
  dishName: string;
  dishDescription: string;
  restaurantName: string;
  cuisine: Cuisine;
  voice: string;
  city: string;
  signatureDishes: string;
}

/**
 * The pictures and the menu card (price, allergens) are always made on the server. With on-device AI
 * the other text (Instagram, email, SMS, Reel storyboard) is written here first and sent along, so the
 * server skips those calls.
 */
export async function generateContentPack(req: ContentPackRequest): Promise<ContentPack> {
  let body: ContentPackRequest & { local?: unknown } = req;
  if (await canRunLocally({ minOutputTokens: LOCAL_TOKENS.contentPack })) {
    const text = await localPackText(req).catch(() => null);
    if (text) body = { ...req, local: { ...text.copy, reel: text.reel } };
  }
  return call('/api/content-pack', body, { timeoutMs: 180_000, retries: 0, ai: true });
}

export async function postSpecial(input: {
  restaurantName: string;
  city: string;
  cuisine: Cuisine;
  dishName: string;
  caption: string;
  imageData?: string;
  imageMime?: string;
}): Promise<{ ok: boolean; id: string }> {
  return call('/api/post-special', input, { timeoutMs: 30_000, retries: 0 });
}

export async function listSpecials(city?: string): Promise<{ specials: PostedSpecial[] }> {
  const url = city ? `/api/specials?city=${encodeURIComponent(city)}` : '/api/specials';
  return call<{ specials: PostedSpecial[] }>(url, undefined, { timeoutMs: 15_000 });
}

export async function eveIntro(input: {
  vibe: string;
  city: string;
  party: number;
  freeText: string;
}): Promise<{ intro: string; lines: string[] }> {
  return runLocalFirst({
    minOutputTokens: LOCAL_TOKENS.intro,
    local: () => localIntro(input),
    server: () => call('/api/eve-intro', input, { timeoutMs: 45_000, ai: 'background' }),
  });
}

export async function eveOutro(input: {
  vibe: string;
  city: string;
  stops: Array<{ name: string; kind: string }>;
}): Promise<{ outro: string }> {
  return runLocalFirst({
    minOutputTokens: LOCAL_TOKENS.outro,
    local: () => localOutro(input),
    server: () => call('/api/eve-outro', input, { timeoutMs: 45_000, ai: 'background' }),
  });
}

export async function eveStory(input: {
  title: string;
  stops: Array<{ name: string; kind: string; oneLineVibe: string; signatureItem?: string }>;
  vibe: string;
  city: string;
  party: number;
}): Promise<EveStory> {
  return runLocalFirst<EveStory>({
    minOutputTokens: LOCAL_TOKENS.story,
    local: () => localStory(input),
    server: () => call('/api/eve-story', input, { timeoutMs: 45_000, ai: 'background' }),
  });
}

export interface EveRefineResponse {
  spokenReply: string;
  title: string;
  stops: Array<{
    kind: string;
    name: string;
    oneLineVibe: string;
    whyThisFits: string;
    approxArrival: string;
    durationMinutes: number;
    walkMinutesFromPrev: number;
    signatureItem?: string;
    isEveOriginal?: boolean;
  }>;
}

export async function eveRefine(input: {
  message: string;
  previousPlan: { stops: Array<{ name: string; kind: string; oneLineVibe?: string }> };
  vibe: string;
  city: string;
  dietary: string[];
  party: number;
  budgetUSD: number;
}): Promise<EveRefineResponse> {
  return call('/api/eve-refine', input, { timeoutMs: 75_000, retries: 0, ai: true });
}

export interface SuggestSpecialResponse {
  mode: 'from_reviews' | 'from_trending';
  dishName: string;
  dishDescription: string;
  rationale: string;
  alternatives: Array<{ dishName: string; rationale: string }>;
  recommendedRestaurants: Array<{ name: string; city: string; dish: string; why: string }>;
  usedSearch?: boolean;
}

export async function suggestSpecial(input: {
  restaurantName: string;
  city: string;
  cuisine: string;
  signatureDishes: string;
  /** Skip the server cache (the "pick a different dish" button). */
  fresh?: boolean;
}, opts: { background?: boolean } = {}): Promise<SuggestSpecialResponse> {
  return call('/api/suggest-special', input, { timeoutMs: 75_000, retries: 0, ai: opts.background ? 'background' : true });
}

export interface ParsedIntent {
  extracted: {
    location: string | null;
    vibe: string | null;
    party: number | null;
    dietary: string[];
    budgetPerPerson: number | null;
    cuisinePref: string | null;
    freeText: string | null;
  };
  isComplete: boolean;
  spokenReply: string;
}

export async function eveParseIntent(
  transcript: string,
  currentForm: {
    location?: string;
    vibe?: string;
    party?: number;
    dietary?: string[];
    budgetPerPerson?: number;
    cuisinePref?: string;
    freeText?: string;
  }
): Promise<ParsedIntent> {
  return runLocalFirst<ParsedIntent>({
    minOutputTokens: LOCAL_TOKENS.parseIntent,
    local: () => localParseIntent(transcript, currentForm),
    server: () => call<ParsedIntent>('/api/eve-parse-intent', { transcript, currentForm }, { timeoutMs: 45_000, ai: true }),
  });
}

export async function eveAvatar(
  mood: 'devoted' | 'listening' | 'speaking' | 'thinking' | 'longing' = 'devoted'
): Promise<{ imageData: string; imageMime: string }> {
  return call('/api/eve-avatar', { mood }, { timeoutMs: 120_000, retries: 0, ai: 'background' });
}

export async function reverseGeocode(lat: number, lng: number): Promise<{ city: string }> {
  return call<{ city: string }>('/api/reverse-geocode', { lat, lng }, { timeoutMs: 45_000, ai: true });
}
