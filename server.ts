import express from 'express';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { CUISINES, VIBES, DIETARY_PREFERENCES, DEMO_RESTAURANTS } from './constants';
import type { PostedSpecial } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const PORT = parseInt(process.env.PORT || '8080', 10);

const TEXT_MODEL = 'gemini-flash-latest';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const app = express();
app.use(compression());
app.use(express.json({ limit: '12mb' }));

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY: not set — /api/* will return 503');
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const POSTED_SPECIALS: PostedSpecial[] = [];

function jsonError(res: express.Response, code: number, message: string) {
  res.status(code).json({ error: message });
}

function clean(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeParseJson<T = any>(text: string): T | null {
  try {
    return JSON.parse(clean(text)) as T;
  } catch {
    return null;
  }
}

function imagePart(mimeType: string, data: string) {
  return { inlineData: { mimeType, data } };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: !!GEMINI_API_KEY });
});

app.get('/api/specials', (req, res) => {
  const cityFilter = (req.query?.city || '').toString().toLowerCase();
  const list = cityFilter
    ? POSTED_SPECIALS.filter((s) => s.city.toLowerCase().includes(cityFilter))
    : POSTED_SPECIALS;
  res.json({ specials: list.slice(-20) });
});

app.post('/api/plan-experience/skeleton', async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const city: string = (req.body?.city || '').trim();
  const vibe: string = (req.body?.vibe || 'date_night').trim();
  const party: number = Number(req.body?.party) || 2;
  const dietary: string[] = req.body?.dietary || [];
  const budgetUSD: number = Number(req.body?.budgetUSD) || 200;
  const freeText: string = (req.body?.freeText || '').trim();
  const cuisinePref: string = (req.body?.cuisinePref || '').trim();

  if (!city) return jsonError(res, 400, 'city required');

  const dietaryStr = dietary.length ? dietary.join(', ') : 'no specific restrictions';
  const vibeMeta = VIBES.find((v) => v.id === vibe) || VIBES[0];
  const cuisineLine = cuisinePref ? `Preferred cuisine for the dinner anchor: ${cuisinePref}.` : '';

  const specialsHints = POSTED_SPECIALS.filter((s) =>
    s.city.toLowerCase().includes(city.toLowerCase().split(',')[0])
  )
    .slice(-5)
    .map(
      (s) =>
        `- ${s.restaurantName} (${s.cuisine}) is offering "${s.dishName}" tonight: ${s.caption.slice(0, 120)}`
    )
    .join('\n');

  const prompt = `You are Eve, an AI evening concierge. Plan a complete 3-stop evening experience for the user.

City / area: ${city}
Vibe: ${vibeMeta.label} — ${vibeMeta.hint}
Party size: ${party}
Dietary preferences: ${dietaryStr}
Budget for the night: ~$${budgetUSD} total
User's freeform wish: "${freeText}"
${cuisineLine}

${specialsHints ? `Restaurants currently posted on Eve in this area you should consider as the dinner anchor when they fit:\n${specialsHints}\n` : ''}

Plan exactly 3 stops that flow naturally for this vibe. The first stop is always the dinner anchor. Stops 2 and 3 should escalate the experience: dessert, drinks, a walk, a view, live music, an activity, etc. — whatever fits the vibe.

CRITICAL RULES:
- Stops must be in the same neighborhood / walkable distance OR a short drive.
- Honor dietary preferences strictly for any food/drink stops.
- Stay within budget.
- For each venue, use a plausible, specific name appropriate to the city. Do NOT make up addresses or hours.
- If an Eve-posted restaurant fits the dinner anchor naturally, USE IT and set isEveOriginal: true. Otherwise generate a plausible specific name and set isEveOriginal: false.
- Use distinct stop kinds — never repeat the same kind twice in one plan.

Return strict JSON only:
{
  "title": "short evocative title for the night (max 7 words)",
  "stops": [
    {
      "kind": "dinner" | "dessert" | "drink" | "walk" | "live_music" | "view" | "activity",
      "name": "specific venue name",
      "oneLineVibe": "one sentence capturing the venue's atmosphere (max 18 words)",
      "whyThisFits": "one sentence on why this stop fits this user's vibe and constraints (max 22 words)",
      "approxArrival": "e.g. 6:30 PM",
      "durationMinutes": 60,
      "walkMinutesFromPrev": 0,
      "signatureItem": "specific dish, drink, or thing to order/do here",
      "isEveOriginal": false
    },
    ...3 stops total
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { temperature: 0.85, topP: 0.92 },
    });
    const parsed = safeParseJson(response.text || '');
    if (!parsed) return jsonError(res, 502, 'Model returned non-JSON skeleton');
    res.json(parsed);
  } catch (err: any) {
    console.error('plan-experience/skeleton failed:', err?.message || err);
    jsonError(res, 500, `Skeleton failed: ${err?.message || 'unknown'}`);
  }
});

app.post('/api/plan-experience/stop-image', async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const name: string = (req.body?.name || '').trim();
  const kind: string = (req.body?.kind || 'dinner').trim();
  const oneLineVibe: string = (req.body?.oneLineVibe || '').trim();
  const city: string = (req.body?.city || '').trim();
  const vibe: string = (req.body?.vibe || 'date_night').trim();
  const accent: string = (req.body?.accent || '').trim();

  if (!name) return jsonError(res, 400, 'name required');

  const styleByVibe: Record<string, string> = {
    date_night:
      'cinematic dusk lighting, soft warm bokeh, candle-glow palette, rich plum and amber tones, intimate atmosphere',
    celebrating:
      'rich golden-hour light, festive but elegant, sparkling highlights, deep jewel-tone palette',
    casual:
      'natural daylight, lived-in warmth, relaxed and unstyled, neutral comforting palette',
    family:
      'bright cheerful afternoon light, warm wood tones, welcoming and unstaged',
    friends:
      'electric evening light, social energy, vivid color, slightly cinematic',
    solo:
      'still soft light, calm muted palette, contemplative composition, one perfect detail in focus',
  };
  const visualStyle = styleByVibe[vibe] || styleByVibe.date_night;

  const kindStyle: Record<string, string> = {
    dinner:
      'Hero food/restaurant scene: a plated signature dish on a beautifully set table, restaurant interior softly out of focus behind it.',
    dessert:
      'A close-in dessert moment: a single beautifully composed dessert with steam, drizzle, or texture detail visible.',
    drink:
      'A poured cocktail or glass of wine on a polished bar, with the venue\'s ambient backdrop softly visible.',
    walk:
      'A walkable outdoor scene: pathway, garden lights, urban street with golden lamps, or waterfront under twilight.',
    live_music:
      'A music venue interior: stage softly lit, instruments visible, audience silhouettes, warm spotlight.',
    view:
      'A scenic vantage: rooftop, hilltop, bridge, or shoreline view at golden hour or dusk, city lights twinkling.',
    activity:
      'A scene capturing the activity itself: bookstore, gallery, observatory, arcade, etc. Composed editorially.',
  };
  const sceneStyle = kindStyle[kind] || kindStyle.dinner;

  const prompt = `Create an editorial-style illustration for a venue card on a date-night planning app.

Venue: ${name}, in ${city}
Vibe descriptor: "${oneLineVibe}"
Stop kind: ${kind}

${sceneStyle}

Visual style: ${visualStyle}. Photoreal but slightly painterly, like a high-end magazine spread (Bon Appetit, Cereal Magazine). NO text in the image. NO logos. NO watermarks. NO captions. Single composed scene, no collage. Square aspect ratio framing.`;

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    let imageData: string | undefined;
    let imageMime: string | undefined;
    for (const p of parts as Array<any>) {
      if (p?.inlineData?.data && p?.inlineData?.mimeType) {
        if (!imageData) {
          imageData = p.inlineData.data;
          imageMime = p.inlineData.mimeType;
        }
      }
    }
    if (!imageData) return jsonError(res, 502, 'No image returned');
    res.json({ imageData, imageMime });
  } catch (err: any) {
    console.error('stop-image failed:', err?.message || err);
    jsonError(res, 500, `Stop image failed: ${err?.message || 'unknown'}`);
  }
});

app.post('/api/plan-experience/narration', async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const title: string = (req.body?.title || '').trim();
  const stops: any[] = req.body?.stops || [];
  const vibe: string = (req.body?.vibe || 'date_night').trim();
  const vibeMeta = VIBES.find((v) => v.id === vibe) || VIBES[0];

  if (!stops.length) return jsonError(res, 400, 'stops required');

  const stopsText = stops
    .map(
      (s, i) =>
        `Stop ${i + 1} — ${s.kind?.toUpperCase()} at ${s.name}, ${s.approxArrival}: ${s.oneLineVibe} ${s.whyThisFits}`
    )
    .join('\n');

  const prompt = `You are Eve's voice. Write a single calm, warm, slightly cinematic monologue narrating the user's planned night out as if walking them through it before they leave the house. About 90-120 words total. No headings. No "stop one / stop two." Smooth transitions. Sound like a knowing concierge speaking directly to the user. Vibe of the night: ${vibeMeta.label} — ${vibeMeta.hint}.

Plan title: "${title}"

Plan stops:
${stopsText}

Write the monologue in plain prose suitable for text-to-speech. Use natural pauses (commas and periods). End with a short, warm send-off line. Output ONLY the monologue text, no commentary.`;

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: { temperature: 0.7 },
    });
    const text = (response.text || '').trim();
    res.json({ narration: text });
  } catch (err: any) {
    console.error('narration failed:', err?.message || err);
    jsonError(res, 500, `Narration failed: ${err?.message || 'unknown'}`);
  }
});

app.post('/api/content-pack', async (req, res) => {
  if (!ai) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const dishName: string = (req.body?.dishName || '').trim();
  const dishDescription: string = (req.body?.dishDescription || '').trim();
  const restaurantName: string = (req.body?.restaurantName || '').trim();
  const cuisine: string = (req.body?.cuisine || 'fusion').trim();
  const voice: string = (req.body?.voice || '').trim();
  const city: string = (req.body?.city || '').trim();
  const signatureDishes: string = (req.body?.signatureDishes || '').trim();

  if (!dishName || !restaurantName) {
    return jsonError(res, 400, 'dishName and restaurantName required');
  }

  const sharedContext = `Restaurant: ${restaurantName} (${cuisine}, ${city})
Brand voice: ${voice || 'warm, specific, ingredient-led'}
Signature dishes: ${signatureDishes}
Tonight's dish: "${dishName}"
Description: ${dishDescription || 'No description provided.'}`;

  const copyPrompt = `${sharedContext}

Generate marketing copy across 4 channels for tonight. Stay in the brand voice. Be specific about ingredient or technique cues — never generic praise. Strict JSON only:
{
  "instagram": {
    "caption": "Instagram caption, 100-200 chars, brand voice, ingredient-led, 1-2 line breaks ok, NO hashtags inside",
    "hashtags": ["6-10 specific hashtags as bare words without # prefix"]
  },
  "menuCard": {
    "name": "menu-style name (sometimes the same as the dish, sometimes a brand-voiced version)",
    "description": "menu-style 1-2 sentence description, ingredient-led, max 35 words",
    "suggestedPrice": "e.g. \\"$18\\"",
    "allergenTags": ["concise allergen/dietary tags like \\"vegetarian\\", \\"contains dairy\\", \\"gluten-free option\\""]
  },
  "email": {
    "subject": "subject line under 55 chars, evocative, no clickbait",
    "bodyHtml": "HTML email body in 2-3 short paragraphs. Use <p> tags. End with a CTA line. No images embedded."
  },
  "sms": "single SMS under 155 chars, warm and direct, includes the dish name"
}`;

  let copyData: any = null;
  try {
    const copyResp = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: copyPrompt,
      config: { temperature: 0.8 },
    });
    copyData = safeParseJson(copyResp.text || '');
    if (!copyData) return jsonError(res, 502, 'Model returned non-JSON copy');
  } catch (err: any) {
    console.error('content-pack/copy failed:', err?.message || err);
    return jsonError(res, 500, `Copy generation failed: ${err?.message || 'unknown'}`);
  }

  const heroImagePrompt = `Editorial food photography of "${dishName}" at ${restaurantName}, a ${cuisine} restaurant.
${dishDescription ? `Dish notes: ${dishDescription}` : ''}
Cinematic dusk-warm lighting, single hero plate composition, slightly overhead angle, rustic ceramic tableware, natural linens, one ingredient prop in soft focus background. Warm color palette appropriate to the cuisine. No text, no logos, no watermarks, no captions in the image. Square aspect ratio framing.`;

  const reelStoryPrompt = `${sharedContext}

Write a 15-second Instagram Reel storyboard with EXACTLY 3 short scenes that show this dish coming to life. Each scene must:
- Have a clear visual the camera shows
- Have a 4-8 word voiceover line
The voiceover lines should chain into ONE coherent 12-15 second monologue when read together.

Strict JSON only:
{
  "scenes": [
    {"description": "what the viewer sees in scene 1", "voiceover": "4-8 word voiceover line for scene 1"},
    {"description": "what the viewer sees in scene 2", "voiceover": "4-8 word voiceover line for scene 2"},
    {"description": "what the viewer sees in scene 3", "voiceover": "4-8 word voiceover line for scene 3"}
  ],
  "fullVoiceoverScript": "the three voiceover lines stitched into one fluid sentence for TTS"
}`;

  let reelData: any = null;
  try {
    const reelResp = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: reelStoryPrompt,
      config: { temperature: 0.85 },
    });
    reelData = safeParseJson(reelResp.text || '');
    if (!reelData) {
      reelData = {
        scenes: [
          { description: `Slow pan over ${dishName} on the table`, voiceover: 'Tonight at our table' },
          { description: 'Close-up of signature ingredient or texture', voiceover: 'A small thing made carefully' },
          { description: 'Hands lifting a fork or pouring sauce', voiceover: 'Save us a seat' },
        ],
        fullVoiceoverScript: `Tonight at our table. A small thing made carefully. Save us a seat.`,
      };
    }
  } catch {
    reelData = {
      scenes: [
        { description: `Slow pan over ${dishName} on the table`, voiceover: 'Tonight at our table' },
        { description: 'Close-up of signature ingredient', voiceover: 'A small thing made carefully' },
        { description: 'Hands lifting a fork', voiceover: 'Save us a seat' },
      ],
      fullVoiceoverScript: `Tonight at our table. A small thing made carefully. Save us a seat.`,
    };
  }

  let heroImageData: string | undefined;
  let heroImageMime: string | undefined;
  try {
    const heroResp = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: heroImagePrompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const parts = heroResp.candidates?.[0]?.content?.parts || [];
    for (const p of parts as Array<any>) {
      if (p?.inlineData?.data && p?.inlineData?.mimeType && !heroImageData) {
        heroImageData = p.inlineData.data;
        heroImageMime = p.inlineData.mimeType;
      }
    }
  } catch (err: any) {
    console.warn('hero image generation failed:', err?.message || err);
  }

  const sceneImages: { imageData?: string; imageMime?: string }[] = await Promise.all(
    (reelData.scenes || []).map(async (scene: any) => {
      try {
        const sceneResp = await ai.models.generateContent({
          model: IMAGE_MODEL,
          contents: `${sharedContext}\n\nScene from a 15-second Reel: ${scene.description}.\nEditorial food/restaurant photography style. Warm dusk light. No text in image. Square aspect ratio framing.`,
          config: { responseModalities: ['TEXT', 'IMAGE'] },
        });
        const parts = sceneResp.candidates?.[0]?.content?.parts || [];
        for (const p of parts as Array<any>) {
          if (p?.inlineData?.data && p?.inlineData?.mimeType) {
            return { imageData: p.inlineData.data, imageMime: p.inlineData.mimeType };
          }
        }
      } catch (err: any) {
        console.warn('reel scene image failed:', err?.message || err);
      }
      return {};
    })
  );

  const enrichedScenes = (reelData.scenes || []).map((s: any, i: number) => ({
    description: s.description,
    voiceover: s.voiceover,
    imageData: sceneImages[i]?.imageData,
    imageMime: sceneImages[i]?.imageMime,
  }));

  res.json({
    dishName,
    instagramPost: {
      caption: copyData?.instagram?.caption || '',
      hashtags: copyData?.instagram?.hashtags || [],
      imageData: heroImageData,
      imageMime: heroImageMime,
    },
    reel: {
      scenes: enrichedScenes,
      fullVoiceoverScript: reelData.fullVoiceoverScript || '',
    },
    menuCard: {
      name: copyData?.menuCard?.name || dishName,
      description: copyData?.menuCard?.description || '',
      suggestedPrice: copyData?.menuCard?.suggestedPrice || '',
      allergenTags: copyData?.menuCard?.allergenTags || [],
      imageData: heroImageData,
      imageMime: heroImageMime,
    },
    emailBlast: {
      subject: copyData?.email?.subject || '',
      bodyHtml: copyData?.email?.bodyHtml || '',
    },
    smsBlast: copyData?.sms || '',
  });
});

app.post('/api/post-special', (req, res) => {
  const restaurantName: string = (req.body?.restaurantName || '').trim();
  const city: string = (req.body?.city || '').trim();
  const cuisine: string = (req.body?.cuisine || 'fusion').trim();
  const dishName: string = (req.body?.dishName || '').trim();
  const caption: string = (req.body?.caption || '').trim();
  const imageData: string | undefined = req.body?.imageData;
  const imageMime: string | undefined = req.body?.imageMime;

  if (!restaurantName || !dishName || !city) {
    return jsonError(res, 400, 'restaurantName, dishName, city required');
  }
  const id = `${restaurantName}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const special: PostedSpecial = {
    id,
    restaurantName,
    city,
    cuisine: cuisine as any,
    dishName,
    caption,
    imageData,
    imageMime,
    postedAt: Date.now(),
  };
  POSTED_SPECIALS.push(special);
  if (POSTED_SPECIALS.length > 200) POSTED_SPECIALS.shift();
  res.json({ ok: true, id });
});

app.post('/api/tts', async (req, res) => {
  if (!GEMINI_API_KEY) return jsonError(res, 503, 'GEMINI_API_KEY not configured');

  const text: string = (req.body?.text || '').trim();
  const voiceMode: string = (req.body?.voiceMode || 'eve').trim();
  if (!text) return jsonError(res, 400, 'text required');

  const voiceName =
    voiceMode === 'reel' ? 'en-US-Chirp3-HD-Aoede' : 'en-US-Chirp3-HD-Aoede';

  const ttsBody = {
    input: { text: text.slice(0, 4500) },
    voice: { languageCode: 'en-US', name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: voiceMode === 'reel' ? 1.05 : 0.95,
      pitch: -0.5,
    },
  };

  try {
    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody),
      }
    );
    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('TTS upstream error:', ttsRes.status, errText);
      const fallbackBody = {
        ...ttsBody,
        voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
      };
      const fallbackRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackBody),
        }
      );
      if (!fallbackRes.ok) {
        const fallbackErr = await fallbackRes.text();
        return jsonError(res, 502, `TTS failed: ${fallbackErr.slice(0, 200)}`);
      }
      const fallbackJson = (await fallbackRes.json()) as { audioContent?: string };
      return res.json({ audioData: fallbackJson.audioContent || '', audioMime: 'audio/mpeg' });
    }
    const ttsJson = (await ttsRes.json()) as { audioContent?: string };
    res.json({ audioData: ttsJson.audioContent || '', audioMime: 'audio/mpeg' });
  } catch (err: any) {
    console.error('tts failed:', err?.message || err);
    jsonError(res, 500, `TTS failed: ${err?.message || 'unknown'}`);
  }
});

app.use(
  '/assets',
  express.static(path.join(__dirname, 'dist/assets'), { maxAge: '1y', immutable: true })
);
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Eve server on port ${PORT}`);
});
