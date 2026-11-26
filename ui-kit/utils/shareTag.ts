/* generated from app-platform/ui-kit — edit there and re-sync. */
const OWN_URL = /^https:\/\/([a-z0-9-]+\.)*mohitgoenka\.com(\/|$|\?|#)/i;

/**
 * Mark one of our own links with how it was passed on (`?s=share` / `?s=qr`), so the anonymous usage counts can
 * tell which sharing works. Other sites' links, and links that already say, are left alone.
 */
export function tagShareUrl(url: string, via: 'share' | 'qr' = 'share'): string {
  if (!OWN_URL.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('s')) return url;
    u.searchParams.set('s', via);
    return u.toString();
  } catch {
    return url;
  }
}

/** tagShareUrl for every one of our links inside a piece of text. */
export function tagShareText(text: string, via: 'share' | 'qr' = 'share'): string {
  return text.replace(/https:\/\/[^\s"'<>]+/g, (u) => tagShareUrl(u, via));
}
