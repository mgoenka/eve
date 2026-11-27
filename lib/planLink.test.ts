import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePlanLink } from '../services/dinerSnapshot.ts';

test('a city page link keeps just its city and vibe', () => {
  assert.deepEqual(sanitizePlanLink({ city: 'Austin, TX', vibe: 'date_night' }), { city: 'Austin, TX', vibe: 'date_night' });
});

test('wrong-typed link fields are dropped or clamped, never passed through', () => {
  const out = sanitizePlanLink({ city: { a: 1 }, vibe: 'nope', dietary: 'vegan', party: 'x', durationHours: 99, startTime: 5, budgetPerPerson: -4 });
  assert.ok(out);
  assert.equal(out.city, undefined);
  assert.equal(out.vibe, undefined);
  assert.equal(out.dietary, undefined);
  assert.equal(out.party, 2);
  assert.equal(out.durationHours, 8);
  assert.equal(out.startTime, undefined);
  assert.equal(out.budgetPerPerson, 5);
});

test('unknown dietary ids are removed and non-objects are refused', () => {
  assert.deepEqual(sanitizePlanLink({ dietary: ['vegan', 'pizza', 3] })?.dietary, ['vegan']);
  assert.equal(sanitizePlanLink('x'), null);
  assert.equal(sanitizePlanLink([1, 2]), null);
});
