import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { DinerView } from './components/DinerView';
import { findCity, CITIES } from './data/cities';
import { RulesContext } from './components/RulesContext';
import { RulesOverlay, aiContentRuleSection, aiCreditsRuleSections, isNativeApp, lazyWithRetry, type RuleSection } from './ui-kit';
import { DataPage, EveSettings } from './components/AccountData';

// Secondary screens load on demand so the planner opens fast.
const RestaurantView = lazyWithRetry(() =>
  import('./components/RestaurantView').then((m) => ({ default: m.RestaurantView }))
);
const PricingPage = lazyWithRetry(() => import('./components/PricingPage').then((m) => ({ default: m.PricingPage })));
const CityLanding = lazyWithRetry(() => import('./components/CityLanding').then((m) => ({ default: m.CityLanding })));

const APP_RULES: RuleSection[] = [
  {
    title: 'Plan an evening',
    icon: '🌙',
    items: [
      'Pick a place (or tap the pin to use your location), a vibe, date, start time and how long the evening should run. Longer evenings get more stops.',
      'Set party size, budget per person, dietary needs and a cuisine if you have one, or just tell Eve what you want in your own words.',
      'Tap Plan my evening. Surprise me keeps what you filled in and lets Eve pick the rest. The sample chips fill the form for you.',
      'Hide the details if you would rather just talk to Eve.',
    ],
  },
  {
    title: 'Talk to Eve',
    icon: '🎙️',
    // No speech recognition inside the Android app: Eve speaks, you type.
    items: isNativeApp()
      ? [
          'Tap Activate to turn on Eve’s voice. Type what kind of evening you want; she asks for anything she still needs.',
          'Tap the speaker to mute her.',
        ]
      : [
          'Tap Activate to turn on Eve’s voice and the mic. Tell Eve what kind of evening you want; she asks for anything she still needs.',
          'Talk over her any time to cut in. Tap the speaker to mute her and turn the mic off.',
        ],
  },
  {
    title: 'Your evening',
    icon: '✨',
    items: [
      'Each stop shows its arrival time, what to order or do, walking time, a map link and reservation links where the venue takes bookings.',
      'Eve paints the first stop’s scene on her own. Tap Show picture on any other card to paint that one.',
      'With her voice on, Eve walks you through the evening stop by stop. You can stop the walkthrough, or play her narration.',
      'Ask for changes in the chat ("swap dessert for live music") or tap a tweak chip like Cheaper or Earlier.',
      'Share sends a link with the whole plan, so friends see the same evening. The pencil takes you back to the form.',
      'Your last six evenings are saved on this device under Your recent evenings. Tap one to reopen it, or the x to remove it.',
    ],
  },
  {
    title: 'Paintings and limits',
    icon: '🎨',
    items: [
      'Eve paints up to 40 pictures an hour for each visitor, and shows how many are left under Plan my evening. Cards she has already painted are free.',
      'If a picture fails or the hour’s paintings run out, the plan still works. Tap Repaint on a card to try again.',
      ...(isNativeApp() ? ['Out of Sparks, a card shows Get Sparks to see pictures instead of its picture; the plan itself stays.'] : []),
      'If Eve can’t finish a plan, you get a clear message and a Try again button.',
    ],
  },
  // Android app only (empty on the website): prepaid AI credits for every AI feature.
  ...aiCreditsRuleSections(),
  ...(isNativeApp()
    ? [
        {
          title: 'What Eve costs in credits',
          icon: '🧾',
          items: [
            'Each painted picture costs about 40 credits (a stop card about 55, with the web research behind it). Cards and portraits she has already painted are free.',
            'The plan itself costs about 25 credits (it searches the web for real venues); her lines, story and replies about 2 to 5 each; her voice about 1 to 3 per line and about 12 for the full narration.',
            'A plan with its first painted stop is usually about 100 credits; each extra Show picture about 55. A restaurant content pack (4 pictures) is about 170.',
            'If you run out mid-plan, the plan still shows: get more credits, then tap Show picture or Repaint on a card.',
          ],
        },
      ]
    : []),
  {
    title: 'For restaurants',
    icon: '🍽️',
    items: [
      'Tap the shop icon. Enter your restaurant and city; cuisine, voice and signature dishes are optional.',
      'Eve suggests tonight’s special from recent reviews or trends. Different dish asks for another idea.',
      'Generate tonight’s look makes an Instagram post, a Reel storyboard with voiceover, a menu card, an email and an SMS. It uses 4 of the hour’s paintings. Tap Cancel to stop while Eve is making it.',
      'Publish to Eve diners features your special to people planning evenings nearby.',
    ],
  },
  aiContentRuleSection(
    'evening plans, Eve’s lines and replies, stop pictures and restaurant content packs',
    'on each stop card, next to what Eve says, under the plan title and on each content card'
  ),
  {
    title: 'Your data',
    icon: '🔒',
    items: [
      'There is no sign-in. Recent evenings and your restaurant profile stay on this device.',
      'Specials you publish to Eve diners, and an Instagram connection, are stored on Eve’s server and linked to this device.',
      'Settings (the gear) → Delete my account and data removes all of it and resets Eve on this device.',
      'With Settings → Use this device’s AI on, phones and browsers with their own AI write Eve’s lines, story, narration, replies and restaurant copy on the device, free (no Sparks). Plans, pictures, the menu card and her voice still use Eve’s server.',
    ],
  },
  {
    title: 'Keys',
    icon: '⌨️',
    items: ['Press ? to open this guide and Esc to close it.'],
  },
];

