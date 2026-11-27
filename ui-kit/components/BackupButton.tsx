/* generated from app-platform/ui-kit — edit there and re-sync. */
// The header's backup button, apart from BackupModal so AppHeader can draw it without the modal or the sync engine.
import { useSyncExternalStore } from 'react';
import { IconButton } from './IconButton';
import { CloudIcon, CloudOffIcon, RefreshIcon } from './icons';
import { cx } from '../utils/cx';
import { backupLabel } from '../utils/backupLabel';
import type { Backup, BackupStatus } from '../utils/backup';

/** React: re-render on every status change. */
export function useBackupStatus(backup: Backup): BackupStatus {
  return useSyncExternalStore(backup.subscribe, backup.status, backup.status);
}

/** Header button: a cloud whose color shows the backup state (Scorer's). Pass it to AppHeader as `backup={{ backup, onOpen, open }}` (folds into ⋯ on phones). */
export function BackupButton({ backup, onClick, pressed, className }: { backup: Backup; onClick: () => void; pressed?: boolean; className?: string }) {
  const s = useBackupStatus(backup);
  const Icon = s.state === 'syncing' ? RefreshIcon : s.cloud && (!s.enabled || s.state === 'offline' || s.state === 'error') ? CloudOffIcon : CloudIcon;
  return (
    <IconButton aria-label={`${s.cloud ? 'Sync' : 'Backup'}: ${backupLabel(s)}`} onClick={onClick} pressed={!!pressed} {...(className ? { className } : {})}>
      <Icon size={18} className={cx(s.state === 'syncing' && 'animate-spin', s.state === 'error' ? 'text-mg-warning' : s.cloud && s.enabled && s.state !== 'offline' ? 'text-mg-gold' : 'text-mg-muted')} />
    </IconButton>
  );
}
