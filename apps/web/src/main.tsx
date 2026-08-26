import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

/** GitHub Pages has no rewrite rules: it serves real files with HTTP 200 and
 *  everything else via 404.html with an HTTP **404 status**. Browsers render
 *  that fine, but many Android QR scanners (camera app, Lens, GPay/Paytm,
 *  in-app WhatsApp/Instagram browsers) check the status and refuse to open a
 *  404 — which is why "scanning the table QR does nothing".
 *
 *  So printed QRs now encode /scan.html?t=<token>, and scan.html is a REAL file
 *  (a copy of this SPA shell) that always answers 200. Rewrite it back to the
 *  canonical /scan/<token> route before React mounts, so routing is unchanged
 *  and already-printed /scan/<token> codes keep working via the 404 fallback. */
(() => {
  try {
    const u = new URL(window.location.href);
    const t = u.searchParams.get('t') || u.searchParams.get('scan');
    if (t && /\.html$/.test(u.pathname)) {
      window.history.replaceState(null, '', `/scan/${encodeURIComponent(t)}`);
    }
  } catch {
    /* non-fatal: fall through to normal routing */
  }
})();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
