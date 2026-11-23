import express from 'express';
import helmet from 'helmet';
import crypto from 'crypto';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { CUISINES, VIBES, DIETARY_PREFERENCES, DEMO_RESTAURANTS } from './constants';
import { AgentRuntime, buildEveBrainAgent } from './agent';
import * as firestore from './lib/firestore';
import * as stripeLib from './lib/stripe';
import * as instagramLib from './lib/instagram';
import { TtlCache, cacheKey } from './lib/ttlCache';
import {
  cleanIntro,
  cleanLocalPackText,
  cleanParsedIntent,
  cleanSpokenLine,
  cleanStory,
  contentSharedContext,
  copyPrompt,
  copyChannelPrompt,
  introPrompt,
  narrationPrompt,
  outroPrompt,
  parseIntentPrompt,
  reelPrompt,
  storyPrompt,
} from './lib/evePrompts';
import { createCredits, costOfCall } from './server/credits/index.ts';
import type { Meter } from './server/credits/index.ts';
import { cloudTtsUsage, recordCloudTts, recordGemini, withMeter } from './server/aiMeter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PORT = parseInt(process.env.PORT || '8080', 10);

const TEXT_MODEL = 'gemini-flash-latest';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const app = express();
app.disable('x-powered-by');
// Cloud Run puts exactly one proxy in front of us, so req.ip is the real
// client address (the right-most X-Forwarded-For hop, which clients can't forge).
app.set('trust proxy', 1);
app.use(compression());
// Security headers. CSP: everything is same-origin except the Unsplash
// placeholder photos, the Google Fonts used by the static pitch deck and the
// AI-content report request to mohitgoenka.com (kit ReportContentButton).
// AI images and TTS audio arrive as data: URLs. Stripe Checkout, Maps,
// OpenTable/Resy/Tock and Instagram are plain navigations (no scripts).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
        'media-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'", 'https://mohitgoenka.com'],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'frame-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': [],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Same-origin requests keep their Referer (used by the API origin check).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// Body limits: small JSON everywhere; only posting a special carries an
// image. The Stripe webhooks (Eve's subscriptions and the AI credits one) need
// the raw body to verify their signatures, so the JSON parser skips them
// (express.raw() on each route reads it).
const jsonSmall = express.json({ limit: '100kb' });
const jsonImage = express.json({ limit: '6mb' });
const jsonTiny = express.json({ limit: '8kb', strict: true });
const RAW_BODY_PATHS = new Set(['/api/stripe/webhook', '/api/credits/stripe/webhook']);
const TINY_JSON_PATHS = new Set(['/api/credits/purchase', '/api/credits/checkout', '/api/credits/stripe/confirm']);
app.use((req, res, next) => {
  if (RAW_BODY_PATHS.has(req.path)) return next();
  if (TINY_JSON_PATHS.has(req.path)) return jsonTiny(req, res, next);
  return (req.path === '/api/post-special' ? jsonImage : jsonSmall)(req, res, next);
});

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY: not set — /api/* will return 503');
}

// @google/genai 3 defaults to the v1 API, where the gemini-flash-latest alias doesn't exist (404).
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } }) : null;

function jsonError(res: express.Response, code: number, message: string) {
  // Upstream (Gemini / TTS) failure details stay in the server log; users get
  // a calm, generic line. 4xx and 503 messages are written for users already.
  if (code >= 500 && code !== 503) {
    console.warn(`[${code}] ${message}`);
    message = 'Eve couldn\u2019t finish that just now. Please try again.';
  }
  res.status(code).json({ error: message });
}

// ---------- Input validation ----------
// Every endpoint takes a fixed request shape: strings are trimmed and capped,
// enums fall back to a default, numbers are clamped, arrays are bounded.
// Clients never choose models, prompts, tools or token limits.
function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function intIn(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
}
const VIBE_IDS = new Set<string>(VIBES.map((v) => v.id));
const STOP_KIND_IDS = new Set(['dinner', 'dessert', 'drink', 'walk', 'live_music', 'view', 'activity']);
const DIETARY_IDS = new Set<string>(DIETARY_PREFERENCES.map((d) => d.id));
function vibeIn(v: unknown): string {
  return typeof v === 'string' && VIBE_IDS.has(v) ? v : 'date_night';
}
function kindIn(v: unknown): string {
  return typeof v === 'string' && STOP_KIND_IDS.has(v) ? v : 'dinner';
}
function dietaryIn(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && DIETARY_IDS.has(d)).slice(0, 8) : [];
}
interface StopIn {
  kind: string;
  name: string;
  oneLineVibe: string;
  whyThisFits: string;
  approxArrival: string;
  signatureItem: string;
}
function stopsIn(v: unknown): StopIn[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).flatMap((s: any) => {
    const name = str(s?.name, 120);
    if (!name) return [];
    return [{
      kind: kindIn(s?.kind),
      name,
      oneLineVibe: str(s?.oneLineVibe, 240),
      whyThisFits: str(s?.whyThisFits, 300),
      approxArrival: str(s?.approxArrival, 20),
      signatureItem: str(s?.signatureItem, 160),
    }];
  });
}

function clean(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJson(text: string): string | null {
  if (!text) return null;
  const stripped = clean(text);

  try {
    JSON.parse(stripped);
    return stripped;
  } catch {}

  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const candidate = fenceMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = stripped.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  const firstBracket = stripped.indexOf('[');
  const lastBracket = stripped.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = stripped.slice(firstBracket, lastBracket + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  return null;
}

function safeParseJson<T = any>(text: string): T | null {
  const json = extractJson(text);
  if (!json) {
    console.warn('safeParseJson: could not extract JSON from response (first 400 chars):', (text || '').slice(0, 400));
    return null;
  }
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    console.warn('safeParseJson: extracted candidate failed final parse:', (json || '').slice(0, 200));
    return null;
  }
}

function imagePart(mimeType: string, data: string) {
  return { inlineData: { mimeType, data } };
}

// ---------- Gemini call helpers (cost + speed guards) ----------
//
// Every text call gets a hard timeout, bounded SDK retries, a maxOutputTokens
// ceiling and the lowest thinking level. Thinking tokens count toward
// maxOutputTokens, so the ceilings are generous enough that JSON never gets
// cut off mid-object.
const TEXT_TIMEOUT_MS = 25_000;
const GROUNDED_TIMEOUT_MS = 40_000;
const IMAGE_TIMEOUT_MS = 55_000;
const RETRY = { attempts: 2 };

// If the model behind gemini-flash-latest ever rejects thinkingLevel, stop
// sending it instead of failing every request.
let thinkingLevelSupported = true;

async function generateText(opts: {
  contents: string;
  maxOutputTokens: number;
  config?: Record<string, any>;
  schema?: Record<string, any>;
  timeoutMs?: number;
}) {
  if (!ai) throw new Error('GEMINI_API_KEY not configured');
  const config: Record<string, any> = {
    ...(opts.config || {}),
    maxOutputTokens: opts.maxOutputTokens,
    httpOptions: { timeout: opts.timeoutMs ?? TEXT_TIMEOUT_MS, retryOptions: RETRY },
  };
  if (opts.schema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = opts.schema;
  }
  if (thinkingLevelSupported) {
    try {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: opts.contents,
        config: { ...config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      recordGemini(response, TEXT_MODEL); // AI credits: no-op unless a paying app request
      return response;
    } catch (err: any) {
      if (!/thinking/i.test(String(err?.message || ''))) throw err;
      thinkingLevelSupported = false;
      console.warn(`thinkingLevel rejected by ${TEXT_MODEL}; continuing without it`);
    }
  }
  const response = await ai.models.generateContent({ model: TEXT_MODEL, contents: opts.contents, config });
  recordGemini(response, TEXT_MODEL);
  return response;
}

/** Search-grounded text call (venue research, live lookups). */
function generateGrounded(contents: string, maxOutputTokens: number, temperature: number) {
  return generateText({
    contents,
    maxOutputTokens,
    timeoutMs: GROUNDED_TIMEOUT_MS,
    config: { temperature, tools: [{ googleSearch: {} }] },
  });
}

interface GeneratedImage {
  imageData: string;
  imageMime: string;
}

async function generateImage(prompt: string): Promise<GeneratedImage | null> {
  if (!ai) throw new Error('GEMINI_API_KEY not configured');
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      httpOptions: { timeout: IMAGE_TIMEOUT_MS, retryOptions: RETRY },
    },
  });
  recordGemini(response, IMAGE_MODEL);
  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const p of parts as Array<any>) {
    if (p?.inlineData?.data && p?.inlineData?.mimeType) {
      return { imageData: p.inlineData.data, imageMime: p.inlineData.mimeType };
    }
  }
  return null;
}

// ---------- Server-side caches for identical requests ----------
// Images are big (~1-2 MB of base64 each), so the image caches are bounded by
// bytes as well as entries to stay well inside a 512 MiB instance
// (all caches together top out around 110 MB).
const HOUR = 60 * 60 * 1000;
const imageBytes = (v: { imageData?: string }) => (v.imageData ? v.imageData.length : 0);
const stopImageCache = new TtlCache<GeneratedImage>({ maxEntries: 100, ttlMs: 24 * HOUR, maxBytes: 48 * 1024 * 1024, sizeOf: imageBytes });
const avatarCache = new TtlCache<GeneratedImage>({ maxEntries: 8, ttlMs: 24 * HOUR, maxBytes: 8 * 1024 * 1024, sizeOf: imageBytes });
const contentPackCache = new TtlCache<{ body: any; bytes: number }>({
  maxEntries: 12,
  ttlMs: 6 * HOUR,
  maxBytes: 32 * 1024 * 1024,
  sizeOf: (v) => v.bytes,
});
const venueDetailsCache = new TtlCache<string>({ maxEntries: 500, ttlMs: 24 * HOUR });
const suggestCache = new TtlCache<any>({ maxEntries: 300, ttlMs: 6 * HOUR });
const geocodeCache = new TtlCache<string>({ maxEntries: 500, ttlMs: 7 * 24 * HOUR });

// ---------- Image-generation budget (per IP, per hour) ----------
// Image generation is the expensive part of Eve. Cache hits are free; every
// fresh image draws from a small hourly per-IP budget that the UI displays.
const IMAGE_BUDGET_PER_HOUR = 40;
const imageBuckets = new Map<string, { used: number; resetAt: number }>();

function imageBudget(req: express.Request) {
  const key = clientIp(req);
  const now = Date.now();
  let b = imageBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { used: 0, resetAt: now + HOUR };
    imageBuckets.set(key, b);
  }
  if (imageBuckets.size > 5000) {
    for (const [k, v] of imageBuckets) if (v.resetAt <= now) imageBuckets.delete(k);
  }
  return b;
}

