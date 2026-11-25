// Arrival times on a plan: worked out from the start time and each stop's length and walk, so the cards always
// add up (the model is asked for this, but its clock arithmetic drifts).

/** "7:30 PM", "7 pm", "19:30" -> minutes after midnight, or null. */
export function parseClock(text: string): number | null {
  const m = String(text || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i) || String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (min > 59) return null;
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** Minutes after midnight (wrapping past midnight) -> "7:30 PM". */
export function clockLabel(minutes: number): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * Stop 1 arrives at `start` (or the model's own Stop 1 time when no start is given); every later stop arrives
 * when the one before ends plus the walk. Stops whose times can't be read are left as the model wrote them
 * only when there is no anchor at all.
 */
export function normalizeArrivals<T extends { approxArrival: string; durationMinutes: number; walkMinutesFromPrev: number }>(
  stops: T[],
  start?: string,
): T[] {
  if (!stops.length) return stops;
  const anchor = (start ? parseClock(start) : null) ?? parseClock(stops[0].approxArrival);
  if (anchor === null) return stops;
  let at = anchor;
  return stops.map((s, i) => {
    if (i > 0) at += Math.max(0, stops[i - 1].durationMinutes || 0) + Math.max(0, s.walkMinutesFromPrev || 0);
    return { ...s, ...(i === 0 ? { walkMinutesFromPrev: 0 } : {}), approxArrival: clockLabel(at) };
  });
}
