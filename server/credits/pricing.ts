/* generated from app-platform/server-kit/credits — edit there and re-sync. */
// Gemini API price table and the cost of one model call from its usageMetadata.
//
// Source: https://ai.google.dev/gemini-api/docs/pricing (301 -> https://aistudio.google.com/docs/pricing),
// "Paid tier", Standard (not Batch/Flex/Priority), read 2026-11-22. USD per 1M tokens unless noted.
// When Google changes a price, add a new period (with `from`) instead of editing the old one, so a
// call is always charged at the price in force when it ran. Re-check this page monthly.
import { CREDIT_USD } from './config.ts';

export const PRICING_SOURCE = {
  url: 'https://ai.google.dev/gemini-api/docs/pricing',
  checked: '2026-11-22',
  tier: 'Paid tier, Standard',
} as const;

export interface Rates {
  /** Text / image / video input. */
  input: number;
  /** Audio input (defaults to `input`). */
  inputAudio?: number;
  /** Implicit/explicit context-cache hits (defaults to `input`). */
  cachedInput?: number;
  /** Text output, including thinking tokens. */
  output: number;
  /** Audio output (TTS). Defaults to `output`. */
  outputAudio?: number;
  /** Image output tokens (1290 tokens = one 1024px image on 2.5 Flash Image). Defaults to `output`. */
  outputImage?: number;
  /** Long-context rates (prompt above `threshold` tokens). */
  long?: { threshold: number; input: number; output: number; cachedInput?: number };
}

export interface ModelPrice {
  /** Model code prefix; the longest matching prefix wins ("gemini-3.8-flash-tts" before "gemini-3.8-flash"). */
  model: string;
  /** Rates by period, oldest first. `from` = first UTC day the rates apply (inclusive). */
  periods: Array<{ from?: string; rates: Rates }>;
  /** Grounding with Google Search, USD per grounded request (charged only when the answer cites web sources). */
  groundingUsd?: number;
  /** What candidate tokens are when the response has no per-modality breakdown. */
  defaultOutput?: 'text' | 'audio' | 'image';
  note?: string;
}

// Gemini 3+ grounding: 5,000 free requests/month shared by all Gemini 3+ models, then $14 / 1,000.
// We always charge it (the free allowance is shared by every app; usage beyond it is the real cost).
const G3_GROUNDING = 14 / 1000;
// Gemini 2.5 grounding: 1,500 grounded prompts/day free, then $35 / 1,000.
const G25_GROUNDING = 35 / 1000;

