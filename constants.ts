import type { Cuisine, Vibe, DietaryPreference, StopKind } from './types';

// Inline button trivia / Eve-musings shown while the plan is being built.
// Themed to evenings, dining, romance, cities — the world Eve lives in.
// Cycled inside the "Plan my evening" / "Surprise me" buttons.
export const LOADING_MESSAGES: string[] = [
  'The best Bordeaux pairings are decided in the first three minutes ◇',
  'Most bartenders open the night with a Negroni for the regulars ★',
  'A four-stop evening peaks somewhere in the second hour, every time ◆',
  'Italians believe a meal without dessert ends mid-sentence ◇',
  'Candlelight at 4 to 6 inches above the table is the most flattering ★',
  'Tokyo has 200,000+ restaurants — more than NYC, Paris, and London combined',
  'A chef will remember a regular’s order before they remember a name ○',
  'In Spain, dinner before 9 pm is considered a tourist hour ◆',
  'Every cocktail menu has at least one drink the bartender quietly hates',
  'Walking 10 minutes between stops makes the second one taste sharper ★',
  'The first 30 seconds of any first date set the rest of the night ◇',
  'Most Michelin reviewers visit a restaurant three times before scoring',
  'Dessert is best ordered before the first course is fully cleared ◆',
  'A small candle outperforms an overhead light by every measure of romance ★',
  'Indian thalis are calibrated so each bite balances the last ◇',
  'In France, dinner without wine is a working lunch ★',
  'The most ordered item on a date night menu is rarely the best one ◇',
  'Wine bars are loneliest at 5:30 and busiest at 9:15 ○',
  'A walk after dinner is the most underrated cocktail in the world ★',
  'Two people sharing one dessert decide more about the relationship than the entrée',
];

export interface CuisineOption {
  id: Cuisine;
  label: string;
}

export const CUISINES: CuisineOption[] = [
  { id: 'Indian', label: 'Indian' },
  { id: 'Italian', label: 'Italian' },
  { id: 'Thai', label: 'Thai' },
  { id: 'Japanese', label: 'Japanese' },
  { id: 'Mexican', label: 'Mexican' },
  { id: 'Chinese', label: 'Chinese' },
  { id: 'Mediterranean', label: 'Mediterranean' },
  { id: 'American', label: 'American' },
  { id: 'Vietnamese', label: 'Vietnamese' },
  { id: 'Korean', label: 'Korean' },
  { id: 'Fusion', label: 'Fusion' },
  { id: 'Cafe', label: 'Cafe' },
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
    hint: 'Eyes on one person. Quiet pulse, candlelight, slow.',
  },
  {
    id: 'celebrating',
    label: 'Celebrating',
    emoji: '◆',
    hint: 'A milestone — birthday, anniversary, win. Festive, public joy.',
  },
  {
    id: 'casual',
    label: 'Casual',
    emoji: '◇',
    hint: 'No occasion. Just a good evening, minimal fuss.',
  },
  {
    id: 'family',
    label: 'Family',
    emoji: '○',
    hint: 'Multi-generational. Warm, kid-aware, easy pacing.',
  },
  {
    id: 'friends',
    label: 'Friends',
    emoji: '△',
    hint: 'A group out together. Loud-bright, social, shareable.',
  },
  {
    id: 'solo',
    label: 'Solo',
    emoji: '·',
    hint: 'Just you. Unhurried, contemplative, somewhere you can think.',
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

// Real Bay Area restaurants used as defaults so the demo is always honest.
// Cuisine + signatureDishes + voice are inferred at runtime via Google Search
// if the owner skips them. Display labels are TitleCase.
export const DEMO_RESTAURANTS = [
  {
    id: 'sattvik',
    name: 'Sattvik',
    city: 'Sunnyvale, CA',
    cuisine: 'Indian' as Cuisine,
    voice:
      'Warm, family-run, recipe-honoring, slightly proud. Avoid cliches like "authentic", let specifics speak.',
    signatureDishes:
      'Paneer butter masala, dal makhani, gobi manchurian, mango lassi, garlic naan',
    primaryColor: '#c2410c',
  },
  {
    id: 'cucina_venti',
    name: 'Cucina Venti',
    city: 'Mountain View, CA',
    cuisine: 'Italian' as Cuisine,
    voice:
      'Convivial, neighborhood-Italian, generous portions, family-table feel. Confident without being precious.',
    signatureDishes:
      'Spaghetti pomodoro, lasagna, eggplant parmigiana, tiramisu, house-baked focaccia',
    primaryColor: '#16a34a',
  },
  {
    id: 'chaat_bhavan',
    name: 'Chaat Bhavan',
    city: 'Mountain View, CA',
    cuisine: 'Indian' as Cuisine,
    voice:
      'Casual, street-food joy, loud and proud about chaat heritage. Approachable, not refined.',
    signatureDishes:
      'Pani puri, dahi puri, samosa chaat, bhel puri, masala dosa',
    primaryColor: '#dc2626',
  },
  {
    id: 'tamarine',
    name: 'Tamarine',
    city: 'Palo Alto, CA',
    cuisine: 'Fusion' as Cuisine,
    voice:
      'Refined modern Vietnamese, art-gallery elegant. Quietly confident, ingredient-forward.',
    signatureDishes:
      'Caramelized lemongrass tofu, shaking beef, summer rolls, lychee martini',
    primaryColor: '#7c3aed',
  },
  {
    id: 'vina_enoteca',
    name: 'Vina Enoteca',
    city: 'Palo Alto, CA',
    cuisine: 'Italian' as Cuisine,
    voice:
      'Slow-food, ingredient-led, tasting-menu energy without pretension. Confident and observational.',
    signatureDishes:
      'Burrata with stone fruit, hand-cut tagliolini al limone, branzino, tiramisu',
    primaryColor: '#0891b2',
  },
  {
    id: 'saravana_bhavan',
    name: 'Saravana Bhavan',
    city: 'Sunnyvale, CA',
    cuisine: 'Indian' as Cuisine,
    voice:
      'Iconic South Indian, generations-deep, no-fuss. Pride lives in the rava and the sambar.',
    signatureDishes:
      'Masala dosa, ghee roast, idli vada, rasam vadai, kesari',
    primaryColor: '#ea580c',
  },
];
