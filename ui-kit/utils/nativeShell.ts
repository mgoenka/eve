/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Typed, feature-detected wrappers for the Android shell's `window.MGNativeShell`
 * (contract: ~/Dev/native-apps/docs/native-features.md). Old app builds and the website don't have it:
 * every helper here is then a no-op that returns null / false. Nothing here throws.
 */

export type NativeScanResult = { ok: true; text: string } | { ok: false; error: 'cancelled' | 'unavailable' | 'failed' };
export type NativePermission = 'granted' | 'denied' | 'prompt';

export interface NativeDailyReminder {
  /** Stable id (cancelReminder(id) removes it; scheduling the same id again replaces it). */
  id: string;
  hour: number;
  minute: number;
  title: string;
  body: string;
  /** Same-origin path opened on tap, e.g. '/?shortcut=today'. */
  path?: string;
}

export interface MGNativeShellNotifications {
  permission(): Promise<NativePermission>;
  request(): Promise<'granted' | 'denied'>;
  pushToken(): Promise<string | null>;
  scheduleDaily(o: NativeDailyReminder): Promise<boolean>;
  cancel(id: string): Promise<void>;
}

export interface MGNativeShell {
  version: number;
  scanQr(): Promise<NativeScanResult>;
  takeLaunchShortcut(): string | null;
  notifications: MGNativeShellNotifications;
}

declare global {
  interface Window {
    MGNativeShell?: Partial<MGNativeShell>;
  }
}