export const PRICE_TABLE: readonly ModelPrice[] = [
  {
    model: 'gemini-3.8-flash',
    periods: [
      { rates: { input: 0.75, cachedInput: 0.075, output: 3.75 } },
      { from: '2027-01-01', rates: { input: 1.5, cachedInput: 0.15, output: 7.5 } },
    ],
    groundingUsd: G3_GROUNDING,
    note: 'gemini-flash-latest currently resolves to a Gemini 3.x Flash model; we price by response.modelVersion.',
  },
  {
    model: 'gemini-3.6-flash',
    periods: [
      { rates: { input: 0.75, cachedInput: 0.075, output: 3.75 } },
      { from: '2027-01-01', rates: { input: 1.5, cachedInput: 0.15, output: 7.5 } },
    ],
    groundingUsd: G3_GROUNDING,
  },
  { model: 'gemini-3.5-flash-lite', periods: [{ rates: { input: 0.3, cachedInput: 0.03, output: 2.5 } }], groundingUsd: G3_GROUNDING },
  {
    model: 'gemini-3.1-flash-lite',
    periods: [{ rates: { input: 0.25, inputAudio: 0.5, cachedInput: 0.025, output: 1.5 } }],
    groundingUsd: G3_GROUNDING,
  },
  {
    model: 'gemini-3-flash',
    periods: [{ rates: { input: 0.5, inputAudio: 1.0, cachedInput: 0.05, output: 3.0 } }],
    groundingUsd: G3_GROUNDING,
  },
  {
    model: 'gemini-3.1-pro',
    periods: [{ rates: { input: 2.0, cachedInput: 0.2, output: 12.0, long: { threshold: 200_000, input: 4.0, output: 18.0, cachedInput: 0.4 } } }],
    groundingUsd: G3_GROUNDING,
  },
  // ---- text-to-speech (audio output tokens, 25 tokens per second of audio)
  {
    model: 'gemini-3.8-flash-tts',
    periods: [
      { rates: { input: 0.5, output: 9.0, outputAudio: 9.0 } },
      { from: '2027-01-01', rates: { input: 1.0, output: 18.0, outputAudio: 18.0 } },
    ],
    defaultOutput: 'audio',
  },
  {
    model: 'gemini-3.8-flash-lite-tts',
    periods: [
      { rates: { input: 0.5, output: 6.0, outputAudio: 6.0 } },
      { from: '2027-01-01', rates: { input: 1.0, output: 12.0, outputAudio: 12.0 } },
    ],
    defaultOutput: 'audio',
  },
  { model: 'gemini-3.1-flash-tts', periods: [{ rates: { input: 1.0, output: 20.0, outputAudio: 20.0 } }], defaultOutput: 'audio' },
  { model: 'gemini-2.5-flash-preview-tts', periods: [{ rates: { input: 0.5, output: 10.0, outputAudio: 10.0 } }], defaultOutput: 'audio' },
  // ---- image output
  {
    model: 'gemini-2.5-flash-image',
    // Page: $0.30 input, $0.039 per image (= $30 / 1M image tokens); text output priced as 2.5 Flash ($2.50).
    periods: [{ rates: { input: 0.3, output: 2.5, outputImage: 30.0 } }],
    groundingUsd: G3_GROUNDING,
    defaultOutput: 'image',
    note: 'Deprecated, shuts down 2027-03-15.',
  },
  { model: 'gemini-3.1-flash-image', periods: [{ rates: { input: 0.5, output: 3.0, outputImage: 60.0 } }], groundingUsd: G3_GROUNDING, defaultOutput: 'image' },
  { model: 'gemini-3.1-flash-lite-image', periods: [{ rates: { input: 0.25, output: 1.5, outputImage: 30.0 } }], groundingUsd: G3_GROUNDING, defaultOutput: 'image' },
  { model: 'gemini-3-pro-image', periods: [{ rates: { input: 2.0, output: 12.0, outputImage: 120.0 } }], groundingUsd: G3_GROUNDING, defaultOutput: 'image' },
  // ---- 2.5 family (deprecated; Google reroutes 2.5 Flash -> 3.5 Flash-Lite and 2.5 Pro -> 3.8 Flash from 2026-12-01,
  //      and the response's modelVersion then names the model that really ran)
  { model: 'gemini-2.5-flash-lite', periods: [{ rates: { input: 0.1, inputAudio: 0.3, cachedInput: 0.01, output: 0.4 } }], groundingUsd: G25_GROUNDING },
  { model: 'gemini-2.5-flash', periods: [{ rates: { input: 0.3, inputAudio: 1.0, cachedInput: 0.03, output: 2.5 } }], groundingUsd: G25_GROUNDING },
  {
    model: 'gemini-2.5-pro',
    periods: [{ rates: { input: 1.25, cachedInput: 0.125, output: 10.0, long: { threshold: 200_000, input: 2.5, output: 15.0, cachedInput: 0.25 } } }],
    groundingUsd: G25_GROUNDING,
  },
];

/** Aliases used in the apps when the response has no modelVersion. */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  'gemini-flash-latest': 'gemini-3.8-flash',
  'gemini-flash-lite-latest': 'gemini-3.5-flash-lite',
};

/** Unknown model: charge as the most expensive Flash-class entry so we never undercharge silently. */
const FALLBACK_MODEL = 'gemini-3.8-flash';

const BY_LENGTH = [...PRICE_TABLE].sort((a, b) => b.model.length - a.model.length);
const warned = new Set<string>();

