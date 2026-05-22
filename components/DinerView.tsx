import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Wand2,
  RotateCcw,
  Play,
  Pause,
  VolumeX,
  Volume2,
  Store,
  ArrowUpRight,
  ArrowDownRight,
  Clock as ClockIcon,
  Leaf,
  Coins,
  Footprints,
  Shuffle,
  MapPin,
  Loader2,
  Send,
  Share2,
  Check,
  Wind,
  Heart,
  Mic,
  MicOff,
} from 'lucide-react';
import {
  VIBES,
  DIETARY_PREFERENCES,
  CUISINES,
  SAMPLE_QUERIES,
} from '../constants';
import type { Vibe, DietaryPreference, ExperienceStop, EveStory } from '../types';
import {
  planSkeleton,
  stopImage,
  narrationText,
  synthesize,
  listSpecials,
  eveIntro,
  eveOutro,
  eveStory,
  eveRefine,
  reverseGeocode,
  eveAvatar,
} from '../services/eveService';
import { StopCard } from './StopCard';
import { EveLogo } from './EveLogo';

interface Props {
  onSwitchToRestaurant: () => void;
}

type Phase = 'input' | 'forging' | 'ready';

interface ChatMessage {
  role: 'user' | 'eve';
  text: string;
}

const SURPRISE_VIBES: Vibe[] = ['date_night', 'casual', 'celebrating', 'friends'];
const SURPRISE_FREETEXT = [
  'Surprise me. Pick the dish, pick the dessert, pick the closer.',
  'I trust you. Find me a memorable evening around here.',
  'Pick something locals love. Walkable. Nothing touristy.',
  'Make it interesting. Mix something old with something new.',
];

const SUGGESTED_CITY = 'Santa Clara, CA';

// CSS-utility helper: when the input's current value still matches the suggested default,
// render the text in italic-serif faded style so it reads as a placeholder hint
// rather than as committed text. The moment the user edits, styling snaps to plain.
function ghostIf(value: string, suggestion: string): string {
  return value === suggestion
    ? 'text-eve-cream/45 italic font-serif placeholder:text-eve-cream/30'
    : 'text-eve-cream placeholder:text-eve-cream/30 placeholder:italic placeholder:font-serif';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T18:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Tonight';
  if (diffDays === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function readURLParams() {
  if (typeof window === 'undefined') return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has('plan')) return null;
    const json = sp.get('plan');
    if (!json) return null;
    return JSON.parse(decodeURIComponent(atob(json)));
  } catch {
    return null;
  }
}

function buildShareURL(state: any): string {
  if (typeof window === 'undefined') return '';
  const json = btoa(encodeURIComponent(JSON.stringify(state)));
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('plan', json);
  return url.toString();
}

