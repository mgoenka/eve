// On-device versions of Eve's small writing features (free, no Sparks). Each one sends the
// server's exact prompt (lib/evePrompts.ts) to the device's own model and runs the same
// checks the server applies (plus a stricter shape check); null means "use the server".
import { localJson, localPrompt } from '../ui-kit';
import type { LocalPromptOptions } from '../ui-kit';
import { DIETARY_PREFERENCES, VIBES } from '../constants';
import {
  clip,
  cleanCopyChannel,
  cleanIntroStrict,
  cleanNarrationStrict,
  cleanOutroStrict,
  cleanParsedIntentStrict,
  cleanReel,
  cleanStoryStrict,
  contentSharedContext,
  copyChannelPrompt,
  DEVICE_COPY_CHANNEL_IDS,
  COPY_CHANNEL_JSON_SCHEMA,
  introPrompt,
  INTRO_JSON_SCHEMA,
  narrationPrompt,
  outroPrompt,
  parseIntentPrompt,
  PARSE_INTENT_JSON_SCHEMA,
  reelPrompt,
  REEL_JSON_SCHEMA,
  storyPrompt,
  storyJsonSchema,
} from '../lib/evePrompts';
import type { ContentPackInput, DeviceCopyData, IntentForm, LocalPackText, ParsedIntentOut, StoryOut } from '../lib/evePrompts';

/** Output each feature needs in one call (tokens). Engines that can't write this much skip to the server. */
export const LOCAL_TOKENS = {
  intro: 160,
  outro: 80,
  narration: 240,
  parseIntent: 220,
  /** Nine beats of 130-180 words in JSON: the browser engine only (Android writes ~256 per call). */
  story: 600,
  /** The email channel is the longest (2-3 paragraphs of HTML): the browser engine only. */
  contentPack: 600,
} as const;

// Same input normalization as server.ts (str / intIn / vibeIn / stopsIn / dietaryIn).
const VIBE_IDS = new Set<string>(VIBES.map((v) => v.id));
const DIETARY_IDS = new Set<string>(DIETARY_PREFERENCES.map((d) => d.id));
const STOP_KINDS = new Set(['dinner', 'dessert', 'drink', 'walk', 'live_music', 'view', 'activity']);
const vibeIn = (v: unknown) => (typeof v === 'string' && VIBE_IDS.has(v) ? v : 'date_night');
const intIn = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
};
type StopLike = { kind?: unknown; name?: unknown; oneLineVibe?: unknown; whyThisFits?: unknown; approxArrival?: unknown; signatureItem?: unknown };
const stopsIn = (v: readonly StopLike[] | undefined) =>
  (v || []).slice(0, 6).flatMap((s) => {
    const name = clip(s?.name, 120);
    if (!name) return [];
    return [{
      kind: typeof s.kind === 'string' && STOP_KINDS.has(s.kind) ? s.kind : 'dinner',
      name,
      oneLineVibe: clip(s.oneLineVibe, 240),
      whyThisFits: clip(s.whyThisFits, 300),
      approxArrival: clip(s.approxArrival, 20),
      signatureItem: clip(s.signatureItem, 160),
    }];
  });

/** Plain-text prompt with a check; retries once on bad output. Null instead of throwing. */
async function localText(o: LocalPromptOptions, check: (t: string) => string | null, attempts = 2): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const v = check(await localPrompt(o));
      if (v) return v;
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg === 'local_ai_unavailable' || (e as Error)?.name === 'AbortError') return null;
    }
  }
  return null;
}

export function localIntro(input: { vibe: string; city: string; party: number; freeText: string }) {
  const prompt = introPrompt({
    vibe: vibeIn(input.vibe),
    city: clip(input.city, 120),
    party: intIn(input.party, 2, 1, 20),
    freeText: clip(input.freeText, 500),
  });
  return localJson({ prompt, schema: INTRO_JSON_SCHEMA, temperature: 0.95, maxOutputTokens: 256, validate: cleanIntroStrict });
}

export async function localOutro(input: { vibe: string; city: string; stops: Array<{ name: string; kind: string }> }) {
  const stops = stopsIn(input.stops);
  if (!stops.length) return null;
  const prompt = outroPrompt({ vibe: vibeIn(input.vibe), city: clip(input.city, 120), stops });
  const outro = await localText({ prompt, temperature: 0.95, maxOutputTokens: 120 }, (t) => cleanOutroStrict(t, stops));
  return outro ? { outro } : null;
}