/** The bridge, or null on the website / in old app builds. Members may still be missing: feature-detect. */
export function nativeShell(): Partial<MGNativeShell> | null {
  try {
    const s = typeof window !== 'undefined' ? window.MGNativeShell : undefined;
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

function notifications(): Partial<MGNativeShellNotifications> | null {
  const n = nativeShell()?.notifications;
  return n && typeof n === 'object' ? n : null;
}

/** Resolves with the promise's value, or `fallback` after `ms` / on rejection. */
function settle<T, F>(p: Promise<T> | undefined, ms: number, fallback: F): Promise<T | F> {
  if (!p || typeof (p as Promise<T>).then !== 'function') return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

// ---------------------------------------------------------------- 1. QR scanner

/** True when the app's native QR scanner (Google Code Scanner) is there. */
export function hasNativeScanner(): boolean {
  return typeof nativeShell()?.scanQr === 'function';
}

/** The scanner's full answer (to tell "cancelled" from "unavailable"), or null without a native scanner. */
export async function nativeScanQrResult(): Promise<NativeScanResult | null> {
  const s = nativeShell();
  if (!s || typeof s.scanQr !== 'function') return null;
  try {
    const r = await s.scanQr();
    if (r && r.ok === true && typeof r.text === 'string') return { ok: true, text: r.text };
    const error = r && r.ok === false && (r.error === 'cancelled' || r.error === 'unavailable') ? r.error : 'failed';
    return { ok: false, error };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Opens the native scanner; the scanned text, or null (cancelled, failed, or no native scanner). */
export async function nativeScanQr(): Promise<string | null> {
  const r = await nativeScanQrResult();
  return r && r.ok ? r.text : null;
}

// ---------------------------------------------------------------- 2. App shortcuts

export const SHORTCUT_EVENT = 'mg-shortcut';
export const NOTIFICATION_EVENT = 'mg-notification';
const SHORTCUT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const validShortcut = (v: unknown): string | null => (typeof v === 'string' && SHORTCUT_ID.test(v) ? v : null);

type ShortcutEntry = { fn: (id: string) => void };
const shortcutHandlers = new Set<ShortcutEntry>();
const pendingShortcuts: string[] = [];
let launchRead = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastDelivered: { id: string; at: number } | null = null;

/** Reads the cold-start shortcut once: the shell's takeLaunchShortcut(), else `?shortcut=` (always stripped). */
function readLaunchShortcut(): void {
  if (launchRead || typeof window === 'undefined') return;
  launchRead = true;
  let fromQuery: string | null = null;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('shortcut')) {
      fromQuery = validShortcut(url.searchParams.get('shortcut'));
      url.searchParams.delete('shortcut');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch {
    /* ignore */
  }
  let fromNative: string | null = null;
  try {
    const take = nativeShell()?.takeLaunchShortcut;
    if (typeof take === 'function') fromNative = validShortcut(take());
  } catch {
    /* ignore */
  }
  const id = fromNative ?? fromQuery;
  if (id) pendingShortcuts.push(id);
}

function flushShortcuts(): void {
  flushTimer = null;
  if (shortcutHandlers.size === 0) return; // keep them for the first handler that subscribes
  while (pendingShortcuts.length) {
    const id = pendingShortcuts.shift() as string;
    lastDelivered = { id, at: Date.now() };
    for (const h of [...shortcutHandlers]) {
      try {
        h.fn(id);
      } catch (e) {
        console.error('[mg] shortcut handler failed', e);
      }
    }
  }
}

function scheduleShortcutFlush(): void {
  if (flushTimer === null) flushTimer = setTimeout(flushShortcuts, 0);
}

function enqueueShortcut(id: string): void {
  // The same shortcut twice within 1.5 s (cold start reported both ways, or a double dispatch) is one launch.
  if (lastDelivered && lastDelivered.id === id && Date.now() - lastDelivered.at < 1500) return;
  if (pendingShortcuts.includes(id)) return;
  pendingShortcuts.push(id);
  scheduleShortcutFlush();
}

// Warm launches: installed when the kit loads, so an event before the app subscribes is kept.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener(SHORTCUT_EVENT, (e: Event) => {
    const id = validShortcut((e as CustomEvent<{ id?: unknown } | null>).detail?.id);
    if (id) enqueueShortcut(id);
  });
}

/**
 * Calls `handler(id)` for each launcher shortcut the user picks: the one that cold-started the app
 * (`takeLaunchShortcut()` / `?shortcut=<id>`, which is stripped from the URL) and later ones ('mg-shortcut').
 * Each shortcut reaches the handler once, also under React StrictMode (delivery waits a tick, so a
 * mount → unmount → mount hands it to the surviving subscription). Returns an unsubscribe function.
 * On the website and in old builds only `?shortcut=` can ever fire it.
 *   useEffect(() => onAppShortcut((id) => { if (id === 'join') scan(); if (id === 'new') newGame(); }), []);
 */
export function onAppShortcut(handler: (id: string) => void): () => void {
  if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};
  readLaunchShortcut();
  const entry: ShortcutEntry = { fn: handler };
  shortcutHandlers.add(entry);
  if (pendingShortcuts.length) scheduleShortcutFlush();
  return () => {
    shortcutHandlers.delete(entry);
  };
}

/** Test hook: forget module state (pending shortcuts, launch read, subscribers). */
export function __resetNativeShellForTests(): void {
  shortcutHandlers.clear();
  pendingShortcuts.length = 0;
  launchRead = false;
  lastDelivered = null;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}

// ---------------------------------------------------------------- 3. Notifications

export interface NotificationOpenDetail {
  path: string;
  data: Record<string, unknown>;
}

/**
 * A tap on one of the app's notifications while the page is open (or a push in the foreground, which the
 * shell doesn't show): 'mg-notification' with { path, data }. The shell has already opened `path` when the
 * app was in the background; use this to react in place (e.g. jump to the room). Returns an unsubscribe.
 */
/**
 * Notification taps (and pushes that arrive while the app is open, `tap: false`). Return true from the handler when
 * the app routes to `path` itself: the shell then won't navigate (a navigation would reload the page). Return
 * nothing to let the shell open `path`.
 */
export function onNotificationOpen(handler: (detail: NotificationOpenDetail & { tap: boolean }) => boolean | void): () => void {
  if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};
  const listener = (e: Event) => {
    const d = (e as CustomEvent<{ path?: unknown; data?: unknown; tap?: unknown } | null>).detail;
    const path = typeof d?.path === 'string' && d.path.startsWith('/') && !d.path.startsWith('//') ? d.path : '/';
    const data = d?.data && typeof d.data === 'object' ? (d.data as Record<string, unknown>) : {};
    try {
      if (handler({ path, data, tap: d?.tap !== false }) === true && e.cancelable) e.preventDefault();
    } catch (err) {
      console.error('[mg] notification handler failed', err);
    }
  };
  window.addEventListener(NOTIFICATION_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_EVENT, listener);
}

