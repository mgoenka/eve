/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * A Socket.IO client socket that costs nothing until it is used, and lets go of the server when nobody is looking.
 *
 *   import type { Socket } from 'socket.io-client';
 *   const socket = createLazySocket<Socket>(() => import('socket.io-client'), { transports: ['websocket'] });
 *
 *  - Lazy: socket.io-client (~40 KB) is only downloaded on the first `connect()`, so the landing screen loads
 *    less. Until then on/off/once/emit/io.on/io.off are recorded and replayed on the real socket.
 *    The app passes the import itself, so apps without socket.io-client never bundle it.
 *  - Hidden tab: after `hiddenDisconnectMs` (default 5 min) hidden, the socket disconnects (an open websocket keeps
 *    a Cloud Run instance up and billed). When the tab is visible again it reconnects, and the app's own 'connect'
 *    handler rejoins by token as after any reconnect.
 *  - Idle room: the server's idle sweep (server-kit/idle-sockets) sends 'idle-disconnect' before it closes a quiet
 *    room; the socket then reconnects on the next tap/key, or when the tab is shown again.
 *  - Reconnects made here fire the app's 'connect' listeners and also `socket.io` 'reconnect' listeners, so apps
 *    that rejoin on either keep working. Messages queued while suspended are dropped (the app re-sends its state
 *    on rejoin), so hours of stale state never flood the room.
 *  - `connect()` / `disconnect()` from the app always win: disconnect() stops any automatic resume.
 *  - Automated browsers (navigator.webdriver) add `mgTest=1` to the handshake, so the server's idle sweep lets go
 *    of them after 2 minutes.
 */

import { isAutomatedBrowser } from './testMode';

type Listener = (...args: any[]) => void;

interface RealSocket {
  connected: boolean;
  active: boolean;
  id?: string;
  sendBuffer?: unknown[];
  io: { on(ev: string, fn: Listener): unknown; off(ev: string, fn?: Listener): unknown; emit?(ev: string, ...a: unknown[]): unknown };
  on(ev: string, fn: Listener): unknown;
  off(ev?: string, fn?: Listener): unknown;
  once(ev: string, fn: Listener): unknown;
  emit(ev: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emit(ev: string, ...args: unknown[]): unknown };
  connect(): unknown;
  disconnect(): unknown;
}

export interface LazySocketOptions {
  /** Disconnect after the tab has been hidden this long (default 5 min; 0 = never). */
  hiddenDisconnectMs?: number;
}

export const IDLE_DISCONNECT_EVENT = 'idle-disconnect';

type Op = (s: RealSocket) => void;
/** A queued call; listener registrations carry their key so a later `off` can cancel them before loading. */
interface Pending { op: Op; key?: { kind: 'on' | 'io'; ev: string; fn: Listener } }

export function createLazySocket<S>(
  load: () => Promise<{ io: (opts?: any) => S }>,
  ioOptions: Record<string, unknown> = {},
  opts: LazySocketOptions = {},
): S {
  const hiddenMs = opts.hiddenDisconnectMs ?? 5 * 60_000;
  let real: RealSocket | null = null;
  let loading: Promise<RealSocket> | null = null;
  const pending: Pending[] = [];
  let wantConnected = false; // the app asked to be connected and hasn't asked to disconnect since
  let suspended = false; // disconnected by this helper (hidden tab / idle room): resume when it makes sense
  let resuming = false;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const managerReconnect = new Set<Listener>();

  const run = (op: Op, key?: Pending['key']) => { if (real) op(real); else pending.push({ op, key }); };
  /** Before loading, `off(ev, fn)` just drops the matching queued `on`, so effect re-runs don't pile up. */
  const cancelQueued = (kind: 'on' | 'io', ev: string | undefined, fn: Listener | undefined): boolean => {
    if (real) return false;
    if (ev === undefined || fn === undefined) return false;
    const i = pending.findIndex((p) => p.key && p.key.kind === kind && p.key.ev === ev && p.key.fn === fn);
    if (i < 0) return false;
    pending.splice(i, 1);
    return true;
  };

  const ensure = (): Promise<RealSocket> => {
    if (real) return Promise.resolve(real);
    loading ??= load().then((m) => {
      // Test browsers say so in the handshake: the server drops their idle sockets after 2 min, not 15.
      const query = isAutomatedBrowser() ? { ...((ioOptions.query as Record<string, string>) || {}), mgTest: '1' } : ioOptions.query;
      const s = m.io({ ...ioOptions, ...(query ? { query } : {}), autoConnect: false }) as unknown as RealSocket;
      s.on(IDLE_DISCONNECT_EVENT, () => { if (wantConnected) suspended = true; });
      s.on('connect', () => {
        if (!resuming) return;
        resuming = false;
        // Apps that rejoin on the manager's 'reconnect' (fired only by automatic reconnection) hear it too.
        for (const fn of managerReconnect) { try { fn(0); } catch (e) { console.error(e); } }
      });
      real = s;
      for (const p of pending.splice(0)) p.op(s);
      return s;
    }).catch((e) => { loading = null; throw e; });
    return loading;
  };

  const resume = () => {
    if (!suspended || !wantConnected) return;
    suspended = false;
    resuming = true;
    run((s) => {
      if (s.sendBuffer) s.sendBuffer.length = 0;
      if (!s.active) s.connect();
    });
  };

  const suspend = () => {
    if (!real || !real.active || !wantConnected) return;
    suspended = true;
    real.disconnect();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === 'hidden') {
        if (hiddenMs > 0) hiddenTimer = setTimeout(suspend, hiddenMs);
      } else {
        resume();
      }
    });
    const onInput = () => { if (suspended && document.visibilityState === 'visible') resume(); };
    window.addEventListener('pointerdown', onInput, { passive: true });
    window.addEventListener('keydown', onInput);
  }

  const api = {
    get connected() { return real?.connected ?? false; },
    get active() { return real ? real.active : wantConnected && !suspended; },
    get id() { return real?.id; },
    io: {
      on(ev: string, fn: Listener) { if (ev === 'reconnect') managerReconnect.add(fn); run((s) => s.io.on(ev, fn), { kind: 'io', ev, fn }); return api.io; },
      off(ev: string, fn?: Listener) {
        if (ev === 'reconnect') { if (fn) managerReconnect.delete(fn); else managerReconnect.clear(); }
        if (!cancelQueued('io', ev, fn)) run((s) => s.io.off(ev, fn));
        return api.io;
      },
    },
    on(ev: string, fn: Listener) { run((s) => s.on(ev, fn), { kind: 'on', ev, fn }); return api; },
    off(ev?: string, fn?: Listener) { if (!cancelQueued('on', ev, fn)) run((s) => s.off(ev, fn)); return api; },
    once(ev: string, fn: Listener) { run((s) => s.once(ev, fn)); return api; },
    emit(ev: string, ...args: unknown[]) { run((s) => s.emit(ev, ...args)); return api; },
    timeout(ms: number) { return { emit: (ev: string, ...args: unknown[]) => { run((s) => s.timeout(ms).emit(ev, ...args)); return api; } }; },
    connect() {
      wantConnected = true;
      suspended = false;
      ensure().then((s) => { if (!s.active) s.connect(); }).catch((e) => console.error('socket.io-client failed to load', e));
      return api;
    },
    disconnect() {
      wantConnected = false;
      suspended = false;
      resuming = false;
      run((s) => s.disconnect());
      return api;
    },
  };
  return api as unknown as S;
}
