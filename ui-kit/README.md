<!-- generated from app-platform/ui-kit — edit there and re-sync. -->
# Mohit's app kit (`ui-kit`)

Shared look and behaviour for every app and game: tokens, fonts, header, buttons, modals, toasts, rules overlay,
settings, error boundary, loaders, QR codes, plus hooks/utilities for storage, fetch, service worker and deploy-safe lazy loading.

- React 19 + TypeScript (strict, passes TS 7 with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noImplicitOverride`), Vite 8, Tailwind CSS v4.
- Zero runtime dependencies besides `react` / `react-dom`. No CDN scripts, no network calls of its own.
- The kit is **vendored** (copied) into each app. Never edit the copy in an app: change `~/Dev/app-platform/ui-kit`,
  commit, and re-sync. If an app needs a kit change, report it to the lead.

---

## 1. Install (sync)

```bash
bash ~/Dev/app-platform/scripts/sync-ui-kit.sh ~/Dev/<app>
```

Copies the kit with `rsync --delete` and prints the target:

| App layout | Target |
| --- | --- |
| has `client/src/` (letter) | `client/src/ui-kit/` |
| has `src/App.tsx` (buzzer, techex) | `src/ui-kit/` |
| everything else (`App.tsx` at repo root) | `ui-kit/` |

`ui-kit/VERSION` records the app-platform commit + date. Commit the vendored folder in the app.
In the examples below, `./ui-kit` means "the path from your file to the vendored folder".

## 2. CSS + fonts

In the app's main CSS file (usually `index.css`), import the kit **right after Tailwind**:

```css
@import "tailwindcss";
@import "./ui-kit/theme.css";      /* buzzer/techex: "./ui-kit/theme.css" from src/index.css; letter: from client/src */
```

- `theme.css` already contains `@source "./components";`, so Tailwind always scans the kit's classes even if
  automatic detection would miss the folder. If your Tailwind setup uses `source(none)` or a custom base, add
  `@source "./ui-kit";` next to the import.
- Fonts: Syne + DM Sans variable woff2 (latin), self-hosted, `font-display: swap`. The `@font-face` family names
  are `'Syne'` and `'DM Sans'`, so existing `font-family: 'Syne'` CSS keeps working.
  **Remove** the Google Fonts `<link rel="preconnect">` / `<link rel="stylesheet" href="https://fonts.googleapis.com/…">`
  / `<noscript>` lines from `index.html` (and `fonts.googleapis.com` / `fonts.gstatic.com` from the CSP).
- Preload: add the kit's Vite plugin (below) — it injects
  `<link rel="preload" href="/assets/syne-latin-wght-<hash>.woff2" as="font" type="font/woff2" crossorigin>` and
  the DM Sans one into the built `index.html` automatically (hashed URLs). Without the plugin, put these in
  `index.html` (Vite rewrites them to the hashed files; use the path from `index.html` to the kit):

  ```html
  <link rel="preload" href="./ui-kit/fonts/syne-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="./ui-kit/fonts/dm-sans-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
  ```
- Base layer (you can delete the same rules from `index.html`'s `<style>`): dark background/text, safe-area body
  padding (needs `viewport-fit=cover` in the viewport meta), tap-highlight off, `text-size-adjust`,
  `touch-action: manipulation` on interactive elements, gold `:focus-visible` ring, global
  `prefers-reduced-motion: reduce` damping (and the same when the user turns on "Reduce motion" in SettingsSheet),
  `overflow-x: clip` on body. Also provides `.site-theme` (the page backdrop gradient), `.font-header`,
  `.animate-fade-in`, `.animate-fade-in-up`, `.drop-shadow-glow`, `.no-scrollbar`, `pt-safe` / `pb-safe` / `px-safe` /
  `bottom-safe`.
- Static website / hub (no Tailwind): copy `ui-kit/` next to the site and use `theme-static.css` (same tokens as
  CSS custom properties plus `.mg-btn`, `.mg-btn--primary`, `.mg-card`). Preload/link lines are at the top of that file.

## 3. Vite plugin (font preload + service worker)

```ts
// vite.config.ts
import { mgKit } from './ui-kit/vite-plugin-mg.mjs';   // './src/ui-kit/…' or './client/src/ui-kit/…' per layout
export default defineConfig({ plugins: [react(), tailwindcss(), mgKit()] });
```

`mgKit()` on `vite build`:
1. injects the font preloads (above);
2. writes `dist/sw.js` from `ui-kit/sw-template.js` with the precache list (every built html/js/css/font/image
   ≤1.5 MB, minus maps, og images, screenshots, and lazy JS chunks over 100 KB that `index.html` doesn't load —
   PDF export, share video, QR scanner…; they're cached on first use) and a content-hash version.

Options: `mgKit({ sw: false })`, `mgKit({ preloadFonts: false })`,
`mgKit({ sw: { swSrc: 'public/sw.js' } })` to keep an app's own worker (put `[/* __MG_PRECACHE__ */]` and
`'__MG_VERSION__'` in it to get the list/version injected), `sw: { extra: ['/offline.html'], exclude: [/big\.mp3$/], lazyMaxBytes: 200 * 1024 }`.
If the app already has a working `public/sw.js`, either keep it (pass `swSrc`) or delete it and use the template —
`dist/sw.js` from the plugin overwrites the copied public one.
Not on Vite: `node ui-kit/vite-plugin-mg.mjs dist` after the build.

The server must send `Cache-Control: no-cache` for `/sw.js`, `/index.html` and the manifest, and
`public, max-age=31536000, immutable` for `/assets/*` (see the Express snippet in section 9).

## 4. Root wrapping

```tsx
// index.tsx (entry)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary, ToastProvider, registerServiceWorker } from './ui-kit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary appName="Mohit's Bingo">
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
registerServiceWorker(); // prod builds only; shows "Update available — Reload" when a new deploy is waiting
```

---

## 5. Components

All accept `className` unless noted. Phones = below Tailwind `sm` (640px).

### `AppHeader`
The shared one-line header: `[Apps and Games 🎮] [title + favicon] [right slot · ? · ⚙]`. Wide screens: 3 columns,
title centred. Phones, and whenever nothing is on the left (inside the Android app the hub link is hidden):
`[title | controls]` so the title gets the room (no more "Mohit'…"); mute, settings and install fold into one ⋯
menu when there are two or more of them, or whenever the app passes `menuItems`. Header icons are 1.125rem (scale
with the root size on big screens and TVs). Title `text-sm`, `md:text-base`, larger on TVs. **Every app gets a gear**:
without `onSettings` the header opens the kit's `SettingsSheet` itself (haptics, reduce motion, on-device AI, and
"Sound effects" when `sound` is given). On the website an "Install app" button appears when the browser offers it.

| prop | type | default |
| --- | --- | --- |
| `title` | ReactNode | — |
| `icon` | image URL / node / `null` | `'/favicon.svg'` |
| `onTitleClick` | `() => void` | plain title |
| `confirmBack` / `confirmText` | boolean / string | `false` / `'Go back?'` (red pulsing two-tap back) |
| `hubHref` | string \| false | `'https://mohitgoenka.com/apps/'` (false omits; always hidden when `isNativeApp()`) |
| `hubLabel` / `hubNewTab` | string / boolean | `'Apps and Games'` / `true` (as today) |
| `onRules` / `rulesLabel` | `() => void` / string | Help (?) button shown when set / `'Help'` |
| `onSettings` | `() => void` | your settings; without it the gear opens the kit's `SettingsSheet` |
| `settingsSheet` | `false` \| SettingsSheetProps (minus open/onClose) | props for the built-in sheet (`show`, `children`, `footnote`); `false` = no gear |
| `sound` | `{ muted, onToggle }` | mute icon (⋯ menu item on phones); the built-in sheet's "Sound effects" follows it |
| `menuItems` | `{ label, icon?, onClick, checked? }[]` | extra ⋯ menu entries (phones only; one is enough to show the menu) |
| `install` | boolean | `true`: "Install app" on the web when `beforeinstallprompt` fired (never in the app / once installed) |
| `right` | ReactNode | extra controls before ?/⚙ (use `IconButton`) |
| `left` | ReactNode | replaces the hub link |
| `showOffline` | boolean | `true` (Offline pill when offline) |
| `sticky` | boolean | `false` |

```tsx
<AppHeader
  title="Mohit's Bingo"
  onTitleClick={() => (phase === 'setup' ? (location.href = HUB_URL) : confirmBack ? backToSetup() : setConfirmBack(true))}
  confirmBack={confirmBack}
  onRules={() => setShowRules(true)}
  sound={{ muted, onToggle: toggleMute }}   // instead of a mute IconButton in `right`: folds into ⋯ on phones
  right={<CreditsChip />}
/>
```

### `AppFooter`, `StatusChip` / `RoomChip`, `PlayerSetupRow`, `GameHero`, `InstallButton` (shared screens)
All targets ≥ 44px, text ≥ 12px (`text-mg-2xs`), no `.slice()`-ing of names or codes.

| component | props |
| --- | --- |
| `<AppFooter />` | `buildInfo?: ReactNode` (e.g. "Last updated …"; hidden inside the Android app) · `links?: { label, href }[]` (after Privacy · Terms) · `children?` · `className?`. Renders © Mohit's Creations · Privacy (`PRIVACY_URL`) · Terms (`TERMS_URL`, mohitgoenka.com/terms). Only links to another origin open in a new tab. |
| `<StatusChip />` | `label?`, `value?` (tabular numbers), `icon?`, `tone?: 'neutral' \| 'gold' \| 'success' \| 'warning' \| 'danger' \| 'info'`, `onClick?` (then a button), `aria-label?`, `title?`, `className?`. Wraps between words, never mid-word. |
| `<RoomChip />` | `code` (shown in full), `label?` ('Room'), `joinUrl?` (QR button opens a big QR sheet; copy copies the link), `onQr?` (own QR handler), `copy?` (true), `className?` |
| `<PlayerSetupRow />` | `name`, `onNameChange`, `nameLabel?`, `maxLength?` (20), `color?`, `colors?: string[]` (swatch cycles; > 6 opens a picker), `onColorChange?`, `isAi?`, `onAiChange?` (Human / 🤖 AI switch), `stepper?: { value, onChange, min?, max?, label, format? }` (−/+), `onRemove?`, `disabled?`, `className?` |
| `<GameHero />` | `title`, `subtitle?`, `icon?`, `children?` (buttons), `compact?` (default auto: compact at `max-height: 500px`, landscape phones), `level?: 1 \| 2`, `className?` |
| `<InstallButton />` | `variant?: 'icon' \| 'button'`, `label?` ('Install app'), `className?`. `useInstallPrompt()` → `{ canInstall, installed, promptInstall() }` for your own UI; `installApp()` = prompt + success toast (what the button and the ⋯ item use). Web only. |

### `Button`
`variant`: `primary` (solid gold) · `secondary` (dark surface + border) · `outline` (gold outline on dark) · `ghost` · `danger`.
`size`: `sm` (36px visual, 44px hit area) · `md` (44px, default) · `lg` (52px). `loading`, `loadingText`, `fullWidth`,
`leftIcon`, `rightIcon`, `ref`, plus all `<button>` props (`type` defaults to `"button"`).
`buttonVariants` / `buttonSizes` class maps are exported for links styled as buttons.

```tsx
<Button onClick={start}>Start game</Button>
<Button variant="outline" size="lg" leftIcon={<ShareIcon />} onClick={share}>Invite</Button>
<Button loading={saving} fullWidth>Save</Button>
```

### `IconButton`
Square icon-only button. **`aria-label` is required** (also the tooltip). `variant`: `header` (default, the dark
header squares) · `ghost` · `gold`. `size`: `sm` 36 · `md` 40 (default) · `lg` 48 — all ≥44px hit area. `pressed` sets `aria-pressed`.

```tsx
<IconButton aria-label="Show QR code" onClick={openQr}><QrIcon /></IconButton>
```

### `Modal`
Portal to `<body>`, focus trap + restore, Esc, backdrop click, body scroll lock (nested-safe), internal scroll,
**bottom sheet on phones**, `100dvh`/safe-area aware.

`open`, `onClose`, `title`, `description`, `ariaLabel` (no title), `footer`, `headerActions`,
`size` `sm|md|lg|xl|full` (default `md`), `mobile` `'auto'` (sheet) | `'center'`, `closeOnBackdrop` (true),
`closeOnEsc` (true), `showClose` (true), `initialFocusRef`, `bodyClassName`, `titleClassName` (`text-mg-gold`), `role`.

```tsx
<Modal open={showQr} onClose={() => setShowQr(false)} title="Invite players" footer={<Button fullWidth onClick={share}>Share link</Button>}>
  <LazyQRCode value={joinUrl} size={220} />
</Modal>
```

### `ConfirmDialog` / `useConfirm`
`open`, `title`, `message`, `children`, `confirmLabel` ('Confirm'), `cancelLabel` ('Cancel'), `tone` `default|danger`,
`onConfirm` (may return a promise → spinner), `onCancel`. Danger focuses Cancel first.

```tsx
const { confirm, dialog } = useConfirm();
// render {dialog} once in the component
if (await confirm({ title: 'End the game?', message: 'Scores will be lost.', tone: 'danger', confirmLabel: 'End game' })) endGame();
```

### `ToastProvider` + `useToast` (+ `showToast` outside React)
`useToast()` → `{ toast(opts|string), success(msg, opts?), error(...), info(...), warning(...), dismiss(id) }`.
Options: `message`, `title`, `tone` `info|success|error|warning`, `duration` ms (3500; 6000 with an action; `0` = sticky),
`action: { label, onClick }`, `id` (same id replaces). `ToastProvider` props: `position` `bottom|top`, `max` (3).
`showToast()` works from any module (queued until the provider mounts).

```tsx
const { success, error } = useToast();
error("Couldn't generate the board", { action: { label: 'Retry', onClick: retry } });
```

### `RulesOverlay`
The shared "How to play" overlay (same look as the apps' current one: gold headings with emoji, `›` bullets,
Download-as-PDF button, Last Updated / © Mohit's Creations / Privacy Policy · Terms footer). PDF uses the browser's print
dialog on the rendered DOM — no jsPDF/html2canvas CDN scripts.

`appName`, `onClose`, `sections?: { title, icon?, items: ReactNode[] }[]` (pass your `GAME_RULES` / `APP_RULES`
as-is), `children`, `open` (default `true`, so `{show && <RulesOverlay …/>}` works), `subtitle` ('How to Play'),
`accentColor` (gold), `downloadable` (true; the PDF button is always hidden when `isNativeApp()` because Android
WebView has no print dialog), `showFooter` (true).

```tsx
{showRules && <RulesOverlay appName="Mohit's Bingo" sections={GAME_RULES} onClose={() => setShowRules(false)} />}
```

### `SettingsSheet` (+ `Switch`)
`sound?: { on, onChange }` makes the "Sound effects" switch show and set the app's own mute (AppHeader passes its `sound` prop).
"✨ Use this device's AI" shows only in apps with AI features: `AiCreditsHost` (every Sparks app) and the local-AI
helpers turn it on; elsewhere call `enableLocalAiSetting()` or pass `show={{ onDeviceAi: true }}` (`false` hides it).
Sound / Haptics / Reduce motion toggles bound to `useSettings()` (persisted, shared across the app and tabs),
plus an app-specific slot. `open`, `onClose`, `title` ('Settings'), `show={{ sound?, haptics?, reduceMotion? }}`
(hide what doesn't apply), `children`, `footnote`.
`Switch`: `checked`, `onChange`, `label`, `description`, `disabled` — full-row 48px toggle, `role="switch"`.

```tsx
<SettingsSheet open={showSettings} onClose={() => setShowSettings(false)} show={{ haptics: false }}>
  <Switch label="Show timer" checked={showTimer} onChange={setShowTimer} />
</SettingsSheet>
```

### `ErrorBoundary`
Friendly fallback instead of a white screen: **Reload**, **Reset saved data and reload** (clears this origin's
localStorage + sessionStorage + SW caches, or only `resetKeys` — exact keys or `'prefix*'`), optional back-to-hub,
collapsible error details. A chunk-load error after a deploy reloads once automatically (loop-guarded).
Props: `appName`, `hubHref` (hub; `false` hides), `resetKeys`, `fallback(error, reset)`, `onError`.

### Loaders
- `Spinner` — `size` (20), `label` ('Loading', '' when a visible label is next to it).
- `LoadingDots` — the three bouncing gold dots; `text` ("Generating board"), `dotClassName`.
- `Skeleton` — shimmer block; size via classes (`className="h-6 w-40"`) or `width`/`height`; `rounded` `sm|md|lg|full`.
- `SkeletonText` — `lines` (3).

### `EmptyState`
`icon` (emoji/node), `title`, `description`, `action` (a Button), `compact`.

### `OfflineBanner` / `OfflinePill`
Banner shows only while offline: `message`, `position` `bottom|top`. `OfflinePill` is the small header pill
(AppHeader shows it automatically).

### `ReportContentButton` / `ReportContentDialog` (report AI content)
Google Play requires a way to flag offensive or inaccurate AI-generated content **without leaving the app**. Put a
`ReportContentButton` next to every piece of AI output (question, clue, board, survey answers, puzzle, item, wheel,
recipe, plan, itinerary, AI image, AI chat reply). It opens a small dialog: pick a reason (Offensive or hateful ·
Inappropriate or unsafe · Wrong or misleading · Something else), optional note (300 chars), **Send report** → success
toast; errors stay in the dialog with the server's user-safe message. After a successful report the button shows
"Reported" until the content changes.

| prop | type | default |
| --- | --- | --- |
| `app` | string — the repo/subdomain id on the server allow-list (`'spinner'`, `'jeopardy'`, `'eve'`…) | — |
| `kind` | string — `'question'`, `'clue'`, `'board'`, `'answers'`, `'puzzle'`, `'item'`, `'wheel'`, `'recipe'`, `'plan'`, `'itinerary'`, `'image'`, `'chat'`… | — |
| `content` | string \| `() => string` — the AI text (or a description/URL of an AI image); read when the dialog opens | — |
| `variant` | `'icon'` (small ghost flag, 32px + hit area) · `'link'` (flag + "Report content" text) · `'menuitem'` (row for a "⋯" menu) | `'icon'` |
| `label` / `title` | button text or aria-label / dialog title | `'Report content'` / `'Report AI content'` |
| `contentKey` | identity for the "Reported" state when `content` is a function | — |
| `onReported` | `() => void` | — |

Clicks and keys inside the dialog don't reach the app (no accidental buzz/flip/space shortcuts while typing).
Keep it subtle in game UIs (host screen / results / a "⋯" menu), but reachable. `ReportContentDialog` is the
controlled version (`open`, `onClose`, same `app`/`kind`/`content`) for your own menus.
`aiContentRuleSection(what, where)` returns a ready rules section for `GAME_RULES` / `APP_RULES`:

```tsx
<ReportContentButton app="jeopardy" kind="clue" content={`${clue.category} — ${clue.question} → ${clue.answer}`} />
<ReportContentButton app="recipe" kind="recipe" variant="link" content={() => recipeToText(recipe)} contentKey={recipe.id} />
const GAME_RULES = [...rules, aiContentRuleSection('clues and answers', "on the host screen (flag next to each clue)")];
```

**CSP:** the report is a cross-origin `fetch` to `https://mohitgoenka.com/api/report-content` (no credentials), so the
app's Content-Security-Policy must allow it: `'connect-src': ["'self'", 'https://mohitgoenka.com']`.
The server accepts only `https://*.mohitgoenka.com` origins, an allow-listed `app`, the reason enum and capped
lengths, and rate-limits per IP (10/hour) and globally.

### AI credits: `AiCreditsHost`, `CreditsChip`, `CreditsSheet`, `aiFetchJson` (Android app only)
Prepaid AI credits for the Play apps (server side and the full integration guide: `app-platform/README.md`, "AI
credits"). Everything renders **nothing on the website**; inside the app it needs the wrapper's `window.MGNative`
bridge (an app build from the `ai-credits` native template).

- `<AiCreditsHost />` — mount once inside `ToastProvider`: loads the balance, recovers purchases that weren't credited
  yet, hosts the sheet.
- `<CreditsChip />` — coin + balance pill for `AppHeader`'s `right` slot (amber below 20); tap opens the sheet.
- The sheet lists the packs from the server with Google Play's **localized** prices, the balance, "Payment pending",
  and a friendly "Purchases are unavailable on this device right now" (+ try again) when Play Billing isn't available.
- `aiFetchJson(url, opts)` — `fetchJson` plus the `X-MG-App-User` header, live balance from `X-MG-Credits-Balance`, and
  on HTTP 402 `insufficient_credits` it opens the sheet and rethrows. `ai: 'action'` (default: the user tapped
  something) or `ai: 'background'` (loading tips, prefetch, auto-naming: never opens the sheet, never toasts;
  `creditsSheet: false` still works). Gate speculative calls with **`speculativeAiAllowed()`**: false while the
  balance is unknown; on the web true only while the web is free or the balance is above 0; in the app only for
  owners, paying users (`paid`) or with ≥ 50 Sparks. Right after page load the balance isn't known yet: use
  `await speculativeAiAllowedAsync()` (or `await whenCreditsLoaded()` first; resolves when the balance arrives, at
  once on pages without credits, after 8 s at the latest, never rejects).
  `isInsufficientCredits(err)`, `openCreditsSheet()`, `refreshCredits()`, `useCredits()`.
- **AI busy:** the server's HTTP 503 `{ error: 'ai_busy', retryAfter }` (server/ai-guard.ts) becomes an `AiBusyError`
  (a `FetchError`, `retryAfter` seconds; `isAiBusyError(err)`) and a toast "Lots of people are using this right now.
  Try again in N seconds." Pass `toastOnBusy: false` when the app shows its own message, and fall back to bundled
  content where it has some. `fetchJson` never auto-retries an `ai_busy` answer.
- The sheet: "Get Sparks" (not "You're out of Sparks") for a wallet that never had any; says plainly when free
  starter Sparks are paused today or not available on this network (`starterPaused` / `starterLimited` from the
  server); storage disclosures (Android: stored with the app on this device; web: tied to this browser, kept while
  used at least once every 400 days); "Taxes (like VAT) are added at checkout and shown before you pay." on the web;
  Privacy · Terms links.
- `aiCreditsRuleSections()` — `[]` on the web, one "AI Credits" rules section in the app: `[...rules, ...aiCreditsRuleSections()]`.
- Providers: payment goes through a `CreditsProvider` (`playCreditsProvider` in the app). `registerWebCreditsProvider()`
  is for a future web checkout; `activeCreditsProvider()` never returns it inside the Android app.
- `fetchJson` gained `onResponse(res)` (read headers; must not throw).

### `LazyShareSheet` / `ShareSheet` (share a result as an image or video)
Every game's end screen has **Play again** and **Share**. Share opens this sheet: a branded results card drawn on the
device (Post 4:5 or Story 9:16; app name, headline, everyone's score with AI tags and a crown for the winner, up to 4
stat tiles, and a promo footer "Can you beat this? · Play free at <host> · Also on Google Play" with a QR code),
**Share image** (system sheet on phones: Instagram, WhatsApp, Facebook, Messages…; download on desktop),
**Share video** (an animated ~5 s MP4 of the reveal, only where MediaRecorder can record MP4), Instagram / WhatsApp /
Facebook / X / Copy buttons, and Save image. Nothing is uploaded. In the Android app, image/video files go through
`navigator.share({files})` → NativeShell's share sheet (wrapper 1.2+; older wrappers fall back to saving the file).
```tsx
<LazyShareSheet open={shareOpen} onClose={() => setShareOpen(false)}
  text={`We scored ${score} in Mohit's Faceoff! Can you beat it?`}
  data={{ app: "Mohit's Faceoff", url: 'https://faceoff.mohitgoenka.com', headline: 'Team Blue wins!',
          subline: 'Movies · 3 rounds', scoreSuffix: 'pts',
          players: [{ name: 'Blue', score: 320, color: '#3b82f6', winner: true }, { name: 'Robo', score: 210, ai: true }],
          stats: [{ label: 'Rounds', value: '3' }] }} />
```
`renderScoreCardPng(data, format)` and `recordScoreCardVideo(data, format)` (utils/scoreCard) are there for custom UIs.

### On-device AI (`runLocalFirst`, `localJson`, `LocalAiSetting`, `useLocalAi`) — free, no Sparks
Devices with their own model run supported features locally: Chrome 148+ desktop / Edge (Prompt API `LanguageModel`)
and Android wrapper 1.3+ on AICore phones (Gemini Nano via ML Kit, `window.MGLocalAI`). Settings and the Sparks sheet
show "✨ Use this device's AI" (default on) with a one-time "Set up" download button where needed.
```ts
const words = await runLocalFirst({
  minOutputTokens: 200,                 // skip engines that can't write this much in one call (Android ≈256)
  local: () => localJson({ system, prompt, schema, validate: (v) => cleanWords(v) }), // null → server
  server: () => aiFetchJson('/api/ai/words', { method: 'POST', json: body }),       // charges Sparks
});
```
Use it only where a small model is good enough (creative text, short lists, classification, work grounded in
text the user gave). Keep the same validation/sanitizing on the local result as the server applies, and keep
fact-critical answer keys, prices, real places and health data on the server.

Behaviour: the engine probe is **lazy** (first feature / setting / Sparks sheet; no probe on page load, Chrome's
"Unable to create a text session" rejection is treated as unavailable), other states than `available` are
cached for 45 s (re-checked sooner when the tab becomes visible again, ≤ every 30 s, or the setting is turned on). `localJson` tries again only when `validate` rejects the output; a
timeout (`timeoutMs`, default 60 s) or any engine error (Android busy, battery quota, background, …) resolves
`null` at once. **Pass `signal`** (also to `runLocalFirst({ signal })`): an aborted request rejects with an
`AbortError` and never falls back to the paid server call (any other failure, even an engine's own AbortError
while `signal` is not aborted, falls back to the server). Browser engine: `LanguageModel.create()` gives up after
20 s, and a prompt that doesn't fit the session's context window (`measureContextUsage` / `contextWindow`, or
`measureInputUsage` / `inputQuota` on older Chrome; plus `maxOutputTokens` when you pass it) goes straight to the
server. Android: `timeoutMs` and `signal` go to the wrapper, which cancels the native call (`llmCancel`); images are
passed as the Blob (the shim downsizes them).

### Adaptive AI (`adaptiveSkill`, `createSkillTracker`, `skillToError`, `skillToDelay`)
AI opponents follow the humans: `adaptiveSkill({ humanScore, aiScore, scale, progress, humanAccuracy })` returns a 0..1
skill that starts just under the humans' observed accuracy, eases off while the AI leads (more so late in the game)
and pushes harder while it trails. Map it onto the game's own AI decisions (chance of a right answer, size of a
numeric error, buzz delay…). Humans can always win; games don't turn one-sided.

### Native shell: QR scanner, shortcuts, notifications (Android app)
Feature-detected wrappers for `window.MGNativeShell` (`utils/nativeShell.ts`; contract in
`~/Dev/native-apps/docs/native-features.md`). On the website and in old app builds every call is a no-op that
returns `null` / `false`; nothing throws.

| helper | what |
| --- | --- |
| `hasNativeScanner()` / `nativeScanQr()` → `string \| null` | native QR scanner (null on cancel / unavailable); `nativeScanQrResult()` gives the full `{ ok, text } \| { ok: false, error }` |
| `onAppShortcut((id) => …)` → unsubscribe | launcher shortcuts: the cold-start one (`takeLaunchShortcut()` or `?shortcut=<id>`, stripped with `history.replaceState`) and warm `mg-shortcut` events. Each shortcut reaches the handler once, also under StrictMode |
| `onNotificationOpen(({ path, data }) => …)` → unsubscribe | `mg-notification` (a tap, or a push while the app is in the foreground) |
| `pushAvailable()`, `notificationPermission()` | push support / `'granted' \| 'denied' \| 'prompt' \| null` |
| `requestPushToken()` → `string \| null` | asks for permission (Android 13+ prompt), then returns the FCM token. `getPushToken()` never prompts |
| `scheduleDailyReminder({ id, hour, minute, title, body, path? })` / `cancelReminder(id)` → `boolean` | local daily reminders (e.g. Fit) |
| `parseJoinCode(text, { maxLength?, hosts? })` | the room code in a scanned QR: `https://<app>.mohitgoenka.com/?join=CODE` (also this page's host, localhost) or a bare CODE; null for other sites |

```tsx
const { scan } = useNativeJoinScan(joinRoom, { onFallback: () => setShowScan(true) }); // your ScanQrModal stays the fallback
useEffect(() => onAppShortcut((id) => { if (id === 'join') void scan(); if (id === 'new') newGame(); }), [scan]);
<JoinScanButton onCode={joinRoom} onFallback={() => setShowScan(true)} />   // kit Button, "Scan to join", outline
```
`useNativeJoinScan(onCode, { onFallback?, onUnknownQr?, maxLength?, hosts? })` → `{ scan, scanning, native }`: native
scanner first; no native scanner (website, old build) or "unavailable" → `onFallback`; cancel → nothing; a QR that
isn't a room link → `onUnknownQr` (default toast "That QR code isn't a room link.").

**Turn notifications (phones in the Android app).** `<NotifyTurnPrompt />` (`label?`, `onResult?`, `className?`):
an inline card "🔔 Notify me when it's my turn" · Not now · Allow. Asked once (answer in localStorage
`mg:push-prompt:v1`); renders nothing on the website, in old builds, on TVs, once answered, or when notifications
are blocked. Allow → `requestPushToken()`. Pair it with:
- `registerSeatPush(socket, { joinedEvents? = ['joined'] })` → cleanup: after the player allowed it, emits
  `push-token { token }` (now, after each `joined`, and right after Allow) and `visibility { hidden }` (now and on
  every `visibilitychange`). `useEffect(() => registerSeatPush(socket), [socket])`.
- Host screens: `notifySeats(socket, { to: seatTokensOrNames | 'all', kind: 'turn' | 'start', title?, body? })` →
  `{ sent } | null`. The server (`server-kit/push/rooms.ts`) pushes only players who are away. Wiring: app-platform README
  "Push notifications".

### `LazyQRCode` / `QRCode`
Pure SVG QR code from a vendored MIT encoder (uqr, license in `vendor/uqr.js`). Encodes locally — the value is never
sent anywhere. `LazyQRCode` splits the encoder (~4 kB gz) into its own chunk with a same-size skeleton.
Props: `value`, `size` (200), `ecc` `L|M|Q|H` ('M'), `margin` (2 modules), `color` (#0a0a0b), `background` (#fff),
`label` ('QR code'). Static version: `import { QRCode } from './ui-kit/components/QRCode'`.

### Icons
`HelpIcon`, `SettingsIcon`, `CloseIcon`, `DownloadIcon`, `ShareIcon`, `CopyIcon`, `CheckIcon`, `AlertIcon`, `InfoIcon`,
`WifiOffIcon`, `VolumeOnIcon`, `VolumeOffIcon`, `RefreshIcon`, `FlagIcon`, `MoreIcon`, `CoinsIcon`, `SparklesIcon`,
`PlusIcon`, `MinusIcon`, `QrCodeIcon`, `InstallIcon` — inline SVG, `size` prop (18), `currentColor`.
Apps can keep lucide-react for everything else.

### `BackupModal`, `BackupButton`, `useBackupEntry` (+ `utils/backup.ts`)
Scorer's backup and sync for any app: cloud backup under a private recovery key, a one-use link code / QR to pair
another device, and Export / Import to a JSON file. Engine: `createBackup` (your own records) or `createKeyBackup`
(existing localStorage keys). Server side: `server-kit/backup` (`scripts/sync-backup.sh`). Full guide: the
app-platform README, "Backup and sync".

### `SearchSuggestions` (+ `utils/searchSuggestions.ts` `isSearchSuggestionsHtml`, plain TS a server can import)
For answers grounded with Google Search (Gemini `tools: [{ googleSearch: {} }]`). Google's Gemini API terms require
grounded results to be shown with their Search Suggestions, unmodified. Pass
`groundingMetadata.searchEntryPoint.renderedContent` as `html`: it renders in a sandboxed iframe (no scripts, opaque
origin, links open a new tab) and renders nothing for HTML that isn't shaped like Google's (only Google search
links, no active content), so a shared link or backup file can't inject markup. `height` (64). Store the HTML with
the grounded answer so saved copies still show it; don't serve one user's grounded answer to another from a cache.

## 6. Hooks

| hook | what |
| --- | --- |
| `useLocalStorage(key, initial, { version?, validate? })` → `[value, set, clear]` | JSON in `key:v<version>`, never throws, removes older versions, cross-tab sync |
| `useSettings()` → `[settings, set(patch)]` | `{ sound, haptics, reduceMotion }` persisted in `mg:settings:v1` |
| `useReducedMotion()` | OS reduce-motion OR the setting — gate JS animation/confetti on it (`prefersReducedMotion()` for non-hook code) |
| `useMediaQuery(q)` / `useIsPhone()` | live media query / `< 640px` |
| `useOnline()` | `navigator.onLine`, live |
| `useWakeLock(enabled)` → `{ supported, active }` | keeps the screen on (host/TV screens), re-acquires on tab focus |

## 7. Utilities

- `haptic(pattern)` / `haptics.tap|select|success|warning|error|buzz()` — guarded `navigator.vibrate`, respects the setting.
- `shareOrCopy({ title, text, url })` → `'shared' | 'copied' | 'cancelled' | 'failed'` — Web Share sheet, else copies
  the URL (or text) with a "Link copied" toast. Shares exactly what you pass, nothing else. `copyToClipboard(text, toastMsg)`.
- `fetchJson<T>(url, { timeoutMs = 15000, retries = 0 (max 2), backoffMs = 600, body, signal, responseType, ...RequestInit })`
  — per-attempt AbortController timeout; retries only timeouts / network / 429 / 5xx with exponential backoff + jitter;
  throws `FetchError { kind: 'timeout'|'network'|'http'|'parse'|'aborted', status, body, attempts, retryable }`
  whose `message` is user-safe. Objects in `body` are JSON-encoded. **Credentials are only ever sent same-origin**
  (forced to `omit` cross-origin).

  ```ts
  try {
    const board = await fetchJson<Board>('/api/generate', { method: 'POST', body: { theme }, timeoutMs: 20000, retries: 1 });
  } catch (e) {
    if (e instanceof FetchError) error(e.message, e.retryable ? { action: { label: 'Retry', onClick: retry } } : {});
  }
  ```
  For AI calls keep the total under ~20 s: e.g. `timeoutMs: 9000, retries: 1`.
- `lazyWithRetry(() => import('./HeavyScreen'))` — `React.lazy` that reloads the page once when a chunk 404s after a
  deploy (30 s loop guard in sessionStorage). Also `importWithRetry(() => import('lib'))` for non-component modules,
  `isChunkLoadError(e)`. Wrap lazy components in `<Suspense fallback={<Skeleton … />}>`.
- `registerServiceWorker({ url = '/sw.js', onUpdate?, message = 'Update available', enabled?, checkIntervalMs = 30 min })`
  — production only (https or localhost); sticky "Update available — Reload" toast; Reload posts `SKIP_WAITING` to the
  waiting worker and reloads once on `controllerchange`. `onUpdate(reg, apply)` returning `false` suppresses the toast.
- `isNativeApp()` — `true` inside Mohit's native wrappers (Capacitor apps that load the live site; their WebView user
  agent contains `MohitGoenkaApp/`, e.g. `MohitGoenkaApp/Android`). `nativePlatform()` → `'android' | 'ios' | null`.
  `goToHub({ newTab? })` navigates to the hub on the web and does nothing (returns `false`) in the app.
- **TV:** `isTvDevice()` (Chromecast / AFT / Google TV / Android TV user agents, or the wrapper's `window.__mgTv`);
  the kit sets `<html class="mg-tv">` on load (`applyTvClass()`), which scales the root font to 150% and widens
  `--mg-content-max`. `installDpadNav()` (installed automatically on TVs, no-op elsewhere): Up/Down in a number /
  date / time / range input or a select moves to the previous / next control instead of changing the value; Enter
  starts editing (arrows then change the value) until Enter / Escape. With the wrapper's TV shim it only lets arrows
  through to a field being edited (the shim keeps spatial navigation). Style for TV with `in-[.mg-tv]:…`.
  The kit already uses it: `AppHeader` and `ErrorBoundary` hide the "Apps and Games" hub link in the app.
  Apps should also use it to: hide their own hub links / title-click-to-hub, hide any "install this app" (PWA) hint,
  and hide web purchase / pricing / Stripe checkout CTAs (Play payments policy — the app must work on the free tier).
  Also hide what Android WebView can't do: `window.print()` buttons, browser speech recognition (mic) buttons and
  Google OAuth sign-in flows (Google blocks OAuth in WebViews). Trademarked show/brand names get neutral names there.
  Keep everything else identical. Test with a spoofed UA (CDP `Network.setUserAgentOverride` / Chrome
  `--user-agent="… MohitGoenkaApp/Android"`).
- `reportContent({ app, kind, content, reason, note? })` — the call behind `ReportContentButton`; resolves on success,
  throws `FetchError`. Sends only those fields plus `platform` (`'web'`/`'android'`), trimmed to `REPORT_LIMITS`
  (`content` 1200, `note` 300 chars) with control characters stripped. `REPORT_REASONS` lists the reasons.
- `HUB_URL` (`https://mohitgoenka.com/apps/`), `HUB_LABEL`, `PRIVACY_URL`, `TERMS_URL` (mohitgoenka.com/terms), `COPYRIGHT`, `cx(...)`,
  `safeGet/safeSet/safeRemove/readJson` (storage that never throws), `getSettings/setSettings`.

### `createLazySocket` (Socket.IO client: lazy, and lets go of the server when unused)
```ts
import type { Socket } from 'socket.io-client';
const socket = createLazySocket<Socket>(() => import('socket.io-client'), { transports: ['websocket'] });
```
Drop-in for `io({ ..., autoConnect: false })`: `on/off/once/emit/timeout().emit/io.on/io.off/connect/disconnect`,
`connected`, `active`, `id`. socket.io-client (~40 KB) downloads on the first `connect()`. After 5 minutes in a
hidden tab (`{ hiddenDisconnectMs }`) it disconnects and reconnects when the tab is shown; after the server's idle
sweep (`server-kit/idle-sockets`, `'idle-disconnect'`) it reconnects on the next tap/key or when the tab is shown.
Those reconnects fire the app's `'connect'` and `socket.io` `'reconnect'` listeners, so rejoin-by-token code keeps
working; messages queued while suspended are dropped. `disconnect()` from the app stops any resume.

### Free AI test mode (browser side, automatic)
`utils/testMode.ts` runs on import of the kit: in an automated browser (`navigator.webdriver`: Playwright, Puppeteer,
most agent browsers) every same-origin `fetch` carries `x-mg-ai-test: 1`, so the server's ai-guard answers AI routes
with fixtures instead of Gemini, and `createLazySocket` adds `mgTest=1` to the handshake (idle test sockets are
dropped after 2 min). `isAutomatedBrowser()` is exported. Real visitors are untouched.

### `sw-template.js` (reference service worker)
Precache shell (list injected at build) · navigations network-first, but after 800 ms without an answer (Cloud Run
cold start, slow network) the cached `index.html` is served and the network answer refreshes the cache in the
background; first visits wait for the network · offline → cached `index.html` ·
`/assets/*` cache-first · other same-origin GETs stale-while-revalidate · **never cached**: non-GET, cross-origin,
`/api`, `/socket.io`, `/auth|oauth|login|logout|session|callback|admin`, requests with `Authorization`/`Range`,
responses that aren't 200 basic or carry `no-store`/`private`/`Set-Cookie` · old `mg-*` caches deleted on activate ·
`skipWaiting` on message. Add app-specific never-cache paths to `NEVER_CACHE` via your own `swSrc` copy if needed.

## 8. Tokens

Use as Tailwind utilities (`bg-mg-surface`, `text-mg-gold`, `border-mg-border`, `bg-mg-gold/15`, `font-display`,
`rounded-mg`, `shadow-mg-card`) or CSS vars (`var(--color-mg-gold)`).

| token | value | migrate from |
| --- | --- | --- |
| `mg-bg` | `#0a0a0b` | `bg-[#0a0a0b]`, `#000` page backgrounds |
| `mg-surface` | `#121214` | `bg-[#121214]` (cards, header buttons, inputs) |
| `mg-surface-2` | `#1a1a1e` | `hover:bg-[#1a1a1e]`, `#161618` |
| `mg-surface-3` | `#242428` | `#242428`, `#27272a` |
| `mg-elevated` | `#18181b` | `bg-[#18181b]` (modals, overlays) |
| `mg-border` | `rgb(255 255 255 / .08)` | `border-[rgba(255,255,255,0.08)]`, `border-white/10` |
| `mg-border-subtle` | `rgb(255 255 255 / .06)` | `border-[rgba(255,255,255,0.06)]` |
| `mg-border-strong` | `rgb(255 255 255 / .15)` | `rgba(255,255,255,0.15)`, `…0.2` |
| `mg-text` | `#fafaf9` | `text-[#fafaf9]`, `text-white` on dark |
| `mg-text-2` | `#d4d4d8` | `text-[#d4d4d8]`, `#e4e4e7` |
| `mg-muted` | `#a1a1aa` | `text-[#a1a1aa]` |
| `mg-subtle` | `#83838c` | `text-[#83838c]` |
| `mg-gold` | `#f5c542` | `#f5c542` (incl. `bg-[#f5c542]/20` → `bg-mg-gold/20`, `rgba(245,197,66,0.12)` → `bg-mg-gold/12`) |
| `mg-gold-hover` | `#e6b73a` | `hover:bg-[#e6b73a]`, `#d4a83a` |
| `mg-on-gold` | `#0a0a0b` | text on gold buttons |
| `mg-danger` | `#f43f5e` | `#f43f5e`, rose/red-500 |
| `mg-success` | `#10b981` | `#10b981`, emerald-500 |
| `mg-warning` | `#f59e0b` | `#f59e0b`, amber-500 |
| `mg-info` | `#0ea5e9` | `#0ea5e9`, sky-500 |
| `--font-display` | Syne | `font-header`, `font-anton`, `font-['Syne']` → `font-display` |
| `--font-sans` | DM Sans | default body font (no class needed) |
| `--font-mono` | DM Sans + tabular figures | `font-mono` (scores, timers, codes) never falls back to Courier |
| `text-mg-2xs` | 12px / 16px | the text floor: replace `text-[9px]`, `text-[10px]`, `text-[11px]` |
| `max-w-mg-content` / `--mg-content-max` | 64rem; min(80rem, 92vw) at ≥ 1600px; min(90rem, 92vw) on TV | page content column |
| root size | 100%; 125% at ≥ 1600px (big monitors, Chromebooks); 150% on `html.mg-tv` | rem-based sizes scale with it |
| focus | gold outline on `:focus-visible`; inputs / selects / textareas also get a gold ring when they set `focus:outline-none` | |
| radii | `rounded-mg-sm` .5rem · `rounded-mg` .75rem (= `rounded-xl`) · `rounded-mg-lg` 1rem (= `rounded-2xl`) · `rounded-mg-xl` 1.5rem | |
| shadows | `shadow-mg-card`, `shadow-mg-modal`, `shadow-mg-glow` | |
| animations | `animate-fade-in`, `animate-fade-in-up`, `animate-mg-pop`, `animate-mg-sheet-up` | |

Migration tips:
- Search-and-replace the arbitrary values above (`bg-[#121214]` → `bg-mg-surface`, `text-[#a1a1aa]` → `text-mg-muted`, …).
  Inline `style={{ color: '#f5c542' }}` → `var(--color-mg-gold)`.
- App-specific accent colours (team colours, card colours) stay as they are — only the shared palette moves to tokens.
- Replace the header markup with `<AppHeader>` and the app's `RulesOverlay` component with the kit's (pass the same
  `GAME_RULES`), then delete the old component. Keep any app-specific buttons in `right`.
- Delete the Google Fonts links and the duplicated base `<style>` rules from `index.html` once `theme.css` is imported
  (keep app-specific rules like `.tile-bevel`).
- Gate JS animations/confetti with `useReducedMotion()`; map an existing mute toggle to `useSettings().sound`
  if it's a plain on/off.
- OG image: `node ~/Dev/app-platform/scripts/make-og.mjs --title "Mohit's X" --tagline "…" --icon public/favicon.svg --out public/og.png --domain x.mohitgoenka.com`.

## 9. Security

The kit never renders HTML from strings, never sends credentials cross-origin, and never caches API/auth/non-GET
traffic. Apps must also:

- Run `bash ~/Dev/app-platform/scripts/scan-secrets.sh ~/Dev/<app>` (working tree, `dist/`, full git history;
  prints `file:line` only, also checks `.env*` is excluded from `.dockerignore` / `.gcloudignore`).
  Templates: `~/Dev/app-platform/templates/dockerignore.template`, `gcloudignore.template`
  (a `.gcloudignore` **replaces** `.gitignore` for uploads, so it must list `.env*` itself).
- Never render AI output / user input with `dangerouslySetInnerHTML` / `innerHTML`.
- Harden Express (copy and trim the CSP to the origins the app really uses):

```ts
// server.ts — Express 5
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);            // Cloud Run: exactly one proxy hop → req.ip is the real client IP

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],                       // no 'unsafe-eval'; add hashes if index.html has inline scripts
      'style-src': ["'self'", "'unsafe-inline'"],     // React style={} attributes
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],                         // kit fonts are self-hosted
      'connect-src': ["'self'"],                      // add wss://<app>.mohitgoenka.com for Socket.IO if needed
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '100kb' }));          // raise only for endpoints that truly take uploads

// Rate-limit every AI / expensive endpoint (per real IP thanks to trust proxy).
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' } });
app.use('/api/', aiLimiter);

// Example endpoint: fixed request shape, validated, no client-chosen model/prompt/tokens.
app.post('/api/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const theme = typeof req.body?.theme === 'string' ? req.body.theme.trim().slice(0, 80) : '';
    if (!theme) return res.status(400).json({ error: 'Please enter a theme.' });
    // … call Gemini server-side with maxOutputTokens, a JSON responseSchema and a hard timeout …
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Static files: hashed assets immutable, shell files no-cache; express.static is traversal-safe.
const dist = path.resolve(import.meta.dirname, 'dist');
app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
app.use(express.static(dist, { index: false, setHeaders: (res, file) => {
  if (/(index\.html|sw\.js|manifest\.(json|webmanifest))$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
} }));
app.get('/{*splat}', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });

// Generic errors: log server-side, never send stack traces or upstream error bodies.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
  res.status(status >= 400 && status < 500 ? status : 500).json({ error: status < 500 ? 'Bad request.' : 'Something went wrong. Please try again.' });
});

app.listen(Number(process.env.PORT) || 8080);
```

Socket.IO: `new Server(httpServer, { maxHttpBufferSize: 16_384, cors: { origin: ['https://<app>.mohitgoenka.com'] } })`,
validate every payload, check host-only actions server-side, crypto-random room codes / player tokens.

## 10. Smoke tests

`~/Dev/app-platform/smoke` (Playwright, system Chrome locally). Checks HTTP 200, no uncaught page errors, no console
errors (small allow-list), no horizontal overflow, non-empty title, main content visible, load time, and no
secret-looking strings in the page's JS bundles — at 390×844 (mobile), 768×1024 and 1440×900.

```bash
export PATH=$HOME/Dev/node-26/bin:$PATH
cd ~/Dev/app-platform/smoke && npm ci            # first time only
APP=bingo URL=http://localhost:5173 npx playwright test   # one app against your local production server
npx playwright test                                         # every live app in apps.json
APP=bingo npx playwright test                               # one live app
```

Report: `smoke/results/summary.md` (+ `results.json`).
