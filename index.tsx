import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary, ToastProvider, registerServiceWorker } from './ui-kit';
// Syne + DM Sans come self-hosted from the kit (theme.css). Cormorant Garamond,
// Eve's spoken-voice serif, is self-hosted here (font-display: swap).
import '@fontsource-variable/cormorant-garamond/wght.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary appName="Eve" resetKeys={['eve.*']}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Production web only; the Capacitor shells load the app from the device.
const isNativeShell = !!(window as any).Capacitor?.isNativePlatform?.();
registerServiceWorker(isNativeShell ? { enabled: false } : {});