export function findModelPrice(modelRaw: string): { price: ModelPrice; known: boolean } {
  const model = (modelRaw || '').trim().toLowerCase().replace(/^models\//, '');
  const resolved = MODEL_ALIASES[model] ?? model;
  const hit = BY_LENGTH.find((p) => resolved === p.model || resolved.startsWith(p.model + '-') || resolved.startsWith(p.model + '@'));
  if (hit) return { price: hit, known: true };
  if (!warned.has(model)) {
    warned.add(model);
    console.warn(`[credits] no price for model "${model.slice(0, 60)}"; charging as ${FALLBACK_MODEL}. Update server-kit/credits/pricing.ts.`);
  }
  const fallback = PRICE_TABLE.find((p) => p.model === FALLBACK_MODEL);
  if (!fallback) throw new Error('pricing table has no fallback model');
  // Fallback for unknown models uses the newest (highest) rates of the fallback model.
  return { price: { ...fallback, periods: fallback.periods.slice(-1) }, known: false };
}

export function ratesAt(price: ModelPrice, when: Date): Rates {
  const day = when.toISOString().slice(0, 10);
  let current = price.periods[0];
  for (const p of price.periods) if (!p.from || p.from <= day) current = p;
  if (!current) throw new Error('model price has no periods: ' + price.model);
  return current.rates;
}

/** The subset of Gemini's usageMetadata we price (field names as in @google/genai / the REST API). */
export interface UsageMetadata {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
}

export interface CallUsage {
  /** response.modelVersion when present, else the model you asked for. */
  model: string;
  usage: UsageMetadata | undefined;
  /** Grounded requests in this call (Google Search with web citations). */
  groundedRequests?: number;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const modalityTokens = (list: UsageMetadata['promptTokensDetails'], modality: string) =>
  (list ?? []).filter((d) => String(d?.modality ?? '').toUpperCase() === modality).reduce((s, d) => s + n(d?.tokenCount), 0);

export interface CallCost {
  model: string;
  priced: string;
  known: boolean;
  usd: number;
  credits: number;
}

/** USD cost of one model call. */
export function costOfCall(call: CallUsage, when: Date = new Date()): CallCost {
  const { price, known } = findModelPrice(call.model);
  const r = ratesAt(price, when);
  const u = call.usage ?? {};
  const prompt = n(u.promptTokenCount);
  const cached = Math.min(prompt, n(u.cachedContentTokenCount));
  const longCtx = r.long && prompt > r.long.threshold ? r.long : null;
  const inRate = longCtx ? longCtx.input : r.input;
  const outRate = longCtx ? longCtx.output : r.output;
  const cacheRate = longCtx ? (longCtx.cachedInput ?? longCtx.input) : (r.cachedInput ?? r.input);

  // Input: uncached prompt tokens (audio at the audio rate), tool-use prompt tokens, cached tokens.
  const audioIn = Math.min(prompt - cached, modalityTokens(u.promptTokensDetails, 'AUDIO'));
  const otherIn = prompt - cached - audioIn;
  let usd = (otherIn * inRate + audioIn * (r.inputAudio ?? inRate) + n(u.toolUsePromptTokenCount) * inRate + cached * cacheRate) / 1e6;

  // Output: per-modality breakdown when present, otherwise the model's default output kind.
  const cand = n(u.candidatesTokenCount);
  const audioOut = modalityTokens(u.candidatesTokensDetails, 'AUDIO');
  const imageOut = modalityTokens(u.candidatesTokensDetails, 'IMAGE');
  const hasDetails = (u.candidatesTokensDetails ?? []).length > 0;
  const rateFor = (kind: 'text' | 'audio' | 'image') => (kind === 'audio' ? (r.outputAudio ?? outRate) : kind === 'image' ? (r.outputImage ?? outRate) : outRate);
  if (hasDetails) {
    const textOut = Math.max(0, cand - audioOut - imageOut);
    usd += (textOut * outRate + audioOut * rateFor('audio') + imageOut * rateFor('image')) / 1e6;
  } else {
    usd += (cand * rateFor(price.defaultOutput ?? 'text')) / 1e6;
  }
  usd += (n(u.thoughtsTokenCount) * outRate) / 1e6; // thinking is billed as output
  usd += n(call.groundedRequests) * (price.groundingUsd ?? 0);
  return { model: call.model, priced: price.model, known, usd, credits: creditsForUsd(usd) };
}

/** Whole credits for a cost: round up, minimum 1 per model call. */
export function creditsForUsd(usd: number): number {
  if (!(usd > 0)) return 1;
  return Math.max(1, Math.ceil(usd / CREDIT_USD - 1e-9));
}

/** Rough pre-check estimate (credits) for a call with about this many tokens. */
export function estimateCredits(model: string, inputTokens: number, outputTokens: number, when: Date = new Date()): number {
  return costOfCall({ model, usage: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens } }, when).credits;
}

/** True when a generateContent response was grounded with web sources (the only case Google bills). */
export function groundedRequestsOf(response: unknown): number {
  const cands = (response as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: unknown[]; webSearchQueries?: unknown[] } }> })?.candidates;
  if (!Array.isArray(cands)) return 0;
  return cands.some((c) => (c?.groundingMetadata?.groundingChunks?.length ?? 0) > 0) ? 1 : 0;
}

/** Usage of one @google/genai generateContent response (or the REST JSON). */
export function usageOf(response: unknown, requestedModel: string): CallUsage {
  const r = response as { modelVersion?: unknown; usageMetadata?: UsageMetadata } | null;
  const version = typeof r?.modelVersion === 'string' && r.modelVersion.trim() ? r.modelVersion : requestedModel;
  return { model: version, usage: r?.usageMetadata, groundedRequests: groundedRequestsOf(response) };
}
