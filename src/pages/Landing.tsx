/** Entry point: two ways in — scan the table QR (with a manual-code fallback)
 *  or browse/search every listed restaurant. Plus the instant demo. */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '../components';
import { DEMO_TOKEN } from '../lib/demo';

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);

  const go = () => {
    const t = code.trim().replace(/.*scan\//, '');
    if (t) nav(`/scan/${encodeURIComponent(t)}`);
  };

  return (
    <div className="page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={26} />
        <span className="badge gold">No app · no sign-up</span>
      </div>

      <div className="center-fill" style={{ gap: 18 }}>
        <p className="overline">Order without the wait</p>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 6vw, 44px)', maxWidth: 580 }}>
          The menu is on your table.
        </h1>
        <p className="muted" style={{ maxWidth: 460, fontSize: 15 }}>
          Point your camera at the Menutha QR to order from your seat — or search
          the restaurant and order takeaway. The kitchen sees it instantly.
        </p>

        <div className="option-grid">
          <button className="option-card glass" onClick={() => setShowCode((s) => !s)}>
            <span className="icon" aria-hidden>📷</span>
            <h3>Scan the table QR</h3>
            <p>
              Use your phone camera or Google Lens on the QR card at your table —
              it opens the live menu right here.
            </p>
            <span className="go">{showCode ? 'Hide code entry' : 'Enter code instead →'}</span>
          </button>

          <button className="option-card glass" onClick={() => nav('/restaurants')}>
            <span className="icon" aria-hidden>🔍</span>
            <h3>Search restaurants</h3>
            <p>
              Browse every restaurant on Menutha, open its live menu, and order
              Parcel / Takeaway.
            </p>
            <span className="go">Browse the list →</span>
          </button>
        </div>

        {showCode && (
          <div className="glass" style={{ width: '100%', maxWidth: 560, padding: 18 }}>
            <p className="overline" style={{ marginBottom: 10, textAlign: 'left' }}>
              Table code (printed under the QR)
            </p>
            <input
              className="code-input"
              placeholder="e.g. qr_a1b2c3d4"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              autoFocus
              aria-label="Table code"
            />
            <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={go} disabled={!code.trim()}>
              Open menu
            </button>
          </div>
        )}

        <button className="btn btn-ghost" onClick={() => nav(`/scan/${DEMO_TOKEN}`)}>
          Try the demo menu →
        </button>
      </div>

      <p className="dim" style={{ textAlign: 'center', fontSize: 12, paddingBottom: 10 }}>
        Powered by Menutha
      </p>
    </div>
  );
}
