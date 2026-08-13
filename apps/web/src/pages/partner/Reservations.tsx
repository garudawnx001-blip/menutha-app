/** Reservation requests — view + manage (Confirmed / Seated / No-show). */
import React, { useEffect, useState } from 'react';
import { fetchReservations, setReservationStatus, type Reservation } from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

export function Reservations() {
  const { restaurant } = usePartner();
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [error, setError] = useState('');

  const load = () => fetchReservations(restaurant.id).then(setRows).catch((e) => { setError(e.message); setRows([]); });
  useEffect(() => { load(); }, [restaurant.id]);

  if (rows === null) return <Spinner label="Loading reservations…" />;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Reservations</p>
      <h1 className="display" style={{ fontSize: 26 }}>{rows.length ? `${rows.length} upcoming` : 'No upcoming reservations'}</h1>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
        Reservation-only — no pre-orders, no refunds. Diners book from your page.
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, margin: '10px 0' }}>{error}</p>}

      <div className="glass" style={{ padding: '4px 16px', marginTop: 12 }}>
        {rows.length === 0 && <p className="muted" style={{ padding: '16px 0' }}>New booking requests will appear here.</p>}
        {rows.map((r) => (
          <div key={r.id} className="row-item">
            <span>
              <strong style={{ fontSize: 14.5 }}>
                {new Date(r.booked_for).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </strong>
              <span className="muted" style={{ fontSize: 13.5 }}> · party of {r.party_size}</span>
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              {(['confirmed', 'seated', 'no_show'] as const).map((s) => (
                <button key={s} className={r.status === s ? 'chip active' : 'chip'}
                  onClick={async () => { await setReservationStatus(r.id, s); load(); }}>
                  {s === 'no_show' ? 'No-show' : s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
