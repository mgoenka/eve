import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eveningIcs } from './ics';

test('one event per stop at its arrival time, past midnight on the next day', () => {
  const ics = eveningIcs({
    title: 'Jazz, pasta; gelato',
    city: 'Austin',
    dateISO: '2026-11-26',
    now: new Date(Date.UTC(2026, 10, 26, 12)),
    stops: [
      { kind: 'dinner', name: 'Trattoria', approxArrival: '7:30 PM', durationMinutes: 90 },
      { kind: 'live_music', name: 'Jazz Club', approxArrival: '11:30 PM', durationMinutes: 60 },
      { kind: 'dessert', name: 'Late Gelato', approxArrival: '12:40 AM', durationMinutes: 30 },
    ],
  });
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 3);
  assert.match(ics, /DTSTART:20261126T193000\r\nDTEND:20261126T210000/);
  assert.match(ics, /DTSTART:20261126T233000/);
  assert.match(ics, /DTSTART:20261127T004000/);
  assert.match(ics, /SUMMARY:Live music: Jazz Club/);
  assert.match(ics.replace(/\r\n /g, ''), /Jazz\\, pasta\\; gelato/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});
