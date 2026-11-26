/* generated from app-platform/ui-kit — edit there and re-sync. */
import { cx } from '../utils/cx';
import { buttonSizes, buttonVariants } from './Button';
import { MoreApps } from './MoreApps';
import { currentApp, isAndroidWeb } from '../utils/apps';
import { isNativeApp } from '../utils/native';

export interface GuestOutroProps {
  /** Where "Host your own game" goes. Default: this app's start page (same origin, no room code). */
  hostHref?: string;
  /** Default "Host your own game". */
  hostLabel?: string;
  /** Show the sibling apps row under it. Default true. */
  moreApps?: boolean;
  className?: string;
}

/**
 * For a guest's phone at the end of a party game: a gentle next step. "Host your own game" (the free website
 * start page), a small Google Play link on Android browsers only, and a few sibling games. Nothing inside the
 * Android app links to the website.
 */
export function GuestOutro({ hostHref, hostLabel = 'Host your own game', moreApps = true, className }: GuestOutroProps) {
  const native = isNativeApp();
  const href = hostHref ?? (typeof location !== 'undefined' ? location.origin + '/' : '/');
  const app = currentApp();
  const play = !native && isAndroidWeb() && app?.play ? `https://play.google.com/store/apps/details?id=${app.play}` : null;
  return (
    <section aria-label="What's next" className={cx('mx-auto flex w-full max-w-md flex-col items-center gap-3', className)}>
      {!native ? (
        <a href={href} className={cx('inline-flex w-full items-center justify-center gap-2 font-semibold', buttonVariants.outline, buttonSizes.md)}>
          {hostLabel}
        </a>
      ) : null}
      {play ? (
        <a href={play} target="_blank" rel="noopener noreferrer" className="text-xs text-mg-subtle hover:text-mg-gold hover:underline">
          Also on Google Play
        </a>
      ) : null}
      {moreApps ? <MoreApps className="mt-2" /> : null}
    </section>
  );
}

export default GuestOutro;
