/* generated from app-platform/ui-kit — edit there and re-sync. */
// What the Sparks sheet and the rules show inside the native apps, per platform. iOS: Apple requires its own
// in-app purchase, so the iOS app sells nothing (no packs, no Google Play text) until App Store purchases exist,
// and promo codes are only for Mohit's own devices.
import { nativePlatform } from './native';
import { safeGet } from './storage';

export type CreditsPlatform = 'android' | 'ios' | 'web';

/** The platform the Sparks UI is drawn for: the native wrapper's, else 'web'. */
export const creditsPlatform = (): CreditsPlatform => nativePlatform() ?? 'web';

/** Mohit's own device (tagged with #mg-me, see pulse.js). */
export const isOwnerDevice = (): boolean => safeGet('mg_pulse_me') === '1';

export interface SheetParts {
  /** The packs to buy. */
  packs: boolean;
  /** "Purchases are unavailable … Google Play" / "…right now". */
  unavailableAlert: boolean;
  /** "A payment is pending …". */
  pending: boolean;
  /** "Have a promo code?". */
  codeForm: boolean;
  /** Wording: hints like "get a pack below" only where packs are sold. */
  canBuy: boolean;
}

export function sheetParts(platform: CreditsPlatform, owner: boolean, ownerDevice: boolean = isOwnerDevice()): SheetParts {
  if (platform === 'ios') return { packs: false, unavailableAlert: false, pending: false, codeForm: !owner && ownerDevice, canBuy: false };
  return { packs: !owner, unavailableAlert: !owner, pending: true, codeForm: !owner, canBuy: true };
}

/** The sheet's small print in the native apps. */
export function nativeSheetNote(platform: 'android' | 'ios'): string {
  return platform === 'ios'
    ? 'Sparks don’t expire and are for this app. Sparks are stored with this app on this device; deleting the app without a backup removes them.'
    : 'Sparks don’t expire and are for this app. Paid through Google Play. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them.';
}

/** The "Sparks" rules lines in the native apps (iOS: no prices, no Google Play, no promo codes, no Android notes). */
export function nativeSparksRuleItems(platform: 'android' | 'ios', starter: number, packs: ReadonlyArray<{ credits: number; priceUsd: number }>): string[] {
  const fmt = (n: number) => n.toLocaleString();
  const first = [
    `The magic features (freshly made rounds, custom themes and more) use Sparks ✨. New players get ${starter} free Sparks to start (while the free daily allowance lasts); your balance is the ✨ chip at the top.`,
    'Each one uses a few Sparks, based on what it really costs to make, and the ✨ chip shows what each one used. Repeats are free, and everything else is always free.',
  ];
  if (platform === 'ios') return [...first, 'Sparks don’t expire. Sparks are stored with this app on this device; deleting the app without a backup removes them.'];
  const list = packs.map((p) => `${fmt(p.credits)} Sparks for $${p.priceUsd.toFixed(2)}`).join(', ');
  return [
    ...first,
    `Tap the chip to get more: ${list} (US prices; Google Play shows your local price). Sparks are added as soon as Google Play confirms the payment.`,
    'Have a promo code? Tap the chip, then “Have a promo code?”, for free Sparks (each code works once in this app).',
    'Phones with built-in AI (Pixel 9 and newer, Galaxy S25 and newer, and more) make some of these right on the phone, for free: no Sparks used. Switch it off in Settings under “Use this device’s AI”.',
    'Sparks don’t expire. Sparks are stored with this app on this device; uninstalling or clearing the app’s data without a backup removes them (with Android backup on, they come back after a reinstall on the same Google account).',
  ];
}
