/* generated from app-platform/ui-kit — edit there and re-sync. */
// Google Search suggestions for an answer grounded with Google Search (Gemini `googleSearch` tool).
// Google's Gemini API terms require grounded results to be shown together with their Search Suggestions, exactly as
// Google renders them (groundingMetadata.searchEntryPoint.renderedContent: its own HTML + CSS, chips that open a
// Google search). The HTML is shown unmodified in a sandboxed iframe: no scripts, an opaque origin, so its CSS
// can't touch the app and the app's can't restyle it. Links open in a new tab (the only thing added is
// <base target="_blank">). HTML that doesn't look like Google's (it can arrive in a shared link or a backup
// file) is not shown.
import { cx } from '../utils/cx';
import { isSearchSuggestionsHtml } from '../utils/searchSuggestions';

export { isSearchSuggestionsHtml };

export interface SearchSuggestionsProps {
  /** groundingMetadata.searchEntryPoint.renderedContent from the grounded answer. Nothing renders without it. */
  html?: string | null | undefined;
  className?: string;
  /** Iframe height in px (Google's chip row is about 50 px; wider rows scroll sideways inside it). */
  height?: number;
}

/** The Google Search suggestion chips that go with a grounded answer (required by Google's terms). */
export function SearchSuggestions({ html, className, height = 64 }: SearchSuggestionsProps) {
  if (!isSearchSuggestionsHtml(html)) return null;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title="Google Search suggestions"
      className={cx('block w-full border-0 bg-transparent', className)}
      style={{ height, colorScheme: 'normal' }}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      loading="lazy"
      srcDoc={doc}
    />
  );
}
