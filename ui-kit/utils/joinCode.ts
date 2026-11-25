/* generated from app-platform/ui-kit — edit there and re-sync. */
/** Room codes the games use: letters, digits, space, '-' and '_' (rooms.ts normalises case and spaces). */
const SAFE_ROOM = /^[a-z0-9][a-z0-9 _-]*$/i;

export interface ParseJoinCodeOptions {
  /** Longest code accepted (default 24, the rooms.ts limit). */
  maxLength?: number;
  /**
   * Hosts whose room links are accepted, besides mohitgoenka.com, *.mohitgoenka.com, this page's own host
   * and localhost. A link to any other site gives null.
   */
  hosts?: string[];
}

function hostAllowed(host: string, extra: string[]): boolean {
  const h = host.toLowerCase();
  if (h === 'mohitgoenka.com' || h.endsWith('.mohitgoenka.com')) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  try {
    if (typeof window !== 'undefined' && window.location && h === window.location.hostname.toLowerCase()) return true;
  } catch {
    /* ignore */
  }
  return extra.some((x) => x.toLowerCase() === h);
}

function clean(v: string | null, maxLength: number): string | null {
  if (v == null) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t && t.length <= maxLength && SAFE_ROOM.test(t) ? t : null;
}

/**
 * The room code in a scanned QR: a room link (`https://<app>.mohitgoenka.com/?join=CODE`) or a bare CODE.
 * Null for anything else (other sites, links without `join`, unsafe characters, too long).
 */
export function parseJoinCode(text: unknown, options: ParseJoinCodeOptions = {}): string | null {
  if (typeof text !== 'string') return null;
  const maxLength = options.maxLength ?? 24;
  const raw = text.trim();
  if (!raw || raw.length > 2048) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes('/') || raw.includes('?')) {
    let url: URL;
    try {
      url = new URL(raw, 'https://mohitgoenka.com');
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // A relative link ('/?join=x', '?join=x') resolves against the base above, which is allowed.
    if (!hostAllowed(url.hostname, options.hosts ?? [])) return null;
    return clean(url.searchParams.get('join'), maxLength);
  }
  return clean(raw, maxLength);
}
