/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Room push, browser side. Phones: `registerSeatPush(socket)` sends the seat's FCM token (only after the player
 * said yes in NotifyTurnPrompt) and whether the page is hidden. Hosts: `notifySeats(socket, …)` asks the server
 * to push players who are away. Server side: server-kit/push/rooms.ts. No-ops on the website and in old builds.
 */
import { getPushToken, pushAvailable } from './nativeShell';
import { safeGet, safeSet } from './storage';

export const PUSH_CONSENT_KEY = 'mg:push-prompt:v1';
/** window event NotifyTurnPrompt fires after Allow (detail: { token }). */
export const PUSH_ALLOWED_EVENT = 'mg-push-allowed';
/** window event fired whenever the stored answer changes. */
export const PUSH_CONSENT_EVENT = 'mg-push-consent';

/** The player's answer to "Notify me when it's my turn": null = not asked yet. */
export type PushConsent = 'allowed' | 'dismissed' | 'denied';

export function pushConsent(): PushConsent | null {
  const v = safeGet(PUSH_CONSENT_KEY);
  return v === 'allowed' || v === 'dismissed' || v === 'denied' ? v : null;
}

export function setPushConsent(v: PushConsent): void {
  safeSet(PUSH_CONSENT_KEY, v);
  try {
    window.dispatchEvent(new CustomEvent(PUSH_CONSENT_EVENT, { detail: { consent: v } }));
  } catch {
    /* ignore */
  }
}

/** The bits of a Socket.IO client (or the kit's createLazySocket) used here. */
export interface PushSocketLike {
  emit(event: string, ...args: any[]): unknown;
  on(event: string, fn: (...args: any[]) => void): unknown;
  off(event: string, fn?: (...args: any[]) => void): unknown;
}

export interface RegisterSeatPushOptions {
  /** Server events after which the seat exists (re)send token + visibility. Default ['joined'] (rooms.ts). */
  joinedEvents?: string[];
}

/**
 * Phone side. Call once per socket (e.g. `useEffect(() => registerSeatPush(socket), [socket])`).
 * After every 'joined' (and right away, and when the player taps Allow) it emits `push-token { token }` if the
 * player allowed notifications, and `visibility { hidden }` now and on every visibilitychange.
 * Returns a cleanup function. Does nothing without push (website, old builds) or before the player says yes.
 */
export function registerSeatPush(socket: PushSocketLike, options: RegisterSeatPushOptions = {}): () => void {
  if (!socket || typeof window === 'undefined' || typeof document === 'undefined' || !pushAvailable()) return () => {};
  const events = options.joinedEvents ?? ['joined'];
  let token: string | null = null;
  let stopped = false;

  const sendVisibility = () => {
    if (stopped || pushConsent() !== 'allowed') return;
    socket.emit('visibility', { hidden: document.visibilityState === 'hidden' });
  };
  const sendToken = async () => {
    if (stopped || pushConsent() !== 'allowed') return;
    if (!token) token = await getPushToken();
    if (stopped || !token) return;
    socket.emit('push-token', { token });
  };
  const onJoined = () => {
    void sendToken();
    sendVisibility();
  };
  const onAllowed = (e: Event) => {
    const t = (e as CustomEvent<{ token?: unknown } | null>).detail?.token;
    if (typeof t === 'string' && t) token = t;
    onJoined();
  };

  for (const ev of events) socket.on(ev, onJoined);
  window.addEventListener(PUSH_ALLOWED_EVENT, onAllowed);
  document.addEventListener('visibilitychange', sendVisibility);
  onJoined(); // already in the room (the server ignores both while there is no seat)

  return () => {
    stopped = true;
    for (const ev of events) socket.off(ev, onJoined);
    window.removeEventListener(PUSH_ALLOWED_EVENT, onAllowed);
    document.removeEventListener('visibilitychange', sendVisibility);
  };
}

export type NotifyKind = 'turn' | 'start';

export interface NotifySeatsInput {
  /** Seat tokens or player names, or 'all'. */
  to: string[] | 'all';
  kind: NotifyKind;
  /** e.g. "Your turn!" (server default by kind when empty). */
  title?: string;
  /** e.g. "Mohit's Faceoff: the board is waiting for you." */
  body?: string;
}

/**
 * Host side: push the given seats if their phone is away (socket gone or page hidden). The server decides who
 * is away, limits sends (one per phone per 15 s per kind, 20 per room per minute) and sends nothing locally.
 * Resolves with the server's `{ sent }`, or null (no answer in `timeoutMs`, or an old server).
 * Call it when the turn passes to a remote seat, or when the game starts (`to: 'all', kind: 'start'`).
 */
export function notifySeats(socket: PushSocketLike, input: NotifySeatsInput, timeoutMs = 5000): Promise<{ sent: number } | null> {
  return new Promise((resolve) => {
    if (!socket || !input) return resolve(null);
    const to = input.to === 'all' ? 'all' : (Array.isArray(input.to) ? input.to : []).filter((x) => typeof x === 'string' && x).slice(0, 40);
    if (to !== 'all' && to.length === 0) return resolve({ sent: 0 });
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    try {
      socket.emit('notify', { to, kind: input.kind, title: input.title ?? '', body: input.body ?? '' }, (r: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const sent = r && typeof r === 'object' && typeof (r as { sent?: unknown }).sent === 'number' ? (r as { sent: number }).sent : 0;
        resolve({ sent });
      });
    } catch {
      done = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}
