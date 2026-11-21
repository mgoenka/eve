// Small in-memory LRU with a TTL and an optional byte budget. Used to serve
// identical AI requests (same venue card, same avatar mood, same content
// pack, same lookup) from memory instead of paying for another generation.
// Per instance only: Cloud Run instances are few and short-lived, so this
// stays tiny and needs no extra service.

export class TtlCache<V> {
  private map = new Map<string, { value: V; expiresAt: number; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private opts: { maxEntries: number; ttlMs: number; maxBytes?: number; sizeOf?: (v: V) => number }
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.opts.ttlMs): void {
    const bytes = this.opts.sizeOf ? this.opts.sizeOf(value) : 0;
    if (this.opts.maxBytes && bytes > this.opts.maxBytes) return;
    this.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs, bytes });
    this.totalBytes += bytes;
    while (
      this.map.size > this.opts.maxEntries ||
      (this.opts.maxBytes !== undefined && this.totalBytes > this.opts.maxBytes)
    ) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const hit = this.map.get(key);
    if (!hit) return;
    this.totalBytes -= hit.bytes;
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** Normalised cache key from loosely-typed request fields. */
export function cacheKey(...parts: unknown[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim().toLowerCase().replace(/\s+/g, ' ') : JSON.stringify(p ?? '')))
    .join('|');
}
