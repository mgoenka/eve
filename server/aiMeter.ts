// Per-request AI metering for prepaid AI credits (Android app only).
//
// server.ts runs every AI endpoint of a paying request (native app + X-MG-App-User) inside
// withMeter(); every model call made while handling it, wherever it happens (the text / image
// helpers, the grounded venue research, the agent tools, Cloud TTS), records its real usage here.
// Calls made outside a paying request (the website, cache hits) record nothing.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Meter } from './credits/index.ts';

const current = new AsyncLocalStorage<Meter>();

/** Run fn with `meter` as the current request's meter. */
export function withMeter<T>(meter: Meter, fn: () => Promise<T>): Promise<T> {
  return current.run(meter, fn);
}

/** Record one Gemini generateContent response (modelVersion + usageMetadata + grounding). */
export function recordGemini(response: unknown, requestedModel: string): void {
  current.getStore()?.add(response, requestedModel);
}

// Cloud Text-to-Speech (not Gemini) bills per input character, SSML tags included.
// List prices, USD per 1M characters (cloud.google.com/text-to-speech/pricing; not re-checked
// with the Gemini table on 2026-11-22, re-check monthly with it). Free monthly tiers are ignored.
const TTS_USD_PER_M_CHARS: Record<string, number> = {
  chirp3: 30, // Chirp 3: HD voices
  neural2: 16,
  standard: 4,
};
const ttsRate = (voice: string) => {
  const v = voice.toLowerCase();
  if (v.includes('chirp3')) return TTS_USD_PER_M_CHARS.chirp3;
  if (v.includes('neural2')) return TTS_USD_PER_M_CHARS.neural2;
  if (v.includes('standard')) return TTS_USD_PER_M_CHARS.standard;
  return TTS_USD_PER_M_CHARS.chirp3; // unknown voice: the most expensive tier
};
// The kit prices model usage, not dollars. gemini-2.5-flash-image's output rate is exactly
// $30 / 1M tokens, so a Cloud TTS call is recorded as that many equivalent output tokens under a
// label the price table resolves to that model (prefix match), keeping the voice in the ledger.
const EQUIV_MODEL = 'gemini-2.5-flash-image';
const EQUIV_USD_PER_M = 30;

/** Usage-equivalent of one Cloud TTS synthesis (exported for estimates and tests). */
export function cloudTtsUsage(voice: string, billedChars: number) {
  const tokens = Math.ceil((Math.max(0, billedChars) * ttsRate(voice)) / EQUIV_USD_PER_M);
  return { model: `${EQUIV_MODEL}-cloud-tts-${voice.toLowerCase()}`.slice(0, 80), usage: { candidatesTokenCount: tokens } };
}

/** Record one successful Cloud TTS synthesis of `billedChars` characters with `voice`. */
export function recordCloudTts(voice: string, billedChars: number): void {
  current.getStore()?.addUsage(cloudTtsUsage(voice, billedChars));
}
