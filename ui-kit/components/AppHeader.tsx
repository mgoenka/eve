/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { useOnline } from '../hooks/useOnline';
import { HUB_LABEL, HUB_URL } from '../utils/constants';
import { cx } from '../utils/cx';
import { HelpIcon, SettingsIcon } from './icons';
import { IconButton } from './IconButton';
import { OfflinePill } from './OfflineBanner';

export interface AppHeaderProps {
  /** e.g. "Mohit's Bingo" */
  title: ReactNode;
  /** Icon next to the title: an image URL (default '/favicon.svg'), any node, or null for none. */
  icon?: string | ReactNode | null;
  /** Click on the title (e.g. go back to setup). Without it the title is plain text. */
  onTitleClick?: () => void;
  /** Accessible label for the title button. Default "Go back" when confirmBack, otherwise the title. */
  titleLabel?: string;
  /** Shows the red pulsing "Go back?" in place of the title (the apps' two-tap back pattern). */
  confirmBack?: boolean;
  /** Text shown when confirmBack. Default "Go back?". */
  confirmText?: string;
  /** Back-to-hub link. Default the hub (mohitgoenka.com/apps/); pass false/null to omit it. */
  hubHref?: string | false | null;
  /** Default "Apps and Games" (label hidden on phones, 🎮 always shown). */
  hubLabel?: string;
  /** Open the hub in a new tab (the apps' current behaviour). Default true. */
  hubNewTab?: boolean;
  /** Shows the Help (?) button. */
  onRules?: () => void;
  /** Default "Help". */
  rulesLabel?: string;
  /** Shows the Settings (gear) button. */
  onSettings?: () => void;
  /** Extra controls on the right, before Help/Settings (use <IconButton> to match). */
  right?: ReactNode;
  /** Replaces the hub link on the left (rare). */
  left?: ReactNode;
  /** Show the "Offline" pill automatically when offline. Default true. */
  showOffline?: boolean;
  /** Stick to the top while scrolling. Default false (matches the apps today). */
  sticky?: boolean;
  className?: string;
}

/**
 * The shared one-line header: [Apps and Games 🎮] [Title + icon] [right slot · ? · ⚙].
 * Same 3-column grid the apps use today, one line on phones.
 */
export function AppHeader({
  title,
  icon = '/favicon.svg',
  onTitleClick,
  titleLabel,
  confirmBack = false,
  confirmText = 'Go back?',
  hubHref = HUB_URL,
  hubLabel = HUB_LABEL,
  hubNewTab = true,
  onRules,
  rulesLabel = 'Help',
  onSettings,
  right,
  left,
  showOffline = true,
  sticky = false,
  className,
}: AppHeaderProps) {
  const online = useOnline();
  const iconNode =
    icon == null || icon === false ? null : typeof icon === 'string' ? (
      <img src={icon} alt="" width={24} height={24} className="h-5 w-5 shrink-0 md:h-6 md:w-6" />
    ) : (
      <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span>
    );

  const titleInner = confirmBack ? (
    <span className="animate-pulse whitespace-nowrap text-xs font-semibold text-red-400 md:text-sm">{confirmText}</span>
  ) : (
    <>
      <span className="truncate whitespace-nowrap text-xs font-medium text-mg-muted md:text-sm">{title}</span>
      {iconNode}
    </>
  );

  return (
    <header
      className={cx(
        'relative z-[110] grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-mg-border-subtle bg-mg-bg/95 px-3 py-2 backdrop-blur-sm md:px-4 md:py-2.5',
        sticky && 'sticky top-0',
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-self-start">
        {left ??
          (hubHref ? (
            <a
              href={hubHref}
              {...(hubNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              aria-label={hubLabel}
              className="inline-flex min-h-10 items-center whitespace-nowrap rounded text-xs font-medium text-mg-muted transition-colors hover:text-mg-gold md:text-sm"
            >
              <span className="hidden sm:inline">{hubLabel}&nbsp;</span>
              <span aria-hidden="true" className="text-base sm:text-[inherit]">🎮</span>
            </a>
          ) : null)}
      </div>

      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          aria-label={titleLabel ?? (confirmBack ? 'Confirm go back' : typeof title === 'string' ? title : undefined)}
          className="flex min-h-10 min-w-0 max-w-[48vw] items-center justify-center gap-2 rounded transition-opacity hover:opacity-80 sm:max-w-none"
        >
          {titleInner}
        </button>
      ) : (
        <div className="flex min-h-10 min-w-0 max-w-[48vw] items-center justify-center gap-2 sm:max-w-none">{titleInner}</div>
      )}

      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 justify-self-end sm:gap-2">
        {showOffline && !online ? <OfflinePill /> : null}
        {right}
        {onRules ? (
          <IconButton aria-label={rulesLabel} title="View rules" onClick={onRules}>
            <HelpIcon size={18} />
          </IconButton>
        ) : null}
        {onSettings ? (
          <IconButton aria-label="Settings" onClick={onSettings}>
            <SettingsIcon size={18} />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
