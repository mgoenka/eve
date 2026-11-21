/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  /** Main text. */
  message: ReactNode;
  /** Optional bold first line. */
  title?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 3500 (6000 with an action). */
  duration?: number;
  /** Optional button, e.g. { label: 'Reload', onClick }. */
  action?: { label: string; onClick: () => void };
  /** Reusing an id replaces that toast instead of stacking a new one. */
  id?: string;
}

export interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
}

type Handler = (t: ToastItem) => void;
let handler: Handler | null = null;
let dismissHandler: ((id: string) => void) | null = null;
const queue: ToastItem[] = [];
let seq = 0;

/** Used by ToastProvider. */
export function bindToastHandlers(show: Handler, dismiss: (id: string) => void): () => void {
  handler = show;
  dismissHandler = dismiss;
  while (queue.length) {
    const t = queue.shift();
    if (t) show(t);
  }
  return () => {
    if (handler === show) {
      handler = null;
      dismissHandler = null;
    }
  };
}

/** Show a toast from anywhere (works outside React; queued until a ToastProvider mounts). */
export function showToast(opts: ToastOptions | string): string {
  const o: ToastOptions = typeof opts === 'string' ? { message: opts } : opts;
  const id = o.id ?? 'mg-toast-' + ++seq;
  const item: ToastItem = {
    ...o,
    id,
    tone: o.tone ?? 'info',
    duration: o.duration ?? (o.action ? 6000 : 3500),
  };
  if (handler) handler(item);
  else queue.push(item);
  return id;
}

export function dismissToast(id: string): void {
  dismissHandler?.(id);
}
