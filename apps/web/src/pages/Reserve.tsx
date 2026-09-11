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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { createReservation } from '../lib/api';
import { Wordmark } from '../components';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';

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

  /**
   * WHEN THE RESTAURANT IS ACTUALLY OPEN.
   *
   * The time field was a bare <input type="time">, so a diner could book a
   * table for 3am and the restaurant would find the booking in the morning
   * with nobody to honour it. Availability is not a new feature here -- the
   * hours already exist on the restaurant and the owner already edits them --
   * the reservation form simply never asked for them.
   *
   * FETCHED SEPARATELY rather than added to resolveToken's select, and that is
   * deliberate. resolveToken is the scan path: PostgREST 400s on a column it
   * does not know, so widening that select is how one missing column takes out
   * every QR in the restaurant. This query can fail harmlessly -- the field
   * just goes back to being unconstrained, which is where it started.
   */
  const [hours, setHours] = useState<{ open: string; close: string } | null>(null);
  useEffect(() => {
    if (!session?.restaurant.id) return;
    let alive = true;
    supabase
      .from('restaurant')
      .select('open_time, close_time')
      .eq('id', session.restaurant.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data?.open_time || !data?.close_time) return;
        setHours({ open: String(data.open_time).slice(0, 5), close: String(data.close_time).slice(0, 5) });
      }, () => {});
    return () => { alive = false; };
  }, [session?.restaurant.id]);

  /** Overnight venues close after midnight, so "close < open" is a real and
   *  common case rather than bad data -- and a min/max pair cannot express it.
   *  Those keep the free field and are checked on submit instead. */
  const sameDayHours = hours && hours.open < hours.close ? hours : null;

  useEffect(() => {
    if (!session) nav('/table', { replace: true });
  }, [session]);

  if (!session) return null;
  const { restaurant } = session;

  const phoneDigits = phone.replace(/\D/g, '');
  const canSend = !!date && name.trim().length > 1 && phoneDigits.length >= 10 && !busy;

  /** Same window as the cart's: `canSend` folds in `!busy`, which is state.
   *  create_reservation has no idempotency, so two clicks are two bookings. */
  const sendingRef = useRef(false);

  const send = async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    // The slug rides along on the scan session for exactly this call; without
    // it there is no way to reach the RPC from a scanned table.
    const slug = restaurant.slug;
    if (!slug) { sendingRef.current = false; setError(t('reserve.unavailable')); return; }
    /* THE REAL GUARD. min/max on a time input is advisory -- several mobile
       browsers ignore it outright -- so the check that actually decides is
       here. Same-day hours only: an overnight venue (close < open) spans
       midnight and a simple between-test would reject its whole service. */
    if (sameDayHours && (time < sameDayHours.open || time > sameDayHours.close)) {
      sendingRef.current = false;
      setError(t('reserve.outsideHours')
        .replace('{open}', sameDayHours.open)
        .replace('{close}', sameDayHours.close));
      return;
    }
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
      sendingRef.current = false;
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
        <button className="btn btn-ghost" onClick={() => nav('/menu')}>{t('common.back')}</button>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <div className="topbar">
        <Wordmark size={24} />
        <button className="chip" onClick={() => nav('/menu')}>← {t('common.back')}</button>
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
              <input
                className="code-input" type="time" value={time}
                min={sameDayHours?.open} max={sameDayHours?.close}
                onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          {/* SAYING the hours, not only enforcing them. min/max on a time input
              is silently ignored by some mobile browsers, and even where it is
              honoured the diner is told nothing about WHY their choice snapped
              back. One line removes both problems. */}
          {hours && (
            <p className="dim" style={{ fontSize: 12.5, marginTop: -6 }}>
              {t('reserve.hours').replace('{open}', hours.open).replace('{close}', hours.close)}
            </p>
          )}

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
