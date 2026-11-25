import type { ScoreCardData } from './scoreCard';

/**
 * Mohit's Scorer collects finished games from the other apps: when a results card shows a player named
 * Mohit, the result is sent once to scorer.mohitgoenka.com, which keeps it for Mohit's own Scorer history.
 * Fire-and-forget: a plain-text no-cors POST (no preflight), never blocks or fails the game.
 * Each app's CSP connect-src must allow https://scorer.mohitgoenka.com.
 */
export const SCORER_FEED_URL = 'https://scorer.mohitgoenka.com/api/feed';
const OWNER = /^mohit$/i;

const sent = new Set<string>();

export function hasOwner(data: ScoreCardData): boolean {
  return (data.players ?? []).some((p) => !p.ai && OWNER.test(String(p.name).trim()));
}

export function reportToScorer(data: ScoreCardData): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (!/(^|\.)mohitgoenka\.com$/.test(location.hostname) || location.hostname === 'scorer.mohitgoenka.com') return;
    if (!hasOwner(data) || (data.players?.length ?? 0) < 2) return;
    const body = JSON.stringify({
      app: data.app,
      url: data.url,
      emoji: data.emoji,
      headline: data.headline,
      players: (data.players ?? []).slice(0, 16).map((p) => ({ name: String(p.name).slice(0, 40), score: p.score, winner: !!p.winner, ai: !!p.ai })),
      at: Date.now(),
    });
    if (sent.has(body.replace(/"at":\d+/, ''))) return;
    sent.add(body.replace(/"at":\d+/, ''));
    void fetch(SCORER_FEED_URL, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'content-type': 'text/plain' }, body }).catch(() => {});
  } catch {
    /* never let reporting break a game */
  }
}
