/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useSyncExternalStore } from 'react';
import { isNativeApp } from '../utils/native';

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPromptState {
  /** The browser offered to install this site (Chrome / Edge on Android, desktop, Chromebook). */
  canInstall: boolean;
  /** Running as an installed app (standalone display mode) or just installed. */
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let snapshot: InstallPromptState = { canInstall: false, installed: false };
const listeners = new Set<() => void>();
const emit = (patch: Partial<InstallPromptState>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
};

const standalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};

// Listen from the moment the kit loads: the event fires once, early, and is lost if nobody holds on to it.
if (typeof window !== 'undefined' && !isNativeApp()) {
  snapshot = { canInstall: false, installed: standalone() };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    emit({ canInstall: !snapshot.installed });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit({ canInstall: false, installed: true });
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const get = () => snapshot;
const SERVER: InstallPromptState = { canInstall: false, installed: false };

/**
 * "Install app" for the website (web only: always canInstall false inside the Android app and once installed).
 * `promptInstall()` shows the browser's install dialog; resolves 'accepted', 'dismissed' or 'unavailable'.
 */
export function useInstallPrompt(): InstallPromptState & { promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'> } {
  const s = useSyncExternalStore(subscribe, get, () => SERVER);
  return { ...s, promptInstall };
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // a prompt event can be used once
  emit({ canInstall: false });
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') emit({ installed: true });
    return outcome;
  } catch {
    return 'unavailable';
  }
}
