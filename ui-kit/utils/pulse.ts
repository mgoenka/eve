/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Pulse from app code: anonymous usage counts (see ui-kit/pulse.js and server-kit/pulse).
 *   trackPulse('use')            something got made or done (a recipe, a plan, a spin…)
 *   trackGamePulse(scoreCard)    a game finished; ResultsCard already calls this
 * Both are no-ops where pulse.js isn't loaded (dev server, tests, automated browsers).
 */
import type { ScoreCardData } from './scoreCard';

type PulseFn = (event: 'game' | 'use', fingerprint?: string) => void;
const pulse = (): PulseFn | undefined => (typeof window !== 'undefined' ? (window as unknown as { mgPulse?: PulseFn }).mgPulse : undefined);

export function trackPulse(event: 'use' | 'game' = 'use') {
  try {
    pulse()?.(event);
  } catch {
    /* never let stats break the app */
  }
}

/** Two 32-bit FNV-1a hashes side by side: 16 hex characters. Not security, just "same game?". */
function fnv16(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * Every screen in a party game shows the same final scores, so they share one fingerprint and the game counts once.
 * The 15-minute window keeps two identical solo results on the same day apart.
 */
export function gameFingerprint(data: ScoreCardData, now = Date.now()): string | undefined {
  const players = (data.players || []).map((p) => `${p.name}\u0001${p.score}`).sort();
  if (!players.length) return undefined;
  return fnv16([data.app, Math.floor(now / (15 * 60_000)), ...players].join('\u0002'));
}

export function trackGamePulse(data: ScoreCardData) {
  try {
    pulse()?.('game', gameFingerprint(data));
  } catch {
    /* never let stats break the app */
  }
}
