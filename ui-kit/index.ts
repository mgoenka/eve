/* generated from app-platform/ui-kit — edit there and re-sync. */
// Mohit's app kit — barrel export. Import from './ui-kit' (path relative to your file).

// components
export { AppHeader } from './components/AppHeader';
export type { AppHeaderProps, HeaderMenuItem } from './components/AppHeader';
export { AppFooter } from './components/AppFooter';
export type { AppFooterProps } from './components/AppFooter';
export { StatusChip, RoomChip } from './components/StatusChip';
export type { StatusChipProps, RoomChipProps, ChipTone } from './components/StatusChip';
export { PlayerSetupRow } from './components/PlayerSetupRow';
export type { PlayerSetupRowProps } from './components/PlayerSetupRow';
export { GameHero } from './components/GameHero';
export type { GameHeroProps } from './components/GameHero';
export { InstallButton, installApp } from './components/InstallButton';
export type { InstallButtonProps } from './components/InstallButton';
export { Button, buttonVariants, buttonSizes } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';
export { IconButton } from './components/IconButton';
export type { IconButtonProps } from './components/IconButton';
export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';
export { ConfirmDialog, useConfirm } from './components/ConfirmDialog';
export type { ConfirmDialogProps, ConfirmOptions } from './components/ConfirmDialog';
export { ToastProvider, useToast } from './components/Toast';
export type { ToastApi, ToastProviderProps } from './components/Toast';
export { RulesOverlay } from './components/RulesOverlay';
export type { RulesOverlayProps, RuleSection } from './components/RulesOverlay';
export { SettingsSheet } from './components/SettingsSheet';
export type { SettingsSheetProps } from './components/SettingsSheet';
export { Switch } from './components/Switch';
export type { SwitchProps } from './components/Switch';
export { ErrorBoundary } from './components/ErrorBoundary';
export type { ErrorBoundaryProps } from './components/ErrorBoundary';
export { Skeleton, SkeletonText } from './components/Skeleton';
export type { SkeletonProps, SkeletonTextProps } from './components/Skeleton';
export { Spinner, LoadingDots } from './components/Spinner';
export type { SpinnerProps, LoadingDotsProps } from './components/Spinner';
export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';
export { OfflineBanner, OfflinePill } from './components/OfflineBanner';
export type { OfflineBannerProps } from './components/OfflineBanner';
export { ReportContentButton, ReportContentDialog, aiContentRuleSection } from './components/ReportContentButton';
export type { ReportContentButtonProps, ReportContentDialogProps } from './components/ReportContentButton';
export { AiCreditsHost, CreditsChip, CreditsSheet, useCredits, aiCreditsRuleSections } from './components/AiCredits';
export type { CreditsChipProps } from './components/AiCredits';
export { JoinScanButton, useNativeJoinScan } from './components/JoinScanButton';
export type { JoinScanButtonProps, UseNativeJoinScanOptions, NativeJoinScan } from './components/JoinScanButton';
export { NotifyTurnPrompt } from './components/NotifyTurnPrompt';
export type { NotifyTurnPromptProps } from './components/NotifyTurnPrompt';
export { LazyQRCode } from './components/LazyQRCode';
export { LazyShareSheet } from './components/LazyShareSheet';
export { LocalAiSetting } from './components/LocalAiSetting';
export type { ShareSheetProps } from './components/ShareSheet';
export { ResultsCard } from './components/ResultsCard';
export { BackupModal, BackupButton, useBackupEntry, useBackupStatus } from './components/BackupModal';
export type { BackupModalProps } from './components/BackupModal';
export { SearchSuggestions } from './components/SearchSuggestions';
export { isSearchSuggestionsHtml } from './utils/searchSuggestions';
export type { SearchSuggestionsProps } from './components/SearchSuggestions';
export type { ResultsCardProps } from './components/ResultsCard';
export { SCORER_FEED_URL, reportToScorer } from './utils/scorerFeed';
export { trackPulse, trackGamePulse, gameFingerprint } from './utils/pulse';
export { scoreCardAccent } from './utils/scoreCard';
export type { QRCodeProps } from './components/QRCode';
// Static QRCode (pulls the encoder into the importing chunk): import { QRCode } from './ui-kit/components/QRCode'
export * from './components/icons';

// hooks
export { useLocalStorage } from './hooks/useLocalStorage';
export type { UseLocalStorageOptions } from './hooks/useLocalStorage';
export { useMediaQuery, useIsPhone } from './hooks/useMediaQuery';
export { useReducedMotion, prefersReducedMotion } from './hooks/useReducedMotion';
export { useOnline } from './hooks/useOnline';
export { useWakeLock } from './hooks/useWakeLock';
export { useLocalAi } from './hooks/useLocalAi';
export { useSettings } from './hooks/useSettings';
export { useInstallPrompt, promptInstall } from './hooks/useInstallPrompt';
export type { InstallPromptState } from './hooks/useInstallPrompt';

