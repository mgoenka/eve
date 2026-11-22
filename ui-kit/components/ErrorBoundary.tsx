/* generated from app-platform/ui-kit — edit there and re-sync. */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { HUB_LABEL, HUB_URL } from '../utils/constants';
import { isNativeApp } from '../utils/native';
import { isChunkLoadError, reloadOnceForNewVersion } from '../utils/lazyWithRetry';
import { safeRemove } from '../utils/storage';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** e.g. "Mohit's Bingo" — shown in the fallback. */
  appName?: string;
  /** Back-to-hub link in the fallback. Default the hub; false hides it. */
  hubHref?: string | false;
  /**
   * What "Reset saved data" clears. Default: all localStorage + sessionStorage of this origin
   * (each app has its own origin) and the service-worker caches. Pass key names / prefixes ending in '*' to limit it.
   */
  resetKeys?: string[];
  /** Custom fallback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  /** "Reset saved data" is destructive: ask once before erasing. */
  confirmReset?: boolean;
}

async function clearSavedData(keys?: string[]) {
  try {
    if (keys && keys.length) {
      for (const store of [window.localStorage, window.sessionStorage]) {
        const all: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k) all.push(k);
        }
        for (const k of all) {
          if (keys.some((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p))) safeRemove(k, store === window.localStorage ? 'local' : 'session');
        }
      }
    } else {
      try { window.localStorage.clear(); } catch { /* ignore */ }
      try { window.sessionStorage.clear(); } catch { /* ignore */ }
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* ignore */
  }
}

/** Never a blank white screen: friendly fallback with Reload, "Reset saved data and reload" and back-to-hub. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // A deploy replaced the chunks this tab was using: reload once (loop-guarded) instead of showing an error.
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) return;
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    const hub = isNativeApp() ? false : this.props.hubHref === undefined ? HUB_URL : this.props.hubHref;
    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center bg-mg-bg px-4 py-10 text-mg-text">
        <div className="w-full max-w-md rounded-mg-lg border border-mg-border bg-mg-elevated p-6 text-center shadow-mg-card sm:p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-mg-gold/40 bg-mg-gold/15 text-2xl" aria-hidden="true">😵</div>
          <h1 className="font-display text-xl font-extrabold text-mg-gold">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-mg-text-2">
            {this.props.appName ? this.props.appName + ' hit an unexpected error.' : 'The app hit an unexpected error.'} Reloading usually fixes it.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-mg bg-mg-gold px-4 py-2.5 font-semibold text-mg-on-gold hover:bg-mg-gold-hover">
              Reload
            </button>
            {this.state.confirmReset ? (
              <div className="rounded-mg border border-mg-danger/40 bg-mg-danger/10 p-3 text-left">
                <p className="text-sm text-mg-text">
                  This erases what this app saved on this device (progress, settings, saved items). It can&rsquo;t be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => { void clearSavedData(this.props.resetKeys).then(() => window.location.reload()); }}
                    className="min-h-11 flex-1 rounded-mg bg-mg-danger px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Erase and reload
                  </button>
                  <button
                    type="button"
                    onClick={() => this.setState({ confirmReset: false })}
                    className="min-h-11 flex-1 rounded-mg border border-mg-border bg-mg-surface px-3 py-2 text-sm font-semibold text-mg-text hover:bg-mg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => this.setState({ confirmReset: true })}
                className="min-h-11 rounded-mg border border-mg-border bg-mg-surface px-4 py-2.5 font-semibold text-mg-text hover:bg-mg-surface-2"
              >
                Reset saved data and reload
              </button>
            )}
            {hub ? (
              <a href={hub} className="min-h-11 rounded-mg px-4 py-2.5 text-sm font-medium text-mg-muted hover:text-mg-gold">
                ← {HUB_LABEL} 🎮
              </a>
            ) : null}
          </div>
          <details className="mt-5 text-left text-xs text-mg-subtle">
            <summary className="cursor-pointer select-none">Details</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-mg-sm bg-mg-bg p-3 text-mg-muted">{String(error.message || error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
