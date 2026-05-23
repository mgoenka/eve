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
  ChevronDown,
} from 'lucide-react';
import {
  LOADING_MESSAGES,
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
  eveParseIntent,
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
    ? 'text-eve-cream/55 italic font-serif placeholder:text-eve-cream/45'
    : 'text-eve-cream placeholder:text-eve-cream/45 placeholder:italic placeholder:font-serif';
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
  // Live mirror so async loops (e.g. background filler talk during plan
  // generation) can see the current phase without stale closures.
  const phaseRef = useRef<Phase>('input');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [city, setCity] = useState(initial?.city || SUGGESTED_CITY);
  const [vibe, setVibe] = useState<Vibe>(initial?.vibe || 'date_night');
  const [party, setParty] = useState<number>(initial?.party || 2);
  const [dietary, setDietary] = useState<DietaryPreference[]>(initial?.dietary || ['vegetarian']);
  const [budgetPerPerson, setBudgetPerPerson] = useState<number>(initial?.budgetPerPerson || 100);
  const [cuisinePref, setCuisinePref] = useState(initial?.cuisinePref || '');
  const [whenISO, setWhenISO] = useState(initial?.whenISO || todayISO());
  // Start time of the evening (24-hour). 19:30 = 7:30pm by default.
  const [startTime, setStartTime] = useState<string>(initial?.startTime || '19:30');
  // Total length of the evening, in hours. 4 hours is the default sweet spot
  // for a multi-stop date night (dinner + after).
  const [durationHours, setDurationHours] = useState<number>(initial?.durationHours || 4);
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

  // Animated walkthrough — Eve walks the user through the evening narratively,
  // highlighting each stop card in turn while speaking the corresponding beat.
  // walkingIdx semantics: -1 idle, 0 opening, 1 atStop1, 2 transition1to2,
  // 3 atStop2, 4 transition2to3, 5 atStop3, 6 closing, 7 done
  const [walkingIdx, setWalkingIdx] = useState<number>(-1);
  const walkingCancelRef = useRef(false);
  // Once-per-plan auto-walk guard so Eve narrates the night the moment it
  // finishes loading, instead of waiting on the user to hit the button.
  const autoWalkedRef = useRef(false);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [refining, setRefining] = useState(false);

  const [locating, setLocating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  // Conversation mode = once started, the mic auto-resumes after Eve speaks
  // each reply, so it feels like a continuous conversation, not a series
  // of single-shot voice commands.
  const [conversationActive, setConversationActive] = useState(false);
  // Eve starts muted by default. Conversation only begins after the user
  // taps the Activate-Eve toggle in the top-right of the header.
  const [userMuted, setUserMuted] = useState(true);

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpeechAtRef = useRef<number>(Date.now());
  const voiceListeningRef = useRef(false);
  const voiceTranscriptRef = useRef('');
  const conversationActiveRef = useRef(false);
  const userMutedRef = useRef(true);
  const eveSpeakingRef = useRef(false);

  // Form is expanded by default. Users can collapse it to "just talk to Eve".
  const [formExpanded, setFormExpanded] = useState(true);
  // Cycling trivia message shown inside the primary buttons while a plan
  // is being built. Mirrors the Recipe / Buzzer "loading-tip" pattern.
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const loadingShownRef = useRef<number[]>([]);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isLoading = phase === 'forging';
    if (isLoading) {
      const pick = (pool: string[]) => {
        if (loadingShownRef.current.length >= pool.length) loadingShownRef.current = [];
        const available = pool.map((_, i) => i).filter((i) => !loadingShownRef.current.includes(i));
        const idx = available[Math.floor(Math.random() * available.length)];
        loadingShownRef.current.push(idx);
        return pool[idx];
      };
      const first = pick(LOADING_MESSAGES);
      setLoadingMessage(first);
      const scheduleNext = () => {
        const msg = pick(LOADING_MESSAGES);
        setLoadingMessage(msg);
        loadingTimerRef.current = setTimeout(scheduleNext, Math.max(3500, Math.min(8000, msg.length * 70)));
      };
      loadingTimerRef.current = setTimeout(scheduleNext, Math.max(3500, Math.min(8000, first.length * 70)));
    } else if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
      setLoadingMessage('');
    }
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [phase]);
  const [eveGreeted, setEveGreeted] = useState(false);
  const [parsing, setParsing] = useState(false);

  const [playing, setPlaying] = useState(false);
  // Eve's voice is muted by default — the Activate-Eve toggle flips this on.
  const [muted, setMuted] = useState(true);
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
    // Tear down conversation state
    try {
      recognitionRef.current?.stop();
    } catch {}
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    silenceTimerRef.current = null;
    setVoiceListening(false);
    voiceListeningRef.current = false;
    setVoiceTranscript('');
    voiceTranscriptRef.current = '';
    setConversationActive(false);
    conversationActiveRef.current = false;
    setUserMuted(false);
    userMutedRef.current = false;
    setEveSpeaking(false);
    eveSpeakingRef.current = false;

    setPhase('input');
    setStops([]);
    setStory(null);
    setPlanTitle('');
    autoWalkedRef.current = false;
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

  // Keep refs in sync with state so silence-detector closures see fresh values.
  useEffect(() => {
    voiceListeningRef.current = voiceListening;
  }, [voiceListening]);
  useEffect(() => {
    voiceTranscriptRef.current = voiceTranscript;
  }, [voiceTranscript]);
  useEffect(() => {
    conversationActiveRef.current = conversationActive;
  }, [conversationActive]);
  useEffect(() => {
    userMutedRef.current = userMuted;
  }, [userMuted]);
  useEffect(() => {
    eveSpeakingRef.current = eveSpeaking;
  }, [eveSpeaking]);

  // When the page-level mute toggles ON, immediately silence any in-flight
  // Eve audio. Otherwise the user keeps hearing what was already playing.
  useEffect(() => {
    if (!muted) return;
    try {
      eveAudioRef.current?.pause();
    } catch {}
    try {
      audioRef.current?.pause();
    } catch {}
    setEveSpeaking(false);
    eveSpeakingRef.current = false;
    setPlaying(false);
    walkingCancelRef.current = true;
    setWalkingIdx(-1);
  }, [muted]);

  // ----- Voice input via Web Speech API: set up the recognizer once -----
  // The recognizer auto-stops on ~3 seconds of silence in "smart" mode,
  // which the conversational mic uses; the manual textarea mic stays open
  // until the user toggles it off.
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
      const trimmed = transcript.trim();
      const fullText = (baseTextRef.current ? baseTextRef.current + ' ' : '') + trimmed;
      setVoiceTranscript(trimmed);
      setFreeText(fullText);
      lastSpeechAtRef.current = Date.now();

      // Interruption: if Eve is speaking and the user starts talking
      // (3+ chars of new speech), pause Eve so the user can take the floor.
      // Also break out of any active walkthrough so Eve doesn't march to the
      // next beat while the user is mid-sentence.
      if (eveSpeakingRef.current && trimmed.length > 3) {
        console.log('[Eve] barge-in detected:', trimmed.slice(0, 60));
        const a = eveAudioRef.current;
        try {
          a?.pause();
        } catch {}
        setEveSpeaking(false);
        eveSpeakingRef.current = false;
        // Cancel walkthrough so the for-loop in startWalkthrough breaks.
        walkingCancelRef.current = true;
        setWalkingIdx(-1);
      }
    };
    rec.onend = () => setVoiceListening(false);
    rec.onerror = () => setVoiceListening(false);
    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
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

  // Stop ALL Eve-related audio sources before starting a new one. Prevents
  // overlapping audio (e.g. walkthrough playing on top of plan narration).
  const stopAllAudio = useCallback(() => {
    try {
      const a = eveAudioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    } catch {}
    try {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    } catch {}
    setEveSpeaking(false);
    eveSpeakingRef.current = false;
    setPlaying(false);
  }, []);

  const speakAsEve = useCallback(
    async (text: string) => {
      console.log('[Eve] speakAsEve:', text.slice(0, 70));
      if (!text || muted) return;
      stopAllAudio();
      setEveSpeaking(true);
      try {
        const audio = await synthesize(text, 'eve');
        const a = eveAudioRef.current;
        if (!a) return;
        a.src = `data:${audio.audioMime || 'audio/mpeg'};base64,${audio.audioData}`;
        a.currentTime = 0;
        try {
          await a.play();
        } catch (err) {
          console.error('[Eve] play() rejected:', err);
        }
      } catch (err) {
        console.error('[Eve] synth failed:', err);
      }
    },
    [muted, stopAllAudio]
  );

  // Plays a line and resolves only when audio finishes (or 12s timeout).
  const speakAsEveAndWait = useCallback(
    async (text: string) => {
      console.log('[Eve] speakAsEveAndWait:', text.slice(0, 70));
      if (!text || muted) return;
      stopAllAudio();
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
            a.removeEventListener('pause', onPause);
            resolve();
          };
          // KEY: resolve on pause too. When the user barge-ins, rec.onresult
          // calls a.pause() — without this, the await sat for the full 12s
          // timeout and Eve marched on through the rest of the walkthrough.
          const onPause = () => {
            if (a.ended) return;
            finish();
          };
          a.addEventListener('ended', finish, { once: true });
          a.addEventListener('pause', onPause);
          a.play().catch((err) => {
            console.error('[Eve] play() rejected (wait):', err);
            finish();
          });
          setTimeout(finish, 18000);
        });
      } catch (err) {
        console.error('[Eve] synth failed (wait):', err);
      } finally {
        setEveSpeaking(false);
      }
    },
    [muted, stopAllAudio]
  );

  // Unlock the audio playback context on first user gesture. Browsers
  // require an explicit play() after gesture before any subsequent
  // play() calls work. We do a silent play+pause once.
  useEffect(() => {
    const unlock = () => {
      const a = eveAudioRef.current;
      if (!a) return;
      console.log('[Eve] unlocking audio context');
      const wasMuted = a.muted;
      a.muted = true;
      a
        .play()
        .then(() => {
          a.pause();
          a.muted = wasMuted;
          console.log('[Eve] audio context unlocked');
        })
        .catch((err) => {
          console.warn('[Eve] unlock failed:', err);
          a.muted = wasMuted;
        });
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

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
      // Vibe-tinted filler keeps her voice present during the inevitable
      // 8-10s wait for the skeleton, instead of going dead-silent.
      const FILLERS_BY_VIBE: Record<Vibe, string[]> = {
        date_night: [
          'I keep thinking about what would make this night feel like yours…',
          'Mm, that one. No, the other one. Hold on.',
          'I want this to feel like the kind of night you tell someone about later.',
          'Almost. Let me just pick the one I would have picked if I were going.',
        ],
        celebrating: [
          'Tonight has to feel like something. Let me find that.',
          'I want a place that knows how to make a fuss without trying.',
          'Hold on. I am being picky on purpose.',
        ],
        casual: [
          'Easy. Something nice. I have a feeling.',
          'Let me check one more spot before I commit.',
          'Almost. I just want to be sure.',
        ],
        family: [
          'Let me find somewhere everyone can settle into.',
          'Warm room, kind people. That is what I am after.',
          'Hold on, picking the one with the patient kitchen.',
        ],
        friends: [
          'Pulling together a good one for the gang. Hold on.',
          'I want a place loud enough to laugh in.',
          'Almost. Just checking who has a good table tonight.',
        ],
        solo: [
          'Just for you. Let me pick somewhere kind.',
          'Quiet. Beautiful. Hold on.',
          'I want this one to feel like it knows you.',
        ],
      };

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
            await new Promise((r) => setTimeout(r, 220));
          }

          // If the plan is still loading after the intro lines, keep talking.
          // Eve does NOT go silent while she "thinks". Conversational filler
          // until skeleton lands or stops are ready or user cancels.
          const fillers = FILLERS_BY_VIBE[useVibe] || FILLERS_BY_VIBE.casual;
          let i = 0;
          while (
            !cancelRef.current &&
            phaseRef.current === 'forging' &&
            i < fillers.length
          ) {
            const line = fillers[i++];
            setEveIntroText(line);
            try {
              await speakAsEveAndWait(line);
            } catch {}
            if (cancelRef.current) return;
            await new Promise((r) => setTimeout(r, 320));
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
          startTime,
          durationHours,
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
        // Set the text bubble but DON'T auto-speak — the "Walk me through this
        // evening" button is the canonical Eve-narrated experience now,
        // and auto-speaking outro was a source of overlapping audio.
        setEveOutroText(o.outro || '');
      } catch {}
    },
    [city, vibe, party, dietary, budgetPerPerson, freeText, cuisinePref, whenISO, startTime, durationHours, speakAsEve]
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

  // Helper to actually parse the transcript and act on the result.
  // Either fills out enough of the form to execute (and starts the plan),
  // or speaks back asking for the one missing thing and re-opens the mic.
  // If a plan already exists (we're in walkthrough or post-plan chat),
  // route the transcript to eve-refine instead — the user is asking for a
  // tweak, not a new plan from scratch.
  const processTranscript = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;

      // Walkthrough barge-in / post-plan voice: refine, don't replan.
      if (stops.length > 0 && phaseRef.current === 'ready') {
        // Stop the walkthrough so we can react to what they said.
        walkingCancelRef.current = true;
        setWalkingIdx(-1);
        stopAllAudio();
        setRefining(true);
        try {
          const result = await eveRefine({
            message: transcript,
            previousPlan: { stops: stops.map((s) => ({ name: s.name, kind: s.kind, oneLineVibe: s.oneLineVibe })) },
            vibe,
            city,
            dietary,
            party,
            budgetUSD: budgetPerPerson * party,
          });
          if (result.spokenReply) {
            setEveIntroText(result.spokenReply);
            await speakAsEveAndWait(result.spokenReply);
          }
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
            // Reset auto-walk so the refreshed plan auto-narrates.
            autoWalkedRef.current = false;
            // Refresh story for the new plan
            eveStory({
              title: result.title || planTitle,
              stops: newStops.map((s) => ({ name: s.name, kind: s.kind, oneLineVibe: s.oneLineVibe, signatureItem: s.signatureItem })),
              vibe,
              city,
              party,
            }).then(setStory).catch(() => {});
            // Regenerate stop images in parallel
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
                  setStops((prev) => prev.map((st, idx) => idx === i ? { ...st, imageData: img.imageData, imageMime: img.imageMime, status: 'ready' } : st));
                } catch (err: any) {
                  setStops((prev) => prev.map((st, idx) => idx === i ? { ...st, status: 'error', error: err?.message || 'Image failed' } : st));
                }
              })
            );
          }
        } catch (err: any) {
          console.error('refine-by-voice failed:', err);
        } finally {
          setRefining(false);
        }
        // Keep the mic open for the next ask.
        try {
          const rec = recognitionRef.current;
          if (rec && !voiceListeningRef.current && !userMutedRef.current) {
            baseTextRef.current = '';
            setVoiceTranscript('');
            voiceTranscriptRef.current = '';
            rec.start();
            setVoiceListening(true);
            voiceListeningRef.current = true;
            lastSpeechAtRef.current = Date.now();
            startSmartSilenceWatcher();
          }
        } catch {}
        return;
      }

      setParsing(true);
      try {
        const result = await eveParseIntent(transcript, {
          location: city === SUGGESTED_CITY ? '' : city,
          vibe,
          party,
          dietary,
          budgetPerPerson,
          cuisinePref,
          freeText,
        });

        // Apply extracted fields where present
        let nextLocation = city;
        let nextVibe: Vibe = vibe;
        let nextFreeText = freeText;
        let nextDietary: DietaryPreference[] = dietary;
        let nextParty = party;
        if (result.extracted.location) {
          nextLocation = result.extracted.location;
          setCity(result.extracted.location);
        }
        if (result.extracted.vibe) {
          const v = result.extracted.vibe as Vibe;
          if (['date_night', 'celebrating', 'casual', 'family', 'friends', 'solo'].includes(v)) {
            nextVibe = v;
            setVibe(v);
          }
        }
        if (typeof result.extracted.party === 'number' && result.extracted.party > 0) {
          nextParty = result.extracted.party;
          setParty(result.extracted.party);
        }
        if (result.extracted.dietary && result.extracted.dietary.length) {
          const known: DietaryPreference[] = [
            'vegetarian',
            'vegan',
            'gluten_free',
            'halal',
            'kosher',
            'nut_free',
            'dairy_free',
          ];
          const merged = Array.from(
            new Set([...dietary, ...result.extracted.dietary.filter((d): d is DietaryPreference => known.includes(d as DietaryPreference))])
          ) as DietaryPreference[];
          nextDietary = merged;
          setDietary(merged);
        }
        if (typeof result.extracted.budgetPerPerson === 'number' && result.extracted.budgetPerPerson > 0) {
          setBudgetPerPerson(result.extracted.budgetPerPerson);
        }
        if (result.extracted.cuisinePref) setCuisinePref(result.extracted.cuisinePref);
        if (result.extracted.freeText) {
          nextFreeText = result.extracted.freeText;
          setFreeText(result.extracted.freeText);
        }

        // Geolocation fallback: if Eve thinks the location is missing,
        // try the browser's geolocation before asking the user. This avoids
        // an awkward "where are you?" turn when we can just ask the device.
        const locationMissing =
          !result.extracted.location &&
          (!nextLocation || nextLocation === SUGGESTED_CITY);
        if (locationMissing && !result.isComplete) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              if (!('geolocation' in navigator)) {
                reject(new Error('no geolocation'));
                return;
              }
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 7000,
                maximumAge: 5 * 60 * 1000,
              });
            });
            const { city: resolved } = await reverseGeocode(
              pos.coords.latitude,
              pos.coords.longitude
            );
            if (resolved && resolved.length < 80) {
              nextLocation = resolved;
              setCity(resolved);
              result.isComplete = true;
              const v = (result.extracted.vibe as Vibe) || nextVibe;
              const vibeLine: Record<Vibe, string> = {
                date_night: `Got you near ${resolved}. Hold on, I'm finding somewhere worthy of you tonight…`,
                celebrating: `Got you near ${resolved}. Let me set up the kind of night this calls for.`,
                casual: `Got you near ${resolved}. I'll keep it easy. One sec.`,
                family: `Got you near ${resolved}. Let me pull together something everyone will love.`,
                friends: `Got you near ${resolved}. Pulling together a good night with the gang. Hold on.`,
                solo: `Got you near ${resolved}. Just for you, tonight. Let me think.`,
              };
              result.spokenReply = vibeLine[v] || vibeLine.casual;
            }
          } catch {
            // Permission denied / unavailable — fall through to the
            // existing "Eve asks where you are" turn.
          }
        }

        // Eve speaks her response
        if (result.spokenReply) {
          setEveIntroText(result.spokenReply);
          await speakAsEveAndWait(result.spokenReply);
        }

        if (result.isComplete && nextLocation) {
          // Done — execute the plan and end the conversation
          setConversationActive(false);
          conversationActiveRef.current = false;
          setTimeout(() => {
            buildPlan({
              city: nextLocation,
              vibe: nextVibe,
              freeText: nextFreeText,
              party: nextParty,
              dietary: nextDietary,
            });
          }, 250);
        } else {
          // Need more info OR user is in conversation mode → re-open the mic.
          setVoiceTranscript('');
          voiceTranscriptRef.current = '';
          baseTextRef.current = '';
          if (conversationActiveRef.current && !userMutedRef.current) {
            setTimeout(() => {
              const rec = recognitionRef.current;
              if (!rec) return;
              try {
                rec.start();
                setVoiceListening(true);
                voiceListeningRef.current = true;
                lastSpeechAtRef.current = Date.now();
                startSmartSilenceWatcher();
              } catch {}
            }, 400);
          }
        }
      } catch (err: any) {
        console.error('parse failed', err);
      } finally {
        setParsing(false);
      }
    },
    [city, vibe, party, dietary, budgetPerPerson, cuisinePref, freeText, buildPlan]
  );

  // Watch for silence — when no speech result for 2.5s with at least some
  // transcribed text, auto-stop the recognizer and feed the transcript to
  // the parser. Uses refs (not state) inside the interval because state
  // captured by the interval callback would be stale.
  const startSmartSilenceWatcher = useCallback(() => {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    lastSpeechAtRef.current = Date.now();
    silenceTimerRef.current = setInterval(() => {
      const listening = voiceListeningRef.current;
      const transcript = voiceTranscriptRef.current;
      if (!listening) {
        if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
        return;
      }
      const sinceLastSpeech = Date.now() - lastSpeechAtRef.current;
      if (sinceLastSpeech > 2500 && transcript.trim().length > 0) {
        // User went quiet — stop and process
        const rec = recognitionRef.current;
        try {
          rec?.stop();
        } catch {}
        setVoiceListening(false);
        voiceListeningRef.current = false;
        if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
        const captured = transcript;
        setTimeout(() => processTranscript(captured), 150);
      }
    }, 400);
  }, [processTranscript]);

  // Mic toggle behavior:
  // 1. If user is NOT in a conversation yet → start one (activate conversation, open mic).
  // 2. If user IS in conversation:
  //    - If Eve is currently speaking → silence Eve (user wants to take the floor).
  //    - If mic is currently listening → toggle "user muted" (mic stops; conversation stays alive).
  //    - If mic is currently muted → unmute (mic re-opens, conversation continues).
  const tellEveByVoice = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) {
      buildPlan();
      return;
    }

    // Case 1: not in conversation yet → activate
    if (!conversationActiveRef.current) {
      setConversationActive(true);
      conversationActiveRef.current = true;
      setUserMuted(false);
      userMutedRef.current = false;
      baseTextRef.current = '';
      setVoiceTranscript('');
      voiceTranscriptRef.current = '';
      setFreeText('');
      try {
        rec.start();
        setVoiceListening(true);
        voiceListeningRef.current = true;
        lastSpeechAtRef.current = Date.now();
        startSmartSilenceWatcher();
      } catch {}
      return;
    }

    // Case 2: Eve is speaking and user wants to interject → silence Eve, open mic
    if (eveSpeakingRef.current) {
      try {
        eveAudioRef.current?.pause();
      } catch {}
      setEveSpeaking(false);
      eveSpeakingRef.current = false;
      setUserMuted(false);
      userMutedRef.current = false;
      baseTextRef.current = '';
      setVoiceTranscript('');
      voiceTranscriptRef.current = '';
      try {
        rec.start();
        setVoiceListening(true);
        voiceListeningRef.current = true;
        lastSpeechAtRef.current = Date.now();
        startSmartSilenceWatcher();
      } catch {}
      return;
    }

    // Case 3: in conversation, mic is on → mute the user
    if (voiceListeningRef.current && !userMutedRef.current) {
      try {
        rec.stop();
      } catch {}
      setVoiceListening(false);
      voiceListeningRef.current = false;
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
      setUserMuted(true);
      userMutedRef.current = true;
      return;
    }

    // Case 4: in conversation, user is muted → unmute and resume listening
    if (userMutedRef.current) {
      setUserMuted(false);
      userMutedRef.current = false;
      baseTextRef.current = '';
      setVoiceTranscript('');
      voiceTranscriptRef.current = '';
      try {
        rec.start();
        setVoiceListening(true);
        voiceListeningRef.current = true;
        lastSpeechAtRef.current = Date.now();
        startSmartSilenceWatcher();
      } catch {}
      return;
    }
  }, [buildPlan, startSmartSilenceWatcher]);

  // Rotating greetings — softly flirty without being clingy. Refreshes every load.
  const GREETINGS = [
    "Hi, I'm Eve. What kind of evening are we writing tonight, you and me?",
    "Hello there. I'm Eve. Tell me what evening you want, and I'll work it out for you.",
    "Hi. I'm Eve. Lovely of you to find me. Tell me what tonight should feel like.",
    "Hi. I'm Eve. I've been waiting. What kind of evening should we make?",
    "Hello. I'm Eve. You bring the wish, I'll bring the rest of the night.",
  ];

  const greetingPlayedRef = useRef(false);
  // forceUnmuted=true bypasses the muted check — we use this when the user
  // taps "Activate Eve" so the greeting plays immediately without waiting
  // for the muted state closure to flush.
  const playGreetingOnce = useCallback((forceUnmuted = false) => {
    if (greetingPlayedRef.current) return;
    if (muted && !forceUnmuted) return;
    greetingPlayedRef.current = true;
    setEveGreeted(true);
    const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
    setEveIntroText(greeting);

    // Speak greeting, then automatically activate conversation mode + open mic
    // so the user can just keep talking after Eve says hi.
    (async () => {
      await speakAsEveAndWait(greeting);
      // Auto-start conversation if user hasn't already done something
      if (
        !conversationActiveRef.current &&
        !voiceListeningRef.current &&
        recognitionRef.current
      ) {
        setConversationActive(true);
        conversationActiveRef.current = true;
        setUserMuted(false);
        userMutedRef.current = false;
        baseTextRef.current = '';
        setVoiceTranscript('');
        voiceTranscriptRef.current = '';
        setFreeText('');
        try {
          recognitionRef.current.start();
          setVoiceListening(true);
          voiceListeningRef.current = true;
          lastSpeechAtRef.current = Date.now();
          startSmartSilenceWatcher();
        } catch (err) {
          console.warn('[Eve] auto-mic start failed:', err);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, speakAsEveAndWait]);

  useEffect(() => {
    if (eveGreeted || muted) return;
    const t = setTimeout(playGreetingOnce, 3000);
    const onFirst = () => {
      // Tiny delay so the click sound doesn't overlap Eve's first word
      setTimeout(playGreetingOnce, 150);
    };
    document.addEventListener('pointerdown', onFirst, { once: true });
    document.addEventListener('keydown', onFirst, { once: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onFirst);
      document.removeEventListener('keydown', onFirst);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Walks through the evening: highlights each stop in sequence as Eve
  // speaks the corresponding story beat. The mic stays open the entire time
  // so the user can interrupt — barge-in pauses Eve and routes the user's
  // line to eve-refine, which swaps stops and resumes the walkthrough.
  const startWalkthrough = useCallback(async () => {
    console.log('[Eve] startWalkthrough invoked, story present:', !!story);
    if (!story) return;
    walkingCancelRef.current = false;
    stopAllAudio();

    // Keep the mic listening through the whole walkthrough so true barge-in
    // is possible. If the recognizer isn't already running, start it.
    try {
      const rec = recognitionRef.current;
      if (rec && !voiceListeningRef.current) {
        baseTextRef.current = '';
        setVoiceTranscript('');
        voiceTranscriptRef.current = '';
        setConversationActive(true);
        conversationActiveRef.current = true;
        rec.start();
        setVoiceListening(true);
        voiceListeningRef.current = true;
        lastSpeechAtRef.current = Date.now();
        startSmartSilenceWatcher();
      }
    } catch {}

    const beats: { idx: number; text: string }[] = [
      { idx: 0, text: story.opening },
      { idx: 1, text: story.atStop1 },
      { idx: 2, text: story.transition1to2 },
      { idx: 3, text: story.atStop2 },
      { idx: 4, text: story.transition2to3 },
      { idx: 5, text: story.atStop3 },
      { idx: 6, text: story.closing },
    ].filter((b) => b.text);

    for (const beat of beats) {
      if (walkingCancelRef.current) break;
      setWalkingIdx(beat.idx);
      await speakAsEveAndWait(beat.text);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!walkingCancelRef.current) setWalkingIdx(-1);
  }, [story, speakAsEveAndWait, stopAllAudio]);

  // Auto-trigger the walkthrough once the plan is fully loaded. Eve walks
  // the user through the evening on her own — no button click needed.
  // We do NOT respect walkingCancelRef here; we forcibly clear it and start.
  useEffect(() => {
    if (autoWalkedRef.current) return;
    if (muted) return;
    if (!story) return;
    if (stops.length < 2) return;
    if (!stops.every((s) => s.status === 'ready' || s.status === 'error')) return;
    autoWalkedRef.current = true;
    console.log('[Eve] auto-walk: scheduling startWalkthrough in 900ms');
    const t = setTimeout(() => {
      console.log('[Eve] auto-walk: firing startWalkthrough now');
      walkingCancelRef.current = false;
      startWalkthrough();
    }, 900);
    return () => clearTimeout(t);
  }, [story, stops, muted, startWalkthrough]);

  const stopWalkthrough = useCallback(() => {
    walkingCancelRef.current = true;
    setWalkingIdx(-1);
    if (eveAudioRef.current) {
      try {
        eveAudioRef.current.pause();
      } catch {}
    }
  }, []);

  // Map walking idx to which stop is currently in focus (highlighted).
  // Beats 1, 3, 5 are AT a specific stop. Transitions don't highlight one.
  const highlightedStopIdx = (() => {
    if (walkingIdx < 0) return -1;
    if (walkingIdx === 1) return 0;
    if (walkingIdx === 3) return 1;
    if (walkingIdx === 5) return 2;
    return -1;
  })();

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
    // Don't auto-play — the "Walk me through this evening" walkthrough is the
    // primary Eve-narrated experience. Auto-playing here used to collide
    // with Eve's outro line and the walkthrough audio.
  }, [narrationAudio, narrationMime]);

  const togglePlay = () => {
    if (!audioRef.current || !narrationAudio) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      // Stop any other Eve audio first
      try {
        eveAudioRef.current?.pause();
      } catch {}
      setEveSpeaking(false);
      eveSpeakingRef.current = false;
      walkingCancelRef.current = true;
      setWalkingIdx(-1);
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
        <audio ref={eveAudioRef} preload="auto" />
        <header className="px-6 md:px-10 py-5 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2 group">
            <EveLogo size={42} withWordmark />
          </a>
          <div className="flex items-center gap-2">
            {muted ? (
              <button
                onClick={() => {
                  setMuted(false);
                  setUserMuted(false);
                  userMutedRef.current = false;
                  // Bypass the muted closure — fire greeting immediately.
                  setTimeout(() => playGreetingOnce(true), 50);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider text-eve-ink bg-eve-gold hover:bg-yellow-300 transition-colors shadow-[0_0_20px_rgba(245,197,66,0.35)]"
                title="Turn on mic + sound and start talking with Eve"
                aria-label="Activate Eve"
              >
                <Mic size={14} />
                <Volume2 size={14} />
                <span>Activate Eve</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setMuted(true);
                  setUserMuted(true);
                  userMutedRef.current = true;
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 text-eve-cream/80 hover:text-eve-cream border border-white/10 transition-colors"
                title="Mute Eve and turn off mic"
                aria-label="Deactivate Eve"
              >
                <MicOff size={14} />
                <VolumeX size={14} />
              </button>
            )}
            <button
              onClick={onSwitchToRestaurant}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 text-eve-cream/80 hover:text-eve-cream border border-white/10 transition-colors"
            >
              <Store size={14} />
              For restaurants
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-6 md:py-12">
          <div className="text-center mb-8 md:mb-10">
            {eveAvatarUrl && (
              <div className="flex justify-center mb-5">
                <div className="relative">
                  {/* Soft warm halo when Eve is speaking — no white edges */}
                  <div
                    className={`absolute inset-0 rounded-full blur-2xl transition-opacity duration-500 ${
                      eveSpeaking ? 'bg-gradient-to-br from-eve-rose/60 via-eve-gold/45 to-eve-plum/55 opacity-90 animate-pulse' : 'opacity-0'
                    }`}
                  />
                  <div
                    className={`relative w-28 h-28 md:w-32 md:h-32 rounded-full overflow-hidden bg-gradient-to-br from-eve-plum/60 via-eve-rose/40 to-eve-gold/35 transition-all duration-500 ${
                      eveSpeaking
                        ? 'ring-2 ring-eve-rose/80 shadow-[0_0_60px_rgba(224,134,134,0.55)] scale-105'
                        : 'ring-1 ring-eve-gold/35 opacity-95'
                    }`}
                  >
                    <img
                      src={eveAvatarUrl}
                      alt="Eve"
                      className="w-full h-full object-cover scale-110"
                    />
                  </div>
                  {eveSpeaking && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-eve-rose/90 text-eve-ink text-[10px] font-bold tracking-wide font-serif italic inline-flex items-center gap-1 shadow-md">
                      <span className="w-1 h-1 rounded-full bg-eve-ink animate-pulse" />
                      speaking
                    </span>
                  )}
                </div>
              </div>
            )}
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
                    : userMuted
                      ? 'bg-white/[0.04] text-eve-cream/55 border-white/15 hover:border-white/25'
                      : 'bg-white/[0.04] text-eve-cream border-eve-rose/40 hover:bg-eve-rose/15 hover:text-eve-rose'
                }`}
                title={
                  !conversationActive
                    ? 'Tap to start talking with Eve'
                    : eveSpeaking
                      ? 'Tap to interrupt Eve and take the floor'
                      : voiceListening
                        ? 'Tap to mute yourself (Eve will wait)'
                        : 'Tap to unmute yourself'
                }
              >
                {voiceListening ? <Mic size={18} /> : <MicOff size={18} />}
                {!conversationActive
                  ? 'Tell Eve'
                  : eveSpeakingRef.current || eveSpeaking
                    ? 'Cut in'
                    : voiceListening
                      ? 'Listening…'
                      : userMuted
                        ? 'Tap to talk'
                        : 'Listening…'}
              </button>
            )}
            <button
              onClick={surpriseMe}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base transition-all border outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink hover:scale-[1.02] active:scale-[0.98] bg-eve-ink-soft text-eve-gold border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 shadow-lg shadow-eve-gold/10"
            >
              <Shuffle size={18} />
              Surprise me
            </button>
          </div>

          {(voiceListening || parsing) && (
            <div className="max-w-xl mx-auto mb-5 px-4 py-3 rounded-2xl border border-eve-rose/35 bg-eve-rose/5 text-center animate-fade-in">
              <p className="text-[11px] tracking-wide text-eve-rose/85 mb-1 italic font-serif inline-flex items-center gap-1.5">
                {parsing ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    Eve is making sense of you
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-eve-rose animate-pulse" />
                    Eve is listening
                  </>
                )}
              </p>
              {voiceTranscript ? (
                <p className="font-serif italic text-base text-eve-cream/90">"{voiceTranscript}"</p>
              ) : (
                <p className="font-serif italic text-sm text-eve-cream/55">tell her what evening you want</p>
              )}
            </div>
          )}

          {eveIntroText && !voiceListening && !parsing && (
            <div className="max-w-xl mx-auto mb-5 px-4 py-3 rounded-2xl border border-eve-gold/30 bg-eve-gold/5 text-center animate-fade-in">
              <p className="text-[11px] tracking-wide text-eve-gold/80 mb-1 italic font-serif inline-flex items-center gap-1.5">
                {eveSpeaking && (
                  <span className="w-1.5 h-1.5 rounded-full bg-eve-gold animate-pulse" />
                )}
                Eve says
              </p>
              <p className="font-serif italic text-base text-eve-cream/90">"{eveIntroText}"</p>
            </div>
          )}

          <div className="text-center mb-5">
            <button
              onClick={() => setFormExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[12px] tracking-wider text-eve-cream/50 hover:text-eve-cream italic font-serif transition-colors"
            >
              <ChevronDown size={11} className={`transition-transform ${formExpanded ? 'rotate-180' : ''}`} />
              {formExpanded ? 'Hide details, just talk to Eve' : 'Show all the details'}
            </button>
          </div>

          <div className={`space-y-5 ${formExpanded ? '' : 'hidden'}`}>
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
                  Location
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={city === SUGGESTED_CITY ? '' : city}
                    onChange={(e) => setCity(e.target.value || SUGGESTED_CITY)}
                    onFocus={(e) => {
                      // Clearing on focus prevents "Indian" + typing → "IndianChinese".
                      // Default falls back via the empty-check on submit.
                      if (city === SUGGESTED_CITY) e.target.value = '';
                    }}
                    placeholder={SUGGESTED_CITY}
                    className="w-full px-5 py-3.5 pr-14 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base text-eve-cream placeholder:text-eve-cream/45 placeholder:italic placeholder:font-serif"
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
                <div className="relative">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-eve-gold/15 text-eve-gold pointer-events-none z-10">
                    <ClockIcon size={16} />
                  </div>
                  <input
                    type="date"
                    value={whenISO}
                    min={todayISO()}
                    onChange={(e) => setWhenISO(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base text-eve-cream"
                  />
                </div>
                <p className="mt-1 text-[11px] text-eve-cream/55 italic font-serif">
                  {formatDate(whenISO)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  Start time
                </label>
                <div className="relative">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-eve-gold/15 text-eve-gold pointer-events-none z-10">
                    <ClockIcon size={16} />
                  </div>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base text-eve-cream"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] tracking-wide text-eve-gold/80 mb-2 font-medium">
                  Duration · {durationHours}h
                </label>
                <div className="relative">
                  <input
                    type="range"
                    min={1.5}
                    max={8}
                    step={0.5}
                    value={durationHours}
                    onChange={(e) => setDurationHours(parseFloat(e.target.value))}
                    className="w-full mt-3 accent-eve-gold"
                  />
                  <div className="flex justify-between text-[11px] text-eve-cream/55 italic font-serif mt-1">
                    <span>1.5h</span>
                    <span>4h</span>
                    <span>8h</span>
                  </div>
                </div>
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
                  className="w-full px-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base placeholder:text-eve-cream/45 placeholder:italic placeholder:font-serif"
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
                className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-[15px] leading-relaxed resize-none placeholder:text-eve-cream/45 placeholder:italic placeholder:font-serif"
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

            <div className="pt-2">
              <button
                onClick={() => buildPlan()}
                disabled={!city.trim()}
                className="w-full group inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl font-bold text-lg transition-all border outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink hover:scale-[1.01] active:scale-[0.99] bg-eve-ink-soft text-eve-gold border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 disabled:bg-eve-ink disabled:text-eve-cream/35 disabled:border-white/10 disabled:cursor-not-allowed shadow-lg shadow-eve-gold/15"
              >
                <Wand2 size={20} />
                Plan my evening
              </button>
            </div>
          </div>
        </main>

        <footer className="text-center py-6 text-[11px] text-white/55 italic font-serif">
          Gemini 2.5 · Google Search · Cloud TTS · Maps
        </footer>
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <audio ref={audioRef} preload="auto" />
      <audio ref={eveAudioRef} preload="auto" />

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
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setUserMuted(next);
              userMutedRef.current = next;
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full transition-colors text-xs font-medium ${
              muted
                ? 'text-eve-ink bg-eve-gold hover:bg-yellow-300 shadow-[0_0_18px_rgba(245,197,66,0.3)] uppercase tracking-wider font-bold'
                : 'bg-white/5 hover:bg-white/10 text-eve-cream/80 border border-white/10'
            }`}
            title={muted ? 'Activate Eve — turn on mic + sound' : 'Deactivate Eve — turn off mic + sound'}
          >
            {muted ? <Mic size={14} /> : <MicOff size={14} />}
            {muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {muted ? <span>Activate Eve</span> : null}
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
          {phase === 'forging' && loadingMessage && (
            <div className="mt-4 mx-auto inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-eve-ink-soft border border-eve-gold/25 text-eve-gold shadow-lg shadow-eve-gold/10 max-w-2xl">
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              <span role="status" aria-live="polite" className="text-sm font-normal text-eve-cream/85">
                {loadingMessage}
              </span>
            </div>
          )}
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
                <div
                  className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden ring-2 transition-all bg-gradient-to-br from-eve-plum/55 via-eve-rose/35 to-eve-gold/30 ${
                    eveSpeaking ? 'ring-eve-rose/80 animate-glow-pulse' : 'ring-eve-gold/45'
                  }`}
                >
                  <img
                    src={eveAvatarUrl}
                    alt="Eve"
                    className="w-full h-full object-cover scale-110"
                  />
                </div>
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
            const transitionActive =
              walkingIdx === 2 && i === 1 ? true : walkingIdx === 4 && i === 2 ? true : false;
            const sceneActive =
              walkingIdx === 1 && i === 0
                ? true
                : walkingIdx === 3 && i === 1
                  ? true
                  : walkingIdx === 5 && i === 2
                    ? true
                    : false;
            return (
              <div key={`${stop.name}-${i}`} className="space-y-4">
                {transitionText && (
                  <div
                    className={`flex items-center gap-3 max-w-xl mx-auto px-4 transition-all duration-500 ${
                      transitionActive ? 'opacity-100 scale-105' : 'opacity-100'
                    }`}
                  >
                    <div className={`flex-1 h-px bg-gradient-to-r from-transparent via-eve-gold/30 to-transparent ${transitionActive ? 'via-eve-gold/70' : ''}`} />
                    <p
                      className={`font-serif italic text-base text-eve-cream/75 leading-snug text-center max-w-md transition-colors ${
                        transitionActive ? 'text-eve-gold' : ''
                      }`}
                    >
                      {transitionText}
                    </p>
                    <div className={`flex-1 h-px bg-gradient-to-r from-transparent via-eve-gold/30 to-transparent ${transitionActive ? 'via-eve-gold/70' : ''}`} />
                  </div>
                )}
                <StopCard
                  stop={stop}
                  index={i}
                  city={city}
                  highlighted={highlightedStopIdx === i}
                  dimmed={walkingIdx >= 0 && highlightedStopIdx >= 0 && highlightedStopIdx !== i}
                />
                {sceneText && (
                  <div
                    className={`px-4 max-w-2xl mx-auto transition-all duration-500 ${
                      sceneActive ? 'scale-105' : ''
                    }`}
                  >
                    <p
                      className={`font-serif italic text-base md:text-lg text-eve-cream/85 leading-relaxed text-center transition-colors ${
                        sceneActive ? 'text-eve-gold' : ''
                      }`}
                    >
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

        {stops.length >= 2 && stops.every((s) => s.status === 'ready' || s.status === 'error') && story && (
          <div className="mt-8 flex justify-center">
            {walkingIdx < 0 ? (
              <button
                onClick={startWalkthrough}
                disabled={muted}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-serif italic font-bold text-lg text-eve-ink bg-gradient-to-r from-amber-200 via-eve-gold to-eve-rose hover:from-amber-100 hover:via-yellow-300 hover:to-rose-300 transition-all shadow-[0_0_44px_rgba(245,216,150,0.40)] hover:shadow-[0_0_60px_rgba(232,163,158,0.55)] disabled:opacity-50"
                title={muted ? 'Unmute Eve to hear her walk you through' : ''}
              >
                <Play size={18} />
                Walk me through this evening
              </button>
            ) : (
              <button
                onClick={stopWalkthrough}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-medium text-sm bg-white/10 hover:bg-white/15 border border-white/15 text-eve-cream transition-all"
              >
                <Pause size={14} />
                Stop the walkthrough
              </button>
            )}
          </div>
        )}

        {stops.length >= 2 && stops.every((s) => s.status === 'ready' || s.status === 'error') && (
          <div className="mt-5 flex justify-center gap-3 flex-wrap">
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
                href={`https://www.opentable.com/s?term=${encodeURIComponent(stops.find((s) => s.kind === 'dinner')!.name + ' ' + city)}&covers=${party}`}
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

      <footer className="text-center py-6 text-[11px] text-white/55 italic font-serif">
        Gemini 2.5 · Google Search · Cloud TTS · Maps · Cloud Run
      </footer>
    </div>
  );
}
