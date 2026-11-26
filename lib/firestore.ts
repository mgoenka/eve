// Firestore client + persistence layer for the dining index and restaurant
// brand profiles. Falls back to an in-memory store if Firestore isn't
// configured (no GOOGLE_CLOUD_PROJECT or service account credentials),
// so local dev still works.

import type { Firestore } from '@google-cloud/firestore';

let dbPromise: Promise<Firestore | null> | null = null;

// The Firestore SDK (gRPC + protobufs) is heavy, so it is loaded on first use
// instead of at boot. That keeps Cloud Run cold starts fast.
function getDb(): Promise<Firestore | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    // Local testing without touching the production database.
    if (process.env.EVE_MEMORY_STORE === '1') return null;
    try {
      const { Firestore } = await import('@google-cloud/firestore');
      // Cloud Run automatically authenticates via the service account.
      // Locally, GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth
      // application-default login` works.
      return new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
        ignoreUndefinedProperties: true,
      });
    } catch (err: any) {
      console.warn('[firestore] not configured — falling back to in-memory:', err?.message || err);
      return null;
    }
  })();
  return dbPromise;
}

export interface PostedSpecialDoc {
  id?: string;
  restaurantName: string;
  city: string;
  cuisine: string;
  dishName: string;
  caption: string;
  imageData?: string;
  imageMime?: string;
  postedAtISO: string;
  views?: number;
  planInclusions?: number;
  clickThroughs?: number;
  /** sha256 of the owner key in the publishing browser's httpOnly cookie (lets that device delete it). Never sent to clients. */
  ownerKeyHash?: string;
  /** Posted from the device that connected this restaurant's Instagram (only these can be a plan's dinner anchor). */
  verified?: boolean;
}

export interface RestaurantBrandDoc {
  id?: string;            // restaurant brand id (slug or owner uid)
  ownerUid?: string;      // Firebase auth uid (set after auth)
  name: string;
  city: string;
  cuisine: string;
  voice: string;
  signatureDishes: string;
  instagramAccessToken?: string;
  instagramBusinessAccountId?: string;
  /** sha256 of the publish key held in the connecting browser's httpOnly cookie. */
  instagramPublishKeyHash?: string;
  /** sha256 of the owner key of the device that connected Instagram (account deletion). */
  ownerKeyHash?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid' | null;
  createdAtISO: string;
  updatedAtISO: string;
}

// In-memory fallback when Firestore isn't available. Bounded so a long Firestore
// outage (every write falling back here) can't grow the instance without limit.
const memorySpecials: PostedSpecialDoc[] = [];
const memoryBrands = new Map<string, RestaurantBrandDoc>();
const MEMORY_SPECIALS_MAX = 200;
const MEMORY_BRANDS_MAX = 500;
function pushMemorySpecial(s: PostedSpecialDoc) {
  memorySpecials.push(s);
  if (memorySpecials.length > MEMORY_SPECIALS_MAX) memorySpecials.splice(0, memorySpecials.length - MEMORY_SPECIALS_MAX);
}
function setMemoryBrand(id: string, b: RestaurantBrandDoc) {
  memoryBrands.delete(id);
  memoryBrands.set(id, b);
  if (memoryBrands.size > MEMORY_BRANDS_MAX) memoryBrands.delete(memoryBrands.keys().next().value!);
}

// Every plan request (and /api/specials) reads the latest ~200 specials. Cache that
// read for 60 s per instance; writes from this instance drop it at once. Other
// instances catch up within the TTL. Concurrent misses share one Firestore read.
// Specials carry their image, so an unusually large result isn't kept.
const SPECIALS_CACHE_LIMIT = 200;
const SPECIALS_CACHE_TTL_MS = 60_000;
const SPECIALS_CACHE_MAX_BYTES = 48 * 1024 * 1024;
let specialsCache: { at: number; docs: PostedSpecialDoc[] } | null = null;
let specialsInFlight: Promise<PostedSpecialDoc[]> | null = null;
let specialsGeneration = 0;

/** Drop the cached specials (call after any write to the specials collection). */
export function invalidateSpecialsCache() {
  specialsCache = null;
  specialsInFlight = null;
  specialsGeneration++;
}

// ---------- Specials (the dining index) ----------

/** Specials as they leave this module: never with the owner key hash. */
function publicSpecial({ ownerKeyHash: _owner, ...s }: PostedSpecialDoc): PostedSpecialDoc {
  return s;
}

async function querySpecials(d: Firestore, limit: number): Promise<PostedSpecialDoc[]> {
  const snap = await d
    .collection('specials')
    .orderBy('postedAtISO', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => publicSpecial({ id: doc.id, ...(doc.data() as PostedSpecialDoc) }));
}

