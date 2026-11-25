import { useEffect, useState } from 'react';
import { MapPin, Clock, Footprints, Sparkles, ExternalLink, BookOpen, RotateCcw, ImageIcon } from 'lucide-react';
import type { ExperienceStop, StopKind } from '../types';
import { STOP_KINDS } from '../constants';
import { buildReservationLinks } from '../lib/reservations';
import { ReportContentButton, openCreditsSheet, speculativeAiAllowed, useCredits } from '../ui-kit';
import { checkReservations } from '../services/eveService';

interface Props {
  stop: ExperienceStop;
  index: number;
  city?: string;
  whenISO?: string;
  startTime?: string;
  party?: number;
  highlighted?: boolean;
  dimmed?: boolean;
  /** Repaint this card after a failed image. */
  onRetryImage?: () => void;
  /** Paint this card's picture on request (only the first stop is painted automatically). */
  onShowImage?: () => void;
  /** The background booking check answered (kept with the stop so a restored page shows the same links). */
  onAvailability?: (a: AvailabilityMap) => void;
}

const RESERVABLE_KINDS: StopKind[] = ['dinner', 'dessert', 'drink', 'live_music'];

interface AvailabilityMap {
  opentable: boolean;
  resy: boolean;
  tock: boolean;
}

// Per-kind food / scene photograph used as a soft warm placeholder while
// Eve's AI image renders. The placeholder is hidden the moment the AI image
// is delivered (we toggle it via React state, not just z-stacking) so a
// stock photo can never appear over a real generation.
const KIND_PLACEHOLDERS: Record<StopKind, string> = {
  dinner: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=720&q=70&auto=format&fit=crop',
  dessert: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=720&q=70&auto=format&fit=crop',
  drink: 'https://images.unsplash.com/photo-1551751299-1b51cab2694c?w=720&q=70&auto=format&fit=crop',
  walk: 'https://images.unsplash.com/photo-1545486332-9e0999c535b2?w=720&q=70&auto=format&fit=crop',
  live_music: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=720&q=70&auto=format&fit=crop',
  view: 'https://images.unsplash.com/photo-1502786129293-79981df4e689?w=720&q=70&auto=format&fit=crop',
  activity: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=720&q=70&auto=format&fit=crop',
};

const KIND_GRADIENTS: Record<StopKind, { from: string; via: string; to: string }> = {
  dinner: { from: 'from-amber-500/30', via: 'via-rose-500/25', to: 'to-orange-700/35' },
  dessert: { from: 'from-pink-400/30', via: 'via-rose-300/25', to: 'to-amber-300/30' },
  drink: { from: 'from-purple-500/30', via: 'via-pink-500/20', to: 'to-amber-500/25' },
  walk: { from: 'from-indigo-500/25', via: 'via-purple-500/25', to: 'to-amber-300/20' },
  live_music: { from: 'from-fuchsia-500/30', via: 'via-purple-600/25', to: 'to-rose-500/30' },
  view: { from: 'from-blue-500/25', via: 'via-purple-500/25', to: 'to-amber-400/25' },
  activity: { from: 'from-emerald-500/25', via: 'via-teal-500/25', to: 'to-amber-400/25' },
};

