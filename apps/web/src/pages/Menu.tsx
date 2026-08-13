/** Live menu — hero, search, veg filter, category chips, dish grid, item
 *  sheet, sticky cart bar. Subscribes to menu changes (live once menu_item is
 *  in the realtime publication) and refetches on tab refocus as a fallback. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMenu, subscribeMenu } from '../lib/api';
import type { CartLine, MenuItem } from '../lib/types';
import { calcBill, inr } from '../lib/types';
import { useStore } from '../store';
import { IdentityGate, ItemSheet, Spinner, VegMark, Wordmark } from '../components';

export function Menu() {
  const nav = useNavigate();
  const { session, cart, addLine, setGuest } = useStore();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Filters persist while browsing (cart ↔ menu round-trips, reloads).
  const FILTER_KEY = 'menutha-web:filters:' + (session?.restaurant.id ?? '');
  const saved = (() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
  })();
  const [query, setQuery] = useState<string>(saved.query ?? '');
  const [diet, setDiet] = useState<'all' | 'veg' | 'nonveg'>(saved.diet ?? 'all');
  const [activeCat, setActiveCat] = useState<string>(saved.cat ?? 'All');
  useEffect(() => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ query, diet, cat: activeCat })); } catch {}
  }, [query, diet, activeCat]);
  const [open, setOpen] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (!session) {
      nav('/', { replace: true });
      return;
    }
    let alive = true;
    const load = () =>
      fetchMenu(session)
        .then((m) => alive && (setItems(m), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    const unsub = subscribeMenu(session, load);
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      unsub();
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [session?.restaurant.id]);

  const cats = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items ?? []) if (!seen.has(i.category)) seen.set(i.category, i.category_sort);
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (diet === 'all' || (diet === 'veg' ? i.is_veg : !i.is_veg)) &&
        (activeCat === 'All' || i.category === activeCat) &&
        (!q || i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)),
    );
  }, [items, query, diet, activeCat]);

  const grouped = useMemo(() => {
    const g = new Map<string, MenuItem[]>();
    for (const i of visible) {
      if (!g.has(i.category)) g.set(i.category, []);
      g.get(i.category)!.push(i);
    }
    return [...g.entries()];
  }, [visible]);

  if (!session) return null;
  const { restaurant, table } = session;
  const bill = calcBill(cart, 0);
  const count = cart.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="page fade-in" style={{ paddingBottom: count ? 110 : undefined }}>
      <div className="topbar">
        <Wordmark size={22} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!table.is_parcel && (
            <button className="chip" onClick={() => nav('/bill')} aria-label="View the table bill">
              🧾 Table bill
            </button>
          )}
          <span className="badge gold">
            {table.is_parcel ? '📦 Parcel / Takeaway' : `🍽 ${table.label}`}
          </span>
        </div>
      </div>

      <div className="menu-hero">
        {restaurant.banner_url ? (
          <div className="hero-bg" style={{ backgroundImage: `url(${restaurant.banner_url})` }} />
        ) : (
          <div
            className="hero-bg"
            style={{
              background:
                'radial-gradient(120% 130% at 15% 0%, rgba(217,184,115,0.25), transparent 55%), linear-gradient(150deg, #241d12, #0e0c08)',
            }}
          />
        )}
        <div className="hero-scrim" />
        <div className="hero-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot" />
            <span className="overline" style={{ color: 'var(--text-muted)' }}>Live menu</span>
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 36px)', marginTop: 4 }}>
            {restaurant.name}
          </h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {restaurant.city && <span className="badge">{restaurant.city}</span>}
            <span className={restaurant.is_open === false ? 'badge closed' : 'badge open'}>
              {restaurant.is_open === false ? 'Closed now' : 'Open'}
            </span>
            {session.demo && <span className="badge gold">Demo</span>}
          </div>
        </div>
      </div>

      {session.orderingDisabled && (
        <div className="glass" style={{ padding: 14, marginTop: 12, borderColor: 'rgba(197,64,47,0.5)' }}>
          <strong style={{ color: 'var(--error)' }}>View-only menu.</strong>{' '}
          <span className="muted" style={{ fontSize: 14 }}>
            This restaurant isn’t taking online orders right now — please order
            with the staff.
          </span>
        </div>
      )}

      <div className="sticky-tools">
        <div className="search">
          <span aria-hidden>🔍</span>
          <input
            placeholder="Search dishes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search dishes"
          />
        </div>
        <div className="chip-row diet-row" role="group" aria-label="Dietary filter">
          <button
            className={'chip diet-chip diet-all' + (diet === 'all' ? ' active' : '')}
            style={diet === 'all' ? { background: '#e8833a', borderColor: '#e8833a', color: '#fffdf8' } : undefined}
            onClick={() => setDiet('all')}
            aria-pressed={diet === 'all'}
          >
            All
          </button>
          <button
            className={'chip diet-chip diet-veg' + (diet === 'veg' ? ' active' : '')}
            style={diet === 'veg' ? { background: '#e3f1e9', borderColor: '#1b8a3e', color: '#14663d' } : undefined}
            onClick={() => setDiet('veg')}
            aria-pressed={diet === 'veg'}
          >
            <span className="veg-mark" /> Veg
          </button>
          <button
            className={'chip diet-chip diet-nonveg' + (diet === 'nonveg' ? ' active' : '')}
            style={diet === 'nonveg' ? { background: '#f8e3e0', borderColor: '#9b2c24', color: '#9b2c24' } : undefined}
            onClick={() => setDiet('nonveg')}
            aria-pressed={diet === 'nonveg'}
          >
            <span className="veg-mark nonveg" /> Non-veg
          </button>
        </div>
        <div className="chip-row" role="tablist">
          {['All', ...cats].map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={activeCat === c}
              className={activeCat === c ? 'chip active' : 'chip'}
              onClick={() => setActiveCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {items === null && !failed && <Spinner label="Fetching the live menu…" />}
      {failed && (
        <div className="center-fill">
          <h2 className="display" style={{ fontSize: 22 }}>Couldn’t load the menu</h2>
          <p className="muted">Check your connection, then try again.</p>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
      {items !== null && !failed && visible.length === 0 && (
        <div className="center-fill">
          <p className="muted">No dishes match — try clearing the search or filters.</p>
        </div>
      )}

      {grouped.map(([cat, dishes]) => (
        <section key={cat}>
          <h2 className="cat-heading">{cat}</h2>
          <div className="menu-grid">
            {dishes.map((d) => (
              <button
                key={d.id}
                className="dish glass"
                onClick={() => !session.orderingDisabled && setOpen(d)}
              >
                {d.photo_url ? (
                  <img className="dish-photo" src={d.photo_url} alt="" loading="lazy" />
                ) : (
                  <span className="dish-photo placeholder" aria-hidden>🍛</span>
                )}
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <VegMark veg={d.is_veg} />
                    <h3>{d.name}</h3>
                  </span>
                  {d.description && <span className="desc">{d.description}</span>}
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="price">{inr(d.price)}</span>
                    {!session.orderingDisabled && (
                      <span className="add-hint">{d.options.length ? 'Customise +' : 'Add +'}</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <ItemSheet
          item={open}
          onClose={() => setOpen(null)}
          onAdd={(line: CartLine) => addLine(line)}
        />
      )}

      {/* First-open identity gate — capture the diner once so orders + bill
          stay attributed. Skipped for demo and view-only (no ordering). */}
      {!session.demo && !session.orderingDisabled && !session.guest && (
        <IdentityGate
          restaurantName={restaurant.name}
          tableLabel={table.is_parcel ? undefined : table.label}
          onSubmit={(g) => setGuest(g)}
        />
      )}

      {count > 0 && !session.orderingDisabled && (
        <div className="cartbar-wrap">
          <button className="cartbar" onClick={() => nav('/cart')}>
            <span style={{ fontWeight: 700 }}>
              {count} item{count > 1 ? 's' : ''} · {inr(bill.subtotal)}
            </span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>View cart →</span>
          </button>
        </div>
      )}
    </div>
  );
}
