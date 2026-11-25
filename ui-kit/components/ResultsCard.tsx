/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef } from 'react';
import type { ScoreCardData, ScoreCardFormat } from '../utils/scoreCard';
import { SCORE_CARD_SIZES, drawScoreCard, scoreCardAccent, scoreVideoDuration } from '../utils/scoreCard';
import { cx } from '../utils/cx';
import { reportToScorer } from '../utils/scorerFeed';

export interface ResultsCardProps {
  /** The same data the share sheet uses: the final screen is the share card itself. */
  data: ScoreCardData;
  /** 'post' (4:5, default) or 'story' (9:16). */
  format?: ScoreCardFormat;
  /** Play the reveal animation once when it mounts (skipped with reduced motion). Default true. */
  animate?: boolean;
  /** Send the result to Mohit's Scorer when Mohit played (see utils/scorerFeed). Default true. */
  report?: boolean;
  className?: string;
}

const reducedMotion = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * The game-over screen's results: the share card drawn live (winner in their own color, leaderboard and the
 * named highlight stats), with the reveal animation. Sized to fit: full width on phones, at most ~68vh tall.
 * Screen readers get the same content as text.
 */
export function ResultsCard({ data, format = 'post', animate = true, report = true, className }: ResultsCardProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = SCORE_CARD_SIZES[format];
  // Re-renders often hand over an equal but new data object (a sync, a socket tick): only a real change replays the reveal.
  const key = JSON.stringify(data);
  const stable = useRef(data);
  if (JSON.stringify(stable.current) !== key) stable.current = data;
  const shown = stable.current;

  useEffect(() => {
    if (report) reportToScorer(shown);
  }, [shown, report]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!animate || reducedMotion()) {
      drawScoreCard(ctx, shown, format, Infinity);
      return;
    }
    let raf = 0;
    const total = scoreVideoDuration(shown) - 1.5;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total || document.hidden) {
        drawScoreCard(ctx, shown, format, Infinity);
        return;
      }
      drawScoreCard(ctx, shown, format, t);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [shown, format, animate]);

  const accent = scoreCardAccent(data);
  const summary = [
    data.headline,
    data.subline,
    ...(data.players || []).map((p, i) => `${i + 1}. ${p.name}${p.ai ? ' (AI)' : ''}: ${typeof p.score === 'number' ? p.score.toLocaleString() + (data.scoreSuffix ? ' ' + data.scoreSuffix : '') : p.score}${p.note ? ', ' + p.note : ''}`),
    ...(data.stats || []).map((s) => `${s.label}: ${s.value}${s.who ? ' (' + s.who + ')' : ''}`),
  ].filter(Boolean).join('. ');

  return (
    <figure className={cx('mx-auto w-full', className)} style={{ maxWidth: `min(100%, calc(68vh * ${w / h}))` }}>
      <canvas
        ref={ref}
        width={w}
        height={h}
        role="img"
        aria-label={summary}
        className="block h-auto w-full rounded-2xl border shadow-mg-card"
        style={{ aspectRatio: `${w} / ${h}`, borderColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent + '55' : undefined }}
      />
    </figure>
  );
}

export default ResultsCard;