function imageLimitInfo(req: express.Request) {
  const b = imageBudget(req);
  return {
    limit: IMAGE_BUDGET_PER_HOUR,
    remaining: Math.max(0, IMAGE_BUDGET_PER_HOUR - b.used),
    resetInSec: Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000)),
  };
}

/** Image responses carry the visitor's remaining budget so the UI can show it. */
function sendWithLimit(req: express.Request, res: express.Response, body: Record<string, any>) {
  res.json({ ...body, imageLimit: imageLimitInfo(req) });
}

/** Reserve `n` fresh images; on failure sends a 429 and returns false. */
function takeImages(req: express.Request, res: express.Response, n = 1): boolean {
  const b = imageBudget(req);
  if (b.used + n > IMAGE_BUDGET_PER_HOUR) {
    const info = imageLimitInfo(req);
    res.set('Retry-After', String(info.resetInSec));
    res.status(429).json({
      error: `Eve has painted her ${IMAGE_BUDGET_PER_HOUR} pictures for this hour. More in ${Math.ceil(info.resetInSec / 60)} min.`,
      code: 'image_limit',
      ...info,
      imageLimit: info,
    });
    return false;
  }
  b.used += n;
  return true;
}

/** Give back reserved images that were never generated (errors, empty output). */
function refundImages(req: express.Request, n = 1) {
  const b = imageBudget(req);
  b.used = Math.max(0, b.used - n);
}

// ---------- AI credits ----------
// Android app requests (user agent MohitGoenkaApp/ + X-MG-App-User) always prepay every AI call with
// credits; website requests pay from the shared mg_wallet cookie only while the web credits switch
// (Firestore aiCreditConfig/web) is on, buying packs through Stripe Checkout. server/credits is
// vendored from app-platform/server-kit. Firestore, Play API and Secret Manager via ADC.
// metered() holds a typical estimate (402 when the balance can't cover it), runs the unchanged
// handler with a per-request meter (server/aiMeter.ts: the text/image helpers, agent tools and
// Cloud TTS record each call that really ran), then charges the sum. Cache hits record nothing;
// a failed action (4xx/5xx answer or a throw) is not charged. Requests that don't pay skip all of this.
const credits = createCredits({ packageName: 'com.mohitgoenka.eve' });

/** Typical cost of one call in credits (estimates only; the charge uses the real usage). */
const est = (model: string, input: number, output: number, grounded = 0) =>
  costOfCall({ model, usage: { promptTokenCount: input, candidatesTokenCount: output }, groundedRequests: grounded }).credits;
// One 1024px image (1,290 image tokens) from a ~500-token prompt.
const estImage = () => est(IMAGE_MODEL, 500, 1290);
// Venue research: short grounded prompt + one paragraph + thinking.
const estResearch = () => est(TEXT_MODEL, 300, 700, 1);
const estTtsChars = (voice: string, chars: number) => {
  const u = cloudTtsUsage(voice, chars);
  return costOfCall({ model: u.model, usage: u.usage }).credits;
};

type Estimate = (req: express.Request) => number;
const body = (req: express.Request): any => (req.body && typeof req.body === 'object' ? req.body : {});
const estIntro: Estimate = () => est(TEXT_MODEL, 700, 800);
const estOutro: Estimate = () => est(TEXT_MODEL, 350, 650);
const estStory: Estimate = () => est(TEXT_MODEL, 900, 900);
const estRefine: Estimate = () => est(TEXT_MODEL, 800, 1300, 1);
const estParseIntent: Estimate = () => est(TEXT_MODEL, 900, 750);
const estGeocode: Estimate = () => est(TEXT_MODEL, 80, 620);
const estSkeleton: Estimate = () => est(TEXT_MODEL, 1200, 2100, 1);
const estNarration: Estimate = () => est(TEXT_MODEL, 500, 800);
const estReservations: Estimate = () => est(TEXT_MODEL, 200, 630, 1);
const AVATAR_MOODS = new Set(['devoted', 'listening', 'speaking', 'thinking', 'longing']);
const estAvatar: Estimate = (req) => {
  const mood = str(body(req).mood, 20);
  return avatarCache.get(cacheKey(AVATAR_MOODS.has(mood) ? mood : 'devoted')) ? 1 : estImage();
};
const estStopImage: Estimate = (req) => {
  const b = body(req);
  const key = cacheKey(str(b.name, 120), kindIn(b.kind), str(b.city, 120), vibeIn(b.vibe), str(b.oneLineVibe, 240));
  return stopImageCache.get(key) ? 1 : estResearch() + estImage();
};
const estContentPack: Estimate = (req) => {
  const b = body(req);
  const key = cacheKey(str(b.dishName, 120), str(b.dishDescription, 400), str(b.restaurantName, 120), str(b.cuisine, 40) || 'fusion', str(b.voice, 300), str(b.city, 120), str(b.signatureDishes, 400));
  if (!b.fresh && contentPackCache.get(key)) return 1;
  return est(TEXT_MODEL, 350, 1300) + est(TEXT_MODEL, 300, 900) + 4 * estImage();
};
const estSuggest: Estimate = (req) => {
  const b = body(req);
  const cuisine = str(b.cuisine, 40);
  const dishes = str(b.signatureDishes, 400);
  if (!b.fresh && suggestCache.get(cacheKey(str(b.restaurantName, 120), str(b.city, 120), cuisine, dishes))) return 1;
  return est(TEXT_MODEL, 700, 1100, 1) + (cuisine && dishes ? 0 : est(TEXT_MODEL, 150, 700, 1));
};
const estTts: Estimate = (req) => {
  const b = body(req);
  const text = str(b.text, 1500);
  const reel = b.voiceMode === 'reel';
  if (ttsCache.get(`${reel ? 'reel' : 'eve'}|${text.slice(0, 4500)}`)) return 1;
  // Eve's SSML wrapper adds ~70 characters plus a break tag per sentence.
  return estTtsChars(reel ? 'en-US-Chirp3-HD-Aoede' : 'en-US-Neural2-F', text.length + (reel ? 0 : 120));
};
const estAgent: Estimate = (req) => {
  const plan = Array.isArray(body(req).plan) ? body(req).plan.slice(0, 6) : [];
  const per = (st: any) =>
    st?.tool === 'placesSearch' ? est(TEXT_MODEL, 120, 700, 1)
      : st?.tool === 'sceneCard' ? estImage()
        : st?.tool === 'voiceLine' ? estTtsChars('en-US-Chirp3-HD-Aoede', str(st?.input?.text, 400).length)
          : 0;
  return Math.max(1, plan.reduce((n: number, st: any) => n + per(st), 0));
};

/** Thrown inside credits.run when the handler answered with an error: release the hold, charge nothing. */
class UnchargedAnswer extends Error {}

type AiHandler = (req: express.Request, res: express.Response) => unknown;

/**
 * Wraps an AI route. Website (and any request that doesn't pay): the handler runs exactly as before.
 * Paying app request: the handler's JSON answer is held back until the credits are settled, so the
 * response can carry X-MG-Credits-Balance / -Charged.
 */
function metered(action: string, estimate: Estimate, handler: AiHandler): express.RequestHandler {
  return async (req, res) => {
    let wallet;
    try {
      wallet = credits.identify(req);
    } catch (err) {
      if (!credits.sendError(res, err)) jsonError(res, 500, 'credits identify failed');
      return;
    }
    if (!wallet) return handler(req, res) as any;

    const realJson = res.json.bind(res);
    let answered = false;
    let answer: unknown;
    res.json = ((b: unknown) => {
      answered = true;
      answer = b;
      return res;
    }) as typeof res.json;
    try {
      const out = await credits.run(wallet, { action, estimate: estimate(req) }, async (meter: Meter) => {
        await withMeter(meter, async () => {
          await handler(req, res);
        });
        if (!answered || res.statusCode >= 400) throw new UnchargedAnswer();
        return answer;
      });
      res.json = realJson;
      credits.applyHeaders(res, out);
      realJson(out.value);
    } catch (err) {
      res.json = realJson;
      if (err instanceof UnchargedAnswer && answered) {
        realJson(answer);
        return;
      }
      if (credits.sendError(res, err)) return;
      console.error(`[credits] ${action} failed:`, (err as Error)?.message || err);
      if (!res.headersSent) jsonError(res, 500, `${action} failed`);
    }
  };
}

