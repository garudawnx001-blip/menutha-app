/** Live orders board — realtime, notification sound + browser notification,
 *  status advance, quick mark-paid. Waiters see the board + paid actions only
 *  (advance buttons still shown: waiters marking Served is normal floor work,
 *  and the RPC enforces staff membership server-side). */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeOrders } from '../../lib/realtimeWeb';
import {
  fetchLiveOrders, advanceOrder, NEXT_STATUS, markOrderReadyNow, adjustOrderTimer,
  createBill, payBill, confirmPayment, staffUpdateOrderItem, staffCancelOrder,
  type PortalOrder,
} from '../../lib/portalApi';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Growth } from './Growth';
import { Spinner, VegMark } from '../../components';

const LIVE = ['placed', 'accepted', 'preparing', 'ready'];

/** One burst of taps is one ticket.
 *
 *  With the cart gone a diner orders dish by dish, so a single sitting arrives
 *  as several rows seconds apart. To the kitchen that is one order, and four
 *  cards for one table is how a pass gets missed. The same window already
 *  collapses the push notification, so the board and the phone agree.
 *
 *  Grouped for DISPLAY only — the rows stay separate underneath. Merging them
 *  would fight per-order tax rounding, which is what guarantees the table total
 *  and the sum of the per-person totals agree to the paisa. */
const GROUP_WINDOW_MS = 90 * 1000;
const SOUND_KEY = 'menutha-portal:sound';

/** One AudioContext for the page. A fresh one per chime leaks contexts —
 *  browsers cap them at around six, after which the alert goes silent for the
 *  rest of the shift. Contexts also start suspended until a user gesture, so
 *  resume() is attempted on every play. */
let audioCtx: AudioContext | null = null;
function chime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.55);
    };
    play(880, 0); play(1174.7, 0.18); // A5 → D6, a pleasant "order in!"
  } catch { /* audio blocked until first interaction — fine */ }
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

/** Everything the counter needs without opening the order: who, where, what,
 *  and how much. The old alert carried only the table and a truncated item
 *  list. */
function notifyOrder(o: PortalOrder) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  const where = o.is_parcel ? 'Parcel' : o.table_label ?? 'Table';
  const who = (o.guest_name ?? '').trim();
  const items = (o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', ');
  const count = (o.items ?? []).reduce((a, i) => a + Number(i.qty || 0), 0);
  const head = [who, `${count} item${count === 1 ? '' : 's'}`, inr(Number(o.total || 0))]
    .filter(Boolean).join(' · ');
  try {
    new Notification(`New order · ${where} · #${o.order_no}`, {
      body: `${head}\n${items}${o.notes ? `\nNote: ${o.notes}` : ''}`,
      tag: o.id,                 // one notification per order, never duplicated
      requireInteraction: true,  // stays up until someone at the counter looks
    });
  } catch { /* some browsers reject options; the chime still fired */ }
}

/** Has this order's prep time elapsed? */
const isReady = (o: PortalOrder) => {
  const r = (o as any).ready_at;
  return !!r && new Date(r).getTime() <= Date.now();
};

/** Live countdown to an order's ready_at.
 *
 *  Ticks locally rather than re-fetching: the deadline is fixed at insert, so
 *  the only thing changing is the clock. Re-reading the board every second to
 *  animate a number would be wasteful and would fight the 30s poll. */
