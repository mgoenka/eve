# Recording Eve's 90-Second Demo Video — Backup for the Pitch

> **Goal:** A 90-sec QuickTime screen recording you can play if the venue Wi-Fi flakes or any live API misbehaves during your 5-min pitch.

## Setup (60 seconds before recording)

1. **Two browser tabs open** in Chrome:
   - Tab A: https://eve.mohitgoenka.com/ (Diner side, fresh form)
   - Tab B: https://eve.mohitgoenka.com/restaurant (Restaurant side, brand pre-set to Saffron Garden)

2. **Pre-warm the demo data** (critical — Cloud Run may have cold-started since seeding):

   ```bash
   bash /Users/mgoenka/Dev/eve/scripts/seed-demo.sh
   ```

3. **Start screen recording** with QuickTime: `Cmd+Shift+5` → "Record Selected Portion" → drag over the browser window only.

4. **Audio**: include built-in mic so the Eve narration audio is captured cleanly. *Don't* speak over it during recording.

## The 90-second walkthrough

### Beat 1 — Diner side hook (0:00–0:08, 8 sec)
- Tab A is open showing the form
- Click **"Try: Date night in Santa Clara, vegetarian"**
- Click **"Plan my night"**

### Beat 2 — Eve plans live (0:08–0:30, 22 sec)
- Page transitions to forging view
- Three illustrated venue cards stream in (one at a time, ~6 sec apart)
- "Grounded via Google Search · X sources verified" badge appears under the title
- Each card shows: AI illustration, stop number, kind, name, vibe, signature item
- The Saffron Garden card on Stop 1 has the gold-pink **Eve Original** badge

### Beat 3 — Voice tour plays (0:30–0:55, 25 sec)
- A narration card appears below with a glowing play button
- *Click play*
- Eve's voice begins narrating the night
- Let it play for ~20 seconds (covers the whole 100-word monologue)

### Beat 4 — Switch to restaurant side (0:55–1:00, 5 sec)
- Switch to Tab B
- Restaurant brand is pre-set to Saffron Garden (visible in header)

### Beat 5 — Restaurant generates content pack (1:00–1:30, 30 sec)
- Click **"Generate the pack"** with `Paneer Butter Masala` as dish
- Wait ~25 seconds for content pack to materialize:
  - Instagram post with AI hero image and caption
  - 3-scene Reel with images and voiceover audio
  - Menu card with brand-voiced description and price
  - Email + SMS

### Beat 6 — Closing (1:30–1:30, no extra time, end at 90)
- Click **"Publish to Eve diners"**
- Confirmation flips to "Live on Eve tonight"
- Stop recording

## Save and prepare for pitch

- Save the recording to your desktop as `eve-demo.mp4`
- AirDrop or upload to a backup location (Google Drive, iCloud)
- Test playback before leaving for the venue

## Pitch-time fallback

If you decide to play the recording instead of doing live demo:

> *"I built this in 4 hours, solo, today. Rather than risk Wi-Fi at the museum, here's a 90-second recording of the live system. You're watching real Gemini calls, real Cloud TTS, real Google Search grounding. Live URL is eve.mohitgoenka.com — happy to run it again post-pitch."*

Then play the recording. After it ends, immediately go to pitch deck Slide 4 (architecture) and finish the pitch.

## Quality checks before saving

- [ ] Recording is exactly under 95 seconds
- [ ] All three diner stop images load (no broken/empty cards)
- [ ] Narration audio is audible
- [ ] Restaurant content pack shows 4 distinct deliverables clearly
- [ ] No browser dev tools or Cursor windows visible
