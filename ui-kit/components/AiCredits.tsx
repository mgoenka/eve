/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  buyGiftCode,
  buyTip,
  buyingKey,
  dismissGiftReturn,
  listGiftCodes,
  createBackupCode,
  restoreFromBackupCode,
} from '../utils/credits';
import type { CreditsState, CustomAmount, GiftCode } from '../utils/credits';
import { copyToClipboard, shareOrCopy } from '../utils/share';
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
function CustomAmountForm({ custom, disabled, busy, gift = false }: { custom: CustomAmount; disabled: boolean; busy: boolean; gift?: boolean }) {
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
      aria-label={gift ? 'Choose your gift amount' : 'Choose your amount'}
      onSubmit={(e) => {
        e.preventDefault();
        if (price === null || disabled || busy) return;
        void (gift ? buyGiftCode(custom.id, n) : buyCredits(custom.id, n));
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
          aria-label={price === null ? (gift ? 'Buy gift' : 'Buy') : `Buy ${fmt(n)} Sparks${gift ? ' as a gift' : ''} for $${price.toFixed(2)}`}
        >
          {gift ? 'Gift' : 'Buy'}
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

/** Save text as a small file (the backup code). */
function downloadTextFile(filename: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    void copyToClipboard(text, 'Couldn’t save a file, so the code was copied instead');
  }
}

const giftDate = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};

const giftShareText = (g: GiftCode) =>
  `Here are ${fmt(g.credits)} Sparks for Mohit’s apps and games! Open any of them, tap ✨ Sparks, then “Have a promo code?” and enter ${g.code}${g.expiresAt ? ` (works once, until ${giftDate(g.expiresAt)})` : ''}.`;

/** Copy + Share for one gift code. */
function GiftCodeActions({ gift }: { gift: GiftCode }) {
  return (
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => void copyToClipboard(gift.code, 'Gift code copied')}>
        Copy
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void shareOrCopy({ title: 'Sparks gift', text: giftShareText(gift) }, { copiedMessage: 'Gift message copied' })}>
        Share
      </Button>
    </div>
  );
}

/** Back from a gift checkout: the code, with Copy and Share (also kept under "My gift codes"). */
function GiftReturnPanel({ gift, backupSaved }: { gift: GiftCode; backupSaved: boolean }) {
  return (
    <div role="status" className="mb-4 rounded-mg border border-mg-gold/40 bg-mg-gold/10 px-4 py-3 text-sm text-mg-text">
      <div className="font-semibold">Your gift code for {fmt(gift.credits)} Sparks</div>
      <div className="mt-2 select-all break-all font-mono text-lg font-bold tracking-[0.15em] text-mg-gold">{gift.code}</div>
      <p className="mt-1 text-xs text-mg-text-2">
        Give it to someone: they open ✨ Sparks in any of Mohit’s apps (website or Android), tap “Have a promo code?” and enter it. It works once
        {gift.expiresAt ? `, until ${giftDate(gift.expiresAt)}` : ''}. You can find it again under “My gift codes”.
      </p>
      <GiftCodeActions gift={gift} />
      {backupSaved ? null : (
        <p className="mt-2 text-xs text-mg-text-2">
          <button type="button" className="font-semibold text-mg-gold underline underline-offset-2" onClick={() => openCreditsSheet('manual', null, 'backup')}>
            Save a backup code
          </button>{' '}
          so you don’t lose your Sparks and gift codes.
        </p>
      )}
      <button type="button" className="mt-1 inline-flex min-h-8 items-center text-xs text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={dismissGiftReturn}>
        Done
      </button>
    </div>
  );
}

