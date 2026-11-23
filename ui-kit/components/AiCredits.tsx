/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cx } from '../utils/cx';
import {
  AI_CREDIT_PACKS,
  AI_STARTER_CREDITS,
  activeCreditsProvider,
  buyCredits,
  closeCreditsSheet,
  creditsEnabled,
  redeemPromoCode,
  getCreditsState,
  initCredits,
  loadPrices,
  openCreditsSheet,
  subscribeCredits,
} from '../utils/credits';
import type { CreditsState } from '../utils/credits';
import { isNativeApp } from '../utils/native';
import { Button } from './Button';
import { SparklesIcon } from './icons';
import { Modal } from './Modal';
import type { RuleSection } from './RulesOverlay';

/** Live credits state (balance, products, sheet). Re-renders on change. */
export function useCredits(): CreditsState {
  return useSyncExternalStore(subscribeCredits, getCreditsState, getCreditsState);
}

const fmt = (n: number) => n.toLocaleString();

export interface CreditsChipProps {
  className?: string;
}

/**
 * Balance pill for the AppHeader `right` slot. Renders nothing on the website (or an app build without
 * the credits bridge). Tap = open the "Get AI credits" sheet.
 */
export function CreditsChip({ className }: CreditsChipProps) {
  const s = useCredits();
  if (!s.enabled) return null;
  const low = !s.owner && s.balance !== null && s.balance < 20;
  const label = s.owner ? 'Sparks: unlimited' : s.balance === null ? 'Sparks' : `${fmt(s.balance)} Sparks`;
  return (
    <button
      type="button"
      onClick={() => openCreditsSheet('manual')}
      aria-label={label + ', get more'}
      title="Sparks"
      className={cx(
        'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition-colors before:absolute before:-inset-1.5 before:content-[""]',
        low ? 'border-mg-warning/50 bg-mg-warning/10 text-amber-200 hover:bg-mg-warning/20' : 'border-mg-gold/30 bg-mg-gold/10 text-mg-gold hover:bg-mg-gold/20',
        className,
      )}
    >
      <SparklesIcon size={14} />
      <span>{s.owner ? '∞' : s.balance === null ? '…' : fmt(s.balance)}</span>
    </button>
  );
}

/** The "Get Sparks" sheet. AiCreditsHost renders it; use directly only if you don't mount the host. */
function OwnerCodeForm() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="mt-3 text-xs text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setOpen(true)}>
        Have a promo code? Get free Sparks
      </button>
    );
  }
  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        void redeemPromoCode(code).then((ok) => {
          setBusy(false);
          if (ok) {
            setCode('');
            setOpen(false);
          }
        });
      }}
    >
      <input
        type="password"
        autoComplete="off"
        aria-label="Promo code"
        placeholder="Promo code"
        value={code}
        maxLength={200}
        onChange={(e) => setCode(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-mg-sm border border-mg-border bg-mg-surface px-3 text-sm text-mg-text placeholder:text-mg-subtle focus:border-mg-gold focus:outline-none"
      />
      <Button size="sm" type="submit" loading={busy} loadingText="Checking" disabled={!code.trim()}>
        Apply
      </Button>
    </form>
  );
}

