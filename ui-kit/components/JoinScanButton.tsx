/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useCallback, useRef, useState } from 'react';
import { Button } from './Button';
import type { ButtonProps } from './Button';
import { QrCodeIcon } from './icons';
import { hasNativeScanner, nativeScanQrResult } from '../utils/nativeShell';
import { parseJoinCode } from '../utils/joinCode';
import type { ParseJoinCodeOptions } from '../utils/joinCode';
import { showToast } from '../utils/toastBus';

export interface UseNativeJoinScanOptions extends ParseJoinCodeOptions {
  /** Your own scanner (the app's ScanQrModal): used on the website, in old builds and when the native one can't run. */
  onFallback?: () => void;
  /** A QR that isn't a room link. Default: a "That QR code isn't a room link." toast. */
  onUnknownQr?: (text: string) => void;
}

export interface NativeJoinScan {
  /** Native scanner first; the fallback when there is none or it is unavailable. A cancel does nothing. */
  scan: () => Promise<void>;
  scanning: boolean;
  /** True when the native scanner will be used. */
  native: boolean;
}

/**
 * Join-by-QR with the Android app's native scanner, falling back to the app's own modal:
 *   const { scan } = useNativeJoinScan(joinRoom, { onFallback: () => setShowScan(true) });
 *   onAppShortcut((id) => { if (id === 'join') void scan(); });
 */
export function useNativeJoinScan(onCode: (code: string) => void, options: UseNativeJoinScanOptions = {}): NativeJoinScan {
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);
  const latest = useRef({ onCode, options });
  latest.current = { onCode, options };

  const scan = useCallback(async () => {
    if (busy.current) return;
    const { onCode: cb, options: o } = latest.current;
    if (!hasNativeScanner()) {
      o.onFallback?.();
      return;
    }
    busy.current = true;
    setScanning(true);
    try {
      const r = await nativeScanQrResult();
      const { onCode: cbNow, options: oNow } = latest.current;
      if (!r || (!r.ok && r.error !== 'cancelled')) {
        (oNow.onFallback ?? o.onFallback)?.();
        return;
      }
      if (!r.ok) return; // cancelled
      const parseOpts: ParseJoinCodeOptions = {};
      if (oNow.maxLength !== undefined) parseOpts.maxLength = oNow.maxLength;
      if (oNow.hosts !== undefined) parseOpts.hosts = oNow.hosts;
      const code = parseJoinCode(r.text, parseOpts);
      if (code) (cbNow ?? cb)(code);
      else if (oNow.onUnknownQr) oNow.onUnknownQr(r.text);
      else showToast({ tone: 'warning', message: "That QR code isn't a room link." });
    } finally {
      busy.current = false;
      setScanning(false);
    }
  }, []);

  return { scan, scanning, native: hasNativeScanner() };
}

export interface JoinScanButtonProps extends Omit<ButtonProps, 'onClick'>, UseNativeJoinScanOptions {
  onCode: (code: string) => void;
}

/** "Scan to join" kit Button: native scanner in the Android app, `onFallback` (your ScanQrModal) elsewhere. */
export function JoinScanButton({ onCode, onFallback, onUnknownQr, maxLength, hosts, children = 'Scan to join', leftIcon, variant = 'outline', ...rest }: JoinScanButtonProps) {
  const opts: UseNativeJoinScanOptions = {};
  if (onFallback) opts.onFallback = onFallback;
  if (onUnknownQr) opts.onUnknownQr = onUnknownQr;
  if (maxLength !== undefined) opts.maxLength = maxLength;
  if (hosts !== undefined) opts.hosts = hosts;
  const { scan, scanning } = useNativeJoinScan(onCode, opts);
  return (
    <Button variant={variant} leftIcon={leftIcon ?? <QrCodeIcon size={18} />} loading={scanning} onClick={() => void scan()} {...rest}>
      {children}
    </Button>
  );
}