type Route =
  | { kind: 'diner' }
  | { kind: 'restaurant' }
  | { kind: 'pricing' }
  | { kind: 'data' }
  | { kind: 'city'; slug: string };

const CITY_SLUGS = new Set(CITIES.map((c) => c.slug));

function getRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'diner' };
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.startsWith('/restaurant')) return { kind: 'restaurant' };
  if (path === '/pricing') return { kind: 'pricing' };
  if (path === '/delete-data') return { kind: 'data' };
  const slug = path.replace(/^\//, '');
  if (CITY_SLUGS.has(slug)) return { kind: 'city', slug };
  return { kind: 'diner' };
}

function ScreenFallback() {
  return (
    <div className="min-h-dvh flex items-center justify-center" role="status" aria-label="Loading">
      <div className="w-10 h-10 rounded-full border-2 border-eve-gold/25 border-t-eve-gold animate-spin" />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openRules = useCallback(() => setRulesOpen(true), []);
  const closeRules = useCallback(() => setRulesOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const rulesCtx = useMemo(() => ({ open: openRules, openSettings }), [openRules, openSettings]);

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // "?" opens the guide (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setRulesOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (route.kind === 'restaurant') document.title = 'Eve · For Restaurants';
    else if (route.kind === 'pricing') document.title = 'Eve · Pricing';
    else if (route.kind === 'data') document.title = 'Eve · Delete my account and data';
    else if (route.kind === 'city') {
      const c = findCity(route.slug);
      document.title = c?.title || 'Eve · Yours, quietly';
    } else document.title = 'Eve · Yours, quietly';
  }, [route]);

  const navigate = (kind: 'diner' | 'restaurant' | 'pricing') => {
    const url = kind === 'restaurant' ? '/restaurant' : kind === 'pricing' ? '/pricing' : '/';
    window.history.pushState({}, '', url);
    setRoute({ kind });
  };

  let screen;
  const city = route.kind === 'city' ? findCity(route.slug) : undefined;
  if (route.kind === 'restaurant') {
    screen = <RestaurantView onSwitchToDiner={() => navigate('diner')} />;
  } else if (route.kind === 'pricing') {
    screen = <PricingPage onBack={() => navigate('diner')} />;
  } else if (route.kind === 'data') {
    screen = <DataPage onBack={() => navigate('diner')} />;
  } else if (city) {
    screen = (
      <CityLanding
        city={city}
        onPlanInCity={() => {
          // Pass the city as URL state so the diner planner pre-fills it.
          const initial = btoa(encodeURIComponent(JSON.stringify({ city: city.fullName, vibe: 'date_night' })));
          window.history.pushState({}, '', `/?plan=${initial}`);
          setRoute({ kind: 'diner' });
        }}
      />
    );
  } else {
    screen = <DinerView onSwitchToRestaurant={() => navigate('restaurant')} />;
  }

  return (
    <RulesContext.Provider value={rulesCtx}>
      <div className="site-bg min-h-dvh relative">
        <Suspense fallback={<ScreenFallback />}>{screen}</Suspense>
      </div>
      {rulesOpen && <RulesOverlay appName="Eve" subtitle="How Eve works" sections={APP_RULES} onClose={closeRules} />}
      <EveSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </RulesContext.Provider>
  );
}