/** The latest SPECIALS_CACHE_LIMIT specials, from the 60 s cache when fresh. */
function recentSpecialsCached(d: Firestore): Promise<PostedSpecialDoc[]> {
  if (specialsCache && Date.now() - specialsCache.at < SPECIALS_CACHE_TTL_MS) return Promise.resolve(specialsCache.docs);
  if (specialsInFlight) return specialsInFlight;
  const generation = specialsGeneration;
  const p = querySpecials(d, SPECIALS_CACHE_LIMIT)
    .then((docs) => {
      const bytes = docs.reduce((n, s) => n + (s.imageData?.length || 0) + (s.caption?.length || 0), 0);
      // A write while the read was in flight makes this result stale: don't keep it.
      if (generation === specialsGeneration && bytes <= SPECIALS_CACHE_MAX_BYTES) specialsCache = { at: Date.now(), docs };
      return docs;
    })
    .finally(() => {
      if (specialsInFlight === p) specialsInFlight = null;
    });
  specialsInFlight = p;
  return p;
}

export async function listSpecials(limit = 50): Promise<PostedSpecialDoc[]> {
  const d = await getDb();
  if (!d) return memorySpecials.slice(-limit).reverse().map(publicSpecial);
  try {
    if (limit <= SPECIALS_CACHE_LIMIT) return (await recentSpecialsCached(d)).slice(0, limit);
    return await querySpecials(d, limit);
  } catch (err: any) {
    console.warn('[firestore] listSpecials failed:', err?.message || err);
    return memorySpecials.slice(-limit).reverse().map(publicSpecial);
  }
}

export async function listSpecialsForCity(citySegment: string, limit = 25): Promise<PostedSpecialDoc[]> {
  const all = await listSpecials(200);
  const lower = citySegment.toLowerCase();
  return all
    .filter((s) => (s.city || '').toLowerCase().includes(lower))
    .slice(0, limit);
}

export async function addSpecial(s: PostedSpecialDoc): Promise<string> {
  const d = await getDb();
  const enriched: PostedSpecialDoc = {
    ...s,
    views: 0,
    planInclusions: 0,
    clickThroughs: 0,
    postedAtISO: s.postedAtISO || new Date().toISOString(),
  };
  if (!d) {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pushMemorySpecial({ ...enriched, id });
    return id;
  }
  try {
    const ref = await d.collection('specials').add(enriched);
    invalidateSpecialsCache();
    return ref.id;
  } catch (err: any) {
    console.warn('[firestore] addSpecial failed, falling back to memory:', err?.message || err);
    const id = `mem_${Date.now()}`;
    pushMemorySpecial({ ...enriched, id });
    return id;
  }
}

/** How many specials this device (owner key hash) posted since `sinceISO`, for the daily posting limit. */
export async function countOwnedSpecialsSince(ownerKeyHash: string, sinceISO: string): Promise<number> {
  const inMemory = memorySpecials.filter((s) => s.ownerKeyHash === ownerKeyHash && s.postedAtISO >= sinceISO).length;
  const d = await getDb();
  if (!d) return inMemory;
  try {
    // Equality only (no composite index needed); a device posts a handful at most.
    const snap = await d.collection('specials').where('ownerKeyHash', '==', ownerKeyHash).select('postedAtISO').limit(200).get();
    return inMemory + snap.docs.filter((doc) => String(doc.get('postedAtISO') || '') >= sinceISO).length;
  } catch (err: any) {
    console.warn('[firestore] countOwnedSpecialsSince failed:', err?.message || err);
    return inMemory;
  }
}

export async function bumpSpecialMetric(
  id: string,
  metric: 'views' | 'planInclusions' | 'clickThroughs',
  by: number = 1
): Promise<void> {
  const d = await getDb();
  if (!d) {
    const found = memorySpecials.find((s) => s.id === id);
    if (found) (found as any)[metric] = ((found as any)[metric] || 0) + by;
    return;
  }
  try {
    const { FieldValue } = await import('@google-cloud/firestore');
    await d.collection('specials').doc(id).update({ [metric]: FieldValue.increment(by) });
    invalidateSpecialsCache();
  } catch (err: any) {
    // Fall through silently — analytics are non-critical
    console.warn('[firestore] bumpSpecialMetric failed:', err?.message || err);
  }
}

// ---------- Restaurant brands ----------

export async function getBrand(id: string): Promise<RestaurantBrandDoc | null> {
  const d = await getDb();
  if (!d) return memoryBrands.get(id) || null;
  try {
    const snap = await d.collection('brands').doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...(snap.data() as RestaurantBrandDoc) };
  } catch (err: any) {
    console.warn('[firestore] getBrand failed:', err?.message || err);
    return memoryBrands.get(id) || null;
  }
}

