import type {
  Vibe,
  DietaryPreference,
  ExperienceStop,
  StopKind,
  Cuisine,
  ContentPack,
  PostedSpecial,
} from '@/types';

export interface PlanSkeletonRequest {
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetUSD: number;
  freeText: string;
  cuisinePref?: string;
}

export interface PlanSkeletonResponse {
  title: string;
  stops: Array<Omit<ExperienceStop, 'status' | 'imageData' | 'imageMime' | 'error'>>;
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
