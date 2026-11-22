/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '../utils/cx';
import { FetchError } from '../utils/fetchJson';
import { REPORT_LIMITS, REPORT_REASONS, reportContent } from '../utils/reportContent';
import type { ReportReason } from '../utils/reportContent';
import { showToast } from '../utils/toastBus';
import { Button } from './Button';
import { FlagIcon } from './icons';
import { Modal } from './Modal';

export interface ReportContentDialogProps {
  open: boolean;
  onClose: () => void;
  /** App id on the server allow-list (repo/subdomain name), e.g. 'spinner'. */
  app: string;
  /** What is reported: 'question', 'clue', 'board', 'recipe', 'image', 'chat'… */
  kind: string;
  /** The AI-generated text. A function is called only when the dialog opens/sends. */
  content: string | (() => string);
  /** Dialog title. Default "Report AI content". */
  title?: string;
  /** Called after a report was sent. */
  onReported?: () => void;
}

const resolve = (c: string | (() => string)) => {
  try {
    return typeof c === 'function' ? c() : c;
  } catch {
    return '';
  }
};

// Keep the app's own keyboard shortcuts (e.g. space to buzz, arrow keys) from firing while typing a note.
// Escape/Tab still reach the Modal (it listens in the capture phase).
const stopKeys = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') e.stopPropagation();
};
// Clicks inside the portal still bubble through React to the button's parents (cards, tiles): stop them.
const stopClick = (e: MouseEvent) => e.stopPropagation();

