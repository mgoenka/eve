/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Body text. */
  message?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = rose confirm button (deleting, leaving a game). */
  tone?: 'default' | 'danger';
  /** May return a promise: the button shows a spinner until it settles. */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

/** Yes/No dialog. Esc/backdrop = cancel. Focus starts on Cancel for danger, on Confirm otherwise. */
export function ConfirmDialog({ open, title, message, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onCancel(); }}
      title={title}
      size="sm"
      mobile="center"
      role="alertdialog"
      showClose={false}
      initialFocusRef={tone === 'danger' ? cancelRef : confirmRef}
      titleClassName={tone === 'danger' ? 'text-mg-text' : 'text-mg-gold'}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => { void handleConfirm(); }} loading={busy}>{confirmLabel}</Button>
        </div>
      }
    >
      {message ? <p className="text-sm leading-relaxed text-mg-text-2">{message}</p> : null}
      {children}
    </Modal>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

/**
 * Promise-based confirm: `const { confirm, dialog } = useConfirm();` render {dialog} once, then
 * `if (await confirm({ title: 'Leave game?', tone: 'danger' })) leave();`
 */
export function useConfirm(): { confirm: (o: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  const dialog = opts ? (
    <ConfirmDialog
      open
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel ?? 'Confirm'}
      cancelLabel={opts.cancelLabel ?? 'Cancel'}
      tone={opts.tone ?? 'default'}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;
  return { confirm, dialog };
}
