import { createKeyBackup } from '../ui-kit/utils/backup';

/**
 * Your recent evenings (text only; pictures stay on the device) and your restaurant profile, backed up under a private
 * key (kit: ui-kit/utils/backup.ts). One record per evening.
 */
export const backup = createKeyBackup({
  app: 'eve',
  keys: [{ key: 'eve.recentEvenings.v1', itemId: (e: { id?: string }) => e?.id }, 'eve.restaurantBrand'],
});
