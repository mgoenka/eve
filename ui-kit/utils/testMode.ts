/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Free AI test mode, browser side. A page driven by automation (navigator.webdriver: Playwright, Puppeteer,
 * Selenium and most agent browsers) tags its same-origin requests with `x-mg-ai-test: 1`, so the app's server
 * answers AI routes with fixtures instead of calling Gemini (server/ai-guard.ts, "Free AI test mode").
 * Installed once on import of the kit; real visitors are untouched.
 */
export const AI_TEST_HEADER = 'x-mg-ai-test';

export function isAutomatedBrowser(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

const FLAG = '__mgAiTestFetch';

export function installAiTestHeader(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || !isAutomatedBrowser()) return;
  const w = window as Window & { [FLAG]?: boolean };
  if (w[FLAG]) return;
  w[FLAG] = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href, window.location.href).origin === window.location.origin) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set(AI_TEST_HEADER, '1');
        return realFetch(input, { ...init, headers });
      }
    } catch { /* fall through */ }
    return realFetch(input, init);
  };
}

installAiTestHeader();
