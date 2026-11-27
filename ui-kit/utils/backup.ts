/* generated from app-platform/ui-kit — edit there and re-sync. */
import { FetchError, fetchJson } from './fetchJson';
import { safeGet, safeRemove, safeSet } from './storage';
import { showToast } from './toastBus';
import { KEY_ALPHABET, KEY_LENGTH, LIMITS, cleanFamilyRecord, cleanRecord, mergeFamily, normalizeKey, parseBackupFile, planFamily, randomCode, type BackupFile, type FamilyRecord, type SyncRecord, type SyncResponse } from './backupProtocol';
import { nativeShell } from './nativeShell';

/**
 * Local-first backup and sync (the engine behind BackupModal; Scorer's model, for any app).
 *
 * Everything lives on the device first. Records ({id, kind, updatedAt, data}) are pushed to the app's server
 * (server-kit/backup) under a private 32-character key, debounced after each change, and pulled on open, when the
 * tab comes back, when the network returns and every `pullEveryMs` while visible. The newest change (updatedAt)
 * wins per record. A short one-use link code (or its QR) pairs another device; the recovery key restores a lost one.
 * "Export to file" / "Import from file" work without the cloud.
 *
 * Two ways to use it:
 *   - records you own: `backup.put(kind, id, data)`, `backup.remove(id)`, `backup.live(kind)` (Scorer);
 *   - existing localStorage keys, unchanged app code: `backupKeys(backup, { keys: [...] })` (see below).
 *
 * `encrypt: true` encrypts every record (AES-GCM, key from HKDF of the recovery key) before it leaves the device;
 * the server then only ever stores ciphertext, under a token derived from the key. The key itself reaches the
 * server only while a link code is waiting (10 minutes, one use).
 */

export type BackupSyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'off';

export interface BackupStatus {
  state: BackupSyncState;
  lastSyncAt: number;
  enabled: boolean;
  /** Changes not in the cloud yet. */
  pending: number;
  /** Live records on this device. */
  count: number;
  error?: string;
  /** False when this app backs up to files only. */
  cloud: boolean;
}

export type ApplyReason = 'sync' | 'restore';

export interface BackupOptions {
  /** App id (lowercase, as on the server): 'spinner'. */
  app: string;
  /** Server base, default '/api/backup' (routes: /sync, /link/create, /link/redeem). */
  endpoint?: string;
  /** Default 'x-mg-backup-key'. */
  keyHeader?: string;
  /** localStorage keys. Default `${app}:backup:db:v1`, `${app}:backup:key:v1`, `${app}:backup:prefs:v1`. */
  storageKeys?: { db: string; key: string; prefs: string };
  /** Record kinds the app uses (others from the network are dropped). */
  kinds?: readonly string[];
  /** Cloud backup on until the user turns it off. Default true. */
  defaultEnabled?: boolean;
  /** false: export / import files only, never the network. Default true. */
  cloud?: boolean;
  encrypt?: boolean;
  /** Default 60 s. */
  pullEveryMs?: number;
  /**
   * Stay off the network until there is something to back up (or the user linked / restored a key), so visitors who
   * never make anything cost nothing. Default true.
   */
  lazy?: boolean;
  /**
   * How switching to another key (link code or recovery key) treats this device's data.
   * 'adopt' (default): the backup's copy of every record wins; records only on this device are added to it.
   * 'merge': plain last-writer-wins by updatedAt (Scorer).
   */
  switchMode?: 'adopt' | 'merge';
  /** Keep only {id, kind, updatedAt} on the device and read the data through `dataOf` when pushing (backupKeys). */
  metaOnly?: boolean;
  dataOf?: (rec: SyncRecord) => unknown;
  /** Toast when the device storage is full. */
  storageFullMessage?: string;
  /**
   * One backup for every app (docs/backup-family.md): share the private key and the backup switch with Mohit's other
   * apps in this browser (a cookie on .mohitgoenka.com) or on this Android device (the app shell). Default true.
   */
  family?: boolean;
  /** Where the family record is read / written. Default: the Android shell's bridge, else `${endpoint}/family`. */
  familyTransport?: FamilyTransport;
}

/** Reads every family record this app can see, and stores this app's own. */
export interface FamilyTransport {
  read(): Promise<FamilyRecord[]>;
  write(r: FamilyRecord): Promise<void>;
  /** true: every app keeps its own record (Android), so write it whenever it changes, not only to correct others. */
  perApp?: boolean;
}

/** The Android shell's bridge when it has one, else the app server's cookie route. */
export function defaultFamilyTransport(endpoint = '/api/backup'): FamilyTransport {
  const bridge = (nativeShell() as { backupFamily?: { get?: () => Promise<string>; set?: (json: string) => void } } | null)?.backupFamily;
  if (bridge && typeof bridge.get === 'function' && typeof bridge.set === 'function') {
    return {
      perApp: true,
      async read() {
        const raw = await Promise.race([bridge.get!(), new Promise<string>((r) => setTimeout(() => r('[]'), 4000))]);
        const list = JSON.parse(String(raw || '[]')) as unknown;
        return (Array.isArray(list) ? list : []).map(cleanFamilyRecord).filter((r): r is FamilyRecord => !!r);
      },
      async write(r) {
        bridge.set!(JSON.stringify(r));
      },
    };
  }
  return {
    async read() {
      // mg_bk_on=1 says a record exists (the record itself is httpOnly): no cookie, no request.
      if (typeof document === 'undefined' || !/(?:^|;\s*)mg_bk_on=1(?:;|$)/.test(String(document.cookie ?? ''))) return [];
      const r = cleanFamilyRecord(await fetchJson<unknown>(`${endpoint}/family`, { timeoutMs: 6000 }));
      return r ? [r] : [];
    },
    async write(r) {
      await fetchJson(`${endpoint}/family`, { method: 'POST', body: { record: r }, timeoutMs: 8000 });
    },
  };
}

