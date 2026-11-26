/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { CopyIcon, DownloadIcon, ShareIcon } from './icons';
import { showToast } from '../utils/toastBus';
import { copyToClipboard, tagShareText, tagShareUrl } from '../utils/share';
import { isNativeApp } from '../utils/native';
import type { ScoreCardData, ScoreCardFormat } from '../utils/scoreCard';
import { recordScoreCardVideo, renderScoreCardPng, scoreVideoMimeType } from '../utils/scoreCard';

export interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the card shows. Build it when the sheet opens (it is redrawn when this object changes). */
  data: ScoreCardData;
  /** Text that goes with the image / link, e.g. "We scored 320 in Mohit's Faceoff! Can you beat it?". The app URL is added. */
  text: string;
  /** Sheet title. Default "Share your score". */
  title?: string;
  /** File name stem, e.g. "faceoff-score". Default from the app name. */
  fileName?: string;
}

type Busy = null | 'image' | 'video' | 'save';

const isPhone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function openOut(url: string) {
  // In the Android app Capacitor hands other hosts to the system (WhatsApp / Facebook / X apps or the browser).
  if (isNativeApp()) window.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
}

const SocialIcon = ({ d, fill = 'currentColor' }: { d: string; fill?: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill={fill}>
    <path d={d} />
  </svg>
);
const IG = 'M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 4.9a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8zm0 8.1a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zm5.1-9.4a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z';
const FB = 'M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z';
const WA = 'M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8zM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0z';
const XL = 'M18.2 2.2h3.4l-7.4 8.5L23 21.8h-6.8l-5.3-7-6.1 7H1.4l7.9-9L.9 2.2h7l4.8 6.4 5.5-6.4zm-1.2 17.6h1.9L7 4.1H5z';

/**
 * Share a result as an image (and a short MP4 clip where the browser can record one) with a promo for the app.
 * Phones get the system share sheet (Instagram, WhatsApp, Facebook, Messages…); desktops get download + link buttons.
 * Lazy-load it: `const ShareSheet = lazyWithRetry(() => import('./ui-kit/components/ShareSheet'))`.
 */
export function ShareSheet({ open, onClose, data, text, title = 'Share your score', fileName }: ShareSheetProps) {
  const [format, setFormat] = useState<ScoreCardFormat>('post');
  const [png, setPng] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [videoPct, setVideoPct] = useState(0);
  const videoRef = useRef<Blob | null>(null);
  const videoKey = useRef('');
  const stem = useMemo(() => fileName || data.app.replace(/^Mohit's\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-score', [fileName, data.app]);
  const canVideo = useMemo(() => scoreVideoMimeType() !== null, []);
  const shareUrl = useMemo(() => tagShareUrl(data.url), [data.url]);
  const fullText = useMemo(() => tagShareText(text.includes(data.url) ? text : text + ' ' + data.url), [text, data.url]);
  const phone = useMemo(isPhone, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | null = null;
    setPng(null);
    renderScoreCardPng(data, format)
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setPng(b);
        setPreview(url);
      })
      .catch(() => !cancelled && showToast({ message: "Couldn't draw the image", tone: 'error' }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, data, format]);

  const shareBlob = async (blob: Blob, name: string, kind: 'image' | 'video'): Promise<'shared' | 'saved' | 'cancelled'> => {
    const file = new File([blob], name, { type: blob.type });
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], text: fullText, title: data.app });
        return 'shared';
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return 'cancelled';
      }
    }
    download(blob, name);
    showToast({ message: kind === 'video' ? 'Video saved. Post it from your gallery or downloads.' : 'Image saved. Post it from your gallery or downloads.', tone: 'success' });
    return 'saved';
  };

  const getVideo = async (): Promise<Blob> => {
    const key = format + JSON.stringify(data);
    if (videoRef.current && videoKey.current === key) return videoRef.current;
    setVideoPct(0);
    const v = await recordScoreCardVideo(data, format, setVideoPct);
    videoRef.current = v;
    videoKey.current = key;
    return v;
  };

  const run = async (kind: Busy, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch {
      showToast({ message: "Couldn't share that. Try Save image instead.", tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const shareImage = () => run('image', async () => png && shareBlob(png, stem + '.png', 'image'));
  const shareVideo = () => run('video', async () => shareBlob(await getVideo(), stem + '.mp4', 'video'));
  const saveImage = () =>
    run('save', async () => {
      if (!png) return;
      download(png, stem + '.png');
      showToast({ message: 'Image saved', tone: 'success' });
    });
  const instagram = () =>
    run('image', async () => {
      if (!png) return;
      const r = await shareBlob(png, stem + '.png', 'image');
      if (r === 'saved') showToast({ message: 'Image saved. Open Instagram and add it to a post or story.', tone: 'success' });
    });
  const enc = encodeURIComponent;
  const whatsapp = () => openOut('https://wa.me/?text=' + enc(fullText));
  const facebook = () => openOut('https://www.facebook.com/sharer/sharer.php?u=' + enc(shareUrl) + '&quote=' + enc(text));
  const xpost = () => openOut('https://x.com/intent/post?text=' + enc(text) + '&url=' + enc(shareUrl));
  const copy = () => void copyToClipboard(fullText, 'Copied. Paste it anywhere.');

  const social = [
    { label: 'Instagram', icon: <SocialIcon d={IG} />, on: instagram, bg: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' },
    { label: 'WhatsApp', icon: <SocialIcon d={WA} />, on: whatsapp, bg: '#25d366' },
    { label: 'Facebook', icon: <SocialIcon d={FB} />, on: facebook, bg: '#1877f2' },
    { label: 'X', icon: <SocialIcon d={XL} />, on: xpost, bg: '#000000' },
    { label: 'Copy', icon: <CopyIcon size={22} />, on: copy, bg: '#3f3f46' },
  ];

  return (
    <Modal open={open} onClose={onClose} title={title} size="md" bodyClassName="space-y-4">
      <div className="flex justify-center gap-2" role="radiogroup" aria-label="Image size">
        {(['post', 'story'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={format === f}
            onClick={() => setFormat(f)}
            className={
              'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ' +
              (format === f ? 'bg-mg-gold text-mg-on-gold' : 'bg-mg-surface-2 text-mg-text-2 hover:bg-mg-surface-3')
            }
          >
            {f === 'post' ? 'Post' : 'Story'}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        {preview && png ? (
          <img
            src={preview}
            alt={data.headline}
            className={'rounded-mg border border-mg-border shadow-mg-card ' + (format === 'story' ? 'max-h-[46vh]' : 'max-h-[42vh]')}
            style={{ aspectRatio: format === 'story' ? '9 / 16' : '4 / 5' }}
          />
        ) : (
          <div className="flex items-center justify-center rounded-mg border border-mg-border bg-mg-surface-2 text-mg-muted" style={{ aspectRatio: format === 'story' ? '9 / 16' : '4 / 5', height: '40vh' }}>
            Drawing…
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button onClick={shareImage} loading={busy === 'image'} disabled={!png || (busy !== null && busy !== 'image')} leftIcon={<ShareIcon size={18} />}>
          {phone ? 'Share image' : 'Share or save image'}
        </Button>
        {canVideo ? (
          <Button variant="secondary" onClick={shareVideo} disabled={busy !== null} aria-busy={busy === 'video' || undefined}>
            {busy === 'video' ? 'Making video ' + Math.round(videoPct * 100) + '%' : 'Share video'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={saveImage} loading={busy === 'save'} disabled={!png || (busy !== null && busy !== 'save')} leftIcon={<DownloadIcon size={18} />}>
            Save image
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3 pt-1">
        {social.map((s) => (
          <button key={s.label} type="button" onClick={s.on} disabled={busy !== null} className="flex w-16 flex-col items-center gap-1 text-xs text-mg-text-2 disabled:opacity-50">
            <span className="flex h-12 w-12 items-center justify-center rounded-full text-white" style={{ background: s.bg }}>
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </div>
      {canVideo && (
        <div className="text-center">
          <button type="button" onClick={saveImage} disabled={!png || busy !== null} className="inline-flex items-center gap-1.5 text-sm text-mg-muted underline-offset-4 hover:text-mg-text hover:underline disabled:opacity-50">
            <DownloadIcon size={16} /> Save image
          </button>
        </div>
      )}
    </Modal>
  );
}

export default ShareSheet;
