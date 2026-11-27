import { useEffect, useState } from 'react';
import { Trash2, Check } from 'lucide-react';
import { AppHeader, Button, FetchError, LocalAiSetting, Modal, fetchJson, useConfirm } from '../ui-kit';
import { EveLogo } from './EveLogo';
import { useOpenRules } from './RulesContext';
import { backup } from '../lib/backup';
import { clearPictures } from '../services/stopPictures';

// "Delete my account and data" (Google Play account-deletion policy).
// Eve has no sign-in: the server keeps only what this device published
// (specials for diners, an Instagram connection), linked to an httpOnly
// owner-key cookie. Everything else lives in this browser's storage.

const CONTACT = 'hello@mohitgoenka.com';

interface DeleteResult {
  ok: boolean;
  linked: boolean;
  deleted: { specials: number; brands: number };
}

/** Clears everything Eve keeps in this browser (recent evenings, restaurant profile, settings, painted pictures and narration). */
async function clearDeviceData() {
  try {
    localStorage.clear();
  } catch {}
  try {
    sessionStorage.clear();
  } catch {}
  await clearPictures();
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function AccountDataSection({ compact = false, onDeleted }: { compact?: boolean; onDeleted?: () => void }) {
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DeleteResult | null>(null);

  const run = async () => {
    const ok = await confirm({
      title: 'Delete your account and data?',
      tone: 'danger',
      confirmLabel: 'Delete everything',
      message: (
        <>
          Eve permanently deletes the specials you published to Eve diners from this device, your Instagram connection,
          the cloud backup of your recent evenings, and on this device your recent evenings and restaurant profile. This can’t be undone.
        </>
      ),
    });
    if (!ok) return;
    setDeleting(true);
    setError('');
    try {
      // The cloud backup of recent evenings (if any) goes first, so a failure leaves everything as it was.
      await backup.eraseCloud();
      const r = await fetchJson<DeleteResult>('/api/account/delete', {
        method: 'POST',
        body: { confirm: 'delete' },
        timeoutMs: 20_000,
        retries: 1,
      });
      await clearDeviceData();
      setResult(r);
      onDeleted?.();
    } catch (e) {
      const serverMsg = e instanceof FetchError && e.body && typeof (e.body as any).error === 'string' ? (e.body as any).error : '';
      setError(serverMsg || (e instanceof FetchError ? e.message : 'Couldn’t delete your data. Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  if (result) {
    const { specials, brands } = result.deleted;
    const server =
      specials + brands > 0
        ? `Deleted ${plural(specials, 'published special', 'published specials')}${brands ? ` and ${plural(brands, 'Instagram connection', 'Instagram connections')}` : ''} from Eve’s servers.`
        : 'Eve’s servers had nothing linked to this device.';
    return (
      <div role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-eve-cream/90">
        <p className="mb-1 inline-flex items-center gap-1.5 font-semibold text-emerald-300">
          <Check size={15} aria-hidden="true" /> Your data is deleted
        </p>
        <p>{server} Your recent evenings and restaurant profile are gone from this device.</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => window.location.replace('/')}>
          Start fresh
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="eve-account-data">
      <h3 id="eve-account-data" className="mb-1.5 text-sm font-semibold text-mg-text">
        Account and data
      </h3>
      <div className={`space-y-2 text-[0.8125rem] leading-relaxed text-mg-muted ${compact ? '' : 'sm:text-sm'}`}>
        <p>
          Eve has no sign-in. Your recent evenings and restaurant profile stay on this device. Specials you publish to Eve
          diners (dish, caption, picture) and an Instagram connection are stored on Eve’s server, linked to this device.
        </p>
        <p>Deleting removes all of that and resets Eve on this device.</p>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      <Button
        className="mt-3"
        variant="danger"
        fullWidth
        loading={deleting}
        loadingText="Deleting"
        leftIcon={<Trash2 size={16} aria-hidden="true" />}
        onClick={() => void run()}
      >
        Delete my account and data
      </Button>
      <p className="mt-2 text-xs text-mg-subtle">
        No longer have this device? Email{' '}
        <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Eve data deletion')}`} className="underline decoration-dotted underline-offset-2 hover:text-mg-text">
          {CONTACT}
        </a>{' '}
        with your restaurant’s name and city.
      </p>
      {dialog}
    </section>
  );
}

/** The header gear: Settings (bottom sheet on phones) with the account/data section. */
export function EveSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  // After a deletion the screens still hold the old state in memory: closing starts Eve fresh.
  const [deleted, setDeleted] = useState(false);
  return (
    <Modal open={open} onClose={deleted ? () => window.location.replace('/') : onClose} title="Settings" size="sm">
      {/* "Use this device's AI" (hidden where the device has no model of its own). */}
      <div className="-mx-3 mb-4">
        <LocalAiSetting />
      </div>
      <AccountDataSection compact onDeleted={() => setDeleted(true)} />
    </Modal>
  );
}

/** /delete-data: the same control as a page (web link for the store listing). */
export function DataPage({ onBack }: { onBack: () => void }) {
  const openRules = useOpenRules();
  useEffect(() => {
    document.title = 'Eve · Delete my account and data';
  }, []);
  return (
    <div className="relative z-10 min-h-dvh flex flex-col">
      <AppHeader
        title="Eve"
        icon={<EveLogo size={26} />}
        onTitleClick={onBack}
        titleLabel="Eve home"
        onRules={openRules}
        rulesLabel="How Eve works"
      />
      <main className="flex-1 w-full max-w-lg mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="font-header text-2xl sm:text-3xl text-eve-cream mb-5">Delete my account and data</h1>
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <AccountDataSection />
        </div>
      </main>
    </div>
  );
}