export function CreditsSheet() {
  const s = useCredits();
  const unavailable = s.pricesStatus === 'unavailable';
  const viaPlay = activeCreditsProvider()?.id === 'play';
  return (
    <Modal
      open={s.sheetOpen}
      onClose={closeCreditsSheet}
      title="✨ Sparks"
      description={viaPlay ? 'Sparks power the magic in this app: freshly made rounds, custom themes and more.' : 'Sparks power the magic in Mohit’s apps and games: freshly made rounds, custom themes and more.'}
      size="sm"
      footer={
        <Button variant="secondary" fullWidth onClick={closeCreditsSheet}>
          {s.sheetReason === 'insufficient' ? 'Not now' : 'Close'}
        </Button>
      }
    >
      {s.sheetReason === 'insufficient' ? (
        <p role="status" className="mb-4 rounded-mg-sm border border-mg-gold/40 bg-mg-gold/10 px-3 py-2 text-sm text-mg-text">
          You’re out of Sparks{s.needed ? ` (this one needs about ${fmt(s.needed)})` : ''}. Get more to keep the magic going — everything else stays free.
        </p>
      ) : null}

      {s.owner ? (
        <p role="status" className="mb-4 rounded-mg-sm border border-mg-gold/40 bg-mg-gold/10 px-3 py-2 text-sm text-mg-text">
          Promo code applied: unlimited Sparks on this device.
        </p>
      ) : null}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-mg border border-mg-border bg-mg-surface px-4 py-3">
        <span className="text-sm text-mg-muted">Your balance</span>
        <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums text-mg-gold">
          <SparklesIcon size={18} />
          {s.balance === null ? '…' : fmt(s.balance)}
        </span>
      </div>

      <ul className={cx('flex flex-col gap-2', s.owner && 'hidden')} aria-label="Sparks packs">
        {s.packs.map((pack) => {
          const price = s.prices[pack.id];
          const busy = s.buying === pack.id;
          return (
            <li key={pack.id} className="flex min-h-14 items-center justify-between gap-3 rounded-mg border border-mg-border bg-mg-surface px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-base font-semibold tabular-nums text-mg-text">{fmt(pack.credits)} Sparks</div>
                {viaPlay ? null : <div className="text-xs text-mg-subtle">+ tax where it applies</div>}
              </div>
              <Button
                size="sm"
                onClick={() => void buyCredits(pack.id)}
                disabled={unavailable || !price || (s.buying !== null && !busy)}
                loading={busy}
                loadingText={viaPlay ? 'Opening Google Play' : 'Opening checkout'}
                aria-label={`Buy ${fmt(pack.credits)} Sparks${price ? ' for ' + price : ''}`}
              >
                {price ?? (s.pricesStatus === 'loading' ? '…' : `$${pack.priceUsd.toFixed(2)}`)}
              </Button>
            </li>
          );
        })}
      </ul>

      {unavailable && !s.owner ? (
        <div role="alert" className="mt-3 rounded-mg-sm border border-mg-border-strong bg-mg-surface-2 px-3 py-2 text-sm text-mg-text-2">
          {viaPlay ? 'Purchases are unavailable on this device right now. Make sure the Google Play Store is installed and you’re signed in, then' : 'Purchases are unavailable right now. Please'}{' '}
          <button type="button" className="font-semibold text-mg-gold underline underline-offset-2" onClick={() => void loadPrices(true)}>
            try again
          </button>
          .
        </div>
      ) : null}
      {s.pending ? (
        <p role="status" className="mt-3 text-sm text-mg-text-2">
          A payment is pending{viaPlay ? ' at Google Play' : ' at checkout'}. Your credits are added as soon as it completes.
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-mg-subtle">
        Each magic action uses a few Sparks, based on what it really costs to make — usually 1–10, more for long lists or
        pictures. Repeats are free.{' '}
        {viaPlay
          ? 'Sparks don’t expire and are for this app. Paid through Google Play.'
          : 'Sparks don’t expire and work in all of Mohit’s apps and games in this browser. Secure checkout by Stripe (sold through Link): prices in US dollars, with sales tax or VAT added at checkout where it applies.'}
      </p>
      {s.owner ? null : <OwnerCodeForm />}
    </Modal>
  );
}

/**
 * Mount once near the root (inside ToastProvider). Loads the balance, finishes purchases (Play: unconsumed
 * tokens; web: the return from Stripe Checkout) and hosts the sheet. Renders nothing while the server
 * doesn't meter this page (the website with the web credits switch off).
 */
export function AiCreditsHost() {
  useEffect(() => {
    initCredits();
    // The native shim is injected at document start, but be tolerant of a late bridge.
    if (!creditsEnabled() && isNativeApp()) {
      const t = setTimeout(initCredits, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);
  const s = useCredits();
  return s.enabled ? <CreditsSheet /> : null;
}

/**
 * Rules-overlay section about AI credits — only in the Android app (empty array on the website):
 *   const APP_RULES = [...rules, ...aiCreditsRuleSections()];
 */
export function aiCreditsRuleSections(): RuleSection[] {
  if (!isNativeApp()) return [];
  const packs = AI_CREDIT_PACKS.map((p) => `${fmt(p.credits)} Sparks for $${p.priceUsd.toFixed(2)}`).join(', ');
  return [
    {
      title: 'Sparks',
      icon: '✨',
      items: [
        `The magic features (freshly made rounds, custom themes and more) use Sparks ✨. You start with ${AI_STARTER_CREDITS} free Sparks; your balance is the ✨ chip at the top.`,
        'Each one uses a few Sparks, based on what it really costs to make — usually 1–10, more for very long lists or pictures. Repeats are free, and everything else is always free.',
        `Tap the chip to get more: ${packs} (US prices; Google Play shows your local price). Sparks are added as soon as Google Play confirms the payment.`,
        'Have a promo code? Tap the chip, then “Have a promo code?”, for free Sparks (each code works once in this app).',
        'Sparks don’t expire and belong to this app on this device; with Android backup on they come back after a reinstall on the same Google account.',
      ],
    },
  ];
}
