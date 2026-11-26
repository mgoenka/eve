/* generated from app-platform/ui-kit — edit there and re-sync. */
/*
 * Pulse: anonymous, cookie-free usage counts (server side: server-kit/pulse). vite-plugin-mg adds this file to
 * every app's build as /mg-pulse.js; the website loads it with <script src="/ui-kit/pulse.js" defer data-...>.
 *
 * Sends tiny beacons: "open" (a session starts: page shown, or back after 30 minutes away), "time" (seconds the
 * page was visible), and "game" / "use" through window.mgPulse(event) (ResultsCard and utils/pulse.ts call it).
 * Keeps one random id in localStorage. No cookies, nothing typed, no names. Skips automated browsers.
 *
 *   data-endpoint="https://..."  where beacons go (default /api/pulse/hit on the same site)
 *   data-page                    also report the first path segment (the website's sections)
 *   #mg-me / #mg-not-me          in the URL: count this browser as Mohit's own (shown apart) / undo
 */
(function () {
  if (typeof window === 'undefined' || window.mgPulse) return;
  var el = document.currentScript;
  var endpoint = (el && el.getAttribute('data-endpoint')) || '/api/pulse/hit';
  var withPage = !!(el && el.hasAttribute('data-page'));
  var noop = function () {};
  window.mgPulse = noop;

  var ua = navigator.userAgent || '';
  var search = '';
  try { search = location.search || ''; } catch (e) {}
  if (navigator.webdriver || /headless|lighthouse|bot|crawl|spider/i.test(ua) || /[?&](mgTest|e2e|aiTest)=/i.test(search)) return;
  if (!/^https?:$/.test(location.protocol)) return;

  var store;
  try { store = window.localStorage; store.setItem('mg_pulse_t', '1'); store.removeItem('mg_pulse_t'); } catch (e) { return; }
  var get = function (k) { try { return store.getItem(k); } catch (e) { return null; } };
  // Do-not-count switch for our own tools (store screenshots, test drivers): localStorage mg_pulse_off = '1'.
  if (get('mg_pulse_off') === '1' || window.__mgPulseOff) return;
  var set = function (k, v) { try { v == null ? store.removeItem(k) : store.setItem(k, v); } catch (e) {} };

  // #mg-me marks this browser (or this Android app) as Mohit's, so his own play is counted apart.
  var hash = location.hash;
  if (hash === '#mg-me' || hash === '#mg-not-me') {
    set('mg_pulse_me', hash === '#mg-me' ? '1' : null);
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {}
    try {
      var note = document.createElement('div');
      note.textContent = hash === '#mg-me' ? 'Stats: this device now counts as yours' : 'Stats: this device counts as a visitor again';
      note.setAttribute('role', 'status');
      note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:12px;background:#111;color:#f5c542;border:1px solid #f5c54255;font:14px system-ui,sans-serif';
      var show = function () { document.body.appendChild(note); setTimeout(function () { note.remove(); }, 3500); };
      document.body ? show() : addEventListener('DOMContentLoaded', show);
    } catch (e) {}
  }

  var id = get('mg_pulse_id');
  if (!id || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) {
    var bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach(function (_, i) { bytes[i] = Math.random() * 256; });
    id = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    set('mg_pulse_id', id);
  }

  var html = document.documentElement;
  var platform = function () {
    var tv = html.classList.contains('mg-tv');
    return tv ? 'tv' : window.MGNativeShell || /; wv\)/.test(ua) ? 'android' : 'web';
  };
  var form = function () {
    var m = Math.min(screen.width || 0, screen.height || 0);
    if (m && m < 600) return 'phone';
    if (m && m < 1100 && navigator.maxTouchPoints > 0) return 'tablet';
    return 'desktop';
  };
  var tz = function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (e) { return undefined; } };
  // Read ?s=share / ?s=qr now: apps may tidy their address bar before the open beacon goes out.
  var via = '';
  try { via = new URLSearchParams(location.search).get('s') || ''; } catch (e) {}
  var refHost = function () {
    var r = document.referrer || '';
    if (via === 'share' || via === 'qr') return 'mg-' + via;
    if (/^android-app:/i.test(r)) return 'android-app';
    try { return r ? new URL(r).hostname : ''; } catch (e) { return ''; }
  };

  var send = function (body) {
    body.d = id;
    if (get('mg_pulse_me') === '1') body.me = 1;
    var data = JSON.stringify(body);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([data], { type: 'text/plain' }))) return;
    } catch (e) {}
    try { fetch(endpoint, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain' }, credentials: 'omit' }).catch(noop); } catch (e) {}
  };

  // Visible time, flushed when the page hides and every 10 minutes while it stays up (TV sessions run long).
  var visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  var pending = 0;
  var flush = function () {
    if (visibleSince) { pending += Date.now() - visibleSince; visibleSince = document.visibilityState === 'visible' ? Date.now() : 0; }
    var s = Math.round(pending / 1000);
    if (s >= 5) { send({ e: 'time', s: Math.min(s, 3600) }); pending = 0; }
  };
  setInterval(function () { if (document.visibilityState === 'visible') flush(); }, 10 * 60 * 1000);

  var opened = false;
  var hiddenAt = 0;
  var open = function () {
    opened = true;
    var b = { e: 'open', p: platform(), r: refHost(), tz: tz() };
    if (b.p !== 'tv') b.f = form();
    if (withPage) b.pg = (location.pathname.split('/')[1] || '').toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9-]/g, '').slice(0, 30);
    send(b);
  };
  // Wait a moment after load: the Android shell and the TV class are set up by then.
  var start = function () {
    setTimeout(function () { if (document.visibilityState === 'visible' && !opened) open(); }, 1200);
  };
  document.readyState === 'complete' ? start() : addEventListener('load', start);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      flush();
    } else {
      visibleSince = Date.now();
      if (!opened || (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000)) open();
    }
  });
  addEventListener('pagehide', flush);

  var lastEvent = {};
  window.mgPulse = function (event, fingerprint) {
    if (event !== 'game' && event !== 'use') return;
    var now = Date.now();
    if (now - (lastEvent[event] || 0) < 5000) return;
    lastEvent[event] = now;
    var b = { e: event };
    if (event === 'game' && /^[a-f0-9]{16}$/.test(fingerprint || '')) b.g = fingerprint;
    send(b);
  };
})();
