// Synced from app-platform/ui-kit/utils/backupProtocol.ts. Do not edit here. VERSION 9935b39 2026-11-27T19:06:06Z
/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Backup / sync wire format, shared by the browser engine (utils/backup.ts) and the server
 * (server-kit/backup, vendored next to this file as server/backup/protocol.ts). No imports and no enums, so Node
 * runs it as-is.
 *
 * A "space" is everything one private key can read. The key is 32 characters from KEY_ALPHABET (31 symbols, about
 * 158 bits), made on the device and never shown to anyone but the user. The server stores sha256(`${app}:${key}`)
 * only. Records are last-writer-wins by the client's updatedAt.
 */

export interface SyncRecord {
  id: string;
  /** What the record is, e.g. 'friend', 'theme', 'k' (a whole localStorage key). */
  kind: string;
  /** Client clock (ms) of the last change: the newer copy wins. */
  updatedAt: number;
  deleted?: boolean;
  data: unknown;
}

export interface SyncRequest {
  /** Server cursor from the previous answer (0 the first time). */
  since: number;
  records: SyncRecord[];
}

export interface SyncResponse {
  cursor: number;
  records: SyncRecord[];
  more: boolean;
}

export const LIMITS = {
  recordsPerRequest: 200,
  recordsPerResponse: 400,
  recordsPerSpace: 20_000,
  /** JSON length of one record's data. */
  dataBytes: 400_000,
  /** Request body cap on the server; the client keeps each push under pushBytes. */
  bodyBytes: 2_000_000,
  pushBytes: 1_400_000,
  /** The server stops filling an answer past this many bytes of data (at least one record is always sent). */
  responseBytes: 3_000_000,
} as const;

export const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const KIND_RE = /^[a-z][A-Za-z0-9_-]{0,31}$/;
export const APP_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Keys and link codes use this alphabet (no 0/O/1/I/L). Keys are shown in groups of four. */
export const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const KEY_LENGTH = 32;
export const LINK_CODE_LENGTH = 6;
export const LINK_TTL_MS = 10 * 60_000;

function normalizeCode(raw: string, len: number): string | null {
  const k = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.length !== len) return null;
  for (const ch of k) if (!KEY_ALPHABET.includes(ch)) return null;
  return k;
}

export const normalizeKey = (raw: string): string | null => normalizeCode(raw, KEY_LENGTH);
export const normalizeLinkCode = (raw: string): string | null => normalizeCode(raw, LINK_CODE_LENGTH);

export function formatKey(key: string): string {
  return key.replace(/(.{4})(?=.)/g, '$1-');
}

/** Uniform random string from KEY_ALPHABET (rejection sampling: 31 * 8 = 248, so b % 31 is unbiased below 248). */
export function randomCode(length: number, randomBytes: (n: number) => Uint8Array): string {
  let s = '';
  while (s.length < length) {
    for (const b of randomBytes(48)) {
      if (b < KEY_ALPHABET.length * 8 && s.length < length) s += KEY_ALPHABET[b % KEY_ALPHABET.length];
    }
  }
  return s;
}

/** Validates one record from the network. `kinds` limits the kinds an app accepts. Returns a clean copy or null. */
export function cleanRecord(v: unknown, kinds?: readonly string[]): SyncRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (typeof r.kind !== 'string' || !KIND_RE.test(r.kind)) return null;
  if (kinds && !kinds.includes(r.kind)) return null;
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt) || r.updatedAt < 0) return null;
  const deleted = r.deleted === true;
  const data = deleted ? null : r.data;
  if (!deleted && (data === null || typeof data !== 'object')) return null;
  let size = 0;
  try {
    size = JSON.stringify(data).length;
  } catch {
    return null;
  }
  if (size > LIMITS.dataBytes) return null;
  return { id: r.id, kind: r.kind, updatedAt: Math.floor(r.updatedAt), ...(deleted ? { deleted: true } : {}), data };
}

/** Backup file ("Export to file"): every live record of one app. */
export interface BackupFile {
  format: 'mg-backup';
  version: 1;
  app: string;
  exportedAt: string;
  records: SyncRecord[];
}

export function parseBackupFile(text: string, app: string, kinds?: readonly string[]): SyncRecord[] | { error: 'not_backup' | 'other_app' } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: 'not_backup' };
  }
  const f = v as Partial<BackupFile> | null;
  if (!f || f.format !== 'mg-backup' || !Array.isArray(f.records)) return { error: 'not_backup' };
  if (f.app !== app) return { error: 'other_app' };
  const out: SyncRecord[] = [];
  for (const r of f.records) {
    const c = cleanRecord(r, kinds);
    if (c) out.push(c);
  }
  return out;
}

