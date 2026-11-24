/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { copyToClipboard } from '../utils/share';
import { CopyIcon, QrCodeIcon } from './icons';
import { LazyQRCode } from './LazyQRCode';
import { Modal } from './Modal';

export type ChipTone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<ChipTone, string> = {
  neutral: 'border-mg-border bg-mg-surface text-mg-text-2',
  gold: 'border-mg-gold/35 bg-mg-gold/10 text-mg-gold',
  success: 'border-mg-success/35 bg-mg-success/10 text-emerald-300',
  warning: 'border-mg-warning/40 bg-mg-warning/10 text-amber-200',
  danger: 'border-mg-danger/40 bg-mg-danger/10 text-rose-300',
  info: 'border-mg-info/40 bg-mg-info/10 text-sky-300',
};

export interface StatusChipProps {
  /** Short label, e.g. "Round" or "Players". Wraps between words if needed; never cut mid-word. */
  label?: ReactNode;
  /** The value, e.g. "3 / 10". */
  value?: ReactNode;
  icon?: ReactNode;
  tone?: ChipTone;
  /** Makes it a button (44px tall target). */
  onClick?: () => void;
  /** Accessible name when it is a button and the text alone isn't clear. */
  'aria-label'?: string;
  title?: string;
  className?: string;
}

/** Pill for game state (round, timer, players…): 44px tall, wraps between words, tabular numbers. */
export function StatusChip({ label, value, icon, tone = 'neutral', onClick, title, className, ...aria }: StatusChipProps) {
  const body = (
    <>
      {icon ? <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span> : null}
      {label != null ? <span className="min-w-0 break-normal">{label}</span> : null}
      {value != null ? <span className="font-semibold tabular-nums">{value}</span> : null}
    </>
  );
  const cls = cx('inline-flex min-h-11 max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border px-3.5 py-1 text-sm leading-tight', tones[tone], className);
  return onClick ? (
    <button type="button" onClick={onClick} title={title} aria-label={aria['aria-label']} className={cx(cls, 'transition-colors hover:brightness-110')}>
      {body}
    </button>
  ) : (
    <span className={cls} title={title} aria-label={aria['aria-label']}>
      {body}
    </span>
  );
}

export interface RoomChipProps {
  /** Room / join code, shown in full (never shortened). */
  code: string;
  /** Default "Room". */
  label?: string;
  /** Join link: enables the QR button (opens a large QR code) and copying the link instead of the code. */
  joinUrl?: string;
  /** Your own QR handler instead of the built-in sheet. */
  onQr?: () => void;
  /** Copy button (default true). */
  copy?: boolean;
  className?: string;
}

/** "Room ABCD" chip with 44px copy and QR buttons; the built-in QR sheet shows the join link large for a TV or phone. */
export function RoomChip({ code, label = 'Room', joinUrl, onQr, copy = true, className }: RoomChipProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const showQr = !!onQr || !!joinUrl;
  return (
    <span className={cx('inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-mg-gold/35 bg-mg-gold/10 pl-3.5 pr-1 text-sm text-mg-gold', className)}>
      <span className="whitespace-nowrap text-mg-muted">{label}</span>
      <span className="whitespace-nowrap font-mono text-base font-bold tracking-[0.15em]">{code}</span>
      {copy ? (
        <button
          type="button"
          aria-label={joinUrl ? 'Copy join link' : 'Copy room code'}
          onClick={() => void copyToClipboard(joinUrl ?? code, joinUrl ? 'Join link copied' : 'Room code copied')}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-mg-gold/15"
        >
          <CopyIcon size={18} />
        </button>
      ) : null}
      {showQr ? (
        <button
          type="button"
          aria-label="Show QR code to join"
          onClick={() => (onQr ? onQr() : setQrOpen(true))}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-mg-gold/15"
        >
          <QrCodeIcon size={18} />
        </button>
      ) : null}
      {joinUrl && !onQr ? (
        <Modal open={qrOpen} onClose={() => setQrOpen(false)} title={`Join ${label.toLowerCase()} ${code}`} size="sm">
          <div className="flex flex-col items-center gap-3">
            <LazyQRCode value={joinUrl} size={240} label={`QR code to join ${code}`} />
            <p className="break-all text-center text-sm text-mg-muted">{joinUrl}</p>
          </div>
        </Modal>
      ) : null}
    </span>
  );
}
