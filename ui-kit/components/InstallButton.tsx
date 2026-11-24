/* generated from app-platform/ui-kit — edit there and re-sync. */
import { promptInstall, useInstallPrompt } from '../hooks/useInstallPrompt';
import { showToast } from '../utils/toastBus';
import { InstallIcon } from './icons';
import { IconButton } from './IconButton';
import { Button } from './Button';

export interface InstallButtonProps {
  /** 'icon' = header square (default), 'button' = labelled secondary button. */
  variant?: 'icon' | 'button';
  /** Default "Install app". */
  label?: string;
  className?: string;
}

/** Show the browser's install dialog; a success toast when the user accepts. Used by InstallButton and AppHeader's ⋯ menu. */
export async function installApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const r = await promptInstall();
  if (r === 'accepted') showToast({ id: 'mg-install', tone: 'success', message: 'Installed! Open it from your home screen.' });
  return r;
}

/**
 * "Install app" (add the website to the home screen / shelf). Web only: renders nothing inside the Android app,
 * when already installed, or until the browser offers it (beforeinstallprompt; Chrome / Edge).
 */
export function InstallButton({ variant = 'icon', label = 'Install app', className }: InstallButtonProps) {
  const { canInstall } = useInstallPrompt();
  if (!canInstall) return null;
  const onClick = () => void installApp();
  return variant === 'icon' ? (
    <IconButton aria-label={label} onClick={onClick} {...(className ? { className } : {})}>
      <InstallIcon size="1.125rem" />
    </IconButton>
  ) : (
    <Button variant="secondary" size="sm" onClick={onClick} {...(className ? { className } : {})}>
      <InstallIcon size="1em" /> {label}
    </Button>
  );
}
