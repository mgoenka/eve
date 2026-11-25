// Recent evenings, kept on this device only (localStorage). Text only: on reopen,
// pictures painted before come back from this device (stopPictures), and only a
// missing first picture is painted again, so reopening costs no new planning call.
import type { DietaryPreference, EveStory, ExperienceStop, StopKind, Vibe } from '@/types';
import { STOP_KINDS, VIBES } from '@/constants';

export type SavedStop = Omit<ExperienceStop, 'status' | 'imageData' | 'imageMime' | 'error'>;

export interface SavedEvening {
  id: string;
  savedAt: number;
  title: string;
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetPerPerson: number;
  whenISO: string;
  startTime: string;
  durationHours: number;
  stops: SavedStop[];
  story?: EveStory | null;
}

const KEY = 'eve.recentEvenings.v1';
const MAX = 6;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const KINDS = new Set<string>(STOP_KINDS.map((k) => k.kind));
const VIBE_IDS = new Set<string>(VIBES.map((v) => v.id));

/** Defensive copy of stops from storage or a shared link. */
export function sanitizeStops(raw: unknown): SavedStop[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).flatMap((s: any) => {
    const name = str(s?.name, 120).trim();
    if (!name) return [];
    const kind = (KINDS.has(s?.kind) ? s.kind : 'dinner') as StopKind;
    return [
      {
        kind,
        name,
        oneLineVibe: str(s?.oneLineVibe, 240),
        whyThisFits: str(s?.whyThisFits, 300),
        approxArrival: str(s?.approxArrival, 20),
        durationMinutes: num(s?.durationMinutes, 60, 5, 480),
        walkMinutesFromPrev: num(s?.walkMinutesFromPrev, 0, 0, 240),
        signatureItem: str(s?.signatureItem, 160) || undefined,
        isEveOriginal: !!s?.isEveOriginal,
      },
    ];
  });
}

function sanitizeStory(raw: any): EveStory | null {
  if (!raw || typeof raw !== 'object') return null;
  const keys: (keyof EveStory)[] = ['opening', 'atStop1', 'transition1to2', 'atStop2', 'transition2to3', 'atStop3', 'closing', 'moodArc', 'weatherCue'];
  const out = {} as EveStory;
  for (const k of keys) (out as any)[k] = str(raw[k], 600);
  const later = Array.isArray(raw.laterStops) ? raw.laterStops.map((b: unknown) => str(b, 600)).filter(Boolean).slice(0, 3) : [];
  if (later.length) out.laterStops = later;
  return out.opening || out.atStop1 ? out : null;
}

export function sanitizeEvening(raw: any): SavedEvening | null {
  if (!raw || typeof raw !== 'object') return null;
  const stops = sanitizeStops(raw.stops);
  if (stops.length === 0) return null;
  return {
    id: str(raw.id, 40) || String(Date.now()),
    savedAt: num(raw.savedAt, Date.now(), 0, 8.64e15),
    title: str(raw.title, 120) || 'A planned evening.',
    city: str(raw.city, 120),
    vibe: (VIBE_IDS.has(raw.vibe) ? raw.vibe : 'date_night') as Vibe,
    party: num(raw.party, 2, 1, 20),
    dietary: Array.isArray(raw.dietary) ? raw.dietary.filter((d: unknown) => typeof d === 'string').slice(0, 8) : [],
    budgetPerPerson: num(raw.budgetPerPerson, 100, 5, 2000),
    whenISO: /^\d{4}-\d{2}-\d{2}$/.test(raw.whenISO) ? raw.whenISO : '',
    startTime: /^\d{1,2}:\d{2}$/.test(raw.startTime) ? raw.startTime : '19:30',
    durationHours: num(raw.durationHours, 4, 1.5, 8),
    stops,
    story: sanitizeStory(raw.story),
  };
}

export function loadEvenings(): SavedEvening[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitizeEvening).filter((e): e is SavedEvening => !!e) : [];
  } catch {
    return [];
  }
}

function write(list: SavedEvening[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

/** Insert or update (same title + city + first stop counts as the same evening). */
export function saveEvening(e: SavedEvening): SavedEvening[] {
  const sig = (x: SavedEvening) => `${x.title}|${x.city}|${x.stops[0]?.name}`.toLowerCase();
  const list = loadEvenings().filter((x) => x.id !== e.id && sig(x) !== sig(e));
  const next = [e, ...list].slice(0, MAX);
  write(next);
  return next;
}

export function removeEvening(id: string): SavedEvening[] {
  const next = loadEvenings().filter((x) => x.id !== id);
  write(next);
  return next;
}
