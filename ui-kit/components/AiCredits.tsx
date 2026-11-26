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
  createDeviceLinkCode,
  linkThisDevice,
  getCreditsState,
  initCredits,
  loadPrices,
  openCreditsSheet,
  subscribeCredits,
  customAmountPrice,
  customAmountForBudget,
} from '../utils/credits';
import type { CreditsState, CustomAmount } from '../utils/credits';
import { isNativeApp } from '../utils/native';
import { PRIVACY_URL, TERMS_URL } from '../utils/constants';
import { Button } from './Button';
import { SparklesIcon } from './icons';
import { Modal } from './Modal';
import { LocalAiSetting } from './LocalAiSetting';
import { enableLocalAiSetting } from '../utils/localAi';
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

/** Website only: any amount of Sparks, priced on the same curve as the packs (type Sparks or a budget in $). */
function CustomAmountForm({ custom, disabled, busy }: { custom: CustomAmount; disabled: boolean; busy: boolean }) {
  const [sparks, setSparks] = useState('');
  const [usd, setUsd] = useState('');
  /** Which box the buyer typed in last (the warning speaks in its unit). */
  const [typed, setTyped] = useState<'sparks' | 'usd' | null>(null);
  // Warn once typing pauses, so "1" on the way to "19.99" doesn't flash a warning.
  const [settled, setSettled] = useState(true);
  useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 600);
    return () => clearTimeout(t);
  }, [sparks, usd]);
  const n = Number(sparks);
  const price = sparks ? customAmountPrice(custom, n) : null;
  const minPrice = customAmountPrice(custom, custom.min) ?? 0;
  const maxPrice = customAmountPrice(custom, custom.max) ?? 0;
  const money = (v: number) => `$${v.toFixed(2)}`;
  // Out of range: say why, in the unit they typed, instead of silently doing nothing.
  const tooSmall =
    settled && ((typed === 'usd' && usd !== '' && Number(usd) < minPrice) || (typed === 'sparks' && sparks !== '' && n < custom.min));
  const tooBig = settled && typed === 'sparks' && sparks !== '' && n > custom.max;
  const capped = typed === 'usd' && usd !== '' && Number(usd) > maxPrice;
  const setAmount = (credits: number) => {
    setSparks(String(credits));
    setUsd((customAmountPrice(custom, credits) ?? 0).toFixed(2));
    setTyped('sparks');
  };
  const field =
    'h-9 min-w-0 rounded-mg-sm border bg-mg-bg px-3 text-sm tabular-nums text-mg-text placeholder:text-mg-subtle focus:outline-none';
  const fieldTone = tooSmall || tooBig ? 'border-mg-warning/60 focus:border-mg-warning' : 'border-mg-border focus:border-mg-gold';
  return (
    <form
      className="mt-2 rounded-mg border border-mg-border bg-mg-surface px-4 py-3"
      aria-label="Choose your amount"
      onSubmit={(e) => {
        e.preventDefault();
        if (price === null || disabled || busy) return;
        void buyCredits(custom.id, n);
      }}
    >
      <div className="text-base font-semibold text-mg-text">Choose your amount</div>
      <div className="mt-2 flex items-center gap-2">
        <input
          inputMode="numeric"
          autoComplete="off"
          aria-label="Sparks"
          placeholder="Sparks"
          value={sparks}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
            setSparks(v);
            setTyped('sparks');
            const p = v ? customAmountPrice(custom, Number(v)) : null;
            setUsd(p === null ? '' : p.toFixed(2));
          }}
          aria-invalid={typed === 'sparks' && (tooSmall || tooBig) ? true : undefined}
          className={cx(field, fieldTone, 'w-0 flex-[3]')}
        />
        <span aria-hidden="true" className="text-sm text-mg-subtle">
          =
        </span>
        <span className="relative flex w-0 flex-[2] items-center">
          <span aria-hidden="true" className="pointer-events-none absolute left-2.5 text-sm text-mg-subtle">
            $
          </span>
          <input
            inputMode="decimal"
            autoComplete="off"
            aria-label="Price in US dollars"
            placeholder="0.00"
            value={usd}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              const dot = raw.indexOf('.');
              const v = (dot < 0 ? raw : raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '').slice(0, 2)).slice(0, 8);
              setUsd(v);
              setTyped('usd');
              const c = v ? customAmountForBudget(custom, Number(v)) : null;
              setSparks(c === null ? '' : String(c));
            }}
            aria-invalid={typed === 'usd' && tooSmall ? true : undefined}
            className={cx(field, fieldTone, 'w-full pl-6')}
          />
        </span>
        <Button
          size="sm"
          type="submit"
          disabled={disabled || price === null}
          loading={busy}
          loadingText="Opening checkout"
          aria-label={price === null ? 'Buy' : `Buy ${fmt(n)} Sparks for $${price.toFixed(2)}`}
        >
          Buy
        </Button>
      </div>
      {tooSmall || tooBig ? (
        <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-amber-200">
          <span>
            {tooSmall
              ? `The smallest amount is ${money(minPrice)} (${fmt(custom.min)} Sparks).`
              : `The most at once is ${fmt(custom.max)} Sparks (${money(maxPrice)}).`}
          </span>
          <button
            type="button"
            onClick={() => setAmount(tooSmall ? custom.min : custom.max)}
            className="inline-flex min-h-8 items-center font-semibold text-mg-gold underline underline-offset-2 hover:text-mg-gold-hover"
          >
            {tooSmall ? `Use ${money(minPrice)}` : `Use ${fmt(custom.max)}`}
          </button>
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-mg-subtle" aria-live="polite">
          {price === null
            ? `Any amount from ${fmt(custom.min)} to ${fmt(custom.max)} Sparks (${money(minPrice)} to ${money(maxPrice)}), or type what you want to spend.`
            : capped
              ? `${fmt(n)} Sparks for ${money(price)} is the most at once.`
              : `${fmt(n)} Sparks for ${money(price)}. Bigger amounts get more Sparks per dollar.`}
        </p>
      )}
    </form>
  );
}

