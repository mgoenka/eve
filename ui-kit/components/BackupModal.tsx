/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from './Modal';
import { Switch } from './Switch';
import { LazyQRCode } from './LazyQRCode';
import { IconButton } from './IconButton';
import { useToast } from './Toast';
import { CloudIcon, CloudOffIcon, CopyIcon, DownloadIcon, EyeIcon, KeyIcon, LinkIcon, RefreshIcon, UploadIcon } from './icons';
import { copyToClipboard } from '../utils/share';
import { FetchError } from '../utils/fetchJson';
import { cx } from '../utils/cx';
import { formatKey, normalizeKey, normalizeLinkCode } from '../utils/backupProtocol';
import { backupLabel, type Backup, type BackupStatus } from '../utils/backup';

/** React: re-render on every status change. */
export function useBackupStatus(backup: Backup): BackupStatus {
  return useSyncExternalStore(backup.subscribe, backup.status, backup.status);
}

const inputClass =
  'w-full p-3 bg-mg-surface border border-mg-border rounded-xl focus:outline-none focus:ring-2 focus:ring-mg-gold focus:border-mg-gold/50 placeholder-mg-muted text-mg-text';
const quietButton =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl text-sm font-semibold bg-mg-surface text-mg-muted border border-mg-border hover:text-mg-text hover:bg-mg-surface-2 hover:border-mg-border-strong transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const goldButton =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl text-sm font-semibold bg-mg-surface text-mg-gold border border-mg-gold/25 hover:bg-mg-gold/12 hover:border-mg-gold/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed';

export interface BackupModalProps {
  open: boolean;
  onClose: () => void;
  backup: Backup;
  /** A link code from a ?link= URL (useBackupEntry gives it). */
  initialCode?: string;
  /** Default "Backup and devices ☁️" ("Backup 💾" for file-only apps). */
  title?: string;
  /** What gets backed up, for the switch: "Friends, games and history". */
  what: string;
  /** Plural noun for the data in sentences: "scores", "wheels", "saved boards". */
  noun: string;
  /** Toast after a restore. Default "Restored. Your {noun} are coming back." */
  restoredMessage?: string;
  /** Export / import a JSON file. Default true. */
  files?: boolean;
}