export interface Backup {
  readonly app: string;
  readonly options: Readonly<BackupOptions>;
  status(): BackupStatus;
  subscribe(fn: () => void): () => void;
  /** Called with records that came from the cloud / a file / a restore, after they are stored. */
  onApplied(fn: (records: SyncRecord[], reason: ApplyReason) => void): () => void;
  /** Called before every push / export so callers can record pending changes (backupKeys scans its keys). */
  beforeSync(fn: () => void): () => void;

  get(id: string): SyncRecord | undefined;
  all(): SyncRecord[];
  live<T = unknown>(kind: string): T[];
  put(kind: string, id: string, data: unknown): void;
  remove(id: string): void;
  newId(prefix: string): string;

  getKey(): string;
  switchKey(raw: string): Promise<boolean>;
  syncNow(): Promise<void>;
  scheduleSync(delay?: number): void;
  setEnabled(on: boolean): void;
  createLinkCode(): Promise<{ code: string; expiresAt: number }>;
  /** true linked, null wrong / expired code. Throws on network trouble. */
  redeemLinkCode(code: string): Promise<boolean | null>;
  /** Check the other apps' shared backup now (start() does it, and again when the app comes back). */
  syncFamily(): Promise<void>;
  /** Start syncing (idempotent). */
  start(): void;

  exportFile(): Promise<BackupFile>;
  downloadFile(): Promise<void>;
  /**
   * Account deletion: delete this key's cloud backup (every record) and forget the backup on this device
   * (records, key, settings). The app clears its own data. Works offline for the device part; throws if the cloud
   * delete fails.
   */
  eraseCloud(): Promise<void>;
  /** Forget the backup on this device only (the cloud copy stays under the recovery key). */
  forgetDevice(): void;
  /** Records in the file are added to this device (the file's copy wins) and then backed up. */
  importFile(file: Blob): Promise<{ imported: number } | { error: 'not_backup' | 'other_app' | 'empty' }>;
}

interface Persisted {
  records: Record<string, SyncRecord>;
  dirty: string[];
  cursor: number;
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hkdf(secret: string, info: string, usage: 'aes' | 'bits'): Promise<CryptoKey | Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('mg-backup-v1'), info: enc.encode(info) };
  if (usage === 'bits') return new Uint8Array(await crypto.subtle.deriveBits(params, base, 256));
  return crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Server token for an encrypted space: 32 alphabet characters derived from the key (not the key itself). */
