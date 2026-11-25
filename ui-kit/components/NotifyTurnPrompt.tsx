/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from '../utils/cx';
import { isTvDevice } from '../utils/native';
import { notificationPermission, pushAvailable, requestPushToken } from '../utils/nativeShell';
import { PUSH_ALLOWED_EVENT, PUSH_CONSENT_EVENT, pushConsent, setPushConsent } from '../utils/pushClient';
import type { PushConsent } from '../utils/pushClient';
import { showToast } from '../utils/toastBus';

export interface NotifyTurnPromptProps {
  /** Default "🔔 Notify me when it's my turn". */
  label?: ReactNode;
  /** Called with the player's answer ('allowed' with the token). */
  onResult?: (result: PushConsent, token?: string) => void;
  className?: string;
}

/**
 * Opt-in inline prompt for phone players in the Android app: "🔔 Notify me when it's my turn" · Allow · Not now.
 * The answer is kept in localStorage (`mg:push-prompt:v1`), so it is asked once. Renders nothing on the website,
 * in old builds, on TVs, once answered, or when notifications are blocked. Pair with `registerSeatPush(socket)`.
 */
export function NotifyTurnPrompt({ label = "🔔 Notify me when it's my turn", onResult, className }: NotifyTurnPromptProps) {
  const [consent, setConsent] = useState<PushConsent | null>(() => pushConsent());
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = pushAvailable() && !isTvDevice();

  useEffect(() => {
    if (!available) return;
    const sync = () => setConsent(pushConsent());
    window.addEventListener(PUSH_CONSENT_EVENT, sync);
    let alive = true;
    void notificationPermission().then((p) => { if (alive && p === 'denied') setBlocked(true); });
    return () => {
      alive = false;
      window.removeEventListener(PUSH_CONSENT_EVENT, sync);
    };
  }, [available]);

  if (!available || consent !== null || blocked) return null;

  const allow = async () => {
    setBusy(true);
    const token = await requestPushToken();
    setBusy(false);
    if (token) {
      setPushConsent('allowed');
      try {
        window.dispatchEvent(new CustomEvent(PUSH_ALLOWED_EVENT, { detail: { token } }));
      } catch {
        /* ignore */
      }
      onResult?.('allowed', token);
    } else {
      setPushConsent('denied');
      showToast({ tone: 'info', message: 'Notifications are off. You can turn them on in Android settings.' });
      onResult?.('denied');
    }
  };
  const later = () => {
    setPushConsent('dismissed');
    onResult?.('dismissed');
  };

  return (
    <div
      role="group"
      aria-label="Turn notifications"
      className={cx('flex flex-wrap items-center justify-between gap-2 rounded-mg border border-mg-border bg-mg-surface px-3 py-2 text-sm text-mg-text', className)}
    >
      <span className="min-w-0 font-medium">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={later} disabled={busy}>Not now</Button>
        <Button size="sm" onClick={() => void allow()} loading={busy} loadingText="Asking">Allow</Button>
      </span>
    </div>
  );
}
