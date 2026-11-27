/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { BackupStatus } from './backup';

/** One line for the backup state ("Backed up 5m ago", "Cloud backup is off"…). */
export function backupLabel(s: BackupStatus): string {
  if (!s.cloud) return 'Saved on this device';
  if (!s.enabled) return 'Cloud backup is off';
  if (s.state === 'syncing') return 'Syncing';
  if (s.state === 'offline') return 'Offline: saved on this device';
  if (s.state === 'error') return s.error ?? "Couldn't sync";
  if (!s.lastSyncAt) return 'Not synced yet';
  const sec = Math.round((Date.now() - s.lastSyncAt) / 1000);
  return `Backed up ${sec < 60 ? 'just now' : sec < 3600 ? `${Math.round(sec / 60)}m ago` : new Date(s.lastSyncAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}
