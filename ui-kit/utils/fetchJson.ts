/* generated from app-platform/ui-kit — edit there and re-sync. */
export type FetchErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'aborted';

/** Typed error thrown by fetchJson. `message` is always safe to show to users. */
export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status: number;
  readonly url: string;
  /** Parsed JSON (or text) error body from the server, if any. Do not render as HTML. */
  readonly body: unknown;
  readonly attempts: number;
  constructor(kind: FetchErrorKind, message: string, init: { status?: number; url: string; body?: unknown; attempts: number }) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    this.status = init.status ?? 0;
    this.url = init.url;
    this.body = init.body;
    this.attempts = init.attempts;
  }
  /** True for errors worth a Retry button (timeouts, network, 429, 5xx). */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || (this.kind === 'http' && (this.status === 429 || this.status >= 500));
  }
}

export interface FetchJsonOptions extends Omit<RequestInit, 'body' | 'signal'> {
  /** Per-attempt timeout. Default 15000 ms. */
  timeoutMs?: number;
  /** Extra attempts after the first (clamped to 0..2). Default 0. Only timeouts, network errors, 429 and 5xx are retried. */
  retries?: number;
  /** Base backoff in ms; doubles each retry, with jitter. Default 600. */
  backoffMs?: number;
  /** JSON-serialisable body (sets Content-Type) or a raw BodyInit. */
  body?: unknown;
  /** Caller's AbortSignal (e.g. on unmount). */
  signal?: AbortSignal;
  /** Parse the response as JSON (default) or text. */
  responseType?: 'json' | 'text';
  /** Called with every HTTP response (also errors) before the body is read, e.g. to read headers. Must not throw. */
  onResponse?: (res: Response) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

function isRawBody(b: unknown): b is BodyInit {
  return (
    typeof b === 'string' ||
    (typeof FormData !== 'undefined' && b instanceof FormData) ||
    (typeof Blob !== 'undefined' && b instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) ||
    b instanceof ArrayBuffer ||
    ArrayBuffer.isView(b)
  );
}

function friendly(kind: FetchErrorKind, status: number): string {
  switch (kind) {
    case 'timeout': return 'The server took too long to respond. Please try again.';
    case 'network': return "Can't reach the server. Check your connection and try again.";
    case 'aborted': return 'Request cancelled.';
    case 'parse': return 'The server sent an unexpected response.';
    default:
      if (status === 429) return 'Too many requests — please wait a moment and try again.';
      if (status >= 500) return 'The server had a problem. Please try again.';
      return 'Request failed (' + status + ').';
  }
}

/**
 * fetch + JSON with a per-attempt timeout (AbortController), bounded retries with backoff, and typed errors.
 * Credentials are sent only to the same origin — never cross-origin, whatever `credentials` says.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 15000, retries = 0, backoffMs = 600, body, signal, responseType = 'json', headers, credentials, onResponse, ...rest } = options;
  const maxRetries = Math.max(0, Math.min(2, Math.floor(retries)));

  let sameOrigin = true;
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    sameOrigin = new URL(url, base).origin === new URL(base).origin;
  } catch {
    sameOrigin = false;
  }
  const finalCredentials: RequestCredentials = sameOrigin ? (credentials ?? 'same-origin') : 'omit';

  const h = new Headers(headers);
  let finalBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (isRawBody(body)) finalBody = body;
    else {
      finalBody = JSON.stringify(body);
      if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    }
  }
  if (!h.has('Accept')) h.set('Accept', responseType === 'json' ? 'application/json' : 'text/plain, */*');

  let lastError: FetchError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new FetchError('aborted', friendly('aborted', 0), { url, attempts: attempt });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const init: RequestInit = { ...rest, headers: h, credentials: finalCredentials, signal: ctrl.signal };
      if (finalBody !== undefined) init.body = finalBody;
      const res = await fetch(url, init);
      try {
        onResponse?.(res);
      } catch {
        /* a hook must never break the request */
      }
      const text = await res.text();
      let parsed: unknown = text;
      if (responseType === 'json' && text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          if (res.ok) throw new FetchError('parse', friendly('parse', res.status), { status: res.status, url, attempts: attempt + 1 });
        }
      } else if (responseType === 'json') parsed = null;
      if (!res.ok) {
        const serverMsg = parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : '';
        throw new FetchError('http', serverMsg || friendly('http', res.status), { status: res.status, url, body: parsed, attempts: attempt + 1 });
      }
      return parsed as T;
    } catch (e) {
      if (e instanceof FetchError) lastError = e;
      else if (signal?.aborted) throw new FetchError('aborted', friendly('aborted', 0), { url, attempts: attempt + 1 });
      else if (timedOut) lastError = new FetchError('timeout', friendly('timeout', 0), { url, attempts: attempt + 1 });
      else lastError = new FetchError('network', friendly('network', 0), { url, attempts: attempt + 1 });
      if (!lastError.retryable || attempt === maxRetries) throw lastError;
      const wait = backoffMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await sleep(wait, signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new FetchError('network', friendly('network', 0), { url, attempts: maxRetries + 1 });
}
