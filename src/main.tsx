import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import './index.css';

const preview = new URLSearchParams(window.location.search).get('preview') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider preview={preview}>
      <App preview={preview} />
    </AppProvider>
  </React.StrictMode>
);
