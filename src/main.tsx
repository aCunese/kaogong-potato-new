import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import './index.css';

const preview = new URLSearchParams(window.location.search).get('preview') === '1';

// Register Service Worker for offline shell and PWA support
if ('serviceWorker' in navigator && !preview) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for immediate update
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider preview={preview}>
      <App preview={preview} />
    </AppProvider>
  </React.StrictMode>
);
