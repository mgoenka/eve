/* generated from app-platform/ui-kit — edit there and re-sync. */
// @ts-check
/**
 * Vite plugin for the kit (plain JS so app tsconfigs don't need @types/node):
 *   - preloads the kit's two main woff2 fonts in the built index.html (hashed URLs)
 *   - writes dist/sw.js from ui-kit/sw-template.js (or your own swSrc) with the precache list + version injected
 *   - adds ui-kit/pulse.js as /mg-pulse.js (anonymous usage counts, see server-kit/pulse); pulse: false turns it off,
 *     pulse: { endpoint } sends beacons elsewhere (apps without a /api/pulse route of their own)
 *
 *   // vite.config.ts
 *   import { mgKit } from './ui-kit/vite-plugin-mg.mjs';    // or './src/ui-kit/…', './client/src/ui-kit/…'
 *   plugins: [react(), tailwindcss(), mgKit()]
 *
 * Without Vite: `node ui-kit/vite-plugin-mg.mjs dist [swSrc]` injects the precache list after any build.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SW = join(HERE, 'sw-template.js');
const DEFAULT_INCLUDE = /\.(html|js|mjs|css|woff2|svg|png|webp|avif|jpg|jpeg|ico|json|webmanifest|txt)$/i;
const DEFAULT_EXCLUDE = [/\.map$/i, /(^|\/)sw\.js$/i, /(^|\/)og\.(png|jpg)$/i, /(^|\/)screenshots?\//i, /(^|\/)\.well-known\//i, /(^|\/)robots\.txt$/i, /(^|\/)sitemap/i];
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
// Lazy JS chunks (not referenced by index.html) bigger than this are left out of the precache: most visits never
// load them (PDF export, share video, QR scanner…), and the service worker caches them on first use anyway.
const LAZY_MAX_BYTES = 100 * 1024;

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Inject the precache list + a content-hash version into the service worker and write it to outDir.
 * @param {string} outDir
 * @param {{ swSrc?: string, swDest?: string, include?: RegExp, exclude?: RegExp[], extra?: string[], base?: string, lazyMaxBytes?: number }} [opts]
 */
export function injectPrecache(outDir, opts = {}) {
  const swSrc = opts.swSrc ? resolve(opts.swSrc) : DEFAULT_SW;
  const swDest = opts.swDest ?? 'sw.js';
  const include = opts.include ?? DEFAULT_INCLUDE;
  const exclude = [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])];
  const base = (opts.base ?? '/').replace(/\/?$/, '/');
  const lazyMax = opts.lazyMaxBytes ?? LAZY_MAX_BYTES;
  // What the first paint needs (entry script, modulepreloads, CSS): always precached, whatever its size.
  const indexPath = join(outDir, 'index.html');
  const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  /** @type {Set<string>} */
  const entry = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const href = (m[1] ?? '').split(/[?#]/)[0] ?? '';
    const u = href.startsWith(base) ? href.slice(base.length) : href.replace(/^\.?\//, '');
    if (u) entry.add(u);
  }
  const hash = createHash('sha256');
  /** @type {string[]} */
  const urls = [];
  for (const file of walk(outDir).sort()) {
    const rel = relative(outDir, file).split(sep).join('/');
    if (!include.test(rel) || exclude.some((re) => re.test(rel))) continue;
    const size = statSync(file).size;
    if (size > MAX_FILE_BYTES) continue;
    if (/\.m?js$/i.test(rel) && size > lazyMax && !entry.has(rel)) continue;
    urls.push(base + rel);
    hash.update(rel + ':' + size + ';');
    if (!rel.startsWith('assets/')) hash.update(readFileSync(file)); // un-hashed files: hash content
  }
  if (!urls.includes(base)) urls.unshift(base);
  for (const e of opts.extra ?? []) if (!urls.includes(e)) urls.push(e);
  const version = hash.digest('hex').slice(0, 12);
  let sw = readFileSync(swSrc, 'utf8');
  sw = sw.replace(/\[\/\* __MG_PRECACHE__ \*\/[^\]]*\]/, JSON.stringify(urls));
  sw = sw.replace(/__MG_VERSION__/g, version);
  writeFileSync(join(outDir, swDest), sw);
  return { version, count: urls.length };
}

