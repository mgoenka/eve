import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, RotateCcw, Play, Pause, VolumeX, Volume2, Store, ArrowUpRight, ArrowDownRight, Clock as ClockIcon, Leaf, Coins, Footprints } from 'lucide-react';
import {
  VIBES,
  DIETARY_PREFERENCES,
  CUISINES,
  SAMPLE_QUERIES,
} from '../constants';
import type { Vibe, DietaryPreference, ExperienceStop } from '../types';
import {
  planSkeleton,
  stopImage,
  narrationText,
  synthesize,
  listSpecials,
} from '../services/eveService';
import { StopCard } from './StopCard';

interface Props {
  onSwitchToRestaurant: () => void;
}

type Phase = 'input' | 'forging' | 'ready';

export function DinerView({ onSwitchToRestaurant }: Props) {
  const [phase, setPhase] = useState<Phase>('input');

  const [city, setCity] = useState('Santa Clara, CA');
  const [vibe, setVibe] = useState<Vibe>('date_night');
  const [party, setParty] = useState(2);
  const [dietary, setDietary] = useState<DietaryPreference[]>(['vegetarian']);
  const [budget, setBudget] = useState(200);
  const [cuisinePref, setCuisinePref] = useState('');
  const [freeText, setFreeText] = useState(
    'Indian or Italian dinner, dessert nearby, finish with a quiet garden walk under stringlights'
  );
  const [error, setError] = useState<string | null>(null);

  const [planTitle, setPlanTitle] = useState('');
  const [stops, setStops] = useState<ExperienceStop[]>([]);
  const [narrationAudio, setNarrationAudio] = useState<string | null>(null);
  const [narrationMime, setNarrationMime] = useState<string>('audio/mpeg');
  const [narrationText_, setNarrationText] = useState<string>('');
  const [groundedSources, setGroundedSources] = useState<string[]>([]);
  const [groundedSearchUsed, setGroundedSearchUsed] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setPhase('input');
    setStops([]);
    setPlanTitle('');
    setNarrationAudio(null);
    setNarrationText('');
    setPlaying(false);
    setError(null);
  }, []);

  const toggleDietary = (d: DietaryPreference) => {
    setDietary((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const applySample = (sampleId: string) => {
    const s = SAMPLE_QUERIES.find((q) => q.id === sampleId);
    if (!s) return;
    setCity(s.city);
    setVibe(s.vibe);
    setParty(s.party);
    setDietary(s.dietary);
    setBudget(s.budgetUSD);
    setFreeText(s.freeText);
  };

  const buildPlan = useCallback(async () => {
    if (!city.trim() || !freeText.trim()) {
      setError('Tell Eve where and what kind of night you want.');
      return;
    }
    cancelRef.current = false;
    setError(null);
    setPhase('forging');
    setPlanTitle('');
    setStops([]);
    setNarrationAudio(null);
    setNarrationText('');

    let skeleton: Awaited<ReturnType<typeof planSkeleton>>;
    try {
      skeleton = await planSkeleton({
        city,
        vibe,
        party,
        dietary,
        budgetUSD: budget,
        freeText,
        cuisinePref,
      });
    } catch (err: any) {
      setError(err?.message || 'Eve could not plan your night.');
      setPhase('input');
      return;
    }
    if (cancelRef.current) return;

    setPlanTitle(skeleton.title || 'A night, planned.');
    setGroundedSources(skeleton.groundedSources || []);
    setGroundedSearchUsed(!!skeleton.groundedSearchUsed);

    let evePosted: string[] = [];
    try {
      const res = await listSpecials(city.split(',')[0]);
      evePosted = (res.specials || []).map((s) => s.restaurantName.toLowerCase());
    } catch {}

    const initialStops: ExperienceStop[] = (skeleton.stops || []).map((s) => ({
      ...s,
      isEveOriginal:
        s.isEveOriginal ||
        evePosted.some((name) => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase())),
      status: 'pending',
    }));
    setStops(initialStops);
    setPhase('ready');

    for (let i = 0; i < initialStops.length; i++) {
      if (cancelRef.current) return;
      setStops((prev) =>
        prev.map((st, idx) => (idx === i ? { ...st, status: 'generating' } : st))
      );
      try {
        const img = await stopImage({
          name: initialStops[i].name,
          kind: initialStops[i].kind,
          oneLineVibe: initialStops[i].oneLineVibe,
          city,
          vibe,
        });
        if (cancelRef.current) return;
        setStops((prev) =>
          prev.map((st, idx) =>
            idx === i
              ? { ...st, imageData: img.imageData, imageMime: img.imageMime, status: 'ready' }
              : st
          )
        );
      } catch (err: any) {
        setStops((prev) =>
          prev.map((st, idx) =>
            idx === i
              ? { ...st, status: 'error', error: err?.message || 'Image failed' }
              : st
          )
        );
      }
    }

    if (cancelRef.current) return;

    try {
      const nText = await narrationText({
        title: skeleton.title,
        stops: initialStops as any,
        vibe,
      });
      if (cancelRef.current) return;
      setNarrationText(nText.narration || '');
      const audio = await synthesize(nText.narration, 'eve');
      if (cancelRef.current) return;
      setNarrationAudio(audio.audioData);
      setNarrationMime(audio.audioMime || 'audio/mpeg');
    } catch (err) {
      console.warn('narration audio skipped', err);
    }
  }, [city, vibe, party, dietary, budget, freeText, cuisinePref]);

  useEffect(() => {
    if (!narrationAudio || !audioRef.current) return;
    audioRef.current.src = `data:${narrationMime};base64,${narrationAudio}`;
  }, [narrationAudio, narrationMime]);

  const togglePlay = () => {
    if (!audioRef.current || !narrationAudio) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnd = () => setPlaying(false);
    a.addEventListener('ended', onEnd);
    return () => a.removeEventListener('ended', onEnd);
  }, []);

  if (phase === 'input') {
    return (
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="px-6 md:px-10 py-5 flex items-center justify-between">
          <div className="inline-flex items-center gap-3">
            <span className="font-serif italic text-3xl text-shimmer">eve</span>
          </div>
          <button
            onClick={onSwitchToRestaurant}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold bg-white/5 hover:bg-white/10 text-eve-cream/80 hover:text-eve-cream border border-white/10 transition-colors"
          >
            <Store size={14} />
            For restaurants
          </button>
        </header>

        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-6 md:py-12">
          <div className="text-center mb-10 md:mb-14">
            <p className="text-[11px] tracking-[0.4em] uppercase text-eve-gold/80 mb-4">
              The night, planned end-to-end
            </p>
            <h1 className="font-serif text-5xl md:text-7xl leading-[1.05]">
              <span className="text-eve-cream">A perfect </span>
              <span className="text-shimmer italic">eve.</span>
            </h1>
            <p className="mt-5 text-eve-cream/65 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              Tell Eve where you are and what kind of night you want. Get back a
              three-stop evening — dinner, the spot after, and the moment that closes it —
              illustrated, narrated, ready to live.
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                The vibe
              </label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {VIBES.map((v) => {
                  const active = v.id === vibe;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setVibe(v.id)}
                      className={`px-2 py-3 rounded-2xl border text-center transition-all ${
                        active
                          ? 'border-eve-gold bg-eve-gold/15 text-eve-cream'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/25 text-eve-cream/70'
                      }`}
                    >
                      <div className="text-base mb-0.5" style={{ color: active ? '#f5d896' : undefined }}>
                        {v.emoji}
                      </div>
                      <div className="font-serif text-sm md:text-base font-semibold">{v.label}</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-eve-cream/45 italic">
                {VIBES.find((v) => v.id === vibe)?.hint}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                  City / area
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Santa Clara, CA"
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base"
                />
              </div>
              <div>
                <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                  Party
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={party}
                  onChange={(e) => setParty(parseInt(e.target.value) || 1)}
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                  Cuisine preference (optional)
                </label>
                <select
                  value={cuisinePref}
                  onChange={(e) => setCuisinePref(e.target.value)}
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base text-eve-cream"
                >
                  <option value="">— let Eve decide —</option>
                  {CUISINES.map((c) => (
                    <option key={c.id} value={c.label} className="bg-eve-ink">
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                  Budget (USD, total)
                </label>
                <input
                  type="number"
                  min={50}
                  step={10}
                  value={budget}
                  onChange={(e) => setBudget(parseInt(e.target.value) || 50)}
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                Dietary
              </label>
              <div className="flex flex-wrap gap-2">
                {DIETARY_PREFERENCES.map((d) => {
                  const active = dietary.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => toggleDietary(d.id)}
                      className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                        active
                          ? 'bg-eve-rose/20 border border-eve-rose/60 text-eve-rose'
                          : 'bg-white/[0.04] border border-white/10 text-eve-cream/70 hover:border-white/20'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11px] tracking-[0.3em] uppercase text-eve-gold/70 mb-2">
                Tell Eve more
              </label>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="What kind of night do you want? Be specific. 'Vegetarian Indian dinner, dessert at a wine bar, walk through a garden under stringlights' — that kind of thing."
                rows={4}
                className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-[15px] leading-relaxed resize-none"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {SAMPLE_QUERIES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => applySample(s.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-medium text-eve-cream/70 hover:text-eve-cream transition-colors"
                  >
                    <Sparkles size={11} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <button
                onClick={buildPlan}
                disabled={!city.trim() || !freeText.trim()}
                className="group inline-flex items-center gap-3 px-9 py-4 rounded-full font-serif italic font-bold text-xl text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose hover:from-amber-100 hover:via-yellow-300 hover:to-rose-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_56px_rgba(245,216,150,0.40)] hover:shadow-[0_0_72px_rgba(232,163,158,0.55)]"
              >
                <Wand2 size={20} />
                Plan my night
              </button>
            </div>
          </div>
        </main>

        <footer className="text-center py-6 text-[10px] text-white/30 tracking-[0.3em] uppercase">
          Gemini 2.5 · Google Cloud · ADK-ready
        </footer>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <audio ref={audioRef} preload="auto" muted={muted} />

      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-white/5">
        <button onClick={reset} className="font-serif italic text-2xl text-shimmer">
          eve
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-eve-cream/80"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={reset}
            className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-xs font-semibold inline-flex items-center gap-1.5 text-eve-cream/80"
          >
            <RotateCcw size={14} /> New night
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 py-8">
        <div className="text-center mb-8">
          <p className="text-[11px] tracking-[0.35em] uppercase text-eve-gold/70 mb-2">
            Your eve is forging
          </p>
          <h2 className="font-serif italic text-3xl md:text-5xl leading-tight text-eve-cream">
            {planTitle || '…'}
          </h2>
          <p className="mt-2 text-eve-cream/55 text-sm">{city}</p>
          {groundedSearchUsed && (
            <p className="mt-3 text-[10px] tracking-[0.3em] uppercase text-eve-rose/85 inline-flex items-center gap-1.5">
              <Sparkles size={10} />
              {groundedSources.length > 0
                ? `Grounded via Google Search · ${groundedSources.length} sources`
                : 'Grounded via Google Search'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {stops.map((stop, i) => (
            <StopCard key={`${stop.name}-${i}`} stop={stop} index={i} city={city} />
          ))}
        </div>

        {stops.length >= 2 && stops.every((s) => s.status === 'ready') && (
          <div className="mt-6 flex justify-center">
            <a
              href={`https://www.google.com/maps/dir/${stops
                .map((s) => encodeURIComponent(`${s.name} ${city}`))
                .join('/')}/?travelmode=walking`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-eve-gold/15 hover:bg-eve-gold/25 border border-eve-gold/40 text-eve-gold text-sm font-semibold transition-colors"
            >
              <Footprints size={14} />
              Open the whole night on Google Maps
            </a>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[10px] tracking-[0.3em] uppercase text-eve-cream/40 mr-1">
            Tweak the night
          </span>
          {[
            { label: 'Make it more upscale', emoji: ArrowUpRight, suffix: ' Make every stop more upscale and refined.', cls: 'amber' },
            { label: 'Make it more casual', emoji: ArrowDownRight, suffix: ' Make every stop more casual and easygoing.', cls: 'rose' },
            { label: 'Earlier night', emoji: ClockIcon, suffix: ' Shift the entire night earlier — start by 6 PM.', cls: 'gold' },
            { label: 'Vegan only', emoji: Leaf, suffix: ' Strictly vegan across all stops including the dessert.', cls: 'emerald' },
            { label: 'Cheaper', emoji: Coins, suffix: ' Cut the budget roughly in half. Find quality at a lower price band.', cls: 'sky' },
          ].map((chip) => {
            const Icon = chip.emoji;
            return (
              <button
                key={chip.label}
                onClick={() => {
                  setFreeText((prev) => (prev || '') + chip.suffix);
                  setTimeout(() => buildPlan(), 0);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-eve-gold/40 text-xs font-medium text-eve-cream/80 hover:text-eve-cream transition-colors"
              >
                <Icon size={11} />
                {chip.label}
              </button>
            );
          })}
        </div>

        {narrationAudio && (
          <div className="mt-10 max-w-2xl mx-auto p-5 rounded-3xl bg-gradient-to-br from-eve-plum/40 to-eve-ink/40 border border-eve-gold/25 backdrop-blur animate-fade-in">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-12 h-12 rounded-full bg-eve-gold text-eve-ink hover:bg-amber-200 transition-all flex items-center justify-center animate-glow-pulse"
              >
                {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-[10px] tracking-[0.3em] uppercase text-eve-gold/80 mb-0.5">
                  Eve narrates your night
                </p>
                <p className="text-[14px] text-eve-cream/85 italic font-serif leading-snug line-clamp-2">
                  {narrationText_}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-[10px] text-white/25 tracking-[0.3em] uppercase">
        Powered by Gemini 2.5 · Google Cloud · ADK-ready
      </footer>
    </div>
  );
}
