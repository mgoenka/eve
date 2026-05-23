import { useEffect, useState } from 'react';
import { DinerView } from './components/DinerView';
import { RestaurantView } from './components/RestaurantView';
import { CityLanding } from './components/CityLanding';
import { PricingPage } from './components/PricingPage';
import { findCity, CITIES } from './data/cities';

type Route =
  | { kind: 'diner' }
  | { kind: 'restaurant' }
  | { kind: 'pricing' }
  | { kind: 'city'; slug: string };

const CITY_SLUGS = new Set(CITIES.map((c) => c.slug));

function getRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'diner' };
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.startsWith('/restaurant')) return { kind: 'restaurant' };
  if (path === '/pricing') return { kind: 'pricing' };
  const slug = path.replace(/^\//, '');
  if (CITY_SLUGS.has(slug)) return { kind: 'city', slug };
  return { kind: 'diner' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute());

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (route.kind === 'restaurant') document.title = 'Eve · For Restaurants';
    else if (route.kind === 'pricing') document.title = 'Eve · Pricing';
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

  if (route.kind === 'restaurant') {
    return (
      <div className="site-bg min-h-screen relative">
        <RestaurantView onSwitchToDiner={() => navigate('diner')} />
      </div>
    );
  }
  if (route.kind === 'pricing') {
    return (
      <div className="site-bg min-h-screen relative">
        <PricingPage onBack={() => navigate('diner')} />
      </div>
    );
  }
  if (route.kind === 'city') {
    const city = findCity(route.slug);
    if (city) {
      return (
        <div className="site-bg min-h-screen relative">
          <CityLanding
            city={city}
            onPlanInCity={() => {
              // Pass the city as URL state so the diner planner pre-fills it.
              const initial = btoa(encodeURIComponent(JSON.stringify({ city: city.fullName, vibe: 'date_night' })));
              window.history.pushState({}, '', `/?plan=${initial}`);
              setRoute({ kind: 'diner' });
            }}
          />
        </div>
      );
    }
  }
  return (
    <div className="site-bg min-h-screen relative">
      <DinerView onSwitchToRestaurant={() => navigate('restaurant')} />
    </div>
  );
}
