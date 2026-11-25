import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAiFixtures } from './ai-guard.ts';
import { TEST_MODE_SPECIAL_ID, saveSpecial } from './specials.ts';

const special = { restaurantName: 'Test Bistro', city: 'Austin', dishName: 'Soup' };

test('test mode: publishing a special stores nothing and says so', async () => {
  const prev = process.env.AI_LIVE;
  process.env.AI_LIVE = '1'; // a live process; only this request is automated
  try {
    const writes: unknown[] = [];
    const out = await withAiFixtures(() => saveSpecial(special, async (r) => { writes.push(r); return 'real-id'; }));
    assert.deepEqual(out, { ok: true, id: TEST_MODE_SPECIAL_ID, testMode: true });
    assert.equal(writes.length, 0);
  } finally {
    if (prev === undefined) delete process.env.AI_LIVE; else process.env.AI_LIVE = prev;
  }
});

test('live mode: publishing a special writes it to the index', async () => {
  const prev = process.env.AI_LIVE;
  process.env.AI_LIVE = '1';
  try {
    const writes: unknown[] = [];
    const out = await saveSpecial(special, async (r) => { writes.push(r); return 'real-id'; });
    assert.deepEqual(out, { ok: true, id: 'real-id' });
    assert.deepEqual(writes, [special]);
  } finally {
    if (prev === undefined) delete process.env.AI_LIVE; else process.env.AI_LIVE = prev;
  }
});

test('local dev without AI_LIVE is test mode too', async () => {
  const saved = { AI_LIVE: process.env.AI_LIVE, K_SERVICE: process.env.K_SERVICE };
  delete process.env.AI_LIVE;
  delete process.env.K_SERVICE;
  try {
    let wrote = false;
    const out = await saveSpecial(special, async () => { wrote = true; return 'real-id'; });
    assert.equal(out.testMode, true);
    assert.equal(wrote, false);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
