/* generated from app-platform/ui-kit — edit there and re-sync. */
// Mohit's app kit — barrel export. Import from './ui-kit' (path relative to your file).

// components
export { AppHeader } from './components/AppHeader';
export type { AppHeaderProps } from './components/AppHeader';
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
export { LazyQRCode } from './components/LazyQRCode';
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
export { useSettings } from './hooks/useSettings';

// utils
export { cx } from './utils/cx';
export { HUB_URL, HUB_LABEL, PRIVACY_URL, COPYRIGHT } from './utils/constants';
export { getSettings, setSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from './utils/settingsStore';
export type { MgSettings } from './utils/settingsStore';
export { showToast, dismissToast } from './utils/toastBus';
export type { ToastOptions, ToastTone } from './utils/toastBus';
export { haptic, haptics } from './utils/haptics';
export { shareOrCopy, copyToClipboard } from './utils/share';
export type { ShareData, ShareResult } from './utils/share';
export { fetchJson, FetchError } from './utils/fetchJson';
export type { FetchJsonOptions, FetchErrorKind } from './utils/fetchJson';
export { lazyWithRetry, importWithRetry, isChunkLoadError, reloadOnceForNewVersion } from './utils/lazyWithRetry';
export { registerServiceWorker } from './utils/serviceWorker';
export type { RegisterServiceWorkerOptions } from './utils/serviceWorker';
export { safeGet, safeSet, safeRemove, readJson } from './utils/storage';
