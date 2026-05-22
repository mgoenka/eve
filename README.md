# Eve — Plan Your Night

> The AI evening concierge that plans your night end-to-end and gives every restaurant the marketing team they never had. Built for **Google I/O Build with AI Hackathon 2026** at the Computer History Museum, Mountain View.

**Live:** https://eve.mohitgoenka.com

## What Eve does

Eve is one app with two coupled experiences that feed each other:

### For diners (`/`)

You tell Eve where you are, the vibe (date night, celebrating, casual…), party size, dietary preferences, and a free-form wish ("dinner, dessert nearby, garden walk under stringlights"). In ~30 seconds Eve generates a complete three-stop evening:

- **Stop 1**: Dinner anchor with AI-illustrated venue card
- **Stop 2**: Dessert / drinks / activity that escalates the vibe
- **Stop 3**: The closer — walk, view, live music, or quiet spot
- **Eve's voice tour**: a calm, ~100-word narration that talks the diner through their night, generated via Cloud Text-to-Speech (Chirp 3 HD)
- **Eve Originals badge** appears on stops where a Plate-listed restaurant has posted tonight's special

### For restaurants (`/restaurant`)

Restaurants sign up once (cuisine, voice, signature dishes — 60-second setup). Then every night, the owner drops in tonight's special and Eve generates a complete multi-platform content pack:

- **Instagram post** — AI-generated hero food image (Gemini 2.5 Flash Image, interleaved) + on-brand caption + hashtags
- **15-second Reel** — three storyboarded scenes with images + voiceover script + AI narrated audio (Cloud TTS)
- **Menu card** — name, brand-voiced description, suggested price, allergen tags
- **Email blast** — subject + HTML body
- **SMS blurb** — under 155 chars

Every asset is downloadable and brand-consistent. **Publishing also pushes the dish into the Eve dining index**, so diners planning their night that evening see the special with an "Eve Original" badge.

This is the flywheel: restaurants get free marketing horsepower **and** distribution to nearby diners. Diners get fresh, accurate, multimodal recommendations no other app has.

## Why this for the hackathon

Built for the **Creative Storyteller** track. Hits all three industry bonus categories:

- **Future of Work** — restaurant marketing automation, document/content synthesis, agentic workflow
- **Creativity** — AI dish photography, illustrated venue cards, brand-voiced copywriting
- **Media & Entertainment** — interactive media interface, dynamic audio assistant, smart content recommendation

Mandatory tech ✓:
- **Gemini 2.5 Flash Image** with `responseModalities: ['TEXT', 'IMAGE']` — interleaved text + image generation per venue card and per Reel scene
- **Hosted on Google Cloud** (Cloud Run, `us-west1`)
- **Google GenAI SDK** (`@google/genai`)

Plus **Cloud Text-to-Speech** (Chirp 3 HD) for the diner narration and the Reel voiceover.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser  ·  React 19 + Vite + Tailwind v4 + Inter/Cormorant │
│  /         = Diner experience builder                         │
│  /restaurant = Restaurant content pack studio                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloud Run · Express server (TypeScript via tsx)              │
│                                                                │
│  /api/plan-experience/skeleton  → Gemini text JSON            │
│  /api/plan-experience/stop-image → Gemini 2.5 Flash Image     │
│                                    (interleaved text + image)  │
│  /api/plan-experience/narration → Gemini text                 │
│  /api/content-pack              → orchestrates 3 Gemini calls │
│                                    (copy text, hero image,    │
│                                     reel scenes×3 images)     │
│  /api/post-special              → in-memory dining index      │
│  /api/specials                  → diner side reads index      │
│  /api/tts                       → Cloud Text-to-Speech REST   │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Google AI APIs                                                │
│  • Gemini 2.5 Flash Image (interleaved generation)             │
│  • Gemini Flash Latest (planning, copywriting, narration)      │
│  • Cloud Text-to-Speech (Chirp 3 HD voice)                     │
└──────────────────────────────────────────────────────────────┘
```

## Stack

- **Frontend**: React 19, Vite 6, Tailwind v4 (`@tailwindcss/vite`), TypeScript, Lucide icons
- **Backend**: Node 20, Express, `@google/genai` SDK, TSX runtime (no transpile step)
- **Infra**: Cloud Run (gen2, 2 CPU / 1 GiB), Artifact Registry, Cloud Build
- **Secrets**: Single `GEMINI_API_KEY` from Secret Manager (used for both Gemini API and Cloud TTS REST)

## The two demos that win Round 1

**Demo 1 — Diner side (60 sec)**
1. Open `eve.mohitgoenka.com`
2. Click "Try: Date night in Santa Clara, vegetarian"
3. Hit "Plan my night"
4. Watch three illustrated venue cards stream in over ~30 seconds
5. Hit play on Eve's narration. A warm voice walks through the night.

**Demo 2 — Restaurant side (45 sec)**
1. Switch to `/restaurant`
2. Brand is pre-filled as Saffron Garden, Santa Clara, Indian, vegetarian
3. Tonight's dish: "Paneer Butter Masala"
4. Hit "Generate the pack"
5. Watch Instagram hero image, Reel storyboard with 3 AI scenes + voiceover, menu card, email, SMS all materialize
6. Click "Publish to Eve diners" — restaurant is now in tonight's diner index
7. Switch back to `/`, run the diner query again — Saffron Garden now appears with an "Eve Original" badge

That's the flywheel demo, live, in two minutes.

## Team

- **Mohit Goenka** — solo founder, built end-to-end. Director of Engineering at Yahoo Mail, 110+ patents, 12 production AI apps shipped. Recipe.mohitgoenka.com (50K+ visits) was the V1 prototype that informed Eve.

## Local development

```bash
export GEMINI_API_KEY=<your-key-here>
npm install
npm run dev   # vite client on :3000, express server on :8080 (with proxy)
```

## Deploy

```bash
gcloud builds submit --config=cloudbuild.yaml --region=us-west1 --project=<your-project>
```

Custom domain mapping for `eve.mohitgoenka.com` is configured via Cloud Run domain mappings against the `mohitgoenka.com` Cloud DNS zone.

## What's next (post-hackathon)

- **OAuth + Google Maps** — replace paste-in restaurant brand with real signup; integrate live Maps for walking distance + drive routing
- **Restaurant subscription** — $99/mo per location, bulk tier for chains
- **Diner premium** — $4.99/mo for unlimited regenerations + saved nights + early access to Eve Original specials
- **Tourism board partnerships** — white-label per-city Eve for tourism websites
- **Reservation integration** — OpenTable / Resy / Tock affiliate booking

## License

MIT — built in 4 hours for the love of it.
