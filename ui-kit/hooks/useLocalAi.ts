/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useSyncExternalStore } from 'react';
import { getLocalAiInfo, refreshLocalAi, subscribeLocalAi } from '../utils/localAi';
import type { LocalAiInfo } from '../utils/localAi';

/** Live on-device AI status (engine, state, download progress, free runs). */
export function useLocalAi(): LocalAiInfo {
  useEffect(() => {
    void refreshLocalAi();
  }, []);
  return useSyncExternalStore(subscribeLocalAi, getLocalAiInfo, getLocalAiInfo);
}
