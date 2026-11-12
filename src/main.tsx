import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
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
    <ErrorBoundary
      title="工作台页面加载异常"
      description="你的本地学习数据已安全保存，点击重试或刷新页面即可恢复。"
      onReset={() => window.location.reload()}
    >
      <AppProvider preview={preview}>
        <App preview={preview} />
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
