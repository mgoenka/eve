import express from 'express';
import { backupRouter } from './server/backup/index.ts';
import { pulseRouter } from './server/pulse/index.ts';
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
import { openTableUrl, resyUrl, tockUrl } from './lib/reservations';
import { TtlCache, cacheKey } from './lib/ttlCache';
import {
  cleanIntro,
  cleanLocalPackText,
  cleanParsedIntent,
  cleanSpokenLine,
  cleanStory,
  storyKeysFor,
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
import { guardedCall, isAiBusy, sendAiBusy } from './server/ai-guard.ts';
import { aiFixturesActive, aiTestModeMiddleware } from './server/ai-guard.ts';
import { normalizeArrivals } from './server/planTimes.ts';
import { ttsFixture } from './server/ai-fixtures.ts';
import { keepPlanShape, refinePrompt } from './server/refine.ts';
import fs from 'fs';
import { withPreview, isAssetMiss, queryString, escapeHtml, assetLinks } from './server/seo/index.ts';
import { CITIES, findCity } from './data/cities';
import { SPECIAL_CAPTION_MAX, SPECIAL_NAME_MAX, brandIdFor, cleanSpecialText, saveSpecial, specialsPromptBlock } from './server/specials.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PORT = parseInt(process.env.PORT || '8080', 10);

const TEXT_MODEL = 'gemini-3.8-flash'; // pinned: gemini-flash-latest moves to new, pricier models without notice
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const app = express();

// Android App Links: the Play app (signed by Play's app-signing key) opens https links to this site.

app.get("/.well-known/assetlinks.json", assetLinks("com.mohitgoenka.eve", ["E9:C9:4B:3E:EA:BD:CE:39:6D:E9:E3:CC:4B:4A:4D:D4:36:92:9B:E7:1D:40:11:CD:3B:5A:27:8F:36:93:FF:E4"]));
// Smoke tests and headless browsers get free AI fixtures (never Gemini). Off Cloud Run every AI call does.
app.use(aiTestModeMiddleware);
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

/** Error answer for an AI route: Gemini busy / out of quota is a 503 + Retry-After, the rest a generic 500. */
function aiFailed(res: express.Response, err: any, label: string) {
  if (isAiBusy(err)) return sendAiBusy(res, err);
  jsonError(res, 500, `${label}: ${err?.message || 'unknown'}`);
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
  durationMinutes?: number;
  walkMinutesFromPrev?: number;
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
      ...(typeof s?.durationMinutes === 'number' && Number.isFinite(s.durationMinutes) ? { durationMinutes: Math.min(600, Math.max(0, Math.round(Number(s.durationMinutes)))) } : {}),
      ...(typeof s?.walkMinutesFromPrev === 'number' && Number.isFinite(s.walkMinutesFromPrev) ? { walkMinutesFromPrev: Math.min(600, Math.max(0, Math.round(Number(s.walkMinutesFromPrev)))) } : {}),
    }];
  });
}

/**
 * Stops from a plan the model wrote (skeleton or refine). Search-grounded answers can't use a response
 * schema, so keep only usable stops (a named venue) with every field the cards read, never more than 6.
 */
