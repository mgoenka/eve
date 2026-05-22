import type {
  Vibe,
  DietaryPreference,
  ExperienceStop,
  StopKind,
  Cuisine,
  ContentPack,
  PostedSpecial,
  EveStory,
} from '@/types';

export interface PlanSkeletonRequest {
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetPerPersonUSD: number;
  freeText: string;
  cuisinePref?: string;
  whenISO?: string;
}

export interface PlanSkeletonResponse {
  title: string;
  stops: Array<Omit<ExperienceStop, 'status' | 'imageData' | 'imageMime' | 'error'>>;
  groundedSearchUsed?: boolean;
  groundedSources?: string[];
}

export async function planSkeleton(req: PlanSkeletonRequest): Promise<PlanSkeletonResponse> {
  const res = await fetch('/api/plan-experience/skeleton', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Skeleton failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as PlanSkeletonResponse;
}

export interface StopImageRequest {
  name: string;
  kind: StopKind;
  oneLineVibe: string;
  city: string;
  vibe: Vibe;
}

export async function stopImage(req: StopImageRequest): Promise<{ imageData: string; imageMime: string }> {
  const res = await fetch('/api/plan-experience/stop-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Stop image failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { imageData: string; imageMime: string };
}

export interface NarrationRequest {
  title: string;
  stops: ExperienceStop[];
  vibe: Vibe;
}

export async function narrationText(req: NarrationRequest): Promise<{ narration: string }> {
  const res = await fetch('/api/plan-experience/narration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Narration failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { narration: string };
}

export async function synthesize(
  text: string,
  voiceMode: 'eve' | 'reel' = 'eve'
): Promise<{ audioData: string; audioMime: string }> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceMode }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { audioData: string; audioMime: string };
}

export interface ContentPackRequest {
  dishName: string;
  dishDescription: string;
  restaurantName: string;
  cuisine: Cuisine;
  voice: string;
  city: string;
  signatureDishes: string;
}

export async function generateContentPack(req: ContentPackRequest): Promise<ContentPack> {
  const res = await fetch('/api/content-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Content pack failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ContentPack;
}

export async function postSpecial(input: {
  restaurantName: string;
  city: string;
  cuisine: Cuisine;
  dishName: string;
  caption: string;
  imageData?: string;
  imageMime?: string;
}): Promise<{ ok: boolean; id: string }> {
  const res = await fetch('/api/post-special', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Post special failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { ok: boolean; id: string };
}

export async function listSpecials(city?: string): Promise<{ specials: PostedSpecial[] }> {
  const url = city ? `/api/specials?city=${encodeURIComponent(city)}` : '/api/specials';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`List specials failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { specials: PostedSpecial[] };
}

export async function eveIntro(input: {
  vibe: string;
  city: string;
  party: number;
  freeText: string;
}): Promise<{ intro: string; lines: string[] }> {
  const res = await fetch('/api/eve-intro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Intro failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { intro: string; lines: string[] };
}

export async function eveOutro(input: {
  vibe: string;
  city: string;
  stops: Array<{ name: string; kind: string }>;
}): Promise<{ outro: string }> {
  const res = await fetch('/api/eve-outro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Outro failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { outro: string };
}

export async function eveStory(input: {
  title: string;
  stops: Array<{ name: string; kind: string; oneLineVibe: string; signatureItem?: string }>;
  vibe: string;
  city: string;
  party: number;
}): Promise<EveStory> {
  const res = await fetch('/api/eve-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Story failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as EveStory;
}

export interface EveRefineResponse {
  spokenReply: string;
  title: string;
  stops: Array<{
    kind: string;
    name: string;
    oneLineVibe: string;
    whyThisFits: string;
    approxArrival: string;
    durationMinutes: number;
    walkMinutesFromPrev: number;
    signatureItem?: string;
    isEveOriginal?: boolean;
  }>;
}

export async function eveRefine(input: {
  message: string;
  previousPlan: { stops: Array<{ name: string; kind: string; oneLineVibe?: string }> };
  vibe: string;
  city: string;
  dietary: string[];
  party: number;
  budgetUSD: number;
}): Promise<EveRefineResponse> {
  const res = await fetch('/api/eve-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Refine failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as EveRefineResponse;
}

export interface SuggestSpecialResponse {
  mode: 'from_reviews' | 'from_trending';
  dishName: string;
  dishDescription: string;
  rationale: string;
  alternatives: Array<{ dishName: string; rationale: string }>;
  recommendedRestaurants: Array<{ name: string; city: string; dish: string; why: string }>;
  usedSearch?: boolean;
}

export async function suggestSpecial(input: {
  restaurantName: string;
  city: string;
  cuisine: string;
  signatureDishes: string;
}): Promise<SuggestSpecialResponse> {
  const res = await fetch('/api/suggest-special', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Suggest failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as SuggestSpecialResponse;
}

export async function eveAvatar(
  mood: 'devoted' | 'listening' | 'speaking' | 'thinking' | 'longing' = 'devoted'
): Promise<{ imageData: string; imageMime: string }> {
  const res = await fetch('/api/eve-avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood }),
  });
  if (!res.ok) throw new Error(`Avatar failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { imageData: string; imageMime: string };
}

export async function reverseGeocode(lat: number, lng: number): Promise<{ city: string }> {
  const res = await fetch('/api/reverse-geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`Geocode failed: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { city: string };
}
