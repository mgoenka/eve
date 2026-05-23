// Firestore client + persistence layer for the dining index and restaurant
// brand profiles. Falls back to an in-memory store if Firestore isn't
// configured (no GOOGLE_CLOUD_PROJECT or service account credentials),
// so local dev still works.

import { Firestore } from '@google-cloud/firestore';

let db: Firestore | null = null;
let initAttempted = false;

function getDb(): Firestore | null {
  if (initAttempted) return db;
  initAttempted = true;
  try {
    // Cloud Run automatically authenticates via the service account.
    // Locally, GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth
    // application-default login` works.
    db = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
      ignoreUndefinedProperties: true,
    });
    return db;
  } catch (err: any) {
    console.warn('[firestore] not configured — falling back to in-memory:', err?.message || err);
    db = null;
    return null;
  }
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid' | null;
  createdAtISO: string;
  updatedAtISO: string;
}

// In-memory fallback when Firestore isn't available.
const memorySpecials: PostedSpecialDoc[] = [];
const memoryBrands = new Map<string, RestaurantBrandDoc>();

// ---------- Specials (the dining index) ----------

export async function listSpecials(limit = 50): Promise<PostedSpecialDoc[]> {
  const d = getDb();
  if (!d) return memorySpecials.slice(-limit).reverse();
  try {
    const snap = await d
      .collection('specials')
      .orderBy('postedAtISO', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as PostedSpecialDoc) }));
  } catch (err: any) {
    console.warn('[firestore] listSpecials failed:', err?.message || err);
    return memorySpecials.slice(-limit).reverse();
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
  const d = getDb();
  const enriched: PostedSpecialDoc = {
    ...s,
    views: 0,
    planInclusions: 0,
    clickThroughs: 0,
    postedAtISO: s.postedAtISO || new Date().toISOString(),
  };
  if (!d) {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    memorySpecials.push({ ...enriched, id });
    return id;
  }
  try {
    const ref = await d.collection('specials').add(enriched);
    return ref.id;
  } catch (err: any) {
    console.warn('[firestore] addSpecial failed, falling back to memory:', err?.message || err);
    const id = `mem_${Date.now()}`;
    memorySpecials.push({ ...enriched, id });
    return id;
  }
}

export async function bumpSpecialMetric(
  id: string,
  metric: 'views' | 'planInclusions' | 'clickThroughs',
  by: number = 1
): Promise<void> {
  const d = getDb();
  if (!d) {
    const found = memorySpecials.find((s) => s.id === id);
    if (found) (found as any)[metric] = ((found as any)[metric] || 0) + by;
    return;
  }
  try {
    await d.collection('specials').doc(id).update({
      [metric]: (Firestore as any).FieldValue?.increment?.(by) ?? by,
    });
  } catch (err: any) {
    // Fall through silently — analytics are non-critical
    console.warn('[firestore] bumpSpecialMetric failed:', err?.message || err);
  }
}

// ---------- Restaurant brands ----------

export async function getBrand(id: string): Promise<RestaurantBrandDoc | null> {
  const d = getDb();
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
  const d = getDb();
  if (!d) {
    const existing = memoryBrands.get(id);
    memoryBrands.set(id, {
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

// ---------- Analytics ----------

export interface SpecialMetrics {
  byDay: { date: string; views: number; planInclusions: number; clickThroughs: number }[];
  totals: { views: number; planInclusions: number; clickThroughs: number; specialsPublished: number };
}

export async function getMetricsForBrand(brandName: string, brandCity: string, days = 7): Promise<SpecialMetrics> {
  const all = await listSpecials(500);
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
