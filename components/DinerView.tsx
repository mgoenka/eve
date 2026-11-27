import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Pencil,
  History,
  X,
  CalendarPlus,
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
  subscribeImageLimit,
  refreshImageLimit,
} from '../services/eveService';
import type { ImageLimit } from '../services/eveService';
import {
  loadEvenings,
  saveEvening,
  removeEvening,
  sanitizeEvening,
} from '../services/savedEvenings';
import type { SavedEvening } from '../services/savedEvenings';
import { BackupModal, useBackupEntry } from '../ui-kit/components/BackupModal';
import { backup } from '../lib/backup';
import { clearSnapshot, useSnapshot } from '../services/persist';
import { DINER_SNAPSHOT_KEY, DINER_SNAPSHOT_V, readDinerSnapshot, sanitizePlanLink } from '../services/dinerSnapshot';
import type { DinerSnapshot } from '../services/dinerSnapshot';
import { getPicture, pictureKey, putPicture } from '../services/stopPictures';
import { isEcho } from '../lib/evePrompts';
import { eveningIcs } from '../lib/ics';
import { StopCard } from './StopCard';
import { EveLogo } from './EveLogo';
import { useOpenRules, useOpenSettings } from './RulesContext';
import { AppFooter, AppHeader, COPYRIGHT, CreditsChip, IconButton, MoreApps, PRIVACY_URL, ReportContentButton, TERMS_URL, isNativeApp, shareOrCopy, speculativeAiAllowed, trackPulse, useToast } from '../ui-kit';

interface Props {
  onSwitchToRestaurant: () => void;
  /** Bumped by the "Plan tonight" app shortcut: back to the planner form, the first field focused. */
  planSignal?: number;
}

type Phase = 'input' | 'forging' | 'ready';

interface ChatMessage {
  role: 'user' | 'eve';
  text: string;
  /** Eve's reply came from the AI (not one of the app's own fallback lines). */
  ai?: boolean;
}

const AVATAR_REPORT = 'Image: AI-painted portrait of Eve (Gemini)';
const AVATAR_PICTURE_KEY = 'eve-avatar|devoted';

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
  // Local calendar date (not UTC). toISOString() returns UTC, which rolls over
  // to tomorrow during the evening in timezones behind UTC (e.g. US Pacific) —
  // exactly when Eve is used — so it would block selecting today.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    return sanitizePlanLink(JSON.parse(decodeURIComponent(atob(json))));
  } catch {
    return null;
  }
}

function toB64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// A shared link can carry the finished plan (`e`), so whoever opens it sees
// the same evening straight away instead of Eve planning it again.
function readSharedEvening(): SavedEvening | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('e');
    if (!raw) return null;
    const parsed = JSON.parse(fromB64Url(raw));
    return sanitizeEvening({ ...parsed, id: `shared-${Date.now()}`, savedAt: Date.now() });
  } catch {
    return null;
  }
}

function buildShareURL(state: any, evening?: { title: string; stops: ExperienceStop[] }): string {
  if (typeof window === 'undefined') return '';
  const json = btoa(encodeURIComponent(JSON.stringify(state)));
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('plan', json);
  if (evening && evening.stops.length) {
    const compact = {
      title: evening.title,
      city: state.city,
      vibe: state.vibe,
      party: state.party,
      dietary: state.dietary,
      budgetPerPerson: state.budgetPerPerson,
      whenISO: state.whenISO,
      startTime: state.startTime,
      durationHours: state.durationHours,
      stops: evening.stops.map((s) => ({
        kind: s.kind,
        name: s.name,
        oneLineVibe: s.oneLineVibe,
        whyThisFits: s.whyThisFits,
        approxArrival: s.approxArrival,
        durationMinutes: s.durationMinutes,
        walkMinutesFromPrev: s.walkMinutesFromPrev,
        signatureItem: s.signatureItem,
      })),
    };
    url.searchParams.set('e', toB64Url(JSON.stringify(compact)));
  }
  return url.toString();
}

// The story around the stops: a scene for every stop (2 to 6) and a bridge into Stops 2 and 3
// (from Stop 4 on, each scene carries its own way there).
function sceneTextFor(story: EveStory | null, i: number): string {
  if (!story) return '';
  if (i === 0) return story.atStop1;
  if (i === 1) return story.atStop2;
  if (i === 2) return story.atStop3;
  return story.laterStops?.[i - 3] || '';
}
function transitionTextFor(story: EveStory | null, i: number): string {
  if (!story) return '';
  return i === 1 ? story.transition1to2 : i === 2 ? story.transition2to3 : '';
}
interface StoryBeat {
  text: string;
  kind: 'opening' | 'transition' | 'scene' | 'closing';
  /** The stop this beat belongs to (-1 for the opening and closing). */
  stop: number;
}
/** What Eve says in the walkthrough, in order: only beats for stops the plan has. */
function storyBeats(story: EveStory | null, stopCount: number): StoryBeat[] {
  if (!story) return [];
  const beats: StoryBeat[] = [{ text: story.opening, kind: 'opening', stop: -1 }];
  for (let i = 0; i < stopCount; i++) {
    beats.push({ text: transitionTextFor(story, i), kind: 'transition', stop: i });
    beats.push({ text: sceneTextFor(story, i), kind: 'scene', stop: i });
  }
  beats.push({ text: story.closing, kind: 'closing', stop: -1 });
  return beats.filter((b) => b.text);
}

