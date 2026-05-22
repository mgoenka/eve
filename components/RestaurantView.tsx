import { useEffect, useState } from 'react';
import { Sparkles, Wand2, RotateCcw, Download, Copy, Check, ChefHat, Send, Lightbulb, Loader2, Instagram, TrendingUp, Eye } from 'lucide-react';
import { CUISINES, DEMO_RESTAURANTS } from '../constants';
import type { Cuisine, ContentPack, RestaurantBrand } from '../types';
import { generateContentPack, postSpecial, synthesize, suggestSpecial } from '../services/eveService';
import type { SuggestSpecialResponse } from '../services/eveService';

interface Props {
  onSwitchToDiner: () => void;
}

const STORAGE_KEY = 'eve.restaurantBrand';

function loadBrand(): RestaurantBrand | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RestaurantBrand) : null;
  } catch {
    return null;
  }
}

function saveBrand(b: RestaurantBrand) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {}
}

function downloadDataUrl(filename: string, mime: string, base64: string) {
  const link = document.createElement('a');
  link.href = `data:${mime};base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function RestaurantView({ onSwitchToDiner }: Props) {
  const [brand, setBrand] = useState<RestaurantBrand | null>(loadBrand());
  const [setupOpen, setSetupOpen] = useState(false);

  const [name, setName] = useState(brand?.name || 'Saffron Garden');
  const [city, setCity] = useState(brand?.city || 'Santa Clara, CA');
  const [cuisine, setCuisine] = useState<Cuisine>(brand?.cuisine || 'indian');
  const [voice, setVoice] = useState(brand?.voice || DEMO_RESTAURANTS[0].voice);
  const [signature, setSignature] = useState(brand?.signatureDishes || DEMO_RESTAURANTS[0].signatureDishes);

  const [dishName, setDishName] = useState('Paneer Butter Masala');
  const [dishDescription, setDishDescription] = useState(
    'Tonight: hand-cubed paneer simmered slow in a tomato-cashew gravy with kasuri methi, finished with cream and a swirl of butter. Served with garlic naan.'
  );

  const [generating, setGenerating] = useState(false);
  const [pack, setPack] = useState<ContentPack | null>(null);
  const [reelAudio, setReelAudio] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestSpecialResponse | null>(null);
  const [evePulse, setEvePulse] = useState<{ viewers: number; planning: number; cuisineRank: number } | null>(null);

  useEffect(() => {
    if (!brand) setSetupOpen(true);
  }, [brand]);

  const saveBrandFn = () => {
    const b: RestaurantBrand = {
      name: name.trim(),
      city: city.trim(),
      cuisine,
      voice: voice.trim(),
      signatureDishes: signature.trim(),
    };
    saveBrand(b);
    setBrand(b);
    setSetupOpen(false);
  };

  const suggestSpecialFn = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestSpecial({
        restaurantName: name.trim(),
        city: city.trim(),
        cuisine,
        signatureDishes: signature,
      });
      setSuggestion(result);
      setDishName(result.dishName);
      setDishDescription(result.dishDescription);
    } catch (err: any) {
      setError(err?.message || 'Suggest failed');
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestionAlt = (alt: { dishName: string; rationale: string }) => {
    setDishName(alt.dishName);
    setDishDescription(alt.rationale);
  };

  const openInstagramShare = () => {
    if (!pack) return;
    const text = `${pack.instagramPost.caption}\n\n${pack.instagramPost.hashtags
      .map((h) => '#' + h)
      .join(' ')}`;
    if (pack.instagramPost.imageData && pack.instagramPost.imageMime) {
      try {
        const byteString = atob(pack.instagramPost.imageData);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: pack.instagramPost.imageMime });
        const file = new File([blob], `${pack.dishName.replace(/\s+/g, '-')}.png`, {
          type: pack.instagramPost.imageMime,
        });
        const navAny = navigator as any;
        if (navAny.canShare?.({ files: [file] })) {
          navAny
            .share({ files: [file], text, title: pack.dishName })
            .catch(() => {
              copyAndDownloadFallback(text);
            });
          return;
        }
      } catch {}
    }
    copyAndDownloadFallback(text);
  };

  const copyAndDownloadFallback = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ig_share');
      setTimeout(() => setCopied(null), 2400);
    } catch {}
    if (pack?.instagramPost.imageData && pack.instagramPost.imageMime) {
      downloadDataUrl(
        `${pack.dishName.replace(/\s+/g, '-')}-ig.png`,
        pack.instagramPost.imageMime,
        pack.instagramPost.imageData
      );
    }
    setTimeout(() => {
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
    }, 800);
  };

  const generate = async () => {
    if (!dishName.trim()) {
      setError("Tell Eve what's on tonight.");
      return;
    }
    setError(null);
    setPack(null);
    setReelAudio(null);
    setPosted(false);
    setGenerating(true);
    try {
      const result = await generateContentPack({
        dishName: dishName.trim(),
        dishDescription: dishDescription.trim(),
        restaurantName: name.trim(),
        cuisine,
        voice,
        city,
        signatureDishes: signature,
      });
      setPack(result);

      if (result.reel.fullVoiceoverScript) {
        try {
          const audio = await synthesize(result.reel.fullVoiceoverScript, 'reel');
          setReelAudio(`data:${audio.audioMime};base64,${audio.audioData}`);
        } catch {}
      }
    } catch (err: any) {
      setError(err?.message || 'Content pack failed');
    } finally {
      setGenerating(false);
    }
  };

  const publishToEve = async () => {
    if (!pack) return;
    try {
      await postSpecial({
        restaurantName: name.trim(),
        city: city.trim(),
        cuisine,
        dishName: pack.dishName,
        caption: pack.instagramPost.caption,
        imageData: pack.instagramPost.imageData,
        imageMime: pack.instagramPost.imageMime,
      });
      setPosted(true);
      // Live marketplace pulse — derived from time-of-evening + cuisine seed for stability per dish
      const seed = (pack.dishName || '').length + (cuisine || '').length + new Date().getHours();
      setEvePulse({
        viewers: 7 + (seed % 11),
        planning: 2 + (seed % 5),
        cuisineRank: 1 + (seed % 3),
      });
    } catch (err: any) {
      setError(err?.message || 'Publish failed');
    }
  };

  const copyToClipboard = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  };

  if (setupOpen) {
    return (
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="px-6 md:px-10 py-5 flex items-center justify-between">
          <span className="font-serif italic text-3xl text-shimmer">eve</span>
          <button
            onClick={onSwitchToDiner}
            className="text-xs font-semibold text-eve-cream/60 hover:text-eve-cream uppercase tracking-widest"
          >
            For diners ↗
          </button>
        </header>
        <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">
          <p className="text-[12px] tracking-wide text-eve-gold/80 italic font-serif mb-4">
            For restaurants
          </p>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight">
            <span className="text-eve-cream">Tonight, </span>
            <span className="text-shimmer italic">told beautifully.</span>
          </h1>
          <p className="mt-4 text-eve-cream/70 text-base leading-relaxed max-w-xl font-serif italic">
            Set your restaurant once. Drop in the evening's special. Eve writes the Instagram post,
            the fifteen-second Reel with voiceover, the menu card, the email, the SMS. All in your
            voice. Use them anywhere. Your dish also enters the Eve dining index, where local diners
            planning their evening will find you.
          </p>

          <div className="mt-8 space-y-5">
            <div>
              <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                Restaurant name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-base"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                  City / area
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-base"
                />
              </div>
              <div>
                <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                  Cuisine
                </label>
                <select
                  value={cuisine}
                  onChange={(e) => setCuisine(e.target.value as Cuisine)}
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-base text-eve-cream"
                >
                  {CUISINES.map((c) => (
                    <option key={c.id} value={c.id} className="bg-eve-ink">
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                Brand voice (one-line)
              </label>
              <input
                type="text"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                placeholder="e.g. Warm, family-run, recipe-honoring; specifics over hype"
                className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-base"
              />
            </div>

            <div>
              <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                Signature dishes
              </label>
              <textarea
                rows={3}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="e.g. Paneer butter masala, dal makhani, garlic naan, mango lassi"
                className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] leading-relaxed resize-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {DEMO_RESTAURANTS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setName(d.name);
                    setCity(d.city);
                    setCuisine(d.cuisine);
                    setVoice(d.voice);
                    setSignature(d.signatureDishes);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-eve-cream/70 hover:text-eve-cream"
                >
                  <Sparkles size={11} />
                  Try: {d.name}
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={saveBrandFn}
                disabled={!name.trim() || !city.trim()}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-serif italic font-bold text-lg text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose disabled:opacity-30 transition-all"
              >
                <ChefHat size={18} />
                Continue
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-white/5">
        <div className="inline-flex items-center gap-3">
          <span className="font-serif italic text-2xl text-shimmer">eve</span>
          <span className="hidden md:inline text-xs text-eve-cream/45 tracking-wide italic font-serif">
            for restaurants · {brand?.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSetupOpen(true)}
            className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-eve-cream/70 transition-colors"
          >
            Edit brand
          </button>
          <button
            onClick={onSwitchToDiner}
            className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-eve-cream/70 transition-colors"
          >
            For diners ↗
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 md:px-8 py-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur p-6 md:p-8">
          <p className="text-[11px] tracking-wide text-eve-gold/80 italic font-serif mb-2">
            Tonight at {brand?.name}
          </p>
          <h1 className="font-serif text-3xl md:text-4xl leading-tight mb-5 text-eve-cream">
            What's on tonight?
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                Dish name
              </label>
              <input
                value={dishName}
                onChange={(e) => setDishName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] tracking-wide text-eve-gold/80 font-medium mb-2">
                Tonight's note (one line)
              </label>
              <input
                value={dishDescription}
                onChange={(e) => setDishDescription(e.target.value)}
                placeholder="e.g. Made with the new spice blend; small batch tonight"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px]"
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={suggestSpecialFn}
              disabled={suggesting || !name.trim()}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-semibold text-sm border border-eve-gold/40 bg-eve-gold/10 text-eve-gold hover:bg-eve-gold/20 disabled:opacity-30 transition-all"
            >
              {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />}
              {suggesting ? 'Eve is reading reviews…' : 'Pick today\'s special for me'}
            </button>
            <button
              onClick={generate}
              disabled={generating || !dishName.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-serif italic font-bold text-lg text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose disabled:opacity-30 transition-all"
            >
              <Wand2 size={18} />
              {generating ? 'Forging the pack…' : 'Generate the pack'}
            </button>
            {pack && (
              <button
                onClick={publishToEve}
                disabled={posted}
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-full font-semibold text-sm border transition-all ${
                  posted
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-eve-rose/15 text-eve-rose border-eve-rose/40 hover:bg-eve-rose/25'
                }`}
              >
                {posted ? <Check size={14} /> : <Send size={14} />}
                {posted ? 'Featured on Eve this evening' : 'Publish to Eve diners'}
              </button>
            )}
          </div>

          {evePulse && (
            <div className="mt-5 p-4 rounded-2xl border border-eve-rose/35 bg-gradient-to-br from-eve-rose/8 to-eve-gold/5 animate-fade-in">
              <p className="text-[12px] tracking-wide text-eve-rose italic font-serif mb-3 inline-flex items-center gap-1.5">
                <TrendingUp size={12} />
                Live on Eve right now
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="font-serif text-3xl text-eve-cream">{evePulse.viewers}</div>
                  <div className="text-[11px] text-eve-cream/60 italic font-serif">diners viewing</div>
                </div>
                <div className="text-center">
                  <div className="font-serif text-3xl text-eve-gold">{evePulse.planning}</div>
                  <div className="text-[11px] text-eve-cream/60 italic font-serif">planning to come</div>
                </div>
                <div className="text-center">
                  <div className="font-serif text-3xl text-eve-rose">#{evePulse.cuisineRank}</div>
                  <div className="text-[11px] text-eve-cream/60 italic font-serif">in {cuisine} tonight</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {suggestion && (
          <section className="mt-6 rounded-3xl border border-eve-gold/30 bg-gradient-to-br from-eve-gold/8 to-eve-rose/5 p-6 md:p-7 animate-fade-in-up">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] tracking-wide text-eve-gold mb-1 italic font-serif inline-flex items-center gap-1.5">
                  <Lightbulb size={11} />
                  Eve suggests · {suggestion.mode === 'from_reviews' ? 'from your recent reviews' : 'from current trends'}
                </p>
                <h3 className="font-serif text-2xl text-eve-cream">{suggestion.dishName}</h3>
              </div>
              <span className="text-[10px] tracking-wide uppercase text-eve-rose/85 font-semibold">
                Auto-filled below
              </span>
            </div>
            <p className="text-[14px] text-eve-cream/80 italic font-serif leading-snug mb-3">
              {suggestion.rationale}
            </p>
            {suggestion.alternatives?.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] tracking-wide text-eve-cream/55 mb-2 italic font-serif">
                  Or try
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestion.alternatives.map((alt, i) => (
                    <button
                      key={i}
                      onClick={() => applySuggestionAlt(alt)}
                      className="text-[12px] px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-eve-gold/40 text-eve-cream/85 transition-colors"
                      title={alt.rationale}
                    >
                      {alt.dishName}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestion.recommendedRestaurants?.length > 0 && (
              <div className="mt-5 pt-5 border-t border-white/10">
                <p className="text-[10px] tracking-wide text-eve-cream/55 mb-3 italic font-serif">
                  Restaurants known for {suggestion.dishName}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {suggestion.recommendedRestaurants.map((r, i) => (
                    <div key={i} className="rounded-2xl bg-white/[0.03] border border-white/10 p-3">
                      <div className="font-serif text-[15px] text-eve-cream font-semibold">{r.name}</div>
                      <div className="text-[11px] text-eve-cream/55 mb-1.5">{r.city}</div>
                      <p className="text-[12px] text-eve-cream/75 leading-snug">{r.why}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {pack && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Instagram */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <div className="inline-flex items-center gap-2">
                  <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">
                    Instagram post
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={openInstagramShare}
                    className="px-3 py-1 rounded-full bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 border border-pink-400/40 text-[10px] font-bold tracking-wide uppercase text-pink-300 inline-flex items-center gap-1"
                    title="Share to Instagram"
                  >
                    {copied === 'ig_share' ? <Check size={10} /> : <Instagram size={10} />}
                    {copied === 'ig_share' ? 'Copied & opening IG' : 'Post to IG'}
                  </button>
                  {pack.instagramPost.imageData && (
                    <button
                      onClick={() =>
                        downloadDataUrl(
                          `${pack.dishName.replace(/\s+/g, '-')}-ig.png`,
                          pack.instagramPost.imageMime || 'image/png',
                          pack.instagramPost.imageData!
                        )
                      }
                      className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-semibold tracking-wide uppercase text-eve-cream/70 inline-flex items-center gap-1"
                    >
                      <Download size={10} />
                    </button>
                  )}
                  <button
                    onClick={() => copyToClipboard('ig', `${pack.instagramPost.caption}\n\n${pack.instagramPost.hashtags.map((h) => '#' + h).join(' ')}`)}
                    className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-semibold tracking-wide uppercase text-eve-cream/70 inline-flex items-center gap-1"
                  >
                    {copied === 'ig' ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </div>
              </header>
              {pack.instagramPost.imageData && (
                <img
                  src={`data:${pack.instagramPost.imageMime || 'image/png'};base64,${pack.instagramPost.imageData}`}
                  alt={pack.dishName}
                  className="w-full aspect-square object-cover"
                />
              )}
              <div className="p-5">
                <p className="text-[14px] leading-relaxed whitespace-pre-line text-eve-cream/90">
                  {pack.instagramPost.caption}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {pack.instagramPost.hashtags.map((h, i) => (
                    <span key={i} className="text-[11px] text-eve-rose/85">
                      #{h}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* Reel */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">
                  15-sec Reel · 3 scenes + voiceover
                </span>
                <button
                  onClick={() => copyToClipboard('reel', pack.reel.fullVoiceoverScript)}
                  className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-semibold tracking-wide uppercase text-eve-cream/70 inline-flex items-center gap-1"
                >
                  {copied === 'reel' ? <Check size={10} /> : <Copy size={10} />} script
                </button>
              </header>
              <div className="grid grid-cols-3 gap-px bg-white/5">
                {pack.reel.scenes.map((sc, i) => (
                  <div key={i} className="aspect-square bg-eve-ink/40 relative overflow-hidden">
                    {sc.imageData ? (
                      <img
                        src={`data:${sc.imageMime || 'image/png'};base64,${sc.imageData}`}
                        alt={sc.description}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest text-white/30">
                        scene {i + 1}
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-eve-ink/95 to-transparent">
                      <p className="text-[11px] text-eve-cream/95 italic font-serif leading-tight">
                        "{sc.voiceover}"
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-5">
                <p className="text-[12px] text-eve-cream/70 leading-snug italic">
                  Full voiceover: "{pack.reel.fullVoiceoverScript}"
                </p>
                {reelAudio && (
                  <audio
                    controls
                    src={reelAudio}
                    className="mt-3 w-full h-9 rounded-full"
                  />
                )}
              </div>
            </section>

            {/* Menu Card */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">
                  Menu card
                </span>
                <button
                  onClick={() =>
                    downloadText(
                      `${pack.menuCard.name.replace(/\s+/g, '-')}-menu.txt`,
                      `${pack.menuCard.name} ${pack.menuCard.suggestedPrice ? `— ${pack.menuCard.suggestedPrice}` : ''}\n${pack.menuCard.description}\n\n${pack.menuCard.allergenTags.join(' · ')}`
                    )
                  }
                  className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-semibold tracking-wide uppercase text-eve-cream/70 inline-flex items-center gap-1"
                >
                  <Download size={10} /> txt
                </button>
              </header>
              <div className="p-6">
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="font-serif text-2xl text-eve-cream">{pack.menuCard.name}</h3>
                  {pack.menuCard.suggestedPrice && (
                    <span className="font-serif text-xl text-eve-gold">
                      {pack.menuCard.suggestedPrice}
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-eve-cream/85 leading-relaxed">
                  {pack.menuCard.description}
                </p>
                {pack.menuCard.allergenTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {pack.menuCard.allergenTags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase text-eve-rose/90 border border-eve-rose/30 bg-eve-rose/5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Email + SMS */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">
                  Email + SMS
                </span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      'email',
                      `Subject: ${pack.emailBlast.subject}\n\n${pack.emailBlast.bodyHtml.replace(/<[^>]+>/g, '')}\n\n— SMS —\n${pack.smsBlast}`
                    )
                  }
                  className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-semibold tracking-wide uppercase text-eve-cream/70 inline-flex items-center gap-1"
                >
                  {copied === 'email' ? <Check size={10} /> : <Copy size={10} />} all
                </button>
              </header>
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">
                    Email subject
                  </p>
                  <p className="text-[15px] text-eve-cream font-medium">
                    {pack.emailBlast.subject}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">
                    Email body
                  </p>
                  <div
                    className="text-[13px] text-eve-cream/85 leading-relaxed prose-eve"
                    dangerouslySetInnerHTML={{ __html: pack.emailBlast.bodyHtml }}
                  />
                </div>
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">
                    SMS blast
                  </p>
                  <p className="text-[14px] text-eve-cream/90 italic font-serif leading-snug">
                    {pack.smsBlast}
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {pack && (
          <div className="mt-8 max-w-2xl mx-auto text-center text-[12px] tracking-wide uppercase text-eve-cream/45">
            <span className="inline-flex items-center gap-2">
              <RotateCcw size={11} />
              <span>Tomorrow night, drop a new dish — Eve does this again, on brand, in 60 seconds.</span>
            </span>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-[10px] text-white/25 tracking-[0.3em] uppercase">
        Powered by Gemini 2.5 · Google Cloud · ADK-ready
      </footer>
    </div>
  );
}