/** Cloud backup (switch, link code + QR, recovery key) and file export / import, for a createBackup() engine. */
export function BackupModal({ open, onClose, backup, initialCode, title, what, noun, restoredMessage, files = true }: BackupModalProps) {
  const s = useBackupStatus(backup);
  const { success, error } = useToast();
  const [link, setLink] = useState<{ code: string; expiresAt: number } | null>(null);
  const [making, setMaking] = useState(false);
  const [code, setCode] = useState(initialCode ?? '');
  const [joining, setJoining] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [restore, setRestore] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busyFile, setBusyFile] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialCode) setCode(initialCode);
  }, [initialCode]);
  useEffect(() => {
    if (!open) {
      setShowKey(false);
      setRestore('');
    }
  }, [open]);
  useEffect(() => {
    if (!link) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [link]);
  const left = link ? Math.max(0, Math.round((link.expiresAt - now) / 1000)) : 0;
  useEffect(() => {
    if (link && left === 0) setLink(null);
  }, [link, left]);

  const make = async () => {
    setMaking(true);
    try {
      const l = await backup.createLinkCode();
      setNow(Date.now());
      setLink(l);
    } catch {
      error("Couldn't make a code. Check the connection and try again.");
    } finally {
      setMaking(false);
    }
  };

  const join = async () => {
    const c = normalizeLinkCode(code);
    if (!c) {
      error('Codes are 6 letters and numbers.');
      return;
    }
    setJoining(true);
    try {
      const ok = await backup.redeemLinkCode(c);
      if (ok === null) error('That code is wrong or has expired. Make a new one on the other device.');
      else {
        success(`Linked! Your ${noun} now sync with the other device.`);
        setCode('');
        onClose();
      }
    } catch (e) {
      error(e instanceof FetchError && e.status === 429 ? 'Too many tries. Wait a bit and try again.' : "Couldn't link right now. Try again.");
    } finally {
      setJoining(false);
    }
  };

  const doRestore = async () => {
    if (!normalizeKey(restore)) {
      error('A recovery key is 32 letters and numbers.');
      return;
    }
    try {
      await backup.switchKey(restore);
      success(restoredMessage ?? `Restored. Your ${noun} are coming back.`);
      onClose();
    } catch {
      error("Couldn't reach the cloud. Check the connection and try again.");
    }
  };

  const doExport = async () => {
    setBusyFile(true);
    try {
      await backup.downloadFile();
      success('Backup file saved.');
    } catch {
      error("Couldn't save the file.");
    } finally {
      setBusyFile(false);
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setBusyFile(true);
    try {
      const r = await backup.importFile(file);
      if ('error' in r) error(r.error === 'other_app' ? "That backup file is from another app." : r.error === 'empty' ? 'That backup file is empty.' : "That isn't a backup file.");
      else {
        success(`Imported ${r.imported} ${r.imported === 1 ? 'item' : 'items'}.`);
        onClose();
      }
    } catch {
      error("Couldn't read that file.");
    } finally {
      setBusyFile(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const joinUrl = link ? `${location.origin}/?link=${link.code}` : '';
  // One backup for all of Mohit's apps (docs/backup-family.md).
  const family = backup.options.family !== false;
  const pretty = (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`;

  return (
    <Modal open={open} onClose={onClose} title={title ?? (s.cloud ? 'Backup and devices ☁️' : 'Backup 💾')} description={backupLabel(s)} size="md">
      <div className="flex flex-col gap-6">
        {s.cloud ? (
          <>
            <div className="flex flex-col gap-2">
              <Switch label="Back up to the cloud" description={`${what}, under a private key only your devices have`} checked={s.enabled} onChange={backup.setEnabled} />
              {family ? <p className="text-mg-2xs text-mg-muted">One backup for all of Mohit's apps: this switch, the key and link codes work for every one of them on this device.</p> : null}
              {s.enabled ? (
                <button type="button" className={`${quietButton} self-start`} onClick={() => void backup.syncNow()} disabled={s.state === 'syncing'}>
                  Sync now <RefreshIcon size={15} className={s.state === 'syncing' ? 'animate-spin' : ''} />
                </button>
              ) : null}
            </div>

            <section className="flex flex-col gap-3" aria-label="Use on another device">
              <h3 className="text-sm font-semibold text-mg-text">New phone or another device 📱</h3>
              <p className="text-sm text-mg-muted">Make a code here, then enter it (or scan the QR) on the other device. Both then share the same {noun}{family ? ", and Mohit's other apps there join too" : ''}.</p>
              {link ? (
                <div className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-mg-surface border border-mg-gold/25">
                  <p className="font-mono text-3xl font-black tracking-[0.2em] text-mg-gold" aria-label={`Code ${link.code.split('').join(' ')}`}>{pretty(link.code)}</p>
                  <div className="rounded-xl bg-white p-2"><LazyQRCode value={joinUrl} size={168} label="QR code to link a device" /></div>
                  <p className="text-mg-2xs text-mg-muted">Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
                </div>
              ) : (
                <button type="button" className={`${goldButton} self-start`} onClick={make} disabled={making || !s.enabled}>
                  {making ? 'Making a code' : 'Get a link code'} <LinkIcon size={15} />
                </button>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void join(); }}>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="6-letter code" aria-label="Link code" maxLength={7} className={`${inputClass} font-mono tracking-widest uppercase placeholder:tracking-normal placeholder:normal-case placeholder:font-sans`} autoComplete="off" autoCapitalize="characters" autoFocus={!!initialCode} />
                <button type="submit" className={`${goldButton} shrink-0`} disabled={joining || !code.trim()}>
                  {joining ? 'Linking' : 'Link'} <LinkIcon size={15} />
                </button>
              </form>
              <p className="text-mg-2xs text-mg-muted">Linking adds the {noun} on this device to the other device's.</p>
            </section>

            <section className="flex flex-col gap-3" aria-label="Recovery key">
              <h3 className="text-sm font-semibold text-mg-text">Recovery key 🔑</h3>
              <p className="text-sm text-mg-muted">Save it in your notes or password manager. If you lose this phone, the key brings everything back{family ? " in all of Mohit's apps" : ''}.</p>
              {showKey ? (
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-mg-surface border border-mg-border">
                  <code className="flex-1 min-w-0 break-all font-mono text-sm text-mg-text select-all">{formatKey(backup.getKey())}</code>
                  <button type="button" className={quietButton} onClick={() => void copyToClipboard(formatKey(backup.getKey()), 'Recovery key copied')}>Copy <CopyIcon size={15} /></button>
                </div>
              ) : (
                <button type="button" className={`${quietButton} self-start`} onClick={() => setShowKey(true)}>Show recovery key <EyeIcon size={15} /></button>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doRestore(); }}>
                <input value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="Paste a recovery key" aria-label="Recovery key to restore" className={`${inputClass} font-mono text-sm`} autoComplete="off" spellCheck={false} />
                <button type="submit" className={`${quietButton} shrink-0`} disabled={!restore.trim()}>Restore <KeyIcon size={15} /></button>
              </form>
            </section>
          </>
        ) : null}

        {files ? (
          <section className="flex flex-col gap-3" aria-label="Backup file">
            <h3 className="text-sm font-semibold text-mg-text">Backup file 💾</h3>
            <p className="text-sm text-mg-muted">Save your {noun} to a file you keep, or bring a file back onto this device. No cloud needed.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={goldButton} onClick={() => void doExport()} disabled={busyFile}>Export to file <DownloadIcon size={15} /></button>
              <button type="button" className={quietButton} onClick={() => fileInput.current?.click()} disabled={busyFile}>Import from file <UploadIcon size={15} /></button>
              <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Backup file to import" onChange={(e) => void doImport(e.target.files?.[0])} />
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

/** Header button: a cloud whose color shows the backup state (Scorer's). Put it in AppHeader `right`. */
export function BackupButton({ backup, onClick, pressed, className }: { backup: Backup; onClick: () => void; pressed?: boolean; className?: string }) {
  const s = useBackupStatus(backup);
  const Icon = s.state === 'syncing' ? RefreshIcon : s.cloud && (!s.enabled || s.state === 'offline' || s.state === 'error') ? CloudOffIcon : CloudIcon;
  return (
    <IconButton aria-label={`${s.cloud ? 'Sync' : 'Backup'}: ${backupLabel(s)}`} onClick={onClick} pressed={!!pressed} {...(className ? { className } : {})}>
      <Icon size={18} className={cx(s.state === 'syncing' && 'animate-spin', s.state === 'error' ? 'text-mg-warning' : s.cloud && s.enabled && s.state !== 'offline' ? 'text-mg-gold' : 'text-mg-muted')} />
    </IconButton>
  );
}

/**
 * Starts the engine and opens the modal for a ?link=CODE URL (the QR's target), removing the parameter.
 *   const entry = useBackupEntry(backup);
 *   <AppHeader right={<BackupButton backup={backup} onClick={entry.show} pressed={entry.open} />} … />
 *   <BackupModal open={entry.open} onClose={entry.close} initialCode={entry.initialCode} backup={backup} … />
 */
export function useBackupEntry(backup: Backup) {
  const [open, setOpen] = useState(false);
  const [initialCode, setInitialCode] = useState<string | undefined>();
  useEffect(() => {
    backup.start();
    const url = new URL(location.href);
    if (!url.searchParams.has('link')) return;
    const c = normalizeLinkCode(url.searchParams.get('link') ?? '');
    url.searchParams.delete('link');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (c) {
      setInitialCode(c);
      setOpen(true);
    }
  }, [backup]);
  return { open, show: () => setOpen(true), close: () => setOpen(false), ...(initialCode ? { initialCode } : {}) };
}
