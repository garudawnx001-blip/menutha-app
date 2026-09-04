/**
 * /table — WHERE A DINER WITHOUT A SESSION LANDS. Nothing else.
 *
 * THE BUG THIS EXISTS TO CLOSE. Menu, Cart and Bill each did
 * `nav('/', { replace: true })` when the session was gone. Inside the SPA that
 * renders the diner Landing, which is harmless — but it also REWRITES THE URL
 * TO `/`, and `/` on the deployed site is not the SPA at all. The deploy sets
 * dist/index.html := the marketing landing (see the workflow), so the next
 * reload, back-gesture or share of that URL puts a DINER on the restaurant
 * marketing page, complete with LOGIN and SIGNUP for restaurant accounts.
 *
 * A diner losing their session is not exotic: a private tab expiring, storage
 * cleared, a link forwarded to a friend, or simply opening /menu directly. The
 * requirement is that the fallback lands on the menu or a clean identify
 * prompt and NEVER on a restaurant login, so the fallback gets its own route
 * that is a real SPA path — reloading it stays here.
 *
 * WHAT IS DELIBERATELY NOT ON THIS PAGE: any link to /partner, to the
 * marketing site, to pricing, or to "for restaurants". A diner at a table has
 * no business being offered a restaurant account, and every extra door is a
 * door they can walk through by accident.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '../components';
import { useT } from '../lib/i18n';

export function TableGate() {
  const nav = useNavigate();
  const t = useT();
  const [code, setCode] = useState('');

  /** Accepts a bare token or a whole pasted QR link, in either printed shape:
   *  /scan/<token> and /scan.html?t=<token> have both been on table cards, and
   *  a diner typing what they see should not have to know which. */
  const go = () => {
    const raw = code.trim();
    if (!raw) return;
    const token = raw
      .replace(/^.*[?&]t=/, '')
      .replace(/^.*\/scan\//, '')
      .replace(/[?#].*$/, '')
      .trim();
    if (token) nav(`/scan/${encodeURIComponent(token)}`, { replace: true });
  };

  return (
    <div className="page center-fill fade-in" style={{ gap: 14 }}>
      <Wordmark size={26} />
      <h1 className="display" style={{ fontSize: 26, maxWidth: 420 }}>
        {t('tablegate.title')}
      </h1>
      <p className="muted" style={{ maxWidth: 400, fontSize: 15 }}>
        {t('tablegate.body')}
      </p>

      <div className="glass" style={{ width: '100%', maxWidth: 420, padding: 18 }}>
        <p className="overline" style={{ marginBottom: 10, textAlign: 'left' }}>
          {t('tablegate.codeLabel')}
        </p>
        <input
          className="code-input"
          placeholder="e.g. qr_a1b2c3d4"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          aria-label={t('tablegate.codeLabel')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          onClick={go}
          disabled={!code.trim()}
        >
          {t('tablegate.open')}
        </button>
      </div>
    </div>
  );
}
