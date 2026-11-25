/* generated from app-platform/ui-kit — edit there and re-sync. */
/**
 * Share cards: a branded results image (and a short animated video where the browser can record MP4),
 * drawn entirely on the device with <canvas>. Nothing is uploaded. Used by ShareSheet; games pass a
 * ScoreCardData describing the result and everyone's score, plus a promo footer for the app.
 */
import { encode } from '../vendor/uqr.js';

export interface ScoreCardPlayer {
  name: string;
  /** Number (counted up in the video) or preformatted text such as "$1,200" or "12 / 15". */
  score: number | string;
  /** Team / player color (any CSS color). */
  color?: string;
  /** Shows a small "AI" tag. */
  ai?: boolean;
  /** Highlights the row with a crown. Defaults to the first row when no row is marked. */
  winner?: boolean;
  /** Small text under the name, e.g. "Fast Money: 212". */
  note?: string;
}

export interface ScoreCardStat {
  label: string;
  value: string;
  /** Who earned it, e.g. "Mohit" for "Best spin". Drawn under the value in `whoColor` (or the card accent). */
  who?: string;
  /** That player's color (hex). */
  whoColor?: string;
}

export interface ScoreCardData {
  /** "Mohit's Faceoff" */
  app: string;
  /** Where to play, e.g. "https://faceoff.mohitgoenka.com". Shown in the footer and encoded in the QR code. */
  url: string;
  /** Brand accent. Default gold #f5c542. The card is themed in the winner's color instead when the winning row has a
   *  hex `color` (set `winnerTheme: false` to keep the brand accent). */
  accent?: string;
  /** Theme the card in the winner's color (background glow, medal, highlights). Default true. */
  winnerTheme?: boolean;
  /** Big line, e.g. "Team Blue wins!" or "You reached $1,000,000". */
  headline: string;
  /** Line under the headline, e.g. "Movies theme · 3 rounds". */
  subline?: string;
  /** Leaderboard rows, already in the order to show (winner first). Up to 8 are drawn. */
  players?: ScoreCardPlayer[];
  /** Suffix after numeric scores, e.g. "pts". */
  scoreSuffix?: string;
  /** Up to 6 small stat tiles (two rows of 3 past 4), e.g. { label: 'Best spin', value: '$2,500', who: 'Mohit' }. */
  stats?: ScoreCardStat[];
  /** Emoji in the medal at the top. Default 🏆. */
  emoji?: string;
  /** Promo question in the footer. Default "Can you beat this?". */
  challenge?: string;
  /** Adds "Also on Google Play" to the footer. Default true. */
  playStore?: boolean;
  /** Footer call to action before the host. Default "Play free at" (apps: "Free at", "Cook free at"…). */
  cta?: string;
  /** Row markers: 'rank' (crown for the winner, then 2, 3…) or 'none'. Default 'rank'. */
  marker?: 'rank' | 'none';
}

export type ScoreCardFormat = 'post' | 'story';

export const SCORE_CARD_SIZES: Record<ScoreCardFormat, { w: number; h: number }> = {
  post: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

const DISPLAY = 'Georgia, "Times New Roman", serif';
const SANS = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Shrinks the font until the text fits maxWidth. Returns the size used. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, family: string, weight = 'bold', min = 18): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) t = t.slice(0, -1);
  return t + '\u2026';
}

function formatScore(score: number | string, suffix: string | undefined, progress: number): string {
  if (typeof score === 'string') return score;
  const v = Math.round(score * easeOut(progress));
  return v.toLocaleString() + (suffix ? ' ' + suffix : '');
}

function drawQr(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number) {
  try {
    const qr = encode(value, { ecc: 'M', border: 2 });
    const cell = size / qr.size;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, size, size, 14);
    ctx.fill();
    ctx.fillStyle = '#0a0a0b';
    qr.data.forEach((row, ry) =>
      row.forEach((dark, rx) => {
        if (dark) ctx.fillRect(x + rx * cell, y + ry * cell, Math.ceil(cell), Math.ceil(cell));
      }),
    );
  } catch {
    /* QR is decorative; skip on failure */
  }
}

/**
 * Draws one frame. t is seconds into the animation (the reveal takes ~3 s); pass Infinity for the final still.
 */
