/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, getSettings, setSettings, subscribeSettings } from '../utils/settingsStore';
import type { MgSettings } from '../utils/settingsStore';

export type { MgSettings };

/** Shared sound / haptics / reduce-motion settings, persisted in localStorage and synced across components and tabs. */
export function useSettings(): [MgSettings, (patch: Partial<MgSettings>) => void] {
  const s = useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
  return [s, setSettings];
}