/** Controlled dialog: pick a reason, optional note, send. Use it from your own "⋯" menu, or use ReportContentButton. */
export function ReportContentDialog({ open, onClose, app, kind, content, title = 'Report AI content', onReported }: ReportContentDialogProps) {
  const id = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote('');
    setError('');
    setSending(false);
    setSnapshot(resolve(content));
    // content is read once per opening on purpose (what the user saw when they tapped Report)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    if (!reason || sending) return;
    setSending(true);
    setError('');
    try {
      await reportContent({ app, kind, content: snapshot, reason, note });
      showToast({ tone: 'success', message: 'Thanks — your report was sent. Mohit reviews every report.' });
      onReported?.();
      onClose();
    } catch (e) {
      setError(e instanceof FetchError ? e.message : 'Couldn’t send the report. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const preview = snapshot.length > 180 ? snapshot.slice(0, 180).trimEnd() + '…' : snapshot;

  return (
    <span onClick={stopClick} onKeyDown={stopKeys} className="contents">
      <Modal
        open={open}
        onClose={sending ? () => {} : onClose}
        title={title}
        description="Flag AI-generated content that is offensive, inappropriate or wrong."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={onClose} disabled={sending}>Cancel</Button>
            <Button fullWidth onClick={() => void send()} disabled={!reason} loading={sending} loadingText="Sending report">
              Send report
            </Button>
          </div>
        }
      >
        {preview ? (
          <blockquote className="mb-4 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-mg-sm border-l-2 border-mg-gold/50 bg-mg-surface px-3 py-2 text-sm text-mg-text-2">
            {preview}
          </blockquote>
        ) : null}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-mg-text">What’s wrong with it?</legend>
          <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-1.5">
            {REPORT_REASONS.map((r) => {
              const checked = reason === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setReason(r.value)}
                  className={cx(
                    'flex min-h-11 w-full items-start gap-3 rounded-mg border px-3 py-2 text-left transition-colors',
                    checked ? 'border-mg-gold/60 bg-mg-gold/10' : 'border-mg-border bg-mg-surface hover:bg-mg-surface-2',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2', checked ? 'border-mg-gold' : 'border-mg-subtle')}
                  >
                    {checked ? <span className="h-2 w-2 rounded-full bg-mg-gold" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-mg-text">{r.label}</span>
                    <span className="block text-xs text-mg-muted">{r.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label htmlFor={id + '-note'} className="mt-4 mb-1.5 block text-sm font-semibold text-mg-text">
          Note <span className="font-normal text-mg-muted">(optional)</span>
        </label>
        <textarea
          id={id + '-note'}
          value={note}
          maxLength={REPORT_LIMITS.note}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything that helps us fix it"
          className="w-full resize-none rounded-mg border border-mg-border bg-mg-surface px-3 py-2 text-base text-mg-text placeholder:text-mg-subtle focus:border-mg-gold/60 focus:outline-none sm:text-sm"
        />
        <p className="mt-2 text-xs text-mg-subtle">Only the content above, your reason and note are sent — no account or device details.</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-mg-sm border border-mg-danger/40 bg-mg-danger/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        ) : null}
      </Modal>
    </span>
  );
}

export interface ReportContentButtonProps extends Omit<ReportContentDialogProps, 'open' | 'onClose'> {
  /** icon = small ghost flag button (default); link = flag + small text; menuitem = full-width row for a "⋯" menu. */
  variant?: 'icon' | 'link' | 'menuitem';
  /** Visible text for link/menuitem, aria-label for icon. Default "Report content". */
  label?: string;
  className?: string;
  /** Extra content after the label (menuitem). */
  children?: ReactNode;
  /** Identity of the reported item, for the "Reported" state (default: \`content\` when it is a string). */
  contentKey?: string;
}

/**
 * Small, unobtrusive "Report" control for AI-generated output. Opens ReportContentDialog; shows "Reported"
 * after a successful report until the content changes.
 */
export function ReportContentButton({ variant = 'icon', label = 'Report content', className, children, onReported, contentKey, ...dialog }: ReportContentButtonProps) {
  const [open, setOpen] = useState(false);
  const [reportedFor, setReportedFor] = useState<string | null>(null);
  const current = contentKey ?? (typeof dialog.content === 'string' ? dialog.content : null);
  const reported = reportedFor !== null && current !== null && reportedFor === current;

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
  };
  const shown = reported ? 'Reported' : label;
  const common = {
    type: 'button' as const,
    onClick,
    'aria-haspopup': 'dialog' as const,
    disabled: reported,
    title: reported ? 'Reported — thanks' : label,
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          {...common}
          aria-label={reported ? 'Reported' : label}
          className={cx(
            'relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-mg-sm text-mg-subtle opacity-70 transition hover:bg-white/5 hover:text-mg-text hover:opacity-100 disabled:cursor-default disabled:opacity-40 before:absolute before:-inset-1.5 before:content-[""]',
            className,
          )}
        >
          <FlagIcon size={15} />
        </button>
      ) : variant === 'link' ? (
        <button
          {...common}
          className={cx(
            'inline-flex min-h-8 items-center gap-1.5 rounded-mg-sm px-1.5 text-xs font-medium text-mg-subtle transition-colors hover:text-mg-text disabled:cursor-default disabled:opacity-60',
            className,
          )}
        >
          <FlagIcon size={13} />
          {shown}
        </button>
      ) : (
        <button
          {...common}
          role="menuitem"
          className={cx(
            'flex min-h-11 w-full items-center gap-2.5 rounded-mg-sm px-3 py-2 text-left text-sm text-mg-text-2 transition-colors hover:bg-white/5 hover:text-mg-text disabled:cursor-default disabled:opacity-60',
            className,
          )}
        >
          <FlagIcon size={16} />
          <span className="min-w-0 flex-1">{shown}</span>
          {children}
        </button>
      )}
      <ReportContentDialog
        {...dialog}
        open={open}
        onClose={() => setOpen(false)}
        onReported={() => {
          setReportedFor(current);
          onReported?.();
        }}
      />
    </>
  );
}

/**
 * Standard rules/help section about AI content and reporting — add it to GAME_RULES / APP_RULES.
 * `what`: what the AI makes ("questions and answers"); `where`: where the flag is ("on the host screen's ⋯ menu").
 */
export function aiContentRuleSection(what: string, where: string): { title: string; icon: string; items: string[] } {
  return {
    title: 'AI Content',
    icon: '🚩',
    items: [
      `The ${what} are generated by AI (Google Gemini) and can occasionally be wrong, odd or inappropriate.`,
      `Spot something offensive or inaccurate? Tap the flag (Report) ${where}, pick a reason and send — Mohit reviews every report.`,
    ],
  };
}
