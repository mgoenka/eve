/* generated from app-platform/ui-kit — edit there and re-sync. */
import { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import type { QRCodeProps } from './QRCode';
import { Skeleton } from './Skeleton';

const QRCodeImpl = lazyWithRetry(() => import('./QRCode'));

/** QRCode with its encoder split into a separate chunk; shows a skeleton of the same size meanwhile. */
export function LazyQRCode(props: QRCodeProps) {
  const size = props.size ?? 200;
  return (
    <Suspense fallback={<Skeleton width={size} height={size} rounded="md" />}>
      <QRCodeImpl {...props} />
    </Suspense>
  );
}
