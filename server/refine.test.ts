import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepPlanShape, refinePrompt } from './refine.ts';

const prev = [
  { kind: 'drinks', name: 'Bar One', oneLineVibe: 'Low lights', approxArrival: '7:00 PM', signatureItem: 'Negroni' },
  { kind: 'dinner', name: 'Trattoria Two', oneLineVibe: 'Handmade pasta', approxArrival: '8:00 PM' },
  { kind: 'dessert', name: 'Gelato Three', oneLineVibe: 'Pistachio', approxArrival: '9:30 PM' },
  { kind: 'music', name: 'Jazz Four', oneLineVibe: 'Late set', approxArrival: '10:15 PM' },
];
const base = { userMessage: 'Make it cheaper', previousStops: prev, vibe: 'date_night', city: 'Austin', party: 2, dietary: [], budgetUSD: 100 };

test('a tweak keeps the stop count, order and kinds, and the area', () => {
  const p = refinePrompt({ ...base, adjust: true });
  assert.match(p, /This is a tweak to the evening above, not a new evening/);
  assert.match(p, /exactly 4 stops in the same order/);
  assert.match(p, /1\. drinks, 2\. dinner, 3\. dessert, 4\. music/);
  assert.match(p, /same neighborhood of Austin/);
  assert.match(p, /\.\.\.4 stops total/);
  assert.doesNotMatch(p, /Produce a NEW/);
  assert.match(p, /Stop 1: Bar One \(drinks\) at 7:00 PM — Low lights \[order: Negroni\]/);
  assert.match(p, /budget ~\$100/);
});

test('a typed change may still reshape the evening', () => {
  const p = refinePrompt({ ...base, userMessage: 'add a late snack', adjust: false });
  assert.match(p, /Produce a NEW 4-stop plan/);
  assert.match(p, /more or fewer stops only if they ask/);
});

test('keepPlanShape: same count and kinds, dropped slots keep the old stop', () => {
  const out = [
    { kind: 'drinks', name: 'Cheap Bar' },
    { kind: 'drinks', name: 'Taco Truck' },
  ];
  const shaped = keepPlanShape(out, prev, (p) => ({ kind: p.kind, name: p.name as string }));
  assert.deepEqual(shaped.map((s) => s.kind), ['drinks', 'dinner', 'dessert', 'music']);
  assert.deepEqual(shaped.map((s) => s.name), ['Cheap Bar', 'Taco Truck', 'Gelato Three', 'Jazz Four']);
  const longer = keepPlanShape([...out, ...out, ...out], prev, (p) => ({ kind: p.kind, name: p.name as string }));
  assert.equal(longer.length, 4);
});
