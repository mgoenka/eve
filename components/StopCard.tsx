import { MapPin, Clock, Footprints, Sparkles, ExternalLink } from 'lucide-react';
import type { ExperienceStop, StopKind } from '../types';
import { STOP_KINDS } from '../constants';

interface Props {
  stop: ExperienceStop;
  index: number;
  city?: string;
  highlighted?: boolean;
  dimmed?: boolean;
}

// Different gradient palettes for each stop kind so the loading skeleton
// already feels like the kind of place coming. The image fades in over it.
const KIND_GRADIENTS: Record<StopKind, { from: string; via: string; to: string }> = {
  dinner: { from: 'from-amber-500/30', via: 'via-rose-500/25', to: 'to-orange-700/35' },
  dessert: { from: 'from-pink-400/30', via: 'via-rose-300/25', to: 'to-amber-300/30' },
  drink: { from: 'from-purple-500/30', via: 'via-pink-500/20', to: 'to-amber-500/25' },
  walk: { from: 'from-indigo-500/25', via: 'via-purple-500/25', to: 'to-amber-300/20' },
  live_music: { from: 'from-fuchsia-500/30', via: 'via-purple-600/25', to: 'to-rose-500/30' },
  view: { from: 'from-blue-500/25', via: 'via-purple-500/25', to: 'to-amber-400/25' },
  activity: { from: 'from-emerald-500/25', via: 'via-teal-500/25', to: 'to-amber-400/25' },
};

export function StopCard({ stop, index, city, highlighted, dimmed }: Props) {
  const kindMeta = STOP_KINDS.find((k) => k.kind === stop.kind);
  const grad = KIND_GRADIENTS[stop.kind] || KIND_GRADIENTS.dinner;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${city || ''}`.trim())}`;
  const hasError = stop.status === 'error';
  const showSkeleton = !stop.imageData && (stop.status === 'pending' || stop.status === 'generating');

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
      <div className="aspect-[4/3] relative overflow-hidden bg-eve-ink/40">
        {/* Skeleton: animated gradient already hinting at the stop's mood */}
        {showSkeleton && (
          <div
            className={`absolute inset-0 bg-gradient-to-br ${grad.from} ${grad.via} ${grad.to} animate-pulse`}
          />
        )}

        {/* Graceful error state — Eve never sees raw error strings */}
        {hasError && !stop.imageData && (
          <div className="absolute inset-0 bg-gradient-to-br from-eve-plum/40 via-eve-ink/55 to-eve-plum/40 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="font-serif italic text-eve-rose/85 text-base leading-snug">
              "The light wouldn't quite catch this one."
            </span>
            <span className="text-[12px] text-eve-cream/65 italic font-serif">
              Picture it warmer than that.
            </span>
          </div>
        )}

        {/* Real image fade-in */}
        {stop.imageData && (
          <img
            src={`data:${stop.imageMime || 'image/png'};base64,${stop.imageData}`}
            alt={stop.name}
            className="absolute inset-0 w-full h-full object-cover animate-fade-in"
          />
        )}

        {/* Top labels */}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2 z-10">
          <span className="px-2.5 py-1 rounded-full bg-eve-ink/85 backdrop-blur text-[11px] font-bold tracking-wide text-eve-gold border border-eve-gold/40">
            Stop {index + 1}
          </span>
          {kindMeta && (
            <span className="px-2.5 py-1 rounded-full bg-eve-ink/75 backdrop-blur text-[11px] font-semibold tracking-wide text-eve-cream/95">
              {kindMeta.label}
            </span>
          )}
          {stop.isEveOriginal && (
            <span className="px-2.5 py-1 rounded-full bg-eve-rose/25 border border-eve-rose/55 backdrop-blur text-[10px] font-bold tracking-wide text-eve-rose inline-flex items-center gap-1">
              <Sparkles size={10} />
              Eve Original
            </span>
          )}
        </div>
        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-eve-ink/85 backdrop-blur text-[11px] font-semibold tracking-wide text-eve-cream/95 inline-flex items-center gap-1 z-10">
          <Clock size={11} />
          {stop.approxArrival}
        </div>
      </div>

      <div className="p-5">
        <h3 className="font-serif text-2xl md:text-[28px] leading-tight text-eve-cream">
          {stop.name}
        </h3>
        <p className="mt-2 text-[15px] text-eve-cream/85 italic font-serif leading-snug">
          {stop.oneLineVibe}
        </p>
        <p className="mt-3 text-[14px] text-white/75 leading-relaxed">{stop.whyThisFits}</p>

        {stop.signatureItem && (
          <div className="mt-4 pt-4 border-t border-white/15">
            <p className="text-[11px] tracking-wide italic font-serif text-eve-gold/90 mb-1">
              Order or try
            </p>
            <p className="text-[14px] text-eve-cream font-medium">{stop.signatureItem}</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 text-[12px] text-white/65">
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
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-eve-gold/15 hover:bg-eve-gold/25 border border-eve-gold/40 text-eve-gold text-[11px] font-semibold tracking-wide transition-colors"
          >
            <MapPin size={10} />
            Maps
            <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </article>
  );
}
