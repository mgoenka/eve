// The planner's on-screen state (form + the evening Eve made), restored automatically after the browser
// discards the tab, Android kills the app, or a deploy reloads the page. Text only: pictures live in
// stopPictures (by key) and narration audio is not kept.
import type { DietaryPreference, EveStory, Vibe } from '@/types';
import { DIETARY_PREFERENCES, VIBES } from '@/constants';
import { isObj, readSnapshot } from './persist';
import { sanitizeEvening, sanitizeStops, type SavedStop } from './savedEvenings';

export const DINER_SNAPSHOT_KEY = 'eve.diner.snapshot';
export const DINER_SNAPSHOT_V = 1;

export interface DinerForm {
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetPerPerson: number;
  cuisinePref: string;
  whenISO: string;
  startTime: string;
  durationHours: number;
  freeText: string;
  formExpanded: boolean;
}

export interface DinerChatMessage {
  role: 'user' | 'eve';
  text: string;
  ai?: boolean;
}

export type SnapshotStop = SavedStop & { imageKey?: string; availability?: { opentable: boolean; resy: boolean; tock: boolean } };

export interface DinerEvening {
  id: string;
  title: string;
  stops: SnapshotStop[];
  story: EveStory | null;
  introText: string;
  outroText: string;
  chatHistory: DinerChatMessage[];
  chatInput: string;
  groundedSources: string[];
  groundedSearchUsed: boolean;
  /** Narration text and where its audio is kept on this device (stopPictures). */
  narrationText: string;
  narrationKey: string;
}

export interface DinerSnapshot {
  /** location.search when saved: a different ?plan= link opened later wins over the snapshot. */
  search: string;
  form: DinerForm;
  evening: DinerEvening | null;
}

const VIBE_IDS = new Set<string>(VIBES.map((v) => v.id));
const DIETARY_IDS = new Set<string>(DIETARY_PREFERENCES.map((d) => d.id));
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function sanitizeForm(raw: unknown): DinerForm | null {
  if (!isObj(raw)) return null;
  // Reuse the saved-evening sanitizer for the shared fields (it needs one stop to pass).
  const base = sanitizeEvening({ ...raw, stops: [{ name: 'x' }] });
  if (!base || typeof raw.city !== 'string' || !VIBE_IDS.has(raw.vibe as string)) return null;
  return {
    city: str(raw.city, 120),
    vibe: base.vibe,
    party: base.party,
    dietary: base.dietary as DietaryPreference[],
    budgetPerPerson: base.budgetPerPerson,
    cuisinePref: str(raw.cuisinePref, 80),
    whenISO: base.whenISO,
    startTime: base.startTime,
    durationHours: base.durationHours,
    freeText: str(raw.freeText, 2000),
    formExpanded: raw.formExpanded !== false,
  };
}

/**
 * The form fields a ?plan= link carries (a city page sends just the city and vibe), cleaned like a snapshot:
 * a link is anyone's text, and a field of the wrong type used to crash the planner.
 */
export function sanitizePlanLink(raw: unknown): Partial<DinerForm> | null {
  if (!isObj(raw)) return null;
  const base = sanitizeEvening({ ...raw, stops: [{ name: 'x' }] });
  if (!base) return null;
  const out: Partial<DinerForm> = {};
  if (typeof raw.city === 'string' && raw.city.trim()) out.city = str(raw.city, 120);
  if (VIBE_IDS.has(raw.vibe as string)) out.vibe = base.vibe;
  if (raw.party !== undefined) out.party = Math.round(base.party);
  if (Array.isArray(raw.dietary)) out.dietary = base.dietary.filter((d) => DIETARY_IDS.has(d)) as DietaryPreference[];
  if (raw.budgetPerPerson !== undefined) out.budgetPerPerson = Math.round(base.budgetPerPerson);
  if (typeof raw.cuisinePref === 'string') out.cuisinePref = str(raw.cuisinePref, 80);
  if (base.whenISO) out.whenISO = base.whenISO;
  if (typeof raw.startTime === 'string' && /^\d{1,2}:\d{2}$/.test(raw.startTime)) out.startTime = base.startTime;
  if (raw.durationHours !== undefined) out.durationHours = base.durationHours;
  if (typeof raw.freeText === 'string') out.freeText = str(raw.freeText, 2000);
  return out;
}

function sanitizeSnapshotEvening(raw: unknown, form: DinerForm): DinerEvening | null {
  if (!isObj(raw)) return null;
  const checked = sanitizeEvening({ ...form, id: raw.id, title: raw.title, stops: raw.stops, story: raw.story });
  if (!checked || !Array.isArray(raw.stops)) return null;
  const rawStops = raw.stops as unknown[];
  const stops: SnapshotStop[] = sanitizeStops(rawStops).map((s, i) => {
    const r = isObj(rawStops[i]) ? (rawStops[i] as Record<string, unknown>) : {};
    const key = str(r.imageKey, 400);
    const a = isObj(r.availability) ? r.availability : null;
    return {
      ...s,
      ...(key ? { imageKey: key } : {}),
      ...(a ? { availability: { opentable: a.opentable === true, resy: a.resy === true, tock: a.tock === true } } : {}),
    };
  });
  const chat = Array.isArray(raw.chatHistory)
    ? raw.chatHistory.slice(-40).flatMap((m): DinerChatMessage[] => {
        if (!isObj(m) || (m.role !== 'user' && m.role !== 'eve') || typeof m.text !== 'string') return [];
        return [{ role: m.role, text: m.text.slice(0, 2000), ...(m.ai ? { ai: true } : {}) }];
      })
    : [];
  return {
    id: checked.id,
    title: checked.title,
    stops,
    story: checked.story || null,
    introText: str(raw.introText, 600),
    outroText: str(raw.outroText, 600),
    chatHistory: chat,
    chatInput: str(raw.chatInput, 2000),
    groundedSources: Array.isArray(raw.groundedSources)
      ? raw.groundedSources.filter((s): s is string => typeof s === 'string').slice(0, 12).map((s) => s.slice(0, 300))
      : [],
    groundedSearchUsed: raw.groundedSearchUsed === true,
    narrationText: str(raw.narrationText, 4000),
    narrationKey: str(raw.narrationKey, 400),
  };
}

const isSnapshotShape = (d: unknown): d is DinerSnapshot =>
  isObj(d) && typeof d.search === 'string' && isObj(d.form) && (d.evening === null || isObj(d.evening));

/** The saved planner state, cleaned, or null when there is none (or it no longer fits this build). */
export function readDinerSnapshot(): DinerSnapshot | null {
  const raw = readSnapshot(DINER_SNAPSHOT_KEY, DINER_SNAPSHOT_V, isSnapshotShape);
  if (!raw) return null;
  try {
    const form = sanitizeForm(raw.form);
    if (!form) return null;
    return { search: raw.search, form, evening: raw.evening ? sanitizeSnapshotEvening(raw.evening, form) : null };
  } catch {
    return null;
  }
}
