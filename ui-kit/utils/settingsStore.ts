/* generated from app-platform/ui-kit — edit there and re-sync. */
import { readJson, safeSet } from './storage';

export interface MgSettings {
  /** Sound effects on. */
  sound: boolean;
  /** Vibration feedback on (phones that support it). */
  haptics: boolean;
  /** Force reduced motion even if the OS does not ask for it. */
  reduceMotion: boolean;
}

export const SETTINGS_KEY = 'mg:settings:v1';
export const DEFAULT_SETTINGS: MgSettings = { sound: true, haptics: true, reduceMotion: false };

type Listener = () => void;
const listeners = new Set<Listener>();
let current: MgSettings = load();

function load(): MgSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const stored = readJson<Partial<MgSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

function applyToDocument(s: MgSettings): void {
  if (typeof document === 'undefined') return;
  if (s.reduceMotion) document.documentElement.dataset.reduceMotion = 'true';
  else delete document.documentElement.dataset.reduceMotion;
}
applyToDocument(current);

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SETTINGS_KEY) return;
    current = load();
    applyToDocument(current);
    listeners.forEach((l) => l());
  });
}

export function getSettings(): MgSettings {
  return current;
}

export function setSettings(patch: Partial<MgSettings>): MgSettings {
  current = { ...current, ...patch };
  safeSet(SETTINGS_KEY, JSON.stringify(current));
  applyToDocument(current);
  listeners.forEach((l) => l());
  return current;
}

export function subscribeSettings(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