/** Website only: share this browser's Sparks with another device (one-use code), or join another device's. */
function LinkDevicesForm() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [entry, setEntry] = useState('');
  const [joining, setJoining] = useState(false);
  if (!open) {
    return (
      <button type="button" className="mt-3 block text-xs text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setOpen(true)}>
        Use your Sparks on another device
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-mg border border-mg-border bg-mg-surface px-4 py-3 text-sm text-mg-text-2">
      <div className="font-semibold text-mg-text">Use your Sparks on another device</div>
      <p className="mt-1 text-xs text-mg-subtle">Link your phone and computer browsers to share one Sparks balance in every app on mohitgoenka.com.</p>
      {code ? (
        <div className="mt-3" role="status">
          <div className="font-mono text-2xl font-bold tracking-[0.3em] text-mg-gold">{code.slice(0, 3) + ' ' + code.slice(3)}</div>
          <p className="mt-1 text-xs text-mg-subtle">On the other device, open ✨ Sparks, tap “Use your Sparks on another device” and enter this code within 10 minutes. It works once.</p>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          loading={making}
          loadingText="Getting a code"
          onClick={() => {
            setMaking(true);
            void createDeviceLinkCode().then((c) => {
              setMaking(false);
              setCode(c);
            });
          }}
        >
          Get a code for my other device
        </Button>
      )}
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!entry.trim() || joining) return;
          setJoining(true);
          void linkThisDevice(entry).then((ok) => {
            setJoining(false);
            if (ok) {
              setEntry('');
              setOpen(false);
            }
          });
        }}
      >
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Code from your other device"
          placeholder="Code from other device"
          value={entry}
          maxLength={12}
          onChange={(e) => setEntry(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-mg-sm border border-mg-border bg-mg-surface px-3 text-sm uppercase text-mg-text placeholder:normal-case placeholder:text-mg-subtle focus:border-mg-gold focus:outline-none"
        />
        <Button size="sm" type="submit" loading={joining} loadingText="Linking" disabled={!entry.trim()}>
          Link
        </Button>
      </form>
    </div>
  );
}

