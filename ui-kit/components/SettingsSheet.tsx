/* generated from app-platform/ui-kit — edit there and re-sync. */
import type { ReactNode } from 'react';
import { useSettings } from '../hooks/useSettings';
import { haptic } from '../utils/haptics';
import { Modal } from './Modal';
import { Switch } from './Switch';
import { LocalAiSetting } from './LocalAiSetting';
import { localAiSettingEnabled } from '../utils/localAi';

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Default "Settings". */
  title?: ReactNode;
  /** Hide toggles that don't apply (e.g. no sounds in the app). Shown by default; onDeviceAi only in apps with AI features (true forces it). */
  show?: { sound?: boolean; haptics?: boolean; reduceMotion?: boolean; onDeviceAi?: boolean };
  /** App-specific settings, rendered under the shared toggles. */
  children?: ReactNode;
  /** Small text at the bottom (e.g. version). */
  footnote?: ReactNode;
  /** The app's own sound state (e.g. its mute button): the "Sound effects" switch then shows and sets it. */
  sound?: { on: boolean; onChange: (on: boolean) => void };
}

/** Sound / haptics / reduce-motion toggles (persisted via useSettings) plus an app-specific slot. */
export function SettingsSheet({ open, onClose, title = 'Settings', show = {}, children, footnote, sound }: SettingsSheetProps) {
  const [s, set] = useSettings();
  const vibrateSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="-mx-3 flex flex-col">
        {show.sound !== false ? (
          <Switch label="Sound effects" checked={sound ? sound.on : s.sound} onChange={(v) => (sound ? sound.onChange(v) : set({ sound: v }))} />
        ) : null}
        {show.haptics !== false ? (
          <Switch
            label="Haptics"
            description={vibrateSupported ? 'Vibrate on taps and results' : 'Not supported on this device'}
            disabled={!vibrateSupported}
            checked={s.haptics && vibrateSupported}
            onChange={(v) => { set({ haptics: v }); if (v) haptic(15); }}
          />
        ) : null}
        {show.reduceMotion !== false ? (
          <Switch label="Reduce motion" description="Fewer animations and no confetti" checked={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
        ) : null}
        {/* Only in apps with AI features (AiCreditsHost / local AI helpers / enableLocalAiSetting), or show.onDeviceAi: true. */}
        {show.onDeviceAi === true || (show.onDeviceAi !== false && localAiSettingEnabled()) ? <LocalAiSetting /> : null}
      </div>
      {children ? <div className="mt-4 border-t border-mg-border-subtle pt-4">{children}</div> : null}
      {footnote ? <p className="mt-4 text-center text-xs text-mg-subtle">{footnote}</p> : null}
    </Modal>
  );
}
