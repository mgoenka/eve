/* generated from app-platform/ui-kit — edit there and re-sync. */
import { isNativeApp } from './native';

export type AppKind = 'game' | 'tool';

export interface CatalogApp {
  /** Repo folder name (as in native-apps/scripts/android-apps.json). */
  id: string;
  name: string;
  /** The public (brand) host. */
  url: string;
  /** Google Play package, when the app is on Play. */
  play?: string;
  kind: AppKind;
  /** Multiplayer party game (phones join a room). */
  party?: boolean;
  blurb: string;
  emoji: string;
}

/** Every public app, for cross-promotion. Keep in sync with native-apps/scripts/android-apps.json. */
export const APPS: CatalogApp[] = [
  { id: 'codenames', name: 'Covert', url: 'https://covert.mohitgoenka.com/', play: 'com.mohitgoenka.covert', kind: 'game', party: true, emoji: '🕵️', blurb: 'Team word spy game for 4+' },
  { id: 'familyfeud', name: 'Faceoff', url: 'https://faceoff.mohitgoenka.com/', play: 'com.mohitgoenka.faceoff', kind: 'game', party: true, emoji: '📋', blurb: 'Guess the top survey answers' },
  { id: 'jeopardy', name: 'Trivio', url: 'https://trivio.mohitgoenka.com/', play: 'com.mohitgoenka.trivio', kind: 'game', party: true, emoji: '❓', blurb: 'Trivia board on any topic' },
  { id: 'kbc', name: 'Ascend', url: 'https://ascend.mohitgoenka.com/', play: 'com.mohitgoenka.ascend', kind: 'game', party: true, emoji: '🏆', blurb: 'Climb the quiz ladder' },
  { id: 'wheeloffortune', name: 'Spello', url: 'https://spello.mohitgoenka.com/', play: 'com.mohitgoenka.spello', kind: 'game', party: true, emoji: '🎡', blurb: 'Spin, guess letters, solve' },
  { id: 'priceisright', name: 'Showcase', url: 'https://showcase.mohitgoenka.com/', play: 'com.mohitgoenka.showcase', kind: 'game', party: true, emoji: '🏷️', blurb: 'Guess the price, win the show' },
  { id: 'witsandwagers', name: 'Ballpark', url: 'https://ballpark.mohitgoenka.com/', play: 'com.mohitgoenka.ballpark', kind: 'game', party: true, emoji: '🎯', blurb: 'Guess numbers, bet on the closest' },
  { id: 'bingo', name: 'Bingo', url: 'https://bingo.mohitgoenka.com/', play: 'com.mohitgoenka.bingo', kind: 'game', party: true, emoji: '🎱', blurb: 'Bingo with any theme' },
  { id: 'derby', name: 'Derby', url: 'https://derby.mohitgoenka.com/', play: 'com.mohitgoenka.derby', kind: 'game', party: true, emoji: '🐎', blurb: 'Horse race dice and betting' },
  { id: 'buzzer', name: 'Buzzer', url: 'https://buzzer.mohitgoenka.com/', play: 'com.mohitgoenka.buzzer', kind: 'game', party: true, emoji: '🔔', blurb: 'Quiz buzzers on every phone' },
  { id: 'spinner', name: 'Spinner', url: 'https://spinner.mohitgoenka.com/', play: 'com.mohitgoenka.spinner', kind: 'tool', emoji: '🎰', blurb: 'Spin a wheel to decide' },
  { id: 'catan', name: 'Settlers', url: 'https://settlers.mohitgoenka.com/', play: 'com.mohitgoenka.catan.twa', kind: 'tool', emoji: '🗺️', blurb: 'Balanced hex boards' },
  { id: 'scorer', name: 'Scorer', url: 'https://scorer.mohitgoenka.com/', kind: 'tool', emoji: '📊', blurb: 'Keep score for any game' },
  { id: 'recipe', name: 'Recipe', url: 'https://recipe.mohitgoenka.com/', play: 'com.mohitgoenka.recipe', kind: 'tool', emoji: '🍳', blurb: 'Recipes from any dish or fridge' },
  { id: 'travel', name: 'Travel', url: 'https://travel.mohitgoenka.com/', play: 'com.mohitgoenka.travel', kind: 'tool', emoji: '✈️', blurb: 'Day-by-day trip plans' },
  { id: 'fit', name: 'Fit', url: 'https://fit.mohitgoenka.com/', play: 'com.mohitgoenka.fit', kind: 'tool', emoji: '💪', blurb: 'Meals and workouts that fit' },
  { id: 'eve', name: 'Eve', url: 'https://eve.mohitgoenka.com/', play: 'com.mohitgoenka.eve', kind: 'tool', emoji: '🌙', blurb: 'Plan a night out' },
];

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** The catalog entry for the page we're on (brand or legacy host), or null. */
export function currentApp(hostname: string = typeof location !== 'undefined' ? location.hostname : ''): CatalogApp | null {
  const h = hostname.replace(/^www\./, '');
  const legacy: Record<string, string> = {
    'codenames.mohitgoenka.com': 'codenames',
    'familyfeud.mohitgoenka.com': 'familyfeud',
    'jeopardy.mohitgoenka.com': 'jeopardy',
    'kbc.mohitgoenka.com': 'kbc',
    'wheeloffortune.mohitgoenka.com': 'wheeloffortune',
    'priceisright.mohitgoenka.com': 'priceisright',
    'witsandwagers.mohitgoenka.com': 'witsandwagers',
    'catan.mohitgoenka.com': 'catan',
  };
  return APPS.find((a) => hostOf(a.url) === h || legacy[h] === a.id) ?? null;
}

/** Where a catalog link should go: the website on the web; the Play listing inside the Android app (or null if not on Play). */
export function appLink(app: CatalogApp, native: boolean = isNativeApp()): string | null {
  if (!native) return app.url;
  return app.play ? `https://play.google.com/store/apps/details?id=${app.play}` : null;
}

/**
 * A few sibling apps to suggest: same kind first (party games after a party game), rotated by day so
 * repeat players see different ones. Excludes the current app and, inside the Android app, apps not on Play.
 */
export function siblingApps(opts: { count?: number; kind?: AppKind; exclude?: string; native?: boolean; day?: number } = {}): CatalogApp[] {
  const me = opts.exclude ?? currentApp()?.id;
  const native = opts.native ?? isNativeApp();
  const kind = opts.kind ?? APPS.find((a) => a.id === me)?.kind ?? 'game';
  const pool = APPS.filter((a) => a.id !== me && (!native || a.play));
  const day = opts.day ?? Math.floor(Date.now() / 86_400_000);
  const rotate = (list: CatalogApp[]) => (list.length ? list.map((_, i) => list[(i + day) % list.length]) : list);
  const same = rotate(pool.filter((a) => a.kind === kind));
  const other = rotate(pool.filter((a) => a.kind !== kind));
  return [...same, ...other].slice(0, opts.count ?? 3);
}

/** True on Android Chrome on the website (not inside our app): where a Google Play link makes sense. */
export function isAndroidWeb(): boolean {
  if (typeof navigator === 'undefined' || isNativeApp()) return false;
  return /Android/i.test(navigator.userAgent) && !/; wv\)/.test(navigator.userAgent);
}