// utils
export { cx } from './utils/cx';
export { HUB_URL, HUB_LABEL, PRIVACY_URL, TERMS_URL, COPYRIGHT } from './utils/constants';
export { getSettings, setSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from './utils/settingsStore';
export type { MgSettings } from './utils/settingsStore';
export { showToast, dismissToast } from './utils/toastBus';
export type { ToastOptions, ToastTone } from './utils/toastBus';
export { haptic, haptics } from './utils/haptics';
export { shareOrCopy, copyToClipboard } from './utils/share';
export type { ShareData, ShareResult } from './utils/share';
export type { ScoreCardData, ScoreCardPlayer, ScoreCardStat, ScoreCardFormat } from './utils/scoreCard';
export { adaptiveSkill, aiSucceeds, skillToError, skillToDelay, createSkillTracker } from './utils/adaptiveAi';
export type { AdaptiveSkillInput, SkillTracker } from './utils/adaptiveAi';
export { fetchJson, FetchError } from './utils/fetchJson';
export type { FetchJsonOptions, FetchErrorKind } from './utils/fetchJson';
export { lazyWithRetry, importWithRetry, isChunkLoadError, reloadOnceForNewVersion } from './utils/lazyWithRetry';
export { registerServiceWorker } from './utils/serviceWorker';
export type { RegisterServiceWorkerOptions } from './utils/serviceWorker';
export { createLazySocket, IDLE_DISCONNECT_EVENT } from './utils/lazySocket';
// Side effect: automated browsers tag their requests so AI routes answer with free fixtures.
export { isAutomatedBrowser, AI_TEST_HEADER } from './utils/testMode';
export type { LazySocketOptions } from './utils/lazySocket';
export { safeGet, safeSet, safeRemove, readJson } from './utils/storage';
export { isNativeApp, nativePlatform, goToHub, NATIVE_UA_TOKEN, isTvDevice, applyTvClass, installDpadNav } from './utils/native';
export {
  nativeShell,
  hasNativeScanner,
  nativeScanQr,
  nativeScanQrResult,
  onAppShortcut,
  onNotificationOpen,
  pushAvailable,
  notificationPermission,
  getPushToken,
  requestPushToken,
  scheduleDailyReminder,
  cancelReminder,
  SHORTCUT_EVENT,
  NOTIFICATION_EVENT,
} from './utils/nativeShell';
export type { MGNativeShell, MGNativeShellNotifications, NativeScanResult, NativePermission, NativeDailyReminder, NotificationOpenDetail } from './utils/nativeShell';
export { parseJoinCode } from './utils/joinCode';
export type { ParseJoinCodeOptions } from './utils/joinCode';
export { registerSeatPush, notifySeats, pushConsent, setPushConsent, PUSH_CONSENT_KEY, PUSH_ALLOWED_EVENT, PUSH_CONSENT_EVENT } from './utils/pushClient';
export type { PushConsent, PushSocketLike, RegisterSeatPushOptions, NotifySeatsInput, NotifyKind } from './utils/pushClient';
export { reportContent, REPORT_CONTENT_URL, REPORT_REASONS, REPORT_LIMITS } from './utils/reportContent';
export type { ReportContentInput, ReportReason } from './utils/reportContent';
export {
  aiFetchJson,
  isInsufficientCredits,
  openCreditsSheet,
  closeCreditsSheet,
  refreshCredits,
  buyCredits,
  creditsEnabled,
  creditsHeaders,
  enterOwnerCode,
  redeemPromoCode,
  createDeviceLinkCode,
  linkThisDevice,
  activeCreditsProvider,
  registerWebCreditsProvider,
  AI_CREDIT_PACKS,
  AI_STARTER_CREDITS,
  INSUFFICIENT_CREDITS,
  AI_BUSY,
  AiBusyError,
  isAiBusyError,
  speculativeAiAllowed,
  speculativeAiAllowedAsync,
  whenCreditsLoaded,
} from './utils/credits';
export type { AiFetchJsonOptions, CreditsProvider, CreditsProviderEvents, CreditsState } from './utils/credits';
export { playCreditsProvider, getAppUserId, nativeBridge } from './utils/creditsPlay';
export { webCreditsProvider, CREDITS_CHECKOUT_URL, CREDITS_CONFIRM_URL } from './utils/creditsWeb';
export type { NativeBridge, NativeBilling, NativeProduct, NativePurchase } from './utils/creditsPlay';
export { runLocalFirst, canRunLocally, localPrompt, localJson, parseLooseJson, prepareLocalAi, refreshLocalAi, getLocalAiInfo, subscribeLocalAi, localAiEnabled, enableLocalAiSetting, localAiSettingEnabled } from './utils/localAi';
export type { LocalAiInfo, LocalAiState, LocalAiEngine, LocalPromptOptions, RunLocalFirstOptions } from './utils/localAi';
export { createBackup, createKeyBackup, backupKeys, backupLabel } from './utils/backup';
export type { Backup, BackupOptions, BackupStatus, BackupKeySpec, BackupKeysOptions } from './utils/backup';
export { formatKey, normalizeKey, normalizeLinkCode } from './utils/backupProtocol';
export type { SyncRecord, BackupFile } from './utils/backupProtocol';
