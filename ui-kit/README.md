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
   ≤1.5 MB, minus maps, og images, screenshots) and a content-hash version.

Options: `mgKit({ sw: false })`, `mgKit({ preloadFonts: false })`,
`mgKit({ sw: { swSrc: 'public/sw.js' } })` to keep an app's own worker (put `[/* __MG_PRECACHE__ */]` and
`'__MG_VERSION__'` in it to get the list/version injected), `sw: { extra: ['/offline.html'], exclude: [/big\.mp3$/] }`.
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
The shared one-line header: `[Apps and Games 🎮] [title + favicon] [right slot · ? · ⚙]` — same 3-column grid,
colors and sizes the apps use today; on phones the hub link collapses to 🎮.

| prop | type | default |
| --- | --- | --- |
| `title` | ReactNode | — |
| `icon` | image URL / node / `null` | `'/favicon.svg'` |
| `onTitleClick` | `() => void` | plain title |
| `confirmBack` / `confirmText` | boolean / string | `false` / `'Go back?'` (red pulsing two-tap back) |
| `hubHref` | string \| false | `'https://mohitgoenka.com/apps/'` (false omits; always hidden when `isNativeApp()`) |
| `hubLabel` / `hubNewTab` | string / boolean | `'Apps and Games'` / `true` (as today) |
| `onRules` / `rulesLabel` | `() => void` / string | Help (?) button shown when set / `'Help'` |
| `onSettings` | `() => void` | gear button shown when set |
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
  onSettings={() => setShowSettings(true)}
  right={<IconButton aria-label={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={toggleMute}><VolumeOnIcon /></IconButton>}
/>
```

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
Download-as-PDF button, Last Updated / © Mohit's Creations / Privacy Policy footer). PDF uses the browser's print
dialog on the rendered DOM — no jsPDF/html2canvas CDN scripts.

`appName`, `onClose`, `sections?: { title, icon?, items: ReactNode[] }[]` (pass your `GAME_RULES` / `APP_RULES`
as-is), `children`, `open` (default `true`, so `{show && <RulesOverlay …/>}` works), `subtitle` ('How to Play'),
`accentColor` (gold), `downloadable` (true), `showFooter` (true).

```tsx
{showRules && <RulesOverlay appName="Mohit's Bingo" sections={GAME_RULES} onClose={() => setShowRules(false)} />}
```

### `SettingsSheet` (+ `Switch`)
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

### `LazyQRCode` / `QRCode`
Pure SVG QR code from a vendored MIT encoder (uqr, license in `vendor/uqr.js`). Encodes locally — the value is never
sent anywhere. `LazyQRCode` splits the encoder (~4 kB gz) into its own chunk with a same-size skeleton.
Props: `value`, `size` (200), `ecc` `L|M|Q|H` ('M'), `margin` (2 modules), `color` (#0a0a0b), `background` (#fff),
`label` ('QR code'). Static version: `import { QRCode } from './ui-kit/components/QRCode'`.

### Icons
`HelpIcon`, `SettingsIcon`, `CloseIcon`, `DownloadIcon`, `ShareIcon`, `CopyIcon`, `CheckIcon`, `AlertIcon`, `InfoIcon`,
`WifiOffIcon`, `VolumeOnIcon`, `VolumeOffIcon`, `RefreshIcon`, `FlagIcon`, `MoreIcon` — inline SVG, `size` prop (18), `currentColor`.
Apps can keep lucide-react for everything else.

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
  The kit already uses it: `AppHeader` and `ErrorBoundary` hide the "Apps and Games" hub link in the app.
  Apps should also use it to: hide their own hub links / title-click-to-hub, hide any "install this app" (PWA) hint,
  and hide web purchase / pricing / Stripe checkout CTAs (Play payments policy — the app must work on the free tier).
  Keep everything else identical. Test with a spoofed UA (CDP `Network.setUserAgentOverride` / Chrome
  `--user-agent="… MohitGoenkaApp/Android"`).
- `reportContent({ app, kind, content, reason, note? })` — the call behind `ReportContentButton`; resolves on success,
  throws `FetchError`. Sends only those fields plus `platform` (`'web'`/`'android'`), trimmed to `REPORT_LIMITS`
  (`content` 1200, `note` 300 chars) with control characters stripped. `REPORT_REASONS` lists the reasons.
- `HUB_URL` (`https://mohitgoenka.com/apps/`), `HUB_LABEL`, `PRIVACY_URL`, `COPYRIGHT`, `cx(...)`,
  `safeGet/safeSet/safeRemove/readJson` (storage that never throws), `getSettings/setSettings`.

### `sw-template.js` (reference service worker)
Precache shell (list injected at build) · navigations network-first (3 s) → cached `index.html` offline ·
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
| `mg-subtle` | `#71717a` | `text-[#71717a]` |
| `mg-gold` | `#f5c542` | `#f5c542` (incl. `bg-[#f5c542]/20` → `bg-mg-gold/20`, `rgba(245,197,66,0.12)` → `bg-mg-gold/12`) |
| `mg-gold-hover` | `#e6b73a` | `hover:bg-[#e6b73a]`, `#d4a83a` |
| `mg-on-gold` | `#0a0a0b` | text on gold buttons |
| `mg-danger` | `#f43f5e` | `#f43f5e`, rose/red-500 |
| `mg-success` | `#10b981` | `#10b981`, emerald-500 |
| `mg-warning` | `#f59e0b` | `#f59e0b`, amber-500 |
| `mg-info` | `#0ea5e9` | `#0ea5e9`, sky-500 |
| `--font-display` | Syne | `font-header`, `font-anton`, `font-['Syne']` → `font-display` |
| `--font-sans` | DM Sans | default body font (no class needed) |
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
