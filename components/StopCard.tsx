import { Loader2, MapPin, Clock, Footprints, Sparkles, ExternalLink } from 'lucide-react';
import type { ExperienceStop } from '../types';
import { STOP_KINDS } from '../constants';

interface Props {
  stop: ExperienceStop;
  index: number;
  city?: string;
}

export function StopCard({ stop, index, city }: Props) {
  const kindMeta = STOP_KINDS.find((k) => k.kind === stop.kind);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${city || ''}`.trim())}`;
  return (
    <article
      className="relative rounded-3xl overflow-hidden border border-white/10 bg-white/[0.04] backdrop-blur animate-fade-in-up shadow-[0_8px_40px_rgba(26,13,46,0.5)]"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="aspect-[4/3] relative overflow-hidden bg-eve-ink/40">
        {stop.imageData ? (
          <img
            src={`data:${stop.imageMime || 'image/png'};base64,${stop.imageData}`}
            alt={stop.name}
            className="absolute inset-0 w-full h-full object-cover animate-fade-in"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {stop.status === 'generating' || stop.status === 'pending' ? (
              <>
                <Loader2 size={28} className="animate-spin text-eve-rose" />
                <span className="text-[11px] tracking-wide italic font-serif text-white/45">
                  Painting the scene
                </span>
              </>
            ) : stop.status === 'error' ? (
              <span className="text-xs text-red-300">{stop.error || 'Image failed'}</span>
            ) : (
              <span className="text-[11px] tracking-wide italic font-serif text-white/30">
                Awaiting
              </span>
            )}
          </div>
        )}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full bg-eve-ink/80 backdrop-blur text-[10px] font-bold tracking-wide text-eve-gold border border-eve-gold/30">
            Stop {index + 1}
          </span>
          {kindMeta && (
            <span className="px-2.5 py-1 rounded-full bg-eve-ink/70 backdrop-blur text-[10px] font-semibold tracking-wide text-eve-cream/90">
              {kindMeta.label}
            </span>
          )}
          {stop.isEveOriginal && (
            <span className="px-2.5 py-1 rounded-full bg-eve-rose/20 border border-eve-rose/50 backdrop-blur text-[10px] font-bold tracking-wide text-eve-rose inline-flex items-center gap-1">
              <Sparkles size={10} />
              Eve Original
            </span>
          )}
        </div>
        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-eve-ink/80 backdrop-blur text-[10px] font-semibold tracking-wide text-eve-cream/90 inline-flex items-center gap-1">
          <Clock size={11} />
          {stop.approxArrival}
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-serif text-2xl md:text-[28px] leading-tight text-eve-cream">
          {stop.name}
        </h3>
        <p className="mt-2 text-[14px] text-eve-cream/75 italic font-serif leading-snug">
          {stop.oneLineVibe}
        </p>
        <p className="mt-3 text-[13px] text-white/60 leading-relaxed">{stop.whyThisFits}</p>

        {stop.signatureItem && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-[10px] tracking-wide italic font-serif text-eve-gold/80 mb-1">
              Order or try
            </p>
            <p className="text-[14px] text-eve-cream font-medium">{stop.signatureItem}</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-white/50">
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
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-eve-gold/10 hover:bg-eve-gold/20 border border-eve-gold/30 text-eve-gold text-[10px] font-semibold tracking-wide transition-colors"
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
