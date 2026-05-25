import { useEffect } from 'react';
import { Sparkles, ArrowRight, MapPin, Utensils } from 'lucide-react';
import { EveLogo } from './EveLogo';
import type { CityContent } from '../data/cities';

interface Props {
  city: CityContent;
  onPlanInCity: () => void;
}

export function CityLanding({ city, onPlanInCity }: Props) {
  useEffect(() => {
    document.title = city.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = city.description;
  }, [city]);

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <header
        className="w-full py-2 px-3 md:py-2.5 md:px-4 border-b border-white/[0.06] bg-eve-ink/95 backdrop-blur-sm grid grid-cols-3 items-center gap-2"
        role="banner"
      >
        <a
          href="https://mohitgoenka.com/apps/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-eve-cream/55 hover:text-eve-gold text-xs md:text-sm font-medium transition-colors rounded justify-self-start"
          aria-label="Apps and Games"
        >
          Apps and Games <span aria-hidden="true">🎮</span>
        </a>
        <a
          href="/"
          className="flex items-center justify-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          aria-label="Eve home"
        >
          <span className="text-eve-cream/85 text-xs md:text-sm font-medium">Eve</span>
          <EveLogo size={26} />
        </a>
        <div className="flex items-center justify-end gap-2">
          <a
            href="/pricing"
            className="p-2 md:p-2.5 h-9 md:h-10 flex items-center justify-center bg-eve-ink-soft rounded-xl border border-white/[0.08] hover:bg-[#1a1a1e] transition-all text-xs font-semibold text-eve-cream/70"
            aria-label="Pricing"
            title="Pricing"
          >
            Pricing
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 md:py-14">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-[12px] tracking-[0.4em] uppercase text-eve-gold/85 mb-3 font-header font-semibold">
            {city.metro}
          </p>
          <h1 className="font-header text-5xl md:text-7xl leading-[1.0] mb-5">
            <span className="text-eve-cream">A perfect </span>
            <span className="italic"><span className="text-shimmer">eve</span><span className="text-eve-cream/95">ning in {city.shortName}.</span></span>
          </h1>
          <p className="text-eve-cream/70 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed font-serif italic">
            {city.hero}
          </p>
          <div className="mt-7 flex justify-center">
            <button
              onClick={onPlanInCity}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base bg-eve-ink-soft text-eve-gold border border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-eve-gold/15 outline-none focus-visible:ring-2 focus-visible:ring-eve-gold focus-visible:ring-offset-2 focus-visible:ring-offset-eve-ink"
            >
              <Sparkles size={18} />
              Plan a {city.shortName} evening
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <section className="mt-12 md:mt-16">
          <div className="flex items-center gap-2 mb-6">
            <Utensils size={14} className="text-eve-gold/85" />
            <p className="text-[11px] tracking-[0.3em] uppercase text-eve-gold/85 font-header font-semibold">
              Featured in {city.shortName}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {city.featured.map((r) => (
              <article
                key={r.name}
                className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-5 md:p-6 hover:border-eve-gold/35 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h3 className="font-header text-2xl text-eve-cream font-semibold">{r.name}</h3>
                    <p className="text-[12px] text-eve-cream/60 mt-0.5 inline-flex items-center gap-1">
                      <MapPin size={11} />
                      {r.area} · <span className="text-eve-gold/80">{r.cuisine}</span>
                    </p>
                  </div>
                </div>
                <p className="text-[15px] text-eve-cream/85 italic font-serif leading-snug mb-3">
                  {r.blurb}
                </p>
                <div className="text-[12px] tracking-wide text-eve-cream/70">
                  <span className="text-eve-gold/85 italic font-serif">Order:</span> {r.signatureDish}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 max-w-3xl mx-auto text-center">
          <h2 className="font-header text-3xl md:text-4xl text-eve-cream mb-3">
            How Eve plans your evening
          </h2>
          <p className="text-eve-cream/70 text-base leading-relaxed">
            Tell Eve where in {city.shortName} you are, when you want to start, and how long you want the evening to run. She picks a dinner anchor, a dessert or drink to follow, a walk to bridge the night, and a closer that lands. Booking deep links open OpenTable, Resy, or Tock with the right party size and time pre-filled.
          </p>
          <div className="mt-7 flex justify-center">
            <button
              onClick={onPlanInCity}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-base bg-eve-ink-soft text-eve-gold border border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-eve-gold/15"
            >
              <Sparkles size={18} />
              Start planning
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      <footer className="text-center py-8 px-6 text-[11px] text-white/55 italic font-serif">
        Yours, quietly. <span className="text-eve-cream/40 not-italic">·</span>{' '}
        <a href="/" className="hover:text-eve-cream">Eve home</a>{' '}
        <span className="text-eve-cream/40">·</span>{' '}
        <a href="/restaurant" className="hover:text-eve-cream">For restaurants</a>{' '}
        <span className="text-eve-cream/40">·</span>{' '}
        <a href="/pricing" className="hover:text-eve-cream">Pricing</a>
      </footer>
    </div>
  );
}
