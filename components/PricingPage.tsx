import { useEffect, useState } from 'react';
import { Check, Sparkles, Loader2 } from 'lucide-react';
import { EveLogo } from './EveLogo';

const RESTAURANT_FEATURES = [
  'Daily AI content pack — Instagram, Reel, menu card, email, SMS',
  'Brand voice memory — Eve learns your tone over time',
  'One-click publish to Eve diners — featured in the local index',
  'Reservation deep-links from Eve\u2019s plans (OpenTable, Resy, Tock)',
  'Multi-day analytics — views, plan inclusions, click-throughs',
  'Unlimited regenerations · iterate until on-brand',
  'Dish suggestions mined from your real reviews',
  'Cancel anytime',
];

const DINER_FEATURES = [
  'Unlimited evening plans',
  'Save plans, share by link, replan in one tap',
  'Priority access to new venues + city expansions',
  'Multi-stop walk-throughs with Eve\u2019s voice',
  'Refine plans by voice mid-narration',
  'Cancel anytime',
];

interface Props {
  onBack: () => void;
}

export function PricingPage({ onBack }: Props) {
  useEffect(() => {
    document.title = 'Eve · Pricing';
  }, []);

  const [loadingTier, setLoadingTier] = useState<'restaurant' | 'diner' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (tier: 'restaurant' | 'diner') => {
    setError(null);
    setLoadingTier(tier);
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, returnPath: window.location.pathname }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout');
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || 'Checkout unavailable. Please try again.');
      setLoadingTier(null);
    }
  };

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
          <button
            onClick={onBack}
            className="p-2 md:p-2.5 h-9 md:h-10 flex items-center justify-center bg-eve-ink-soft rounded-xl border border-white/[0.08] hover:bg-[#1a1a1e] transition-all text-xs font-semibold text-eve-cream/70"
            aria-label="Back"
            title="Back"
          >
            Back
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10 md:py-14">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-[12px] tracking-[0.4em] uppercase text-eve-gold/85 mb-3 font-header font-semibold">
            Pricing
          </p>
          <h1 className="font-header text-4xl md:text-6xl leading-[1.05] mb-3 text-eve-cream">
            Simple. Honest. Mostly margin.
          </h1>
          <p className="text-eve-cream/65 text-lg max-w-2xl mx-auto font-serif italic">
            Two products. Pick the side of Eve you live on. Cancel anytime.
          </p>
        </div>

        {error && (
          <div className="max-w-3xl mx-auto mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          {/* Diner premium */}
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur p-6 md:p-8 flex flex-col">
            <p className="text-[11px] tracking-[0.3em] uppercase text-eve-cream/60 font-header font-semibold mb-2">
              Diner Premium
            </p>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="font-header text-5xl text-eve-cream font-semibold">$4.99</span>
              <span className="text-eve-cream/55 text-sm">/ month</span>
            </div>
            <p className="text-eve-cream/70 text-sm leading-relaxed mb-5">
              For people who don\u2019t want to think about Saturday night ever again.
            </p>
            <ul className="space-y-2 mb-7 flex-1">
              {DINER_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[14px] text-eve-cream/85">
                  <Check size={14} className="mt-0.5 flex-shrink-0 text-eve-gold" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => startCheckout('diner')}
              disabled={loadingTier !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-base bg-eve-ink-soft text-eve-gold border border-eve-gold/25 hover:bg-[#1a1a1e] hover:border-eve-gold/45 disabled:opacity-50 disabled:cursor-wait transition-all shadow-lg shadow-eve-gold/15"
            >
              {loadingTier === 'diner' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Start Diner Premium
                </>
              )}
            </button>
          </article>

          {/* Restaurant SaaS */}
          <article className="relative rounded-3xl border border-eve-gold/40 bg-gradient-to-br from-eve-gold/[0.06] to-white/[0.02] backdrop-blur p-6 md:p-8 flex flex-col shadow-[0_0_60px_rgba(245,197,66,0.18)]">
            <span className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-eve-gold/15 border border-eve-gold/40 text-eve-gold text-[10px] tracking-wide uppercase font-bold">
              Most popular
            </span>
            <p className="text-[11px] tracking-[0.3em] uppercase text-eve-gold font-header font-semibold mb-2">
              Restaurant Pro
            </p>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="font-header text-5xl text-eve-cream font-semibold">$99</span>
              <span className="text-eve-cream/55 text-sm">/ month / location</span>
            </div>
            <p className="text-eve-cream/70 text-sm leading-relaxed mb-5">
              The marketing department you can\u2019t afford. AI-native, on-brand, in 60 seconds a day.
            </p>
            <ul className="space-y-2 mb-7 flex-1">
              {RESTAURANT_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[14px] text-eve-cream/85">
                  <Check size={14} className="mt-0.5 flex-shrink-0 text-eve-gold" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => startCheckout('restaurant')}
              disabled={loadingTier !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-base bg-eve-gold text-eve-ink hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-wait transition-all shadow-[0_0_28px_rgba(245,197,66,0.42)]"
            >
              {loadingTier === 'restaurant' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Start Restaurant Pro
                </>
              )}
            </button>
          </article>
        </div>

        <section className="mt-14 max-w-3xl mx-auto text-center">
          <h2 className="font-header text-2xl md:text-3xl text-eve-cream mb-2">
            Multi-location?
          </h2>
          <p className="text-eve-cream/65 text-base">
            $99 per location, billed monthly. Volume discounts kick in at 5+ locations. <a href="mailto:hello@mohitgoenka.com?subject=Eve%20Multi-Location" className="text-eve-gold hover:text-yellow-300 underline decoration-dotted underline-offset-2">Email us</a>.
          </p>
        </section>

        <section className="mt-12 max-w-3xl mx-auto">
          <h3 className="font-header text-xl text-eve-cream mb-3 text-center">FAQ</h3>
          <div className="space-y-3">
            <details className="rounded-2xl bg-white/[0.03] border border-white/10 px-5 py-4 group">
              <summary className="cursor-pointer text-eve-cream/95 font-medium text-sm">Do I have to know how to write to use Restaurant Pro?</summary>
              <p className="mt-2 text-eve-cream/70 text-sm leading-relaxed">No. Eve infers your cuisine, brand voice, and signature dishes from your name and city. You can edit if you want — most people don\u2019t.</p>
            </details>
            <details className="rounded-2xl bg-white/[0.03] border border-white/10 px-5 py-4 group">
              <summary className="cursor-pointer text-eve-cream/95 font-medium text-sm">Do you charge per content pack generated?</summary>
              <p className="mt-2 text-eve-cream/70 text-sm leading-relaxed">No. $99 covers unlimited regenerations every month, on every location. Make 30 versions of tonight\u2019s dish until one feels right.</p>
            </details>
            <details className="rounded-2xl bg-white/[0.03] border border-white/10 px-5 py-4 group">
              <summary className="cursor-pointer text-eve-cream/95 font-medium text-sm">Can I cancel anytime?</summary>
              <p className="mt-2 text-eve-cream/70 text-sm leading-relaxed">Yes. One click. No "we\u2019d hate to see you go" obstacle course.</p>
            </details>
            <details className="rounded-2xl bg-white/[0.03] border border-white/10 px-5 py-4 group">
              <summary className="cursor-pointer text-eve-cream/95 font-medium text-sm">When does Diner Premium come out of free trial?</summary>
              <p className="mt-2 text-eve-cream/70 text-sm leading-relaxed">All diner planning is free during launch. Premium is a paid layer on top once that opens — you\u2019ll see it before you\u2019re charged.</p>
            </details>
          </div>
        </section>
      </main>

      <footer className="text-center py-8 px-6 text-[11px] text-white/55 italic font-serif">
        Yours, quietly. <span className="text-eve-cream/40 not-italic">·</span>{' '}
        <a href="/" className="hover:text-eve-cream">Eve home</a>{' '}
        <span className="text-eve-cream/40">·</span>{' '}
        <a href="/restaurant" className="hover:text-eve-cream">For restaurants</a>
      </footer>
    </div>
  );
}
