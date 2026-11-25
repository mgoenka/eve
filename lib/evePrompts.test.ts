import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStory, cleanStoryStrict, isEcho, narrationPrompt, storyJsonSchema, storyPrompt } from './evePrompts.ts';

const stop = (n: number) => ({ name: `Venue ${n}`, kind: 'dinner', oneLineVibe: 'warm' });
const base = { opening: 'o', atStop1: 'a1', transition1to2: 't12', atStop2: 'a2', closing: 'c', moodArc: 'm', weatherCue: 'w' };

test('story prompt names the real number of stops', () => {
  const p2 = storyPrompt({ title: 'T', stops: [stop(1), stop(2)], vibe: 'casual', city: 'Austin, TX', party: 2 });
  assert.match(p2, /The 2 stops you planned/);
  assert.match(p2, /there is no Stop 3/);
  const p5 = storyPrompt({ title: 'T', stops: [1, 2, 3, 4, 5].map(stop), vibe: 'casual', city: 'Austin, TX', party: 2 });
  assert.match(p5, /exactly 2 strings/);
  assert.match(p5, /Venue 5/);
  assert.doesNotMatch(p5, /Bay Area/);
});

test('a 2-stop story needs no Stop 3 beats', () => {
  const s = cleanStory(base, 2);
  assert.ok(s);
  assert.equal(s!.atStop3, '');
  assert.deepEqual(s!.laterStops, []);
  assert.equal(cleanStory(base, 3), null);
  assert.deepEqual(storyJsonSchema(2).required.includes('atStop3'), false);
});

test('later stops are kept, never more than the plan has', () => {
  const s = cleanStory({ ...base, transition2to3: 't', atStop3: 'a3', laterStops: ['a4', 'a5', 'a6', 'a7'] }, 5);
  assert.deepEqual(s!.laterStops, ['a4', 'a5']);
  // On-device answers must carry every later beat.
  assert.equal(cleanStoryStrict({ ...base, transition2to3: 't', atStop3: 'a3', laterStops: ['a4'] }, 5), null);
});

test('the mic hearing Eve back is an echo; the user talking over her is not', () => {
  const line = 'You walk into Lucca Osteria and the candlelight finds you first.';
  assert.equal(isEcho('walk into Lucca Osteria and the candlelight', line), true);
  assert.equal(isEcho('swap the second stop for live music', line), false);
  assert.equal(isEcho('no', line), false);
});

test('the narration is in Eve\'s voice for the vibe', () => {
  const p = narrationPrompt({ title: 'T', vibe: 'friends', stops: [{ kind: 'dinner', name: 'Venue 1', approxArrival: '7:00 PM', oneLineVibe: 'loud', whyThisFits: 'fun' }] });
  assert.match(p, /You are Eve/);
  assert.match(p, /playful/);
});
