/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Adaptive AI opponents ("dynamic difficulty"). The AI's skill follows the human players: it starts near
 * the humans' observed accuracy, eases off when it is ahead and pushes harder when it is behind, so humans
 * can always win but the game never feels one-sided. Every game maps the 0..1 skill onto its own AI
 * decisions (chance of a right answer, size of a guessing error, buzz delay, letter quality…).
 */

export interface AdaptiveSkillInput {
  /** The leading human (or human team) score so far. */
  humanScore: number;
  /** This AI's score so far. */
  aiScore: number;
  /** About how many points one good turn / round is worth; the lead is measured in these units. */
  scale: number;
  /** How far through the game, 0..1. Late in the game an AI that is ahead eases off more. */
  progress?: number;
  /** Observed human accuracy 0..1 (see createSkillTracker). Omit to use base only. */
  humanAccuracy?: number;
  /** Starting skill with no history. Default 0.6. */
  base?: number;
  /** Floor and ceiling. Defaults 0.2 and 0.88. */
  min?: number;
  max?: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Returns the AI's skill for its next move, 0..1. */
export function adaptiveSkill(i: AdaptiveSkillInput): number {
  const base = i.base ?? 0.6;
  const lo = i.min ?? 0.2;
  const hi = i.max ?? 0.88;
  // Mirror the humans: an AI a little below the human's level, blended with the base.
  let s = i.humanAccuracy == null ? base : 0.4 * base + 0.6 * clamp(i.humanAccuracy * 0.95, 0, 1);
  // Rubber band on the score gap, in "turns". tanh keeps it smooth and bounded.
  const gap = (i.aiScore - i.humanScore) / Math.max(1, i.scale);
  s -= 0.28 * Math.tanh(gap);
  // Endgame: if the AI is ahead, give humans a real chance to catch up.
  const p = clamp(i.progress ?? 0, 0, 1);
  if (gap > 0 && p > 0.6) s -= 0.15 * Math.min(1, gap) * ((p - 0.6) / 0.4);
  return clamp(s, lo, hi);
}

/** True with probability = skill. Pass a seeded rng for tests. */
export function aiSucceeds(skill: number, rng: () => number = Math.random): boolean {
  return rng() < clamp(skill, 0, 1);
}

/**
 * Maps skill onto an error size: skill 1 → minError, skill 0 → maxError, with a bit of randomness.
 * Handy for numeric guesses (prices, estimates).
 */
export function skillToError(skill: number, minError: number, maxError: number, rng: () => number = Math.random): number {
  const s = clamp(skill, 0, 1);
  const target = maxError - (maxError - minError) * s;
  return target * (0.6 + rng() * 0.8);
}

/** Maps skill onto a delay (ms): better AIs answer sooner. */
export function skillToDelay(skill: number, fastMs: number, slowMs: number, rng: () => number = Math.random): number {
  const s = clamp(skill, 0, 1);
  return Math.round((slowMs - (slowMs - fastMs) * s) * (0.75 + rng() * 0.5));
}

export interface SkillTracker {
  /** Record one human attempt (right / wrong, or a 0..1 quality). */
  record(result: boolean | number): void;
  /** Smoothed accuracy 0..1 (starts at the prior). */
  readonly accuracy: number;
  readonly attempts: number;
  reset(): void;
}

/** Running estimate of how well the humans are doing, smoothed toward a prior so one lucky turn doesn't swing it. */
export function createSkillTracker(prior = 0.6, weight = 4): SkillTracker {
  let hits = prior * weight;
  let n = weight;
  let attempts = 0;
  return {
    record(result) {
      const v = typeof result === 'number' ? clamp(result, 0, 1) : result ? 1 : 0;
      hits += v;
      n += 1;
      attempts += 1;
    },
    get accuracy() {
      return hits / n;
    },
    get attempts() {
      return attempts;
    },
    reset() {
      hits = prior * weight;
      n = weight;
      attempts = 0;
    },
  };
}