function Countdown({ readyAt }: { readyAt?: string | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!readyAt) return null;

  const ms = new Date(readyAt).getTime() - Date.now();
  const over = ms <= 0;
  const secs = Math.floor(Math.abs(ms) / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');

  return (
    <span
      className={over ? 'prep-timer done' : 'prep-timer'}
      title={over ? 'Prep time elapsed' : 'Time left of the prep estimate'}
      aria-label={over ? 'Prep time elapsed' : `${mm} minutes ${ss} seconds left`}
    >
      {over ? `⏱ +${mm}:${ss}` : `⏱ ${mm}:${ss}`}
    </span>
  );
}

export function OrdersBoard() {
  const { restaurant, role } = usePartner();
  const nav = useNavigate();
  const [orders, setOrders] = useState<PortalOrder[] | null>(null);
  const [servedToday, setServedToday] = useState<PortalOrder[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) !== 'off');
  // Ids that arrived while this board was open — highlighted until acted on.
  const [justIn, setJustIn] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notifyPerm, setNotifyPerm] = useState<string>(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'),
  );
  // Identity, not count. The old check was `live.length > prevCount`, so an
  // order arriving in the same window as another being served left the count
  // unchanged and the counter got no alert at all — the exact "we don't get
  // notified" complaint. Tracking ids catches every arrival.
  const seen = useRef<Set<string> | null>(null);

  const load = async () => {
    try {
      const live = await fetchLiveOrders(restaurant.id, LIVE);
      const served = (await fetchLiveOrders(restaurant.id, ['served']))
        .filter((o) => new Date(o.placed_at).toDateString() === new Date().toDateString())
        .reverse();

      if (seen.current === null) {
        // First load seeds the baseline: whatever is already on the board is
        // not "new", so opening the page doesn't fire a burst of alerts.
        seen.current = new Set(live.map((o) => o.id));
      } else {
        const fresh = live.filter((o) => !seen.current!.has(o.id));
        if (fresh.length) {
          if (localStorage.getItem(SOUND_KEY) !== 'off') chime();
          fresh.forEach(notifyOrder);
          setJustIn((prev) => new Set([...prev, ...fresh.map((o) => o.id)]));
        }
        live.forEach((o) => seen.current!.add(o.id));
      }

      setOrders(live);
      setServedToday(served);
      setError('');
      return live;
    } catch (e: any) {
      setError(e?.message ?? 'Could not load orders.');
      return null;
    }
  };

  useEffect(() => {
    load();
    const channel = subscribeOrders(restaurant.id, () => load());
    // 10s, not 30: an order becomes visible when its grace window elapses, and
    // that moment produces no realtime event to ride on — the row was inserted
    // a minute earlier. Polling is what makes a released order appear.
    const t = setInterval(load, 10000);
    return () => { channel.unsubscribe(); clearInterval(t); };
  }, [restaurant.id]);

  const advance = async (o: PortalOrder) => {
    const next = NEXT_STATUS[o.status];
    if (!next) return;
    setBusy(o.id);
    setJustIn((prev) => { const n = new Set(prev); n.delete(o.id); return n; });
    try { await advanceOrder(o.id, next); await load(); }
    catch (e: any) { setError(e?.message ?? 'Update failed.'); }
    finally { setBusy(''); }
  };

  /** Pull the countdown to zero. Staff-side only — the diner is not told. */
  const readyNow = async (all: PortalOrder[]) => {
    setBusy(all[0].id);
    setJustIn((prev) => { const n = new Set(prev); all.forEach((x) => n.delete(x.id)); return n; });
    try { for (const x of all) await markOrderReadyNow(x.id); await load(); }
    catch (e: any) { setError(e?.message ?? 'Could not update the timer.'); }
    finally { setBusy(''); }
  };

  /** Nudge one order's deadline without touching the restaurant default. */
  const nudge = async (all: PortalOrder[], mins: number) => {
    setBusy(all[0].id);
    try { for (const x of all) await adjustOrderTimer(x.id, mins); await load(); }
    catch (e: any) { setError(e?.message ?? 'Could not adjust the timer.'); }
    finally { setBusy(''); }
  };

  // Editing and cancelling an order change what a table owes, so they are the
  // owner's and manager's to make. The buttons are hidden from everyone else,
  // but the real check is in the database — a hidden button is not a
  // permission, and both RPCs refuse anyone below manager.
  const canEdit = role === 'owner' || role === 'manager';
  const [editing, setEditing] = useState<PortalOrder[] | null>(null);

  /** Collapse each table+diner's burst of orders into one ticket. */
  const tickets = React.useMemo(() => {
    const out: { o: PortalOrder; sibs: PortalOrder[] }[] = [];
    const keyOf = (r: PortalOrder) =>
      `${r.is_parcel ? 'parcel' : r.table_label ?? ''}|${r.guest_phone ?? ''}`;
    for (const ord of orders ?? []) {
      const g = out.find((x) => {
        if (keyOf(x.o) !== keyOf(ord)) return false;
        const last = x.sibs.length ? x.sibs[x.sibs.length - 1] : x.o;
        return new Date(ord.placed_at).getTime() - new Date(last.placed_at).getTime() <= GROUP_WINDOW_MS;
      });
      if (g) g.sibs.push(ord); else out.push({ o: ord, sibs: [] });
    }
    return out;
  }, [orders]);

  /** Cancel everything on this ticket. A ticket is what the kitchen sees, so
   *  cancelling half of one and leaving the rest on the pass is not a state
   *  anybody asked for. */
  const cancel = async (all: PortalOrder[]) => {
    const nos = all.map((x) => `#${x.order_no}`).join(', ');
    if (!confirm(`Cancel ${all.length === 1 ? 'order' : `all ${all.length} orders on this ticket`} ${nos}?`)) return;
    setBusy(all[0].id);
    setJustIn((prev) => { const n = new Set(prev); all.forEach((x) => n.delete(x.id)); return n; });
    try {
      for (const x of all) await staffCancelOrder(x.id);
      setEditing(null);
      await load();
    } catch (e: any) { setError(e?.message ?? 'Cancel failed.'); }
    finally { setBusy(''); }
  };

  /** Change one line on a live order. qty 0 removes it; removing the last line
   *  cancels the order. The total is recomputed server-side from the item rows
   *  at their original prices, so a menu price change never rewrites a bill
   *  the diner has already been quoted. */
  const setItemQty = async (orderId: string, itemId: string, qty: number) => {
    setBusy(orderId);
    try {
      await staffUpdateOrderItem(orderId, itemId, qty);
      const fresh = await load();
      // Re-resolve the whole ticket: removing a line can cancel its order,
      // which drops it out of the board entirely.
      setEditing((cur) => {
        if (!cur) return null;
        const ids = new Set(cur.map((x) => x.id));
        const next = (fresh ?? []).filter((x) => ids.has(x.id));
        return next.length ? next : null;
      });
    } catch (e: any) { setError(e?.message ?? 'Could not change that item.'); }
    finally { setBusy(''); }
  };

  /** Settle everything on this ticket as one bill. Taking payment for the
   *  first of three orders placed seconds apart and leaving the rest open is a
   *  short till at the end of the shift. */
  const quickPaid = async (all: PortalOrder[], mode: 'cash' | 'upi_qr') => {
    setBusy(all[0].id);
    setJustIn((prev) => { const n = new Set(prev); all.forEach((x) => n.delete(x.id)); return n; });
    try {
      // Diner-initiated pending payments just need the one-tap confirm.
      const pending = all.filter((x) => x.pendingPayment);
      for (const x of pending) await confirmPayment(x.pendingPayment!.id);

      const rest = all.filter((x) => !x.pendingPayment && !x.paid);
      if (rest.length) {
        const bill = await createBill(restaurant.id, rest.map((x) => x.id), 0);
        await payBill(bill.id, mode);
      }
      await load();
    } catch (e: any) { setError(e?.message ?? 'Payment update failed.'); }
    finally { setBusy(''); }
  };

  if (orders === null) return <Spinner label="Loading live orders…" />;

  const NEXT_LABEL: Record<string, string> = {
    placed: 'Accept', accepted: 'Start preparing', preparing: 'Mark ready', ready: 'Mark served',
  };

  // Today's-sales header (Swiggy/Zomato-partner style) — realized sales are the
  // orders served today; live + unpaid give the floor its at-a-glance state.
  const salesToday = servedToday.reduce((a, o) => a + Number(o.total || 0), 0);
  const unpaidLive = orders.filter((o) => !o.paid).length;
  const newCount = orders.filter((o) => o.status === 'placed').length;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="overline">Live orders</p>
          <h1 className="display" style={{ fontSize: 26 }}>
            {orders.length ? `${orders.length} active` : 'All clear'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Browsers routinely ignore a permission prompt fired on page load,
              which left desktop alerts silently off. An explicit button is a
              user gesture, so the prompt actually shows. */}
          {notifyPerm !== 'granted' && (
            <button
              className="chip"
              onClick={async () => {
                if (!canNotify()) { setError('This browser cannot show desktop alerts.'); return; }
                try {
                  const p = await Notification.requestPermission();
                  setNotifyPerm(p);
                  if (p === 'denied') {
                    setError('Alerts are blocked for this site — allow notifications in the browser’s site settings.');
                  }
                } catch { /* ignore */ }
              }}
            >
              🔔 Enable alerts
            </button>
          )}
          <button
            className={sound ? 'chip active' : 'chip'}
            onClick={() => {
              const next = !sound;
              setSound(next);
              localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
              if (next) chime();   // doubles as the gesture that unlocks audio
            }}
          >
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      <div className="kpi-strip">
        <div className="kpi glass">
          <span className="kpi-label">Today's sales</span>
          <span className="kpi-value">{inr(salesToday)}</span>
          <span className="kpi-sub">{servedToday.length} served</span>
        </div>
        <div className="kpi glass">
          <span className="kpi-label">Live now</span>
          <span className="kpi-value" style={{ color: orders.length ? 'var(--primary)' : undefined }}>{orders.length}</span>
          <span className="kpi-sub">{newCount ? `${newCount} new` : 'all caught up'}</span>
        </div>
        <div className="kpi glass">
          <span className="kpi-label">Unpaid</span>
          <span className="kpi-value" style={{ color: unpaidLive ? 'var(--gold-ink, #8a6a25)' : undefined }}>{unpaidLive}</span>
          <span className="kpi-sub">on the floor</span>
        </div>
      </div>


      {/* Growth. Owners and managers only — the floor doesn't need revenue
          trends mid-service, and kitchen accounts shouldn't see turnover. */}
      {(role === 'owner' || role === 'manager') && <Growth restaurantId={restaurant.id} />}
      {orders.length === 0 && (
        <div className="glass" style={{ padding: 22, textAlign: 'center' }}>
          <p className="muted">No live orders. New orders appear here instantly — keep this tab open.</p>
        </div>
      )}

      <div className="menu-grid">
        {tickets.map(({ o, sibs }) => {
          const all = [o, ...sibs];
          const groupTotal = all.reduce((a, x) => a + Number(x.total || 0), 0);
          // Merge identical dishes across the burst: "2× Idli" beats two lines
          // of "1× Idli" on a pass that is being read at a glance.
          const merged = (() => {
            const m = new Map<string, { name: string; qty: number; is_veg?: boolean }>();
            for (const x of all) {
              for (const it of x.items ?? []) {
                const k = `${it.name}|${it.is_veg ? 1 : 0}`;
                const cur = m.get(k);
                if (cur) cur.qty += Number(it.qty || 0);
                else m.set(k, { name: it.name, qty: Number(it.qty || 0), is_veg: it.is_veg });
              }
            }
            return [...m.values()];
          })();
          const notes = all.map((x) => x.notes).filter(Boolean) as string[];
          return (
          <div
            key={o.id}
            className={all.some((x) => justIn.has(x.id)) ? 'ticket glass ticket-new' : 'ticket glass'}
            style={{ borderColor: o.status === 'placed' ? 'var(--gold)' : undefined }}
          >
            <div className="ticket-head">
              {/* Tapping the ticket header opens Billing already focused on
                  this table — settling is the commonest thing staff do next,
                  and it was three screens away. The buttons below stop the
                  click so a tap on "Ready now" never navigates. */}
              <button
                className="ticket-open"
                title="Open this table's bill"
                onClick={() => nav(`/partner/billing?table=${encodeURIComponent(o.table_label ?? '')}&order=${o.id}`)}
              >
                #{o.order_no}{sibs.length ? `+${sibs.length}` : ''} · {o.is_parcel ? '📦 Parcel' : o.table_label ?? 'Table'} ›
              </button>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {all.some((x) => justIn.has(x.id)) && <span className="new-badge">NEW</span>}
                <span className={`status-chip status-${o.status}`}>{o.status}</span>
              </span>
            </div>
            {/* Who ordered — the counter needs a name to call out, and it was
                only visible after opening the bill. */}
            {(o.guest_name || '').trim() && (
              <p className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{o.guest_name}</p>
            )}
            <div className="ticket-items">
              {merged.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <VegMark veg={!!it.is_veg} />
                  <span>{it.qty}× {it.name}</span>
                </div>
              ))}
              {notes.map((n, i) => <p key={i} style={{ marginTop: 4, fontStyle: 'italic' }}>“{n}”</p>)}
              {sibs.length > 0 && (
                <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  {all.length} orders within 90s — one ticket ({all.map((x) => `#${x.order_no}`).join(', ')})
                </p>
              )}
            </div>
            <div className="ticket-head">
              <span style={{ fontWeight: 700 }}>{inr(groupTotal)}</span>
              <span className={all.every((x) => x.paid) ? 'badge open' : 'badge'}>{all.every((x) => x.paid) ? 'Paid' : 'Unpaid'}</span>
            </div>
            {/* Prep timer replaces the accept/preparing/ready/served workflow.
                The order starts its own countdown the moment it lands, so
                nobody has to press anything to move it along. Staff keep two
                optional controls: "Ready now" pulls the countdown to zero for
                their own tracking, and Cancel. Nothing here notifies the diner
                — the countdown is a kitchen tool. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Countdown readyAt={(o as any).ready_at} />
              {!isReady(o) && (
                <>
                  <button className="chip" disabled={busy === o.id}
                    title="Give this order 5 more minutes"
                    onClick={() => nudge(all, 5)}>+5m</button>
                  <button className="btn btn-primary" style={{ padding: '9px 14px', fontSize: 13.5, flex: 1 }}
                    disabled={busy === o.id} onClick={() => readyNow(all)}>
                    Ready now
                  </button>
                </>
              )}
              {canEdit && (
                <>
                  <button className="chip" disabled={busy === o.id}
                    onClick={() => setEditing(all)} title="Change what is on this ticket">
                    Edit
                  </button>
                  <button className="chip" disabled={busy === o.id}
                    onClick={() => cancel(all)} title="Cancel this ticket">✕</button>
                </>
              )}
            </div>
            {/* Payment. Two unlabelled buttons reading "₹ Cash" and "UPI ✓" sat
                next to the status button, and it was not clear whether they
                recorded a payment or requested one — the "confusing Paid
                option". They are now under an explicit heading that says what
                pressing them does, and the table-level route is signposted. */}
            {!all.every((x) => x.paid) && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                {all.some((x) => x.pendingPayment) ? (
                  <>
                    <p className="overline" style={{ marginBottom: 6 }}>
                      Diner says they paid by {all.find((x) => x.pendingPayment)!.pendingPayment!.provider === 'cash' ? 'cash' : 'UPI'}
                    </p>
                    <button className="btn btn-primary btn-block" style={{ padding: '10px 12px', fontSize: 13 }}
                      disabled={busy === o.id} onClick={() => quickPaid(all, 'cash')}>
                      Confirm we received it ✓
                    </button>
                  </>
                ) : (
                  <>
                    <p className="overline" style={{ marginBottom: 6 }}>Record payment received</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                        disabled={busy === o.id} onClick={() => quickPaid(all, 'cash')}>Cash</button>
                      <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                        disabled={busy === o.id} onClick={() => quickPaid(all, 'upi_qr')}>UPI</button>
                    </div>
                    <p className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Settles this ticket. To bill a whole table together, use Billing.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {servedToday.length > 0 && (
        <>
          <h2 className="cat-heading">Served today ({servedToday.length})</h2>
          <div className="glass" style={{ padding: '4px 16px' }}>
            {/* Rows were a one-line summary with no way to see what was in the
                order — "expand the cards". Tap a row for the full itemisation. */}
            {servedToday.map((o) => {
              const open = expanded.has(o.id);
              return (
                <div key={o.id}>
                  <button
                    className="row-expand row-item"
                    aria-expanded={open}
                    onClick={() => setExpanded((prev) => {
                      const n = new Set(prev);
                      n.has(o.id) ? n.delete(o.id) : n.add(o.id);
                      return n;
                    })}
                  >
                    <span className="muted" style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span aria-hidden style={{ display: 'inline-block', width: 14 }}>{open ? '▾' : '▸'}</span>
                      #{o.order_no} · {o.is_parcel ? 'Parcel' : o.table_label}
                      {(o.guest_name || '').trim() ? ` · ${o.guest_name}` : ''}
                      {' · '}{o.items.reduce((a, i) => a + i.qty, 0)} items
                    </span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>{inr(o.total)}</span>
                      <span className={o.paid ? 'badge open' : 'badge'}>{o.paid ? 'Paid' : 'Unpaid'}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="row-detail">
                      {o.items.map((it, i) => (
                        <div key={i} className="bill-row" style={{ fontSize: 13.5 }}>
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <VegMark veg={!!it.is_veg} />
                            {it.qty}× {it.name}
                          </span>
                          <span>{inr(it.unit_price * it.qty)}</span>
                        </div>
                      ))}
                      {o.notes && <p className="dim" style={{ fontSize: 12.5, fontStyle: 'italic', marginTop: 4 }}>“{o.notes}”</p>}
                      <div className="bill-row" style={{ fontSize: 13 }}>
                        <span className="dim">Subtotal</span><span>{inr(o.subtotal)}</span>
                      </div>
                      {Number(o.packing_charge) > 0 && (
                        <div className="bill-row" style={{ fontSize: 13 }}>
                          <span className="dim">Packing</span><span>{inr(o.packing_charge)}</span>
                        </div>
                      )}
                      <div className="bill-row" style={{ fontSize: 13 }}>
                        <span className="dim">Tax</span><span>{inr(o.gst_amount)}</span>
                      </div>
                      <p className="dim" style={{ fontSize: 12 }}>
                        Placed {new Date(o.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {o.guest_phone ? ` · ${o.guest_phone}` : ''}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Staff edit. The diner's own grace window has closed by the time an
          order is on this board, so this is the counter's copy of it: change a
          quantity a customer got wrong, drop an item the kitchen is out of, or
          cancel outright. Every change re-totals the order server-side at the
          prices already quoted. */}
      {editing && (
        <div className="modal-scrim" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2 className="display" style={{ fontSize: 22 }}>
              Edit {editing.length === 1
                ? `order #${editing[0].order_no}`
                : `ticket (${editing.map((x) => `#${x.order_no}`).join(', ')})`}
            </h2>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
              {editing[0].is_parcel ? '📦 Parcel' : editing[0].table_label ?? 'Table'}
              {(editing[0].guest_name || '').trim() ? ` · ${editing[0].guest_name}` : ''}
            </p>

            {/* Every line on the ticket, whichever order it came in on. The
                line is what the kitchen and the diner argue about; which of
                three rows two seconds apart it belongs to is bookkeeping. */}
            <div style={{ marginTop: 14 }}>
              {editing.flatMap((ord) => ord.items.map((it) => (
                <div key={it.id} className="row-item">
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <VegMark veg={!!it.is_veg} />
                    <span style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14 }}>{it.name}</p>
                      <p className="dim" style={{ fontSize: 12.5 }}>
                        {inr(it.unit_price)} each
                        {editing.length > 1 && ` · #${ord.order_no}`}
                      </p>
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="chip" disabled={busy === ord.id}
                      title={it.qty === 1 ? 'Remove this item' : 'One fewer'}
                      onClick={() => setItemQty(ord.id, it.id, it.qty - 1)}>−</button>
                    <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{it.qty}</span>
                    <button className="chip" disabled={busy === ord.id}
                      onClick={() => setItemQty(ord.id, it.id, it.qty + 1)}>+</button>
                  </span>
                </div>
              )))}
            </div>

            <div className="bill-row" style={{ marginTop: 12, fontWeight: 700 }}>
              <span>{editing.length === 1 ? 'Order total' : 'Ticket total'}</span>
              <span>{inr(editing.reduce((a, x) => a + Number(x.total || 0), 0))}</span>
            </div>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
              To add something new, ask the diner to order it — it joins the same
              table bill.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditing(null)}>
                Done
              </button>
              <button className="chip" disabled={!!busy}
                style={{ color: 'var(--error)' }} onClick={() => cancel(editing)}>
                {editing.length === 1 ? 'Cancel order' : 'Cancel ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
