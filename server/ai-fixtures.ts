// Exact free-test-mode answers (see "Free AI test mode" in ai-guard.ts) for the prompts that ask for
// JSON in prose (no responseSchema), plus Cloud Text-to-Speech, which ai-guard doesn't intercept.
import { aiFixturesActive, registerAiFixture } from './ai-guard.ts';

const KINDS = ['dinner', 'dessert', 'drink', 'walk', 'live_music', 'view', 'activity'];
const stops = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    kind: KINDS[i % KINDS.length],
    name: `Test Venue ${i + 1}`,
    oneLineVibe: 'Test answer (free AI test mode).',
    whyThisFits: 'Test answer (free AI test mode).',
    approxArrival: `${7 + i}:00 PM`,
    durationMinutes: 60,
    walkMinutesFromPrev: i ? 10 : 0,
    signatureItem: 'Test dish',
    isEveOriginal: false,
  }));

registerAiFixture(({ prompt }) => {
  if (prompt.includes('Plan a complete multi-stop evening experience')) {
    return { title: 'Test Evening (free AI test mode)', stops: stops(Number(prompt.match(/Plan exactly (\d+) stops/)?.[1]) || 3) };
  }
  if (prompt.includes("You're refining a")) {
    return { spokenReply: 'Test answer (free AI test mode).', title: 'Test Evening (free AI test mode)', stops: stops(3) };
  }
  if (prompt.includes('You are a culinary intelligence agent')) {
    return {
      mode: 'from_trending',
      dishName: 'Test Dish',
      dishDescription: 'Test answer (free AI test mode).',
      rationale: 'Test answer (free AI test mode).',
      alternatives: [{ dishName: 'Test Dish Two', rationale: 'Test answer (free AI test mode).' }],
      recommendedRestaurants: [{ name: 'Test Restaurant', city: 'Test City', dish: 'Test Dish', why: 'Test answer (free AI test mode).' }],
    };
  }
  if (prompt.includes('"signatureDishes": "comma-separated')) return { cuisine: 'fusion', signatureDishes: 'Test Dish, Test Dish Two, Test Dish Three' };
  if (prompt.includes('which of these reservation platforms')) return { opentable: true, resy: true, tock: true };
  if (prompt.includes('What city, neighborhood, or area is at coordinates')) return 'Test City, TX';
  return undefined;
});

// ~0.26 s of silent MP3 (MPEG-1 Layer III frames, 128 kbps, 44.1 kHz mono, all-zero side info).
const FRAME = Buffer.alloc(417);
FRAME.set([0xff, 0xfb, 0x90, 0xc0]);
const SILENT_MP3 = Buffer.concat(Array(10).fill(FRAME)).toString('base64');

/** Base64 MP3 to send instead of calling Cloud TTS, or null when real AI is on. */
export const ttsFixture = (): string | null => (aiFixturesActive() ? SILENT_MP3 : null);
