/** Browse & search all listed restaurants (the second entry path besides the
 *  table QR). Picking one starts a Parcel/Takeaway session via the venue's
 *  dedicated parcel point, so ordering works without a table. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchRestaurants, startParcelSession } from '../lib/api';
import { demoRestaurant, directoryFallback } from '../lib/demo';
import type { Restaurant } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';

export function Restaurants() {
  const nav = useNavigate();
  const { startSession } = useStore();
  const [list, setList] = useState<Restaurant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchRestaurants()
      .then((r) => alive && setList(r))
      .catch(() => alive && (setFailed(true), setList([])));
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Live DB rows first; then any fallback listings not already present by name
    // (keeps the pilot restaurant discoverable when the directory is unreachable).
    const live = list ?? [];
    const liveNames = new Set(live.map((r) => r.name.trim().toLowerCase()));
    const fallback = directoryFallback.filter((r) => !liveNames.has(r.name.trim().toLowerCase()));
    const all = [...live, ...fallback];
    return q
      ? all.filter(
          (r) => r.name.toLowerCase().includes(q) || (r.city ?? '').toLowerCase().includes(q),
        )
      : all;
  }, [list, query]);

  const open = async (r: Restaurant) => {
    if (openingId) return;
    setOpeningId(r.id);
    setError('');
    try {
      const session = await startParcelSession(r);
      startSession(session);
      nav('/menu');
    } catch (e: any) {
      setError(e?.message ?? 'Could not open this restaurant — please try again.');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/')}>← Back</button>
        <Wordmark size={20} />
      </div>

      <p className="overline" style={{ marginTop: 12 }}>Browse & order takeaway</p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>Restaurants on Menutha</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
        Search every listed restaurant. At the venue? Scanning the table QR is even faster.
      </p>

      <div className="search">
        <span aria-hidden>🔍</span>
        <input
          placeholder="Search by name or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search restaurants"
        />
      </div>

      {failed && (
        <p className="dim" style={{ fontSize: 13, margin: '4px 0 10px' }}>
          Live listings couldn’t be reached — the demo restaurant below still works.
        </p>
      )}
      {error && <p style={{ color: 'var(--error)', fontSize: 14, margin: '4px 0 10px' }}>{error}</p>}

      {list === null ? (
        <Spinner label="Finding restaurants…" />
      ) : visible.length === 0 ? (
        <div className="center-fill">
          <p className="muted">No restaurants match “{query}”.</p>
        </div>
      ) : (
        <div className="menu-grid" style={{ marginTop: 8 }}>
          {visible.map((r) => (
            <button
              key={r.id}
              className="rest-card glass"
              onClick={() => open(r)}
              disabled={!!openingId}
            >
              {r.logo_url ? (
                <img className="rest-logo" src={r.logo_url} alt="" loading="lazy" />
              ) : (
                <span className="rest-logo" aria-hidden>{r.name.charAt(0)}</span>
              )}
              <span style={{ flex: 1 }}>
                <h3>{r.name}</h3>
                <span className="muted" style={{ fontSize: 13 }}>
                  {r.city || 'India'}
                  {r.id === demoRestaurant.id ? ' · Demo' : ''}
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span className={r.is_open === false ? 'badge closed' : 'badge open'}>
                  {r.is_open === false ? 'Closed' : 'Open'}
                </span>
                <span className="dim" style={{ fontSize: 12, fontWeight: 700 }}>
                  {openingId === r.id ? 'Opening…' : 'Order →'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
