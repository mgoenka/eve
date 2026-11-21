/* generated from app-platform/ui-kit — edit there and re-sync. */
import { getSettings } from './settingsStore';

/** Vibrate if supported and the user has haptics on. Never throws. */
export function haptic(pattern: number | number[] = 10): boolean {
  try {
    if (!getSettings().haptics) return false;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** Named presets so every app feels the same. */
export const haptics = {
  tap: () => haptic(10),
  select: () => haptic(15),
  success: () => haptic([20, 40, 20]),
  warning: () => haptic([30, 60, 30]),
  error: () => haptic([60, 40, 60]),
  buzz: () => haptic(120),
};