export function drawScoreCard(ctx: CanvasRenderingContext2D, data: ScoreCardData, format: ScoreCardFormat = 'post', t = Infinity) {
  const { w: W, h: H } = SCORE_CARD_SIZES[format];
  const accent = scoreCardAccent(data);
  const story = format === 'story';
  const pad = 72;

  // background
  ctx.save();
  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.95);
  g1.addColorStop(0, hexA(accent, 0.22));
  g1.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W, H, 0, W, H, W * 0.8);
  g2.addColorStop(0, hexA(accent, 0.1));
  g2.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  // confetti dots (deterministic)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const cx = rnd() * W;
    const cy = rnd() * H * 0.3 + (t === Infinity ? 0 : (1 - easeOut(t / 2.5)) * -120);
    ctx.globalAlpha = 0.12 + rnd() * 0.22;
    ctx.fillStyle = [accent, '#ffffff', '#f43f5e', '#0ea5e9', '#10b981'][i % 5]!;
    ctx.beginPath();
    ctx.arc(cx, cy, 3 + rnd() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ---- measure, so the content block can be centred above the footer
  const medalR = story ? 92 : 76;
  ctx.font = `bold ${story ? 80 : 70}px ${DISPLAY}`;
  const hsMeasured = fitText(ctx, data.headline, W - pad * 2, story ? 80 : 70, DISPLAY);
  const headerH = 40 + (medalR * 2 + 16) + 84 + Math.round(hsMeasured * 0.5) + 30 + (data.subline ? 52 : 0) + (story ? 40 : 18);
  const allRows = data.players || [];
  const footerH = story ? 330 : 250;
  const statList = (data.stats || []).slice(0, 6);
  const statRows = statList.length > 4 ? 2 : statList.length ? 1 : 0;
  const statHasWho = statList.some((s) => s.who);
  const statTileH = (story ? 150 : 110) + (statHasWho ? (story ? 40 : 34) : 0);
  const statsH = statRows ? 40 + statRows * statTileH + (statRows - 1) * 16 : 0;
  const top0 = story ? 170 : 96;
  const MORE_H = 46;
  // Rows shrink to fit (gap 16 → 10, height down to 56); past that, the lowest rows fold into "+ N more".
  let rowGap = 16;
  let rowsN = Math.min(8, allRows.length);
  let moreH = allRows.length > 8 ? MORE_H : 0;
  let avail = H - top0 - headerH - footerH - statsH - 30 - moreH;
  let rowH = 0;
  if (rowsN) {
    rowH = (avail - rowGap * (rowsN - 1)) / rowsN;
    if (rowH < 72) {
      rowGap = 10;
      rowH = (avail - rowGap * (rowsN - 1)) / rowsN;
    }
    if (rowH < 56) {
      if (!moreH) {
        moreH = MORE_H;
        avail -= MORE_H;
      }
      rowsN = Math.max(1, Math.floor((avail + rowGap) / (56 + rowGap)));
      rowH = 56;
    }
    rowH = Math.min(story ? 128 : 112, rowH);
  }
  const moreN = allRows.length - rowsN;
  if (moreN <= 0) moreH = 0;
  const blockH = headerH + (rowsN ? rowsN * (rowH + rowGap) - rowGap : 0) + moreH + statsH;
  const slack = H - footerH - 30 - top0 - blockH;
  let y = top0 + (slack > 0 ? Math.round(slack * (story ? 0.45 : 0.5)) : 0);

  // app name
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  fitText(ctx, data.app, W - pad * 2, 52, DISPLAY);
  ctx.fillText(data.app, W / 2, y);
  y += 40;

  // medal
  const pop = t === Infinity ? 1 : easeOut((t - 0.1) / 0.5);
  const my = y + medalR + 16;
  ctx.save();
  ctx.translate(W / 2, my);
  ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
  ctx.globalAlpha = clamp01(pop * 1.2);
  const mg = ctx.createRadialGradient(0, -medalR / 3, 4, 0, 0, medalR);
  mg.addColorStop(0, hexA(accent, 0.55));
  mg.addColorStop(1, hexA(accent, 0.12));
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(0, 0, medalR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = hexA(accent, 0.7);
  ctx.stroke();
  ctx.font = `${Math.round(medalR * 1.05)}px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(data.emoji || '\u{1F3C6}', 0, 6);
  ctx.restore();
  y = my + medalR + 84;

  // headline + subline
  const hl = t === Infinity ? 1 : easeOut((t - 0.3) / 0.5);
  ctx.globalAlpha = hl;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fafaf9';
  const hs = fitText(ctx, data.headline, W - pad * 2, story ? 80 : 70, DISPLAY);
  ctx.fillText(data.headline, W / 2, y + (1 - hl) * 20);
  y += Math.round(hs * 0.5) + 30;
  if (data.subline) {
    ctx.fillStyle = '#a1a1aa';
    fitText(ctx, data.subline, W - pad * 2, 34, SANS, '500', 20);
    ctx.fillText(data.subline, W / 2, y + 12);
    y += 52;
  }
  ctx.globalAlpha = 1;
  y += story ? 40 : 18;

  // leaderboard
  const rows = allRows.slice(0, rowsN);
  const ranks = data.marker !== 'none';
  const anyWinner = rows.some((p) => p.winner);
  rows.forEach((p, i) => {
    const start = 0.7 + i * 0.28;
    const a = t === Infinity ? 1 : easeOut((t - start) / 0.45);
    if (a <= 0) return;
    const rx = pad + (1 - a) * 80;
    const ry = y + i * (rowH + rowGap);
    const rw = W - pad * 2;
    const isWin = p.winner || (!anyWinner && i === 0);
    ctx.globalAlpha = a;
    roundRect(ctx, rx, ry, rw, rowH, 26);
    ctx.fillStyle = isWin ? hexA(accent, 0.16) : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.lineWidth = isWin ? 3 : 2;
    ctx.strokeStyle = isWin ? hexA(accent, 0.75) : 'rgba(255,255,255,0.08)';
    ctx.stroke();
    // color bar
    ctx.fillStyle = p.color || (isWin ? accent : '#52525b');
    roundRect(ctx, rx + 18, ry + 18, 12, rowH - 36, 6);
    ctx.fill();
    // rank
    const mid = ry + rowH / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = isWin ? accent : '#71717a';
    ctx.font = `bold ${Math.round(rowH * 0.36)}px ${SANS}`;
    if (ranks) ctx.fillText(isWin ? '\u{1F451}' : String(i + 1), rx + 78, mid + 2);
    // score
    ctx.textAlign = 'right';
    ctx.fillStyle = isWin ? accent : '#fafaf9';
    const scoreText = formatScore(p.score, data.scoreSuffix, t === Infinity ? 1 : (t - start) / 1.1);
    ctx.font = `bold ${Math.round(rowH * 0.4)}px ${SANS}`;
    const scoreW = ctx.measureText(scoreText).width;
    ctx.fillText(scoreText, rx + rw - 32, mid + 2);
    // name
    ctx.textAlign = 'left';
    const nameX = rx + (ranks ? 122 : 56);
    const nameMax = rw - (nameX - rx) - 32 - scoreW - 40 - (p.ai ? 70 : 0);
    ctx.fillStyle = '#fafaf9';
    ctx.font = `600 ${Math.round(rowH * 0.34)}px ${SANS}`;
    const name = ellipsize(ctx, p.name, Math.max(80, nameMax));
    const nameY = p.note ? mid - rowH * 0.13 : mid + 2;
    ctx.fillText(name, nameX, nameY);
    if (p.ai) {
      const nw = ctx.measureText(name).width;
      ctx.font = `bold ${Math.round(rowH * 0.2)}px ${SANS}`;
      const tw = ctx.measureText('AI').width + 22;
      roundRect(ctx, nameX + nw + 14, nameY - rowH * 0.15, tw, rowH * 0.3, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      ctx.fillStyle = '#d4d4d8';
      ctx.fillText('AI', nameX + nw + 25, nameY + 1);
    }
    if (p.note) {
      ctx.fillStyle = '#a1a1aa';
      ctx.font = `500 ${Math.round(rowH * 0.22)}px ${SANS}`;
      ctx.fillText(ellipsize(ctx, p.note, Math.max(80, nameMax)), nameX, mid + rowH * 0.22);
    }
  });
  ctx.globalAlpha = 1;
  y += rows.length ? rows.length * (rowH + rowGap) - rowGap : 0;
  if (moreH) {
    const ma = t === Infinity ? 1 : easeOut((t - (0.7 + rows.length * 0.28)) / 0.45);
    ctx.globalAlpha = ma;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a1a1aa';
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText('+ ' + moreN + ' more', W / 2, y + moreH / 2 + 4);
    ctx.globalAlpha = 1;
    y += moreH;
  }

  // stats tiles (1 row of up to 4, or 2 rows of 3 for 5–6)
  if (statList.length) {
    const sa = t === Infinity ? 1 : easeOut((t - (0.9 + rows.length * 0.28)) / 0.5);
    ctx.globalAlpha = sa;
    const top = y + 30;
    const gap = 18;
    const perRow = statRows === 2 ? 3 : statList.length;
    const th = statTileH;
    statList.forEach((s, i) => {
      const r = Math.floor(i / perRow);
      const inRow = r === statRows - 1 ? statList.length - r * perRow : perRow;
      const c = i - r * perRow;
      const tw = (W - pad * 2 - gap * (inRow - 1)) / inRow;
      const tx = pad + c * (tw + gap);
      const ty = top + r * (th + 16);
      roundRect(ctx, tx, ty, tw, th, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      if (s.who) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = hexA(s.whoColor && isHex(s.whoColor) ? s.whoColor : accent, 0.35);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const valueY = ty + (s.who ? th * 0.42 : th * 0.52);
      ctx.fillStyle = '#fafaf9';
      fitText(ctx, s.value, tw - 24, story ? 52 : 44, SANS, 'bold', 18);
      ctx.fillText(s.value, tx + tw / 2, valueY);
      if (s.who) {
        ctx.fillStyle = s.whoColor && isHex(s.whoColor) ? lighten(s.whoColor) : accent;
        fitText(ctx, s.who, tw - 24, story ? 32 : 28, SANS, '700', 16);
        ctx.fillText(ellipsize(ctx, s.who, tw - 24), tx + tw / 2, ty + th * 0.64);
      }
      ctx.fillStyle = '#a1a1aa';
      fitText(ctx, s.label.toUpperCase(), tw - 24, 22, SANS, '600', 14);
      ctx.fillText(s.label.toUpperCase(), tx + tw / 2, ty + (s.who ? th * 0.86 : th * 0.8));
    });
    ctx.globalAlpha = 1;
  }

  // promo footer
  const fy = H - footerH;
  const fh = footerH - (story ? 110 : 56);
  roundRect(ctx, pad, fy, W - pad * 2, fh, 30);
  const fg = ctx.createLinearGradient(pad, fy, W - pad, fy + fh);
  fg.addColorStop(0, hexA(accent, 0.2));
  fg.addColorStop(1, 'rgba(255,255,255,0.04)');
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hexA(accent, 0.45);
  ctx.stroke();
  const qrSize = fh - 48;
  drawQr(ctx, data.url, W - pad - 24 - qrSize, fy + 24, qrSize);
  const textMax = W - pad * 2 - qrSize - 80;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fafaf9';
  fitText(ctx, data.challenge || 'Can you beat this?', textMax, story ? 50 : 44, DISPLAY);
  ctx.fillText(data.challenge || 'Can you beat this?', pad + 36, fy + fh * 0.36);
  ctx.fillStyle = accent;
  const host = hostOf(data.url);
  const ctaLine = (data.cta || 'Play free at') + ' ' + host;
  fitText(ctx, ctaLine, textMax, 32, SANS, 'bold', 18);
  ctx.fillText(ctaLine, pad + 36, fy + fh * 0.62);
  if (data.playStore !== false) {
    ctx.fillStyle = '#a1a1aa';
    fitText(ctx, 'Also on Google Play', textMax, 28, SANS, '500', 16);
    ctx.fillText('Also on Google Play', pad + 36, fy + fh * 0.84);
  }
}

const isHex = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());

/** Mixes a hex color toward white so it stays readable as text on the dark card. */
function lighten(color: string, amt = 0.25): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** The card's theme color: the winner's (hex) color when there is one, else the brand accent, else gold. */
export function scoreCardAccent(data: ScoreCardData): string {
  if (data.winnerTheme !== false) {
    const rows = data.players || [];
    const win = rows.find((p) => p.winner) || (data.marker !== 'none' ? rows[0] : undefined);
    if (win?.color && isHex(win.color)) return win.color;
  }
  return data.accent || '#f5c542';
}

/** #rgb / #rrggbb + alpha → rgba(); other CSS colors are returned unchanged. */
function hexA(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function makeCanvas(format: ScoreCardFormat): HTMLCanvasElement {
  const { w, h } = SCORE_CARD_SIZES[format];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Renders the final still as a PNG blob. */
export async function renderScoreCardPng(data: ScoreCardData, format: ScoreCardFormat = 'post'): Promise<Blob> {
  const canvas = makeCanvas(format);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  drawScoreCard(ctx, data, format, Infinity);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
}

/** MP4 is what Instagram, Facebook and WhatsApp accept; returns the best supported MP4 type, else null. */
export function scoreVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const t of types) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Duration of the recorded clip in seconds (reveal + hold). */
export function scoreVideoDuration(data: ScoreCardData): number {
  const rows = Math.min(8, data.players?.length ?? 0);
  return Math.min(7, 2.6 + rows * 0.28 + 2);
}

/**
 * Records the animated reveal as an MP4 clip (real time, ~4–6 s). Rejects when MP4 recording is unsupported.
 * onProgress gets 0..1.
 */
export async function recordScoreCardVideo(data: ScoreCardData, format: ScoreCardFormat = 'story', onProgress?: (p: number) => void): Promise<Blob> {
  const mime = scoreVideoMimeType();
  if (!mime) throw new Error('Video recording is not supported here');
  const canvas = makeCanvas(format);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  drawScoreCard(ctx, data, format, 0);
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => (chunks.length ? resolve(new Blob(chunks, { type: 'video/mp4' })) : reject(new Error('Recording failed')));
    rec.onerror = () => reject(new Error('Recording failed'));
  });
  const total = scoreVideoDuration(data);
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawScoreCard(ctx, data, format, t);
      onProgress?.(Math.min(1, t / total));
      if (t >= total) resolve();
      // rAF pauses in background tabs; setTimeout keeps the clip going if the tab is hidden.
      else if (document.hidden) setTimeout(tick, 33);
      else requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  stream.getTracks().forEach((tr) => tr.stop());
  return done;
}
