/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { COPYRIGHT, PRIVACY_URL } from '../utils/constants';
import { isNativeApp } from '../utils/native';
import { DownloadIcon } from './icons';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

/** Same shape as the apps' existing GAME_RULES / APP_RULES arrays. icon is optional. */
export interface RuleSection {
  title: string;
  icon?: string;
  items: ReactNode[];
}

export interface RulesOverlayProps {
  /** Default true, so both `{show && <RulesOverlay …/>}` and `<RulesOverlay open={show} …/>` work. */
  open?: boolean;
  onClose: () => void;
  /** e.g. "Mohit's Bingo" */
  appName: string;
  /** Pass the app's GAME_RULES / APP_RULES here. */
  sections?: RuleSection[];
  /** Extra content after the sections (or instead of them). */
  children?: ReactNode;
  /** Small line under the title in the PDF. Default "How to Play". */
  subtitle?: string;
  /** Headings/bullets color. Default the kit gold. Keep gold unless the app already used another accent. */
  accentColor?: string;
  /**
   * "Download as PDF" button (uses the browser's print → Save as PDF; no external scripts). Default true.
   * Always hidden inside the native app wrappers (Android WebView has no print dialog).
   */
  downloadable?: boolean;
  /** Last updated / © Mohit's Creations / Privacy Policy footer. Default true. */
  showFooter?: boolean;
}

function lastUpdated(): string {
  const d = new Date(document.lastModified);
  if (Number.isNaN(d.getTime())) return '';
  return 'Last Updated: ' + d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Print the already-rendered rules (cloned DOM, no HTML strings) in a hidden iframe so the user can save a PDF. */
function printRules(content: HTMLElement, appName: string, subtitle: string, accent: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.title = appName.replace(/^Mohit's\s*/i, '') + ' Rules';
  const style = doc.createElement('style');
  style.textContent = [
    '@page{margin:14mm}',
    "body{font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#18181b;background:#fff;margin:0}",
    "h1{font-family:'Syne',Georgia,serif;font-size:30px;font-weight:800;margin:0 0 6px;text-align:center;color:" + accent + '}',
    '.sub{font-size:13px;color:#71717a;text-align:center;margin:0 0 24px;padding-bottom:16px;border-bottom:2px solid #e4e4e7}',
    "h3{font-family:'Syne',Georgia,serif;font-size:16px;font-weight:800;margin:22px 0 8px;color:" + accent + '}',
    'ul{list-style:none;padding:0;margin:0}',
    'li{font-size:13.5px;line-height:1.65;padding:2px 0 2px 18px;position:relative;color:#3f3f46}',
    'li>span:first-child{position:absolute;left:0;color:' + accent + '}',
    'section{break-inside:avoid}',
  ].join('\n');
  doc.head.appendChild(style);
  const h1 = doc.createElement('h1');
  h1.textContent = appName;
  const sub = doc.createElement('p');
  sub.className = 'sub';
  sub.textContent = subtitle;
  const clone = doc.importNode(content, true);
  clone.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
  doc.body.append(h1, sub, clone);
  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(cleanup, 60_000);
    }
  }, 50);
}

/** Darken a light accent so it stays readable on white paper. */
function printAccent(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return '#a16207';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.55) return hex;
  return '#' + [r, g, b].map((c) => Math.round(c * 0.65).toString(16).padStart(2, '0')).join('');
}

/** The shared "How to play" overlay. Pass the app's GAME_RULES/APP_RULES as `sections`. */
export function RulesOverlay({ open = true, onClose, appName, sections = [], children, subtitle = 'How to Play', accentColor = '#f5c542', downloadable = true, showFooter = true }: RulesOverlayProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const accentStyle: CSSProperties = { color: accentColor };
  const canDownload = downloadable && !isNativeApp();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span style={accentStyle}>{appName}</span>}
      ariaLabel={appName + ' rules'}
      size="lg"
      headerActions={
        canDownload ? (
          <IconButton
            aria-label="Download rules as PDF"
            variant="gold"
            onClick={() => { if (contentRef.current) printRules(contentRef.current, appName, subtitle, printAccent(accentColor)); }}
          >
            <DownloadIcon size={18} />
          </IconButton>
        ) : null
      }
      footer={
        showFooter ? (
          <div className="flex flex-col items-center gap-1 text-center text-[10px] text-mg-muted sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-2 sm:text-left">
            <span className="sm:justify-self-start">{lastUpdated()}</span>
            <span className="sm:justify-self-center">© {new Date().getFullYear()} {COPYRIGHT}</span>
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-mg-muted underline-offset-2 hover:text-mg-text hover:underline sm:justify-self-end">Privacy Policy</a>
          </div>
        ) : undefined
      }
    >
      <div ref={contentRef}>
        {sections.map((section, idx) => (
          <section key={section.title + idx} className={idx > 0 ? 'mt-6' : ''}>
            <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-extrabold" style={accentStyle}>
              {section.icon ? <span aria-hidden="true">{section.icon}</span> : null}
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map((item, i) => (
                <li key={i} className="relative pl-5 text-sm leading-relaxed text-mg-text-2">
                  <span className="absolute left-0" style={accentStyle} aria-hidden="true">›</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {children ? <div className={sections.length ? 'mt-6' : ''}>{children}</div> : null}
      </div>
    </Modal>
  );
}