function planStopsOut(v: unknown) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 6).flatMap((s: any) => {
    const name = str(s?.name, 120);
    if (!name) return [];
    const minutes = (x: unknown, d: number) => (Number.isFinite(Number(x)) ? Math.min(600, Math.max(0, Math.round(Number(x)))) : d);
    return [{
      kind: kindIn(s?.kind),
      name,
      oneLineVibe: str(s?.oneLineVibe, 240),
      whyThisFits: str(s?.whyThisFits, 300),
      approxArrival: str(s?.approxArrival, 20),
      durationMinutes: minutes(s?.durationMinutes, 60),
      walkMinutesFromPrev: minutes(s?.walkMinutesFromPrev, 0),
      signatureItem: str(s?.signatureItem, 160),
      isEveOriginal: s?.isEveOriginal === true,
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
// Every text call gets a hard timeout, at most one SDK retry (transient 5xx /
// network only), a maxOutputTokens ceiling and the lowest thinking level.
// Each call goes through ai-guard (per-instance concurrency cap + circuit
// breaker): 429 / 503 / RESOURCE_EXHAUSTED is never retried, it throws
// AiBusyError and the route answers 503 + Retry-After. Thinking tokens count toward
// maxOutputTokens, so the ceilings are generous enough that JSON never gets
// cut off mid-object.
const TEXT_TIMEOUT_MS = 25_000;
const GROUNDED_TIMEOUT_MS = 40_000;
const IMAGE_TIMEOUT_MS = 55_000;
const RETRY = { attempts: 2, httpStatusCodes: [500, 502, 504] };

// If the text model ever rejects thinkingLevel, stop
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
      const response = await guardedCall(() =>
        ai.models.generateContent({
          model: TEXT_MODEL,
          contents: opts.contents,
          config: { ...config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        })
      );
      recordGemini(response, TEXT_MODEL); // AI credits: no-op unless a paying app request
      return response;
    } catch (err: any) {
      if (!/thinking/i.test(String(err?.message || ''))) throw err;
      thinkingLevelSupported = false;
      console.warn(`thinkingLevel rejected by ${TEXT_MODEL}; continuing without it`);
    }
  }
  const response = await guardedCall(() => ai.models.generateContent({ model: TEXT_MODEL, contents: opts.contents, config }));
  recordGemini(response, TEXT_MODEL);
  return response;
}

/**
 * Google Search grounding is billed per search query on Gemini 3 ($14 / 1,000), so it is kept only where Eve's
 * promise needs it (real venues: the plan skeleton and refine) and every grounded prompt caps the searches.
 */
const MAX_SEARCHES = 3;
/** Searches a capped grounded call typically runs (credit estimates are typical, not maximum). */
const TYPICAL_SEARCHES = 2;
const SEARCH_CAP_NOTE = `\n\nSearch budget: use Google Search at most ${MAX_SEARCHES} times in total. Prefer a few broad searches (e.g. "best cocktail bars in <neighborhood>") over one search per venue.`;

/** Search-grounded text call (refine: swapped venues must be real). The prompt gets the search cap. */
function generateGrounded(contents: string, maxOutputTokens: number, temperature: number) {
  return generateText({
    contents: contents + SEARCH_CAP_NOTE,
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
  const response = await guardedCall(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        httpOptions: { timeout: IMAGE_TIMEOUT_MS, retryOptions: RETRY },
      },
    })
  );
  recordGemini(response, IMAGE_MODEL);
  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const p of parts as Array<any>) {
    if (p?.inlineData?.data && p?.inlineData?.mimeType) {
      return { imageData: p.inlineData.data, imageMime: p.inlineData.mimeType };
    }
  }
  return null;
}

