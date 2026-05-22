export type Cuisine =
  | 'indian'
  | 'italian'
  | 'thai'
  | 'mexican'
  | 'japanese'
  | 'chinese'
  | 'mediterranean'
  | 'american'
  | 'fusion'
  | 'cafe';

export type Vibe =
  | 'date_night'
  | 'celebrating'
  | 'casual'
  | 'family'
  | 'friends'
  | 'solo';

export type DietaryPreference =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'halal'
  | 'kosher'
  | 'nut_free'
  | 'dairy_free';

export type StopKind = 'dinner' | 'dessert' | 'drink' | 'walk' | 'live_music' | 'view' | 'activity';

export interface ExperienceStop {
  kind: StopKind;
  name: string;
  oneLineVibe: string;
  whyThisFits: string;
  approxArrival: string;
  durationMinutes: number;
  walkMinutesFromPrev: number;
  signatureItem?: string;
  isEveOriginal?: boolean;
  imageData?: string;
  imageMime?: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface ExperiencePlan {
  title: string;
  city: string;
  vibe: Vibe;
  party: number;
  dietary: DietaryPreference[];
  budgetUSD: number;
  stops: ExperienceStop[];
  narrationAudio?: string;
  narrationMime?: string;
  status: 'idle' | 'planning' | 'staging' | 'narrating' | 'done' | 'error';
  error?: string;
}

export interface RestaurantBrand {
  name: string;
  city: string;
  cuisine: Cuisine;
  voice: string;
  signatureDishes: string;
  primaryColor?: string;
}

export interface ContentAssetReel {
  scenes: Array<{ description: string; voiceover: string; imageData?: string; imageMime?: string }>;
  fullVoiceoverScript: string;
  audioData?: string;
  audioMime?: string;
}

export interface ContentPack {
  dishName: string;
  instagramPost: {
    caption: string;
    hashtags: string[];
    imageData?: string;
    imageMime?: string;
  };
  reel: ContentAssetReel;
  menuCard: {
    name: string;
    description: string;
    suggestedPrice: string;
    allergenTags: string[];
    imageData?: string;
    imageMime?: string;
  };
  emailBlast: {
    subject: string;
    bodyHtml: string;
  };
  smsBlast: string;
}

export interface PostedSpecial {
  id: string;
  restaurantName: string;
  city: string;
  cuisine: Cuisine;
  dishName: string;
  caption: string;
  imageData?: string;
  imageMime?: string;
  postedAt: number;
}
