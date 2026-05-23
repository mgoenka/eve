#!/usr/bin/env node
/**
 * Record a 90-second demo video of Eve walking through both sides
 * (diner + restaurant) on the live site. Saves a webm via Playwright,
 * then converts to mp4 with ffmpeg.
 *
 * Usage:  node scripts/record-demo.mjs
 * Output: /demo-video/eve-demo.mp4 + /demo-video/eve-demo.webm
 *
 * Note: Playwright recordVideo captures the viewport visually only. Eve's
 * voice plays in the headed Chromium context but is NOT captured to the
 * file. The judges seeing the video will read the captions and feel the
 * pace; live-stage demo is where they'll hear her voice.
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'demo-video');
const SITE = process.env.EVE_URL || 'https://eve.mohitgoenka.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
    permissions: ['microphone', 'geolocation'],
    geolocation: { latitude: 37.386, longitude: -122.0838 }, // Mountain View
  });

  const page = await context.newPage();

  // SECTION 1 — Diner home
  console.log('→ Loading diner home');
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4000); // greeting + hero load

  // Use a "Try this:" preset button so the form auto-fills (no typing
  // required — we want the video to land cleanly without speech-recognition
  // mocking)
  console.log('→ Clicking a Try preset');
  const tryBtn = page.getByText(/Try.*Date night|Date night.*Mountain View/i).first();
  if (await tryBtn.count()) {
    await tryBtn.click({ trial: false }).catch(() => {});
    await sleep(800);
  }

  // Click the main "Plan my evening" / "Surprise me" button
  console.log('→ Clicking Plan my evening');
  const planBtn = page
    .getByRole('button', { name: /Plan.*evening|Surprise/i })
    .first();
  if (await planBtn.count()) {
    await planBtn.click().catch(() => {});
  }

  // Wait for stops to load (skeleton + image streaming)
  console.log('→ Waiting for plan to render');
  await sleep(28000);

  // Linger so the auto-walkthrough kicks in and Eve narrates
  console.log('→ Letting auto-walkthrough run');
  await sleep(20000);

  // SECTION 2 — Restaurant side
  console.log('→ Switching to restaurant');
  await page.goto(`${SITE}/restaurant`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4000);

  console.log('→ Clicking Generate tonights look');
  const genBtn = page.getByRole('button', { name: /Generate.*look/i }).first();
  if (await genBtn.count()) {
    await genBtn.click().catch(() => {});
  }
  await sleep(22000); // wait for content pack

  console.log('→ Scrolling restaurant content pack');
  await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
  await sleep(3500);
  await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
  await sleep(3500);

  console.log('→ Closing context to flush video');
  await context.close();
  await browser.close();

  // Find the produced webm
  const files = await fs.readdir(OUT_DIR);
  const webm = files.find((f) => f.endsWith('.webm'));
  if (!webm) {
    console.error('No webm produced.');
    process.exit(1);
  }
  const webmPath = path.join(OUT_DIR, webm);
  const renamedWebm = path.join(OUT_DIR, 'eve-demo.webm');
  await fs.rename(webmPath, renamedWebm);

  // Convert to mp4 (H.264 + AAC silent track) for max compatibility
  const mp4Path = path.join(OUT_DIR, 'eve-demo.mp4');
  console.log('→ Converting webm → mp4');
  execSync(
    `ffmpeg -y -i "${renamedWebm}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${mp4Path}"`,
    { stdio: 'inherit' }
  );

  console.log('Done.');
  console.log('  webm:', renamedWebm);
  console.log('  mp4: ', mp4Path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
