/* generated from app-platform/ui-kit — edit there and re-sync. */
import { fetchJson } from './fetchJson';
import { isNativeApp, nativePlatform } from './native';

/** Where reports go (mohitgoenka.com forwards them to Mohit). Cross-origin from the app subdomains; no credentials. */
export const REPORT_CONTENT_URL = 'https://mohitgoenka.com/api/report-content';

export type ReportReason = 'offensive' | 'inappropriate' | 'inaccurate' | 'other';

export const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string; hint: string }> = [
  { value: 'offensive', label: 'Offensive or hateful', hint: 'Insults, slurs, stereotypes, harassment' },
  { value: 'inappropriate', label: 'Inappropriate or unsafe', hint: 'Sexual, violent, dangerous or not family-friendly' },
  { value: 'inaccurate', label: 'Wrong or misleading', hint: 'Incorrect answer, fact or advice' },
  { value: 'other', label: 'Something else', hint: 'Tell us in the note' },
];

/** Server-enforced caps (characters). The client trims to these before sending. */
export const REPORT_LIMITS = { kind: 32, content: 1200, note: 300 } as const;

export interface ReportContentInput {
  /** The app's id — its repo/subdomain name, e.g. 'spinner', 'jeopardy', 'eve'. Must be on the server allow-list. */
  app: string;
  /** What is being reported: 'question', 'clue', 'board', 'answer', 'recipe', 'plan', 'itinerary', 'image', 'chat'… (a-z, 0-9, -). */
  kind: string;
  /** The AI-generated text (or a description / URL of an AI image). Trimmed to REPORT_LIMITS.content. */
  content: string;
  reason: ReportReason;
  /** Optional note from the user. Trimmed to REPORT_LIMITS.note. */
  note?: string;
}

// C0/C1 control characters except tab/newline, plus bidi overrides and zero-width joiners used for spoofing.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

function clean(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return Array.from(s.replace(CONTROL_RE, '').trim()).slice(0, max).join('');
}

/**
 * Send a report about AI-generated content. Resolves on success; throws a FetchError (user-safe `message`)
 * otherwise. Sends only what you pass plus the platform ('web' / 'android'): no cookies, no identifiers.
 */
export async function reportContent({ app, kind, content, reason, note }: ReportContentInput): Promise<void> {
  const body = {
    app: clean(app, 32).toLowerCase(),
    kind: clean(kind, REPORT_LIMITS.kind).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'content',
    reason,
    content: clean(content, REPORT_LIMITS.content),
    note: clean(note, REPORT_LIMITS.note),
    platform: isNativeApp() ? (nativePlatform() ?? 'android') : 'web',
  };
  await fetchJson<{ ok: boolean }>(REPORT_CONTENT_URL, { method: 'POST', body, timeoutMs: 10000, retries: 1, credentials: 'omit' });
}
