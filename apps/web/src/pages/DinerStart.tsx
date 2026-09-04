/**
 * /start — THE THREE DOORS. #P.
 *
 * Scanning a table QR used to go straight to the menu. That is the right guess
 * for a seated diner about to order, and it is only a guess: the same QR is
 * also how someone asks about the buffet, and how someone books a table for
 * Saturday. Two of the three things this restaurant sells were unreachable
 * from the one link printed on the table.
 *
 * So the scan lands here and the diner picks. Menu is first and visually
 * primary because it IS the common case — ordering stays one obvious tap, not
 * a hunt — but the other two are now doors rather than features nobody could
 * find.
 *
 * INSIDE THE LOCKED SCOPE (#O). No /partner link, no marketing link, no
 * account of any kind. A diner at a table is not signing up for anything.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { fetchDinerBuffets } from '../lib/api';
import { Wordmark } from '../components';
import { useT, translateTableLabel } from '../lib/i18n';

export function DinerStart() {
  const nav = useNavigate();
  const { session } = useStore();
  const t = useT();
  /** null = still counting. Drives only the buffet card's subtitle, so the
   *  page renders immediately and does not wait on this. */
  const [buffetCount, setBuffetCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session) {
      // Same rule as every other diner page: the gate, never '/'. See TableGate.
      nav('/table', { replace: true });
      return;
    }
    let alive = true;
    fetchDinerBuffets(session.restaurant.id)
      .then((b) => alive && setBuffetCount(b.length))
      .catch(() => alive && setBuffetCount(0));
    return () => { alive = false; };
  }, [session?.restaurant.id]);

  if (!session) return null;
  const { restaurant, table } = session;

  return (
    <div className="page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={24} />
        {!table.is_parcel && (
          <span className="badge">🍽 {translateTableLabel(table.label, t)}</span>
        )}
      </div>

      <div className="center-fill" style={{ gap: 16 }}>
        <p className="overline">{restaurant.city ?? ''}</p>
        <h1 className="display" style={{ fontSize: 'clamp(24px, 5.5vw, 34px)', maxWidth: 520 }}>
          {restaurant.name}
        </h1>
        <p className="muted" style={{ maxWidth: 420, fontSize: 15 }}>
          {t('start.body')}
        </p>

        <div className="option-grid">
          {/* MENU FIRST. It is what most people scanning a table QR want, and
              putting it anywhere but first would tax the common case to
              advertise the other two. */}
          <button className="option-card glass" onClick={() => nav('/menu')}>
            <span className="icon" aria-hidden>🍽</span>
            <h3>{t('start.menu')}</h3>
            <p>{t('start.menuBody')}</p>
            <span className="go">{t('start.menuGo')}</span>
          </button>

          <button className="option-card glass" onClick={() => nav('/reserve')}>
            <span className="icon" aria-hidden>📅</span>
            <h3>{t('start.reserve')}</h3>
            <p>{t('start.reserveBody')}</p>
            <span className="go">{t('start.reserveGo')}</span>
          </button>

          {/* The buffet card says how many there are rather than promising one
              and then showing an empty page. Zero is a real answer and the card
              still opens -- the page explains there is nothing on today, which
              is information a diner asked for. */}
          <button className="option-card glass" onClick={() => nav('/buffet')}>
            <span className="icon" aria-hidden>🍲</span>
            <h3>{t('start.buffet')}</h3>
            <p>
              {buffetCount === null
                ? t('start.buffetBody')
                : buffetCount === 0
                  ? t('start.buffetNone')
                  : t('start.buffetCount').replace('{n}', String(buffetCount))}
            </p>
            <span className="go">{t('start.buffetGo')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
