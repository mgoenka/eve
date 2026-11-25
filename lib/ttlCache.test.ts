import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from './ttlCache.ts';
import { withAiFixtures } from '../server/ai-guard.ts';

test('free AI test mode answers never mix with real ones', () => {
  const prev = process.env.AI_LIVE;
  process.env.AI_LIVE = '1';
  try {
    const c = new TtlCache<string>({ maxEntries: 10, ttlMs: 60_000 });
    withAiFixtures(() => c.set('k', 'fixture'));
    assert.equal(c.get('k'), undefined);
    c.set('k', 'real');
    assert.equal(c.get('k'), 'real');
    assert.equal(withAiFixtures(() => c.get('k')), 'fixture');
    c.delete('k');
    assert.equal(c.get('k'), undefined);
    assert.equal(withAiFixtures(() => c.get('k')), 'fixture');
  } finally {
    if (prev === undefined) delete process.env.AI_LIVE;
    else process.env.AI_LIVE = prev;
  }
});
