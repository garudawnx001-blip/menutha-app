/**
 * /reserve — booking a table from the diner app. #P.
 *
 * The same create_reservation RPC the public restaurant page books through, so
 * a reservation made from a scanned table and one made from the web listing are
 * the same row, with the same server-side validation, landing in the same
 * partner Bookings list with name, phone and party size on it.
 *
 * NAME AND PHONE ARE REQUIRED, and not as a formality: a booking nobody can
 * ring is a booking staff cannot confirm and cannot chase when the table is
 * held and empty. The RPC enforces it too — this only says so before the round
 * trip, so the diner is corrected by the form rather than by an error.
 *
 * Inside the locked diner scope (#O): no account, no partner link.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { createReservation } from '../lib/api';
import { Wordmark } from '../components';
import { useT } from '../lib/i18n';

/** Local date, not toISOString().slice(0,10). ISO is UTC, so after 5:30am IST
 *  it names yesterday — a diner in Hospet would be offered a date already
 *  gone and the RPC would reject it as being in the past. */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function Reserve() {
  const nav = useNavigate();
  const { session } = useStore();
  const t = useT();

  const today = useMemo(() => localDate(new Date()), []);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('19:30');
  const [party, setParty] = useState(2);
  const [name, setName] = useState(session?.guest?.name ?? '');
  const [phone, setPhone] = useState(session?.guest?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!session) nav('/table', { replace: true });
  }, [session]);

  if (!session) return null;
  const { restaurant } = session;

  const phoneDigits = phone.replace(/\D/g, '');
  const canSend = !!date && name.trim().length > 1 && phoneDigits.length >= 10 && !busy;

  const send = async () => {
    if (!canSend) return;
    // The slug rides along on the scan session for exactly this call; without
    // it there is no way to reach the RPC from a scanned table.
    const slug = restaurant.slug;
    if (!slug) { setError(t('reserve.unavailable')); return; }
    setBusy(true); setError('');
    try {
      await createReservation({
        slug,
        partySize: party,
        bookedFor: new Date(`${date}T${time}:00`),
        name,
        phone,
      });
      setDone(true);
    } catch (e: any) {
      // The RPC's own words where it has them — it validates the window, the
      // party size and the date, and its message is more useful than ours.
      setError(e?.message ?? t('reserve.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="page center-fill fade-in" style={{ gap: 12 }}>
        <Wordmark size={24} />
        <h1 className="display" style={{ fontSize: 26 }}>{t('reserve.doneTitle')}</h1>
        <p className="muted" style={{ maxWidth: 400 }}>
          {t('reserve.doneBody').replace('{name}', restaurant.name).replace('{phone}', phone)}
        </p>
        <button className="btn btn-primary" onClick={() => nav('/menu')}>{t('start.menu')}</button>
        <button className="btn btn-ghost" onClick={() => nav('/start')}>{t('common.back')}</button>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <div className="topbar">
        <Wordmark size={24} />
        <button className="chip" onClick={() => nav('/start')}>← {t('common.back')}</button>
      </div>

      <div className="center-fill" style={{ gap: 12 }}>
        <p className="overline">{restaurant.name}</p>
        <h1 className="display" style={{ fontSize: 26 }}>{t('reserve.title')}</h1>

        <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 150px' }}>
              <span className="overline">{t('reserve.date')}</span>
              <input className="code-input" type="date" value={date} min={today}
                onChange={(e) => setDate(e.target.value)} />
            </label>
            <label style={{ flex: '1 1 110px' }}>
              <span className="overline">{t('reserve.time')}</span>
              <input className="code-input" type="time" value={time}
                onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>

          <label>
            <span className="overline">{t('reserve.party')}</span>
            {/* A select, not a free number: the RPC caps party size at 40 and a
                typed 400 would be rejected after the round trip instead of
                being impossible to enter. */}
            <select className="code-input" value={party} onChange={(e) => setParty(Number(e.target.value))}>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          <label>
            <span className="overline">{t('reserve.name')}</span>
            <input className="code-input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('reserve.namePh')} autoComplete="name" />
          </label>

          <label>
            <span className="overline">{t('reserve.phone')}</span>
            <input className="code-input" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder={t('reserve.phonePh')} inputMode="tel" autoComplete="tel" />
          </label>

          {error && <p style={{ color: 'var(--error)', fontSize: 13.5 }}>{error}</p>}

          <button className="btn btn-primary btn-block" disabled={!canSend} onClick={send}>
            {busy ? t('reserve.sending') : t('reserve.send')}
          </button>
          <p className="muted" style={{ fontSize: 12 }}>{t('reserve.note')}</p>
        </div>
      </div>
    </div>
  );
}
