import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const renderApp = async () => {
  const params = new URLSearchParams(window.location.search);
  const mobileOnly = import.meta.env.VITE_MOBILE_ONLY === 'true';

  if (mobileOnly || params.get('cartela') === 'mobile') {
    const { default: MobileCardClient } = await import('./mobile/MobileCardClient');
    root.render(
      <React.StrictMode>
        <MobileCardClient />
      </React.StrictMode>
    );
    return;
  }

  const { default: BingoWebOSMaster } = await import('../bingo_webos_master');
  root.render(
    <React.StrictMode>
      <BingoWebOSMaster />
    </React.StrictMode>
  );
};

renderApp();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