/** @param {string} html @param {string} re */
function metaContent(html, re) {
  const m = html.match(new RegExp(`<meta\\b[^>]*\\b(?:name|property)=["']${re}["'][^>]*>`, 'i'));
  const c = m && m[0].match(/content=(?:"([^"]*)"|'([^']*)')/i);
  return c ? decodeEntities(c[1] ?? c[2] ?? '') : '';
}
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
/** @param {string} html */
function canonicalOrigin(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  const h = m && m[0].match(/href=(?:"([^"]+)"|'([^']+)')/i);
  const href = (h && (h[1] || h[2])) || metaContent(html, 'og:url');
  try {
    return href ? new URL(href).origin : '';
  } catch {
    return '';
  }
}
/** @param {string} html @param {{ type?: string, category?: string, play?: string, genre?: string }} o */
function seoJsonLd(html, o) {
  const origin = canonicalOrigin(html);
  if (!origin) return null;
  const title = metaContent(html, 'og:title') || decodeEntities((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '');
  const description = metaContent(html, 'description') || metaContent(html, 'og:description');
  const image = metaContent(html, 'og:image');
  const type = o.type || 'WebApplication';
  /** @type {Record<string, unknown>} */
  const ld = {
    '@context': 'https://schema.org',
    '@type': type,
    name: title.split(/\s[—–|-]\s/)[0].trim() || title,
    url: origin + '/',
    description,
    ...(image ? { image } : {}),
    applicationCategory: o.category || (type === 'VideoGame' ? 'GameApplication' : 'UtilitiesApplication'),
    operatingSystem: o.play ? 'Web, Android' : 'Web',
    ...(o.genre ? { genre: o.genre } : {}),
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'Mohit Goenka', url: 'https://mohitgoenka.com/' },
    publisher: { '@type': 'Organization', name: "Mohit's Creations", url: 'https://mohitgoenka.com/apps/' },
    ...(o.play ? { sameAs: [`https://play.google.com/store/apps/details?id=${o.play}`] } : {}),
  };
  if (type === 'VideoGame') ld.gamePlatform = o.play ? ['Web browser', 'Android'] : ['Web browser'];
  return ld;
}

/**
 * @param {{ sw?: boolean | { swSrc?: string, swDest?: string, include?: RegExp, exclude?: RegExp[], extra?: string[], lazyMaxBytes?: number }, preloadFonts?: boolean, pulse?: boolean | { endpoint?: string }, seo?: false | { type?: 'VideoGame' | 'WebApplication', category?: string, play?: string, genre?: string } }} [options]
 * @returns {any[]}
 */
export function mgKit(options = {}) {
  const swOpts = options.sw === false ? null : typeof options.sw === 'object' ? options.sw : {};
  /** @type {string} */
  let outDir = 'dist';
  /** @type {string} */
  let base = '/';
  return [
    {
      name: 'mg-kit:font-preload',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        /** @param {string} _html @param {any} ctx */
        handler(_html, ctx) {
          if (options.preloadFonts === false || !ctx.bundle) return;
          const tags = [];
          for (const fileName of Object.keys(ctx.bundle)) {
            if (/(^|\/)(syne-latin-wght|dm-sans-latin-wght)-[\w-]+\.woff2$/.test(fileName) && !fileName.includes('italic')) {
              tags.push({ tag: 'link', attrs: { rel: 'preload', href: base + fileName, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head-prepend' });
            }
          }
          return tags;
        },
      },
    },
    {
      name: 'mg-kit:pulse',
      apply: 'build',
      generateBundle() {
        if (options.pulse === false) return;
        // @ts-ignore Rollup plugin context
        this.emitFile({ type: 'asset', fileName: 'mg-pulse.js', source: readFileSync(join(HERE, 'pulse.js'), 'utf8') });
      },
      transformIndexHtml: {
        order: 'post',
        /** @param {string} _html @param {any} ctx */
        handler(_html, ctx) {
          if (options.pulse === false || !ctx.bundle) return;
          const endpoint = typeof options.pulse === 'object' && options.pulse.endpoint;
          /** @type {Record<string, string | boolean>} */
          const attrs = { src: base + 'mg-pulse.js', defer: true };
          if (endpoint) attrs['data-endpoint'] = endpoint;
          return [{ tag: 'script', attrs, injectTo: 'head' }];
        },
      },
    },
    {
      // Search basics from index.html's own tags: JSON-LD (schema.org VideoGame / WebApplication) and, when the
      // app doesn't ship its own, robots.txt + a one-URL sitemap.xml for its canonical origin.
      name: 'mg-kit:seo',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        /** @param {string} html @param {any} ctx */
        handler(html, ctx) {
          if (options.seo === false || !ctx.bundle || /application\/ld\+json/.test(html)) return;
          const ld = seoJsonLd(html, options.seo || {});
          if (!ld) return;
          return [{ tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(ld).replace(/</g, '\\u003c'), injectTo: 'head' }];
        },
      },
      closeBundle() {
        if (options.seo === false) return;
        const index = join(outDir, 'index.html');
        if (!existsSync(index)) return;
        const origin = canonicalOrigin(readFileSync(index, 'utf8'));
        if (!origin) return;
        if (!existsSync(join(outDir, 'robots.txt'))) writeFileSync(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
        if (!existsSync(join(outDir, 'sitemap.xml')))
          writeFileSync(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`);
      },
    },
    {
      name: 'mg-kit:service-worker',
      apply: 'build',
      /** @param {any} config */
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
        base = config.base || '/';
      },
      closeBundle() {
        if (!swOpts) return;
        if (!existsSync(join(outDir, 'index.html'))) return; // e.g. SSR/server build
        const r = injectPrecache(outDir, { ...swOpts, base });
        console.log(`[mg-kit] sw.js written: ${r.count} precached files, version ${r.version}`);
      },
    },
  ];
}

export default mgKit;

// CLI: node vite-plugin-mg.mjs <outDir> [swSrc]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'dist';
  const r = injectPrecache(resolve(dir), process.argv[3] ? { swSrc: process.argv[3] } : {});
  console.log(`[mg-kit] ${join(dir, 'sw.js')}: ${r.count} precached files, version ${r.version}`);
}
