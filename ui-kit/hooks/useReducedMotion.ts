/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useMediaQuery } from './useMediaQuery';
import { useSettings } from './useSettings';

/** True when the OS asks for reduced motion OR the user turned it on in SettingsSheet. Gate JS animations/confetti on it. */
export function useReducedMotion(): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [settings] = useSettings();
  return system || settings.reduceMotion;
}

/** Non-hook version for event handlers / animation loops. */
export function prefersReducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.reduceMotion === 'true') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