export function CreditsSheet() {
  const s = useCredits();
  const unavailable = s.pricesStatus === 'unavailable';
  const viaPlay = activeCreditsProvider()?.id === 'play';
  // A wallet that never got Sparks (no starter: paused or limited, never bought) is "getting", not "out of", Sparks.
  const noStarter = (s.starterPaused || s.starterLimited) && !s.paid && !s.owner;
  const neverHad = noStarter && (s.balance ?? 0) <= 0;
  const starterNote = !noStarter || (s.balance ?? 0) > 0
    ? null
    : s.starterPaused
      ? 'Free starter Sparks are paused for today. Check back tomorrow, or get a pack below.'
      : 'Free starter Sparks aren’t available on this network right now. You can still get a pack below.';
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
          {neverHad
            ? `Get Sparks to use this${s.needed ? ` (it needs about ${fmt(s.needed)})` : ''}. Everything else stays free.`
            : `You’re out of Sparks${s.needed ? ` (this one needs about ${fmt(s.needed)})` : ''}. Get more to keep the magic going — everything else stays free.`}
        </p>
      ) : null}
      {starterNote ? (
        <p role="status" className="mb-4 rounded-mg-sm border border-mg-border-strong bg-mg-surface-2 px-3 py-2 text-sm text-mg-text-2">
          {starterNote}
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
      <div className="-mx-3 mb-3">
        <LocalAiSetting compact />
      </div>

      <ul className={cx('flex flex-col gap-2', s.owner && 'hidden')} aria-label="Sparks packs">
        {s.packs.map((pack) => {
          const price = s.prices[pack.id];
          const busy = s.buying === pack.id;
          return (
            <li key={pack.id} className="flex min-h-14 items-center justify-between gap-3 rounded-mg border border-mg-border bg-mg-surface px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-base font-semibold tabular-nums text-mg-text">{fmt(pack.credits)} Sparks</div>
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
      {!viaPlay && !s.owner && s.custom ? (
        <CustomAmountForm custom={s.custom} disabled={unavailable || (s.buying !== null && s.buying !== s.custom.id)} busy={s.buying === s.custom.id} />
      ) : null}
      {viaPlay || s.owner ? null : <p className="mt-2 text-xs text-mg-subtle">Taxes (like VAT) are added at checkout and shown before you pay.</p>}

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
          A payment is pending{viaPlay ? ' at Google Play' : ' at checkout'}. Your Sparks are added as soon as it completes.
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-mg-subtle">
        Each magic action uses a few Sparks, based on what it really costs to make — usually 1–10, more for long lists or
        pictures. Repeats are free.{' '}
        {viaPlay
          ? 'Sparks don’t expire and are for this app. Paid through Google Play. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them.'
          : 'Sparks work in all of Mohit’s apps and games in this browser. Sparks are tied to this browser and are kept as long as you use them at least once every 400 days. Secure checkout by Stripe (sold through Link), prices in US dollars.'}
      </p>
      {s.owner ? null : <OwnerCodeForm />}
      {viaPlay ? null : <LinkDevicesForm />}
      <p className="mt-4 flex gap-1 text-xs text-mg-subtle">
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center px-1 underline underline-offset-2 hover:text-mg-text-2">
          Privacy
        </a>
        <span aria-hidden="true" className="inline-flex items-center">·</span>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center px-1 underline underline-offset-2 hover:text-mg-text-2">
          Terms
        </a>
      </p>
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
    enableLocalAiSetting(); // an app with Sparks has AI features: Settings shows "Use this device's AI"
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
  if (!isNativeApp()) {
    // Website: only on pages that meter AI (the web switch on). One wallet per browser, shared by every app.
    const st = getCreditsState();
    if (!creditsEnabled() || (st.loaded && !st.enabled)) return [];
    return [
      {
        title: 'Sparks',
        icon: '✨',
        items: [
          `The magic features (freshly made rounds, custom themes and more) use Sparks ✨. New visitors get ${AI_STARTER_CREDITS} free Sparks to start (while the free daily allowance lasts); your balance is the ✨ chip at the top.`,
          'Each one uses a few Sparks, based on what it really costs to make, and the chip shows what was used. Repeats are free, and everything else is always free.',
          'Tap the chip to get more; payment is handled securely by Stripe. Your Sparks work in every one of these apps in this browser.',
          'Using another device? Tap the chip, then link your browsers with a one-time code to share one balance.',
          'Have a promo code? Tap the chip, then “Have a promo code?”.',
          'Sparks are kept in this browser: clearing its site data for mohitgoenka.com, or 400 days without use, removes them.',
        ],
      },
    ];
  }
  const packs = AI_CREDIT_PACKS.map((p) => `${fmt(p.credits)} Sparks for $${p.priceUsd.toFixed(2)}`).join(', ');
  return [
    {
      title: 'Sparks',
      icon: '✨',
      items: [
        `The magic features (freshly made rounds, custom themes and more) use Sparks ✨. New players get ${AI_STARTER_CREDITS} free Sparks to start (while the free daily allowance lasts); your balance is the ✨ chip at the top.`,
        'Each one uses a few Sparks, based on what it really costs to make — usually 1–10, more for very long lists or pictures. Repeats are free, and everything else is always free.',
        `Tap the chip to get more: ${packs} (US prices; Google Play shows your local price). Sparks are added as soon as Google Play confirms the payment.`,
        'Have a promo code? Tap the chip, then “Have a promo code?”, for free Sparks (each code works once in this app).',
        'Phones with built-in AI (Pixel 9 and newer, Galaxy S25 and newer, and more) make some of these right on the phone, for free: no Sparks used. Switch it off in Settings under “Use this device’s AI”.',
        'Sparks don’t expire. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them (with Android backup on, they come back after a reinstall on the same Google account).',
      ],
    },
  ];
}