/** "My gift codes": the codes this browser bought, with their status. */
function MyGiftCodes() {
  const [gifts, setGifts] = useState<GiftCode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const label: Record<string, string> = { ready: 'Not used yet', used: 'Used', void: 'Refunded', expired: 'Expired' };
  if (gifts === null) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="mt-3"
        loading={loading}
        loadingText="Loading"
        onClick={() => {
          setLoading(true);
          void listGiftCodes().then((g) => {
            setLoading(false);
            if (g) setGifts(g);
          });
        }}
      >
        My gift codes
      </Button>
    );
  }
  if (!gifts.length) return <p className="mt-3 text-xs text-mg-subtle">No gift codes bought in this browser yet.</p>;
  return (
    <ul className="mt-3 flex flex-col gap-2" aria-label="My gift codes">
      {gifts.map((g) => (
        <li key={g.code} className="rounded-mg-sm border border-mg-border bg-mg-bg px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="select-all font-mono text-sm font-semibold tracking-wider text-mg-text">{g.code}</span>
            <span className="text-xs text-mg-subtle">
              {fmt(g.credits)} Sparks · {label[g.status ?? 'ready'] ?? ''}
              {g.status === 'ready' && g.expiresAt ? ` · until ${giftDate(g.expiresAt)}` : ''}
            </span>
          </div>
          {g.status === 'ready' ? <GiftCodeActions gift={g} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Website only: "Give Sparks as a gift": a fixed pack or a custom amount, paid for a one-use code. */
function GiftForm({ s, unavailable }: { s: CreditsState; unavailable: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="mt-3 block text-xs text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setOpen(true)}>
        Give Sparks as a gift
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-mg border border-mg-border bg-mg-surface px-4 py-3 text-sm text-mg-text-2">
      <div className="font-semibold text-mg-text">Give Sparks as a gift</div>
      <p className="mt-1 text-xs text-mg-subtle">
        You get a code to give to someone. It works once, in any of Mohit’s apps on the website or Android, for 1 year. Your own balance doesn’t change.
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Gift packs">
        {s.packs.map((pack) => {
          const key = buyingKey(pack.id, { gift: true });
          const price = s.prices[pack.id] ?? `$${pack.priceUsd.toFixed(2)}`;
          return (
            <li key={pack.id} className="flex min-h-12 items-center justify-between gap-3 rounded-mg-sm border border-mg-border bg-mg-bg px-3 py-2">
              <span className="font-semibold tabular-nums text-mg-text">{fmt(pack.credits)} Sparks</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void buyGiftCode(pack.id)}
                disabled={unavailable || (s.buying !== null && s.buying !== key)}
                loading={s.buying === key}
                loadingText="Opening checkout"
                aria-label={`Gift ${fmt(pack.credits)} Sparks for ${price}`}
              >
                {price}
              </Button>
            </li>
          );
        })}
      </ul>
      {s.custom ? (
        <CustomAmountForm
          gift
          custom={s.custom}
          disabled={unavailable || (s.buying !== null && s.buying !== buyingKey(s.custom.id, { gift: true }))}
          busy={s.buying === buyingKey(s.custom.id, { gift: true })}
        />
      ) : null}
      <MyGiftCodes />
    </div>
  );
}

/** Website only, quiet, below the packs: an optional tip with Sparks as thanks. Never in the Android app (Play policy). */
function SupportTip({ s, unavailable }: { s: CreditsState; unavailable: boolean }) {
  if (!s.tips.length) return null;
  return (
    <div className="mt-4 rounded-mg border border-mg-border px-4 py-3" aria-label="Support Mohit's apps" role="group">
      <div className="text-sm font-semibold text-mg-text-2">Support Mohit’s apps</div>
      <p className="mt-0.5 text-xs text-mg-subtle">Optional. Each tip includes Sparks as thanks.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {s.tips.map((t) => {
          const key = buyingKey('sparks_tip', { tipUsd: t.usd });
          return (
            <Button
              key={t.usd}
              size="sm"
              variant="secondary"
              onClick={() => void buyTip(t.usd)}
              disabled={unavailable || (s.buying !== null && s.buying !== key)}
              loading={s.buying === key}
              loadingText="Opening checkout"
              aria-label={`Tip $${t.usd} (includes ${fmt(t.credits)} Sparks)`}
              title={`Includes ${fmt(t.credits)} Sparks`}
            >
              ${t.usd}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Code box with Copy and Download (.txt). */
function BackupCodeShown({ code, note }: { code: string; note: string }) {
  const file = `Sparks backup code\n\n${code}\n\nKeep it private: anyone with this code can move your Sparks.\nTo restore: open ✨ Sparks in any of Mohit's apps on mohitgoenka.com, tap "Restore with a backup code" and enter it.\nIt works once; you get a new code when you use it.\n`;
  return (
    <div className="mt-3" role="status">
      <div className="select-all break-all font-mono text-base font-bold tracking-wider text-mg-gold">{code}</div>
      <p className="mt-1 text-xs text-mg-subtle">{note}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copyToClipboard(code, 'Backup code copied')}>
          Copy
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadTextFile('sparks-backup-code.txt', file)}>
          Download
        </Button>
      </div>
    </div>
  );
}

/** Website only: "Save a backup code" / "Restore with a backup code" (paid Sparks live in this browser's cookie). */
function BackupForm({ saved, focus }: { saved: boolean; focus: boolean }) {
  const [mode, setMode] = useState<'save' | 'restore' | null>(focus ? 'save' : null);
  const [code, setCode] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [entry, setEntry] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) setMode('save');
  }, [focus]);
  useEffect(() => {
    if (focus && mode) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus, mode]);
  if (!mode) {
    return (
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <button type="button" className="text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setMode('save')}>
          Save a backup code
        </button>
        <button type="button" className="text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setMode('restore')}>
          Restore with a backup code
        </button>
      </p>
    );
  }
  return (
    <div ref={box} className="mt-4 rounded-mg border border-mg-border bg-mg-surface px-4 py-3 text-sm text-mg-text-2">
      {mode === 'save' ? (
        <>
          <div className="font-semibold text-mg-text">Save a backup code</div>
          <p className="mt-1 text-xs text-mg-subtle">
            Your Sparks are kept in this browser. If its data is cleared, a backup code brings them back in any browser. Keep it private: anyone with the
            code can move your Sparks.{saved ? ' You saved one before; a new code replaces it.' : ''}
          </p>
          {code ? (
            <BackupCodeShown code={code} note="Shown only this once. Copy it or download it now." />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              loading={making}
              loadingText="Making a code"
              onClick={() => {
                setMaking(true);
                void createBackupCode().then((c) => {
                  setMaking(false);
                  setCode(c);
                });
              }}
            >
              {saved ? 'Make a new backup code' : 'Make a backup code'}
            </Button>
          )}
          <button type="button" className="mt-3 block text-xs text-mg-subtle underline underline-offset-2 hover:text-mg-text-2" onClick={() => setMode('restore')}>
            Restore with a backup code instead
          </button>
        </>
      ) : (
        <>
          <div className="font-semibold text-mg-text">Restore with a backup code</div>
          <p className="mt-1 text-xs text-mg-subtle">Brings the Sparks saved with that code to this browser. Any Sparks already here are added to them.</p>
          {fresh ? (
            <BackupCodeShown code={fresh} note="Your old code is used up. This is your new backup code, shown only this once." />
          ) : (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!entry.trim() || restoring) return;
                setRestoring(true);
                void restoreFromBackupCode(entry).then((next) => {
                  setRestoring(false);
                  if (next) {
                    setEntry('');
                    setFresh(next);
                  }
                });
              }}
            >
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Backup code"
                placeholder="Backup code"
                value={entry}
                maxLength={60}
                onChange={(e) => setEntry(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-mg-sm border border-mg-border bg-mg-surface px-3 text-sm uppercase text-mg-text placeholder:normal-case placeholder:text-mg-subtle focus:border-mg-gold focus:outline-none"
              />
              <Button size="sm" type="submit" loading={restoring} loadingText="Restoring" disabled={!entry.trim()}>
                Restore
              </Button>
            </form>
          )}
        </>
      )}
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

      {!viaPlay && s.giftReturn ? <GiftReturnPanel gift={s.giftReturn} backupSaved={s.backupSaved} /> : null}
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
      {/* Website only (never in the Android app: Play policy): gifts and an optional tip, quietly below the packs. */}
      {viaPlay || s.owner || !s.gifts ? null : <GiftForm s={s} unavailable={unavailable} />}
      {viaPlay || s.owner ? null : <SupportTip s={s} unavailable={unavailable} />}

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
        Each magic action uses a few Sparks, based on what it really costs to make, and the ✨ chip shows what each one used. Repeats are free.{' '}
        {viaPlay
          ? 'Sparks don’t expire and are for this app. Paid through Google Play. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them.'
          : 'Sparks work in all of Mohit’s apps and games in this browser. Sparks are tied to this browser and are kept as long as you use them at least once every 400 days. Secure checkout by Stripe (sold through Link), prices in US dollars.'}
      </p>
      {s.owner ? null : <OwnerCodeForm />}
      {viaPlay ? null : <LinkDevicesForm />}
      {viaPlay ? null : <BackupForm saved={s.backupSaved} focus={s.sheetFocus === 'backup'} />}
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
          'Save a backup code (tap the chip) so you can bring your Sparks back if this browser’s data is cleared. Keep it private: anyone with it can move your Sparks.',
          'You can also give Sparks as a gift: you get a one-use code, valid for 1 year, to give to someone.',
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
        'Each one uses a few Sparks, based on what it really costs to make, and the ✨ chip shows what each one used. Repeats are free, and everything else is always free.',
        `Tap the chip to get more: ${packs} (US prices; Google Play shows your local price). Sparks are added as soon as Google Play confirms the payment.`,
        'Have a promo code? Tap the chip, then “Have a promo code?”, for free Sparks (each code works once in this app).',
        'Phones with built-in AI (Pixel 9 and newer, Galaxy S25 and newer, and more) make some of these right on the phone, for free: no Sparks used. Switch it off in Settings under “Use this device’s AI”.',
        'Sparks don’t expire. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them (with Android backup on, they come back after a reinstall on the same Google account).',
      ],
    },
  ];
}
