/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useOnline } from '../hooks/useOnline';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { HUB_LABEL, HUB_URL } from '../utils/constants';
import { cx } from '../utils/cx';
import { isNativeApp } from '../utils/native';
import { phoneTitle } from '../utils/headerTitle';
import type { Backup } from '../utils/backup';
import { BackupButton } from './BackupButton';
import { CloudIcon, HelpIcon, InstallIcon, MoreIcon, SettingsIcon, VolumeOffIcon, VolumeOnIcon } from './icons';
import { IconButton } from './IconButton';
import { InstallButton, installApp } from './InstallButton';
import { OfflinePill } from './OfflineBanner';
import { SettingsSheet } from './SettingsSheet';
import type { SettingsSheetProps } from './SettingsSheet';

/** An entry of the header's ⋯ menu (phones). */
export interface HeaderMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Toggle items: shown as a checked menu item. */
  checked?: boolean;
}

export interface AppHeaderProps {
  /** e.g. "Mohit's Bingo". A string "Mohit's X" shows as "X" on phones (the full title on wider screens). */
  title: ReactNode;
  /** The title on phones instead (default: a string title without its leading "Mohit's "); pass `title` again to keep it. */
  phoneTitle?: ReactNode;
  /** Icon next to the title (wider screens only): an image URL (default '/favicon.svg'), any node, or null for none. */
  icon?: string | ReactNode | null;
  /** Click on the title (e.g. go back to setup). Without it the title is plain text. */
  onTitleClick?: () => void;
  /** Accessible label for the title button. Default "Go back" when confirmBack, otherwise the title. */
  titleLabel?: string;
  /** Shows the red pulsing "Go back?" in place of the title (the apps' two-tap back pattern). */
  confirmBack?: boolean;
  /** Text shown when confirmBack. Default "Go back?". */
  confirmText?: string;
  /** Back-to-hub link. Default the hub (mohitgoenka.com/apps/); pass false/null to omit it. Always hidden inside the native app. */
  hubHref?: string | false | null;
  /** Default "Apps and Games" (label hidden on phones, 🎮 always shown). */
  hubLabel?: string;
  /** Open the hub in a new tab (the apps' current behaviour). Default true. */
  hubNewTab?: boolean;
  /** Shows the Help (?) button. */
  onRules?: () => void;
  /** Default "Help". */
  rulesLabel?: string;
  /**
   * The Settings (gear) button opens your own settings. Without it the gear opens the kit's SettingsSheet
   * (sound, haptics, reduce motion, on-device AI), so every app has one; `settingsSheet={false}` removes it.
   */
  onSettings?: () => void;
  /** Props for the built-in SettingsSheet (used when there is no onSettings), or false for no gear at all. */
  settingsSheet?: false | Omit<SettingsSheetProps, 'open' | 'onClose'>;
  /**
   * The app's mute toggle, drawn by the header: an icon on wider screens, an item of the ⋯ menu on phones; the
   * built-in SettingsSheet's "Sound effects" switch follows it. (A mute button in `right` still works.)
   */
  sound?: { muted: boolean; onToggle: () => void };
  /**
   * The backup / sync button (utils/backup.ts + useBackupEntry), drawn by the header: the cloud button on wider
   * screens, a "Sync" ("Backup" for file-only apps) item of the ⋯ menu on phones, so the title keeps its room.
   *   backup={{ backup, onOpen: backupEntry.show, open: backupEntry.open }}
   * (A BackupButton in `right` still works, but takes room from the title on phones.)
   */
  backup?: { backup: Backup; onOpen: () => void; open?: boolean };
  /** More entries for the ⋯ menu on phones only (put wide-screen buttons in `right`). */
  menuItems?: HeaderMenuItem[];
  /** "Install app" on the website when the browser offers it. Default true (never inside the Android app). */
  install?: boolean;
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

/** Header icon size: 18px at the default root, scales with it (larger on big screens and TVs). */
const ICON = '1.125rem';

/** The ⋯ button and its popup menu (phones). Escape / outside tap closes it; focus returns to the button. */
function OverflowMenu({ items }: { items: HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role^=menuitem]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? []);
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative">
      <IconButton ref={btn} aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreIcon size={ICON} />
      </IconButton>
      {open ? (
        <div ref={menu} role="menu" className="absolute right-0 top-full z-[120] mt-2 min-w-48 overflow-hidden rounded-mg border border-mg-border bg-mg-elevated py-1 shadow-mg-modal animate-mg-pop">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-mg-text-2 hover:bg-white/5 hover:text-mg-text focus-visible:bg-white/5"
            >
              {it.icon ? <span className="inline-flex shrink-0 text-mg-muted" aria-hidden="true">{it.icon}</span> : null}
              <span className="min-w-0 flex-1">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The shared one-line header: [Apps and Games 🎮] [Title + icon] [right slot · ? · ⚙].
 * Wide screens: 3 columns with the title centred. Phones (and whenever nothing is on the left, e.g. inside the
 * Android app): [title | controls] so the title gets the room; mute / settings / install fold into a ⋯ menu.
 */
export function AppHeader({
  title,
  phoneTitle: phoneTitleProp,
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
  settingsSheet,
  sound,
  backup,
  menuItems = [],
  install = true,
  right,
  left,
  showOffline = true,
  sticky = false,
  className,
}: AppHeaderProps) {
  const online = useOnline();
  const [ownSettingsOpen, setOwnSettingsOpen] = useState(false);
  const { canInstall } = useInstallPrompt();
  const native = isNativeApp();
  const iconNode =
    icon == null || icon === false ? null : typeof icon === 'string' ? (
      <img src={icon} alt="" width={24} height={24} className="h-5 w-5 shrink-0 max-sm:hidden md:h-6 md:w-6" />
    ) : (
      <span className="inline-flex shrink-0 max-sm:hidden" aria-hidden="true">{icon}</span>
    );
  // Phones: the short title ("Bingo") when there is one; wider screens: the full one.
  const short = phoneTitleProp !== undefined ? phoneTitleProp : phoneTitle(title);

  const leftNode =
    left ??
    (hubHref && !native ? (
      <a
        href={hubHref}
        {...(hubNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-label={hubLabel}
        className="inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded text-xs font-medium text-mg-muted transition-colors hover:text-mg-gold sm:justify-start md:text-sm"
      >
        <span className="hidden sm:inline">{hubLabel}&nbsp;</span>
        <span aria-hidden="true" className="text-base sm:text-[inherit]">🎮</span>
      </a>
    ) : null);
  const hasLeft = leftNode !== null && leftNode !== undefined && leftNode !== false;

  const titleInner = confirmBack ? (
    <span className="animate-pulse whitespace-nowrap text-sm font-semibold text-red-400 md:text-base">{confirmText}</span>
  ) : (
    <>
      {short != null && short !== title ? (
        <>
          <span className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-mg-muted sm:hidden">{short}</span>
          <span className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-mg-muted max-sm:hidden md:text-base in-[.mg-tv]:text-lg">{title}</span>
        </>
      ) : (
        <span className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-mg-muted md:text-base in-[.mg-tv]:text-lg">{title}</span>
      )}
      {iconNode}
    </>
  );
  const titleBox = cx('flex min-h-11 min-w-0 items-center gap-2', hasLeft ? 'justify-start sm:justify-center' : 'justify-start');

  const settingsAction = onSettings ?? (settingsSheet === false ? undefined : () => setOwnSettingsOpen(true));
  const soundIcon = sound ? sound.muted ? <VolumeOffIcon size={ICON} className="text-mg-subtle" /> : <VolumeOnIcon size={ICON} className="text-mg-gold" /> : null;
  const showInstall = install && !native && canInstall;
  // Phones: mute / settings / install fold into one ⋯ menu when there are two or more of them, and whenever the app
  // gave menuItems (they have no icon of their own, so the menu is the only place they show).
  // Backup: never a button on phones (the title needs the room), always an item of the ⋯ menu there.
  const backupItem: HeaderMenuItem[] = backup ? [{ label: backup.backup.status().cloud ? 'Sync' : 'Backup', icon: <CloudIcon size={ICON} />, onClick: backup.onOpen }] : [];
  const folded: HeaderMenuItem[] = [
    ...backupItem,
    ...(sound ? [{ label: 'Sound', icon: soundIcon, checked: !sound.muted, onClick: sound.onToggle }] : []),
    ...(settingsAction ? [{ label: 'Settings', icon: <SettingsIcon size={ICON} />, onClick: settingsAction }] : []),
    ...(showInstall ? [{ label: 'Install app', icon: <InstallIcon size={ICON} />, onClick: () => void installApp() }] : []),
    ...menuItems,
  ];
  const fold = folded.length >= 2 || menuItems.length > 0 || !!backup;
  // max-sm:hidden (a variant) wins over IconButton's own inline-flex; plain `hidden` would not.
  const wideOnly = fold ? 'max-sm:hidden' : undefined;
  const sheetProps = settingsSheet === false ? null : (settingsSheet ?? {});

  return (
    <header
      className={cx(
        'relative z-[110] grid w-full items-center gap-2 border-b border-mg-border-subtle bg-mg-bg/95 px-3 py-2 backdrop-blur-sm md:px-4 md:py-2.5',
        hasLeft ? 'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[1fr_auto_1fr]' : 'grid-cols-[minmax(0,1fr)_auto]',
        sticky && 'sticky top-0',
        className,
      )}
    >
      {hasLeft ? <div className="flex min-w-0 items-center justify-self-start">{leftNode}</div> : null}

      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          aria-label={titleLabel ?? (confirmBack ? 'Confirm go back' : typeof title === 'string' ? title : undefined)}
          className={cx(titleBox, 'rounded transition-opacity hover:opacity-80')}
        >
          {titleInner}
        </button>
      ) : (
        <div className={titleBox}>{titleInner}</div>
      )}

      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 justify-self-end sm:gap-2">
        {showOffline && !online ? <OfflinePill /> : null}
        {right}
        {backup ? <BackupButton backup={backup.backup} onClick={backup.onOpen} pressed={!!backup.open} className="max-sm:hidden" /> : null}
        {sound ? (
          <IconButton aria-label={sound.muted ? 'Unmute' : 'Mute'} pressed={sound.muted} onClick={sound.onToggle} className={wideOnly}>
            {soundIcon}
          </IconButton>
        ) : null}
        {showInstall ? <InstallButton {...(wideOnly ? { className: wideOnly } : {})} /> : null}
        {onRules ? (
          <IconButton aria-label={rulesLabel} title="View rules" onClick={onRules}>
            <HelpIcon size={ICON} />
          </IconButton>
        ) : null}
        {settingsAction ? (
          <IconButton aria-label="Settings" onClick={settingsAction} className={wideOnly}>
            <SettingsIcon size={ICON} />
          </IconButton>
        ) : null}
        {fold ? (
          <div className="sm:hidden">
            <OverflowMenu items={folded} />
          </div>
        ) : null}
      </div>
      {!onSettings && sheetProps ? (
        <SettingsSheet
          {...sheetProps}
          // "Sound effects" only when it controls something: the header's `sound`, or an app that asks for it.
          show={{ sound: !!sound || !!sheetProps.sound, ...sheetProps.show }}
          open={ownSettingsOpen}
          onClose={() => setOwnSettingsOpen(false)}
          {...(sound && !sheetProps.sound
            ? {
                sound: {
                  on: !sound.muted,
                  onChange: (on: boolean) => {
                    if (on === sound.muted) sound.onToggle();
                  },
                },
              }
            : {})}
        />
      ) : null}
    </header>
  );
}
