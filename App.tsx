import { useEffect, useState } from 'react';
import { DinerView } from './components/DinerView';
import { RestaurantView } from './components/RestaurantView';

type Route = 'diner' | 'restaurant';

function getRoute(): Route {
  if (typeof window === 'undefined') return 'diner';
  return window.location.pathname.startsWith('/restaurant') ? 'restaurant' : 'diner';
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute());

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title =
      route === 'restaurant' ? 'Eve · For Restaurants' : 'Eve · Yours, quietly';
  }, [route]);

  const navigate = (to: Route) => {
    const url = to === 'restaurant' ? '/restaurant' : '/';
    window.history.pushState({}, '', url);
    setRoute(to);
  };

  return (
    <div className="site-bg min-h-screen relative">
      {route === 'diner' ? (
        <DinerView onSwitchToRestaurant={() => navigate('restaurant')} />
      ) : (
        <RestaurantView onSwitchToDiner={() => navigate('diner')} />
      )}
    </div>
  );
}
