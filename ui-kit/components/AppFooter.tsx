/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { COPYRIGHT, PRIVACY_URL, TERMS_URL } from '../utils/constants';
import { cx } from '../utils/cx';
import { isNativeApp } from '../utils/native';

export interface AppFooterProps {
  /** Build / "Last updated" text. Hidden inside the Android app (store builds don't show web build info). */
  buildInfo?: ReactNode;
  /** More links after Privacy and Terms, e.g. [{ label: 'Contact', href: 'mailto:…' }]. */
  links?: Array<{ label: string; href: string }>;
  /** Extra content above the links (e.g. a short credit line). */
  children?: ReactNode;
  className?: string;
}

/** Links to another origin open in a new tab; same-origin ones (e.g. the footer on mohitgoenka.com itself) don't. */
function external(href: string): boolean {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://mohitgoenka.com/';
    const u = new URL(href, base);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== new URL(base).origin;
  } catch {
    return false;
  }
}

const link = 'inline-flex min-h-11 items-center px-2 text-mg-muted underline-offset-2 hover:text-mg-text hover:underline';

/** Page footer: © Mohit's Creations, Privacy and Terms (44px targets, 12px text), optional build info (web only). */
export function AppFooter({ buildInfo, links = [], children, className }: AppFooterProps) {
  const all = [{ label: 'Privacy', href: PRIVACY_URL }, { label: 'Terms', href: TERMS_URL }, ...links];
  return (
    <footer className={cx('relative z-[1] mx-auto w-full max-w-mg-content px-4 py-4 text-center text-mg-2xs text-mg-subtle', className)}>
      {children}
      <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-1">
        <span className="px-2">© {new Date().getFullYear()} {COPYRIGHT}</span>
        {all.map((l) => (
          <a key={l.href} href={l.href} {...(external(l.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={link}>
            {l.label}
          </a>
        ))}
      </nav>
      {buildInfo && !isNativeApp() ? <p className="mt-1">{buildInfo}</p> : null}
    </footer>
  );
}
