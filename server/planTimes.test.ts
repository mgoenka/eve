import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockLabel, normalizeArrivals, parseClock } from './planTimes.ts';

test('parseClock reads 12- and 24-hour times', () => {
  assert.equal(parseClock('7:30 PM'), 19 * 60 + 30);
  assert.equal(parseClock('7 pm'), 19 * 60);
  assert.equal(parseClock('12:15 AM'), 15);
  assert.equal(parseClock('12:00 PM'), 720);
  assert.equal(parseClock('19:30'), 19 * 60 + 30);
  assert.equal(parseClock('late'), null);
  assert.equal(parseClock('13:00 PM'), null);
});

test('clockLabel wraps past midnight', () => {
  assert.equal(clockLabel(19 * 60 + 30), '7:30 PM');
  assert.equal(clockLabel(24 * 60 + 20), '12:20 AM');
});

test('normalizeArrivals chains from the start time', () => {
  const stops = [
    { approxArrival: '7:00 PM', durationMinutes: 90, walkMinutesFromPrev: 5 },
    { approxArrival: '8:00 PM', durationMinutes: 45, walkMinutesFromPrev: 10 },
    { approxArrival: 'later', durationMinutes: 60, walkMinutesFromPrev: 15 },
  ];
  const out = normalizeArrivals(stops, '19:30');
  assert.deepEqual(out.map((s) => s.approxArrival), ['7:30 PM', '9:10 PM', '10:10 PM']);
  assert.equal(out[0].walkMinutesFromPrev, 0);
});

test('normalizeArrivals anchors on the model time without a start, and leaves unreadable plans alone', () => {
  const stops = [
    { approxArrival: '6 PM', durationMinutes: 60, walkMinutesFromPrev: 0 },
    { approxArrival: '?', durationMinutes: 60, walkMinutesFromPrev: 10 },
  ];
  assert.deepEqual(normalizeArrivals(stops).map((s) => s.approxArrival), ['6:00 PM', '7:10 PM']);
  const odd = [{ approxArrival: 'dusk', durationMinutes: 60, walkMinutesFromPrev: 0 }];
  assert.deepEqual(normalizeArrivals(odd), odd);
});
