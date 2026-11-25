import { aiFixturesActive } from './ai-guard.ts';

/** Id returned for a special "published" in free AI test mode; nothing is stored under it. */
export const TEST_MODE_SPECIAL_ID = 'test-mode';

export type SaveSpecialResult = { ok: true; id: string; testMode?: true };

/**
 * Publishes a special to the dining index, except in free AI test mode (smoke tests, automated browsers,
 * local dev without AI_LIVE=1): then nothing is written, so test runs never reach the real index or its
 * metrics, and the caller gets `testMode: true` to say so.
 */
export async function saveSpecial<T>(record: T, add: (r: T) => Promise<string>): Promise<SaveSpecialResult> {
  if (aiFixturesActive()) return { ok: true, id: TEST_MODE_SPECIAL_ID, testMode: true };
  return { ok: true, id: await add(record) };
}
