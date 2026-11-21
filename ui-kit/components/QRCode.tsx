/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useMemo } from 'react';
import { encode } from '../vendor/uqr.js';

export interface QRCodeProps {
  /** The text/URL to encode. Encoded locally — nothing is sent anywhere. */
  value: string;
  /** Rendered size in px (the SVG scales crisply). Default 200. */
  size?: number;
  /** Error correction. Default 'M'. */
  ecc?: 'L' | 'M' | 'Q' | 'H';
  /** Quiet zone in modules. Default 2. */
  margin?: number;
  /** Dark modules. Default #0a0a0b. */
  color?: string;
  /** Light modules. Default #ffffff (keep it light — scanners need contrast). */
  background?: string;
  /** Accessible label. Default "QR code". */
  label?: string;
  className?: string;
}

/**
 * Pure-SVG QR code (vendored MIT encoder, no network). Load it lazily where possible:
 * `const QRCode = lazyWithRetry(() => import('./ui-kit/components/QRCode'))` or use LazyQRCode from the barrel.
 */
export function QRCode({ value, size = 200, ecc = 'M', margin = 2, color = '#0a0a0b', background = '#ffffff', label = 'QR code', className }: QRCodeProps) {
  const { path, n } = useMemo(() => {
    const qr = encode(value, { ecc, border: margin });
    let d = '';
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (row[x]) {
          const start = x;
          while (x < row.length && row[x]) x++;
          d += 'M' + start + ' ' + y + 'h' + (x - start) + 'v1h-' + (x - start) + 'z';
        } else x++;
      }
    });
    return { path: d, n: qr.size };
  }, [value, ecc, margin]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={'0 0 ' + n + ' ' + n} shapeRendering="crispEdges" className={className} style={{ borderRadius: 8 }}>
      <rect width={n} height={n} fill={background} />
      <path d={path} fill={color} />
    </svg>
  );
}

export default QRCode;