export function StopCard({ stop, index, city, whenISO, startTime, party, highlighted, dimmed, onRetryImage, onShowImage, onAvailability }: Props) {
  const kindMeta = STOP_KINDS.find((k) => k.kind === stop.kind);
  const grad = KIND_GRADIENTS[stop.kind] || KIND_GRADIENTS.dinner;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${city || ''}`.trim())}`;
  const hasError = stop.status === 'error';
  const showSkeleton = !stop.imageData && stop.status === 'generating';
  // Not painted yet (waiting for a tap on "Show picture").
  const awaitingTap = !stop.imageData && stop.status === 'pending' && !!onShowImage;
  const outOfSparks = hasError && stop.errorCode === 'insufficient_credits';

  const isReservable = RESERVABLE_KINDS.includes(stop.kind);
  const allReservationLinks = isReservable
    ? buildReservationLinks({
        restaurantName: stop.name,
        city: city || '',
        party,
        whenISO,
        startTime,
      })
    : [];

  // Check actual availability on each platform via the server
  // (Gemini + Google Search). Filter out platforms that don't list the
  // venue. Falls back to all-three on error so the user always has a path.
  const [availability, setAvailability] = useState<AvailabilityMap | null>(stop.availability || null);
  // Speculative: re-checked once the Sparks balance is known; skipped (all three links stay) when it could spend
  // Sparks the user didn't choose to spend.
  const creditsLoaded = useCredits().loaded;
  useEffect(() => {
    if (!isReservable || !stop.name || !speculativeAiAllowed()) return;
    // Already known, or a restored page (which never asks the AI again on its own).
    if (stop.availability || stop.restored) return;
    let cancelled = false;
    // Background check (AI credits in the Android app; never opens the credits sheet).
    checkReservations({ restaurantName: stop.name, city: city || '' })
      .then((data) => {
        if (cancelled || !data) return;
        const found = { opentable: !!data.opentable, resy: !!data.resy, tock: !!data.tock };
        setAvailability(found);
        onAvailability?.(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isReservable, stop.name, city, creditsLoaded]);

  const reservationLinks = allReservationLinks.filter((l) => {
    if (!availability) return true; // optimistic until check returns
    return (availability as any)[l.platform];
  });
  const showReservations = isReservable && reservationLinks.length > 0;

  return (
    <article
      className={`relative rounded-3xl overflow-hidden border bg-white/[0.04] backdrop-blur animate-fade-in-up shadow-[0_8px_40px_rgba(26,13,46,0.5)] transition-all duration-500 ${
        highlighted
          ? 'border-eve-gold/80 ring-2 ring-eve-gold/45 scale-[1.02] shadow-[0_0_60px_rgba(245,216,150,0.35)]'
          : dimmed
            ? 'border-white/8 opacity-50 scale-[0.98]'
            : 'border-white/12'
      }`}
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="aspect-[16/10] relative overflow-hidden bg-eve-ink">
        {/* Per-kind food / scene photograph — visible only until the AI image
            arrives. Hidden via stop.imageData check below so it can never
            mislead the viewer about what Eve actually produced. */}
        {!stop.imageData && !hasError && (
          <>
            <img
              src={KIND_PLACEHOLDERS[stop.kind] || KIND_PLACEHOLDERS.dinner}
              alt=""
              aria-hidden="true"
              width={720}
              height={450}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <div className={`absolute inset-0 bg-gradient-to-br ${grad.from} ${grad.via} ${grad.to} ${showSkeleton ? 'opacity-90 animate-pulse mix-blend-overlay' : 'opacity-40 mix-blend-overlay'}`} />
            {awaitingTap && (
              <div className="absolute inset-0 bg-eve-ink/60 flex items-center justify-center">
                <button
                  onClick={onShowImage}
                  className="inline-flex items-center gap-2 min-h-11 px-5 rounded-full bg-eve-ink/85 hover:bg-eve-ink border border-eve-gold/55 text-eve-gold text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-eve-gold transition-colors"
                >
                  <ImageIcon size={16} />
                  Show picture
                </button>
              </div>
            )}
          </>
        )}

        {/* Graceful error state — never expose raw error JSON */}
        {hasError && !stop.imageData && (
          <div className="absolute inset-0 bg-gradient-to-br from-eve-plum/55 via-eve-ink/70 to-eve-plum/55 flex flex-col items-center justify-center gap-2 px-6 text-center backdrop-blur-sm">
            {outOfSparks ? (
              <>
                <span className="font-serif italic text-eve-rose/95 text-base leading-snug">
                  "I'll paint this one when you have Sparks."
                </span>
                <button
                  onClick={() => openCreditsSheet('insufficient')}
                  className="mt-1 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full bg-eve-ink/70 hover:bg-eve-ink/90 border border-eve-gold/40 text-eve-gold text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-eve-gold"
                >
                  <Sparkles size={14} />
                  Get Sparks to see pictures
                </button>
              </>
            ) : stop.errorCode === 'image_limit' ? (
              <>
                <span className="font-serif italic text-eve-rose/95 text-base leading-snug">
                  "I've painted all I can for this hour."
                </span>
                <span className="text-xs text-eve-cream/80 italic font-serif">
                  The plan is all here. Try repainting a little later.
                </span>
              </>
            ) : (
              <>
                <span className="font-serif italic text-eve-rose/95 text-base leading-snug">
                  "The light wouldn't quite catch this one."
                </span>
                <span className="text-xs text-eve-cream/80 italic font-serif">
                  Picture it warmer than that.
                </span>
              </>
            )}
            {onRetryImage && !outOfSparks && (
              <button
                onClick={onRetryImage}
                className="mt-1 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full bg-eve-ink/70 hover:bg-eve-ink/90 border border-eve-gold/40 text-eve-gold text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-eve-gold"
              >
                <RotateCcw size={12} />
                Repaint
              </button>
            )}
          </div>
        )}

        {/* Real image fades in on top of the placeholder. Three layers of
            defense against pale edges from the AI generator:
              1. scale-110 over-zoom crops thin borders on all four sides
              2. top + bottom plum vignette
              3. left + right plum vignette (this is the side bleed killer) */}
        {stop.imageData && (
          <>
            <img
              src={`data:${stop.imageMime || 'image/png'};base64,${stop.imageData}`}
              alt={stop.name}
              width={512}
              height={512}
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover scale-110 animate-fade-in"
            />
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-eve-ink/55 via-transparent to-eve-ink/15" />
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-eve-ink/40 via-transparent to-eve-ink/40" />
          </>
        )}

        {/* Top labels */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2 z-10">
          <span className="px-2.5 py-1 rounded-full bg-eve-ink/85 backdrop-blur text-xs font-bold tracking-wide text-eve-gold border border-eve-gold/40">
            Stop {index + 1}
          </span>
          {kindMeta && (
            <span className="px-2.5 py-1 rounded-full bg-eve-ink/75 backdrop-blur text-xs font-semibold tracking-wide text-eve-cream/95">
              {kindMeta.label}
            </span>
          )}
          {stop.isEveOriginal && (
            <span className="px-2.5 py-1 rounded-full bg-eve-rose/25 border border-eve-rose/55 backdrop-blur text-xs font-bold tracking-wide text-eve-rose inline-flex items-center gap-1">
              <Sparkles size={10} />
              Eve Original
            </span>
          )}
        </div>
        {/* Report this stop (AI venue text + AI painting). */}
        <div className="absolute top-2.5 right-2.5 z-10 rounded-full bg-eve-ink/75 backdrop-blur">
          <ReportContentButton
            app="eve"
            kind="stop"
            label={`Report stop ${index + 1}`}
            content={() =>
              `Stop ${index + 1}: ${stop.name} (${stop.kind}, ${stop.approxArrival})${stop.isEveOriginal ? ' [Eve Original: special published by a restaurant]' : ''}\n${stop.oneLineVibe}\n${stop.whyThisFits}${
                stop.signatureItem ? `\nOrder or try: ${stop.signatureItem}` : ''
              }${stop.imageData ? `\nImage: AI-painted scene of ${stop.name}` : ''}`
            }
            contentKey={`${stop.name}|${stop.oneLineVibe}|${stop.imageData ? stop.imageData.length : 0}`}
          />
        </div>
        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-eve-ink/85 backdrop-blur text-xs font-semibold tracking-wide text-eve-cream/95 inline-flex items-center gap-1 z-10">
          <Clock size={11} />
          {stop.approxArrival}
        </div>
      </div>

      <div className="p-5">
        <h3 className="font-serif text-2xl md:text-[28px] leading-tight text-eve-cream">
          {stop.name}
        </h3>
        <p className="mt-2 text-[0.9375rem] text-eve-cream/85 italic font-serif leading-snug">
          {stop.oneLineVibe}
        </p>
        <p className="mt-3 text-[0.875rem] text-white/75 leading-relaxed">{stop.whyThisFits}</p>

        {stop.signatureItem && (
          <div className="mt-4 pt-4 border-t border-white/15">
            <p className="text-xs tracking-wide italic font-serif text-eve-gold/90 mb-1">
              Order or try
            </p>
            <p className="text-[0.875rem] text-eve-cream font-medium">{stop.signatureItem}</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-white/65">
          <div className="flex items-center gap-3">
            {stop.walkMinutesFromPrev > 0 && (
              <span className="inline-flex items-center gap-1">
                <Footprints size={11} />
                {stop.walkMinutesFromPrev} min walk
              </span>
            )}
            {stop.durationMinutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} />~{stop.durationMinutes} min here
              </span>
            )}
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-eve-gold/15 hover:bg-eve-gold/25 border border-eve-gold/40 text-eve-gold text-xs font-semibold tracking-wide transition-colors"
          >
            <MapPin size={10} />
            Maps
            <ExternalLink size={9} />
          </a>
        </div>

        {/* Reservation deep links — only show platforms that actually list
            the venue. Hides the whole section if none do. */}
        {showReservations && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BookOpen size={11} className="text-eve-gold/80" />
              <span className="text-xs tracking-wide uppercase text-eve-cream/55 font-semibold">
                Book a table
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {reservationLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-eve-ink-soft hover:bg-mg-surface-2 border border-eve-gold/25 hover:border-eve-gold/45 text-eve-gold text-xs font-semibold tracking-wide transition-colors"
                >
                  {link.label}
                  <ExternalLink size={9} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
