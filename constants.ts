import type { Cuisine, Vibe, DietaryPreference, StopKind } from './types';

export interface CuisineOption {
  id: Cuisine;
  label: string;
}

export const CUISINES: CuisineOption[] = [
  { id: 'indian', label: 'Indian' },
  { id: 'italian', label: 'Italian' },
  { id: 'thai', label: 'Thai' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'mexican', label: 'Mexican' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'mediterranean', label: 'Mediterranean' },
  { id: 'american', label: 'American' },
  { id: 'fusion', label: 'Fusion' },
  { id: 'cafe', label: 'Cafe' },
];

export interface VibeOption {
  id: Vibe;
  label: string;
  emoji: string;
  hint: string;
}

export const VIBES: VibeOption[] = [
  {
    id: 'date_night',
    label: 'Date Night',
    emoji: '★',
    hint: 'Romantic, intimate, slow-paced',
  },
  {
    id: 'celebrating',
    label: 'Celebrating',
    emoji: '◆',
    hint: 'Big moment, festive, special',
  },
  {
    id: 'casual',
    label: 'Casual',
    emoji: '◇',
    hint: 'Easygoing, no fuss',
  },
  {
    id: 'family',
    label: 'Family',
    emoji: '○',
    hint: 'Kid-friendly, warm, easy',
  },
  {
    id: 'friends',
    label: 'Friends',
    emoji: '△',
    hint: 'Lively, social, fun',
  },
  {
    id: 'solo',
    label: 'Solo',
    emoji: '·',
    hint: 'Quiet, unhurried, reflective',
  },
];

export interface DietaryOption {
  id: DietaryPreference;
  label: string;
}

export const DIETARY_PREFERENCES: DietaryOption[] = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'gluten_free', label: 'Gluten-free' },
  { id: 'dairy_free', label: 'Dairy-free' },
  { id: 'halal', label: 'Halal' },
  { id: 'kosher', label: 'Kosher' },
  { id: 'nut_free', label: 'Nut-free' },
];

export interface StopKindMeta {
  kind: StopKind;
  label: string;
}

export const STOP_KINDS: StopKindMeta[] = [
  { kind: 'dinner', label: 'Dinner' },
  { kind: 'dessert', label: 'Dessert' },
  { kind: 'drink', label: 'Drinks' },
  { kind: 'walk', label: 'Walk' },
  { kind: 'live_music', label: 'Live Music' },
  { kind: 'view', label: 'A View' },
  { kind: 'activity', label: 'Activity' },
];

export interface SampleQuery {
  id: string;
  label: string;
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetUSD: number;
  freeText: string;
}

export const SAMPLE_QUERIES: SampleQuery[] = [
  {
    id: 'date_santa_clara',
    label: 'Date night in Santa Clara, vegetarian',
    city: 'Santa Clara, CA',
    vibe: 'date_night',
    party: 2,
    dietary: ['vegetarian'],
    budgetUSD: 200,
    freeText: 'Indian or Italian dinner, dessert nearby, finish with a quiet garden walk under stringlights',
  },
  {
    id: 'celebrate_sf',
    label: 'Anniversary in San Francisco',
    city: 'San Francisco, CA',
    vibe: 'celebrating',
    party: 2,
    dietary: ['vegetarian'],
    budgetUSD: 350,
    freeText: 'Tasting menu vibe, dessert at a wine bar, end on a rooftop with a view',
  },
  {
    id: 'family_palo_alto',
    label: 'Family dinner in Palo Alto',
    city: 'Palo Alto, CA',
    vibe: 'family',
    party: 4,
    dietary: ['vegetarian', 'nut_free'],
    budgetUSD: 180,
    freeText: 'Easy Italian dinner, gelato walk, quick stop at a bookstore the kids will love',
  },
];

export const DEMO_RESTAURANTS = [
  {
    id: 'saffron_garden',
    name: 'Saffron Garden',
    city: 'Santa Clara, CA',
    cuisine: 'indian' as Cuisine,
    voice:
      'Warm, family-run, recipe-honoring, slightly proud. Avoid cliches like "authentic" — let specifics speak.',
    signatureDishes: 'Paneer butter masala, dal makhani, garlic naan, mango lassi',
    primaryColor: '#c2410c',
  },
  {
    id: 'verdure',
    name: 'Verdure',
    city: 'San Francisco, CA',
    cuisine: 'italian' as Cuisine,
    voice:
      'Modern, ingredient-led, slow-food but unfussy. Tone is confident and observational.',
    signatureDishes: 'Burrata with stone fruit, hand-cut tagliolini al limone, tiramisu',
    primaryColor: '#16a34a',
  },
];