// Stop cards and Eve's avatar are shown at ~88px (at most a few hundred px on a TV), but the
// model returns ~1.5 MB 1024px PNGs. Shrink them to a 512px WebP (~30-60 KB) before caching and
// sending. If sharp can't load on this host, send the original rather than fail.
const THUMB_PX = 512;
type Sharp = (typeof import('sharp'))['default'];
let sharpLib: Promise<Sharp | null> | null = null;
function loadSharp() {
  sharpLib ??= import('sharp').then((m) => ((m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp))).catch((err) => {
    console.warn('sharp unavailable, sending full-size images:', err?.message || err);
    return null;
  });
  return sharpLib;
}
async function toThumbnail(img: GeneratedImage): Promise<GeneratedImage> {
  const sharp = await loadSharp();
  if (!sharp) return img;
  try {
    const out = await sharp(Buffer.from(img.imageData, 'base64'))
      .resize(THUMB_PX, THUMB_PX, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { imageData: out.toString('base64'), imageMime: 'image/webp' };
  } catch (err: any) {
    console.warn('thumbnail failed, sending full-size image:', err?.message || err);
    return img;
  }
}

/**
 * A content-pack picture as a JPEG (Instagram's own format) at most `px` wide: the model's ~1.5 MB PNGs
 * become ~150-250 KB, so a 4-picture pack is ~1 MB on a phone instead of ~8 MB. Original on failure.
 */
async function toJpeg(img: GeneratedImage, px = 1024, quality = 86): Promise<GeneratedImage> {
  const sharp = await loadSharp();
  if (!sharp) return img;
  try {
    // Pixel cap: a special's picture comes from the visitor, so a tiny file that decodes huge is refused.
    const out = await sharp(Buffer.from(img.imageData, 'base64'), { limitInputPixels: 40_000_000 })
      .resize(px, px, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#1a0d2e' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { imageData: out.toString('base64'), imageMime: 'image/jpeg' };
  } catch (err: any) {
    console.warn('jpeg conversion failed, sending the original image:', err?.message || err);
    return img;
  }
}

// A Firestore document holds at most 1 MiB, so a special's picture is kept well under it (base64 characters).
const SPECIAL_IMAGE_MAX_CHARS = 700_000;

// ---------- Server-side caches for identical requests ----------
// Content-pack images are the biggest (~200-300 KB of base64 each as JPEG; stop and avatar images are ~50 KB WebP), so the image caches are bounded by
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
// The same evening asked for twice (sample chips, a city page, a shared ?plan= link) within half an hour gets the
// same plan instead of another grounded search. "Plan my evening" again with the same form sends `fresh`.
const skeletonCache = new TtlCache<any>({ maxEntries: 200, ttlMs: HOUR / 2 });

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
  pruneBuckets(imageBuckets, now);
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

/**
 * Typical cost of one call in credits (estimates only; the charge uses the real usage). `searches`: Google Search
 * queries a grounded call may run (Gemini 3 bills each; grounded prompts ask for at most MAX_SEARCHES).
 */
const est = (model: string, input: number, output: number, searches = 0) =>
  costOfCall({ model, usage: { promptTokenCount: input, candidatesTokenCount: output }, groundedRequests: searches ? 1 : 0, searchQueries: searches }).credits;
// One 1024px image (1,290 image tokens) from a ~500-token prompt.
const estImage = () => est(IMAGE_MODEL, 500, 1290);
// Venue details for a stop image: short ungrounded prompt + one paragraph + thinking.
const estResearch = () => est(TEXT_MODEL, 300, 700);
const estTtsChars = (voice: string, chars: number) => {
  const u = cloudTtsUsage(voice, chars);
  return costOfCall({ model: u.model, usage: u.usage }).credits;
};

type Estimate = (req: express.Request) => number;
const body = (req: express.Request): any => (req.body && typeof req.body === 'object' ? req.body : {});
const estIntro: Estimate = () => est(TEXT_MODEL, 700, 800);
const estOutro: Estimate = () => est(TEXT_MODEL, 350, 650);
const estStory: Estimate = () => est(TEXT_MODEL, 900, 900);
const estRefine: Estimate = () => est(TEXT_MODEL, 800, 1300, TYPICAL_SEARCHES);
const estParseIntent: Estimate = () => est(TEXT_MODEL, 900, 750);
const estGeocode: Estimate = () => est(TEXT_MODEL, 80, 620);
const estSkeleton: Estimate = (req) => {
  const b = body(req);
  return !b.fresh && skeletonCache.get(skeletonInput(b).key) ? 1 : est(TEXT_MODEL, 1200, 2100, TYPICAL_SEARCHES);
};
const estNarration: Estimate = () => est(TEXT_MODEL, 500, 800);
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
  return est(TEXT_MODEL, 700, 1100) + (cuisine && dishes ? 0 : est(TEXT_MODEL, 150, 700));
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
    st?.tool === 'placesSearch' ? est(TEXT_MODEL, 120, 700, 1) // agent.ts placesSearch: one grounded lookup
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
// Recent evenings: private-key backup and device linking (server-kit/backup), with its own JSON parser.
// Anonymous usage counts (server-kit/pulse): beacons from ui-kit/pulse.js, no cookies, nothing personal.
app.use('/api/pulse', pulseRouter(express, { app: 'eve', allowedHosts: ['eve.mohitgoenka.com'] }));
app.use('/api/backup', backupRouter(express, { app: 'eve', allowedHosts: ['eve.mohitgoenka.com'], projectId: 'public-mohit-260610' }));

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

/**
 * Rate-limit key for a client. IPv4 as is; IPv6 by its /64 prefix, since one
 * subscriber usually holds a whole /64 and could rotate through it.
 */
function clientIp(req: express.Request): string {
  return ipKey(req.ip || req.socket.remoteAddress || 'unknown');
}

export function ipKey(ip: string): string {
  if (ip.startsWith('::ffff:') && ip.includes('.')) return ip.slice(7); // IPv4-mapped
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

/** Keeps a per-client bucket map bounded: expired entries first, then the oldest. */
function pruneBuckets(m: Map<string, { resetAt: number }>, now: number, max = 5000) {
  if (m.size <= max) return;
  for (const [k, v] of m) if (v.resetAt <= now) m.delete(k);
  for (const k of m.keys()) {
    if (m.size <= max) break;
    m.delete(k);
  }
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
  pruneBuckets(aiBuckets, now);
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
// app uses, exposed through a single agent runtime call. Same-origin only
// like every /api/ route (the guard above): pages on Eve can call it, curl
// and other sites get 403. public/architecture.html documents it that way.
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
    aiFailed(res, err, 'Agent run failed');
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
    aiFailed(res, err, 'Intro failed');
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
    aiFailed(res, err, 'Outro failed');
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
    const required = [...storyKeysFor(stops.length), ...(stops.length > 3 ? ['laterStops'] : [])];
    const response = await generateText({
      contents: prompt,
      maxOutputTokens: 2048 + Math.max(0, stops.length - 3) * 256,
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
          laterStops: { type: Type.ARRAY, items: beat },
          closing: beat,
          moodArc: beat,
          weatherCue: beat,
        },
        required,
      },
    });
    const parsed = cleanStory(safeParseJson(response.text || ''), stops.length);
    if (!parsed) return jsonError(res, 502, 'Story returned non-JSON');
    res.json(parsed);
  } catch (err: any) {
    console.error('eve-story failed:', err?.message || err);
    aiFailed(res, err, 'Story failed');
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

  // Tweak chips (Cheaper, Earlier, ...) adjust the plan in place; a typed or spoken message may reshape it.
  const adjust = req.body?.adjust === true && previousPlan.stops.length > 0;
  const prompt = refinePrompt({ userMessage, previousStops: previousPlan.stops, vibe, city, party, dietary, budgetUSD, adjust });

  try {
    let response: any;
    try {
      response = await generateGrounded(prompt, 4096, 0.85);
    } catch {
      response = await generateText({ contents: prompt, maxOutputTokens: 4096, config: { temperature: 0.85 } });
    }
    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Refine returned non-JSON');
    res.json({
      ...parsed,
      spokenReply: cleanSpokenLine(str((parsed as any).spokenReply, 400)),
      title: str((parsed as any).title, 120),
      stops: normalizeArrivals(
        adjust
          ? keepPlanShape(planStopsOut((parsed as any).stops), previousPlan.stops, (prev) => planStopsOut([prev])[0])
          : planStopsOut((parsed as any).stops),
      ),
    });
  } catch (err: any) {
    console.error('eve-refine failed:', err?.message || err);
    aiFailed(res, err, 'Refine failed');
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
    aiFailed(res, err, 'Parse failed');
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
    const raw = await generateImage(prompt);
    if (!raw) {
      refundImages(req);
      return jsonError(res, 502, 'No avatar image returned');
    }
    const img = await toThumbnail(raw);
    avatarCache.set(avatarKey, img);
    sendWithLimit(req, res, img);
  } catch (err: any) {
    refundImages(req);
    console.error('eve-avatar failed:', err?.message || err);
    aiFailed(res, err, 'Avatar failed');
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
    // One short line: the form's location field (and a week-long cache) takes nothing longer.
    const place = str((response.text || '').trim().split('\n')[0].replace(/^["']|["']$/g, ''), 120);
    if (place) geocodeCache.set(geoKey, place);
    res.json({ city: place });
  } catch (err: any) {
    console.error('reverse-geocode failed:', err?.message || err);
    aiFailed(res, err, 'Geocode failed');
  }
}));

app.get('/api/specials', async (req, res) => {
  const cityFilter = str(req.query?.city, 80);
  try {
    const specials = cityFilter
      ? await firestore.listSpecialsForCity(cityFilter, 25)
      : await firestore.listSpecials(25);
    // Text only: the planner just matches names (the list read never loads pictures, see lib/firestore LIST_FIELDS).
    res.json({ specials: specials.map(({ imageData: _i, imageMime: _m, ...rest }) => rest) });
  } catch (err: any) {
    res.json({ specials: [] });
  }
});

/** The planner form, normalized (shared by the cost estimate and the route), with its cache key. */
function skeletonInput(b: any) {
  b = b && typeof b === 'object' ? b : {};
  const durationHoursRaw = Number(b.durationHours);
  const serverToday = new Date().toISOString().slice(0, 10);
  const todayRaw = str(b.todayISO, 10);
  const i = {
    city: str(b.city, 120),
    vibe: vibeIn(b.vibe),
    party: intIn(b.party, 2, 1, 20),
    dietary: dietaryIn(b.dietary),
    budgetPerPersonUSD: intIn(b.budgetPerPersonUSD ?? b.budgetUSD, 80, 5, 2000),
    freeText: str(b.freeText, 500),
    cuisinePref: str(b.cuisinePref, 60),
    whenISO: str(b.whenISO, 10),
    // Start time of the evening as 24-hour "HH:MM" (e.g. "19:30"). Optional.
    startTime: str(b.startTime, 5),
    // Total length of the evening, in hours. Drives stop count.
    durationHours: Number.isFinite(durationHoursRaw) && durationHoursRaw > 0 ? Math.min(8, Math.max(1.5, durationHoursRaw)) : 4,
    // The visitor's calendar date (a day either side of the server's, for time zones), for "tonight".
    todayISO: /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) && Math.abs(Date.parse(todayRaw) - Date.parse(serverToday)) <= 86400000 ? todayRaw : serverToday,
  };
  return { ...i, key: cacheKey(i.city, i.vibe, i.party, [...i.dietary].sort(), i.budgetPerPersonUSD, i.freeText, i.cuisinePref, i.whenISO, i.startTime, i.durationHours, i.todayISO) };
}

/** Eve-posted specials a plan picked (restaurant analytics: "picked for Eve evenings"). Real plans only. */
function countPlanInclusions(stops: Array<{ name: string }>, specials: Array<{ id?: string; restaurantName: string }>) {
  if (aiFixturesActive() || !Array.isArray(stops)) return;
  const names = stops.map((st) => (st?.name || '').toLowerCase()).filter(Boolean);
  for (const sp of specials) {
    const r = (sp.restaurantName || '').toLowerCase().trim();
    if (!sp.id || r.length < 3) continue;
    if (names.some((n) => n.includes(r) || r.includes(n))) void firestore.bumpSpecialMetric(sp.id, 'planInclusions');
  }
}

app.post('/api/plan-experience/skeleton', metered('plan', estSkeleton, async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const input = skeletonInput(req.body);
  const { city, vibe, party, dietary, budgetPerPersonUSD, freeText, cuisinePref, whenISO, startTime, durationHours, todayISO } = input;
  const totalBudget = budgetPerPersonUSD * party;
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
    // Days from the visitor's own today (their device's date), not the server's: Cloud Run runs on UTC,
    // which is already tomorrow during a US evening.
    const target = new Date(whenISO + 'T00:00:00Z');
    const today = new Date(todayISO + 'T00:00:00Z');
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    const dayLabel =
      diffDays === 0
        ? 'TONIGHT'
        : diffDays === 1
          ? 'TOMORROW NIGHT'
          : `the night of ${target.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
    whenLine = `Date: this plan is for ${dayLabel}. Consider day-of-week vibe (Tuesdays are quiet, Saturdays are busy) and pick venues that will plausibly be open and good that night.`;
  }

  // Specials posted in this area (newest first). Only verified ones (posted from the device that connected the
  // restaurant's Instagram) may anchor a plan; anyone can post the rest, so they stay out of the prompt.
  const allSpecials = (await firestore.listSpecials(200)).filter((s) =>
    (s.city || '').toLowerCase().includes(city.toLowerCase().split(',')[0].trim())
  );
  const specialsHints = specialsPromptBlock(allSpecials.filter((s) => s.verified === true).slice(0, 5));

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

${specialsHints ? `${specialsHints}\n` : ''}

Plan exactly ${stopCount} stops that flow naturally for this vibe. The first stop is always the dinner anchor. Subsequent stops should escalate the experience: dessert, drinks, a walk, a view, live music, an activity, etc. — whatever fits the vibe and the timing.

CRITICAL RULES:
- Stops must be in the same neighborhood / walkable distance OR a short drive.
- Honor dietary preferences strictly for any food/drink stops.
- Stay within budget.
- For each venue, use a plausible, specific name appropriate to the city. Do NOT make up addresses or hours.
- If a restaurant from <restaurant_data> fits the dinner anchor naturally, USE IT and set isEveOriginal: true. Otherwise generate a plausible specific name and set isEveOriginal: false.
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

  const cachedPlan = req.body?.fresh ? undefined : skeletonCache.get(input.key);
  if (cachedPlan) {
    res.set('X-Eve-Cache', 'hit');
    countPlanInclusions(cachedPlan.stops, allSpecials);
    return res.json(cachedPlan);
  }

  try {
    let response: any;
    let groundedSearchUsed = false;
    let groundedSources: string[] = [];

    try {
      response = await generateText({
        contents:
          prompt +
          '\n\nIMPORTANT: Use Google Search to verify each venue you propose actually exists in the area, with the correct cuisine and dietary fit. Only output venues you have confirmed via search. After Search, return ONLY the JSON described above, nothing else.' +
          SEARCH_CAP_NOTE,
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
    // No usable stops is a failed plan (Try again), never a blank one.
    // Arrival times follow from the start time and each stop's length and walk, so the cards add up.
    const stops = normalizeArrivals(planStopsOut((parsed as any).stops), startTime);
    if (!stops.length) return jsonError(res, 502, 'Skeleton had no stops');
    const title = str((parsed as any).title, 120) || 'A planned evening.';
    const plan = { title, stops, groundedSearchUsed, groundedSources };
    skeletonCache.set(input.key, plan);
    countPlanInclusions(stops, allSpecials);
    res.json(plan);
  } catch (err: any) {
    console.error('plan-experience/skeleton failed:', err?.message || err);
    aiFailed(res, err, 'Skeleton failed');
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
  // Ungrounded (Google Search grounding bills per query): this only flavors the stop's image prompt.
  const prompt = `From what you know about "${name}" in "${city}" (no live lookup), in ONE paragraph (max 55 words), describe what the place looks like and what to expect — concrete sensory cues only:
- Interior design / decor / lighting style
- One signature dish OR signature visual element they are known for (depending on stop kind: ${kind})
- The ambient mood (loud / quiet / intimate / lively)

Constraints:
- Use only details you are confident about from reviews, official photos, or food media you know.
- If you don't know this place well, give general cues for that kind of place in ${city} and prefix with "Generally:".
- Output ONLY the paragraph. No headings, no commentary, no preamble.`;
  try {
    const response = await generateText({ contents: prompt, maxOutputTokens: 1024, config: { temperature: 0.4 } });
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
    const raw = await generateImage(prompt);
    if (!raw) {
      refundImages(req);
      return jsonError(res, 502, 'No image returned');
    }
    const img = await toThumbnail(raw);
    stopImageCache.set(stopKey, img);
    sendWithLimit(req, res, img);
  } catch (err: any) {
    refundImages(req);
    console.error('stop-image failed:', err?.message || err);
    aiFailed(res, err, 'Stop image failed');
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
    aiFailed(res, err, 'Narration failed');
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
    return aiFailed(res, err, 'Copy generation failed');
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
    return aiFailed(res, err, 'Copy generation failed');
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
    const heroRaw = await generateImage(heroImagePrompt);
    const hero = heroRaw ? await toJpeg(heroRaw) : null;
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
        if (img) return await toJpeg(img);
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

  // Infer cuisine + signature dishes if missing (ungrounded: restaurant-side copy, no per-search charge)
  if (!cuisine || !signatureDishes) {
    try {
      const inferPrompt = `From what you know about the restaurant "${restaurantName}" in "${city}" (no live lookup), return strict JSON only:
{
  "cuisine": "one-word cuisine type (e.g. indian, italian, thai, japanese, mexican, chinese, american, mediterranean, fusion, cafe)",
  "signatureDishes": "comma-separated list of 3-5 dishes the restaurant is most known for, based on what reviewers and the menu emphasize"
}
If you don't know the restaurant, infer plausibly from the name and return your best guess.`;
      const inferResp = await generateText({ contents: inferPrompt, maxOutputTokens: 1024, config: { temperature: 0.3 } });
      const inferred = safeParseJson<{ cuisine?: string; signatureDishes?: string }>(inferResp.text || '');
      if (!cuisine && inferred?.cuisine) cuisine = inferred.cuisine.trim().toLowerCase();
      if (!signatureDishes && inferred?.signatureDishes) signatureDishes = inferred.signatureDishes.trim();
    } catch (err) {
      console.warn('cuisine inference failed, using defaults', err);
    }
  }
  if (!cuisine) cuisine = 'fusion';

  const prompt = `You are a culinary intelligence agent. The restaurant: ${restaurantName} in ${city}, cuisine ${cuisine}. Signature dishes: ${signatureDishes || 'not provided'}.

Work from what you already know (no live lookup).

Step 1: Recall what reviews of "${restaurantName}" in "${city}" (Google, Yelp, TripAdvisor, food blogs, Instagram) say about specific dishes.

Step 2: If you know of specific dish-level praise (a dish reviewers named and complimented), set mode = "from_reviews" and feature that dish. Summarize the praise in rationale.

Step 3: Otherwise set mode = "from_trending". Pick a dish trending in ${cuisine} cuisine (seasonal, viral, recent food media) that is realistic for this restaurant given their signatures. Also include 2-3 ${city}-area restaurants known for this trending dish, only ones you are confident exist.

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
- If you don't know this restaurant's reviews, use mode = "from_trending".
- Output JSON ONLY.`;

  try {
    const response = await generateText({ contents: prompt, maxOutputTokens: 3072, config: { temperature: 0.6 } });
    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Suggest returned non-JSON');
    const body = { ...parsed, usedSearch: false };
    suggestCache.set(suggestKey, body);
    res.json(body);
  } catch (err: any) {
    console.error('suggest-special failed:', err?.message || err);
    aiFailed(res, err, 'Suggest failed');
  }
}));