/** True when this build can receive push (FCM) notifications. False on the website and in old builds. */
export function pushAvailable(): boolean {
  const n = notifications();
  return !!n && typeof n.pushToken === 'function' && typeof n.request === 'function';
}

/** The notification permission, or null without the native bridge. */
export async function notificationPermission(): Promise<NativePermission | null> {
  const n = notifications();
  if (!n || typeof n.permission !== 'function') return null;
  let p: Promise<NativePermission> | undefined;
  try {
    p = n.permission();
  } catch {
    return null;
  }
  const r = await settle(p, 5000, null);
  return r === 'granted' || r === 'denied' || r === 'prompt' ? r : null;
}

/** The FCM token without asking for permission (null unless it is already granted, or unavailable). */
export async function getPushToken(): Promise<string | null> {
  const n = notifications();
  if (!n || typeof n.pushToken !== 'function') return null;
  if ((await notificationPermission()) === 'denied') return null;
  let p: Promise<string | null> | undefined;
  try {
    p = n.pushToken();
  } catch {
    return null;
  }
  const t = await settle(p, 10_000, null);
  return typeof t === 'string' && t.length > 0 && t.length <= 4096 ? t : null;
}

/**
 * Asks for the notification permission (Android 13+ shows the system prompt; older versions are granted),
 * then returns the FCM token. Null when denied or unavailable. Call it from a user gesture (NotifyTurnPrompt).
 */
export async function requestPushToken(): Promise<string | null> {
  const n = notifications();
  if (!n || typeof n.request !== 'function' || typeof n.pushToken !== 'function') return null;
  let p: Promise<'granted' | 'denied'> | undefined;
  try {
    p = n.request();
  } catch {
    return null;
  }
  // The system prompt waits for the user: no short timeout here.
  const r = await settle(p, 120_000, 'denied' as const);
  if (r !== 'granted') return null;
  return getPushToken();
}

/** True when this build can schedule local daily reminders (the Android app). False on the website. */
export function dailyRemindersAvailable(): boolean {
  const n = notifications();
  return !!n && typeof n.scheduleDaily === 'function';
}

/** Asks for the notification permission (Android 13+ system prompt). Call from a user gesture. */
export async function requestNotificationPermission(): Promise<boolean> {
  const n = notifications();
  if (!n || typeof n.request !== 'function') return false;
  let p: Promise<'granted' | 'denied'> | undefined;
  try {
    p = n.request();
  } catch {
    return false;
  }
  return (await settle(p, 120_000, 'denied' as const)) === 'granted';
}

/** Schedules (or replaces) a local daily reminder. False without the bridge or when the shell refuses. */
export async function scheduleDailyReminder(o: NativeDailyReminder): Promise<boolean> {
  const n = notifications();
  if (!n || typeof n.scheduleDaily !== 'function') return false;
  if (!o || typeof o.id !== 'string' || !o.id) return false;
  const hour = Math.trunc(o.hour);
  const minute = Math.trunc(o.minute);
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return false;
  const arg: NativeDailyReminder = { id: o.id, hour, minute, title: String(o.title ?? ''), body: String(o.body ?? '') };
  if (typeof o.path === 'string' && o.path.startsWith('/') && !o.path.startsWith('//')) arg.path = o.path;
  let p: Promise<boolean> | undefined;
  try {
    p = n.scheduleDaily(arg);
  } catch {
    return false;
  }
  return (await settle(p, 10_000, false)) === true;
}

/** Cancels a reminder scheduled with scheduleDailyReminder. False without the bridge. */
export async function cancelReminder(id: string): Promise<boolean> {
  const n = notifications();
  if (!n || typeof n.cancel !== 'function' || typeof id !== 'string' || !id) return false;
  let p: Promise<void> | undefined;
  try {
    p = n.cancel(id);
  } catch {
    return false;
  }
  if (!p || typeof p.then !== 'function') return true; // a synchronous cancel
  return (await settle(p.then(() => true), 10_000, false)) === true;
}
