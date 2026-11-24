/* generated from app-platform/ui-kit — edit there and re-sync. */
/*
 * Reference service worker for Mohit's apps.
 *  - Precaches the app shell (list injected at build time by ui-kit/vite-plugin-mg.mjs).
 *  - Navigations: network-first, but if the network has not answered within 800 ms (a Cloud Run cold start, a
 *    slow phone network) the cached index.html is served at once and the network answer still refreshes the
 *    cache in the background. A deploy is picked up immediately on a quick network; the app opens offline.
 *  - Same-origin GET assets: hashed /assets/* cache-first (immutable), everything else stale-while-revalidate.
 *  - NEVER cached: non-GET, cross-origin, /api, /socket.io, auth/login/oauth/session paths, requests with
 *    credentials headers, Range requests, and responses that are not plain 200 OK or say no-store/private.
 *  - Old versioned caches are deleted on activate; the page activates a waiting worker with
 *    postMessage({ type: 'SKIP_WAITING' }) (kit's registerServiceWorker does this from the update toast).
 */
const CACHE_VERSION = '__MG_VERSION__';
const CACHE_PREFIX = 'mg-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const PRECACHE = [/* __MG_PRECACHE__ */ '/', '/index.html'];
const SHELL_URL = '/index.html';
const NAV_TIMEOUT_MS = 800;

// Paths that must always go to the network and never be stored.
const NEVER_CACHE = [
  /^\/api(\/|$)/i,
  /^\/socket\.io(\/|$)/i,
  /^\/(auth|oauth|login|logout|signin|signout|session|callback|admin)(\/|$)/i,
  /^\/__/,
  /^\/sw\.js$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // add one by one so a single missing file doesn't break the install
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))),
    ),
  );
  // First install: no old worker to replace, so activate right away. Updates wait for SKIP_WAITING.
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function cacheable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  const cc = (response.headers.get('Cache-Control') || '').toLowerCase();
  if (cc.includes('no-store') || cc.includes('private')) return false;
  if (response.headers.has('Set-Cookie')) return false;
  return true;
}

async function put(request, response) {
  if (!cacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

async function networkFirstNavigation(event, request) {
  const network = fetch(request).then((response) => {
    if (cacheable(response)) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
    }
    return response;
  });
  network.catch(() => {}); // a failure after the cached page was served is not an error
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, NAV_TIMEOUT_MS); });
  const first = await Promise.race([network.then((r) => ({ r }), (e) => ({ e })), slow.then(() => null)]);
  clearTimeout(timer);
  if (first && 'r' in first) return first.r;
  const cached = (await caches.match(SHELL_URL)) || (await caches.match('/'));
  if (cached) {
    if (!first) event.waitUntil(network.catch(() => {})); // slow: keep refreshing the cache after answering
    return cached;
  }
  // Nothing cached yet (first visit): wait for the network, however slow.
  return network;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  put(request, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  return response || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // non-GET: straight to network, never cached
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin: browser default
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;
  if (request.headers.has('Authorization') || request.headers.has('Range')) return;
  if (request.cache === 'no-store') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event, request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request));
});
