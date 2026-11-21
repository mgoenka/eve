/* generated from app-platform/ui-kit — edit there and re-sync. */
import { showToast } from './toastBus';

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Copy text to the clipboard and show a toast. */
export async function copyToClipboard(text: string, toastMessage: string | false = 'Copied to clipboard'): Promise<boolean> {
  const ok = await copyText(text);
  if (toastMessage !== false) {
    showToast(ok ? { message: toastMessage, tone: 'success' } : { message: "Couldn't copy — long-press to copy instead", tone: 'error' });
  }
  return ok;
}

/**
 * Web Share sheet on phones; falls back to copying the link (or text) with a "Link copied" toast.
 * Returns what happened so callers can react.
 */
export async function shareOrCopy(data: ShareData, opts: { copiedMessage?: string } = {}): Promise<ShareResult> {
  const payload: ShareData = {};
  if (data.title) payload.title = data.title;
  if (data.text) payload.text = data.text;
  if (data.url) payload.url = data.url;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(payload))) {
      await navigator.share(payload);
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    /* otherwise fall back to copy */
  }
  const text = data.url ?? [data.text, data.title].filter(Boolean).join(' ');
  if (!text) return 'failed';
  const ok = await copyToClipboard(text, opts.copiedMessage ?? (data.url ? 'Link copied' : 'Copied to clipboard'));
  return ok ? 'copied' : 'failed';
}
