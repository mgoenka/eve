// "Add to calendar": a finished evening as an .ics file, one event per stop at its arrival time.
// Built on the device and downloaded; nothing is sent anywhere. Times are floating local times (no time zone),
// so the calendar shows them as written on the cards wherever it is opened.
import { parseClock } from '../server/planTimes';

export interface IcsStop {
  kind: string;
  name: string;
  oneLineVibe?: string;
  signatureItem?: string;
  approxArrival: string;
  durationMinutes: number;
}

const KIND_LABEL: Record<string, string> = {
  dinner: 'Dinner',
  dessert: 'Dessert',
  drink: 'Drinks',
  walk: 'Walk',
  live_music: 'Live music',
  view: 'View',
  activity: 'Activity',
};

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 folding). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * The calendar file for an evening on `dateISO` (YYYY-MM-DD). A stop whose time is earlier than the one before
 * it is after midnight, so it lands on the next day. Stops whose time can't be read follow the previous stop.
 */
export function eveningIcs(opts: { title: string; city: string; dateISO: string; stops: IcsStop[]; now?: Date }): string {
  const [y, m, d] = opts.dateISO.split('-').map(Number);
  const now = opts.now ?? new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mohit Goenka//Eve//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let dayOffset = 0;
  let prevStart: number | null = null;
  let prevEnd: number | null = null;
  opts.stops.forEach((s, i) => {
    let start = parseClock(s.approxArrival);
    if (start === null) start = prevEnd ?? 19 * 60 + 30;
    else {
      start += dayOffset * 1440;
      if (prevStart !== null && start < prevStart) {
        dayOffset++;
        start += 1440;
      }
    }
    const len = Math.max(15, Math.round(s.durationMinutes || 60));
    const begin = new Date(y!, (m ?? 1) - 1, d ?? 1, 0, start);
    const end = new Date(begin.getTime() + len * 60_000);
    prevStart = start;
    prevEnd = start + len;
    const label = KIND_LABEL[s.kind] ?? 'Stop';
    const desc = [s.oneLineVibe, s.signatureItem ? `Order: ${s.signatureItem}` : '', `Stop ${i + 1} of ${opts.stops.length} in ${opts.title}, planned with Eve.`].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${utc(now)}-${i}-${Math.random().toString(36).slice(2, 10)}@eve.mohitgoenka.com`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${local(begin)}`,
      `DTEND:${local(end)}`,
      fold(`SUMMARY:${esc(`${label}: ${s.name}`)}`),
      fold(`LOCATION:${esc(opts.city ? `${s.name}, ${opts.city}` : s.name)}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