export function localStory(input: { title: string; stops: StopLike[]; vibe: string; city: string; party: number }): Promise<StoryOut | null> {
  const stops = stopsIn(input.stops);
  if (!stops.length) return Promise.resolve(null);
  const prompt = storyPrompt({ title: clip(input.title, 160), stops, vibe: vibeIn(input.vibe), city: clip(input.city, 120), party: intIn(input.party, 2, 1, 20) });
  return localJson({ prompt, schema: storyJsonSchema(stops.length), temperature: 0.92, validate: (v: unknown) => cleanStoryStrict(v, stops.length) });
}

export async function localNarration(input: { title: string; stops: StopLike[]; vibe: string }) {
  const stops = stopsIn(input.stops);
  if (!stops.length) return null;
  const prompt = narrationPrompt({ title: clip(input.title, 160), vibe: vibeIn(input.vibe), stops });
  const narration = await localText({ prompt, temperature: 0.7, maxOutputTokens: 256 }, (t) => cleanNarrationStrict(t, stops));
  return narration ? { narration } : null;
}

export function localParseIntent(
  transcript: string,
  cf: { location?: string; vibe?: string; party?: number; dietary?: string[]; budgetPerPerson?: number; cuisinePref?: string; freeText?: string }
): Promise<ParsedIntentOut | null> {
  const t = clip(transcript, 1000);
  if (!t) return Promise.resolve(null);
  const form: IntentForm = {
    location: clip(cf.location, 120),
    vibe: typeof cf.vibe === 'string' && VIBE_IDS.has(cf.vibe) ? cf.vibe : '',
    party: cf.party === undefined ? '' : intIn(cf.party, 2, 1, 20),
    dietary: Array.isArray(cf.dietary) ? cf.dietary.filter((d) => DIETARY_IDS.has(d)).slice(0, 8) : [],
    budgetPerPerson: cf.budgetPerPerson === undefined ? '' : intIn(cf.budgetPerPerson, 80, 5, 2000),
    cuisinePref: clip(cf.cuisinePref, 60),
    freeText: clip(cf.freeText, 500),
  };
  return localJson({ prompt: parseIntentPrompt(t, form), schema: PARSE_INTENT_JSON_SCHEMA, temperature: 0.85, maxOutputTokens: 256, validate: cleanParsedIntentStrict });
}

/**
 * The content pack's text, one channel per call (Instagram, email, SMS, Reel storyboard).
 * The menu card (price, allergens) is always made on the server. Returns what passed its checks
 * (the copy only when all three channels did); the server makes the pictures, the menu card and
 * anything missing. Null when nothing passed.
 */
export async function localPackText(input: ContentPackInput): Promise<LocalPackText | null> {
  const ctx = contentSharedContext({
    dishName: clip(input.dishName, 120),
    dishDescription: clip(input.dishDescription, 400),
    restaurantName: clip(input.restaurantName, 120),
    cuisine: clip(input.cuisine, 40) || 'fusion',
    voice: clip(input.voice, 300),
    city: clip(input.city, 120),
    signatureDishes: clip(input.signatureDishes, 400),
  });
  const opts = { temperature: 0.8, timeoutMs: 45_000 };
  const [channels, reel] = await Promise.all([
    Promise.all(
      DEVICE_COPY_CHANNEL_IDS.map((c) =>
        localJson({ ...opts, prompt: copyChannelPrompt(ctx, c), schema: COPY_CHANNEL_JSON_SCHEMA[c], validate: (v) => cleanCopyChannel(c, v) })
      )
    ),
    localJson({ ...opts, temperature: 0.85, prompt: reelPrompt(ctx), schema: REEL_JSON_SCHEMA, validate: cleanReel }),
  ]);
  const out: LocalPackText = {};
  if (channels.every((x) => x != null)) out.copy = Object.fromEntries(DEVICE_COPY_CHANNEL_IDS.map((c, i) => [c, channels[i]])) as unknown as DeviceCopyData;
  if (reel) out.reel = reel;
  return out.copy || out.reel ? out : null;
}
