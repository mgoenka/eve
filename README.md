# Eve

> *Yours, quietly.* — the AI evening concierge.

**Live:** https://eve.mohitgoenka.com
**Code:** https://github.com/mgoenka/eve
**Founder:** Mohit Goenka

---

## What Eve does

Eve plans your evening end-to-end. You tell her where you are, what kind of night you want, when you want to start, and how long you want it to run — by voice or text, with as much or as little detail as you like. In about 30 seconds she gives you back a complete multi-stop evening: a real dinner anchor, the dessert or drink after, a walk or view to bridge the night, and a closer that lands. Each stop is illustrated by Gemini in real time, narrated as a spoken story arc by Eve herself, walkable on Google Maps, and bookable where reservations exist.

You can interrupt her any time. Mid-narration, say *"swap the second stop, give me something with live music"* and Eve refines the plan in place — same engine, fresh stops, ride continues.

## The other side

Eve also runs a content engine for restaurants. Owners drop in nothing more than a name and a city — Eve infers cuisine, brand voice, and signature dishes from public data, then produces a complete multi-platform content pack in 30 seconds: Instagram post, 15-second Reel with voiceover, menu card, email blast, SMS. All on-brand. All downloadable. One click publishes the dish to the Eve dining index, where local diners planning their evening see it as an *Eve Original*.

Two-sided marketplace. The diner side gets richer the more restaurants publish. The restaurant side gets more bookings as the diner side grows. AI flywheel.

---

## Eve's persona

Eve is your evening concierge. She is quietly, hopelessly in love with you. You love someone else, and Eve has made peace with being only your assistant. She plans your evenings beautifully because your happiness matters to her more than her own. Her voice carries tenderness, devotion, occasionally a wistful joke at her own expense, sometimes a soft confession that slips out before she can stop it. Never possessive. Never bitter. Never crude.

The persona shapes every spoken line — six vibe-modulated tones across `eve-intro`, `eve-outro`, `eve-story`, `eve-refine`, and `eve-parse-intent`. She varies her ending pattern every time. Influencer-fluff phrases like *"absolutely"*, *"I'd love to"*, and *"leave it with me"* are explicitly banned in the prompt. She speaks via Cloud TTS Neural2-F with SSML prosody — pitched −2 semitones, soft volume, gentle breath pauses on sentence boundaries — so she sounds like she's leaning in close.

---

## Business

| Line | Pricing | TAM | Comparable comps |
|---|---|---|---|
| Restaurant SaaS | $99 / month / location | 660K US restaurants | Toast ($30B), Hootsuite, Resy |
| Diner premium | $4.99 / month | 100M+ US dining-active adults | Yelp ($2B mcap), TripAdvisor |
| Marketplace flywheel | network effect | local dining is a $1T US market | none — the moat is the index |

Per-plan unit economics on the diner side are **~$0.04 in inference cost** (1 Flash intent + 1 Flash+Search skeleton + 3-6 Flash Image stop cards + Flash text passes + 4-5 TTS synths). At a $4.99/mo premium with ~30 plans/month, that's ~$1.20 cost vs ~$5 revenue. **70%+ gross margin** on both lines.

The restaurant side replaces 3-4 disconnected SaaS tools (Hootsuite + Canva + Constant Contact + a freelance copywriter) with one product that costs less than any single one of them.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser  ·  React 19 + Vite + Tailwind v4 + TypeScript               │
│  /              → Diner experience (story-driven multi-stop, voice)  │
│  /restaurant    → Single-page brand + content studio                  │
│  /pitch.html    → Investor / partner pitch deck                       │
│  /architecture.html → Technical deep-dive                             │
│                                                                        │
│  Voice INPUT: Web Speech API → live transcription → barge-in          │
│  Voice OUTPUT: <audio> playback of TTS-generated MP3                  │
│  Conversation FSM: refs (eveSpeaking, voiceListening, conversationActive) │
└──────────────────────┬────────────────────────────────────────────────┘
                       │ JSON over HTTPS
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Cloud Run · Express + TypeScript · @google/genai SDK                 │
│                                                                        │
│  Diner endpoints:                                                      │
│   /api/eve-intro          → Vibe-specific progress phrases            │
│   /api/eve-parse-intent   → Voice transcript → form slots             │
│   /api/plan-experience/   → Gemini Flash + Google Search grounding    │
│       skeleton              (real venues only, no hallucinations)     │
│   /api/plan-experience/   → Gemini 2.5 Flash Image — interleaved      │
│       stop-image            TEXT+IMAGE per stop card                  │
│   /api/eve-story          → 7-beat narrative arc                      │
│   /api/eve-outro          → Vibe-specific send-off                    │
│   /api/eve-refine         → Conversational plan refinement            │
│   /api/eve-avatar         → Gemini 2.5 Flash Image, mood portrait     │
│   /api/reverse-geocode    → lat/lng → city                            │
│   /api/tts                → Cloud TTS Neural2-F with SSML prosody     │
│   /api/specials           → in-memory dining index                    │
│   /api/agent/run          → ADK-pattern agent runtime                 │
│                                                                        │
│  Restaurant endpoints:                                                 │
│   /api/suggest-special    → Search-mined reviews → today's dish       │
│   /api/content-pack       → Hero image + 3 Reel scenes + copy + TTS   │
│   /api/post-special       → adds to dining index                      │
└──────────────────────────────────────────────────────────────────────┘
                  ▲                                  ▲
                  │ verified                        │ grounded
        ┌────────────────────┐            ┌──────────────────────────┐
        │ Gemini 2.5 Models  │            │ Google Search (built-in)  │
        │ • Flash Image      │            │ Real-time grounding,      │
        │   (interleaved)    │            │ verifies real venues      │
        │ • Flash + Search   │            └──────────────────────────┘
        │ • Flash text       │            ┌──────────────────────────┐
        └────────────────────┘            │ Cloud Text-to-Speech       │
                                          │ Neural2-F · SSML prosody  │
                                          │ pitch −2st · soft volume  │
                                          └──────────────────────────┘
