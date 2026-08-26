/** Live orders board — realtime, notification sound + browser notification,
 *  status advance, quick mark-paid. Waiters see the board + paid actions only
 *  (advance buttons still shown: waiters marking Served is normal floor work,
 *  and the RPC enforces staff membership server-side). */
import React, { useEffect, useRef, useState } from 'react';
import { subscribeOrders } from '../../lib/realtimeWeb';
import {
  fetchLiveOrders, advanceOrder, NEXT_STATUS,
  createBill, payBill, confirmPayment, type PortalOrder,
} from '../../lib/portalApi';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Growth } from './Growth';
import { Spinner, VegMark } from '../../components';

const LIVE = ['placed', 'accepted', 'preparing', 'ready'];
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

export function OrdersBoard() {
  const { restaurant, role } = usePartner();
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
    } catch (e: any) {
      setError(e?.message ?? 'Could not load orders.');
    }
  };

  useEffect(() => {
    load();
    const channel = subscribeOrders(restaurant.id, () => load());
    const t = setInterval(load, 30000); // safety net alongside realtime
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

  const cancel = async (o: PortalOrder) => {
    if (!confirm(`Cancel order #${o.order_no}?`)) return;
    setBusy(o.id);
    setJustIn((prev) => { const n = new Set(prev); n.delete(o.id); return n; });
    try { await advanceOrder(o.id, 'cancelled'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Cancel failed.'); }
    finally { setBusy(''); }
  };

  const quickPaid = async (o: PortalOrder, mode: 'cash' | 'upi_qr') => {
    setBusy(o.id);
    setJustIn((prev) => { const n = new Set(prev); n.delete(o.id); return n; });
    try {
      // A diner-initiated pending payment just needs the one-tap confirm;
      // otherwise settle via a single-order bill.
      if (o.pendingPayment) {
        await confirmPayment(o.pendingPayment.id);
      } else {
        const bill = await createBill(restaurant.id, [o.id], 0);
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
        {orders.map((o) => (
          <div
            key={o.id}
            className={justIn.has(o.id) ? 'ticket glass ticket-new' : 'ticket glass'}
            style={{ borderColor: o.status === 'placed' ? 'var(--gold)' : undefined }}
          >
            <div className="ticket-head">
              <strong>#{o.order_no} · {o.is_parcel ? '📦 Parcel' : o.table_label ?? 'Table'}</strong>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {justIn.has(o.id) && <span className="new-badge">NEW</span>}
                <span className={`status-chip status-${o.status}`}>{o.status}</span>
              </span>
            </div>
            {/* Who ordered — the counter needs a name to call out, and it was
                only visible after opening the bill. */}
            {(o.guest_name || '').trim() && (
              <p className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{o.guest_name}</p>
            )}
            <div className="ticket-items">
              {o.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <VegMark veg={!!it.is_veg} />
                  <span>{it.qty}× {it.name}</span>
                </div>
              ))}
              {o.notes && <p style={{ marginTop: 4, fontStyle: 'italic' }}>“{o.notes}”</p>}
            </div>
            <div className="ticket-head">
              <span style={{ fontWeight: 700 }}>{inr(o.total)}</span>
              <span className={o.paid ? 'badge open' : 'badge'}>{o.paid ? 'Paid' : 'Unpaid'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {NEXT_STATUS[o.status] && (
                <button className="btn btn-primary" style={{ padding: '10px 14px', fontSize: 13.5, flex: 1 }}
                  disabled={busy === o.id} onClick={() => advance(o)}>
                  {NEXT_LABEL[o.status]}
                </button>
              )}
              {role !== 'waiter' && o.status === 'placed' && (
                <button className="chip" disabled={busy === o.id} onClick={() => cancel(o)} title="Cancel this order">✕</button>
              )}
            </div>
            {/* Payment. Two unlabelled buttons reading "₹ Cash" and "UPI ✓" sat
                next to the status button, and it was not clear whether they
                recorded a payment or requested one — the "confusing Paid
                option". They are now under an explicit heading that says what
                pressing them does, and the table-level route is signposted. */}
            {!o.paid && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                {o.pendingPayment ? (
                  <>
                    <p className="overline" style={{ marginBottom: 6 }}>
                      Diner says they paid by {o.pendingPayment.provider === 'cash' ? 'cash' : 'UPI'}
                    </p>
                    <button className="btn btn-primary btn-block" style={{ padding: '10px 12px', fontSize: 13 }}
                      disabled={busy === o.id} onClick={() => quickPaid(o, 'cash')}>
                      Confirm we received it ✓
                    </button>
                  </>
                ) : (
                  <>
                    <p className="overline" style={{ marginBottom: 6 }}>Record payment received</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                        disabled={busy === o.id} onClick={() => quickPaid(o, 'cash')}>Cash</button>
                      <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                        disabled={busy === o.id} onClick={() => quickPaid(o, 'upi_qr')}>UPI</button>
                    </div>
                    <p className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Settles this one order. To bill a whole table together, use Billing.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
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
    </div>
  );
}
