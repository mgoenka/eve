/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils/cx';
import { CloseIcon } from './icons';
import { IconButton } from './IconButton';

export interface ModalProps {
  open: boolean;
  /** Called on Esc, backdrop click (if enabled) and the close button. */
  onClose: () => void;
  /** Heading shown in the modal header; also the accessible name. */
  title?: ReactNode;
  /** Small text under the title. */
  description?: ReactNode;
  /** Accessible name when there is no visible title. */
  ariaLabel?: string;
  children?: ReactNode;
  /** Sticky footer (buttons). */
  footer?: ReactNode;
  /** Extra buttons in the header, left of the close button. */
  headerActions?: ReactNode;
  /** Max width on tablet/desktop. Default 'md' (28rem). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Phones (<640px): 'auto' shows a bottom sheet, 'center' keeps a centred dialog. Default 'auto'. */
  mobile?: 'auto' | 'center';
  /** Default true. */
  closeOnBackdrop?: boolean;
  /** Default true. */
  closeOnEsc?: boolean;
  /** Show the X button. Default true. */
  showClose?: boolean;
  /** Element to focus first (defaults to the first focusable element in the body, then the panel). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Classes for the panel / the scrolling body. */
  className?: string;
  bodyClassName?: string;
  /** Title color class, default text-mg-gold. */
  titleClassName?: string;
  /** role="alertdialog" for confirmations. */
  role?: 'dialog' | 'alertdialog';
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', full: 'sm:max-w-[min(96vw,80rem)]' } as const;

// ---- shared modal stack: only the top-most modal handles Esc / Tab, body scroll locked while any is open
const stack: string[] = [];
let savedOverflow = '';
let savedPaddingRight = '';
function lockScroll() {
  if (stack.length !== 1) return;
  const body = document.body;
  savedOverflow = body.style.overflow;
  savedPaddingRight = body.style.paddingRight;
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = 'calc(' + (getComputedStyle(body).paddingRight || '0px') + ' + ' + scrollbar + 'px)';
}
function unlockScroll() {
  if (stack.length !== 0) return;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
}

const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Accessible modal: portal to <body>, focus trap, Esc, backdrop click, scroll lock, internal scroll,
 * bottom sheet on phones, 100dvh-safe and safe-area aware.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  children,
  footer,
  headerActions,
  size = 'md',
  mobile = 'auto',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showClose = true,
  initialFocusRef,
  className,
  bodyClassName,
  titleClassName = 'text-mg-gold',
  role = 'dialog',
}: ModalProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = id + '-title';
  const descId = id + '-desc';

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    stack.push(id);
    lockScroll();

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current ?? (bodyRef.current ? focusables(bodyRef.current)[0] : undefined) ?? focusables(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const els = focusables(panelRef.current);
        if (els.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, id, closeOnEsc, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  const sheet = mobile === 'auto';
  const hasHeader = Boolean(title) || showClose || Boolean(headerActions);

  return createPortal(
    <div
      className={cx('fixed inset-0 z-[300] flex justify-center', sheet ? 'items-end sm:items-center' : 'items-center', 'sm:p-4 md:p-6', !sheet && 'p-3')}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-mg-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex w-full flex-col overflow-hidden border border-mg-border bg-mg-elevated text-mg-text shadow-mg-modal outline-none',
          sheet
            ? 'max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] rounded-t-mg-xl animate-mg-sheet-up sm:max-h-[min(85dvh,56rem)] sm:rounded-mg-lg sm:animate-mg-pop'
            : 'max-h-[calc(100dvh-1.5rem)] rounded-mg-lg animate-mg-pop sm:max-h-[min(85dvh,56rem)]',
          widths[size],
          className,
        )}
      >
        {sheet ? <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" aria-hidden="true" /> : null}
        {hasHeader ? (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-mg-border-subtle px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0 pt-1.5">
              {title ? <h2 id={titleId} className={cx('font-display text-lg font-extrabold leading-tight', titleClassName)}>{title}</h2> : null}
              {description ? <p id={descId} className="mt-1 text-sm text-mg-muted">{description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              {showClose ? (
                <IconButton aria-label="Close" onClick={() => onCloseRef.current()}>
                  <CloseIcon size={18} />
                </IconButton>
              ) : null}
            </div>
          </div>
        ) : null}
        <div ref={bodyRef} className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5', !footer && 'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-5', bodyClassName)}>
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-mg-border-subtle px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