// Posting to the public dining index needs no sign-in, so it is held tight: 3 specials a day per IP and per
// device (owner key), names and captions capped, and links / hidden characters stripped. The per-IP count is
// per instance; the per-device count is read from the index itself.
const SPECIALS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const specialIpBuckets = new Map<string, { count: number; resetAt: number }>();
function takeSpecialIpSlot(req: express.Request): boolean {
  const now = Date.now();
  pruneBuckets(specialIpBuckets, now);
  const key = clientIp(req);
  const b = specialIpBuckets.get(key);
  if (!b || b.resetAt <= now) {
    specialIpBuckets.set(key, { count: 1, resetAt: now + DAY_MS });
    return true;
  }
  b.count += 1;
  return b.count <= SPECIALS_PER_DAY;
}

app.post('/api/post-special', async (req, res) => {
  const restaurantName: string = cleanSpecialText(req.body?.restaurantName, SPECIAL_NAME_MAX);
  const city: string = cleanSpecialText(req.body?.city, 120);
  const cuisine: string = cleanSpecialText(req.body?.cuisine, 40) || 'fusion';
  const dishName: string = cleanSpecialText(req.body?.dishName, SPECIAL_NAME_MAX);
  const caption: string = cleanSpecialText(req.body?.caption, SPECIAL_CAPTION_MAX);
  // Only a real base64 PNG/JPEG/WebP (<= ~4.5 MB) is accepted with a special (stored as a smaller JPEG, below).
  const rawImage = req.body?.imageData;
  const rawMime = req.body?.imageMime;
  const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const imageOk =
    typeof rawImage === 'string' &&
    rawImage.length <= 6_000_000 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(rawImage) &&
    typeof rawMime === 'string' &&
    IMAGE_MIMES.has(rawMime);

  if (!restaurantName || !dishName || !city) {
    return jsonError(res, 400, 'restaurantName, dishName, city required');
  }
  const tooMany = () => {
    res.set('Retry-After', String(DAY_MS / 1000));
    jsonError(res, 429, `You can post ${SPECIALS_PER_DAY} specials a day. Try again tomorrow.`);
  };
  try {
    // Linked to this device so "Delete my account and data" can remove it.
    const ownerKeyHash = sha256(ownerKeyFor(req, res));
    if (!aiFixturesActive()) {
      const sinceISO = new Date(Date.now() - DAY_MS).toISOString();
      if ((await firestore.countOwnedSpecialsSince(ownerKeyHash, sinceISO)) >= SPECIALS_PER_DAY) return tooMany();
      if (!takeSpecialIpSlot(req)) return tooMany();
    }
    // Verified: posted from the device that connected this restaurant's Instagram. Only verified specials
    // can be a diner's dinner anchor (see the skeleton prompt).
    const brand = await firestore.getBrand(brandIdFor(restaurantName, city)).catch(() => null);
    const verified = !!(brand?.instagramBusinessAccountId && brand.ownerKeyHash && safeEqual(brand.ownerKeyHash, ownerKeyHash));
    // The pack's picture (a ~2 MB PNG) would not fit a Firestore document, and the special was then only kept
    // in this instance's memory: store a 768px JPEG instead, or no picture when it still doesn't fit.
    const picture = imageOk ? await toJpeg({ imageData: rawImage, imageMime: rawMime }, 768, 80) : null;
    const pictureFits = !!picture && picture.imageData.length <= SPECIAL_IMAGE_MAX_CHARS;
    const imageData = pictureFits ? picture!.imageData : undefined;
    const imageMime = pictureFits ? picture!.imageMime : undefined;
    // Free AI test mode (smoke tests, automated browsers) never writes to the real dining index.
    const result = await saveSpecial(
      { ownerKeyHash, restaurantName, city, cuisine, dishName, caption, imageData, imageMime, verified, postedAtISO: new Date().toISOString() },
      firestore.addSpecial,
    );
    res.json(result);
  } catch (err: any) {
    aiFailed(res, err, 'post-special failed');
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

// Subscriptions are switched off until they're fully wired: checkout carries no brandId and nothing reads
// subscriptionStatus, so even with STRIPE_PRICE_* set a payment would unlock nothing. Checkout refuses while
// this is false (the pricing page shows "Coming soon"); turn it on with SUBSCRIPTIONS_ENABLED in PricingPage.tsx.
const SUBSCRIPTIONS_ENABLED = false;

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  // Google Play payments policy: no web checkout from inside the Android app
  // (the app hides every pricing/checkout entry point; this is the backstop).
  if ((req.get('user-agent') || '').includes('MohitGoenkaApp/')) {
    return jsonError(res, 403, 'Plans aren\u2019t available in the app.');
  }
  if (!SUBSCRIPTIONS_ENABLED || !stripeLib.isStripeConfigured()) {
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
  pruneBuckets(deleteBuckets, now);
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
    // Brand ids are public ("name-city"): a restaurant already connected from another device keeps its
    // connection unless the same Instagram account connects again. Otherwise anyone could take over a
    // restaurant's publishing (and its "verified" specials) by connecting their own account to its id.
    const ownerKeyHash = sha256(ownerKeyFor(req, res));
    const existing = await firestore.getBrand(brandId);
    if (
      existing?.instagramBusinessAccountId &&
      existing.instagramBusinessAccountId !== igAccount.igBusinessAccountId &&
      !(existing.ownerKeyHash && safeEqual(existing.ownerKeyHash, ownerKeyHash))
    ) {
      return res.redirect('/restaurant?ig=taken');
    }
    // Publishing needs proof that this browser connected the account: a
    // random key in an httpOnly cookie, stored server-side only as a hash.
    const publishKey = crypto.randomBytes(24).toString('base64url');
    await firestore.saveBrand(brandId, {
      instagramAccessToken: igAccount.pageAccessToken,
      instagramBusinessAccountId: igAccount.igBusinessAccountId,
      instagramPublishKeyHash: sha256(publishKey),
      ownerKeyHash,
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

// ---------- Reservation links ----------
//
// Booking search links for a restaurant, with no AI call (a grounded lookup of which platform lists the venue cost
// a Google Search query each time). Every platform stays offered (the stop card shows all three search links) and
// the answer carries the search URLs: Google Maps for the venue + city, OpenTable, Resy and Tock.
app.post('/api/reservations/check', (req, res) => {
  const restaurantName: string = str(req.body?.restaurantName, 120);
  const city: string = str(req.body?.city, 120);
  if (!restaurantName) return jsonError(res, 400, 'restaurantName required');
  const input = { restaurantName, city };
  res.json({
    opentable: true,
    resy: true,
    tock: true,
    source: 'links',
    links: {
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurantName} ${city}`.trim())}`,
      opentable: openTableUrl(input),
      resy: resyUrl(input),
      tock: tockUrl(input),
    },
  });
});

// ---------- Page titles and link previews (server-rendered head) ----------

const SITE_ORIGIN = 'https://eve.mohitgoenka.com';
let indexHtmlCache: string | null = null;
/** dist/index.html, read once (null before a build). */
function indexHtml(): string | null {
  if (indexHtmlCache) return indexHtmlCache;
  try {
    indexHtmlCache = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
  } catch {
    return null;
  }
  return indexHtmlCache;
}

function withCanonical(html: string, url: string): string {
  return html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, () => `<link rel="canonical" href="${escapeHtml(url)}" />`);
}

/** A shared evening (?e=, base64url JSON with a city and stops) as preview text, or null when it doesn't parse. */
function sharedEveningPreview(raw: string): { title: string; description: string } | null {
  if (!raw || raw.length > 12_000) return null;
  try {
    const e = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const cityName = typeof e?.city === 'string' ? e.city.split(',')[0].trim() : '';
    const stops: string[] = Array.isArray(e?.stops)
      ? e.stops.map((s: any) => (typeof s?.name === 'string' ? s.name.trim() : '')).filter(Boolean).slice(0, 6)
      : [];
    if (!cityName || !stops.length) return null;
    return { title: `An evening in ${cityName}`, description: `${stops.join(' · ')}. Planned by Eve.` };
  } catch {
    return null;
  }
}

/** index.html with this page's own title, description and canonical (city pages, restaurants, shared evenings). */
function pageHtml(html: string, req: express.Request): string {
  const slug = req.path.replace(/^\/+|\/+$/g, '');
  const city = findCity(slug);
  if (city) {
    const url = `${SITE_ORIGIN}/${city.slug}`;
    return withCanonical(withPreview(html, { title: city.title, description: city.description, url }), url);
  }
  if (slug === 'restaurant') {
    const url = `${SITE_ORIGIN}/restaurant`;
    return withCanonical(
      withPreview(html, {
        title: 'Eve for Restaurants — Daily AI Content Packs',
        description: 'Tell Eve your restaurant and city. She writes tonight’s special, Instagram post, reel, menu card, email and SMS in your voice, and puts it in front of diners planning their evening.',
        url,
      }),
      url,
    );
  }
  if (slug === '') {
    const shared = sharedEveningPreview(queryString(req.query?.e));
    if (shared) return withPreview(html, shared);
  }
  return html;
}

// ---------- Sitemap (SEO for city pages) ----------

// Each listed page is served with its own <title>, description and canonical (pageHtml above). No lastmod:
// the pages don't carry a real change date. /pricing is left out while subscriptions are switched off.
app.get('/sitemap.xml', (_req, res) => {
  const slugs = ['', 'restaurant', ...CITIES.map((c) => c.slug)];
  const urls = slugs
    .map((s) => `<url><loc>${SITE_ORIGIN}/${s}</loc><changefreq>weekly</changefreq><priority>${s === '' ? '1.0' : '0.8'}</priority></url>`)
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
      .replace(/\.\.\.|…/g, '<break time="220ms"/>')
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
  const fixtureAudio = ttsFixture(); // free AI test mode: silent clip, no Cloud TTS call
  if (fixtureAudio) return sendAudio(fixtureAudio);
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
    aiFailed(res, err, 'TTS failed');
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
app.get('/{*splat}', (req, res) => {
  if (isAssetMiss(req.path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  const html = indexHtml();
  if (!html) return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  res.type('html').send(pageHtml(html, req));
});

// Anything unexpected (bad JSON, oversized body, thrown errors): a generic
// JSON reply, never a stack trace or upstream error text.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error('unhandled error:', err?.message || err);
  if (res.headersSent) return;
  res.status(status).json({ error: status === 413 ? 'That request is too large.' : status < 500 ? 'Bad request.' : 'Something went wrong. Please try again.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Eve server on port ${PORT}`);
});

// Cloud Run sends SIGTERM before stopping an instance: stop accepting new
// connections, let in-flight requests finish (up to 8 s), then exit.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: draining requests`);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 8_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
