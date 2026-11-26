/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useState } from 'react';
import { cx } from '../utils/cx';
import { buttonSizes, buttonVariants } from './Button';
import { cancelReminder, dailyRemindersAvailable, requestNotificationPermission, scheduleDailyReminder } from '../utils/nativeShell';
import { showToast } from '../utils/toastBus';

export interface DailyReminderPromptProps {
  /** Reminder id, unique per app and daily (e.g. 'ascend-daily'). */
  id: string;
  /** Notification title, e.g. "Mohit's Ascend". */
  title: string;
  /** Notification text, e.g. "Today's ladder is ready." */
  body: string;
  /** In-app path the notification opens, e.g. '/?daily=1'. */
  path: string;
  className?: string;
}

const key = (id: string) => `mg_reminder_${id}`;
const read = (id: string): 'on' | 'off' | null => {
  try {
    const v = localStorage.getItem(key(id));
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
};
const write = (id: string, v: 'on' | 'off') => {
  try {
    localStorage.setItem(key(id), v);
  } catch {
    /* ignore */
  }
};

/** The hour they played, kept to a friendly window (8 AM to 9 PM). */
const reminderHour = () => Math.min(21, Math.max(8, new Date().getHours()));
const hourLabel = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric' });
};

/**
 * After a daily challenge, inside the Android app only: "Remind me tomorrow?" Off by default; one tap schedules a
 * local daily notification at about the time they played (no server, no account). "No thanks" is remembered, and
 * once on it shows a quiet "Turn off" instead. Renders nothing on the website.
 */
export function DailyReminderPrompt({ id, title, body, path, className }: DailyReminderPromptProps) {
  const [choice, setChoice] = useState<'on' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(dailyRemindersAvailable());
    setChoice(read(id));
  }, [id]);
  if (!available || choice === 'off') return null;

  if (choice === 'on') {
    return (
      <p className={cx('text-center text-xs text-mg-muted', className)}>
        Daily reminder on.{' '}
        <button
          type="button"
          className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-mg-text-2"
          onClick={() => {
            void cancelReminder(id);
            write(id, 'off');
            setChoice('off');
          }}
        >
          Turn off
        </button>
      </p>
    );
  }

  return (
    <div className={cx('mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-mg border border-mg-border-subtle bg-mg-surface px-4 py-3', className)}>
      <span className="text-sm text-mg-text">Remind me tomorrow?</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex min-h-9 items-center px-2 text-xs text-mg-muted hover:text-mg-text-2"
          onClick={() => {
            write(id, 'off');
            setChoice('off');
          }}
        >
          No thanks
        </button>
        <button
          type="button"
          disabled={busy}
          className={cx('inline-flex items-center justify-center font-semibold', buttonVariants.outline, buttonSizes.sm)}
          onClick={async () => {
            setBusy(true);
            const hour = reminderHour();
            const ok = (await requestNotificationPermission()) && (await scheduleDailyReminder({ id, hour, minute: 0, title, body, path }));
            setBusy(false);
            if (ok) {
              write(id, 'on');
              setChoice('on');
              showToast({ tone: 'success', message: `We'll remind you every day at ${hourLabel(hour)}.` });
            } else {
              showToast({ tone: 'info', message: 'Notifications are off for this app. You can turn them on in Android settings.' });
            }
          }}
        >
          Remind me
        </button>
      </span>
    </div>
  );
}

export default DailyReminderPrompt;