export function DinerView({ onSwitchToRestaurant }: Props) {
  const initial = readURLParams();

  const [phase, setPhase] = useState<Phase>('input');

  const [city, setCity] = useState(initial?.city || SUGGESTED_CITY);
  const [vibe, setVibe] = useState<Vibe>(initial?.vibe || 'date_night');
  const [party, setParty] = useState<number>(initial?.party || 2);
  const [dietary, setDietary] = useState<DietaryPreference[]>(initial?.dietary || ['vegetarian']);
  const [budgetPerPerson, setBudgetPerPerson] = useState<number>(initial?.budgetPerPerson || 100);
  const [cuisinePref, setCuisinePref] = useState(initial?.cuisinePref || '');
  const [whenISO, setWhenISO] = useState(initial?.whenISO || todayISO());
  const [freeText, setFreeText] = useState(initial?.freeText || '');
  const [error, setError] = useState<string | null>(null);

  const [planTitle, setPlanTitle] = useState('');
  const [stops, setStops] = useState<ExperienceStop[]>([]);
  const [story, setStory] = useState<EveStory | null>(null);
  const [narrationAudio, setNarrationAudio] = useState<string | null>(null);
  const [narrationMime, setNarrationMime] = useState<string>('audio/mpeg');
  const [narrationText_, setNarrationText] = useState<string>('');
  const [groundedSearchUsed, setGroundedSearchUsed] = useState(false);
  const [groundedSources, setGroundedSources] = useState<string[]>([]);

  const [eveIntroText, setEveIntroText] = useState('');
  const [eveOutroText, setEveOutroText] = useState('');
  const [eveSpeaking, setEveSpeaking] = useState(false);
  const [eveAvatarUrl, setEveAvatarUrl] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [refining, setRefining] = useState(false);

  const [locating, setLocating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef('');

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eveAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (eveAudioRef.current) {
      eveAudioRef.current.pause();
      eveAudioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && window.location.search) {
      const u = new URL(window.location.href);
      u.search = '';
      window.history.replaceState({}, '', u.toString());
    }
    setPhase('input');
    setStops([]);
    setStory(null);
    setPlanTitle('');
    setNarrationAudio(null);
    setNarrationText('');
    setEveIntroText('');
    setEveOutroText('');
    setChatHistory([]);
    setChatInput('');
    setPlaying(false);
    setError(null);
  }, []);

  const toggleDietary = (d: DietaryPreference) => {
    setDietary((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const applySample = (sampleId: string) => {
    const s = SAMPLE_QUERIES.find((q) => q.id === sampleId);
    if (!s) return;
    setCity(s.city);
    setVibe(s.vibe);
    setParty(s.party);
    setDietary(s.dietary);
    setBudgetPerPerson(Math.round(s.budgetUSD / s.party));
    setFreeText(s.freeText);
  };

  // ----- Voice input via Web Speech API: set up the recognizer once -----
  useEffect(() => {
    const SR =
      (typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setVoiceUnsupported(true);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript + ' ';
      }
      const fullText = (baseTextRef.current ? baseTextRef.current + ' ' : '') + transcript.trim();
      setVoiceTranscript(transcript.trim());
      setFreeText(fullText);
    };
    rec.onend = () => setVoiceListening(false);
    rec.onerror = () => setVoiceListening(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, []);

  const detectLocation = useCallback(async () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 5 * 60 * 1000,
        });
      });
      try {
        const { city: resolved } = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (resolved && resolved.length < 80) {
          setCity(resolved);
        } else {
          setCity(`${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`);
        }
      } catch {
        setCity(`${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`);
      }
    } catch {
      // user denied
    } finally {
      setLocating(false);
    }
  }, []);

  const speakAsEve = useCallback(
    async (text: string) => {
      if (!text || muted) return;
      setEveSpeaking(true);
      try {
        const audio = await synthesize(text, 'eve');
        const a = eveAudioRef.current;
        if (!a) return;
        a.src = `data:${audio.audioMime || 'audio/mpeg'};base64,${audio.audioData}`;
        a.currentTime = 0;
        await a.play().catch(() => {});
      } catch {
        // silent
      }
    },
    [muted]
  );

  // Plays a line and resolves only when audio finishes (or 8s timeout).
  // Used during the "Eve thinking out loud" sequence so phrases don't overlap.
  const speakAsEveAndWait = useCallback(
    async (text: string) => {
      if (!text || muted) return;
      setEveSpeaking(true);
      try {
        const audio = await synthesize(text, 'eve');
        const a = eveAudioRef.current;
        if (!a) return;
        a.src = `data:${audio.audioMime || 'audio/mpeg'};base64,${audio.audioData}`;
        a.currentTime = 0;
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            a.removeEventListener('ended', finish);
            resolve();
          };
          a.addEventListener('ended', finish, { once: true });
          a.play().catch(() => finish());
          setTimeout(finish, 8000);
        });
      } catch {
        // silent
      } finally {
        setEveSpeaking(false);
      }
    },
    [muted]
  );

  useEffect(() => {
    const a = eveAudioRef.current;
    if (!a) return;
    const onEnd = () => setEveSpeaking(false);
    a.addEventListener('ended', onEnd);
    return () => a.removeEventListener('ended', onEnd);
  }, []);

  const buildPlan = useCallback(
    async (
      overrides: Partial<{
        city: string;
        vibe: Vibe;
        freeText: string;
        party: number;
        dietary: DietaryPreference[];
      }> = {}
    ) => {
      const useCity = (overrides.city ?? city).trim();
      const useVibe = overrides.vibe ?? vibe;
      const useFreeText = (overrides.freeText ?? freeText).trim();
      const useParty = overrides.party ?? party;
      const useDietary = overrides.dietary ?? dietary;

      if (!useCity) {
        setError('Tell Eve where you are.');
        return;
      }
      cancelRef.current = false;
      setError(null);
      setPhase('forging');
      setPlanTitle('');
      setStops([]);
      setStory(null);
      setNarrationAudio(null);
      setNarrationText('');
      setEveIntroText('');
      setEveOutroText('');
      setChatHistory([]);

      // Stream of Eve's progress phrases during planning. We sequence them
      // through TTS so she's audibly thinking out loud while the plan loads.
      eveIntro({ vibe: useVibe, city: useCity, party: useParty, freeText: useFreeText })
        .then(async (r) => {
          const lines = r.lines && r.lines.length > 0 ? r.lines : r.intro ? [r.intro] : [];
          if (lines.length === 0) return;
          setEveIntroText(lines[0] || '');

          for (const line of lines) {
            if (cancelRef.current) return;
            setEveIntroText(line);
            try {
              await speakAsEveAndWait(line);
            } catch {}
            if (cancelRef.current) return;
            // Small pause between thoughts so it feels human
            await new Promise((r) => setTimeout(r, 180));
          }
        })
        .catch(() => {});

      // Avatar fetch in parallel — cache for the session
      if (!eveAvatarUrl) {
        eveAvatar('devoted')
          .then((a) => {
            const url = `data:${a.imageMime || 'image/png'};base64,${a.imageData}`;
            setEveAvatarUrl(url);
          })
          .catch(() => {});
      }

      let skeleton: Awaited<ReturnType<typeof planSkeleton>>;
      try {
        skeleton = await planSkeleton({
          city: useCity,
          vibe: useVibe,
          party: useParty,
          dietary: useDietary,
          budgetPerPersonUSD: budgetPerPerson,
          freeText: useFreeText || 'Eve, surprise me.',
          cuisinePref,
          whenISO,
        });
      } catch (err: any) {
        setError(err?.message || 'Eve could not plan your evening.');
        setPhase('input');
        return;
      }
      if (cancelRef.current) return;

      setPlanTitle(skeleton.title || 'A planned evening.');
      setGroundedSources(skeleton.groundedSources || []);
      setGroundedSearchUsed(!!skeleton.groundedSearchUsed);

      let evePosted: string[] = [];
      try {
        const res = await listSpecials(useCity.split(',')[0]);
        evePosted = (res.specials || []).map((s) => s.restaurantName.toLowerCase());
      } catch {}

      const initialStops: ExperienceStop[] = (skeleton.stops || []).map((s) => ({
        ...s,
        isEveOriginal:
          s.isEveOriginal ||
          evePosted.some(
            (name) => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase())
          ),
        status: 'pending',
      }));
      setStops(initialStops);
      setPhase('ready');

      // Story (parallel with images)
      eveStory({
        title: skeleton.title,
        stops: initialStops.map((s) => ({
          name: s.name,
          kind: s.kind,
          oneLineVibe: s.oneLineVibe,
          signatureItem: s.signatureItem,
        })),
        vibe: useVibe,
        city: useCity,
        party: useParty,
      })
        .then((s) => {
          if (!cancelRef.current) setStory(s);
        })
        .catch(() => {});

      // Mark all stops as generating, then fan out images in parallel
      setStops((prev) => prev.map((st) => ({ ...st, status: 'generating' })));
      await Promise.all(
        initialStops.map(async (stop, i) => {
          if (cancelRef.current) return;
          try {
            const img = await stopImage({
              name: stop.name,
              kind: stop.kind,
              oneLineVibe: stop.oneLineVibe,
              city: useCity,
              vibe: useVibe,
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
                idx === i ? { ...st, status: 'error', error: err?.message || 'Image failed' } : st
              )
            );
          }
        })
      );

      if (cancelRef.current) return;

      try {
        const nText = await narrationText({
          title: skeleton.title,
          stops: initialStops as any,
          vibe: useVibe,
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

      try {
        const o = await eveOutro({
          vibe: useVibe,
          city: useCity,
          stops: initialStops.map((s) => ({ name: s.name, kind: s.kind })),
        });
        setEveOutroText(o.outro || '');
        if (o.outro) {
          setTimeout(() => speakAsEve(o.outro), 800);
        }
      } catch {}
    },
    [city, vibe, party, dietary, budgetPerPerson, freeText, cuisinePref, whenISO, speakAsEve]
  );

  const toggleVoiceListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (voiceListening) {
      try {
        rec.stop();
      } catch {}
      setVoiceListening(false);
      return;
    }
    baseTextRef.current = freeText;
    setVoiceTranscript('');
    try {
      rec.start();
      setVoiceListening(true);
    } catch {
      setVoiceListening(false);
    }
  }, [voiceListening, freeText]);

  const tellEveByVoice = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) {
      buildPlan();
      return;
    }
    if (voiceListening) {
      try {
        rec.stop();
      } catch {}
      setVoiceListening(false);
      setTimeout(() => buildPlan({ freeText }), 250);
    } else {
      baseTextRef.current = freeText;
      setVoiceTranscript('');
      try {
        rec.start();
        setVoiceListening(true);
      } catch {}
    }
  }, [voiceListening, freeText, buildPlan]);

  const surpriseMe = useCallback(() => {
    // Honor whatever the user has already filled out.
    // Only randomize the things they haven't touched.
    const useVibe: Vibe = vibe; // keep their vibe selection
    const useFreeText = freeText.trim()
      ? freeText
      : pickRandom(SURPRISE_FREETEXT);
    buildPlan({ vibe: useVibe, freeText: useFreeText });
  }, [buildPlan, vibe, freeText]);

  const sendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || refining) return;
    setChatInput('');
    setChatHistory((h) => [...h, { role: 'user', text: msg }]);
    setRefining(true);

    try {
      const previousPlan = {
        stops: stops.map((s) => ({ name: s.name, kind: s.kind, oneLineVibe: s.oneLineVibe })),
      };
      const result = await eveRefine({
        message: msg,
        previousPlan,
        vibe,
        city,
        dietary,
        party,
        budgetUSD: budgetPerPerson * party,
      });

      setChatHistory((h) => [...h, { role: 'eve', text: result.spokenReply }]);
      if (result.spokenReply) speakAsEve(result.spokenReply);

      if (result.stops?.length) {
        setPlanTitle(result.title || planTitle);
        const newStops: ExperienceStop[] = result.stops.map((s) => ({
          kind: s.kind as any,
          name: s.name,
          oneLineVibe: s.oneLineVibe,
          whyThisFits: s.whyThisFits,
          approxArrival: s.approxArrival,
          durationMinutes: s.durationMinutes || 60,
          walkMinutesFromPrev: s.walkMinutesFromPrev || 0,
          signatureItem: s.signatureItem,
          isEveOriginal: !!s.isEveOriginal,
          status: 'pending',
        }));
        setStops(newStops);

        // refresh story
        eveStory({
          title: result.title || planTitle,
          stops: newStops.map((s) => ({
            name: s.name,
            kind: s.kind,
            oneLineVibe: s.oneLineVibe,
            signatureItem: s.signatureItem,
          })),
          vibe,
          city,
          party,
        })
          .then(setStory)
          .catch(() => {});

        setStops((prev) => prev.map((st) => ({ ...st, status: 'generating' })));
        await Promise.all(
          newStops.map(async (stop, i) => {
            try {
              const img = await stopImage({
                name: stop.name,
                kind: stop.kind,
                oneLineVibe: stop.oneLineVibe,
                city,
                vibe,
              });
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
                  idx === i ? { ...st, status: 'error', error: err?.message || 'Image failed' } : st
                )
              );
            }
          })
        );
      }
    } catch (err: any) {
      setChatHistory((h) => [
        ...h,
        { role: 'eve', text: 'Sorry, I lost my train of thought. Try that again?' },
      ]);
    } finally {
      setRefining(false);
    }
  }, [chatInput, refining, stops, vibe, city, dietary, party, budgetPerPerson, planTitle, speakAsEve]);

  const sharePlan = useCallback(async () => {
    const url = buildShareURL({
      city,
      vibe,
      party,
      dietary,
      budgetPerPerson,
      cuisinePref,
      whenISO,
      freeText,
    });
    try {
      const navAny = navigator as any;
      if (navAny.share) {
        await navAny.share({
          title: planTitle || 'My evening on Eve',
          text: planTitle ? `${planTitle} — planned by Eve` : 'Planned by Eve',
          url,
        });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2400);
    } catch {}
  }, [city, vibe, party, dietary, budgetPerPerson, cuisinePref, whenISO, freeText, planTitle]);

  useEffect(() => {
    if (!narrationAudio || !audioRef.current) return;
    audioRef.current.src = `data:${narrationMime};base64,${narrationAudio}`;
    // Auto-play unless muted — Eve narrates the planned evening as soon as it's ready
    if (!muted) {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [narrationAudio, narrationMime, muted]);

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
        <audio ref={eveAudioRef} preload="auto" muted={muted} />
        <header className="px-6 md:px-10 py-5 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2 group">
            <EveLogo size={42} withWordmark />
          </a>
          <button
            onClick={onSwitchToRestaurant}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 text-eve-cream/80 hover:text-eve-cream border border-white/10 transition-colors"
          >
            <Store size={14} />
            For restaurants
          </button>
        </header>

        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-6 md:py-12">
          <div className="text-center mb-8 md:mb-10">
            <p className="text-[12px] tracking-wider text-eve-gold/85 mb-3 italic font-serif">
              Hi, I'm <span className="text-shimmer not-italic font-semibold">Eve</span>.
            </p>
            <h1 className="font-serif text-5xl md:text-7xl leading-[1.0]">
              <span className="text-eve-cream">A perfect </span>
              <span className="italic"><span className="text-shimmer">Eve</span><span className="text-eve-cream/95">ning.</span></span>
            </h1>
            <p className="mt-5 text-eve-cream/65 text-base md:text-lg max-w-2xl mx-auto leading-relaxed font-serif italic">
              Tell me what kind of <span className="text-shimmer not-italic">Eve</span>ning you want.
              Or hit <em className="not-italic font-semibold text-eve-gold">Surprise Me</em>,
              I'll find you somewhere good.
            </p>
            <p className="mt-2 text-[12px] tracking-wider text-eve-rose/80 italic font-serif">
              Yours, quietly.
            </p>
          </div>

          <div className="flex justify-center gap-3 mb-7 flex-wrap">
            {!voiceUnsupported && (
              <button
                onClick={tellEveByVoice}
                className={`group inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full font-serif italic font-bold text-lg transition-all border ${
                  voiceListening
                    ? 'bg-eve-rose/25 text-eve-rose border-eve-rose/60 animate-glow-pulse'
                    : 'bg-white/[0.04] text-eve-cream border-eve-rose/40 hover:bg-eve-rose/15 hover:text-eve-rose'
                }`}
              >
                {voiceListening ? <MicOff size={18} /> : <Mic size={18} />}
                {voiceListening ? 'Listening…' : 'Tell Eve'}
              </button>
            )}
            <button
              onClick={surpriseMe}
              className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full font-serif italic font-bold text-lg text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose hover:from-amber-100 hover:via-yellow-300 hover:to-rose-300 transition-all shadow-[0_0_44px_rgba(245,216,150,0.40)] hover:shadow-[0_0_60px_rgba(232,163,158,0.55)]"
            >
              <Shuffle size={18} />
              Surprise Me
            </button>
          </div>

          {voiceListening && voiceTranscript && (
            <div className="max-w-xl mx-auto mb-5 px-4 py-3 rounded-2xl border border-eve-rose/35 bg-eve-rose/5 text-center animate-fade-in">
              <p className="text-[10px] tracking-wide text-eve-rose/85 mb-1 italic font-serif inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-eve-rose animate-pulse" />
                Eve hears you
              </p>
              <p className="font-serif italic text-base text-eve-cream/90">"{voiceTranscript}"</p>
            </div>
          )}

          <div className="text-center text-[12px] tracking-wider text-eve-cream/40 italic font-serif mb-5">
            or, tell Eve more
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
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
                      <div
                        className="text-base mb-0.5"
                        style={{ color: active ? '#f5d896' : undefined }}
                      >
                        {v.emoji}
                      </div>
                      <div className="font-serif text-sm md:text-base font-semibold">
                        {v.label}
                      </div>
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
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  City or area
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={SUGGESTED_CITY}
                    className={`w-full px-5 py-3.5 pr-14 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base ${ghostIf(city, SUGGESTED_CITY)}`}
                  />
                  <button
                    onClick={detectLocation}
                    disabled={locating}
                    title="Use my location"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-eve-gold/15 hover:bg-eve-gold/25 text-eve-gold disabled:opacity-50 transition-colors"
                  >
                    {locating ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  When
                </label>
                <input
                  type="date"
                  value={whenISO}
                  min={todayISO()}
                  onChange={(e) => setWhenISO(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base text-eve-cream"
                />
                <p className="mt-1 text-[11px] text-eve-cream/45 italic font-serif">
                  {formatDate(whenISO)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
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
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  Cuisine
                </label>
                <input
                  type="text"
                  value={cuisinePref}
                  onChange={(e) => setCuisinePref(e.target.value)}
                  placeholder="any cuisine, or pick from below"
                  list="cuisine-suggestions"
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base placeholder:text-eve-cream/30 placeholder:italic placeholder:font-serif"
                />
                <datalist id="cuisine-suggestions">
                  {CUISINES.map((c) => (
                    <option key={c.id} value={c.label} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  Budget per person
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-eve-cream/50">$</span>
                  <input
                    type="number"
                    min={20}
                    step={10}
                    value={budgetPerPerson}
                    onChange={(e) => setBudgetPerPerson(parseInt(e.target.value) || 50)}
                    className="w-full pl-8 pr-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base"
                  />
                </div>
                <p className="mt-1 text-[11px] text-eve-cream/45 italic font-serif">
                  ~${budgetPerPerson * party} for {party}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[12px] tracking-wide text-eve-gold/80 font-medium">
                  Tell Eve more (optional)
                </label>
                {!voiceUnsupported && (
                  <button
                    onClick={toggleVoiceListening}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
                      voiceListening
                        ? 'bg-eve-rose/20 text-eve-rose border border-eve-rose/50'
                        : 'bg-white/[0.04] text-eve-cream/70 border border-white/10 hover:border-eve-rose/40'
                    }`}
                  >
                    {voiceListening ? <MicOff size={11} /> : <Mic size={11} />}
                    {voiceListening ? 'Stop' : 'Speak'}
                  </button>
                )}
              </div>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Indian or Italian dinner, dessert nearby, then a quiet garden walk under stringlights..."
                rows={3}
                className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-[15px] leading-relaxed resize-none placeholder:text-eve-cream/30 placeholder:italic placeholder:font-serif"
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
                onClick={() => buildPlan()}
                disabled={!city.trim()}
                className="group inline-flex items-center gap-3 px-9 py-4 rounded-full font-serif italic font-bold text-xl text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose hover:from-amber-100 hover:via-yellow-300 hover:to-rose-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_56px_rgba(245,216,150,0.40)] hover:shadow-[0_0_72px_rgba(232,163,158,0.55)]"
              >
                <Wand2 size={20} />
                Plan my evening
              </button>
            </div>
          </div>
        </main>

        <footer className="text-center py-6 text-[11px] text-white/35 italic font-serif">
          Gemini 2.5 · Google Search · Cloud TTS · Maps
        </footer>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <audio ref={audioRef} preload="auto" muted={muted} />
      <audio ref={eveAudioRef} preload="auto" muted={muted} />

      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-white/5">
        <button onClick={reset} className="inline-flex items-center gap-2">
          <EveLogo size={36} withWordmark />
        </button>
        <div className="flex items-center gap-2">
          {phase === 'ready' && stops.length > 0 && (
            <button
              onClick={sharePlan}
              title="Share this evening"
              className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-xs font-medium inline-flex items-center gap-1.5 text-eve-cream/80"
            >
              {shareCopied ? <Check size={14} /> : <Share2 size={14} />}
              {shareCopied ? 'Copied' : 'Share'}
            </button>
          )}
          <button
            onClick={() => setMuted((m) => !m)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-eve-cream/80"
            title={muted ? 'Unmute Eve' : 'Mute Eve'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={reset}
            className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-xs font-medium inline-flex items-center gap-1.5 text-eve-cream/80"
          >
            <RotateCcw size={14} /> New evening
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 md:px-8 py-8">
        <div className="text-center mb-6">
          <p className="text-[12px] tracking-wide text-eve-gold/75 mb-2 italic font-serif">
            {phase === 'forging' ? (
              <><span className="text-shimmer not-italic font-semibold">Eve</span> is planning</>
            ) : (
              <>Your <span className="text-shimmer not-italic">Eve</span>ning</>
            )}
          </p>
          <h2 className="font-serif italic text-3xl md:text-5xl leading-tight text-eve-cream">
            {planTitle || '…'}
          </h2>
          <p className="mt-2 text-eve-cream/55 text-sm italic font-serif">
            {city} · {formatDate(whenISO)}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {groundedSearchUsed && (
              <span className="text-[10px] tracking-wide text-eve-rose/85 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-eve-rose/10 border border-eve-rose/20">
                <Sparkles size={10} />
                Verified via Google Search
                {groundedSources.length > 0 ? ` · ${groundedSources.length}` : ''}
              </span>
            )}
            {story?.moodArc && (
              <span className="text-[10px] tracking-wide text-eve-gold/85 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-eve-gold/10 border border-eve-gold/30 italic font-serif">
                <Heart size={10} />
                {story.moodArc}
              </span>
            )}
            {story?.weatherCue && (
              <span className="text-[10px] tracking-wide text-eve-cream/65 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 italic font-serif">
                <Wind size={10} />
                {story.weatherCue}
              </span>
            )}
          </div>
        </div>

        {(eveIntroText || eveOutroText) && (
          <div className="max-w-2xl mx-auto mb-8 px-5 py-4 rounded-2xl bg-gradient-to-br from-eve-rose/10 to-eve-plum/10 border border-eve-gold/25 animate-fade-in">
            <div className="flex items-start gap-4">
              {eveAvatarUrl && (
                <img
                  src={eveAvatarUrl}
                  alt="Eve"
                  className={`flex-shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-full object-cover ring-2 transition-all ${
                    eveSpeaking ? 'ring-eve-rose/70 animate-glow-pulse' : 'ring-eve-gold/40'
                  }`}
                />
              )}
              <div className="flex-1 text-center md:text-left">
                <p className="text-[11px] tracking-wide text-eve-gold/80 mb-1.5 inline-flex items-center gap-1.5 italic font-serif">
                  {eveSpeaking ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-eve-rose animate-pulse" />
                      Eve is speaking
                    </>
                  ) : (
                    <>Eve says</>
                  )}
                </p>
                <p className="font-serif italic text-lg md:text-xl text-eve-cream leading-snug">
                  "{eveOutroText || eveIntroText}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STORY-DRIVEN VERTICAL FLOW */}
        <div className="max-w-3xl mx-auto space-y-6">
          {story?.opening && (
            <div className="text-center px-4 animate-fade-in-up">
              <p className="font-serif italic text-lg md:text-xl text-eve-cream/85 leading-relaxed">
                {story.opening}
              </p>
            </div>
          )}

          {stops.map((stop, i) => {
            const sceneText =
              i === 0 ? story?.atStop1 : i === 1 ? story?.atStop2 : i === 2 ? story?.atStop3 : '';
            const transitionText =
              i === 1 ? story?.transition1to2 : i === 2 ? story?.transition2to3 : '';
            return (
              <div key={`${stop.name}-${i}`} className="space-y-4">
                {transitionText && (
                  <div className="flex items-center gap-3 max-w-xl mx-auto px-4 animate-fade-in">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-eve-gold/30 to-transparent" />
                    <p className="font-serif italic text-sm text-eve-cream/55 leading-snug text-center max-w-md">
                      {transitionText}
                    </p>
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-eve-gold/30 to-transparent" />
                  </div>
                )}
                <StopCard stop={stop} index={i} city={city} />
                {sceneText && (
                  <div className="px-4 max-w-2xl mx-auto animate-fade-in">
                    <p className="font-serif italic text-base md:text-lg text-eve-cream/80 leading-relaxed text-center">
                      {sceneText}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {story?.closing && (
            <div className="text-center px-4 pt-2 animate-fade-in-up">
              <p className="font-serif italic text-lg md:text-xl text-shimmer leading-relaxed">
                {story.closing}
              </p>
            </div>
          )}
        </div>

        {stops.length >= 2 && stops.every((s) => s.status === 'ready') && (
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            <a
              href={`https://www.google.com/maps/dir/${stops
                .map((s) => encodeURIComponent(`${s.name} ${city}`))
                .join('/')}/?travelmode=walking`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-eve-gold/15 hover:bg-eve-gold/25 border border-eve-gold/40 text-eve-gold text-sm font-medium transition-colors"
            >
              <Footprints size={14} />
              Open the whole evening on Google Maps
            </a>
            {stops.find((s) => s.kind === 'dinner') && (
              <a
                href={`https://www.opentable.com/s?text=${encodeURIComponent(stops.find((s) => s.kind === 'dinner')!.name)}&covers=${party}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-eve-rose/15 hover:bg-eve-rose/25 border border-eve-rose/40 text-eve-rose text-sm font-medium transition-colors"
              >
                Reserve dinner on OpenTable
              </a>
            )}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[12px] text-eve-cream/45 italic font-serif mr-1">
            Tweak the evening
          </span>
          {[
            { label: 'More upscale', icon: ArrowUpRight, suffix: ' Make every stop more upscale and refined.' },
            { label: 'More casual', icon: ArrowDownRight, suffix: ' Make every stop more casual and easygoing.' },
            { label: 'Earlier', icon: ClockIcon, suffix: ' Shift the entire evening earlier — start by 6 PM.' },
            { label: 'Vegan only', icon: Leaf, suffix: ' Strictly vegan across all stops.' },
            { label: 'Cheaper', icon: Coins, suffix: ' Cut the budget roughly in half.' },
          ].map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                onClick={() => {
                  const newFreeText = (freeText || '') + chip.suffix;
                  setFreeText(newFreeText);
                  setTimeout(() => buildPlan({ freeText: newFreeText }), 0);
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
          <div className="mt-8 max-w-2xl mx-auto p-5 rounded-3xl bg-gradient-to-br from-eve-plum/40 to-eve-ink/40 border border-eve-gold/25 backdrop-blur animate-fade-in">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-12 h-12 rounded-full bg-eve-gold text-eve-ink hover:bg-amber-200 transition-all flex items-center justify-center animate-glow-pulse"
              >
                {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-[11px] text-eve-gold/80 mb-0.5 italic font-serif">
                  Eve narrates your evening
                </p>
                <p className="text-[14px] text-eve-cream/85 italic font-serif leading-snug line-clamp-2">
                  {narrationText_}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 max-w-2xl mx-auto">
          <p className="text-center text-[12px] text-eve-gold/75 mb-3 italic font-serif">
            Ask Eve anything about your evening
          </p>
          {chatHistory.length > 0 && (
            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
              {chatHistory.map((m, i) => (
                <div
                  key={i}
                  className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-white/[0.06] text-eve-cream ml-8 text-right'
                      : 'bg-eve-rose/10 border border-eve-rose/20 text-eve-cream/95 mr-8 italic font-serif'
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder='e.g. "swap dessert for live music" or "make it walking only"'
              disabled={refining}
              className="flex-1 px-5 py-3.5 rounded-full bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-[15px] disabled:opacity-50"
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || refining}
              className="w-12 h-12 rounded-full bg-eve-gold text-eve-ink hover:bg-amber-200 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              {refining ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-[11px] text-white/30 italic font-serif">
        Gemini 2.5 · Google Search · Cloud TTS · Maps · Cloud Run
      </footer>
    </div>
  );
}
