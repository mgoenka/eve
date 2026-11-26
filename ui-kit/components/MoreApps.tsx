/* generated from app-platform/ui-kit — edit there and re-sync. */
import { cx } from '../utils/cx';
import { HUB_URL } from '../utils/constants';
import { isNativeApp } from '../utils/native';
import { appLink, siblingApps, type AppKind } from '../utils/apps';

export interface MoreAppsProps {
  /** Default "More from Mohit's Creations". */
  title?: string;
  /** How many cards (default 3). */
  count?: number;
  /** Suggest this kind first (default: the current app's kind). */
  kind?: AppKind;
  className?: string;
}

/**
 * A quiet row of sibling apps for the end of a game or under a result: name, one line and a link. On the
 * website the links go to each app and a "See all" link goes to the hub; inside the Android app they open the
 * Play listings (never web pages, so no outside purchase links), and apps not on Play are left out.
 */
export function MoreApps({ title = "More from Mohit's Creations", count = 3, kind, className }: MoreAppsProps) {
  const native = isNativeApp();
  const apps = siblingApps({ count, kind, native });
  if (!apps.length) return null;
  return (
    <nav aria-label={title} className={cx('mx-auto w-full max-w-md', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold text-mg-muted">{title}</h2>
        {!native ? (
          <a href={HUB_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-mg-gold hover:underline">
            See all
          </a>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {apps.map((a) => {
          const href = appLink(a, native);
          if (!href) return null;
          return (
            <li key={a.id}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-mg border border-mg-border-subtle bg-mg-surface px-3 py-2.5 transition-colors hover:border-mg-gold/40 hover:bg-mg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mg-gold"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {a.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-mg-text">Mohit's {a.name}</span>
                  <span className="block truncate text-xs text-mg-subtle">{a.blurb}</span>
                </span>
                <span aria-hidden="true" className="text-mg-gold">
                  ›
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default MoreApps;