export async function saveBrand(id: string, data: Partial<RestaurantBrandDoc>): Promise<void> {
  const now = new Date().toISOString();
  const d = await getDb();
  if (!d) {
    const existing = memoryBrands.get(id);
    setMemoryBrand(id, {
      ...(existing || {
        name: '',
        city: '',
        cuisine: '',
        voice: '',
        signatureDishes: '',
        createdAtISO: now,
        updatedAtISO: now,
      }),
      ...data,
      id,
      updatedAtISO: now,
    } as RestaurantBrandDoc);
    return;
  }
  try {
    await d
      .collection('brands')
      .doc(id)
      .set(
        {
          ...data,
          updatedAtISO: now,
          createdAtISO: data.createdAtISO || now,
        },
        { merge: true }
      );
  } catch (err: any) {
    console.warn('[firestore] saveBrand failed:', err?.message || err);
  }
}

// ---------- Account deletion ----------

export interface DeletedCounts {
  specials: number;
  brands: number;
}

/**
 * Deletes everything linked to one device's owner key: the specials it published
 * (dish, caption, AI image, metrics) and any restaurant brand doc it connected
 * (Instagram token, account id, publish key hash). Throws if the database fails,
 * so the caller never reports a deletion that didn't happen.
 */
export async function deleteOwnedData(ownerKeyHash: string): Promise<DeletedCounts> {
  const counts: DeletedCounts = { specials: 0, brands: 0 };
  if (!/^[a-f0-9]{64}$/.test(ownerKeyHash)) return counts;
  // In-memory copies (local dev, or Firestore write fallbacks).
  for (let i = memorySpecials.length - 1; i >= 0; i--) {
    if (memorySpecials[i].ownerKeyHash === ownerKeyHash) {
      memorySpecials.splice(i, 1);
      counts.specials++;
    }
  }
  for (const [id, b] of memoryBrands) {
    if (b.ownerKeyHash === ownerKeyHash) {
      memoryBrands.delete(id);
      counts.brands++;
    }
  }
  const d = await getDb();
  if (!d) return counts;
  for (const name of ['specials', 'brands'] as const) {
    // Batches of up to 400 deletes until nothing owned is left.
    for (;;) {
      const snap = await d.collection(name).where('ownerKeyHash', '==', ownerKeyHash).limit(400).get();
      if (snap.empty) break;
      const batch = d.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      if (name === 'specials') invalidateSpecialsCache();
      counts[name] += snap.size;
      if (snap.size < 400) break;
    }
  }
  return counts;
}

// ---------- Analytics ----------

export interface SpecialMetrics {
  byDay: { date: string; views: number; planInclusions: number; clickThroughs: number }[];
  totals: { views: number; planInclusions: number; clickThroughs: number; specialsPublished: number };
}

export async function getMetricsForBrand(brandName: string, brandCity: string, days = 7): Promise<SpecialMetrics> {
  // The cached newest 200 (a week of specials easily fits) instead of a fresh 500-document read with pictures.
  const all = await listSpecials(SPECIALS_CACHE_LIMIT);
  const matched = all.filter(
    (s) =>
      (s.restaurantName || '').toLowerCase() === (brandName || '').toLowerCase() &&
      (s.city || '').toLowerCase().includes((brandCity || '').toLowerCase().split(',')[0])
  );
  const cutoff = Date.now() - days * 86400000;
  const recent = matched.filter((s) => new Date(s.postedAtISO).getTime() >= cutoff);
  const totals = {
    views: recent.reduce((a, s) => a + (s.views || 0), 0),
    planInclusions: recent.reduce((a, s) => a + (s.planInclusions || 0), 0),
    clickThroughs: recent.reduce((a, s) => a + (s.clickThroughs || 0), 0),
    specialsPublished: recent.length,
  };
  // Group by day for the chart
  const byDayMap = new Map<string, { views: number; planInclusions: number; clickThroughs: number }>();
  for (const s of recent) {
    const day = (s.postedAtISO || '').slice(0, 10);
    if (!byDayMap.has(day)) byDayMap.set(day, { views: 0, planInclusions: 0, clickThroughs: 0 });
    const acc = byDayMap.get(day)!;
    acc.views += s.views || 0;
    acc.planInclusions += s.planInclusions || 0;
    acc.clickThroughs += s.clickThroughs || 0;
  }
  const byDay = Array.from(byDayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({ date, ...m }));
  return { byDay, totals };
}