// ---------- backup family: one key for every app (docs/backup-family.md) ----------

/**
 * One app's view of the shared backup. `key` + `at` (when a person last linked / restored, 0 for a key an app made
 * itself); `on` + `onAt` (the backup switch a person last set in any app, null / 0 = never).
 */
export interface FamilyRecord {
  key: string | null;
  at: number;
  on: boolean | null;
  onAt: number;
}

const famNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e15 ? Math.floor(v) : null);

/** A valid record or null (from JSON, a cookie, another app). */
export function cleanFamilyRecord(v: unknown): FamilyRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const key = o.key === null || o.key === undefined || o.key === '' ? null : typeof o.key === 'string' ? (normalizeKey(o.key) ?? undefined) : undefined;
  const at = famNum(o.at ?? 0);
  const onAt = famNum(o.onAt ?? 0);
  const on = o.on === true || o.on === false ? o.on : o.on === null || o.on === undefined ? null : undefined;
  if (key === undefined || at === null || onAt === null || on === undefined) return null;
  if (!key && !onAt) return null;
  return { key, at: key ? at : 0, on: onAt ? on : null, onAt: on === null ? 0 : onAt };
}

/** Cookie value: "v1.<key|_>.<at>.<1|0|_>.<onAt>". */
export function encodeFamilyCookie(r: FamilyRecord): string {
  return ['v1', r.key ?? '_', r.at, r.on === null ? '_' : r.on ? '1' : '0', r.onAt].join('.');
}
export function decodeFamilyCookie(s: string): FamilyRecord | null {
  const p = String(s ?? '').split('.');
  if (p.length !== 5 || p[0] !== 'v1') return null;
  return cleanFamilyRecord({ key: p[1] === '_' ? null : p[1], at: Number(p[2]), on: p[3] === '_' ? null : p[3] === '1', onAt: Number(p[4]) });
}

/** Key: largest `at`, tie → smallest key. Switch: largest `onAt` > 0. Null when nothing is known. */
export function mergeFamily(list: readonly (FamilyRecord | null | undefined)[]): FamilyRecord | null {
  let k: FamilyRecord | null = null;
  let s: FamilyRecord | null = null;
  for (const r of list) {
    if (!r) continue;
    if (r.key && (!k || r.at > k.at || (r.at === k.at && r.key < k.key!))) k = r;
    // Same moment: off wins, so a tie never turns backup on.
    if (r.onAt > 0 && r.on !== null && (!s || r.onAt > s.onAt || (r.onAt === s.onAt && r.on === false))) s = r;
  }
  if (!k && !s) return null;
  return { key: k?.key ?? null, at: k?.at ?? 0, on: s?.on ?? null, onAt: s?.onAt ?? 0 };
}

export interface FamilyMine {
  /** null: no key yet, or one never used with the cloud. */
  key: string | null;
  at: number;
  on: boolean;
  /** 0: the person never set the switch in this app. */
  onAt: number;
}

/** What this app should do given the family (docs/backup-family.md, steps 2-4). */
/**
 * `publish`: what to write to a shared store (the website cookie) when this app knows better than it.
 * `own`: this app's record after the plan (Android: every app keeps its own copy for the others to read).
 */
export function planFamily(mine: FamilyMine, f: FamilyRecord | null): { adoptKey: string | null; at: number; setOn: boolean | null; onAt: number; publish: FamilyRecord | null; own: FamilyRecord | null } {
  let key = mine.key;
  let at = mine.at;
  let adoptKey: string | null = null;
  if (f?.key && f.key !== key && (!key || f.at > at || (f.at === at && f.key < key))) {
    adoptKey = f.key;
    key = f.key;
    at = f.at;
  }
  let on = mine.on;
  let onAt = mine.onAt;
  let setOn: boolean | null = null;
  if (f && f.on !== null && f.onAt > onAt) {
    setOn = f.on;
    on = f.on;
    onAt = f.onAt;
  }
  const mineNow: FamilyRecord = { key, at: key ? at : 0, on: onAt ? on : null, onAt: onAt || 0 };
  const merged = mergeFamily([f, mineNow]);
  const same = (a: FamilyRecord | null, b: FamilyRecord | null) => !!a && !!b && a.key === b.key && a.at === b.at && a.on === b.on && a.onAt === b.onAt;
  const own = merged && (merged.key || merged.onAt) ? merged : null;
  const publish = own && !same(own, f) ? own : null;
  return { adoptKey, at, setOn, onAt, publish, own };
}
