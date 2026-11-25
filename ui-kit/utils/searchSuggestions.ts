/* generated from app-platform/ui-kit — edit there and re-sync. */
// Shape check for Google's Search suggestions HTML (groundingMetadata.searchEntryPoint.renderedContent).
// Plain erasable TypeScript, no imports: servers may import it too.

const MAX_HTML = 40_000;
const BAD = /<\s*\/?\s*(script|iframe|frame|object|embed|form|input|button|meta|link|base|textarea|select)\b|\bon[a-z]+\s*=|javascript:|vbscript:|@import|expression\s*\(/i;
const GOOGLE_SEARCH = /^https:\/\/www\.google\.[a-z.]{2,10}\/search\?/i;

/** True for HTML shaped like Google's renderedContent: no active content, every link a Google search. */
export function isSearchSuggestionsHtml(html: unknown): html is string {
  if (typeof html !== 'string' || html.length < 20 || html.length > MAX_HTML || BAD.test(html)) return false;
  const hrefs = [...html.matchAll(/\b(?:href|src|xlink:href|action|formaction)\s*=\s*(["']?)([^"'\s>]*)\1/gi)].map((m) => m[2]!.replace(/&amp;/g, '&'));
  if (hrefs.length === 0) return false;
  // url(...) in CSS may only be a data: URL (Google's logo is inline SVG).
  if ([...html.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi)].some((m) => !/^data:/i.test(m[2]!.trim()))) return false;
  return hrefs.every((h) => GOOGLE_SEARCH.test(h));
}