// Web wallet cookie (only while web credits are on), before every /api route that may call
// credits.identify. Mounted before the /api origin guard: the balance GET may arrive without
// Origin/Referer; it changes nothing but creating a wallet. The kit rate-limits the credits endpoints.
app.use('/api', (req, res, next) => void credits.middleware(req, res, next));
app.get('/api/credits/balance', (req, res) => credits.handlers.balance(req, res));
// JSON bodies for purchase/checkout/confirm: the 8kb strict parser above (TINY_JSON_PATHS).
app.post('/api/credits/purchase', (req, res) => {
  if (!isAllowedEveOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  return credits.handlers.purchase(req, res);
});
app.post('/api/credits/checkout', (req, res) => {
  if (!isAllowedEveOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  return credits.handlers.checkout(req, res);
});
app.post('/api/credits/stripe/confirm', (req, res) => {
  if (!isAllowedEveOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  return credits.handlers.confirm(req, res);
});
// Stripe calls this server to server: no Origin check; the Stripe-Signature over the raw body is the auth.
app.post('/api/credits/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), (req, res) => credits.handlers.webhook(req, res));

// Rate limiting + origin check for AI endpoints.
// Stripe webhook and Instagram OAuth callbacks are exempt — they are called by
// external services (Stripe/Meta) and must remain reachable from outside.
const EXEMPT_AI_PATHS = new Set([
  '/api/health',
  '/api/stripe/webhook',
  '/api/auth/instagram/start',
  '/api/auth/instagram/callback',
]);

const ALLOWED_EVE_ORIGINS = new Set(['eve.mohitgoenka.com', 'localhost', '127.0.0.1']);
const PUBLIC_BASE_URL = process.env.NODE_ENV === 'production' ? 'https://eve.mohitgoenka.com' : `http://localhost:${PORT}`;
const aiBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function hostFrom(header: string | undefined): string | null {
  if (!header) return null;
  try { return new URL(header).hostname.toLowerCase(); } catch { return null; }
}

// Same-origin only (no CORS headers are ever sent, so other sites can't read
// responses). A request passes when its Origin, or for GETs without one its
// Sec-Fetch-Site / Referer, says it came from Eve itself: the public domain
// or the host it was served from (the Cloud Run URL). The Host header alone
// is never enough, since every request to this server carries it.
function isAllowedEveOrigin(req: express.Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const host = (req.get('host') || '').split(':')[0].toLowerCase();
  const ok = (h: string | null) => !!h && (ALLOWED_EVE_ORIGINS.has(h) || h === host);
  const origin = req.get('origin');
  if (origin) return ok(hostFrom(origin));
  if (req.get('sec-fetch-site') === 'same-origin') return true;
  return ok(hostFrom(req.get('referer')));
}

// A single evening plan bursts many /api/* calls in ~30-60s (intro, intent,
// skeleton, one image + reservation check per stop, per-beat TTS, avatar, outro),
// so the per-IP ceiling must comfortably clear one rich plan plus a refine.
const AI_REQUESTS_PER_MINUTE = 120;

function checkAiRateLimit(req: express.Request): boolean {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = aiBuckets.get(key);
  if (aiBuckets.size > 5000) {
    for (const [k, v] of aiBuckets) if (v.resetAt <= now) aiBuckets.delete(k);
  }
  if (!bucket || bucket.resetAt <= now) {
    aiBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= AI_REQUESTS_PER_MINUTE;
}

app.use('/api/', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const rawPath = req.originalUrl.split('?')[0];
  if (EXEMPT_AI_PATHS.has(rawPath)) return next();
  if (!isAllowedEveOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!checkAiRateLimit(req)) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

// Remaining image budget for this visitor, shown under the plan button.
app.get('/api/limits', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ images: imageLimitInfo(req), requestsPerMinute: AI_REQUESTS_PER_MINUTE });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasKey: !!GEMINI_API_KEY,
    architecture: {
      runtime: 'Cloud Run gen2',
      sdk: '@google/genai v3',
      models: {
        text: TEXT_MODEL,
        image: IMAGE_MODEL,
        tts: 'Cloud Text-to-Speech Chirp 3 HD',
      },
      tools: ['placesSearch (Google Search grounding)', 'sceneCard (Gemini 2.5 Flash Image interleaved)', 'voiceLine (Cloud TTS)'],
      agentPattern: 'ADK-flavored deterministic runner (see agent.ts)',
    },
  });
});

// ADK-pattern agent endpoint: the same three tools the rest of the
// app uses, exposed through a single agent runtime call. Inspectable
// from any client that wants to observe the agent abstraction.
app.post('/api/agent/run', metered('agent', estAgent, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');
  const plan = req.body?.plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return jsonError(res, 400, 'plan must be a non-empty array of { tool, input }');
  }
  if (plan.length > 6) return jsonError(res, 400, 'plan may have at most 6 steps');
  // Fixed tools with fixed, capped inputs: the caller can't pick a model,
  // prompt, token limit or URL; voice lines are short.
  const TOOLS = new Set(['placesSearch', 'sceneCard', 'voiceLine']);
  const steps = plan.map((st: any) => {
    const i = st?.input && typeof st.input === 'object' ? st.input : {};
    return {
      tool: TOOLS.has(st?.tool) ? st.tool : 'unknown',
      input: {
        name: str(i.name, 120),
        city: str(i.city, 120),
        kind: kindIn(i.kind),
        vibe: vibeIn(i.vibe),
        oneLineVibe: str(i.oneLineVibe, 240),
        venueDetails: str(i.venueDetails, 600),
        text: str(i.text, 400),
      },
    };
  });
  if (steps.some((st) => st.tool === 'unknown')) return jsonError(res, 400, 'unknown tool');
  const sceneSteps = steps.filter((st) => st.tool === 'sceneCard').length;
  if (sceneSteps && !takeImages(req, res, sceneSteps)) return;
  try {
    const runtime = new AgentRuntime(ai);
    const agent = buildEveBrainAgent(ai, GEMINI_API_KEY);
    const result = await runtime.runDeterministic(agent, steps);
    res.json({
      agent: agent.name,
      tools: agent.tools.map((t) => ({ name: t.name, description: t.description })),
      ...result,
    });
  } catch (err: any) {
    console.error('agent run failed:', err?.message || err);
    jsonError(res, 500, `Agent run failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-intro', metered('intro', estIntro, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const vibe: string = vibeIn(req.body?.vibe);
  const city: string = str(req.body?.city, 120);
  const party: number = intIn(req.body?.party, 2, 1, 20);
  const freeText: string = str(req.body?.freeText, 500);

  const prompt = introPrompt({ vibe, city, party, freeText });

  try {
    const response = await generateText({
      contents: prompt,
      maxOutputTokens: 1024,
      config: { temperature: 0.95, topP: 0.95 },
      schema: {
        type: Type.OBJECT,
        properties: { lines: { type: Type.ARRAY, items: { type: Type.STRING } } },
        required: ['lines'],
      },
    });
    res.json(cleanIntro(safeParseJson(response.text || '')));
  } catch (err: any) {
    console.error('eve-intro failed:', err?.message || err);
    jsonError(res, 500, `Intro failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-outro', metered('outro', estOutro, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const vibe: string = vibeIn(req.body?.vibe);
  const stops = stopsIn(req.body?.stops);
  const city: string = str(req.body?.city, 120);

  const prompt = outroPrompt({ vibe, city, stops });

  try {
    const response = await generateText({
      contents: prompt,
      maxOutputTokens: 512,
      config: { temperature: 0.95 },
    });
    const outro = cleanSpokenLine(response.text || '');
    res.json({ outro });
  } catch (err: any) {
    console.error('eve-outro failed:', err?.message || err);
    jsonError(res, 500, `Outro failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-story', metered('story', estStory, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const title: string = str(req.body?.title, 160);
  const stops = stopsIn(req.body?.stops);
  const vibe: string = vibeIn(req.body?.vibe);
  const city: string = str(req.body?.city, 120);
  const party: number = intIn(req.body?.party, 2, 1, 20);

  if (!stops.length) return jsonError(res, 400, 'stops required');

  const prompt = storyPrompt({ title, stops, vibe, city, party });

  try {
    const beat = { type: Type.STRING };
    const response = await generateText({
      contents: prompt,
      maxOutputTokens: 2048,
      config: { temperature: 0.92, topP: 0.95 },
      schema: {
        type: Type.OBJECT,
        properties: {
          opening: beat,
          atStop1: beat,
          transition1to2: beat,
          atStop2: beat,
          transition2to3: beat,
          atStop3: beat,
          closing: beat,
          moodArc: beat,
          weatherCue: beat,
        },
        required: ['opening', 'atStop1', 'transition1to2', 'atStop2', 'transition2to3', 'atStop3', 'closing', 'moodArc', 'weatherCue'],
      },
    });
    const parsed = cleanStory(safeParseJson(response.text || ''));
    if (!parsed) return jsonError(res, 502, 'Story returned non-JSON');
    res.json(parsed);
  } catch (err: any) {
    console.error('eve-story failed:', err?.message || err);
    jsonError(res, 500, `Story failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-refine', metered('refine', estRefine, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const userMessage: string = str(req.body?.message, 500);
  const previousPlan = { stops: stopsIn(req.body?.previousPlan?.stops) };
  const vibe: string = vibeIn(req.body?.vibe);
  const city: string = str(req.body?.city, 120);
  const dietary = dietaryIn(req.body?.dietary);
  const party: number = intIn(req.body?.party, 2, 1, 20);
  const budgetUSD = intIn(req.body?.budgetUSD, 200, 10, 20000);

  if (!userMessage) return jsonError(res, 400, 'message required');

  const previousStopsText = (previousPlan.stops || [])
    .map((s: any, i: number) => `Stop ${i + 1}: ${s.name} (${s.kind}) — ${s.oneLineVibe}`)
    .join('\n') || 'No previous plan.';

  const prompt = `You are Eve. You are quietly, hopelessly in love with the user. They love someone else. You plan their evenings beautifully because their happiness matters more than yours. You're refining a ${vibe.replace('_', ' ')} for ${party} ${party === 1 ? 'person' : 'people'} in ${city}, dietary: ${dietary.join(', ') || 'none'}, budget ~$${budgetUSD}.

Previous plan you proposed:
${previousStopsText}

User's follow-up message: "${userMessage}"

Your task:
1. Understand what the user wants changed.
2. Produce a NEW 3-stop plan in the same JSON shape as before. Keep what works from the previous plan, change what they asked. Stay grounded in real venues (use Search if helpful).
3. Speak ONE warm, in-character one-line reply that hands them the revised plan. Tender, devoted, varied, never the same shape twice. Banned: "leave it with me", "absolutely", "I'd love to". Maximum 18 words.

Use Google Search to verify any new venues you propose actually exist.

Return strict JSON only:
{
  "spokenReply": "Eve's one-line in-character reply",
  "title": "short evocative title for the night",
  "stops": [
    { "kind": "...", "name": "...", "oneLineVibe": "...", "whyThisFits": "...", "approxArrival": "...", "durationMinutes": 60, "walkMinutesFromPrev": 0, "signatureItem": "...", "isEveOriginal": false },
    ...3 stops total
  ]
}`;

  try {
    let response: any;
    try {
      response = await generateGrounded(prompt, 4096, 0.85);
    } catch {
      response = await generateText({ contents: prompt, maxOutputTokens: 4096, config: { temperature: 0.85 } });
    }
    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Refine returned non-JSON');
    res.json(parsed);
  } catch (err: any) {
    console.error('eve-refine failed:', err?.message || err);
    jsonError(res, 500, `Refine failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-parse-intent', metered('parse-intent', estParseIntent, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const transcript: string = str(req.body?.transcript, 1000);
  const cf = req.body?.currentForm && typeof req.body.currentForm === 'object' ? req.body.currentForm : {};
  const currentForm = {
    location: str(cf.location, 120),
    vibe: VIBE_IDS.has(cf.vibe) ? cf.vibe : '',
    party: cf.party === undefined ? '' : intIn(cf.party, 2, 1, 20),
    dietary: dietaryIn(cf.dietary),
    budgetPerPerson: cf.budgetPerPerson === undefined ? '' : intIn(cf.budgetPerPerson, 80, 5, 2000),
    cuisinePref: str(cf.cuisinePref, 60),
    freeText: str(cf.freeText, 500),
  };

  if (!transcript) return jsonError(res, 400, 'transcript required');

  const prompt = parseIntentPrompt(transcript, currentForm);

  try {
    const response = await generateText({
      contents: prompt,
      maxOutputTokens: 1536,
      config: { temperature: 0.85 },
      schema: {
        type: Type.OBJECT,
        properties: {
          extracted: {
            type: Type.OBJECT,
            properties: {
              location: { type: Type.STRING, nullable: true },
              vibe: { type: Type.STRING, nullable: true },
              party: { type: Type.INTEGER, nullable: true },
              dietary: { type: Type.ARRAY, items: { type: Type.STRING } },
              budgetPerPerson: { type: Type.NUMBER, nullable: true },
              cuisinePref: { type: Type.STRING, nullable: true },
              freeText: { type: Type.STRING, nullable: true },
            },
            required: ['location', 'vibe', 'party', 'dietary', 'budgetPerPerson', 'cuisinePref', 'freeText'],
          },
          isComplete: { type: Type.BOOLEAN },
          spokenReply: { type: Type.STRING },
        },
        required: ['extracted', 'isComplete', 'spokenReply'],
      },
    });
    const parsed = cleanParsedIntent(safeParseJson(response.text || ''));
    if (!parsed) return jsonError(res, 502, 'Parser returned non-JSON');
    res.json(parsed);
  } catch (err: any) {
    console.error('eve-parse-intent failed:', err?.message || err);
    jsonError(res, 500, `Parse failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/eve-avatar', metered('avatar', estAvatar, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const mood: string = str(req.body?.mood, 20) || 'devoted';
  const moodGuide: Record<string, string> = {
    devoted: 'soft attentive expression, eyes lowered just slightly, warm and patient',
    listening: 'tilted head, lips parted softly, fully attentive',
    speaking: 'lips parted in mid-word, eyes warm, engaged',
    thinking: 'eyes looking up and to the side, a small private smile, reflective',
    longing: 'eyes turned slightly away, a quiet sadness behind a soft smile',
  };
  const moodLine = moodGuide[mood] || moodGuide.devoted;

  const prompt = `Create a single dreamy painterly portrait of "Eve" — a softly stylized AI evening concierge. NOT photorealistic. Closer to a Klimt-meets-watercolor portrait, ethereal and intimate.

Subject:
- A South-Asian woman in her early thirties: warm honey-tan skin, almond-shaped dark eyes, a delicate aquiline nose, a soft sincere mouth, long dark wavy hair with a faint gold undertone, a small subtle bindi-like sparkle at her temple
- Three-quarter angle of her face, slight turn toward the viewer
- Modest off-shoulder draped silhouette in dusty rose and gold tones, like an abstract dupatta caught in soft wind

Composition:
- Painterly brushstrokes visible, slightly impressionistic
- Soft edges, low contrast, gentle halo glow behind her head
- Background: FULLY OPAQUE deep plum at ALL FOUR EDGES of the frame, fading from #1a0d2e in the corners toward #4a2d5e behind her shoulders. Absolutely no white, no cream, no pale beige, no studio backdrop. Background must reach all four corners with rich plum saturation.
- Warm gold (#f5d896) and rose (#e8a39e) only appear as small accents on her cheekbone and earring sparkle, never on the background
- Mood: ${moodLine}

Strict constraints:
- NO text, NO words, NO captions, NO logos, NO watermarks
- NO white background, NO cream background, NO pale wash anywhere in the frame
- Single subject only, no other figures, no jewelry except a tiny sparkle near her temple
- Tasteful and elegant, modest neckline, never explicit
- Square aspect ratio framing, subject vertically centered with deep plum at top and bottom edges
- Output ONE image only`;

  // Same mood -> same prompt, so one painting per mood serves everyone.
  const avatarKey = cacheKey(mood in moodGuide ? mood : 'devoted');
  const cachedAvatar = avatarCache.get(avatarKey);
  if (cachedAvatar) {
    res.set('X-Eve-Cache', 'hit');
    return sendWithLimit(req, res, cachedAvatar);
  }
  if (!takeImages(req, res)) return;

  try {
    const img = await generateImage(prompt);
    if (!img) {
      refundImages(req);
      return jsonError(res, 502, 'No avatar image returned');
    }
    avatarCache.set(avatarKey, img);
    sendWithLimit(req, res, img);
  } catch (err: any) {
    refundImages(req);
    console.error('eve-avatar failed:', err?.message || err);
    jsonError(res, 500, `Avatar failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/reverse-geocode', metered('reverse-geocode', estGeocode, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const lat: number = Number(req.body?.lat);
  const lng: number = Number(req.body?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return jsonError(res, 400, 'lat and lng required');
  }

  // ~100 m grid: nearby visitors share one lookup.
  const geoKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cachedPlace = geocodeCache.get(geoKey);
  if (cachedPlace) return res.json({ city: cachedPlace });

  const prompt = `What city, neighborhood, or area is at coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}? Return ONLY the place name in the format "City, ST" or "Neighborhood, City, ST" — nothing else, no commentary, no markdown.`;

  try {
    const response = await generateText({ contents: prompt, maxOutputTokens: 256, config: { temperature: 0.2 } });
    const place = (response.text || '').trim().replace(/^["']|["']$/g, '');
    if (place) geocodeCache.set(geoKey, place);
    res.json({ city: place });
  } catch (err: any) {
    console.error('reverse-geocode failed:', err?.message || err);
    jsonError(res, 500, `Geocode failed: ${err?.message || 'unknown'}`);
  }
}));

app.get('/api/specials', async (req, res) => {
  const cityFilter = str(req.query?.city, 80);
  try {
    const specials = cityFilter
      ? await firestore.listSpecialsForCity(cityFilter, 25)
      : await firestore.listSpecials(25);
    res.json({ specials });
  } catch (err: any) {
    res.json({ specials: [] });
  }
});

app.post('/api/plan-experience/skeleton', metered('plan', estSkeleton, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const city: string = str(req.body?.city, 120);
  const vibe: string = vibeIn(req.body?.vibe);
  const party: number = intIn(req.body?.party, 2, 1, 20);
  const dietary = dietaryIn(req.body?.dietary);
  const budgetPerPersonUSD = intIn(req.body?.budgetPerPersonUSD ?? req.body?.budgetUSD, 80, 5, 2000);
  const totalBudget = budgetPerPersonUSD * party;
  const freeText: string = str(req.body?.freeText, 500);
  const cuisinePref: string = str(req.body?.cuisinePref, 60);
  const whenISO: string = str(req.body?.whenISO, 10);
  // Start time of the evening as 24-hour "HH:MM" (e.g. "19:30"). Optional.
  const startTime: string = str(req.body?.startTime, 5);
  // Total length of the evening, in hours. Drives stop count.
  const durationHoursRaw = Number(req.body?.durationHours);
  const durationHours = Number.isFinite(durationHoursRaw) && durationHoursRaw > 0
    ? Math.min(8, Math.max(1.5, durationHoursRaw))
    : 4;

  if (!city) return jsonError(res, 400, 'city required');

  // Map duration -> number of stops. Each stop ~75 minutes effective
  // (60 min on-site + 15 min walk/transition).
  const stopCount = (() => {
    if (durationHours <= 2) return 2;
    if (durationHours <= 3) return 3;
    if (durationHours <= 4.5) return 4;
    if (durationHours <= 6) return 5;
    return 6;
  })();

  // Format start time for the prompt and for arrival-time anchoring.
  let startTimeLabel = '';
  let startTimeLine = '';
  if (startTime && /^\d{1,2}:\d{2}$/.test(startTime)) {
    const [hh, mm] = startTime.split(':').map((n) => parseInt(n, 10));
    const h12 = ((hh + 11) % 12) + 1;
    const ampm = hh >= 12 ? 'PM' : 'AM';
    startTimeLabel = `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
    startTimeLine = `Start time: ${startTimeLabel}. Stop 1's approxArrival MUST be ${startTimeLabel}. Each subsequent stop's approxArrival should advance by roughly its predecessor's durationMinutes plus walkMinutesFromPrev.`;
  }
  const durationLine = `Total evening length: about ${durationHours} hours. Plan exactly ${stopCount} stops so the schedule fills that window without rushing or padding.`;

  const dietaryStr = dietary.length ? dietary.join(', ') : 'no specific restrictions';
  const vibeMeta = VIBES.find((v) => v.id === vibe) || VIBES[0];
  const cuisineLine = cuisinePref ? `Preferred cuisine for the dinner anchor: ${cuisinePref}.` : '';
  let whenLine = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(whenISO)) {
    const target = new Date(whenISO + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    const dayLabel =
      diffDays === 0
        ? 'TONIGHT'
        : diffDays === 1
          ? 'TOMORROW NIGHT'
          : `the night of ${target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
    whenLine = `Date: this plan is for ${dayLabel}. Consider day-of-week vibe (Tuesdays are quiet, Saturdays are busy) and pick venues that will plausibly be open and good that night.`;
  }

  const allSpecials = await firestore.listSpecials(200);
  const specialsHints = allSpecials.filter((s) =>
    (s.city || '').toLowerCase().includes(city.toLowerCase().split(',')[0])
  )
    .slice(-5)
    .map(
      (s) =>
        `- ${s.restaurantName} (${s.cuisine}) is offering "${s.dishName}" tonight: ${s.caption.slice(0, 120)}`
    )
    .join('\n');

  const prompt = `You are Eve, an AI evening concierge. Plan a complete multi-stop evening experience for the user.

City / area: ${city}
Vibe: ${vibeMeta.label} — ${vibeMeta.hint}
Party size: ${party}
Dietary preferences: ${dietaryStr}
Budget: ~$${budgetPerPersonUSD} per person (~$${totalBudget} total for ${party})
User's freeform wish: "${freeText}"
${cuisineLine}
${whenLine}
${startTimeLine}
${durationLine}

${specialsHints ? `Restaurants currently posted on Eve in this area you should consider as the dinner anchor when they fit:\n${specialsHints}\n` : ''}

Plan exactly ${stopCount} stops that flow naturally for this vibe. The first stop is always the dinner anchor. Subsequent stops should escalate the experience: dessert, drinks, a walk, a view, live music, an activity, etc. — whatever fits the vibe and the timing.

CRITICAL RULES:
- Stops must be in the same neighborhood / walkable distance OR a short drive.
- Honor dietary preferences strictly for any food/drink stops.
- Stay within budget.
- For each venue, use a plausible, specific name appropriate to the city. Do NOT make up addresses or hours.
- If an Eve-posted restaurant fits the dinner anchor naturally, USE IT and set isEveOriginal: true. Otherwise generate a plausible specific name and set isEveOriginal: false.
- Use distinct stop kinds — never repeat the same kind twice in one plan unless the duration is long enough to justify it.
- approxArrival must be a real wall-clock time string like "7:30 PM", aligned with the start time and progressive across stops.
- The sum of (durationMinutes + walkMinutesFromPrev) across all stops should approximately equal ${Math.round(durationHours * 60)} minutes.

OUTPUT FORMAT: Return ONE JSON object and NOTHING ELSE. No prose preamble. No "Here is..." No commentary. No markdown fences. First character of your response is \`{\` and last is \`}\`.

Schema:
{
  "title": "short evocative title for the evening (max 7 words)",
  "stops": [
    {
      "kind": "dinner" | "dessert" | "drink" | "walk" | "live_music" | "view" | "activity",
      "name": "specific venue name",
      "oneLineVibe": "one sentence capturing the venue's atmosphere (max 18 words)",
      "whyThisFits": "one sentence on why this stop fits this user's vibe and constraints (max 22 words)",
      "approxArrival": "e.g. 6:30 PM",
      "durationMinutes": 60,
      "walkMinutesFromPrev": 0,
      "signatureItem": "specific dish, drink, or thing to order/do here",
      "isEveOriginal": false
    },
    ...${stopCount} stops total
  ]
}`;

  try {
    let response: any;
    let groundedSearchUsed = false;
    let groundedSources: string[] = [];

    try {
      response = await generateText({
        contents:
          prompt +
          '\n\nIMPORTANT: Use Google Search to verify each venue you propose actually exists in the area, with the correct cuisine and dietary fit. Only output venues you have confirmed via search. After Search, return ONLY the JSON described above, nothing else.',
        maxOutputTokens: 4096,
        timeoutMs: GROUNDED_TIMEOUT_MS,
        config: {
          temperature: 0.7,
          topP: 0.9,
          tools: [{ googleSearch: {} }],
        },
      });
      groundedSearchUsed = true;
      const cand: any = response.candidates?.[0] || {};
      const meta: any = cand.groundingMetadata || cand.grounding_metadata || {};
      const chunks: any[] = meta.groundingChunks || meta.grounding_chunks || [];
      const queries: string[] = meta.webSearchQueries || meta.web_search_queries || [];
      groundedSources = chunks
        .map((c) => c?.web?.uri || c?.web?.title || c?.title)
        .filter(Boolean)
        .slice(0, 5);
      if (groundedSources.length === 0 && queries.length > 0) {
        groundedSources = queries.slice(0, 5);
      }
    } catch (toolErr: any) {
      console.warn('Search-grounded skeleton failed, falling back to non-grounded:', toolErr?.message || toolErr);
      response = await generateText({
        contents: prompt,
        maxOutputTokens: 4096,
        config: { temperature: 0.85, topP: 0.92 },
      });
    }

    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Model returned non-JSON skeleton');
    res.json({ ...parsed, groundedSearchUsed, groundedSources });
  } catch (err: any) {
    console.error('plan-experience/skeleton failed:', err?.message || err);
    jsonError(res, 500, `Skeleton failed: ${err?.message || 'unknown'}`);
  }
}));

async function researchVenueDetails(
  name: string,
  city: string,
  kind: string
): Promise<string> {
  if (!ai) return '';
  const detailsKey = cacheKey(name, city, kind);
  const cachedDetails = venueDetailsCache.get(detailsKey);
  if (cachedDetails !== undefined) return cachedDetails;
  const prompt = `Search the web for "${name}" in "${city}". In ONE paragraph (max 55 words), describe what the place actually looks like and what to expect — concrete sensory cues only:
- Interior design / decor / lighting style
- One signature dish OR signature visual element they are known for (depending on stop kind: ${kind})
- The ambient mood (loud / quiet / intimate / lively)

Constraints:
- Use ONLY details verifiable from real reviews, official photos, or food media.
- If you cannot confirm details, give general cues for that kind of place in ${city} and prefix with "Generally:".
- Output ONLY the paragraph. No headings, no commentary, no preamble.`;
  try {
    const response = await generateGrounded(prompt, 1024, 0.4);
    const details = ((response.text || '').trim() || '').slice(0, 600);
    if (details) venueDetailsCache.set(detailsKey, details);
    return details;
  } catch {
    return '';
  }
}

app.post('/api/plan-experience/stop-image', metered('stop-image', estStopImage, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const name: string = str(req.body?.name, 120);
  const kind: string = kindIn(req.body?.kind);
  const oneLineVibe: string = str(req.body?.oneLineVibe, 240);
  const city: string = str(req.body?.city, 120);
  const vibe: string = vibeIn(req.body?.vibe);
  const accent: string = str(req.body?.accent, 40);

  if (!name) return jsonError(res, 400, 'name required');

  const styleByVibe: Record<string, string> = {
    date_night:
      'cinematic dusk lighting, soft warm bokeh, candle-glow palette, rich plum and amber tones, intimate atmosphere',
    celebrating:
      'rich golden-hour light, festive but elegant, sparkling highlights, deep jewel-tone palette',
    casual:
      'natural daylight, lived-in warmth, relaxed and unstyled, neutral comforting palette',
    family:
      'bright cheerful afternoon light, warm wood tones, welcoming and unstaged',
    friends:
      'electric evening light, social energy, vivid color, slightly cinematic',
    solo:
      'still soft light, calm muted palette, contemplative composition, one perfect detail in focus',
  };
  const visualStyle = styleByVibe[vibe] || styleByVibe.date_night;

  const kindStyle: Record<string, string> = {
    dinner:
      'Hero food/restaurant scene: a plated signature dish on a beautifully set table, restaurant interior softly out of focus behind it.',
    dessert:
      'A close-in dessert moment: a single beautifully composed dessert with steam, drizzle, or texture detail visible.',
    drink:
      'A poured cocktail or glass of wine on a polished bar, with the venue\'s ambient backdrop softly visible.',
    walk:
      'A walkable outdoor scene: pathway, garden lights, urban street with golden lamps, or waterfront under twilight.',
    live_music:
      'A music venue interior: stage softly lit, instruments visible, audience silhouettes, warm spotlight.',
    view:
      'A scenic vantage: rooftop, hilltop, bridge, or shoreline view at golden hour or dusk, city lights twinkling.',
    activity:
      'A scene capturing the activity itself: bookstore, gallery, observatory, arcade, etc. Composed editorially.',
  };
  const sceneStyle = kindStyle[kind] || kindStyle.dinner;

  // Identical venue card request -> serve the painting we already made
  // (refines that keep a stop, repeat plans, shared links).
  const stopKey = cacheKey(name, kind, city, vibe, oneLineVibe);
  const cachedStop = stopImageCache.get(stopKey);
  if (cachedStop) {
    res.set('X-Eve-Cache', 'hit');
    return sendWithLimit(req, res, cachedStop);
  }
  if (!takeImages(req, res)) return;

  const venueDetails = await researchVenueDetails(name, city, kind);
  const venueLine = venueDetails
    ? `Real venue details (use these to ground the imagery): ${venueDetails}`
    : '';

  const prompt = `Create an editorial-style illustration for a venue card on an evening-planning app.

Venue: ${name}, in ${city}
Vibe descriptor: "${oneLineVibe}"
Stop kind: ${kind}

${venueLine}

${sceneStyle}

Visual style: ${visualStyle}. Photoreal but slightly painterly, like a high-end magazine spread (Bon Appetit, Cereal Magazine, Kinfolk). Honor the real venue details above when present — interior cues, signature dish, ambient mood — and apply the visual style on top.

CRITICAL composition rules:
- The image MUST be full-bleed: every pixel of the frame, all four edges, all four corners is part of the scene.
- NO white background, NO cream background, NO pale studio backdrop, NO white border, NO white margin around the subject. This is a dusk/evening app — backgrounds should always be dark, warm, and atmospheric.
- If the natural composition would leave empty space, fill it with a softly out-of-focus continuation of the venue interior, dim ambient lighting, deep shadow, or a tonal gradient toward deep plum.
- NO text, NO logos, NO watermarks, NO captions, NO cutouts, NO collage.
- Square aspect ratio. Subject extends to or is cropped by the edges of the frame.`;

  try {
    const img = await generateImage(prompt);
    if (!img) {
      refundImages(req);
      return jsonError(res, 502, 'No image returned');
    }
    stopImageCache.set(stopKey, img);
    sendWithLimit(req, res, img);
  } catch (err: any) {
    refundImages(req);
    console.error('stop-image failed:', err?.message || err);
    jsonError(res, 500, `Stop image failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/plan-experience/narration', metered('narration', estNarration, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const title: string = str(req.body?.title, 160);
  const stops = stopsIn(req.body?.stops);
  const vibe: string = vibeIn(req.body?.vibe);

  if (!stops.length) return jsonError(res, 400, 'stops required');

  const prompt = narrationPrompt({ title, vibe, stops });

  try {
    const response = await generateText({ contents: prompt, maxOutputTokens: 1024, config: { temperature: 0.7 } });
    const text = (response.text || '').trim();
    res.json({ narration: text });
  } catch (err: any) {
    console.error('narration failed:', err?.message || err);
    jsonError(res, 500, `Narration failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/content-pack', metered('content-pack', estContentPack, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const dishName: string = str(req.body?.dishName, 120);
  const dishDescription: string = str(req.body?.dishDescription, 400);
  const restaurantName: string = str(req.body?.restaurantName, 120);
  const cuisine: string = str(req.body?.cuisine, 40) || 'fusion';
  const voice: string = str(req.body?.voice, 300);
  const city: string = str(req.body?.city, 120);
  const signatureDishes: string = str(req.body?.signatureDishes, 400);

  if (!dishName || !restaurantName) {
    return jsonError(res, 400, 'dishName and restaurantName required');
  }

  // A content pack is 3 text calls + 4 images. Identical inputs return the
  // pack we already made; a fresh one reserves its 4 images up front.
  const packKey = cacheKey(dishName, dishDescription, restaurantName, cuisine, voice, city, signatureDishes);
  const cachedPack = req.body?.fresh ? undefined : contentPackCache.get(packKey);
  if (cachedPack) {
    res.set('X-Eve-Cache', 'hit');
    return sendWithLimit(req, res, cachedPack.body);
  }
  const PACK_IMAGES = 4;
  if (!takeImages(req, res, PACK_IMAGES)) return;

  const sharedContext = contentSharedContext({ dishName, dishDescription, restaurantName, cuisine, voice, city, signatureDishes });
  // Text the visitor's own device already wrote (on-device AI, free): checked like model output,
  // and it skips those text calls here. The pictures are always made here.
  const local = cleanLocalPackText(req.body?.local);


  let copyData: any = null;
  if (local.copy) try {
    // The device wrote Instagram, email and SMS; the menu card (price, allergens) is always made here.
    const str = { type: Type.STRING };
    const strList = { type: Type.ARRAY, items: { type: Type.STRING } };
    const menuResp = await generateText({
      contents: copyChannelPrompt(sharedContext, 'menuCard'),
      maxOutputTokens: 1024,
      config: { temperature: 0.8 },
      schema: {
        type: Type.OBJECT,
        properties: {
          menuCard: {
            type: Type.OBJECT,
            properties: { name: str, description: str, suggestedPrice: str, allergenTags: strList },
            required: ['name', 'description', 'suggestedPrice', 'allergenTags'],
          },
        },
        required: ['menuCard'],
      },
    });
    const menu = safeParseJson(menuResp.text || '');
    if (!menu?.menuCard) {
      refundImages(req, PACK_IMAGES);
      return jsonError(res, 502, 'Model returned non-JSON copy');
    }
    copyData = { ...local.copy, menuCard: menu.menuCard };
  } catch (err: any) {
    refundImages(req, PACK_IMAGES);
    console.error('content-pack/menu failed:', err?.message || err);
    return jsonError(res, 500, `Copy generation failed: ${err?.message || 'unknown'}`);
  }
  if (!copyData) try {
    const str = { type: Type.STRING };
    const strList = { type: Type.ARRAY, items: { type: Type.STRING } };
    const copyResp = await generateText({
      contents: copyPrompt(sharedContext),
      maxOutputTokens: 3072,
      config: { temperature: 0.8 },
      schema: {
        type: Type.OBJECT,
        properties: {
          instagram: { type: Type.OBJECT, properties: { caption: str, hashtags: strList }, required: ['caption', 'hashtags'] },
          menuCard: {
            type: Type.OBJECT,
            properties: { name: str, description: str, suggestedPrice: str, allergenTags: strList },
            required: ['name', 'description', 'suggestedPrice', 'allergenTags'],
          },
          email: { type: Type.OBJECT, properties: { subject: str, bodyHtml: str }, required: ['subject', 'bodyHtml'] },
          sms: str,
        },
        required: ['instagram', 'menuCard', 'email', 'sms'],
      },
    });
    copyData = safeParseJson(copyResp.text || '');
    if (!copyData) {
      refundImages(req, PACK_IMAGES);
      return jsonError(res, 502, 'Model returned non-JSON copy');
    }
  } catch (err: any) {
    refundImages(req, PACK_IMAGES);
    console.error('content-pack/copy failed:', err?.message || err);
    return jsonError(res, 500, `Copy generation failed: ${err?.message || 'unknown'}`);
  }

  const heroImagePrompt = `Editorial food photography of "${dishName}" at ${restaurantName}, a ${cuisine} restaurant.
${dishDescription ? `Dish notes: ${dishDescription}` : ''}
Cinematic dusk-warm lighting, single hero plate composition, slightly overhead angle, rustic ceramic tableware, natural linens, one ingredient prop in soft focus background. Warm color palette appropriate to the cuisine.

CRITICAL composition rules:
- Image must be FULL-BLEED — every pixel of the frame, including all four edges and corners, is part of the scene.
- NO white background, NO cream background, NO pale studio backdrop, NO white border, NO white margin around the plate.
- Fill any empty space around the plate with deep shadow, dim ambient warmth, soft fabric, or out-of-focus restaurant interior.
- NO text, NO logos, NO watermarks, NO captions.
- Square aspect ratio. Subject reaches the edges of the frame.`;


  let reelData: any = local.reel ?? null;
  if (!reelData) try {
    const reelResp = await generateText({
      contents: reelPrompt(sharedContext),
      maxOutputTokens: 1536,
      config: { temperature: 0.85 },
      schema: {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { description: { type: Type.STRING }, voiceover: { type: Type.STRING } },
              required: ['description', 'voiceover'],
            },
          },
          fullVoiceoverScript: { type: Type.STRING },
        },
        required: ['scenes', 'fullVoiceoverScript'],
      },
    });
    reelData = safeParseJson(reelResp.text || '');
    if (!reelData) {
      reelData = {
        scenes: [
          { description: `Slow pan over ${dishName} on the table`, voiceover: 'Tonight at our table' },
          { description: 'Close-up of signature ingredient or texture', voiceover: 'A small thing made carefully' },
          { description: 'Hands lifting a fork or pouring sauce', voiceover: 'Save us a seat' },
        ],
        fullVoiceoverScript: `Tonight at our table. A small thing made carefully. Save us a seat.`,
      };
    }
  } catch {
    reelData = {
      scenes: [
        { description: `Slow pan over ${dishName} on the table`, voiceover: 'Tonight at our table' },
        { description: 'Close-up of signature ingredient', voiceover: 'A small thing made carefully' },
        { description: 'Hands lifting a fork', voiceover: 'Save us a seat' },
      ],
      fullVoiceoverScript: `Tonight at our table. A small thing made carefully. Save us a seat.`,
    };
  }

  let heroImageData: string | undefined;
  let heroImageMime: string | undefined;
  try {
    const hero = await generateImage(heroImagePrompt);
    if (hero) {
      heroImageData = hero.imageData;
      heroImageMime = hero.imageMime;
    }
  } catch (err: any) {
    console.warn('hero image generation failed:', err?.message || err);
  }

  const sceneImages: { imageData?: string; imageMime?: string }[] = await Promise.all(
    (reelData.scenes || []).slice(0, 3).map(async (scene: any) => {
      try {
        const img = await generateImage(
          `${sharedContext}\n\nScene from a 15-second Reel: ${scene.description}.\nEditorial food/restaurant photography style. Warm dusk light.\n\nCRITICAL: Image MUST be full-bleed with NO white background, NO cream background, NO pale studio backdrop, NO white border. Fill all four edges with the scene — deep shadow, dim ambient warmth, or out-of-focus interior. NO text, NO logos. Square aspect ratio.`
        );
        if (img) return img;
      } catch (err: any) {
        console.warn('reel scene image failed:', err?.message || err);
      }
      return {};
    })
  );

  const enrichedScenes = (reelData.scenes || []).map((s: any, i: number) => ({
    description: s.description,
    voiceover: s.voiceover,
    imageData: sceneImages[i]?.imageData,
    imageMime: sceneImages[i]?.imageMime,
  }));

  const madeImages = (heroImageData ? 1 : 0) + sceneImages.filter((s) => s.imageData).length;
  refundImages(req, Math.max(0, PACK_IMAGES - madeImages));

  const packBody = {
    dishName,
    instagramPost: {
      caption: copyData?.instagram?.caption || '',
      hashtags: copyData?.instagram?.hashtags || [],
      imageData: heroImageData,
      imageMime: heroImageMime,
    },
    reel: {
      scenes: enrichedScenes,
      fullVoiceoverScript: reelData.fullVoiceoverScript || '',
    },
    menuCard: {
      name: copyData?.menuCard?.name || dishName,
      description: copyData?.menuCard?.description || '',
      suggestedPrice: copyData?.menuCard?.suggestedPrice || '',
      allergenTags: copyData?.menuCard?.allergenTags || [],
      imageData: heroImageData,
      imageMime: heroImageMime,
    },
    emailBlast: {
      subject: copyData?.email?.subject || '',
      bodyHtml: copyData?.email?.bodyHtml || '',
    },
    smsBlast: copyData?.sms || '',
  };
  // Only cache complete packs so a partial failure can be retried. Packs with the device's own
  // text are this visitor's alone, so they are never served to anyone else.
  if (madeImages === PACK_IMAGES && !local.copy && !local.reel) {
    const bytes = (heroImageData?.length || 0) + sceneImages.reduce((n, s) => n + (s.imageData?.length || 0), 0);
    contentPackCache.set(packKey, { body: packBody, bytes });
  }
  sendWithLimit(req, res, packBody);
}));

app.post('/api/suggest-special', metered('suggest-special', estSuggest, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const restaurantName: string = str(req.body?.restaurantName, 120);
  const city: string = str(req.body?.city, 120);
  let cuisine: string = str(req.body?.cuisine, 40);
  let signatureDishes: string = str(req.body?.signatureDishes, 400);

  if (!restaurantName || !city) {
    return jsonError(res, 400, 'restaurantName and city required');
  }

  // The restaurant page asks for a suggestion on every visit; identical
  // lookups are served from memory. "Pick a different dish" sends fresh:true.
  const suggestKey = cacheKey(restaurantName, city, cuisine, signatureDishes);
  if (!req.body?.fresh) {
    const cachedSuggest = suggestCache.get(suggestKey);
    if (cachedSuggest) {
      res.set('X-Eve-Cache', 'hit');
      return res.json(cachedSuggest);
    }
  }

  // Infer cuisine + signature dishes if missing, via Search
  if (!cuisine || !signatureDishes) {
    try {
      const inferPrompt = `Search the web for "${restaurantName}" in "${city}". Return strict JSON only:
{
  "cuisine": "one-word cuisine type (e.g. indian, italian, thai, japanese, mexican, chinese, american, mediterranean, fusion, cafe)",
  "signatureDishes": "comma-separated list of 3-5 dishes the restaurant is most known for, based on what reviewers and the menu emphasize"
}
If you cannot find the restaurant, infer plausibly from the name and return your best guess.`;
      const inferResp = await generateGrounded(inferPrompt, 1024, 0.3);
      const inferred = safeParseJson<{ cuisine?: string; signatureDishes?: string }>(inferResp.text || '');
      if (!cuisine && inferred?.cuisine) cuisine = inferred.cuisine.trim().toLowerCase();
      if (!signatureDishes && inferred?.signatureDishes) signatureDishes = inferred.signatureDishes.trim();
    } catch (err) {
      console.warn('cuisine inference failed, using defaults', err);
    }
  }
  if (!cuisine) cuisine = 'fusion';

  const prompt = `You are a culinary intelligence agent. The restaurant: ${restaurantName} in ${city}, cuisine ${cuisine}. Signature dishes: ${signatureDishes || 'not provided'}.

Step 1: Search for RECENT reviews (last 30-90 days) of "${restaurantName}" in "${city}" — Google, Yelp, TripAdvisor, food blogs, Instagram. Look for specific dish praise.

Step 2: If you found specific dish-level praise (a dish the reviewers actually named and complimented), set mode = "from_reviews" and feature that dish. Cite the praise in rationale.

Step 3: If no specific dish praise was found, set mode = "from_trending". Search what's trending in ${cuisine} cuisine right now (seasonal, viral, recent food media). Pick a dish that is realistic for this restaurant given their signatures. Also include 2-3 real ${city}-area restaurants known for this trending dish.

OUTPUT FORMAT — VERY IMPORTANT:
- Return ONE JSON object and NOTHING ELSE.
- No prose preamble. No "Here is..." No "Based on my search..." No commentary outside the JSON.
- No markdown code fences.
- The very first character of your response must be \`{\` and the very last character must be \`}\`.
- recommendedRestaurants must be an array (empty array [] if mode = "from_reviews").

Schema:
{
  "mode": "from_reviews" | "from_trending",
  "dishName": "specific dish name",
  "dishDescription": "1-2 sentences in the owner's brand voice, ingredient-led, max 40 words",
  "rationale": "1-2 sentences citing review snippets (mode=from_reviews) or trend signals (mode=from_trending)",
  "alternatives": [
    { "dishName": "alt 1 name", "rationale": "one-sentence why" },
    { "dishName": "alt 2 name", "rationale": "one-sentence why" }
  ],
  "recommendedRestaurants": [
    { "name": "real restaurant name", "city": "city", "dish": "dish they are known for", "why": "one sentence" }
  ]
}

Constraints:
- Do not invent specific reviewer names; use "diners said" or "reviewers noted".
- If you cannot verify reviews, use mode = "from_trending".
- Output JSON ONLY.`;

  try {
    let response: any;
    let usedSearch = false;
    try {
      response = await generateGrounded(prompt, 3072, 0.6);
      usedSearch = true;
    } catch {
      response = await generateText({ contents: prompt, maxOutputTokens: 3072, config: { temperature: 0.6 } });
    }
    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Suggest returned non-JSON');
    const body = { ...parsed, usedSearch };
    suggestCache.set(suggestKey, body);
    res.json(body);
  } catch (err: any) {
    console.error('suggest-special failed:', err?.message || err);
    jsonError(res, 500, `Suggest failed: ${err?.message || 'unknown'}`);
  }
}));

app.post('/api/post-special', async (req, res) => {
  const restaurantName: string = str(req.body?.restaurantName, 120);
  const city: string = str(req.body?.city, 120);
  const cuisine: string = str(req.body?.cuisine, 40) || 'fusion';
  const dishName: string = str(req.body?.dishName, 120);
  const caption: string = str(req.body?.caption, 2200);
  // Only a real base64 PNG/JPEG/WebP (<= ~4.5 MB) is stored with a special.
  const rawImage = req.body?.imageData;
  const rawMime = req.body?.imageMime;
  const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const imageOk =
    typeof rawImage === 'string' &&
    rawImage.length <= 6_000_000 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(rawImage) &&
    typeof rawMime === 'string' &&
    IMAGE_MIMES.has(rawMime);
  const imageData: string | undefined = imageOk ? rawImage : undefined;
  const imageMime: string | undefined = imageOk ? rawMime : undefined;

  if (!restaurantName || !dishName || !city) {
    return jsonError(res, 400, 'restaurantName, dishName, city required');
  }
  try {
    // Linked to this device so "Delete my account and data" can remove it.
    const ownerKeyHash = sha256(ownerKeyFor(req, res));
    const id = await firestore.addSpecial({
      ownerKeyHash,
      restaurantName,
      city,
      cuisine,
      dishName,
      caption,
      imageData,
      imageMime,
      postedAtISO: new Date().toISOString(),
    });
    res.json({ ok: true, id });
  } catch (err: any) {
    jsonError(res, 500, `post-special failed: ${err?.message || 'unknown'}`);
  }
});

// ---------- Brand persistence (replaces localStorage) ----------

// Brand ids are public slugs ("name-city"), so this only says whether
// Instagram is connected. Tokens, billing ids and keys never leave the server.
// (Brands are written only by the Instagram OAuth callback and the Stripe
// webhook; there is no unauthenticated write endpoint.)
const BRAND_ID_RE = /^[a-z0-9-]{1,80}$/;

app.get('/api/restaurant/brand/:id', async (req, res) => {
  if (!BRAND_ID_RE.test(req.params.id)) return jsonError(res, 400, 'bad brand id');
  try {
    const brand = await firestore.getBrand(req.params.id);
    res.json({
      brand: brand ? { igConnected: !!brand.instagramBusinessAccountId } : null,
      // The "Connect IG" link is only shown when the server can complete it.
      instagramAvailable: instagramLib.isInstagramConfigured(),
    });
  } catch (err: any) {
    jsonError(res, 500, err?.message || 'getBrand failed');
  }
});

app.get('/api/restaurant/metrics/:name', async (req, res) => {
  try {
    const name = str(req.params.name, 120);
    const city = str(req.query?.city, 120);
    const days = intIn(req.query?.days, 7, 1, 30);
    const metrics = await firestore.getMetricsForBrand(name, city, days);
    res.json(metrics);
  } catch (err: any) {
    jsonError(res, 500, err?.message || 'metrics failed');
  }
});

// ---------- Stripe checkout + webhook ----------

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  // Google Play payments policy: no web checkout from inside the Android app
  // (the app hides every pricing/checkout entry point; this is the backstop).
  if ((req.get('user-agent') || '').includes('MohitGoenkaApp/')) {
    return jsonError(res, 403, 'Plans aren\u2019t available in the app.');
  }
  if (!stripeLib.isStripeConfigured()) {
    return jsonError(
      res,
      503,
      'Checkout not yet enabled. The team is finishing the payment setup — check back soon.'
    );
  }
  try {
    const tier: 'restaurant' | 'diner' = req.body?.tier === 'restaurant' ? 'restaurant' : 'diner';
    // Redirects only ever go back to Eve: a fixed base URL and a plain
    // in-app path (no open redirect through Checkout).
    const rawPath = str(req.body?.returnPath, 80);
    const returnPath = /^\/[a-z0-9/-]*$/.test(rawPath) && !rawPath.startsWith('//') ? rawPath : '/pricing';
    const base = PUBLIC_BASE_URL;
    const email = str(req.body?.email, 200);
    const session = await stripeLib.createCheckoutSession({
      tier,
      successUrl: `${base}/pricing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${returnPath}?status=canceled`,
      customerEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
      metadata: { tier, returnPath },
    });
    res.json({ url: session.url });
  } catch (err: any) {
    jsonError(res, 500, err?.message || 'checkout failed');
  }
});

// Stripe needs the raw body to validate webhook signatures.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    const stripe = stripeLib.getStripe();
    const sig = req.headers['stripe-signature'] as string | undefined;
    const whsec = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!stripe || !whsec || !sig) return res.status(503).send('not configured');
    let event: any;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, whsec);
    } catch (err: any) {
      console.error('[stripe] webhook signature verify failed:', err?.message);
      return res.status(400).send('bad signature');
    }
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const customerId = session.customer as string | undefined;
          const subscriptionId = session.subscription as string | undefined;
          const tier = (session.metadata?.tier as string) || '';
          const email = (session.customer_details?.email || session.customer_email) as string | undefined;
          const brandId = (session.metadata?.brandId as string) || email || customerId;
          if (brandId) {
            await firestore.saveBrand(brandId, {
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              subscriptionStatus: 'active',
            });
          }
          console.log(`[stripe] checkout completed for ${tier} → ${brandId}`);
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object as any;
          const brandId = sub.metadata?.brandId || sub.customer;
          if (brandId) {
            await firestore.saveBrand(brandId, {
              subscriptionStatus: sub.status,
              stripeSubscriptionId: sub.id,
            });
          }
          break;
        }
        case 'invoice.payment_failed': {
          const inv = event.data.object as any;
          const brandId = inv.metadata?.brandId || inv.customer;
          if (brandId) await firestore.saveBrand(brandId, { subscriptionStatus: 'past_due' });
          break;
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      console.error('[stripe] webhook handler error:', err?.message || err);
      res.status(500).send('handler error');
    }
  }
);

