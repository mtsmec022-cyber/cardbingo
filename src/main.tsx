import React from 'react';
import ReactDOM from 'react-dom/client';
import BingoWebOSMaster from '../bingo_webos_master';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BingoWebOSMaster />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
