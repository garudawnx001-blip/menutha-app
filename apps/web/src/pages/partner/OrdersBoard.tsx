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
import { Spinner, VegMark } from '../../components';

const LIVE = ['placed', 'accepted', 'preparing', 'ready'];
const SOUND_KEY = 'menutha-portal:sound';

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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

export function OrdersBoard() {
  const { restaurant, role } = usePartner();
  const [orders, setOrders] = useState<PortalOrder[] | null>(null);
  const [servedToday, setServedToday] = useState<PortalOrder[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) !== 'off');
  const prevCount = useRef(0);

  const load = async () => {
    try {
      const live = await fetchLiveOrders(restaurant.id, LIVE);
      const served = (await fetchLiveOrders(restaurant.id, ['served']))
        .filter((o) => new Date(o.placed_at).toDateString() === new Date().toDateString())
        .reverse();
      if (live.length > prevCount.current) {
        if (localStorage.getItem(SOUND_KEY) !== 'off') chime();
        if (Notification?.permission === 'granted') {
          const newest = live[live.length - 1];
          new Notification('New order — ' + (newest?.table_label ?? 'table'), {
            body: (newest?.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', ').slice(0, 90),
          });
        }
      }
      prevCount.current = live.length;
      setOrders(live);
      setServedToday(served);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not load orders.');
    }
  };

  useEffect(() => {
    load();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    const channel = subscribeOrders(restaurant.id, () => load());
    const t = setInterval(load, 30000); // safety net alongside realtime
    return () => { channel.unsubscribe(); clearInterval(t); };
  }, [restaurant.id]);

  const advance = async (o: PortalOrder) => {
    const next = NEXT_STATUS[o.status];
    if (!next) return;
    setBusy(o.id);
    try { await advanceOrder(o.id, next); await load(); }
    catch (e: any) { setError(e?.message ?? 'Update failed.'); }
    finally { setBusy(''); }
  };

  const cancel = async (o: PortalOrder) => {
    if (!confirm(`Cancel order #${o.order_no}?`)) return;
    setBusy(o.id);
    try { await advanceOrder(o.id, 'cancelled'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Cancel failed.'); }
    finally { setBusy(''); }
  };

  const quickPaid = async (o: PortalOrder, mode: 'cash' | 'upi_qr') => {
    setBusy(o.id);
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

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="overline">Live orders</p>
          <h1 className="display" style={{ fontSize: 26 }}>
            {orders.length ? `${orders.length} active` : 'All clear'}
          </h1>
        </div>
        <button
          className={sound ? 'chip active' : 'chip'}
          onClick={() => {
            const next = !sound;
            setSound(next);
            localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            if (next) chime();
          }}
        >
          {sound ? '🔔 Sound on' : '🔕 Sound off'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      {orders.length === 0 && (
        <div className="glass" style={{ padding: 22, textAlign: 'center' }}>
          <p className="muted">No live orders. New orders appear here instantly — keep this tab open.</p>
        </div>
      )}

      <div className="menu-grid">
        {orders.map((o) => (
          <div key={o.id} className="ticket glass" style={{ borderColor: o.status === 'placed' ? 'var(--gold)' : undefined }}>
            <div className="ticket-head">
              <strong>#{o.order_no} · {o.is_parcel ? '📦 Parcel' : o.table_label ?? 'Table'}</strong>
              <span className={`status-chip status-${o.status}`}>{o.status}</span>
            </div>
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
              {!o.paid && o.pendingPayment && (
                <button className="btn btn-primary" style={{ padding: '10px 12px', fontSize: 13, borderColor: 'var(--gold)' }}
                  disabled={busy === o.id} onClick={() => quickPaid(o, 'cash')}>
                  Confirm {o.pendingPayment.provider === 'cash' ? 'cash' : 'UPI'} received ✓
                </button>
              )}
              {!o.paid && !o.pendingPayment && (
                <>
                  <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13 }}
                    disabled={busy === o.id} onClick={() => quickPaid(o, 'cash')}>₹ Cash</button>
                  <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 13 }}
                    disabled={busy === o.id} onClick={() => quickPaid(o, 'upi_qr')}>UPI ✓</button>
                </>
              )}
              {role !== 'waiter' && o.status === 'placed' && (
                <button className="chip" disabled={busy === o.id} onClick={() => cancel(o)}>✕</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {servedToday.length > 0 && (
        <>
          <h2 className="cat-heading">Served today ({servedToday.length})</h2>
          <div className="glass" style={{ padding: '4px 16px' }}>
            {servedToday.slice(0, 12).map((o) => (
              <div key={o.id} className="row-item">
                <span className="muted" style={{ fontSize: 14 }}>
                  #{o.order_no} · {o.is_parcel ? 'Parcel' : o.table_label} · {o.items.reduce((a, i) => a + i.qty, 0)} items
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{inr(o.total)}</span>
                  <span className={o.paid ? 'badge open' : 'badge'}>{o.paid ? 'Paid' : 'Unpaid'}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