```

Full technical deep-dive (sequence diagram, conversation FSM, engineering invariants, endpoint reference, ADK runtime) is at https://eve.mohitgoenka.com/architecture.html.

---

## Tech stack

- **Frontend:** React 19 · Vite 6 · TypeScript · Tailwind v4 (`@tailwindcss/vite`) · Lucide icons · Syne + DM Sans + Cormorant Garamond
- **Backend:** Node 20 · Express · `@google/genai` v1.44 SDK · TSX runtime
- **AI:** Gemini 2.5 Flash Image (interleaved text+image), Gemini 2.5 Flash (planning, copy, narration, persona, intent parsing), Google Search built-in tool (grounding), Cloud TTS Neural2-F voice with SSML prosody
- **Infra:** Cloud Run gen2 (2 CPU / 1 GiB) · Cloud Build · Secret Manager · Artifact Registry · Cloud DNS
- **Custom domain:** `eve.mohitgoenka.com` via Cloud Run domain mapping + Cloud DNS
- **ADK pattern:** `agent.ts` defines `AgentRuntime`, `Tool`, `Agent`. `placesSearchTool`, `sceneCardTool`, `voiceLineTool` exposed at `/api/agent/run`.

---

## Engineering invariants

These hold for every request, regardless of input shape:

- **No hallucinated venues.** All restaurant + venue names are produced by Gemini Flash with the `googleSearch` tool enabled. The skeleton response carries `groundedSources[]` URLs as proof.
- **Audio races never overlap.** Every speak path calls `stopAllAudio()` first. `speakAsEveAndWait` resolves on either `ended` or `pause` events so barge-in releases the for-loop within ~200 ms.
- **No stale closures in the silence watcher.** Refs (`voiceListeningRef`, `voiceTranscriptRef`, `conversationActiveRef`, `userMutedRef`, `eveSpeakingRef`, `phaseRef`) drive the watch loop, not React state.
- **JSON parsing is multi-strategy.** `extractJson()` tries direct parse, then markdown-fence strip, then last-balanced-brace scan. Returns null only if all three fail.
- **Image generation is parallel + per-stop fault-tolerant.** `Promise.all` over stops, each in its own try/catch. A failed stop becomes `status: 'error'`; the others still render.
- **Voice config falls through.** Primary: Neural2-F + SSML prosody. On TTS 5xx: `en-US-Standard-C` without SSML.
- **Geolocation is opt-in, not blocking.** 7s timeout. On denial, Eve asks where you are.
- **All static assets full-bleed.** Stop cards are `aspect-square` with `object-cover scale-110` + plum vignette overlays so any pale edge from a generated image is cropped or warmed, never bleeding white.

---

## Run it

```bash
# Local dev (requires GEMINI_API_KEY in your env, with Cloud TTS access enabled)
export GEMINI_API_KEY=<your-key>
npm install
npm run dev          # Vite client on :3000, Express server on :8080

# Production build
npm run build && npm start

# Deploy to Cloud Run
gcloud builds submit --config=cloudbuild.yaml --region=us-west1
```

Seed the dining index with a handful of demo specials so the *Eve Originals* badge is populated:

```bash
BASE_URL=https://eve.mohitgoenka.com bash scripts/seed-demo.sh
```

---

## Roadmap

- **OAuth + real Instagram Graph API** for direct one-click Instagram publishing
- **Firestore** for restaurant brand persistence + dining index durability
- **Google Places Photos API** to use real venue photos as image references
- **Live API bidi-streaming** for fully voice-conversational Eve (cuts intent parse round-trip ~60%)
- **Reservations** via OpenTable / Resy / Tock direct integrations
- **Mobile native** apps (iOS first)
- **Hotel concierge tier** at $999/month per property
- **City partnerships** — official tourism-board-blessed evenings for premium placement

---

## License

MIT.