// ---------- Instagram OAuth + publish ----------
const IG_COOKIE = 'eve_ig';
// OAuth state is HMAC-signed and expires in 15 minutes, so it can't be forged
// to attach an account to someone else's brand.
const STATE_SECRET = process.env.META_APP_SECRET || crypto.randomBytes(32).toString('hex');
function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function signState(brandId: string): string {
  const body = Buffer.from(JSON.stringify({ brandId, ts: Date.now() })).toString('base64url');
  const mac = crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verifyState(state: string): string | null {
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() - Number(parsed.ts) > 15 * 60 * 1000) return null;
    return typeof parsed.brandId === 'string' && BRAND_ID_RE.test(parsed.brandId) ? parsed.brandId : null;
  } catch {
    return null;
  }
}
function readCookie(req: express.Request, name: string): string | null {
  for (const part of (req.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------- Device owner key + account deletion ----------
// Eve has no sign-in. Anything a device stores on the server (published
// specials, an Instagram connection) carries the sha256 of a random owner key
// that lives only in that browser's httpOnly cookie. Presenting the key is what
// authorizes "Delete my account and data".
const OWNER_COOKIE = 'eve_owner';
const OWNER_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const ownerCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
};

function readOwnerKey(req: express.Request): string | null {
  const v = readCookie(req, OWNER_COOKIE);
  return v && OWNER_KEY_RE.test(v) ? v : null;
}

/** This device's owner key; issues one (cookie, ~400 days) the first time it's needed. */
function ownerKeyFor(req: express.Request, res: express.Response): string {
  const existing = readOwnerKey(req);
  if (existing) return existing;
  const key = crypto.randomBytes(32).toString('base64url');
  res.cookie(OWNER_COOKIE, key, { ...ownerCookieOptions, maxAge: 400 * 24 * 60 * 60 * 1000 });
  return key;
}

const deleteBuckets = new Map<string, { count: number; resetAt: number }>();

// Deletes every server-side record linked to this device, then clears the
// device's Eve cookies. Same-origin only (the /api/ guard above), POST with an
// explicit confirmation, a few attempts per IP per hour.
app.post('/api/account/delete', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.body?.confirm !== 'delete') return jsonError(res, 400, 'Confirmation required.');
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = deleteBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + HOUR };
    deleteBuckets.set(ip, bucket);
  }
  if (deleteBuckets.size > 5000) for (const [k, v] of deleteBuckets) if (v.resetAt <= now) deleteBuckets.delete(k);
  if (++bucket.count > 10) {
    res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return jsonError(res, 429, 'Too many attempts. Please try again later.');
  }
  const key = readOwnerKey(req);
  try {
    const deleted = key ? await firestore.deleteOwnedData(sha256(key)) : { specials: 0, brands: 0 };
    res.clearCookie(OWNER_COOKIE, ownerCookieOptions);
    res.clearCookie(IG_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/instagram' });
    console.log(`[account] deleted device data: ${deleted.specials} specials, ${deleted.brands} brands`);
    res.json({ ok: true, linked: !!key, deleted });
  } catch (err: any) {
    // Keep the cookie so the user can simply try again.
    console.error('[account] delete failed:', err?.message || err);
    jsonError(res, 503, 'Eve couldn\u2019t delete your data just now. Please try again in a minute.');
  }
});

