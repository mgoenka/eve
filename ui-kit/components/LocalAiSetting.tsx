/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useLocalAi } from '../hooks/useLocalAi';
import { prepareLocalAi } from '../utils/localAi';
import { showToast } from '../utils/toastBus';
import { Switch } from './Switch';
import { Button } from './Button';

/**
 * "Use this device's AI" switch plus its status: ready, needs a one-time download (button), downloading (%),
 * or not available here. Rendered in SettingsSheet and the Sparks sheet. Hidden entirely when unsupported.
 */
export function LocalAiSetting({ compact = false }: { compact?: boolean }) {
  const [s, set] = useSettings();
  const ai = useLocalAi();
  const [busy, setBusy] = useState(false);
  if (ai.state === 'unsupported' || ai.state === 'unavailable') return null;
  const where = ai.engine === 'android' ? 'this phone' : 'this browser';
  const status =
    ai.state === 'available'
      ? `Ready: some features run on ${where} for free, no Sparks used.`
      : ai.state === 'downloading'
        ? `Setting up ${where}'s AI… ${ai.progress != null ? Math.round(ai.progress * 100) + '%' : ''}`
        : `${where[0]!.toUpperCase() + where.slice(1)} can run some features for free after a one-time download.`;
  const setup = async () => {
    setBusy(true);
    const ok = await prepareLocalAi();
    setBusy(false);
    showToast(ok ? { message: 'On-device AI is ready. Some features are now free here.', tone: 'success' } : { message: "Couldn't set up on-device AI here.", tone: 'error' });
  };
  return (
    <div className={compact ? '' : ''}>
      <Switch label="✨ Use this device's AI" description={s.onDeviceAi !== false ? status : 'Off: every feature uses Sparks.'} checked={s.onDeviceAi !== false} onChange={(v) => set({ onDeviceAi: v })} />
      {s.onDeviceAi !== false && ai.state === 'downloadable' ? (
        <div className="px-3 pb-2">
          <Button size="sm" variant="outline" onClick={setup} loading={busy}>
            Set up free on-device AI
          </Button>
        </div>
      ) : null}
    </div>
  );
}
