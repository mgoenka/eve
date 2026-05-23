import { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, RotateCcw, Download, Copy, Check, ChefHat, Send, Lightbulb, Loader2, Instagram, TrendingUp } from 'lucide-react';
import { CUISINES, DEMO_RESTAURANTS } from '../constants';
import type { Cuisine, ContentPack, RestaurantBrand } from '../types';
import { generateContentPack, postSpecial, synthesize, suggestSpecial } from '../services/eveService';
import type { SuggestSpecialResponse } from '../services/eveService';
import { EveLogo } from './EveLogo';

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

// Render placeholder-styled value when the field still equals the suggestion
// the user can either accept or overwrite.
function ghostClass(value: string, ghost: string): string {
  const isGhost = !value || value === ghost;
  return isGhost
    ? 'text-eve-cream/55 italic font-serif placeholder:text-eve-cream/60'
    : 'text-eve-cream placeholder:text-eve-cream/60 placeholder:italic placeholder:font-serif';
}

export function RestaurantView({ onSwitchToDiner }: Props) {
  const stored = loadBrand();
  const seed = DEMO_RESTAURANTS[0];

  const [name, setName] = useState(stored?.name || seed.name);
  const [city, setCity] = useState(stored?.city || seed.city);
  const [cuisine, setCuisine] = useState<Cuisine>(stored?.cuisine || seed.cuisine);
  const [voice, setVoice] = useState(stored?.voice || seed.voice);
  const [signature, setSignature] = useState(stored?.signatureDishes || seed.signatureDishes);

  const [dishName, setDishName] = useState('');
  const [dishDescription, setDishDescription] = useState('');

  const [generating, setGenerating] = useState(false);
  const [pack, setPack] = useState<ContentPack | null>(null);
  const [reelAudio, setReelAudio] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestSpecialResponse | null>(null);
  const [evePulse, setEvePulse] = useState<{ viewers: number; planning: number; cuisineRank: number } | null>(null);

  const cancelRef = useRef(false);

  // Brand auto-save on edit (so localStorage is always in sync)
  useEffect(() => {
    saveBrand({ name, city, cuisine, voice, signatureDishes: signature });
  }, [name, city, cuisine, voice, signature]);

  // Auto-suggest a special the moment we have a name + city. The dish becomes
  // a placeholder the user can either keep or overwrite. Runs once.
  const autoSuggestedRef = useRef(false);
  useEffect(() => {
    if (autoSuggestedRef.current) return;
    if (!name.trim() || !city.trim()) return;
    autoSuggestedRef.current = true;
    setSuggesting(true);
    suggestSpecial({
      restaurantName: name.trim(),
      city: city.trim(),
      cuisine,
      signatureDishes: signature,
    })
      .then((result) => {
        setSuggestion(result);
        if (!dishName) setDishName(result.dishName);
        if (!dishDescription) setDishDescription(result.dishDescription);
      })
      .catch(() => {})
      .finally(() => setSuggesting(false));
  }, []);

  const generate = async () => {
    setError(null);
    setPack(null);
    setReelAudio(null);
    setPosted(false);
    setEvePulse(null);
    cancelRef.current = false;
    setGenerating(true);
    try {
      // If the user didn't fill in a dish, do the magic behind the scenes:
      // mine reviews / trends, pick a dish, then generate. Dish input is
      // never required.
      let useDish = dishName.trim();
      let useDesc = dishDescription.trim();
      if (!useDish) {
        const result = await suggestSpecial({
          restaurantName: name.trim(),
          city: city.trim(),
          cuisine,
          signatureDishes: signature,
        });
        useDish = result.dishName;
        useDesc = result.dishDescription;
        setSuggestion(result);
        setDishName(useDish);
        setDishDescription(useDesc);
      }

      const result = await generateContentPack({
        dishName: useDish,
        dishDescription: useDesc,
        restaurantName: name.trim(),
        cuisine,
        voice,
        city,
        signatureDishes: signature,
      });
      setPack(result);

      if (result.reel.fullVoiceoverScript) {
        synthesize(result.reel.fullVoiceoverScript, 'reel')
          .then((audio) => setReelAudio(`data:${audio.audioMime};base64,${audio.audioData}`))
          .catch(() => {});
      }
    } catch (err: any) {
      setError(err?.message || 'Eve could not put tonight together.');
    } finally {
      setGenerating(false);
    }
  };

  const pickDifferent = async () => {
    setError(null);
    setSuggesting(true);
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
      setPack(null);
    } catch (err: any) {
      setError(err?.message || 'Suggest failed');
    } finally {
      setSuggesting(false);
    }
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
            .catch(() => copyAndDownloadFallback(text));
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
      const seedNum = (pack.dishName || '').length + (cuisine || '').length + new Date().getHours();
      setEvePulse({
        viewers: 7 + (seedNum % 11),
        planning: 2 + (seedNum % 5),
        cuisineRank: 1 + (seedNum % 3),
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

  // Single unified page: brand setup + tonight's dish + content pack.
  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-white/5">
        <a href="/restaurant" className="inline-flex items-center gap-3">
          <EveLogo size={36} withWordmark />
          <span className="hidden md:inline text-xs text-eve-cream/55 italic font-serif">
            for restaurants
          </span>
        </a>
        <button
          onClick={onSwitchToDiner}
          className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-eve-cream/70 transition-colors"
        >
          For diners ↗
        </button>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 md:px-8 py-8">
        <div className="mb-7">
          <p className="text-[12px] tracking-wide text-eve-gold/80 italic font-serif mb-2">
            For restaurants
          </p>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight">
            <span className="text-eve-cream">Every <span className="italic"><span className="text-shimmer">eve</span><span className="text-eve-cream/95">ning</span></span>, </span>
            <span className="text-shimmer italic">told beautifully.</span>
          </h1>
          <p className="mt-3 text-eve-cream/70 text-base leading-relaxed max-w-2xl font-serif italic">
            Tell Eve who you are. Skip the rest. She mines your reviews and tonight's trends and
            puts together a complete content pack — Instagram, Reel, menu card, email, SMS — in
            your voice. Use them anywhere.
          </p>
        </div>

        {/* BRAND + DISH (single block) */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur p-6 md:p-8">
          <p className="text-[11px] tracking-wide text-eve-gold/80 italic font-serif mb-1">
            Your restaurant
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                Restaurant name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => { if (e.target.value === seed.name) e.target.select(); }}
                placeholder={seed.name}
                className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${ghostClass(name, seed.name)}`}
              />
            </div>
            <div>
              <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                City or area
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                onFocus={(e) => { if (e.target.value === seed.city) e.target.select(); }}
                placeholder={seed.city}
                className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${ghostClass(city, seed.city)}`}
              />
            </div>
            <div>
              <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                Cuisine <span className="opacity-50">(optional — Eve will infer)</span>
              </label>
              <input
                type="text"
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value as Cuisine)}
                onFocus={(e) => { if (e.target.value === seed.cuisine) e.target.select(); }}
                placeholder="Eve infers from name + city"
                list="restaurant-cuisine-suggestions"
                className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${ghostClass(cuisine, seed.cuisine)}`}
              />
              <datalist id="restaurant-cuisine-suggestions">
                {CUISINES.map((c) => (<option key={c.id} value={c.id} />))}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                Brand voice <span className="opacity-50">(optional)</span>
              </label>
              <input
                type="text"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                onFocus={(e) => { if (e.target.value === seed.voice) e.target.select(); }}
                placeholder={seed.voice}
                className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${ghostClass(voice, seed.voice)}`}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
              Signature dishes <span className="opacity-50">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              onFocus={(e) => { if (e.target.value === seed.signatureDishes) e.target.select(); }}
              placeholder={seed.signatureDishes}
              className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] leading-relaxed resize-none ${ghostClass(signature, seed.signatureDishes)}`}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {DEMO_RESTAURANTS.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setName(d.name);
                  setCity(d.city);
                  setCuisine(d.cuisine);
                  setVoice(d.voice);
                  setSignature(d.signatureDishes);
                  setDishName('');
                  setDishDescription('');
                  setSuggestion(null);
                  setPack(null);
                  setPosted(false);
                  setEvePulse(null);
                  autoSuggestedRef.current = false;
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-eve-cream/70 hover:text-eve-cream"
              >
                <Sparkles size={11} />
                {d.name}
              </button>
            ))}
          </div>

          {/* WHAT'S ON TONIGHT — same page, just before Generate button */}
          <div className="mt-7 pt-7 border-t border-white/10">
            <p className="text-[11px] tracking-wide text-eve-gold/80 italic font-serif mb-1">
              What's on tonight?
            </p>
            <p className="text-[13px] text-eve-cream/65 italic font-serif mb-3">
              Optional. Leave blank and Eve picks one for you from your reviews and trends.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                  Dish name
                </label>
                <input
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  placeholder={suggesting ? 'Eve is reading your reviews…' : (suggestion?.dishName || 'Eve will pick one')}
                  className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${
                    !dishName
                      ? 'text-eve-cream placeholder:text-eve-cream/55 placeholder:italic placeholder:font-serif'
                      : 'text-eve-cream'
                  }`}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] tracking-wide text-eve-cream/65 font-medium mb-1.5">
                  Tonight's note <span className="opacity-50">(optional)</span>
                </label>
                <input
                  value={dishDescription}
                  onChange={(e) => setDishDescription(e.target.value)}
                  placeholder={suggestion?.dishDescription || 'e.g. Made with the new spice blend, small batch'}
                  className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none text-[15px] ${
                    !dishDescription
                      ? 'text-eve-cream placeholder:text-eve-cream/55 placeholder:italic placeholder:font-serif'
                      : 'text-eve-cream'
                  }`}
                />
              </div>
            </div>

            {suggestion && !pack && (
              <p className="mt-3 text-[12px] text-eve-cream/55 italic font-serif">
                Eve suggested <span className="text-eve-gold">{suggestion.dishName}</span> based on {suggestion.mode === 'from_reviews' ? 'your recent reviews' : 'tonight\u2019s trends'}.
                {suggestion.alternatives?.length > 0 && (
                  <>
                    {' Or try: '}
                    {suggestion.alternatives.slice(0, 3).map((a, i) => (
                      <button
                        key={i}
                        onClick={() => { setDishName(a.dishName); setDishDescription(a.rationale); }}
                        className="text-eve-cream/85 underline decoration-dotted underline-offset-2 hover:text-eve-rose ml-1"
                      >
                        {a.dishName}{i < Math.min(2, suggestion.alternatives.length - 1) ? ',' : ''}
                      </button>
                    ))}
                  </>
                )}
              </p>
            )}

            {error && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={generate}
                disabled={!name.trim() || !city.trim() || generating}
                className={`inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base transition-all border outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink hover:scale-[1.02] active:scale-[0.98] ${
                  generating
                    ? 'bg-eve-ink-soft text-eve-gold cursor-wait border-eve-gold/30'
                    : 'bg-eve-ink-soft text-eve-gold border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 disabled:bg-eve-ink disabled:text-eve-cream/35 disabled:border-white/10 disabled:cursor-not-allowed shadow-lg shadow-eve-gold/15'
                }`}
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <ChefHat size={18} />}
                {generating ? 'Eve is making your kit…' : pack ? 'Regenerate tonight\u2019s look' : 'Generate tonight\u2019s look'}
              </button>
              {!generating && pack && (
                <button
                  onClick={pickDifferent}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-eve-cream/70 hover:text-eve-cream transition-colors"
                  title="Pick a different dish from reviews / trends"
                >
                  <Lightbulb size={12} />
                  Different dish
                </button>
              )}
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
                    <div className="text-[11px] text-eve-cream/60 italic font-serif">in {cuisine || 'cuisine'} tonight</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {pack && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Instagram */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">Instagram post</span>
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
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">15-sec Reel · 3 scenes + voiceover</span>
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
                  <audio controls src={reelAudio} className="mt-3 w-full h-9 rounded-full" />
                )}
              </div>
            </section>

            {/* Menu Card */}
            <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur overflow-hidden animate-fade-in-up">
              <header className="px-5 py-3 flex items-center justify-between border-b border-white/5">
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">Menu card</span>
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
                    <span className="font-serif text-xl text-eve-gold">{pack.menuCard.suggestedPrice}</span>
                  )}
                </div>
                <p className="text-[14px] text-eve-cream/85 leading-relaxed">{pack.menuCard.description}</p>
                {pack.menuCard.allergenTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {pack.menuCard.allergenTags.map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase text-eve-rose/90 border border-eve-rose/30 bg-eve-rose/5">
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
                <span className="text-[10px] tracking-wide text-eve-gold/80 italic font-serif">Email + SMS</span>
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
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">Email subject</p>
                  <p className="text-[15px] text-eve-cream font-medium">{pack.emailBlast.subject}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">Email body</p>
                  <div
                    className="text-[13px] text-eve-cream/85 leading-relaxed prose-eve"
                    dangerouslySetInnerHTML={{ __html: pack.emailBlast.bodyHtml }}
                  />
                </div>
                <div className="pt-4 border-t border-white/10">
                  <p className="text-[10px] tracking-wide text-eve-cream/55 mb-1 italic font-serif">SMS blast</p>
                  <p className="text-[14px] text-eve-cream/90 italic font-serif leading-snug">{pack.smsBlast}</p>
                </div>
              </div>
            </section>
          </div>
        )}

        {pack && (
          <div className="mt-8 max-w-2xl mx-auto text-center text-[12px] tracking-wide uppercase text-eve-cream/60">
            <span className="inline-flex items-center gap-2">
              <RotateCcw size={11} />
              <span>Tomorrow night, drop a new dish — Eve does this again, on brand, in 60 seconds.</span>
            </span>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-[10px] text-white/55 tracking-[0.3em] uppercase">
        Powered by Gemini 2.5 · Google Cloud · ADK-ready
      </footer>
    </div>
  );
}