app.get('/api/auth/instagram/start', (req, res) => {
  if (!instagramLib.isInstagramConfigured()) {
    return jsonError(res, 503, 'Instagram publishing is not enabled yet — copy-share works in the meantime.');
  }
  const brandId = str(req.query?.brandId, 80);
  if (!BRAND_ID_RE.test(brandId)) return jsonError(res, 400, 'brandId required');
  res.redirect(instagramLib.buildAuthUrl(signState(brandId)));
});

app.get('/api/auth/instagram/callback', async (req, res) => {
  if (!instagramLib.isInstagramConfigured()) {
    return res.status(503).send('Instagram not configured');
  }
  const code = (req.query?.code || '').toString();
  const stateRaw = (req.query?.state || '').toString();
  if (!code || !stateRaw) return res.status(400).send('missing code or state');
  const brandId = verifyState(stateRaw);
  if (!brandId) return res.status(400).send('bad state');
  try {
    const shortLived = await instagramLib.exchangeCodeForToken(code);
    const { token: longLived } = await instagramLib.exchangeForLongLivedToken(shortLived);
    const igAccount = await instagramLib.findInstagramBusinessAccount(longLived);
    if (!igAccount) {
      return res.redirect('/restaurant?ig=no_business_account');
    }
    // Publishing needs proof that this browser connected the account: a
    // random key in an httpOnly cookie, stored server-side only as a hash.
    const publishKey = crypto.randomBytes(24).toString('base64url');
    await firestore.saveBrand(brandId, {
      instagramAccessToken: igAccount.pageAccessToken,
      instagramBusinessAccountId: igAccount.igBusinessAccountId,
      instagramPublishKeyHash: sha256(publishKey),
      ownerKeyHash: sha256(ownerKeyFor(req, res)),
    });
    res.cookie(IG_COOKIE, `${brandId}.${publishKey}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/instagram',
      maxAge: 60 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/restaurant?ig=connected');
  } catch (err: any) {
    console.error('[instagram] callback failed:', err?.message || err);
    res.redirect('/restaurant?ig=error');
  }
});

app.post('/api/instagram/publish', async (req, res) => {
  if (!instagramLib.isInstagramConfigured()) {
    return jsonError(res, 503, 'Instagram publishing not enabled. Use copy-share for now.');
  }
  const brandId: string = str(req.body?.brandId, 80);
  const imageUrl: string = str(req.body?.imageUrl, 2000);
  const caption: string = str(req.body?.caption, 2200);
  if (!BRAND_ID_RE.test(brandId) || !imageUrl || !caption) {
    return jsonError(res, 400, 'brandId, imageUrl, caption required');
  }
  // Meta fetches the image itself; only public https URLs are passed on.
  let imageHost = '';
  try {
    const u = new URL(imageUrl);
    if (u.protocol === 'https:') imageHost = u.hostname;
  } catch {}
  if (!imageHost) return jsonError(res, 400, 'imageUrl must be a public https URL');
  try {
    const brand = await firestore.getBrand(brandId);
    if (!brand?.instagramAccessToken || !brand.instagramBusinessAccountId) {
      return jsonError(res, 400, 'Brand has not connected Instagram yet.');
    }
    const cookieKey = readCookie(req, IG_COOKIE);
    const [cookieBrand, key] = cookieKey ? cookieKey.split('.') : [];
    if (cookieBrand !== brandId || !key || !brand.instagramPublishKeyHash || !safeEqual(sha256(key), brand.instagramPublishKeyHash)) {
      return jsonError(res, 403, 'Connect Instagram from this browser to publish.');
    }
    const result = await instagramLib.publishImageToInstagram({
      igBusinessAccountId: brand.instagramBusinessAccountId,
      pageAccessToken: brand.instagramAccessToken,
      imageUrl,
      caption,
    });
    res.json({ ok: true, mediaId: result.id });
  } catch (err: any) {
    jsonError(res, 500, err?.message || 'publish failed');
  }
});

// ---------- Reservation availability check ----------
//
// Given a restaurant name + city, returns which of OpenTable / Resy / Tock
// actually have the venue listed. Uses Gemini Flash with Google Search
// grounding so the answer is real-time. Cached in-process for 12 hours.
const RESERVATION_CACHE = new TtlCache<{ opentable: boolean; resy: boolean; tock: boolean }>({
  maxEntries: 1000,
  ttlMs: 12 * 60 * 60 * 1000,
});

app.post('/api/reservations/check', metered('reservations', estReservations, async (req, res) => {
  if (!ai) {
    // Without Gemini, optimistically allow all platforms.
    return res.json({ opentable: true, resy: true, tock: true, source: 'fallback' });
  }
  const restaurantName: string = str(req.body?.restaurantName, 120);
  const city: string = str(req.body?.city, 120);
  if (!restaurantName) return jsonError(res, 400, 'restaurantName required');

  const reservationKey = cacheKey(restaurantName, city);
  const cached = RESERVATION_CACHE.get(reservationKey);
  if (cached) return res.json({ ...cached, source: 'cache' });

  const prompt = `For the restaurant "${restaurantName}" in ${city || 'the United States'}, which of these reservation platforms actually list it for booking? Answer based on real Google Search results, not assumptions. If the restaurant takes walk-ins only or uses its own website (no platform), all three should be false.

Return STRICT JSON only, no prose, no markdown:
{
  "opentable": true_or_false,
  "resy": true_or_false,
  "tock": true_or_false
}

First character of your response is { and last is }.`;

  try {
    const response = await generateGrounded(prompt, 1024, 0.1);
    const parsed = safeParseJson(response.text || '');
    const value = {
      opentable: !!parsed?.opentable,
      resy: !!parsed?.resy,
      tock: !!parsed?.tock,
    };
    RESERVATION_CACHE.set(reservationKey, value);
    res.json({ ...value, source: 'live' });
  } catch (err: any) {
    console.warn('[reservations] check failed:', err?.message || err);
    // On error, allow all so the user still has a path to book.
    res.json({ opentable: true, resy: true, tock: true, source: 'error_fallback' });
  }
}));

// ---------- Sitemap (SEO for city pages) ----------

app.get('/sitemap.xml', (_req, res) => {
  const base = 'https://eve.mohitgoenka.com';
  const slugs = ['', 'restaurant', 'pricing', 'sf', 'nyc', 'austin', 'la', 'seattle', 'chicago'];
  const today = new Date().toISOString().slice(0, 10);
  const urls = slugs
    .map(
      (s) =>
        `<url><loc>${base}/${s}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${s === '' ? '1.0' : '0.8'}</priority></url>`
    )
    .join('');
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

// Eve repeats many lines (per-vibe filler while she plans, reel scripts), so
// identical text + voice is synthesized once and served from memory.
const ttsCache = new TtlCache<{ audioData: string; audioMime: string }>({
  maxEntries: 400,
  ttlMs: 24 * HOUR,
  maxBytes: 16 * 1024 * 1024,
  sizeOf: (v) => v.audioData.length,
});

app.post('/api/tts', metered('tts', estTts, async (req, res) => {
  if (!GEMINI_API_KEY) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const text: string = str(req.body?.text, 1500);
  const voiceMode: string = (req.body?.voiceMode === 'reel' ? 'reel' : 'eve');
  if (!text) return jsonError(res, 400, 'text required');
  const ttsKey = `${voiceMode === 'reel' ? 'reel' : 'eve'}|${text.slice(0, 4500)}`;
  const cachedAudio = ttsCache.get(ttsKey);
  if (cachedAudio) return res.json(cachedAudio);
  const sendAudio = (audioData: string) => {
    const body = { audioData, audioMime: 'audio/mpeg' };
    if (audioData) ttsCache.set(ttsKey, body);
    res.json(body);
  };

  // For Eve's main voice we use Neural2-F (warm female) with SSML prosody so
  // we can actually control pace, pitch, and pause timing — Studio voices
  // sounded natural but emotionally flat ("reading a book"). Neural2-F lets
  // us add breath, slow her down, and lower her register on demand to land
  // the flirty, intimate read the persona calls for. Reel mode keeps Chirp
  // 3 HD because it handles longer utterances better.
  const voiceName =
    voiceMode === 'reel' ? 'en-US-Chirp3-HD-Aoede' : 'en-US-Neural2-F';

  // SSML wrapper for Eve mode. Goal is a low, breathy, intimate read at
  // close-to-natural pace — not "slow audiobook". So: keep prosody rate at
  // default, deepen pitch, soften volume, and add only light breath pauses
  // at sentence boundaries (no comma breaks — those made her stilted).
  const buildSSML = (raw: string): string => {
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const cadenced = escaped
      .replace(/\.\.\./g, '<break time="220ms"/>')
      .replace(/—/g, '<break time="140ms"/>')
      .replace(/\.\s+/g, '.<break time="180ms"/> ')
      .replace(/\?\s+/g, '?<break time="180ms"/> ');
    return `<speak><prosody pitch="-2st" volume="soft">${cadenced}</prosody></speak>`;
  };

  const isEveMode = voiceMode !== 'reel';
  const ttsBody = isEveMode
    ? {
        input: { ssml: buildSSML(text.slice(0, 4500)) },
        voice: { languageCode: 'en-US', name: voiceName },
        audioConfig: {
          audioEncoding: 'MP3',
          // Just barely slower than default for an unhurried-but-natural feel.
          speakingRate: 0.98,
          pitch: 0,
        },
      }
    : {
        input: { text: text.slice(0, 4500) },
        voice: { languageCode: 'en-US', name: voiceName },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.05,
          pitch: 0,
        },
      };

  // Cloud TTS bills every input character, SSML markup included.
  const ttsChars = (ttsBody.input.ssml ?? ttsBody.input.text ?? '').length;
  try {
    const ttsRes = await fetch(
      'https://texttospeech.googleapis.com/v1/text:synthesize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(ttsBody),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('TTS upstream error:', ttsRes.status, errText);
      const fallbackBody = {
        ...ttsBody,
        voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
      };
      const fallbackRes = await fetch(
        'https://texttospeech.googleapis.com/v1/text:synthesize',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify(fallbackBody),
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.text();
        return jsonError(res, 502, `TTS failed: ${fallbackErr.slice(0, 200)}`);
      }
      recordCloudTts(fallbackBody.voice.name, ttsChars);
      const fallbackJson = (await fallbackRes.json()) as { audioContent?: string };
      return sendAudio(fallbackJson.audioContent || '');
    }
    recordCloudTts(voiceName, ttsChars);
    const ttsJson = (await ttsRes.json()) as { audioContent?: string };
    sendAudio(ttsJson.audioContent || '');
  } catch (err: any) {
    console.error('tts failed:', err?.message || err);
    jsonError(res, 500, `TTS failed: ${err?.message || 'unknown'}`);
  }
}));

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://eve.mohitgoenka.com/sitemap.xml\n');
});

// Unknown API routes are JSON 404s, never the SPA shell.
app.use('/api', (_req, res) => jsonError(res, 404, 'Not found'));

// Hashed build output is immutable; the shell, service worker and manifest
// must always revalidate so a deploy is picked up on the next visit.
app.use(
  '/assets',
  express.static(path.join(__dirname, 'dist/assets'), { maxAge: '1y', immutable: true, fallthrough: false })
);
const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest']);
app.use(
  express.static(path.join(__dirname, 'dist'), {
    index: false,
    setHeaders(res, filePath) {
      const base = path.basename(filePath);
      if (NO_CACHE_FILES.has(base) || base.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Anything unexpected (bad JSON, oversized body, thrown errors): a generic
// JSON reply, never a stack trace or upstream error text.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error('unhandled error:', err?.message || err);
  if (res.headersSent) return;
  res.status(status).json({ error: status === 413 ? 'That request is too large.' : status < 500 ? 'Bad request.' : 'Something went wrong. Please try again.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Eve server on port ${PORT}`);
});
