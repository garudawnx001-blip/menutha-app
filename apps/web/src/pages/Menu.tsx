/** Live menu — hero, search, veg filter, category chips, dish grid, item
 *  sheet, per-item ordering with a grace window. Subscribes to menu changes
 *  (live once menu_item is in the realtime publication) and refetches on tab
 *  refocus as a fallback. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchMenu, subscribeMenu, placeOrder,
  fetchMyOpenOrders, updateMyOrderItem, fetchDinerBuffets, fetchAreaPrices, identifyVisit,
  VisitExpired, type OpenOrder,
} from '../lib/api';
import { useSeatingWatch } from '../lib/useSeatingWatch';
import type { CartLine, MenuItem } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { IdentityGate, ItemSheet, LanguagePicker, Spinner, Stepper, VegMark, Wordmark } from '../components';
import { useT, useLang, translateCategory, translateTableLabel } from '../lib/i18n';
import { dietAvailability, effectiveDiet, matchesDiet, categoriesWithItems } from '../lib/menuFilters';
import { dishName } from '../lib/translit';
import { TableSoFar } from './TableSoFar';
import { CallService, canCallService } from './CallService';
import { startPoll } from '../lib/poll';

export function Menu() {
  const nav = useNavigate();
  const { session, setGuest, noteOrdered, endSeating } = useStore();
  useSeatingWatch();
  /** Phase 3: the menu opens at once. Name and number are asked only when the
   *  diner places their first order; the dish they tapped is held here. */
  const [askWho, setAskWho] = useState<null | { line: CartLine; label: string }>(null);
  /** Area price list (e.g. AC hall prices), dish id -> price. */
  const [areaPrices, setAreaPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!session || session.demo) return;
    let alive = true;
    fetchAreaPrices(session).then((p) => alive && setAreaPrices(p)).catch(() => {});
    return () => { alive = false; };
  }, [session?.visit]);
  const t = useT();
  const lang = useLang();
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
  /** The service sheet, opened from the chip in the filter row below. */
  const [svcOpen, setSvcOpen] = useState(false);
  /**
   * Whether this restaurant has a buffet on today.
   *
   * ASKED, rather than assumed, because the chip must not be a dead end -- his
   * standing rule, and the reason the door page's buffet card used to carry a
   * count. A Buffet chip that opens a page saying "there is no buffet on today"
   * is a button that goes nowhere. Null until the answer arrives, so the chip
   * appears when it is real rather than flickering in and out.
   */
  const [hasBuffet, setHasBuffet] = useState(false);
  useEffect(() => {
    if (!session || session.demo) return;
    let alive = true;
    fetchDinerBuffets(session.restaurant.id)
      .then((b) => { if (alive) setHasBuffet(b.length > 0); })
      .catch(() => { /* no chip rather than a broken one */ });
    return () => { alive = false; };
  }, [session?.restaurant.id]);

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
    const id = startPoll(refreshOpen, 6000);
    return () => id.stop();
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
    if (!session.demo && (session.visitEnded || !session.visit)) {
      flash(t('visit.ended'), 3600);
      return;
    }
    if (!session.guest && !session.demo) { setAskWho({ line, label }); return; }
    setPlacing((p) => new Set(p).add(line.menuItemId));
    try {
      const r = await placeOrder(session, [line]);
      // #Q -- see Cart. One-tap reorder counts as ordering just as much.
      noteOrdered();
      flash(`${label} ${r.needs_confirm ? t('menu.waitConfirm') : t('menu.ordered')}`, r.needs_confirm ? 3600 : 1600);
      await refreshOpen();
    } catch (e: any) {
      if (e instanceof VisitExpired) { endSeating(); flash(t('visit.ended'), 3600); }
      else flash(e?.message ?? t('menu.orderFailed'), 3200);
    } finally {
      setPlacing((p) => { const n = new Set(p); n.delete(line.menuItemId); return n; });
    }
  };

  const orderNowAs = async (s2: NonNullable<typeof session>, line: CartLine, label: string) => {
    setPlacing((p) => new Set(p).add(line.menuItemId));
    try {
      const r = await placeOrder(s2, [line]);
      noteOrdered();
      flash(`${label} ${r.needs_confirm ? t('menu.waitConfirm') : t('menu.ordered')}`, r.needs_confirm ? 3600 : 1600);
      await refreshOpen();
    } catch (e: any) {
      if (e instanceof VisitExpired) { endSeating(); flash(t('visit.ended'), 3600); }
      else flash(e?.message ?? t('menu.orderFailed'), 3200);
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
    try { await updateMyOrderItem(session!, l.orderId, l.itemId, qty); }
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
      // /table, not / -- see TableGate.  is the MARKETING landing on the
      // deployed site, so sending a diner there and rewriting their URL to it
      // means one reload puts them on a restaurant login page.
      // /table, not '/'. On the deployed site the site root is the MARKETING
      // landing, not this app — so sending a session-less diner there and
      // rewriting their URL to it means one reload puts them on a page with a
      // restaurant LOGIN and SIGNUP on it. #O: a diner must never see that.
      nav('/table', { replace: true });
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


  /**
   * #Q — SETTLEMENT LOGS THE DINER OUT OF THIS SEATING.
   *
   * When staff close the table's bill, the next person to scan that QR must be
   * asked who they are rather than inheriting the last party's name. The
   * two-hour identity TTL gets there eventually; this gets there the moment
   * the money is taken.
   *
   * THE SIGNAL IS THE TABLE, NOT THIS DINER. get_table_bill already scopes to
   * orders that are not settled -- via a paid payment row or membership in a
   * paid bill -- so an empty scope means the whole table is closed out. Using
   * "my orders are settled" instead would end one diner's seating while their
   * friend is still eating on the same table, which is the mid-meal reset he
   * warned against. A table with anyone still unsettled stays open for
   * everyone.
   *
   * GUARDED ON orderedAt, and that guard is the difference between this and a
   * bug: a table with no unsettled orders is also exactly what a diner sees
   * when they have just scanned and not ordered yet. Without it, every scan
   * would clear the name it had just asked for.
   */
  // (Seating end is watched by useSeatingWatch above: the pass ends with the seating.)

  // Filters are built from what can be ORDERED: fetchMenu only returns
  // available dishes, so a Non-veg chip with no non-veg dish behind it, or a
  // "Juice" chip whose juices are all switched off, never appears. With only
  // one kind on offer the diet toggle is hidden entirely (see menuFilters).
  // Area price list (Phase 3): the same dish can cost more in the AC hall.
  // The server prices the order the same way; this only keeps the menu honest.
  const pricedItems = useMemo(
    () => (items ?? []).map((m) => (areaPrices[m.id] != null ? { ...m, price: Number(areaPrices[m.id]) } : m)),
    [items, areaPrices],
  );
  const dietAvail = useMemo(() => dietAvailability(pricedItems), [pricedItems]);
  const dietNow = effectiveDiet(diet, dietAvail);

  const cats = useMemo(() => categoriesWithItems(pricedItems, dietNow), [pricedItems, dietNow]);
  const catNow = activeCat === 'All' || cats.includes(activeCat) ? activeCat : 'All';

  // A saved filter that no longer matches anything (the last non-veg dish
  // went out of stock, a category emptied) falls back instead of leaving the
  // diner on an empty page with nothing highlighted. Only once the menu is in.
  useEffect(() => {
    if (!items) return;
    if (dietNow !== diet) setDiet(dietNow);
    if (catNow !== activeCat) setActiveCat(catNow);
  }, [items, dietNow, diet, catNow, activeCat]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pricedItems.filter(
      (i) =>
        matchesDiet(i, dietNow) &&
        (catNow === 'All' || i.category === catNow) &&
        // Match the name the diner can actually SEE as well as the English one:
        // someone reading a Kannada menu will type Kannada into the search box,
        // and matching only the stored English name would return nothing.
        (!q
          || i.name.toLowerCase().includes(q)
          || dishName(i, lang).toLowerCase().includes(q)
          || (i.description ?? '').toLowerCase().includes(q)),
    );
  }, [pricedItems, query, dietNow, catNow, lang]);

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

  // A Spinner, not null. The redirect above runs in an effect, which is AFTER
  // this render, so returning null paints one blank white frame on the way to
  // the gate -- a flash of nothing is exactly the "glitch" the diner surface
  // is not allowed to have.
  if (!session) return <Spinner label={t('menu.loading')} />;
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
            {table.is_parcel ? '📦 ' + t('menu.parcel') : `🍽 ${translateTableLabel(table.label)}`}
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
              {restaurant.is_open === false ? t('menu.closed') : t('menu.open')}
            </span>
            {session.demo && <span className="badge gold">{t('common.demo')}</span>}
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
        {(dietAvail.offer || hasBuffet || canCallService(session)) && (
        <div className="chip-row diet-row" role="group" aria-label={t('menu.dietFilter')}>
          {/* Only when BOTH kinds can be ordered: a toggle with one possible
              answer is noise, and a Non-veg chip on an all-veg menu (or one
              whose non-veg dishes are all out) leads to an empty page. */}
          {dietAvail.offer && (<>
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
          </>)}

          {/* BUFFET AND SERVICE, WHERE HE MARKED THEM. He drew both labels into
              this row and crossed out the floating "Call for service" chip that
              used to sit below the table summary on a line of its own.

              They are deliberately NOT diet filters, and they are separated by
              a spacer rather than styled to look like one: the three chips to
              the left change what the list below shows, these two leave the
              menu. Same row because that is where a diner's eye already is;
              different half of it because they do different things. */}
          {dietAvail.offer && (hasBuffet || canCallService(session)) && <span className="chip-gap" aria-hidden />}
          {hasBuffet && (
            <button className="chip chip-go" onClick={() => nav('/buffet')}>
              🍽 {t('start.buffet')}
            </button>
          )}
          {canCallService(session) && (
            <button
              className="chip chip-go"
              onClick={() => setSvcOpen(true)}
              aria-haspopup="dialog"
            >
              🙋 {t('svc.open')}
            </button>
          )}
        </div>
        )}
        <div className="chip-row" role="tablist">
          {['All', ...cats].map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={catNow === c}
              className={catNow === c ? 'chip active' : 'chip'}
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
      {!session.demo && <TableSoFar session={session} />}
      {/* The SHEET only. Its chip is up in the filter row now, so nothing is
          drawn here at rest -- which is what removed the odd right-aligned
          strip that used to sit under the table summary. */}
      <CallService session={session} open={svcOpen} onClose={() => setSvcOpen(false)} />

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
              }, dishName(d, lang));
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
                      <h3>{dishName(d, lang)}</h3>
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
                              aria-label={`${t('menu.add')} ${dishName(d, lang)}`}
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
            // The line carries the English name to the kitchen; the diner is
            // told what they ordered in their own language.
            orderNow(line, `${line.qty} × ${dishName(open, lang)}`);
          }}
        />
      )}

      {toast && <div className="cart-toast" role="status">{toast}</div>}

      {/* First-open identity gate — capture the diner once so orders + bill
          stay attributed. Skipped for demo and view-only (no ordering). */}
      {askWho && !session.demo && (
        <IdentityGate
          restaurantName={restaurant.name}
          tableLabel={table.is_parcel ? undefined : table.label}
          onCancel={() => setAskWho(null)}
          onSubmit={(g) => {
            const pending = askWho;
            setAskWho(null);
            setGuest(g);
            // The pass learns who this is now, so the bill and the order strip
            // can be found again; then the dish they tapped is ordered.
            const s2 = { ...session, guest: g };
            identifyVisit(s2, g.name, g.phone)
              .then(() => orderNowAs(s2, pending.line, pending.label))
              .catch((e) => {
                if (e instanceof VisitExpired) { endSeating(); flash(t('visit.ended'), 3600); }
                else flash(e?.message ?? t('menu.orderFailed'), 3600);
              });
          }}
        />
      )}

      {session.visitEnded && (
        <div className="glass" role="status" style={{ position: 'sticky', bottom: 12, padding: 14, margin: '16px 0', textAlign: 'center' }}>
          <p style={{ fontWeight: 700 }}>{t('visit.ended')}</p>
        </div>
      )}

      {/* Not a cart — these orders are already placed. The bar is a way back to
          them, nothing more.

          It used to count down the grace window ("Sending in 59s"), which told
          the diner about a mechanism that exists for the restaurant's benefit,
          not theirs. From the table, an order is placed the moment you tap; the
          delay before the kitchen sees it is the restaurant's own buffer. A
          visible timer turned that into a deadline the diner had to watch. The
          window still works exactly as before — the undo controls are still
          here — it simply is not narrated. */}
      {pending.length > 0 && !session.orderingDisabled && (
        <div className="cartbar-wrap">
          <button className="cartbar pending-bar" onClick={() => nav('/bill')}>
            <span style={{ fontWeight: 700 }}>
              {pending.length} order{pending.length > 1 ? 's' : ''} · {inr(pendingTotal)}
            </span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              {t('menu.bill')} →
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
