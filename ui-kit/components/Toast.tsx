/* generated from app-platform/ui-kit — edit there and re-sync. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/cx';
import { bindToastHandlers, dismissToast, showToast } from '../utils/toastBus';
import type { ToastItem, ToastOptions, ToastTone } from '../utils/toastBus';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './icons';

export type { ToastOptions, ToastTone };

export interface ToastApi {
  /** Show a toast; returns its id. */
  toast: (opts: ToastOptions | string) => string;
  success: (message: ReactNode, opts?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  error: (message: ReactNode, opts?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  info: (message: ReactNode, opts?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  warning: (message: ReactNode, opts?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  dismiss: (id: string) => void;
}

const api: ToastApi = {
  toast: showToast,
  success: (message, o) => showToast({ ...o, message, tone: 'success' }),
  error: (message, o) => showToast({ ...o, message, tone: 'error' }),
  info: (message, o) => showToast({ ...o, message, tone: 'info' }),
  warning: (message, o) => showToast({ ...o, message, tone: 'warning' }),
  dismiss: dismissToast,
};

const ToastContext = createContext<ToastApi>(api);

/** `const { success, error } = useToast();` Works anywhere under <ToastProvider>. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const toneStyles: Record<ToastTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-mg-gold/40', icon: <InfoIcon size={18} className="text-mg-gold" /> },
  success: { box: 'border-mg-success/40', icon: <CheckIcon size={18} className="text-mg-success" /> },
  warning: { box: 'border-mg-warning/40', icon: <AlertIcon size={18} className="text-mg-warning" /> },
  error: { box: 'border-mg-danger/50', icon: <AlertIcon size={18} className="text-mg-danger" /> },
};

export interface ToastProviderProps {
  children: ReactNode;
  /** Default 'bottom'. */
  position?: 'bottom' | 'top';
  /** Max toasts visible at once. Default 3. */
  max?: number;
}

/** Mount once near the root. Also receives toasts sent with showToast() from non-React code (SW updates, shareOrCopy). */
export function ToastProvider({ children, position = 'bottom', max = 3 }: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (item: ToastItem) => {
      setItems((list) => {
        const without = list.filter((x) => x.id !== item.id);
        return [...without, item].slice(-max);
      });
      const prev = timers.current.get(item.id);
      if (prev) clearTimeout(prev);
      if (item.duration > 0) timers.current.set(item.id, setTimeout(() => dismiss(item.id), item.duration));
    },
    [dismiss, max],
  );

  useEffect(() => bindToastHandlers(show, dismiss), [show, dismiss]);
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo<ToastApi>(() => ({ ...api, dismiss }), [dismiss]);

  const region =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            aria-live="polite"
            aria-relevant="additions"
            className={cx(
              'pointer-events-none fixed inset-x-0 z-[400] flex flex-col items-center gap-2 px-3',
              position === 'bottom' ? 'bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]' : 'top-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]',
            )}
          >
            {items.map((t) => (
              <div
                key={t.id}
                role={t.tone === 'error' ? 'alert' : 'status'}
                className={cx(
                  'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-mg border bg-mg-elevated/95 px-4 py-3 text-sm text-mg-text shadow-mg-card backdrop-blur-md animate-mg-pop',
                  toneStyles[t.tone].box,
                )}
              >
                <span className="mt-0.5 shrink-0">{toneStyles[t.tone].icon}</span>
                <div className="min-w-0 flex-1 leading-snug">
                  {t.title ? <p className="font-semibold text-mg-text">{t.title}</p> : null}
                  <div className={t.title ? 'text-mg-text-2' : ''}>{t.message}</div>
                </div>
                {t.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="-my-1 min-h-9 shrink-0 rounded-mg-sm bg-mg-gold px-3 text-sm font-semibold text-mg-on-gold hover:bg-mg-gold-hover"
                  >
                    {t.action.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="relative -my-1 -mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-mg-sm text-mg-muted hover:bg-white/5 hover:text-mg-text before:absolute before:-inset-1 before:content-['']"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {region}
    </ToastContext.Provider>
  );
}
