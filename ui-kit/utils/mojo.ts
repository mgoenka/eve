/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Mojo (₥): the play currency of every game (Mohit, 2026-11-28). Winnings, purses, stakes and prize ladders are
 * Mojo. It is play money only: it can't be bought, sold, exchanged or turned into Sparks (the real AI credits), and
 * the rules say so. Real-world prices (Showcase's products) stay in their real currency.
 *
 * Always format through these helpers so the symbol, grouping and wording stay the same in every game.
 */

export const MOJO_NAME = 'Mojo';
export const MOJO_SYMBOL = '₥';

/**
 * Fonts that have ₥ (U+20A5). Georgia, the title font, does not, so an amount next to a serif title would fall back to
 * a random font; wrap amounts in this stack (the Mojo component does).
 */
export const MOJO_FONT_STACK = "'Segoe UI Symbol', 'Arial Unicode MS', Arial, 'Helvetica Neue', 'Noto Sans', 'DejaVu Sans', sans-serif";

export interface MojoFormatOptions {
  /** '+₥50' for gains (and '−₥50' for losses, always). Default false. */
  signed?: boolean;
  /** Compact for tight spots: ₥1.2K, ₥3.4M. Default false. */
  compact?: boolean;
  /** Locale for digit grouping. Default: the browser's. */
  locale?: string;
}

const MINUS = '−';

/** ₥1,200 · −₥50 · +₥50 (signed) · ₥1.2K (compact). Non-finite values read as ₥0. */
export function formatMojo(amount: number, opts: MojoFormatOptions = {}): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  const abs = Math.abs(n);
  let digits: string;
  if (opts.compact && abs >= 1000) {
    const [v, s] = abs >= 1e9 ? [abs / 1e9, 'B'] : abs >= 1e6 ? [abs / 1e6, 'M'] : [abs / 1e3, 'K'];
    digits = `${(Math.floor(v * 10) / 10).toLocaleString(opts.locale, { maximumFractionDigits: 1 })}${s}`;
  } else {
    digits = abs.toLocaleString(opts.locale);
  }
  const sign = n < 0 ? MINUS : opts.signed && n > 0 ? '+' : '';
  return `${sign}${MOJO_SYMBOL}${digits}`;
}

/** "1 mojo" / "240 mojo" (Mojo doesn't take a plural s), for sentences and screen readers. */
export function mojoWords(amount: number, locale?: string): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${n < 0 ? 'minus ' : ''}${Math.abs(n).toLocaleString(locale)} mojo`;
}

/** The line every game with Mojo shows in its rules (and store listings repeat). */
export const MOJO_RULE_LINE = 'Mojo (₥) is play money for the game: it has no cash value and can’t be bought, sold or exchanged, or turned into Sparks.';

/** A rules-overlay section for games that use Mojo. */
export function mojoRuleSection(): { title: string; icon: string; rules: string[] } {
  return { title: 'Mojo (₥)', icon: '🪙', rules: [MOJO_RULE_LINE] };
}
