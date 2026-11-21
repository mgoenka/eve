/* generated from app-platform/ui-kit — edit there and re-sync. */
export interface MgSwOptions {
  /** Service worker source. Default: ui-kit/sw-template.js. Use 'public/sw.js' to keep a custom worker (placeholders optional). */
  swSrc?: string;
  /** Output file name inside outDir. Default 'sw.js'. */
  swDest?: string;
  include?: RegExp;
  exclude?: RegExp[];
  /** Extra URLs to precache. */
  extra?: string[];
}
export interface MgKitOptions {
  /** false disables sw.js generation. */
  sw?: boolean | MgSwOptions;
  /** Inject <link rel="preload"> for Syne + DM Sans. Default true. */
  preloadFonts?: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function mgKit(options?: MgKitOptions): any[];
export declare function injectPrecache(outDir: string, opts?: MgSwOptions & { base?: string }): { version: string; count: number };
export default mgKit;