/** "19:30" -> "7:30 PM". */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10) || 0);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function DinerView({ onSwitchToRestaurant, planSignal = 0 }: Props) {
  const openRules = useOpenRules();
  const openSettings = useOpenSettings();
  const toast = useToast();
  // What was on screen before a reload / relaunch (form + finished evening), restored without asking Eve
  // again. A shared evening (?e=) or a different ?plan= link than the one saved wins over it.
  // Reloading the shared link itself (same address) keeps what was changed on it here.
  const [restored] = useState<DinerSnapshot | null>(() => {
    const snap = readDinerSnapshot();
    if (!snap) return null;
    if ((readSharedEvening() || readURLParams()) && window.location.search !== snap.search) return null;
    return snap;
  });
  const restoredEvening = restored?.evening || null;
  const initial = restored?.form || readURLParams();

  const [phase, setPhase] = useState<Phase>(restoredEvening ? 'ready' : 'input');
  // Live mirror so async loops (e.g. background filler talk during plan
  // generation) can see the current phase without stale closures.
  const phaseRef = useRef<Phase>(restoredEvening ? 'ready' : 'input');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [city, setCity] = useState(initial?.city || SUGGESTED_CITY);
  const [vibe, setVibe] = useState<Vibe>(initial?.vibe || 'date_night');
  const [party, setParty] = useState<number>(initial?.party || 2);
  const [dietary, setDietary] = useState<DietaryPreference[]>(initial?.dietary || ['vegetarian']);
  const [budgetPerPerson, setBudgetPerPerson] = useState<number>(initial?.budgetPerPerson || 100);
  const [cuisinePref, setCuisinePref] = useState(initial?.cuisinePref || '');
  const [whenISO, setWhenISO] = useState(initial?.whenISO && initial.whenISO >= todayISO() ? initial.whenISO : todayISO());
  // Start time of the evening (24-hour). 19:30 = 7:30pm by default.
  const [startTime, setStartTime] = useState<string>(initial?.startTime || '19:30');
  // Total length of the evening, in hours. 4 hours is the default sweet spot
  // for a multi-stop date night (dinner + after).
  const [durationHours, setDurationHours] = useState<number>(initial?.durationHours || 4);
  const [freeText, setFreeText] = useState(initial?.freeText || '');
  const [error, setError] = useState<string | null>(null);

  const [planTitle, setPlanTitle] = useState(restoredEvening?.title || '');
  // Restored stops: text right away; a picture painted before comes back from this device (no new paint).
  const [stops, setStops] = useState<ExperienceStop[]>(() =>
    (restoredEvening?.stops || []).map((st) => ({ ...st, restored: true, status: st.imageKey ? 'generating' : 'pending' }))
  );
  const [story, setStory] = useState<EveStory | null>(restoredEvening?.story || null);
  // While Eve writes the story, a placeholder holds its place above the stops
  // (so the cards don't jump down when the text lands).
  const [storyPending, setStoryPending] = useState(false);
  // Only the newest story request lands: a story for an evening that was since changed (a refine, a new
  // plan) arriving late used to replace the new evening's story.
  const storySeqRef = useRef(0);
  const loadStory = useCallback((input: Parameters<typeof eveStory>[0]) => {
    const seq = ++storySeqRef.current;
    setStoryPending(true);
    // With Eve's voice on, the story is what she walks the user through (their choice, so not gated as
    // speculative AI); with it off it is an extra that runs only when it can't spend Sparks.
    return eveStory(input, { userAsked: !mutedRef.current })
      .then((st) => {
        if (seq !== storySeqRef.current) throw new Error('stale story');
        return st;
      })
      .finally(() => {
        if (seq === storySeqRef.current) setStoryPending(false);
      });
  }, []);
  const [narrationAudio, setNarrationAudio] = useState<string | null>(null);
  const [narrationMime, setNarrationMime] = useState<string>('audio/mpeg');
  const [narrationText_, setNarrationText] = useState<string>(restoredEvening?.narrationText || '');
  const [narrationKey, setNarrationKey] = useState(restoredEvening?.narrationKey || '');
  const [groundedSearchUsed, setGroundedSearchUsed] = useState(restoredEvening?.groundedSearchUsed || false);
  const [groundedSources, setGroundedSources] = useState<string[]>(restoredEvening?.groundedSources || []);

  const [eveIntroText, setEveIntroText] = useState(restoredEvening?.introText || '');
  const [eveOutroText, setEveOutroText] = useState(restoredEvening?.outroText || '');
  const [eveSpeaking, setEveSpeaking] = useState(false);
  const [eveAvatarUrl, setEveAvatarUrl] = useState<string | null>(null);

  // Animated walkthrough — Eve walks the user through the evening narratively,
  // highlighting each stop card in turn while speaking the corresponding beat.
  // walkingIdx: -1 idle, else the index of the beat Eve is speaking (storyBeats).
  const [walkingIdx, setWalkingIdx] = useState<number>(-1);
  const walkingCancelRef = useRef(false);
  // Once-per-plan auto-walk guard so Eve narrates the night the moment it
  // finishes loading, instead of waiting on the user to hit the button.
  // A restored evening never starts talking on its own (that would mean new voice audio).
  const autoWalkedRef = useRef(!!restoredEvening);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(restoredEvening?.chatHistory || []);
  const [chatInput, setChatInput] = useState(restoredEvening?.chatInput || '');
  const [refining, setRefining] = useState(false);

  const [locating, setLocating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  // The plan on screen came from someone else's share link (?e=).
  const [fromShare, setFromShare] = useState(() => !!restored?.evening && !!readSharedEvening());

  // Recent evenings (this device) + the visitor's hourly picture budget.
  const [recentEvenings, setRecentEvenings] = useState<SavedEvening[]>(() => loadEvenings());
  const backupEntry = useBackupEntry(backup);
  const [imageLimit, setImageLimit] = useState<ImageLimit | null>(null);
  const eveningIdRef = useRef<string>(restoredEvening?.id || '');
  useEffect(() => {
    const off = subscribeImageLimit(setImageLimit);
    refreshImageLimit();
    return () => {
      off();
    };
  }, []);

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
  // Every new line (or any stop) bumps this; a line whose voice arrives after a newer one started never plays,
  // and a loop (intro, walkthrough) whose line was cut off stops instead of talking over what came next.
  const speechSeqRef = useRef(0);
  // What Eve is saying (or just said): the mic ignores hearing her own voice back from the speakers.
  const eveLineRef = useRef<{ text: string; endedAt: number }>({ text: '', endedAt: 0 });
  const skipResultsRef = useRef(0);
  const walkRunRef = useRef(0);

  // Form is expanded by default. Users can collapse it to "just talk to Eve".
  const [formExpanded, setFormExpanded] = useState(restored ? restored.form.formExpanded : true);
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
  // Live mirror so the speak callbacks (whose closure captures `muted` at
  // creation time) can always check the latest value. Without this, hitting
  // Activate-Eve and immediately calling speakAsEveAndWait would short-circuit
  // because the closure still held muted=true.
  const mutedRef = useRef(true);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eveAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = true;
    clearSnapshot(DINER_SNAPSHOT_KEY);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (eveAudioRef.current) {
      eveAudioRef.current.pause();
      eveAudioRef.current.src = '';
    }
    setFromShare(false);
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
    storySeqRef.current++;
    setStoryPending(false);
    setPlanTitle('');
    eveningIdRef.current = '';
    setRecentEvenings(loadEvenings());
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

  // "Plan tonight" shortcut: a finished evening goes back to the form (like the pencil); a plan being made is left alone.
  const locationInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!planSignal) return;
    if (phaseRef.current === 'forging') return;
    if (phaseRef.current === 'ready') reset();
    setFormExpanded(true);
    const t = setTimeout(() => {
      const el = locationInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [planSignal, reset]);

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
    speechSeqRef.current++;
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
    // Android WebView has no working speech recognition (and the app has no mic permission):
    // inside the app Eve still talks, and you type to her.
    if (!SR || isNativeApp()) {
      setVoiceUnsupported(true);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    // Phones (and Chrome after a pause) end the session on their own mid-sentence. While Eve still
    // wants to listen, start again and keep the words heard so far, so the whole sentence goes through.
    let carry = '';
    let blocked = false;
    rec.onstart = () => {
      blocked = false;
      skipResultsRef.current = 0;
      carry = voiceTranscriptRef.current.trim();
    };
    rec.onresult = (e: any) => {
      let transcript = carry ? carry + ' ' : '';
      let heard = '';
      for (let i = skipResultsRef.current; i < e.results.length; i++) {
        heard += e.results[i][0].transcript + ' ';
      }
      // Eve's own voice coming back through the speakers is not the user talking: drop it (once those
      // words are final they're skipped for good) so she never cuts herself off or "refines" her own plan.
      const line = eveLineRef.current;
      if (line.text && (eveSpeakingRef.current || Date.now() - line.endedAt < 2500) && isEcho(heard, line.text)) {
        if (e.results[e.results.length - 1]?.isFinal) skipResultsRef.current = e.results.length;
        return;
      }
      transcript += heard;
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
        speechSeqRef.current++;
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
    rec.onend = () => {
      if (voiceListeningRef.current && !userMutedRef.current && !blocked) {
        voiceTranscriptRef.current = voiceTranscriptRef.current.trim();
        try {
          rec.start();
          return;
        } catch {}
      }
      setVoiceListening(false);
    };
    rec.onerror = (e: any) => {
      if (e?.error === 'no-speech' || e?.error === 'aborted') return; // onend decides
      blocked = true;
      setVoiceListening(false);
    };
    recognitionRef.current = rec;
    return () => {
      rec.onend = null; // leaving the page: don't start again
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
    speechSeqRef.current++;
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
      if (!text || mutedRef.current) return;
      stopAllAudio();
      const my = speechSeqRef.current;
      setEveSpeaking(true);
      eveLineRef.current = { text, endedAt: 0 };
      let started = false;
      try {
        // Eve's voice is on only after the user tapped Activate: their choice, so not gated as speculative.
        const audio = await synthesize(text, 'eve', { userAsked: true });
        const a = eveAudioRef.current;
        if (!a || speechSeqRef.current !== my || mutedRef.current) return;
        a.src = `data:${audio.audioMime || 'audio/mpeg'};base64,${audio.audioData}`;
        a.currentTime = 0;
        try {
          await a.play();
          started = true;
        } catch (err) {
          console.error('[Eve] play() rejected:', err);
        }
      } catch (err) {
        console.error('[Eve] synth failed:', err);
      } finally {
        // No voice came (failed or cut off): Eve isn't speaking, so the halo and the mic button stop waiting on her.
        if (!started && speechSeqRef.current === my) {
          setEveSpeaking(false);
          eveSpeakingRef.current = false;
          eveLineRef.current.endedAt = Date.now();
        }
      }
    },
    [muted, stopAllAudio]
  );

  // Plays a line and resolves when the audio finishes (or is cut off). Resolves false when a newer line,
  // a barge-in or a stop took over, so a loop of lines stops instead of talking over what came next.
  const speakAsEveAndWait = useCallback(
    async (text: string): Promise<boolean> => {
      console.log('[Eve] speakAsEveAndWait:', text.slice(0, 70));
      if (!text || mutedRef.current) return !mutedRef.current;
      stopAllAudio();
      const my = speechSeqRef.current;
      setEveSpeaking(true);
      eveLineRef.current = { text, endedAt: 0 };
      try {
        // Eve's voice is on only after the user tapped Activate: their choice, so not gated as speculative.
        const audio = await synthesize(text, 'eve', { userAsked: true });
        const a = eveAudioRef.current;
        if (!a || speechSeqRef.current !== my || mutedRef.current) return false;
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
          // Safety net for audio that never reports its end: the clip's own length (a long story beat
          // runs past 18s and used to be cut off by the next one), or 30s when the length isn't known.
          let guard = setTimeout(finish, 30000);
          a.play()
            .then(() => {
              if (Number.isFinite(a.duration) && a.duration > 0) {
                clearTimeout(guard);
                guard = setTimeout(finish, a.duration * 1000 + 2500);
              }
            })
            .catch((err) => {
              console.error('[Eve] play() rejected (wait):', err);
              finish();
            });
        });
      } catch (err) {
        console.error('[Eve] synth failed (wait):', err);
      } finally {
        if (speechSeqRef.current === my) {
          setEveSpeaking(false);
          eveSpeakingRef.current = false;
          eveLineRef.current.endedAt = Date.now();
        }
      }
      return speechSeqRef.current === my;
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

  // Paint (or repaint) one stop card. Identical cards come back from the
  // server cache for free; fresh ones draw from the hourly picture budget
  // (and cost Sparks in the app). `background` (the automatic first picture)
  // never opens the "Get Sparks" sheet: the card shows an inline link instead.
  const paintStop = useCallback(
    async (stop: ExperienceStop, i: number, useCity: string, useVibe: Vibe, opts: { background?: boolean } = {}) => {
      const same = (st: ExperienceStop, idx: number) => idx === i && st.name === stop.name;
      setStops((prev) =>
        prev.map((st, idx) => (same(st, idx) ? { ...st, status: 'generating', error: undefined, errorCode: undefined } : st))
      );
      try {
        const img = await stopImage(
          {
            name: stop.name,
            kind: stop.kind,
            oneLineVibe: stop.oneLineVibe,
            city: useCity,
            vibe: useVibe,
          },
          { background: opts.background }
        );
        const imageKey = pictureKey(stop, useCity, useVibe);
        void putPicture(imageKey, img.imageData, img.imageMime);
        setStops((prev) =>
          prev.map((st, idx) =>
            same(st, idx) ? { ...st, imageData: img.imageData, imageMime: img.imageMime, imageKey, status: 'ready' } : st
          )
        );
      } catch (err: any) {
        setStops((prev) =>
          prev.map((st, idx) =>
            same(st, idx) ? { ...st, status: 'error', error: err?.message || 'Image failed', errorCode: err?.code } : st
          )
        );
      }
    },
    []
  );

  // A new (or reopened) plan paints only the first stop's picture on its own;
  // the others wait for "Show picture" on their card, so one plan doesn't spend
  // a whole Sparks balance on pictures nobody asked for.
  const paintFirstStop = useCallback(
    (list: ExperienceStop[], useCity: string, useVibe: Vibe) => {
      setStops((prev) => prev.map((st, idx) => (idx === 0 ? st : { ...st, status: st.imageData ? st.status : 'pending' })));
      // Speculative: only when it can't spend Sparks the user didn't choose to spend (else "Show picture" stays).
      // A first stop that kept its picture (a refine that kept it) is not painted again.
      if (list[0] && !list[0].imageData && speculativeAiAllowed()) return paintStop(list[0], 0, useCity, useVibe, { background: true });
      return Promise.resolve();
    },
    [paintStop]
  );

  // Eve's narration of the evening (text + voice, kept on this device by key) and her send-off line.
  // Asked again whenever the stops change, so the player never narrates an evening that is gone.
  const loadNarrationAndOutro = useCallback(
    async (title: string, list: ExperienceStop[], useCity: string, useVibe: Vibe, isCurrent: () => boolean = () => !cancelRef.current) => {
      const textStops = list.map(({ imageData, imageMime, imageKey, availability, restored, status, error, errorCode, ...rest }) => ({ ...rest, status: 'pending' as const }));
      try {
        const nText = await narrationText({ title, stops: textStops, vibe: useVibe });
        if (!isCurrent()) return;
        setNarrationText(nText.narration || '');
        const audio = await synthesize(nText.narration, 'eve');
        if (!isCurrent()) return;
        setNarrationAudio(audio.audioData);
        setNarrationMime(audio.audioMime || 'audio/mpeg');
        // Kept on this device (by key) so a restored evening keeps its narration without new audio.
        const nKey = `narration|${title || ''}|${useCity}|${list.map((st) => st.name).join('|')}`.slice(0, 400);
        setNarrationKey(nKey);
        void putPicture(nKey, audio.audioData, audio.audioMime || 'audio/mpeg');
      } catch (err) {
        console.warn('narration audio skipped', err);
      }
      if (!isCurrent()) return;
      try {
        const o = await eveOutro({
          vibe: useVibe,
          city: useCity,
          stops: list.map((st) => ({ name: st.name, kind: st.kind })),
        });
        // Set the text bubble but DON'T auto-speak — the "Walk me through this
        // evening" button is the canonical Eve-narrated experience now,
        // and auto-speaking outro was a source of overlapping audio.
        if (isCurrent()) setEveOutroText(o.outro || '');
      } catch {}
    },
    []
  );

  const lastPlanKeyRef = useRef('');
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
      eveningIdRef.current = '';
      // A new plan is this visitor's own: no "A friend planned this", and the address no longer carries the
      // friend's evening (a reload comes back to this one).
      setFromShare(false);
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e')) {
        const u = new URL(window.location.href);
        u.searchParams.delete('e');
        window.history.replaceState({}, '', u.toString());
      }
      setError(null);
      setPhase('forging');
      setPlanTitle('');
      setStops([]);
      setStory(null);
      storySeqRef.current++; // a story still on its way for the last evening never lands on this one
      setStoryPending(false);
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

          // "Almost there" lines are for while she plans: once the evening is on screen (or something
          // else took the floor) she stops, so the walkthrough never fights a leftover intro line.
          for (const line of lines) {
            if (cancelRef.current || phaseRef.current !== 'forging') return;
            setEveIntroText(line);
            if (!(await speakAsEveAndWait(line).catch(() => true))) return;
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
            if (!(await speakAsEveAndWait(line).catch(() => true))) return;
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
            void putPicture(AVATAR_PICTURE_KEY, a.imageData, a.imageMime || 'image/png');
          })
          .catch(() => {});
      }

      // Eve-posted restaurants only mark cards as Eve Originals: look them up alongside the plan, and never
      // let a slow lookup hold the finished plan back for more than a moment.
      const evePostedP: Promise<string[]> = listSpecials(useCity.split(',')[0])
        .then((res) => (res.specials || []).map((s) => s.restaurantName.toLowerCase()))
        .catch(() => []);

      let skeleton: Awaited<ReturnType<typeof planSkeleton>>;
      const request = {
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
        // "Tonight" is the visitor's tonight, whatever time zone the server runs in.
        todayISO: todayISO(),
      };
      // Asking again for the very evening just planned here means "give me another one", not the cached plan.
      const requestKey = JSON.stringify(request);
      const fresh = lastPlanKeyRef.current === requestKey;
      lastPlanKeyRef.current = requestKey;
      try {
        skeleton = await planSkeleton({ ...request, ...(fresh ? { fresh: true } : {}) });
      } catch (err: any) {
        setError(err?.message || 'Eve could not plan your evening.');
        setPhase('input');
        return;
      }
      if (cancelRef.current) return;

      setPlanTitle(skeleton.title || 'A planned evening.');
      setGroundedSources(skeleton.groundedSources || []);
      setGroundedSearchUsed(!!skeleton.groundedSearchUsed);

      const evePosted = await Promise.race([evePostedP, new Promise<string[]>((r) => setTimeout(() => r([]), 2500))]);
      if (cancelRef.current) return;

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
      trackPulse('use');

      // Story (parallel with images)
      loadStory({
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

      // Only the first picture is painted automatically (the rest on tap).
      await paintFirstStop(initialStops, useCity, useVibe);

      if (cancelRef.current) return;

      await loadNarrationAndOutro(skeleton.title, initialStops, useCity, useVibe);
    },
    [city, vibe, party, dietary, budgetPerPerson, freeText, cuisinePref, whenISO, startTime, durationHours, speakAsEve, paintFirstStop, loadNarrationAndOutro]
  );


  // Reopen a saved or shared evening without planning it again.
  const restoreEvening = useCallback(
    (e: SavedEvening) => {
      cancelRef.current = false;
      eveningIdRef.current = e.id;
      if (e.city) setCity(e.city);
      setVibe(e.vibe);
      setParty(e.party);
      if (e.dietary.length) setDietary(e.dietary);
      setBudgetPerPerson(e.budgetPerPerson);
      setWhenISO(e.whenISO && e.whenISO >= todayISO() ? e.whenISO : todayISO());
      setStartTime(e.startTime);
      setDurationHours(e.durationHours);
      setError(null);
      setPlanTitle(e.title);
      setGroundedSources([]);
      setGroundedSearchUsed(false);
      setNarrationAudio(null);
      setNarrationText('');
      setEveIntroText('');
      setEveOutroText('');
      setChatHistory([]);
      autoWalkedRef.current = false;
      const restored: ExperienceStop[] = e.stops.map((st) => ({ ...st, status: 'pending' }));
      setStops(restored);
      setStory(e.story || null);
      setPhase('ready');
      if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
      if (!e.story) {
        loadStory({
          title: e.title,
          stops: restored.map((st) => ({ name: st.name, kind: st.kind, oneLineVibe: st.oneLineVibe, signatureItem: st.signatureItem })),
          vibe: e.vibe,
          city: e.city,
          party: e.party,
        })
          .then((st) => {
            if (!cancelRef.current) setStory(st);
          })
          .catch(() => {});
      }
      // Pictures painted for these stops before (kept on this device) come back without a new painting.
      void Promise.all(restored.map((st) => getPicture(pictureKey(st, e.city, e.vibe)).catch(() => null))).then((pics) => {
        if (cancelRef.current || eveningIdRef.current !== e.id) return;
        const withPics = restored.map((st, i) => {
          const pic = pics[i];
          return pic ? { ...st, imageData: pic.data, imageMime: pic.mime, imageKey: pictureKey(st, e.city, e.vibe), status: 'ready' as const } : st;
        });
        if (pics.some(Boolean)) {
          setStops((prev) =>
            prev.map((st, i) => (st.name === withPics[i]?.name && !st.imageData && withPics[i].imageData ? withPics[i] : st))
          );
        }
        void paintFirstStop(withPics, e.city, e.vibe);
      });
    },
    [paintFirstStop]
  );

  // Opening a shared link that carries a finished plan shows it directly.
  useEffect(() => {
    const shared = restored ? null : readSharedEvening();
    if (shared) {
      restoreEvening(shared);
      setFromShare(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the current evening in "Recent evenings" (text only, this device).
  const stopsSig = stops.map((st) => st.name).join('|');
  useEffect(() => {
    if (phase !== 'ready' || stops.length === 0 || !planTitle) return;
    if (!eveningIdRef.current) eveningIdRef.current = String(Date.now());
    const id = eveningIdRef.current;
    const t = setTimeout(() => {
      setRecentEvenings(
        saveEvening({
          id,
          savedAt: Date.now(),
          title: planTitle,
          city,
          vibe,
          party,
          dietary,
          budgetPerPerson,
          whenISO,
          startTime,
          durationHours,
          stops: stops.map(({ status, imageData, imageMime, imageKey, availability, restored, error, errorCode, ...rest }) => rest),
          story,
        })
      );
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, planTitle, stopsSig, story]);

  // Pictures painted before a reload come back from this device; a missing one waits for "Show picture".
  useEffect(() => {
    if (restoredEvening?.narrationKey) {
      void getPicture(restoredEvening.narrationKey).then((clip) => {
        if (!clip) return;
        setNarrationMime(clip.mime);
        setNarrationAudio((cur) => cur || clip.data);
      });
    }
    if (restoredEvening) {
      void getPicture(AVATAR_PICTURE_KEY).then((pic) => {
        if (pic) setEveAvatarUrl((cur) => cur || `data:${pic.mime};base64,${pic.data}`);
      });
    }
    const keyed = (restoredEvening?.stops || []).map((st, i) => ({ i, name: st.name, key: st.imageKey })).filter((x) => x.key);
    for (const { i, name, key } of keyed) {
      void getPicture(key!).then((pic) => {
        setStops((prev) =>
          prev.map((st, idx) =>
            idx === i && st.name === name && st.status === 'generating' && !st.imageData
              ? pic
                ? { ...st, imageData: pic.data, imageMime: pic.mime, status: 'ready' }
                : { ...st, imageKey: undefined, status: 'pending' }
              : st
          )
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep what is on screen (form + finished evening) so a reload or relaunch lands back here.
  // While a plan is being made only the form is kept: it comes back filled in, not re-sent.
  const [leavingHome, setLeavingHome] = useState(false);
  const snapshot = useMemo<DinerSnapshot | null>(() => {
    const form = { city, vibe, party, dietary, budgetPerPerson, cuisinePref, whenISO, startTime, durationHours, freeText, formExpanded };
    const search = typeof window === 'undefined' ? '' : window.location.search;
    if (phase !== 'ready' || stops.length === 0 || !planTitle) return { search, form, evening: null };
    // A change sent to Eve but not answered yet: keep the message in the box (unsent) instead.
    let history = chatHistory;
    let input = chatInput;
    const last = chatHistory[chatHistory.length - 1];
    if (refining && last?.role === 'user') {
      history = chatHistory.slice(0, -1);
      input = chatInput || last.text;
    }
    return {
      search,
      form,
      evening: {
        id: eveningIdRef.current,
        title: planTitle,
        stops: stops.map(({ status, imageData, imageMime, imageKey, restored, error, errorCode, ...rest }) =>
          imageData && imageKey ? { ...rest, imageKey } : rest
        ),
        story,
        introText: eveIntroText,
        outroText: eveOutroText,
        chatHistory: history,
        chatInput: input,
        narrationText: narrationAudio ? narrationText_ : '',
        narrationKey: narrationAudio ? narrationKey : '',
        groundedSources,
        groundedSearchUsed,
      },
    };
  }, [city, vibe, party, dietary, budgetPerPerson, cuisinePref, whenISO, startTime, durationHours, freeText, formExpanded,
    phase, stops, planTitle, story, eveIntroText, eveOutroText, chatHistory, chatInput, refining, groundedSources, groundedSearchUsed,
    narrationAudio, narrationText_, narrationKey]);
  useSnapshot(DINER_SNAPSHOT_KEY, DINER_SNAPSHOT_V, leavingHome ? null : snapshot);

  const toggleVoiceListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (voiceListening) {
      voiceListeningRef.current = false;
      try {
        rec.stop();
      } catch {}
      setVoiceListening(false);
      return;
    }
    baseTextRef.current = freeText;
    setVoiceTranscript('');
    voiceTranscriptRef.current = '';
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
  // Voice changes go through refineEvening (defined below, read through a ref).
  const refineEveningRef = useRef<(msg: string, opts?: { voice?: boolean }) => Promise<void>>(async () => {});
  const processTranscript = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;

      // Walkthrough barge-in / post-plan voice: refine, don't replan.
      if (stops.length > 0 && phaseRef.current === 'ready') {
        // Stop the walkthrough so we can react to what they said.
        walkingCancelRef.current = true;
        setWalkingIdx(-1);
        stopAllAudio();
        // Same path as a typed change: kept stops keep their pictures, the story and narration follow.
        await refineEveningRef.current(transcript, { voice: true });
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

  // Deactivate (header): Eve goes quiet AND the mic really turns off, and the conversation ends, so nothing
  // the user says afterwards is heard or acted on. (The muted effect silences her audio and the walkthrough.)
  const deactivateEve = useCallback(() => {
    mutedRef.current = true;
    userMutedRef.current = true;
    setMuted(true);
    setUserMuted(true);
    voiceListeningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {}
    setVoiceListening(false);
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    silenceTimerRef.current = null;
    setVoiceTranscript('');
    voiceTranscriptRef.current = '';
    setConversationActive(false);
    conversationActiveRef.current = false;
  }, []);

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

    // Case 4: in conversation, mic is off (the user muted it, or the browser ended it) → listen again
    if (userMutedRef.current || !voiceListeningRef.current) {
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

  // Ask Eve (typed) and the tweak chips change the current evening; they never re-plan it from scratch.
  // A chip (adjust) keeps the stops' number, order, kinds, area and vibe and only swaps or adjusts stops.
  const refineEvening = useCallback(async (
    msg: string,
    opts: { adjust?: boolean; budgetPerPerson?: number; dietary?: DietaryPreference[]; shown?: string; voice?: boolean } = {}
  ) => {
    if (!msg || refining) return;
    // A change while Eve walks through the evening: stop the walk, so her reply isn't cut off by the next beat.
    walkingCancelRef.current = true;
    setWalkingIdx(-1);
    setChatHistory((h) => [...h, { role: 'user', text: opts.shown || msg }]);
    setRefining(true);
    const perPerson = opts.budgetPerPerson ?? budgetPerPerson;
    const useDietary = opts.dietary ?? dietary;
    const before = stops;

    try {
      const previousPlan = {
        stops: before.map((s) => ({ name: s.name, kind: s.kind, oneLineVibe: s.oneLineVibe, approxArrival: s.approxArrival, signatureItem: s.signatureItem, durationMinutes: s.durationMinutes, walkMinutesFromPrev: s.walkMinutesFromPrev })),
      };
      const result = await eveRefine({
        message: msg,
        previousPlan,
        vibe,
        city,
        dietary: useDietary,
        party,
        budgetUSD: perPerson * party,
        adjust: !!opts.adjust,
      });
      if (cancelRef.current) return;

      setChatHistory((h) => [...h, { role: 'eve', text: result.spokenReply, ai: true }]);
      if (result.spokenReply) {
        if (opts.voice) {
          setEveIntroText(result.spokenReply);
          await speakAsEveAndWait(result.spokenReply);
        } else speakAsEve(result.spokenReply);
      }

      if (result.stops?.length) {
        const title = result.title || planTitle;
        setPlanTitle(title);
        const newStops: ExperienceStop[] = result.stops.map((s) => {
          const fresh: ExperienceStop = {
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
          };
          // A stop Eve kept (same place, same kind) keeps its picture and booking links: nothing is painted
          // or checked again for it.
          const kept = before.find((p) => p.kind === fresh.kind && p.name.trim().toLowerCase() === fresh.name.trim().toLowerCase());
          if (!kept) return fresh;
          return {
            ...fresh,
            isEveOriginal: fresh.isEveOriginal || !!kept.isEveOriginal,
            ...(kept.availability ? { availability: kept.availability } : {}),
            ...(kept.imageData
              ? { imageData: kept.imageData, imageMime: kept.imageMime, imageKey: kept.imageKey, status: 'ready' as const }
              : {}),
          };
        });
        setStops(newStops);
        trackPulse('use');
        // The old narration and send-off describe the old evening: drop them until the new ones arrive.
        setNarrationAudio(null);
        setNarrationText('');
        setNarrationKey('');
        setPlaying(false);
        try {
          audioRef.current?.pause();
        } catch {}
        setEveOutroText('');
        // The refreshed plan walks itself through again (voice on).
        autoWalkedRef.current = false;

        loadStory({
          title,
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
          .then((st) => {
            if (!cancelRef.current) setStory(st);
          })
          .catch(() => {});

        // First stop's picture automatically (unless it kept one), the rest on tap.
        await paintFirstStop(newStops, city, vibe);
        void loadNarrationAndOutro(title, newStops, city, vibe);
      }
    } catch (err: any) {
      setChatHistory((h) => [
        ...h,
        { role: 'eve', text: 'Sorry, I lost my train of thought. Try that again?' },
      ]);
      // Put a typed message back so one tap on Send retries it (a chip is just tapped again).
      if (!opts.adjust && !opts.voice) setChatInput((cur) => cur || msg);
      if (opts.voice) toast.error(err?.message || 'Eve couldn\u2019t change the plan just now. Try again.');
    } finally {
      setRefining(false);
    }
  }, [refining, stops, vibe, city, dietary, party, budgetPerPerson, planTitle, speakAsEve, speakAsEveAndWait, paintFirstStop, loadNarrationAndOutro, loadStory, toast]);

  refineEveningRef.current = refineEvening;

  const sendChat = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg || refining) return;
    setChatInput('');
    void refineEvening(msg);
  }, [chatInput, refining, refineEvening]);

  // Walks through the evening: highlights each stop in sequence as Eve
  // speaks the corresponding story beat. The mic stays open the entire time
  // so the user can interrupt — barge-in pauses Eve and routes the user's
  // line to eve-refine, which swaps stops and resumes the walkthrough.
  const startWalkthrough = useCallback(async () => {
    console.log('[Eve] startWalkthrough invoked, story present:', !!story);
    if (!story) return;
    walkingCancelRef.current = false;
    const run = ++walkRunRef.current;
    stopAllAudio();

    // Keep the mic listening through the whole walkthrough so true barge-in
    // is possible. If the recognizer isn't already running, start it.
    try {
      const rec = recognitionRef.current;
      if (rec && !voiceListeningRef.current && !userMutedRef.current) {
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

    const beats = storyBeats(story, stops.length);

    for (let b = 0; b < beats.length; b++) {
      if (walkingCancelRef.current || walkRunRef.current !== run) break;
      setWalkingIdx(b);
      if (!(await speakAsEveAndWait(beats[b].text))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (walkRunRef.current === run) setWalkingIdx(-1);
  }, [story, stops.length, speakAsEveAndWait, stopAllAudio]);

  // Auto-trigger the walkthrough once the plan is fully loaded. Eve walks
  // the user through the evening on her own — no button click needed.
  // We do NOT respect walkingCancelRef here; we forcibly clear it and start.
  useEffect(() => {
    if (autoWalkedRef.current) return;
    if (muted) return;
    if (!story) return;
    if (stops.length < 2) return;
    if (!stops.every((s) => s.status !== 'generating')) return;
    // Marked walked only when it really starts: a picture landing in the next 900ms re-runs this effect
    // and clears the timer, and marking it earlier meant the walkthrough then never started at all.
    console.log('[Eve] auto-walk: scheduling startWalkthrough in 900ms');
    const t = setTimeout(() => {
      if (autoWalkedRef.current) return;
      autoWalkedRef.current = true;
      console.log('[Eve] auto-walk: firing startWalkthrough now');
      walkingCancelRef.current = false;
      startWalkthrough();
    }, 900);
    return () => clearTimeout(t);
  }, [story, stops, muted, startWalkthrough]);

  // Turning Eve's voice on over an evening that has no story yet (it was skipped while she was muted):
  // write it now, so she can walk the user through it.
  useEffect(() => {
    if (muted || phaseRef.current !== 'ready' || stops.length === 0 || story || storyPending) return;
    loadStory({
      title: planTitle,
      stops: stops.map((s) => ({ name: s.name, kind: s.kind, oneLineVibe: s.oneLineVibe, signatureItem: s.signatureItem })),
      vibe,
      city,
      party,
    })
      .then((st) => {
        if (!cancelRef.current) setStory(st);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  const stopWalkthrough = useCallback(() => {
    walkingCancelRef.current = true;
    speechSeqRef.current++; // a beat still being voiced never starts after Stop

    setWalkingIdx(-1);
    if (eveAudioRef.current) {
      try {
        eveAudioRef.current.pause();
      } catch {}
    }
  }, []);

  // The beat Eve is speaking: a scene highlights its stop's card; a transition lights its bridge.
  const walkBeats = storyBeats(story, stops.length);
  const activeBeat = walkingIdx >= 0 ? walkBeats[walkingIdx] : undefined;
  const highlightedStopIdx = activeBeat?.kind === 'scene' ? activeBeat.stop : -1;

  // What the user sees of the plan, for a content report (the kit trims to 1200 chars).
  const planReportText = () =>
    [
      `Plan: ${planTitle} (${city}, ${formatDate(whenISO)})`,
      ...stops.map((s, i) => `${i + 1}. ${s.name} (${s.kind}, ${s.approxArrival}): ${s.oneLineVibe} ${s.whyThisFits}${s.signatureItem ? ` Order: ${s.signatureItem}.` : ''}`),
      story
        ? `Story: ${storyBeats(story, stops.length).map((b) => b.text).join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

  const sharePlan = useCallback(async () => {
    const url = buildShareURL({
      city,
      vibe,
      party,
      dietary,
      budgetPerPerson,
      cuisinePref,
      whenISO,
      // The typed request stays on this device: share links never carry it.
      startTime,
      durationHours,
    }, { title: planTitle, stops });
    // Web Share sheet where available, otherwise copy (the kit shows a "Link copied" toast).
    const result = await shareOrCopy({
      title: planTitle || 'My evening on Eve',
      text: planTitle ? `${planTitle} — planned by Eve` : 'Planned by Eve',
      url,
    });
    if (result === 'copied') {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2400);
    }
  }, [city, vibe, party, dietary, budgetPerPerson, cuisinePref, whenISO, startTime, durationHours, planTitle, stops]);

  // "Add to calendar": an .ics with one event per stop at its arrival time, on the plan's date (today when it has none).
  const addToCalendar = useCallback(async () => {
    const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(whenISO || '') ? whenISO : todayISO();
    const ics = eveningIcs({ title: planTitle || 'My evening', city, dateISO, stops });
    const name = `${(planTitle || 'eve-evening').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'eve-evening'}.ics`;
    const file = new File([ics], name, { type: 'text/calendar' });
    // The Android app's web view can't save a blob download: hand the file to the share sheet there.
    if (isNativeApp() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: planTitle || 'My evening on Eve' });
        return;
      } catch {
        /* cancelled or unsupported: fall back to a download */
      }
    }
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }, [whenISO, planTitle, city, stops]);

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
      // Stop any other Eve audio first (and any line still being voiced)
      speechSeqRef.current++;
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
      <div className="relative z-10 min-h-dvh flex flex-col">
        <audio ref={eveAudioRef} preload="auto" />
        <AppHeader
          title="Eve"
          icon={<EveLogo size={26} />}
          onTitleClick={() => {
            // Eve home starts completely fresh: drop the saved form too, then leave once that render is in.
            clearSnapshot(DINER_SNAPSHOT_KEY);
            setLeavingHome(true);
            setTimeout(() => {
              window.location.href = '/';
            }, 0);
          }}
          titleLabel="Eve home"
          onRules={openRules}
          rulesLabel="How Eve works"
          onSettings={openSettings}
          backup={{ backup, onOpen: backupEntry.show, open: backupEntry.open }}
          right={
            <>
            <CreditsChip />
            {muted ? (
              <button
                onClick={() => {
                  mutedRef.current = false;
                  userMutedRef.current = false;
                  setMuted(false);
                  setUserMuted(false);
                  playGreetingOnce(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 md:px-3.5 h-10 rounded-xl bg-eve-gold text-eve-ink hover:bg-yellow-300 transition-all outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink shadow-[0_0_18px_rgba(245,197,66,0.28)] text-xs font-bold uppercase tracking-wider"
                title="Turn on mic + sound and start talking with Eve"
                aria-label="Activate Eve"
              >
                <Mic size={14} />
                <Volume2 size={14} />
                <span className="hidden sm:inline">Activate</span>
              </button>
            ) : (
              <button
                onClick={deactivateEve}
                className="p-2 md:p-2.5 h-10 min-w-10 flex items-center justify-center bg-eve-ink-soft rounded-xl border border-white/[0.08] hover:bg-mg-surface-2 transition-all outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink"
                title="Mute Eve and turn off mic"
                aria-label="Deactivate Eve"
              >
                <Volume2 size={18} className="text-eve-gold" />
              </button>
            )}
            <IconButton
              onClick={onSwitchToRestaurant}
              aria-label="For restaurants"
              title="For restaurants"
            >
              <Store size={18} className="text-eve-cream/70" />
            </IconButton>
            </>
          }
        />

        <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 md:py-12">
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
                  <div className="absolute -right-9 bottom-0">
                    <ReportContentButton app="eve" kind="image" label="Report Eve’s portrait" content={AVATAR_REPORT} />
                  </div>
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
                      : 'Tap to talk'}
              </button>
            )}
            <button
              onClick={surpriseMe}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base transition-all border outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink hover:scale-[1.02] active:scale-[0.98] bg-eve-ink-soft text-eve-gold border-eve-gold/25 hover:bg-mg-surface-2 hover:border-eve-gold/45 shadow-lg shadow-eve-gold/10"
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
            <div className="relative max-w-xl mx-auto mb-5 px-9 py-3 rounded-2xl border border-eve-gold/30 bg-eve-gold/5 text-center animate-fade-in">
              <div className="absolute top-1 right-1">
                <ReportContentButton app="eve" kind="chat" label="Report what Eve said" content={`Eve says: "${eveIntroText}"`} />
              </div>
              <p className="text-[11px] tracking-wide text-eve-gold/80 mb-1 italic font-serif inline-flex items-center gap-1.5">
                {eveSpeaking && (
                  <span className="w-1.5 h-1.5 rounded-full bg-eve-gold animate-pulse" />
                )}
                Eve says
              </p>
              <p className="font-serif italic text-base text-eve-cream/90">"{eveIntroText}"</p>
            </div>
          )}

          {recentEvenings.length > 0 && (
            <section aria-labelledby="recent-evenings" className="max-w-2xl mx-auto mb-7">
              <h2 id="recent-evenings" className="text-center text-[12px] tracking-wide text-eve-gold/80 mb-2 italic font-serif inline-flex w-full items-center justify-center gap-1.5">
                <History size={12} aria-hidden="true" />
                Your recent evenings
              </h2>
              <ul className="flex flex-wrap justify-center gap-2">
                {recentEvenings.map((e) => (
                  <li key={e.id} className="flex items-stretch max-w-full rounded-full border border-white/10 bg-white/[0.04] hover:border-eve-gold/40 transition-colors">
                    <button
                      onClick={() => restoreEvening(e)}
                      className="min-w-0 pl-3.5 pr-2 py-1.5 text-left rounded-l-full outline-none focus-visible:ring-2 focus-visible:ring-eve-gold"
                      title={`Reopen "${e.title}"`}
                    >
                      <span className="block truncate max-w-[16rem] text-[13px] font-serif italic text-eve-cream/90">{e.title}</span>
                      <span className="block truncate max-w-[16rem] text-[11px] text-eve-cream/55">
                        {(e.city || '').split(',')[0]} · {e.stops.length} {e.stops.length === 1 ? 'stop' : 'stops'} · {timeAgo(e.savedAt)}
                      </span>
                    </button>
                    <button
                      onClick={() => setRecentEvenings(removeEvening(e.id))}
                      className="px-2.5 rounded-r-full text-eve-cream/45 hover:text-eve-rose outline-none focus-visible:ring-2 focus-visible:ring-eve-gold"
                      aria-label={`Remove "${e.title}" from recent evenings`}
                      title="Remove"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="text-center mb-5">
            <button
              onClick={() => setFormExpanded((v) => !v)}
              aria-expanded={formExpanded}
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
                      aria-pressed={active}
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
              <p className="mt-2 text-[12px] text-eve-cream/60 italic">
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
                    ref={locationInputRef}
                    type="text"
                    aria-label="Location"
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
                    aria-label="Use my location"
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
                    aria-label="Date of the evening"
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
                    aria-label="Start time"
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
                    aria-label={`Duration, ${durationHours} hours`}
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
                  aria-label="Party size"
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
                  aria-label="Cuisine"
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
                    aria-label="Budget per person in dollars"
                    min={20}
                    step={10}
                    value={budgetPerPerson}
                    onChange={(e) => setBudgetPerPerson(parseInt(e.target.value) || 50)}
                    className="w-full pl-8 pr-5 py-3.5 rounded-2xl bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-base"
                  />
                </div>
                <p className="mt-1 text-[11px] text-eve-cream/60 italic font-serif">
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
                      aria-pressed={active}
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
                aria-label="Tell Eve more"
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
              <div role="alert" className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                {city.trim() && (
                  <button
                    onClick={() => buildPlan()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-400/40 text-red-100 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-eve-gold"
                  >
                    <RotateCcw size={12} />
                    Try again
                  </button>
                )}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => buildPlan()}
                disabled={!city.trim()}
                className="w-full group inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl font-bold text-lg transition-all border outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink hover:scale-[1.01] active:scale-[0.99] bg-eve-ink-soft text-eve-gold border-eve-gold/25 hover:bg-mg-surface-2 hover:border-eve-gold/45 disabled:bg-eve-ink disabled:text-eve-cream/35 disabled:border-white/10 disabled:cursor-not-allowed shadow-lg shadow-eve-gold/15"
              >
                <Wand2 size={20} />
                Plan my evening
              </button>
              {imageLimit && (
                <p className="mt-2 text-center text-[12px] text-eve-cream/60 italic font-serif" aria-live="polite">
                  {imageLimit.remaining > 0
                    ? `Eve paints the first stop card; tap Show picture for the others. ${imageLimit.remaining} of ${imageLimit.limit} paintings left this hour; repeat cards are free.`
                    : `Eve has painted her ${imageLimit.limit} cards for this hour. Plans still work, with photos, until she rests (about ${Math.max(1, Math.ceil(imageLimit.resetInSec / 60))} min).`}
                </p>
              )}
            </div>
          </div>
        </main>

        <footer className="mt-auto">
          <p className="text-center py-6 text-[11px] text-white/55 italic font-serif">Eve · Yours, quietly</p>
          <div className="border-t border-mg-border-subtle px-4 py-3 flex flex-col items-center text-center gap-1 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:text-left sm:gap-2 text-[10px] text-mg-muted">
            <span>
              {!isNativeApp() && (<>
              Last Updated:{' '}
              {new Date(document.lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}{' '}
              {new Date(document.lastModified).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
              </>)}
            </span>
            <span className="sm:text-center">© {new Date().getFullYear()} {COPYRIGHT}</span>
            <span className="sm:justify-self-end flex items-center gap-2">
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="hover:text-mg-text transition-colors">
                Privacy Policy
              </a>
              <span aria-hidden="true">·</span>
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="hover:text-mg-text transition-colors">
                Terms
              </a>
            </span>
          </div>
        </footer>
        <BackupModal open={backupEntry.open} onClose={backupEntry.close} backup={backup} what="Your recent evenings and restaurant profile" noun="evenings" {...(backupEntry.initialCode ? { initialCode: backupEntry.initialCode } : {})} />
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-dvh flex flex-col">
      <audio ref={audioRef} preload="auto" />
      <audio ref={eveAudioRef} preload="auto" />

      <AppHeader
        title="Eve"
        icon={<EveLogo size={26} />}
        onTitleClick={reset}
        titleLabel="Start a new evening"
        onRules={openRules}
        rulesLabel="How Eve works"
        onSettings={openSettings}
        right={
          <>
          <CreditsChip />
          {phase === 'ready' && stops.length > 0 && (
            <IconButton
              onClick={sharePlan}
              aria-label={shareCopied ? 'Plan copied' : 'Share plan'}
              title={shareCopied ? 'Copied!' : 'Share this evening'}
            >
              {shareCopied ? <Check size={18} className="text-emerald-400" /> : <Share2 size={18} className="text-eve-cream/70" />}
            </IconButton>
          )}
          <IconButton
            onClick={reset}
            aria-label="Edit plan"
            title="Edit plan"
          >
            <Pencil size={18} className="text-eve-cream/70" />
          </IconButton>
          {muted ? (
            <button
              onClick={() => {
                mutedRef.current = false;
                userMutedRef.current = false;
                setMuted(false);
                setUserMuted(false);
                // An evening is already on screen: no "what evening shall we make?" hello. Eve walks
                // through it instead (the auto-walk, or the button when she already walked it).
                greetingPlayedRef.current = true;
                setEveGreeted(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 md:px-3.5 h-10 rounded-xl bg-eve-gold text-eve-ink hover:bg-yellow-300 transition-all outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink shadow-[0_0_18px_rgba(245,197,66,0.28)] text-xs font-bold uppercase tracking-wider"
              title="Turn on Eve's voice"
              aria-label="Activate Eve"
            >
              <Mic size={14} />
              <span className="hidden sm:inline">Activate</span>
            </button>
          ) : (
            <button
              onClick={deactivateEve}
              className="p-2 md:p-2.5 h-10 min-w-10 flex items-center justify-center bg-eve-ink-soft rounded-xl border border-white/[0.08] hover:bg-mg-surface-2 transition-all outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink"
              title="Mute Eve"
              aria-label="Mute Eve"
            >
              <Volume2 size={18} className="text-eve-gold" />
            </button>
          )}
          </>
        }
      />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 md:px-8 py-8">
        <div className="text-center mb-6">
          <p className="text-mg-2xs tracking-wide text-eve-gold/75 mb-2 italic font-serif">
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
          {phase === 'ready' && fromShare && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-eve-gold/40 text-xs font-medium text-eve-cream/80 hover:text-eve-cream transition-colors"
              >
                <Sparkles size={11} />
                A friend planned this. Plan your own evening.
              </button>
            </div>
          )}
          {phase === 'ready' && stops.length > 0 && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => void addToCalendar()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-eve-gold/40 text-xs font-medium text-eve-cream/80 hover:text-eve-cream transition-colors"
              >
                <CalendarPlus size={11} />
                Add to calendar
              </button>
            </div>
          )}
          {phase === 'ready' && stops.length > 0 && (
            <div className="mt-1 flex justify-center">
              <ReportContentButton
                app="eve"
                kind="plan"
                variant="link"
                label="Report this plan"
                content={planReportText}
                contentKey={`${planTitle}|${stops.map((s) => s.name).join('|')}|${story?.opening || ''}`}
              />
            </div>
          )}
          {phase === 'forging' && loadingMessage && (
            <div className="mt-4 mx-auto inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-eve-ink-soft border border-eve-gold/25 text-eve-gold shadow-lg shadow-eve-gold/10 max-w-2xl">
              <Loader2 size={16} className="animate-spin flex-shrink-0" />
              <span role="status" aria-live="polite" className="text-sm font-normal text-eve-cream/85">
                {loadingMessage}
              </span>
            </div>
          )}
          <div className={`mt-3 flex flex-wrap items-center justify-center gap-2 ${phase === 'ready' && (storyPending || story) ? 'min-h-6' : ''}`}>
            {story?.moodArc && (
              <span className="text-xs tracking-wide text-eve-gold/85 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-eve-gold/10 border border-eve-gold/30 italic font-serif">
                <Heart size={10} />
                {story.moodArc}
              </span>
            )}
            {story?.weatherCue && (
              <span className="text-xs tracking-wide text-eve-cream/65 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 italic font-serif">
                <Wind size={10} />
                {story.weatherCue}
              </span>
            )}
          </div>
        </div>

        {(eveIntroText || eveOutroText) && (
          <div className="relative max-w-2xl mx-auto mb-8 pl-5 pr-10 py-4 rounded-2xl bg-gradient-to-br from-eve-rose/10 to-eve-plum/10 border border-eve-gold/25 animate-fade-in">
            <div className="absolute top-1.5 right-1.5">
              <ReportContentButton
                app="eve"
                kind="chat"
                label="Report what Eve said"
                content={`Eve says: "${eveOutroText || eveIntroText}"${eveAvatarUrl ? `\n${AVATAR_REPORT}` : ''}`}
              />
            </div>
            <div className="flex items-start gap-4">
              {/* The circle is always there (gradient until the portrait arrives), so the
                  text beside it doesn't jump when the picture loads. */}
              <div
                className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden ring-2 transition-all bg-gradient-to-br from-eve-plum/55 via-eve-rose/35 to-eve-gold/30 ${
                  eveSpeaking ? 'ring-eve-rose/80 animate-glow-pulse' : 'ring-eve-gold/45'
                }`}
              >
                {eveAvatarUrl && (
                  <img
                    src={eveAvatarUrl}
                    alt="Eve"
                    width={512}
                    height={512}
                    className="w-full h-full object-cover scale-110 animate-fade-in"
                  />
                )}
              </div>
              <div className="flex-1 text-center md:text-left">
                <p className="text-xs tracking-wide text-eve-gold/80 mb-1.5 inline-flex items-center gap-1.5 italic font-serif">
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
          {!story?.opening && storyPending && phase === 'ready' && (
            <div className="px-4 space-y-2 min-h-[3.5rem] md:min-h-[4rem]" aria-hidden="true">
              <div className="h-5 w-5/6 mx-auto rounded-lg bg-white/[0.06] animate-pulse" />
              <div className="h-5 w-2/3 mx-auto rounded-lg bg-white/[0.05] animate-pulse" />
            </div>
          )}
          {story?.opening && (
            <div className="text-center px-4 animate-fade-in-up">
              <p className="font-serif italic text-lg md:text-xl text-eve-cream/85 leading-relaxed">
                {story.opening}
              </p>
            </div>
          )}

          {phase === 'forging' && stops.length === 0 && (
            <div className="space-y-6" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-3xl overflow-hidden border border-white/10 bg-white/[0.03]">
                  <div className="aspect-[16/10] bg-gradient-to-br from-eve-plum/40 via-eve-ink-soft to-eve-plum/30 animate-pulse" />
                  <div className="p-5 space-y-3">
                    <div className="h-6 w-2/3 rounded-lg bg-white/[0.07] animate-pulse" />
                    <div className="h-4 w-full rounded-lg bg-white/[0.05] animate-pulse" />
                    <div className="h-4 w-5/6 rounded-lg bg-white/[0.05] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {stops.map((stop, i) => {
            const sceneText = sceneTextFor(story, i);
            const transitionText = transitionTextFor(story, i);
            const transitionActive = activeBeat?.kind === 'transition' && activeBeat.stop === i;
            const sceneActive = activeBeat?.kind === 'scene' && activeBeat.stop === i;
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
                  whenISO={whenISO}
                  startTime={startTime}
                  party={party}
                  highlighted={highlightedStopIdx === i}
                  dimmed={walkingIdx >= 0 && highlightedStopIdx >= 0 && highlightedStopIdx !== i}
                  onRetryImage={() => paintStop(stop, i, city, vibe)}
                  onShowImage={() => paintStop(stop, i, city, vibe)}
                  onAvailability={(a) =>
                    setStops((prev) => prev.map((st, idx) => (idx === i && st.name === stop.name ? { ...st, availability: a } : st)))
                  }
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

        {stops.length >= 2 && stops.every((s) => s.status !== 'generating') && story && (
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

        {stops.length >= 2 && stops.every((s) => s.status !== 'generating') && (
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
          <span className="text-mg-2xs text-eve-cream/60 italic font-serif mr-1">
            Tweak the evening
          </span>
          {[
            { label: 'More upscale', icon: ArrowUpRight, suffix: ' Make every stop more upscale and refined.' },
            { label: 'More casual', icon: ArrowDownRight, suffix: ' Make every stop more casual and easygoing.' },
            { label: 'Earlier', icon: ClockIcon, suffix: '' },
            { label: 'Vegan only', icon: Leaf, suffix: ' Strictly vegan across all stops.' },
            { label: 'Cheaper', icon: Coins, suffix: '' },
          ].map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                disabled={refining}
                onClick={() => {
                  // A tweak adjusts this evening (same stops, order, area and vibe). The form keeps the ask,
                  // so a later "Plan my evening" plans with it too.
                  if (chip.label === 'Earlier') {
                    // An hour earlier than this evening starts now (never before 3 PM); the form follows.
                    const [hh, mm] = (startTime || '19:30').split(':').map((n) => parseInt(n, 10) || 0);
                    const mins = Math.max(15 * 60, hh * 60 + mm - 60);
                    const next = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
                    setStartTime(next);
                    void refineEvening(
                      `Move the whole evening earlier: Stop 1 at ${clockLabel(next)}, and every later stop earlier by the same amount. Keep every venue.`,
                      { adjust: true, shown: chip.label },
                    );
                    return;
                  }
                  if (chip.label === 'Vegan only') {
                    const nextDietary: DietaryPreference[] = dietary.includes('vegan') ? dietary : [...dietary, 'vegan'];
                    setDietary(nextDietary);
                    void refineEvening(chip.suffix.trim(), { adjust: true, dietary: nextDietary, shown: chip.label });
                    return;
                  }
                  if (chip.label === 'Cheaper') {
                    const half = Math.max(20, Math.round(budgetPerPerson / 2 / 10) * 10);
                    setBudgetPerPerson(half);
                    void refineEvening(
                      `Make it cheaper: about half the budget, around $${half} a person ($${half * party} in all). Keep every stop that is already inexpensive; swap each pricier one for a cheaper real venue of the same kind nearby, or a cheaper order at the same place.`,
                      { adjust: true, budgetPerPerson: half, shown: chip.label },
                    );
                    return;
                  }
                  if (!freeText.includes(chip.suffix.trim())) setFreeText((freeText || '') + chip.suffix);
                  void refineEvening(chip.suffix.trim(), { adjust: true, shown: chip.label });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-eve-gold/40 text-xs font-medium text-eve-cream/80 hover:text-eve-cream transition-colors disabled:opacity-50"
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
                aria-label={playing ? 'Pause narration' : 'Play narration'}
                className="flex-shrink-0 w-12 h-12 rounded-full bg-eve-gold text-eve-ink hover:bg-amber-200 transition-all flex items-center justify-center animate-glow-pulse"
              >
                {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-eve-gold/80 mb-0.5 italic font-serif">
                  Eve narrates your evening
                </p>
                <p className="text-[0.875rem] text-eve-cream/85 italic font-serif leading-snug line-clamp-2">
                  {narrationText_}
                </p>
              </div>
              {narrationText_ && (
                <ReportContentButton app="eve" kind="narration" label="Report the narration" content={narrationText_} />
              )}
            </div>
          </div>
        )}

        <div className="mt-8 max-w-2xl mx-auto">
          <p className="text-center text-mg-2xs text-eve-gold/75 mb-3 italic font-serif">
            Ask Eve anything about your evening
          </p>
          {chatHistory.length > 0 && (
            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
              {chatHistory.map((m, i) =>
                m.role === 'eve' && m.ai ? (
                  <div key={i} className="flex items-start gap-1">
                    <div className="flex-1 min-w-0 px-4 py-3 rounded-2xl text-[0.875rem] leading-relaxed bg-eve-rose/10 border border-eve-rose/20 text-eve-cream/95 italic font-serif">
                      {m.text}
                    </div>
                    <ReportContentButton app="eve" kind="chat" label="Report Eve’s reply" content={`Eve replied: "${m.text}"`} className="mt-1.5" />
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`px-4 py-3 rounded-2xl text-[0.875rem] leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-white/[0.06] text-eve-cream ml-8 text-right'
                        : 'bg-eve-rose/10 border border-eve-rose/20 text-eve-cream/95 mr-8 italic font-serif'
                    }`}
                  >
                    {m.text}
                  </div>
                )
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder='e.g. "swap dessert for live music" or "make it walking only"'
              aria-label="Ask Eve to change the evening"
              disabled={refining}
              className="flex-1 px-5 py-3.5 rounded-full bg-white/5 border border-white/10 focus:border-eve-gold focus:outline-none transition-colors text-[0.9375rem] disabled:opacity-50"
            />
            <button
              onClick={sendChat}
              aria-label="Send to Eve"
              disabled={!chatInput.trim() || refining}
              className="w-12 h-12 rounded-full bg-eve-gold text-eve-ink hover:bg-amber-200 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              {refining ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>

        {phase === 'ready' && stops.length > 0 && <MoreApps className="mt-12" />}
      </main>

      <AppFooter className="py-6">
        <p className="text-xs text-white/55 italic font-serif">Eve · Yours, quietly</p>
      </AppFooter>
    </div>
  );
}