export async function authTokenFor(app: string, key: string): Promise<string> {
  const bits = (await hkdf(key, `${app}:auth`, 'bits')) as Uint8Array;
  // 32 bytes → 32 characters; the token only has to be unguessable (256 derived bits), not uniform.
  return Array.from(bits.subarray(0, KEY_LENGTH), (b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
}

export function createBackup(opts: BackupOptions): Backup {
  const app = opts.app;
  const endpoint = opts.endpoint ?? '/api/backup';
  const keyHeader = opts.keyHeader ?? 'x-mg-backup-key';
  const keys = opts.storageKeys ?? { db: `${app}:backup:db:v1`, key: `${app}:backup:key:v1`, prefs: `${app}:backup:prefs:v1` };
  const cloud = opts.cloud !== false;
  const lazy = opts.lazy !== false;
  const pullEveryMs = opts.pullEveryMs ?? 60_000;
  const switchMode = opts.switchMode ?? 'adopt';
  const hasWindow = typeof window !== 'undefined';

  const load = (): Persisted => {
    try {
      const raw = safeGet(keys.db);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (p && typeof p.records === 'object' && Array.isArray(p.dirty) && typeof p.cursor === 'number') return p;
      }
    } catch {
      /* corrupt: start fresh */
    }
    return { records: {}, dirty: [], cursor: 0 };
  };

  const prefs = (() => {
    try {
      const p = JSON.parse(safeGet(keys.prefs) || '{}') as { enabled?: boolean; lastSyncAt?: number; used?: boolean; at?: number; onAt?: number; solo?: boolean };
      return { enabled: cloud && (p.enabled ?? opts.defaultEnabled ?? true), lastSyncAt: p.lastSyncAt ?? 0, used: !!p.used, at: p.at ?? 0, onAt: p.onAt ?? 0, solo: !!p.solo };
    } catch {
      return { enabled: cloud && (opts.defaultEnabled ?? true), lastSyncAt: 0, used: false, at: 0, onAt: 0, solo: false };
    }
  })();
  const savePrefs = () => safeSet(keys.prefs, JSON.stringify(prefs));

  let db = load();
  const dirty = new Set(db.dirty);
  let state: BackupSyncState = prefs.enabled ? 'idle' : 'off';
  let lastError: string | undefined;
  let status: BackupStatus | null = null;
  const listeners = new Set<() => void>();
  const appliedListeners = new Set<(r: SyncRecord[], why: ApplyReason) => void>();
  const beforeListeners = new Set<() => void>();

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let quotaWarned = false;
  function persistNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    db.dirty = [...dirty];
    const ok = safeSet(keys.db, JSON.stringify(db));
    if (!ok && !quotaWarned) {
      quotaWarned = true;
      showToast({ message: opts.storageFullMessage ?? "This device's storage is full. Your latest changes are only in the cloud backup.", tone: 'warning' });
    }
  }
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 150);
  };
  if (hasWindow) {
    window.addEventListener('pagehide', () => saveTimer && persistNow());
    document.addEventListener('visibilitychange', () => document.hidden && saveTimer && persistNow());
  }

  function emit() {
    status = null;
    for (const l of listeners) l();
  }
  const applied = (recs: SyncRecord[], why: ApplyReason) => {
    if (!recs.length) return;
    for (const fn of appliedListeners) {
      try {
        fn(recs, why);
      } catch (e) {
        console.error('[backup] apply listener failed', e);
      }
    }
  };
  const runBefore = () => {
    for (const fn of beforeListeners) {
      try {
        fn();
      } catch (e) {
        console.error('[backup] beforeSync listener failed', e);
      }
    }
  };

  const store = (r: SyncRecord) => {
    db.records[r.id] = opts.metaOnly ? { id: r.id, kind: r.kind, updatedAt: r.updatedAt, ...(r.deleted ? { deleted: true } : {}), data: null } : r;
  };
  const dataFor = (r: SyncRecord): unknown => (r.deleted ? null : opts.metaOnly ? opts.dataOf?.(r) : r.data);
  const liveCount = () => Object.values(db.records).filter((r) => !r.deleted).length;

  function put(kind: string, id: string, data: unknown) {
    store({ id, kind, updatedAt: Math.max(Date.now(), (db.records[id]?.updatedAt ?? 0) + 1), data });
    dirty.add(id);
    persist();
    emit();
    scheduleSync();
  }
  function remove(id: string) {
    const old = db.records[id];
    if (!old || old.deleted) return;
    db.records[id] = { id, kind: old.kind, updatedAt: Math.max(Date.now(), old.updatedAt + 1), deleted: true, data: null };
    dirty.add(id);
    persist();
    emit();
    scheduleSync();
  }
  function newId(prefix: string) {
    const b = crypto.getRandomValues(new Uint8Array(9));
    return `${prefix}_${Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
  }

  // ---------- key ----------
  const randomKey = () => randomCode(KEY_LENGTH, (n) => crypto.getRandomValues(new Uint8Array(n)));
  function getKey(): string {
    const k = normalizeKey(safeGet(keys.key) ?? '');
    if (k) return k;
    const fresh = randomKey();
    safeSet(keys.key, fresh);
    return fresh;
  }
  let tokenFor: { key: string; token: Promise<string> } | null = null;
  const authToken = (): Promise<string> => {
    const key = getKey();
    if (!opts.encrypt) return Promise.resolve(key);
    if (tokenFor?.key !== key) tokenFor = { key, token: authTokenFor(app, key) };
    return tokenFor.token;
  };
  let aesFor: { key: string; aes: Promise<CryptoKey> } | null = null;
  const aes = () => {
    const key = getKey();
    if (aesFor?.key !== key) aesFor = { key, aes: hkdf(key, `${app}:data`, 'aes') as Promise<CryptoKey> };
    return aesFor.aes;
  };
  async function seal(r: SyncRecord, data: unknown): Promise<SyncRecord> {
    if (r.deleted) return { id: r.id, kind: r.kind, updatedAt: r.updatedAt, deleted: true, data: null };
    if (!opts.encrypt) return { id: r.id, kind: r.kind, updatedAt: r.updatedAt, data };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${app}:${r.id}`) }, await aes(), enc.encode(JSON.stringify(data))));
    const both = new Uint8Array(iv.length + ct.length);
    both.set(iv);
    both.set(ct, iv.length);
    return { id: r.id, kind: r.kind, updatedAt: r.updatedAt, data: { $e: b64(both) } };
  }
  async function open(r: SyncRecord): Promise<SyncRecord | null> {
    if (r.deleted || !opts.encrypt) return r;
    const e = (r.data as { $e?: unknown } | null)?.$e;
    if (typeof e !== 'string') return null;
    try {
      const both = unb64(e);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: both.subarray(0, 12), additionalData: enc.encode(`${app}:${r.id}`) }, await aes(), both.subarray(12));
      return { ...r, data: JSON.parse(new TextDecoder().decode(pt)) };
    } catch {
      return null;
    }
  }

  // ---------- sync ----------
  const errorText = (e: unknown) => {
    if (e instanceof FetchError) {
      const code = (e.body as { error?: string } | undefined)?.error;
      if (code === 'space_full') return 'The cloud backup is full.';
      if (code === 'rate_limited') return 'Syncing too often. Trying again soon.';
      if (e.kind === 'network' || e.kind === 'timeout') return "Couldn't reach the cloud.";
    }
    return "Couldn't sync right now.";
  };

  let running: Promise<void> | null = null;
  let again = false;
  /** During a key switch in 'adopt' mode: ids the backup already had. */
  let adopting: Set<string> | null = null;

  const worthSyncing = () => !lazy || prefs.used || db.cursor > 0 || dirty.size > 0 || liveCount() > 0;

  function syncNow(): Promise<void> {
    if (!prefs.enabled) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        runBefore();
        if (worthSyncing()) await runSync();
      } while (again);
    })().finally(() => (running = null));
    return running;
  }

  async function runSync() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state = 'offline';
      emit();
      return;
    }
    state = 'syncing';
    emit();
    const token = await authToken();
    const got: SyncRecord[] = [];
    try {
      let rounds = 0;
      let more = true;
      while ((dirty.size || more) && rounds++ < 200) {
        const batch: SyncRecord[] = [];
        const sentAt = new Map<string, number>();
        let bytes = 0;
        for (const id of [...dirty]) {
          if (batch.length >= LIMITS.recordsPerRequest) break;
          const r = db.records[id];
          if (!r) {
            dirty.delete(id);
            continue;
          }
          const data = dataFor(r);
          if (!r.deleted && (data === undefined || data === null)) {
            dirty.delete(id);
            continue;
          }
          const wire = await seal(r, data);
          const size = JSON.stringify(wire.data).length;
          if (size > LIMITS.dataBytes) {
            // Too big for one record: it stays on this device (and in exported files).
            console.warn(`[backup] ${app}: record ${id} is ${size} bytes, over the ${LIMITS.dataBytes} limit; not backed up`);
            dirty.delete(id);
            continue;
          }
          if (batch.length && bytes + size > LIMITS.pushBytes) break;
          bytes += size;
          batch.push(wire);
          sentAt.set(id, r.updatedAt);
        }
        const res = await fetchJson<SyncResponse>(`${endpoint}/sync`, {
          method: 'POST',
          headers: { [keyHeader]: token },
          body: { since: db.cursor, records: batch },
          timeoutMs: 20000,
          retries: 1,
        });
        for (const [id, at] of sentAt) if (db.records[id]?.updatedAt === at) dirty.delete(id);
        for (const raw of res.records ?? []) {
          const clean = cleanRecord(raw, opts.kinds);
          const r = clean && (await open(clean));
          if (!r) continue;
          const local = db.records[r.id];
          if (adopting) adopting.add(r.id);
          if (adopting || !local || r.updatedAt > local.updatedAt || (r.updatedAt === local.updatedAt && !dirty.has(r.id))) {
            const same = !!local && local.updatedAt === r.updatedAt && !!local.deleted === !!r.deleted;
            store(r);
            dirty.delete(r.id);
            // A copy we already have (pulls overlap by a few seconds) is not news for the app.
            if (!same || adopting) got.push(r);
          }
        }
        if (typeof res.cursor === 'number') db.cursor = res.cursor;
        more = !!res.more;
        if (!batch.length && !more) break;
      }
      prefs.lastSyncAt = Date.now();
      prefs.used = true;
      savePrefs();
      lastError = undefined;
      state = 'idle';
      // The first real sync of this app's own key: offer it to the other apps (they adopt it if nothing stronger).
      if (family && !famPublishedAfterSync) {
        famPublishedAfterSync = true;
        setTimeout(() => void familyStep(true), 0);
      }
    } catch (e) {
      lastError = errorText(e);
      state = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error';
      if (adopting) throw e;
    } finally {
      persistNow();
      emit();
      applied(got, adopting ? 'restore' : 'sync');
    }
  }

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSync(delay = 1500) {
    if (!prefs.enabled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncNow(), delay);
  }

  function applyEnabled(on: boolean) {
    prefs.enabled = on;
    savePrefs();
    state = on ? 'idle' : 'off';
    emit();
    if (on) void syncNow();
  }
  /** The person's switch: also every family app's. */
  function setEnabled(on: boolean) {
    if (!cloud) return;
    prefs.onAt = Date.now();
    applyEnabled(on);
    void familyStep(true);
  }

  /** Switch this device to another key (a link code or the recovery key): see `switchMode`. */
  async function switchKey(raw: string): Promise<boolean> {
    const k = normalizeKey(raw);
    if (!k) return false;
    const ok = await moveToKey(k, true);
    if (ok) {
      // Linking / restoring turns the backup on: that is the person's switch too (or an older "off" elsewhere wins).
      prefs.at = prefs.onAt = Date.now();
      prefs.solo = false;
      savePrefs();
      void familyStep(true);
    }
    return ok;
  }

  /** `byPerson` turns the backup on (a link / restore); the family's key keeps this app's switch as it is. */
  async function moveToKey(k: string, byPerson: boolean): Promise<boolean> {
    if (k === normalizeKey(safeGet(keys.key) ?? '')) return true;
    runBefore();
    await running?.catch(() => undefined);
    safeSet(keys.key, k);
    db.cursor = 0;
    if (byPerson) prefs.enabled = cloud;
    if (!prefs.enabled) {
      // Backup is off here: no network. Everything on this device goes up once it is turned on.
      for (const id of Object.keys(db.records)) dirty.add(id);
      savePrefs();
      persistNow();
      emit();
      return true;
    }
    prefs.used = true;
    savePrefs();
    if (switchMode === 'merge') {
      for (const id of Object.keys(db.records)) dirty.add(id);
      persistNow();
      emit();
      await syncNow();
      return true;
    }
    // adopt: pull the backup first (its copy wins), then push what only this device had.
    const local = Object.keys(db.records);
    dirty.clear();
    adopting = new Set();
    const seen = adopting;
    try {
      running = runSync();
      await running;
    } finally {
      running = null;
      adopting = null;
    }
    for (const id of local) if (!seen.has(id)) dirty.add(id);
    persistNow();
    emit();
    await syncNow();
    return true;
  }

  async function createLinkCode() {
    runBefore();
    prefs.used = true;
    savePrefs();
    await syncNow();
    // The joining device needs the real key (encrypted spaces: the server only knows the derived token).
    return fetchJson<{ code: string; expiresAt: number }>(`${endpoint}/link/create`, { method: 'POST', headers: { [keyHeader]: getKey() }, body: {}, timeoutMs: 12000 });
  }

  async function redeemLinkCode(code: string): Promise<boolean | null> {
    try {
      const { key } = await fetchJson<{ key: string }>(`${endpoint}/link/redeem`, { method: 'POST', body: { code }, timeoutMs: 12000 });
      return switchKey(key);
    } catch (e) {
      if (e instanceof FetchError && (e.body as { error?: string } | undefined)?.error === 'wrong_code') return null;
      throw e;
    }
  }

  // ---------- backup family (docs/backup-family.md) ----------
  const family = cloud && opts.family !== false && hasWindow;
  let transport: FamilyTransport | null = null;
  let famRunning: Promise<void> | null = null;
  let famLast = 0;
  let famPublishedAfterSync = false;
  /** This app's key if it has really used one (a key nobody synced with and no records is not worth sharing). */
  const usedKey = () => {
    const k = normalizeKey(safeGet(keys.key) ?? '');
    return k && (prefs.used || db.cursor > 0 || liveCount() > 0 || dirty.size > 0) ? k : null;
  };
  function familyStep(force: boolean): Promise<void> {
    if (!family || prefs.solo) return Promise.resolve();
    if (famRunning) return famRunning;
    if (!force && Date.now() - famLast < 5 * 60_000) return Promise.resolve();
    famLast = Date.now();
    famRunning = (async () => {
      try {
        transport ??= opts.familyTransport ?? defaultFamilyTransport(endpoint);
        const f = mergeFamily(await transport.read());
        const plan = planFamily({ key: usedKey(), at: prefs.at, on: prefs.enabled, onAt: prefs.onAt }, f);
        if (plan.adoptKey && (await moveToKey(plan.adoptKey, false))) {
          prefs.at = plan.at;
          savePrefs();
        }
        if (plan.setOn !== null) {
          prefs.onAt = plan.onAt;
          if (plan.setOn !== prefs.enabled) applyEnabled(plan.setOn);
          else savePrefs();
        }
        const famKey = `${app}:backup:family:v1`;
        const write = transport.perApp ? plan.own : plan.publish;
        if (write && (!transport.perApp || safeGet(famKey) !== JSON.stringify(write))) {
          await transport.write(write);
          if (transport.perApp) safeSet(famKey, JSON.stringify(write));
        }
      } catch (e) {
        console.warn('[backup] family', (e as Error)?.message ?? e);
      } finally {
        famRunning = null;
      }
    })();
    return famRunning;
  }

  let started = false;
  function start() {
    if (!hasWindow || started) return;
    started = true;
    if (!cloud) return;
    void familyStep(true).finally(() => void syncNow());
    window.addEventListener('online', () => void syncNow());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void familyStep(false).finally(() => void syncNow());
    });
    setInterval(() => !document.hidden && void syncNow(), pullEveryMs);
  }

  function forgetDevice() {
    clearTimeout(saveTimer);
    clearTimeout(syncTimer);
    for (const k of [keys.db, keys.key, keys.prefs, `${app}:backup:seen:v1`, `${app}:backup:family:v1`]) safeRemove(k);
    db = { records: {}, dirty: [], cursor: 0 };
    dirty.clear();
    prefs.lastSyncAt = 0;
    prefs.used = false;
    prefs.at = 0;
    prefs.onAt = 0;
    // Leave the family here until the person links or restores again (or this would rejoin at once).
    prefs.solo = family;
    if (family) savePrefs();
    prefs.enabled = cloud && (opts.defaultEnabled ?? true);
    state = prefs.enabled ? 'idle' : 'off';
    lastError = undefined;
    emit();
  }
  async function eraseCloud() {
    await running?.catch(() => undefined);
    if (cloud && (prefs.used || db.cursor > 0)) {
      await fetchJson(`${endpoint}/erase`, { method: 'POST', headers: { [keyHeader]: await authToken() }, body: {}, timeoutMs: 20000, retries: 1 });
    }
    forgetDevice();
  }

  // ---------- files ----------
  async function exportFile(): Promise<BackupFile> {
    runBefore();
    const records: SyncRecord[] = [];
    for (const r of Object.values(db.records)) {
      if (r.deleted) continue;
      const data = dataFor(r);
      if (data === undefined || data === null) continue;
      records.push({ id: r.id, kind: r.kind, updatedAt: r.updatedAt, data });
    }
    return { format: 'mg-backup', version: 1, app, exportedAt: new Date().toISOString(), records };
  }
  async function downloadFile() {
    const file = await exportFile();
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app}-backup-${file.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  async function importFile(file: Blob) {
    const parsed = parseBackupFile(await file.text(), app, opts.kinds);
    if (!Array.isArray(parsed)) return parsed;
    if (!parsed.length) return { error: 'empty' as const };
    runBefore();
    const now = Date.now();
    const done: SyncRecord[] = [];
    for (const r of parsed) {
      const rec = { ...r, updatedAt: Math.max(now, (db.records[r.id]?.updatedAt ?? 0) + 1) };
      store(rec);
      dirty.add(r.id);
      done.push(rec);
    }
    persistNow();
    emit();
    applied(done, 'restore');
    scheduleSync(300);
    return { imported: done.length };
  }

  const backup: Backup = {
    app,
    options: opts,
    status: () =>
      (status ??= {
        state,
        lastSyncAt: prefs.lastSyncAt,
        enabled: prefs.enabled,
        pending: dirty.size,
        count: liveCount(),
        cloud,
        ...(lastError ? { error: lastError } : {}),
      }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onApplied(fn) {
      appliedListeners.add(fn);
      return () => appliedListeners.delete(fn);
    },
    beforeSync(fn) {
      beforeListeners.add(fn);
      return () => beforeListeners.delete(fn);
    },
    get: (id) => db.records[id],
    all: () => Object.values(db.records),
    live: <T,>(kind: string) => Object.values(db.records).filter((r) => r.kind === kind && !r.deleted && r.data).map((r) => r.data as T),
    put,
    remove,
    newId,
    getKey,
    switchKey,
    syncNow,
    scheduleSync,
    setEnabled,
    createLinkCode,
    redeemLinkCode,
    start,
    syncFamily: () => familyStep(true),
    exportFile,
    downloadFile,
    importFile,
    eraseCloud,
    forgetDevice,
  };
  return backup;
}

/** Short status line, e.g. "Backed up 3m ago". */
export function backupLabel(s: BackupStatus): string {
  if (!s.cloud) return 'Saved on this device';
  if (!s.enabled) return 'Cloud backup is off';
  if (s.state === 'syncing') return 'Syncing';
  if (s.state === 'offline') return 'Offline: saved on this device';
  if (s.state === 'error') return s.error ?? "Couldn't sync";
  if (!s.lastSyncAt) return 'Not synced yet';
  const sec = Math.round((Date.now() - s.lastSyncAt) / 1000);
  return `Backed up ${sec < 60 ? 'just now' : sec < 3600 ? `${Math.round(sec / 60)}m ago` : new Date(s.lastSyncAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

// ---------- existing localStorage keys ----------

export interface BackupKeySpec {
  /** The exact localStorage key (with any ':v1' suffix the app's hook adds). */
  key: string;
  /**
   * The value is a JSON array of items with ids: back up each item as its own record, so two devices that each add
   * items keep both. Return the item's stable id (string or number).
   */
  itemId?: (item: any) => string | number | undefined | null;
  /** The value is a JSON object map: back up each property as its own record (e.g. saved wheels by name). */
  map?: boolean;
  /**
   * The app re-reads this key on 'storage' events, so changes synced in the background reach its in-memory state.
   * Without it (the default) the kit assumes the app may write an old copy back (it read the key once at start) and
   * repairs that write: items that arrived in the background are put back, items deleted in the background stay
   * deleted, and a plain key keeps the newer value, until the next page load.
   */
  live?: boolean;
}

export interface BackupKeysOptions {
  keys: (string | BackupKeySpec)[];
  /**
   * After a restore / link / import changed these keys. Default: reload the page (most apps read localStorage once
   * at start). Background syncs from another device always fire 'storage' events for the changed keys instead, which
   * the kit's useLocalStorage (and any 'storage' listener) picks up.
   */
  onRestore?: (keys: string[]) => void;
  /** How often to look for changes (ms). Default 4000. */
  scanEveryMs?: number;
}

/** 53-bit FNV-1a-ish string hash (two 32-bit lanes), hex. Only used to notice changes and to name records. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);

interface KeyRec {
  key: string;
  /** whole key: the raw string. */
  raw?: string;
  /** list / map: the item, its position and (map) its property name. */
  item?: unknown;
  pos?: number;
  name?: string;
}

/**
 * Back up existing localStorage keys without changing how the app stores them. Plain keys are one record each
 * (the newest copy wins); `itemId` lists and `map` objects are one record per item, so devices merge.
 */
export function backupKeys(backup: Backup, options: BackupKeysOptions): { scan: () => void; stop: () => void } {
  if (!backup.options.metaOnly) throw new Error('backupKeys needs createBackup({ metaOnly: true })');
  const specs: BackupKeySpec[] = options.keys.map((k) => (typeof k === 'string' ? { key: k } : k));
  const hasWindow = typeof window !== 'undefined';
  const seenKey = `${backup.app}:backup:seen:v1`;
  /** key → hash of the raw value (whole) or itemRecordId → hash (lists / maps). */
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse(safeGet(seenKey) || '{}') as Record<string, string>;
  } catch {
    seen = {};
  }
  const lastRaw = new Map<string, string | null>();
  /** Background changes the app's in-memory copy may not know about (non-live keys, this page load only). */
  const bgAdded = new Map<string, { item: unknown; pos: number; name?: string; prev?: string }>();
  const bgDeleted = new Map<string, string>();
  const bgWhole = new Map<string, { prev: string; raw: string }>();
  const saveSeen = () => safeSet(seenKey, JSON.stringify(seen));

  const wholeId = (spec: BackupKeySpec) => `k_${slug(spec.key)}`.padEnd(6, '_');
  const itemRecId = (spec: BackupKeySpec, id: string) => `i_${hashString(spec.key).slice(0, 8)}_${hashString(id)}`;
  const isItems = (s: BackupKeySpec) => !!s.itemId || !!s.map;

  const itemsOf = (spec: BackupKeySpec, raw: string | null): Map<string, { item: unknown; pos: number; name?: string }> | null => {
    const out = new Map<string, { item: unknown; pos: number; name?: string }>();
    if (raw == null) return out;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
    if (spec.itemId) {
      if (!Array.isArray(v)) return null;
      v.forEach((item, pos) => {
        const id = spec.itemId!(item);
        if (id === undefined || id === null || id === '') return;
        out.set(itemRecId(spec, String(id)), { item, pos });
      });
    } else {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      Object.entries(v as Record<string, unknown>).forEach(([name, item], pos) => out.set(itemRecId(spec, name), { item, pos, name }));
    }
    return out;
  };

  const serialize = (spec: BackupKeySpec, rows: [string, { item: unknown; pos: number; name?: string }][]) =>
    JSON.stringify(spec.map ? Object.fromEntries(rows.map(([, it]) => [it.name ?? '', it.item])) : rows.map(([, it]) => it.item));
  const announce = (key: string) => {
    if (!hasWindow) return;
    try {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: safeGet(key), storageArea: localStorage }));
    } catch {
      /* old browsers */
    }
  };

  function scan() {
    let changed = false;
    for (const spec of specs) {
      let raw = safeGet(spec.key);
      if (lastRaw.has(spec.key) && lastRaw.get(spec.key) === raw) continue;
      lastRaw.set(spec.key, raw);
      if (!isItems(spec)) {
        const id = wholeId(spec);
        const bg = bgWhole.get(spec.key);
        if (bg && (raw == null ? '' : hashString(raw)) === bg.prev) {
          // The app wrote back the value it had before a background change: keep the newer one.
          safeSet(spec.key, bg.raw);
          lastRaw.set(spec.key, bg.raw);
          announce(spec.key);
          continue;
        }
        bgWhole.delete(spec.key);
        const h = raw == null ? '' : hashString(raw);
        if ((seen[id] ?? '') === h) continue;
        seen[id] = h;
        changed = true;
        if (raw == null) backup.remove(id);
        else backup.put('key', id, { key: spec.key } satisfies KeyRec);
        continue;
      }
      let items = itemsOf(spec, raw);
      if (!items) continue; // not the shape we expect: leave it alone
      const prefix = itemRecId(spec, '').slice(0, 11);
      if (!spec.live && (bgAdded.size || bgDeleted.size)) {
        // Repair a write from an old in-memory copy (see BackupKeySpec.live).
        let fixed = false;
        const rows = [...items.entries()];
        for (const [rid, it] of bgAdded) {
          if (!rid.startsWith(prefix)) continue;
          const have = items.get(rid);
          if (!have) {
            rows.push([rid, it]);
            fixed = true;
          } else if (it.prev && hashString(JSON.stringify(have.item)) === it.prev) {
            // The old version of an item that changed in the background: keep the new one.
            const i = rows.findIndex(([r]) => r === rid);
            rows[i] = [rid, { item: it.item, pos: have.pos, ...(it.name !== undefined ? { name: it.name } : {}) }];
            fixed = true;
          } else bgAdded.delete(rid);
        }
        for (const [rid, h] of bgDeleted) {
          if (!rid.startsWith(prefix)) continue;
          const i = rows.findIndex(([r]) => r === rid);
          if (i < 0) bgDeleted.delete(rid);
          else if (hashString(JSON.stringify(rows[i]![1].item)) === h) {
            rows.splice(i, 1);
            fixed = true;
          } else bgDeleted.delete(rid);
        }
        if (fixed) {
          rows.sort((a, b) => a[1].pos - b[1].pos);
          raw = serialize(spec, rows);
          safeSet(spec.key, raw);
          lastRaw.set(spec.key, raw);
          items = itemsOf(spec, raw) ?? items;
          announce(spec.key);
        }
      }
      for (const [rid, it] of items) {
        const h = hashString(JSON.stringify(it.item));
        if (seen[rid] === h) continue;
        seen[rid] = h;
        changed = true;
        backup.put('item', rid, { key: spec.key } satisfies KeyRec);
      }
      for (const rid of Object.keys(seen)) {
        if (rid.startsWith(prefix) && !items.has(rid)) {
          delete seen[rid];
          changed = true;
          backup.remove(rid);
        }
      }
    }
    if (changed) saveSeen();
  }

  /** Data for a record, read from localStorage at push / export time. */
  const dataOf = (rec: SyncRecord): KeyRec | undefined => {
    for (const spec of specs) {
      if (!isItems(spec)) {
        if (wholeId(spec) !== rec.id) continue;
        const raw = safeGet(spec.key);
        return raw == null ? undefined : { key: spec.key, raw };
      }
      if (!rec.id.startsWith(itemRecId(spec, '').slice(0, 11))) continue;
      const it = itemsOf(spec, safeGet(spec.key))?.get(rec.id);
      if (it) return { key: spec.key, item: it.item, pos: it.pos, ...(it.name !== undefined ? { name: it.name } : {}) };
    }
    return undefined;
  };
  (backup.options as BackupOptions).dataOf = dataOf;

  function applyRemote(records: SyncRecord[], why: ApplyReason) {
    const touched = new Set<string>();
    const byKey = new Map<string, SyncRecord[]>();
    for (const r of records) {
      const spec = specs.find((s) => (isItems(s) ? r.id.startsWith(itemRecId(s, '').slice(0, 11)) : wholeId(s) === r.id));
      if (!spec) continue;
      if (!isItems(spec)) {
        const d = r.data as KeyRec | null;
        const before = safeGet(spec.key);
        if (r.deleted) safeRemove(spec.key);
        else if (typeof d?.raw === 'string') safeSet(spec.key, d.raw);
        else continue;
        const raw = safeGet(spec.key);
        seen[r.id] = raw == null ? '' : hashString(raw);
        lastRaw.set(spec.key, raw);
        touched.add(spec.key);
        if (why === 'sync' && !spec.live && raw !== null && raw !== before) bgWhole.set(spec.key, { prev: before == null ? '' : hashString(before), raw });
      } else {
        byKey.set(spec.key, [...(byKey.get(spec.key) ?? []), r]);
      }
    }
    for (const [key, recs] of byKey) {
      const spec = specs.find((s) => s.key === key)!;
      const cur = itemsOf(spec, safeGet(key)) ?? new Map();
      const rows = new Map([...cur].map(([id, it]) => [id, { ...it, at: backup.get(id)?.updatedAt ?? 0 }]));
      const bg = why === 'sync' && !spec.live;
      for (const r of recs) {
        const d = r.data as KeyRec | null;
        if (r.deleted) {
          const old = rows.get(r.id);
          if (bg && old) bgDeleted.set(r.id, hashString(JSON.stringify(old.item)));
          bgAdded.delete(r.id);
          rows.delete(r.id);
        } else if (d && 'item' in d) {
          const row = { item: d.item, pos: typeof d.pos === 'number' ? d.pos : 0, ...(d.name !== undefined ? { name: d.name } : {}) };
          const old = rows.get(r.id);
          rows.set(r.id, { ...row, at: r.updatedAt });
          const prev = old ? hashString(JSON.stringify(old.item)) : undefined;
          if (bg && prev !== hashString(JSON.stringify(d.item))) bgAdded.set(r.id, { ...row, ...(prev ? { prev } : {}) });
          bgDeleted.delete(r.id);
        }
      }
      const ordered = [...rows.entries()].sort((a, b) => a[1].pos - b[1].pos || b[1].at - a[1].at);
      let value: unknown;
      if (spec.map) value = Object.fromEntries(ordered.map(([, it]) => [it.name ?? '', it.item]));
      else value = ordered.map(([, it]) => it.item);
      const raw = JSON.stringify(value);
      safeSet(key, raw);
      lastRaw.set(key, raw);
      const fresh = itemsOf(spec, raw) ?? new Map();
      const prefix = itemRecId(spec, '').slice(0, 11);
      for (const rid of Object.keys(seen)) if (rid.startsWith(prefix)) delete seen[rid];
      for (const [rid, it] of fresh) seen[rid] = hashString(JSON.stringify(it.item));
      touched.add(key);
    }
    saveSeen();
    if (!touched.size || !hasWindow) return;
    const keys = [...touched];
    if (why === 'restore') {
      if (options.onRestore) options.onRestore(keys);
      else setTimeout(() => location.reload(), 1200);
      return;
    }
    for (const key of keys) {
      try {
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: safeGet(key), storageArea: localStorage }));
      } catch {
        /* old browsers */
      }
    }
  }

  const offBefore = backup.beforeSync(scan);
  const offApplied = backup.onApplied(applyRemote);
  scan();
  let timer: ReturnType<typeof setInterval> | undefined;
  if (hasWindow) {
    timer = setInterval(() => {
      if (document.hidden) return;
      const before = backup.status().pending;
      scan();
      if (backup.status().pending > before) backup.scheduleSync(2500);
    }, options.scanEveryMs ?? 4000);
    (timer as { unref?: () => void }).unref?.();
    // Same-tab writes from another kit hook / other tabs.
    window.addEventListener('storage', (e) => {
      if (e.storageArea === localStorage && specs.some((s) => s.key === e.key)) lastRaw.delete(e.key!);
    });
  }
  return {
    scan,
    stop() {
      offBefore();
      offApplied();
      clearInterval(timer);
    },
  };
}

/** createBackup({ metaOnly: true, ... }) + backupKeys(...) in one call, for apps that keep their data in localStorage keys. */
export function createKeyBackup(opts: Omit<BackupOptions, 'metaOnly' | 'dataOf'> & BackupKeysOptions): Backup {
  const { keys, onRestore, scanEveryMs, ...rest } = opts;
  const backup = createBackup({ ...rest, metaOnly: true, kinds: ['key', 'item'] });
  backupKeys(backup, { keys, ...(onRestore ? { onRestore } : {}), ...(scanEveryMs ? { scanEveryMs } : {}) });
  return backup;
}
