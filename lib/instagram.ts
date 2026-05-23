// Instagram Graph API integration. Two responsibilities:
//   1. OAuth: hand restaurant owners through Meta's Facebook Login → Page
//      selection → Instagram Business Account selection → access-token
//      issuance. Long-lived tokens (~60 days) are stored in Firestore on
//      the restaurant brand doc.
//   2. Publish: take the IG post pack (image + caption) and call
//      /{ig-business-id}/media + /media_publish to post it.
//
// Setup required (one-time, in Meta for Developers):
//   - Create a Meta App (Business type)
//   - Add Facebook Login + Instagram Graph API products
//   - Set OAuth redirect URI to https://<your-domain>/api/auth/instagram/callback
//   - Request scopes: pages_show_list, instagram_basic, instagram_content_publish, pages_read_engagement
//   - Run app review for those scopes (production publishing requires this)
//
// Env vars:
//   META_APP_ID            — your Meta app id
//   META_APP_SECRET        — your Meta app secret
//   META_REDIRECT_URI      — https://eve.mohitgoenka.com/api/auth/instagram/callback
//
// If env vars are missing, all calls return { configured: false } and the
// UI gracefully falls back to copy-and-share via the Web Share API.

const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_REDIRECT_URI =
  process.env.META_REDIRECT_URI ||
  (process.env.NODE_ENV === 'production'
    ? 'https://eve.mohitgoenka.com/api/auth/instagram/callback'
    : 'http://localhost:8080/api/auth/instagram/callback');

export function isInstagramConfigured(): boolean {
  return !!(META_APP_ID && META_APP_SECRET);
}

const SCOPES = [
  'pages_show_list',
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_engagement',
].join(',');

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: META_REDIRECT_URI,
    state,
    scope: SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

interface ShortLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status}`);
  const data = (await res.json()) as ShortLivedTokenResponse;
  return data.access_token;
}

export async function exchangeForLongLivedToken(shortLived: string): Promise<{ token: string; expiresIn: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: shortLived,
  });
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Long-lived exchange failed: ${res.status}`);
  const data = (await res.json()) as ShortLivedTokenResponse;
  return { token: data.access_token, expiresIn: data.expires_in };
}

interface PageInfo {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export async function findInstagramBusinessAccount(
  userAccessToken: string
): Promise<{ pageId: string; pageAccessToken: string; igBusinessAccountId: string; pageName: string } | null> {
  const url = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userAccessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Page list failed: ${res.status}`);
  const data = (await res.json()) as { data: PageInfo[] };
  for (const p of data.data || []) {
    if (p.instagram_business_account?.id) {
      return {
        pageId: p.id,
        pageAccessToken: p.access_token,
        igBusinessAccountId: p.instagram_business_account.id,
        pageName: p.name,
      };
    }
  }
  return null;
}

// Two-step publish: create a media container, then publish it.
export async function publishImageToInstagram(opts: {
  igBusinessAccountId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}): Promise<{ id: string }> {
  // Step 1: create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${opts.igBusinessAccountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: opts.imageUrl,
        caption: opts.caption,
        access_token: opts.pageAccessToken,
      }),
    }
  );
  if (!containerRes.ok) {
    const errText = await containerRes.text();
    throw new Error(`IG container failed: ${errText.slice(0, 200)}`);
  }
  const container = (await containerRes.json()) as { id: string };

  // Step 2: publish container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${opts.igBusinessAccountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: opts.pageAccessToken,
      }),
    }
  );
  if (!publishRes.ok) {
    const errText = await publishRes.text();
    throw new Error(`IG publish failed: ${errText.slice(0, 200)}`);
  }
  return (await publishRes.json()) as { id: string };
}
