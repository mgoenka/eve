// Synced from app-platform/server-kit/seo/index.ts. Do not edit here. VERSION 9935b39 2026-11-27T19:06:06Z
// Link previews and crawl hygiene for the apps' Express servers (no dependencies).
//   import { withPreview, isAssetMiss, safeRoomMap } from "./server/seo/index.ts";
// - withPreview(html, { title, description, image, url }): the app's index.html with its <title>, meta
//   description and Open Graph / Twitter tags replaced, so a shared link (?t=..., ?b=..., /room codes) shows
//   its own preview in chats. Values are escaped; nothing else in the page changes.
// - isAssetMiss(path): true for paths that should 404 instead of getting the SPA's index.html (files with
//   an extension, /.well-known/*), so crawlers and the Play App Links check don't see "soft 404s".
// - safeRoomMap(): an object with no prototype, safe to index with any user-typed room code.

export interface Preview {
  title?: string;
  description?: string;
  /** Absolute https URL of a 1200x630 image. */
  image?: string;
  /** Absolute canonical URL for og:url (the page itself keeps its canonical link). */
  url?: string;
}

const MAX_TITLE = 90;
const MAX_DESC = 200;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Trim, collapse whitespace, drop control characters, cap the length (with an ellipsis). */
export function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function setMeta(html: string, key: string, value: string): string {
  const v = escapeHtml(value);
  const k = key.replace(/[:.]/g, "\\$&");
  const tag = new RegExp(`<meta\\b[^>]*\\b(?:name|property)=(["'])${k}\\1[^>]*>`, "i");
  const m = html.match(tag);
  if (m) {
    const replaced = m[0].replace(/\bcontent=("[^"]*"|'[^']*')/i, `content="${v}"`);
    return html.replace(m[0], () => (replaced === m[0] && !/\bcontent=/i.test(m[0]) ? m[0].replace(/\s*\/?>$/, ` content="${v}" />`) : replaced));
  }
  const attr = key.startsWith("og:") ? "property" : "name";
  return html.replace(/<\/head>/i, () => `<meta ${attr}="${key}" content="${v}" />\n</head>`);
}

export function withPreview(html: string, p: Preview): string {
  let out = html;
  const title = clean(p.title, MAX_TITLE);
  const desc = clean(p.description, MAX_DESC);
  if (title) {
    out = out.replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
    out = setMeta(out, "og:title", title);
    out = setMeta(out, "twitter:title", title);
  }
  if (desc) {
    out = setMeta(out, "description", desc);
    out = setMeta(out, "og:description", desc);
    out = setMeta(out, "twitter:description", desc);
  }
  if (p.image && /^https:\/\//.test(p.image)) {
    out = setMeta(out, "og:image", p.image);
    out = setMeta(out, "twitter:image", p.image);
  }
  if (p.url && /^https:\/\//.test(p.url)) out = setMeta(out, "og:url", p.url);
  return out;
}

/** Paths that must not fall through to index.html: anything with a file extension, and /.well-known/. */
export function isAssetMiss(path: string): boolean {
  if (path.startsWith("/.well-known/")) return true;
  const last = path.split("/").pop() ?? "";
  return /\.[a-z0-9]{1,8}$/i.test(last);
}

/** A room table safe to index with any string (no "constructor" / "__proto__" surprises). */
export function safeRoomMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** First value of a query parameter as a string ("" when missing or not a string). */
export function queryString(q: unknown): string {
  if (typeof q === "string") return q;
  if (Array.isArray(q) && typeof q[0] === "string") return q[0];
  return "";
}

/**
 * Express handler for /.well-known/assetlinks.json (Android App Links): lets the Play app (signed with these
 * certificate SHA-256 fingerprints, from Play's app-signing key) open https links to this site.
 *   app.get("/.well-known/assetlinks.json", assetLinks("com.mohitgoenka.covert", ["AB:CD:…"]));
 */
export function assetLinks(packageName: string, sha256: string[]) {
  const body = JSON.stringify([
    { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: sha256 } },
  ]);
  return (_req: unknown, res: { setHeader(k: string, v: string): unknown; end(b: string): unknown }) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(body);
  };
}
