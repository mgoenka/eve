/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useState } from 'react';
import { cx } from '../utils/cx';

export interface PublicCounterProps {
  /** 'game': "2,600 games played · 140 players this week"; 'tool': "1,850 people this week". Default 'game'. */
  kind?: 'game' | 'tool';
  className?: string;
}

interface Totals {
  games: number | null;
  gamesWeek: number | null;
  players: number | null;
  playersWeek: number | null;
}

let cache: Promise<Totals | null> | null = null;
function load(): Promise<Totals | null> {
  cache ??= fetch('/api/pulse/public', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { app?: Totals | null } | null) => j?.app ?? null)
    .catch(() => null);
  return cache;
}

/**
 * A quiet line with this app's public totals from the anonymous usage counts (rounded; each number stays hidden
 * until it passes the public threshold, so a new app shows nothing). Renders nothing while loading or offline.
 */
export function PublicCounter({ kind = 'game', className }: PublicCounterProps) {
  const [t, setT] = useState<Totals | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((v) => alive && setT(v));
    return () => {
      alive = false;
    };
  }, []);
  if (!t) return null;
  const fmt = (n: number) => n.toLocaleString();
  // As approved in the mockup: small muted text with the numbers in gold.
  const parts: Array<[number, string]> = [];
  if (kind === 'game' && t.games) parts.push([t.games, 'games played']);
  if (t.playersWeek) parts.push([t.playersWeek, `${kind === 'game' ? 'players' : 'people'} this week`]);
  if (!parts.length) return null;
  return (
    <p className={cx('text-xs text-mg-muted', className)}>
      {parts.map(([n, label], i) => (
        <span key={label}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className="font-semibold tabular-nums text-mg-gold">{fmt(n)}</span> {label}
        </span>
      ))}
    </p>
  );
}

export default PublicCounter;
