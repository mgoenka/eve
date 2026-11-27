/* generated from app-platform/ui-kit — edit there and re-sync. */
import { MOJO_FONT_STACK, formatMojo, mojoWords, type MojoFormatOptions } from '../utils/mojo';
import { cx } from '../utils/cx';

export interface MojoProps extends MojoFormatOptions {
  amount: number;
  className?: string;
}

/**
 * An amount of Mojo, e.g. ₥1,200. The ₥ sign is drawn in a font that has it (Georgia doesn't), so it looks the same
 * next to any heading; screen readers hear "1,200 mojo". Inherits size and colour from its parent.
 */
export function Mojo({ amount, className, ...opts }: MojoProps) {
  const text = formatMojo(amount, opts);
  const at = text.indexOf('₥');
  return (
    <span className={cx('tabular-nums whitespace-nowrap', className)} aria-label={mojoWords(amount, opts.locale)}>
      <span aria-hidden="true">
        {text.slice(0, at)}
        <span style={{ fontFamily: MOJO_FONT_STACK }}>₥</span>
        {text.slice(at + 1)}
      </span>
    </span>
  );
}

export default Mojo;
