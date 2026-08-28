/** Live menu — hero, search, veg filter, category chips, dish grid, item
 *  sheet, per-item ordering with a grace window. Subscribes to menu changes
 *  (live once menu_item is in the realtime publication) and refetches on tab
 *  refocus as a fallback. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchMenu, subscribeMenu, placeOrder,
  fetchMyOpenOrders, updateMyOrderItem, type OpenOrder,
} from '../lib/api';
import type { CartLine, MenuItem } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { IdentityGate, ItemSheet, LanguagePicker, SendingIn, Spinner, Stepper, VegMark, Wordmark } from '../components';
import { useT, translateCategory } from '../lib/i18n';
import { TableSoFar } from './TableSoFar';

export function Menu() {
  const nav = useNavigate();
  const { session, setGuest } = useStore();
  const t = useT();
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
  const [toast, setToast] = useState('');

  // ── Ordering without a cart ───────────────────────────────────────────────
  // Each dish is ordered on its own the moment it is tapped, so nothing is left
  // sitting in a basket the diner forgets to submit. What used to be the cart's
  // job — changing your mind — is the grace window instead: for the first
  // minute an order has not reached the kitchen yet, so the "Add" button turns
  // into a stepper wired to the real order row. Once the window closes the
  // stepper reverts to "Order", and ordering again is correct: the kitchen
  // already has the first one.
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  // A SET, not one id. Ordering dish by dish means tapping three in quick
  // succession is the normal case, not an edge case — a single in-flight id
  // would have greyed out every other button while the first order was in
  // flight, which is exactly the flow this change exists to enable. Only a
  // second tap on the SAME dish is suppressed, so nothing is ordered twice.
  const [placing, setPlacing] = useState<Set<string>>(new Set());

  const refreshOpen = React.useCallback(() => {
    if (!session || session.demo) return Promise.resolve();
    return fetchMyOpenOrders(session).then(setOpenOrders).catch(() => {});
  }, [session?.table.id, session?.guest?.phone]);

  useEffect(() => {
    refreshOpen();
    const id = setInterval(refreshOpen, 6000);
    return () => clearInterval(id);
  }, [refreshOpen]);

  /** menu_item_id → the still-editable order line for it. Later orders win, so
   *  the stepper always drives the one whose window is open longest. */
  const liveLines = useMemo(() => {
    const m = new Map<string, { orderId: string; itemId: string; qty: number }>();
    for (const o of openOrders) {
      if (!o.editable) continue;
      for (const it of o.items ?? []) {
        if (it.menu_item_id) m.set(it.menu_item_id, { orderId: o.id, itemId: it.id, qty: it.qty });
      }
    }
    return m;
  }, [openOrders]);

  const flash = (msg: string, ms = 1600) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), ms);
  };

  const orderNow = async (line: CartLine, label: string) => {
    if (!session || placing.has(line.menuItemId)) return;
    setPlacing((p) => new Set(p).add(line.menuItemId));
    try {
      await placeOrder(session, [line]);
      flash(`${label} ${t('menu.ordered')}`);
      await refreshOpen();
    } catch (e: any) {
      flash(e?.message ?? t('menu.orderFailed'), 3200);
    } finally {
      setPlacing((p) => { const n = new Set(p); n.delete(line.menuItemId); return n; });
    }
  };

  /** Change a quantity on an order that has not reached the kitchen yet.
   *  Optimistic, then reconciled — if the window closed a moment ago the server
   *  refuses and the refresh puts the button back to "Order". */
  const changeQty = async (l: { orderId: string; itemId: string }, qty: number) => {
    setOpenOrders((prev) => prev.map((o) => (o.id !== l.orderId ? o : {
      ...o, items: o.items.map((it) => (it.id === l.itemId ? { ...it, qty } : it)),
    })));
    try { await updateMyOrderItem(l.orderId, l.itemId, qty); }
    catch (e: any) { flash(e?.message ?? t('menu.alreadySent'), 3200); }
    finally { await refreshOpen(); }
  };

  // The menu is the session root: a diner reaches it when /scan/<token>
  // replaced its own history entry, so a browser Back would otherwise land on a
  // dead/blank page (or bounce through the scan redirect). Re-anchor Back to the
  // menu — the table's home — instead of leaving the app.
  useEffect(() => {
    window.history.pushState(null, document.title, window.location.href);
    const onPop = () => window.history.pushState(null, document.title, window.location.href);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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

  /** Sections in the order the restaurant arranged their categories.
   *
   *  A Map keeps insertion order, and dishes arrive sorted by menu_item
   *  sort_order — so sections used to appear in whatever order their first
   *  dish happened to fall in. Dragging categories in the portal reordered the
   *  chips and nothing else, which is not what "arrange your menu" means:
   *  Starters have to come before Desserts on the page a diner scrolls, not
   *  only in the filter row. Sorted by the category's own sort_order, with the
   *  dish order inside each section left alone. */
  const grouped = useMemo(() => {
    const g = new Map<string, { sort: number; items: MenuItem[] }>();
    for (const i of visible) {
      if (!g.has(i.category)) g.set(i.category, { sort: i.category_sort ?? 99, items: [] });
      g.get(i.category)!.items.push(i);
    }
    return [...g.entries()]
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([cat, v]) => [cat, v.items] as [string, MenuItem[]]);
  }, [visible]);

  if (!session) return null;
  const { restaurant, table } = session;
  // Anything still inside its window: the one thing the diner may still undo.
  const pending = openOrders.filter((o) => o.editable);
  const pendingTotal = pending.reduce((a, o) => a + Number(o.total || 0), 0);

  return (
    <div className="page fade-in" style={{ paddingBottom: pending.length ? 110 : undefined }}>
      <div className="topbar">
        <Wordmark size={22} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LanguagePicker />
          {!table.is_parcel && (
            <button className="chip" onClick={() => nav('/bill')} aria-label={t('menu.bill')}>
              🧾 {t('menu.bill')}
            </button>
          )}
          <span className="badge gold">
            {table.is_parcel ? '📦 ' + t('menu.parcel') : `🍽 ${table.label}`}
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
            <span className="overline" style={{ color: 'var(--text-muted)' }}>{t('menu.liveMenu')}</span>
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
          <strong style={{ color: 'var(--error)' }}>{t('menu.viewOnly')}</strong>{' '}
          <span className="muted" style={{ fontSize: 14 }}>
            {t('menu.orderingOffBody')}
          </span>
        </div>
      )}

      <div className="sticky-tools">
        <div className="search">
          <span aria-hidden>🔍</span>
          <input
            placeholder={t("menu.search") + "…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("menu.search")}
          />
        </div>
        <div className="chip-row diet-row" role="group" aria-label={t('menu.dietFilter')}>
          <button
            className={'chip diet-chip diet-all' + (diet === 'all' ? ' active' : '')}
            style={diet === 'all' ? { background: '#e8833a', borderColor: '#e8833a', color: '#fffdf8' } : undefined}
            onClick={() => setDiet('all')}
            aria-pressed={diet === 'all'}
          >
            {t('menu.all')}
          </button>
          <button
            className={'chip diet-chip diet-veg' + (diet === 'veg' ? ' active' : '')}
            style={diet === 'veg' ? { background: '#e3f1e9', borderColor: '#1b8a3e', color: '#14663d' } : undefined}
            onClick={() => setDiet('veg')}
            aria-pressed={diet === 'veg'}
          >
            <span className="veg-mark" /> {t('menu.veg')}
          </button>
          <button
            className={'chip diet-chip diet-nonveg' + (diet === 'nonveg' ? ' active' : '')}
            style={diet === 'nonveg' ? { background: '#f8e3e0', borderColor: '#9b2c24', color: '#9b2c24' } : undefined}
            onClick={() => setDiet('nonveg')}
            aria-pressed={diet === 'nonveg'}
          >
            <span className="veg-mark nonveg" /> {t('menu.nonveg')}
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
              {/* "All" is ours. Every other chip is the restaurant's category
                  name — rendered in the diner's language when it is one of the
                  common section names, and exactly as typed when it is not. */}
              {c === 'All' ? t('menu.all') : translateCategory(c)}
            </button>
          ))}
        </div>
      </div>

      {/* What the table has already ordered — on the menu itself, because
          leaving to the bill screen to check is what caused double-ordering. */}
      {!session.demo && !session.table.is_parcel && <TableSoFar session={session} />}

      {items === null && !failed && <Spinner label={t('menu.loading')} />}
      {failed && (
        <div className="center-fill">
          <h2 className="display" style={{ fontSize: 22 }}>{t('menu.loadFail')}</h2>
          <p className="muted">{t('menu.loadFailBody')}</p>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>{t('common.retry')}</button>
        </div>
      )}
      {items !== null && !failed && visible.length === 0 && (
        <div className="center-fill">
          <p className="muted">{t('menu.none')}</p>
        </div>
      )}

      {grouped.map(([cat, dishes]) => (
        <section key={cat}>
          <h2 className="cat-heading">{translateCategory(cat)}</h2>
          <div className="menu-grid">
            {dishes.map((d) => {
              // One tap orders the dish outright — no cart, nothing to submit
              // afterwards. While the order is still inside its grace window
              // the button becomes a stepper on the real order line, so
              // changing your mind works exactly as a cart used to.
              // Dishes with options still open the sheet — a choice has to be made.
              const live = liveLines.get(d.id);
              const qty = live?.qty ?? 0;
              const quickOrder = () => orderNow({
                menuItemId: d.id, name: d.name, price: d.price, qty: 1,
                isVeg: d.is_veg, optionIds: [], optionLabels: [], optionDelta: 0,
              }, d.name);
              return (
                <div
                  key={d.id}
                  className="dish glass"
                  role="button"
                  tabIndex={0}
                  onClick={() => !session.orderingDisabled && setOpen(d)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!session.orderingDisabled) setOpen(d);
                    }
                  }}
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
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span className="price">{inr(d.price)}</span>
                      {!session.orderingDisabled && (
                        <span onClick={(e) => e.stopPropagation()}>
                          {d.options.length ? (
                            <button className="add-btn" onClick={() => setOpen(d)}>
                              {t('menu.choose')}
                            </button>
                          ) : live && qty > 0 ? (
                            <Stepper qty={qty} onChange={(q) => changeQty(live, q)} />
                          ) : (
                            <button
                              className="add-btn"
                              onClick={quickOrder}
                              disabled={placing.has(d.id)}
                              aria-label={`Order ${d.name}`}
                            >
                              {placing.has(d.id) ? "…" : t("menu.add")}
                            </button>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {open && (
        <ItemSheet
          item={open}
          onClose={() => setOpen(null)}
          onAdd={(line: CartLine) => {
            // The sheet exists to settle a choice, so confirming it places the
            // order there and then — same as a one-tap dish.
            setOpen(null);
            orderNow(line, `${line.qty} × ${line.name}`);
          }}
        />
      )}

      {toast && <div className="cart-toast" role="status">{toast}</div>}

      {/* First-open identity gate — capture the diner once so orders + bill
          stay attributed. Skipped for demo and view-only (no ordering). */}
      {!session.demo && !session.orderingDisabled && !session.guest && (
        <IdentityGate
          restaurantName={restaurant.name}
          tableLabel={table.is_parcel ? undefined : table.label}
          onSubmit={(g) => setGuest(g)}
        />
      )}

      {/* Not a cart — these orders are already placed. The bar exists so the
          diner can see the window closing and reach the undo controls before
          the kitchen gets them. */}
      {pending.length > 0 && !session.orderingDisabled && (
        <div className="cartbar-wrap">
          <button className="cartbar pending-bar" onClick={() => nav('/bill')}>
            <span style={{ fontWeight: 700 }}>
              {pending.length} order{pending.length > 1 ? 's' : ''} · {inr(pendingTotal)}
            </span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              <SendingIn until={pending[0].released_at} label={t('menu.sendingIn')} sentLabel={t('menu.withKitchen')} /> →
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
