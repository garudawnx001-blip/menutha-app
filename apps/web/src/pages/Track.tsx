/** Live order tracking — timeline Placed → Accepted → Preparing → Ready →
 *  Served, refreshed by polling get_order_status (guest-safe; realtime RLS
 *  hides guest rows, so polling is the reliable channel). Handles cancelled. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchOrderStatus, fetchPaymentQr, startGatewayCheckout, type PaymentQr } from '../lib/api';
import { buildUpiUri, isValidVpa } from '../../../../packages/payments/index.js';
import type { OrderView } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';

const STEPS: { key: string; title: string; body: string }[] = [
  { key: 'placed', title: 'Order placed', body: 'Sent to the kitchen.' },
  { key: 'accepted', title: 'Accepted', body: 'The kitchen has picked it up.' },
  { key: 'preparing', title: 'Preparing', body: 'Your food is on the fire.' },
  { key: 'ready', title: 'Ready', body: 'Plated and on its way to you.' },
  { key: 'served', title: 'Served', body: 'Enjoy your meal!' },
];

const STAGE_INDEX: Record<string, number> = {
  placed: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  served: 4,
};

/** Pay the restaurant directly: dynamic UPI QR from THEIR VPA, optional card
 *  checkout on THEIR gateway, or cash at the counter. Zero platform fees. */
function PaymentPanel({ order, demo, onChanged }: { order: OrderView; demo?: boolean; onChanged: () => void }) {
  const [qr, setQr] = useState<PaymentQr | null>(null);
  const [qrImg, setQrImg] = useState('');
  const [upiUri, setUpiUri] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPaymentQr(order.id, demo).then((q) => {
      setQr(q);
      if (q.vpa && isValidVpa(q.vpa)) {
        const uri = buildUpiUri({
          vpa: q.vpa, payeeName: q.payee_name, amount: q.amount,
          note: `Order #${q.order_no}`,
        });
        setUpiUri(uri);
        QRCode.toDataURL(uri, { margin: 1, width: 380, color: { dark: '#1C1A15', light: '#FFFDF8' } })
          .then(setQrImg).catch(() => {});
      }
    }).catch(() => {});
  }, [order.id]);

  const act = async (fn: () => Promise<void>, key: string) => {
    setBusy(key); setError('');
    try { await fn(); onChanged(); }
    catch (e: any) { setError(e?.message ?? 'Something went wrong — please try again.'); }
    finally { setBusy(''); }
  };

  const p = order.payment;
  if (p?.status === 'paid') {
    return (
      <div className="glass" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
        <strong style={{ color: 'var(--success)' }}>✓ Paid</strong>
        <span className="muted" style={{ fontSize: 14 }}>
          {' '}— {p.provider === 'cash' ? 'cash' : p.provider === 'gateway' ? 'card / online' : 'UPI'} · directly to the restaurant.
        </span>
      </div>
    );
  }
  if (p?.status === 'created') {
    return (
      <div className="glass" style={{ padding: 16, marginTop: 16, borderColor: 'var(--gold)' }}>
        <strong style={{ color: '#8a6a25' }}>
          {p.provider === 'cash' ? 'Paying cash at the counter' : 'UPI payment marked'}
        </strong>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Waiting for the staff to confirm — this updates automatically.
        </p>
      </div>
    );
  }

  if (!qr) return null;

  return (
    <div className="glass" style={{ padding: 16, marginTop: 16 }}>
      <p className="overline" style={{ marginBottom: 4 }}>Pay {inr(qr.amount)} — directly to the restaurant</p>
      {qrImg ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <img src={qrImg} width={132} height={132} alt="UPI payment QR" style={{ borderRadius: 12, border: '1px solid var(--line-strong)' }} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <p className="muted" style={{ fontSize: 13.5 }}>
              Scan with any UPI app, or tap below — pays <strong>{qr.payee_name}</strong> directly, no fees.
            </p>
            <a className="btn btn-primary btn-block" style={{ marginTop: 10 }} href={upiUri}>
              Pay {inr(qr.amount)} via UPI
            </a>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
          UPI isn’t set up here yet — pay cash at the counter.
        </p>
      )}
      {qr.gateway_key_id && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} disabled={busy !== ''}
          onClick={() => act(() => startGatewayCheckout(order.id, demo), 'gw')}>
          {busy === 'gw' ? 'Opening…' : '💳 Pay by card / netbanking'}
        </button>
      )}
      <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
        Paying by UPI or cash? Just pay — the restaurant marks your order paid on their
        side once received. Nothing else needed from you.
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

export function Track() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { session } = useStore();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchOrderStatus(session, id)
        .then((o) => alive && (setOrder(o), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    timer.current = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer.current);
    };
  }, [id]);

  if (!order && !failed) return <Spinner label="Finding your order…" />;

  if (failed && !order) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <h1 className="display" style={{ fontSize: 26 }}>Couldn’t load this order</h1>
        <p className="muted" style={{ maxWidth: 380 }}>
          Check your connection and try again — your order is safe with the kitchen.
        </p>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  const o = order!;
  const cancelled = o.status === 'cancelled';
  const stage = STAGE_INDEX[o.status] ?? 0;
  const done = o.status === 'served';

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/menu')}>← Menu</button>
        <span className="badge gold">
          {o.is_parcel ? '📦 Parcel' : `🍽 ${o.table_label ?? 'Table'}`}
        </span>
      </div>

      <p className="overline" style={{ marginTop: 12 }}>
        {o.restaurant_name}{o.order_no ? ` · Order #${o.order_no}` : ''}
      </p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>
        {cancelled ? 'Order cancelled' : done ? 'Served — enjoy!' : 'Your order is live'}
      </h1>

      {cancelled ? (
        <div className="glass" style={{ padding: 18, marginTop: 18, borderColor: 'rgba(199,107,92,0.5)' }}>
          <p style={{ color: 'var(--error)', fontWeight: 700 }}>The restaurant cancelled this order.</p>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            Please speak to the staff — nothing has been charged through Menutha.
          </p>
        </div>
      ) : (
        <div className="glass" style={{ padding: '22px 20px', marginTop: 18 }}>
          <div className="timeline">
            {STEPS.map((s, i) => {
              const cls = i < stage ? 'step done' : i === stage ? (done ? 'step done' : 'step current') : 'step pending';
              return (
                <div key={s.key} className={cls}>
                  <span className="dot" />
                  <h4>{s.title}</h4>
                  <p>{s.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!cancelled && (
        <PaymentPanel order={o} demo={session?.demo || id === 'demo-order'} onChanged={() => {
          fetchOrderStatus(session, id).then(setOrder).catch(() => {});
        }} />
      )}

      <div className="glass" style={{ padding: 16, marginTop: 16 }}>
        <p className="overline" style={{ marginBottom: 10 }}>Receipt</p>
        {o.items.map((it, i) => (
          <div key={i} className="bill-row">
            <span>{it.qty} × {it.name}</span>
            <span>{inr(it.unit_price * it.qty)}</span>
          </div>
        ))}
        <div className="bill-row"><span>Subtotal</span><span>{inr(o.subtotal)}</span></div>
        {Number(o.packing_charge) > 0 && (
          <div className="bill-row"><span>Packing charge</span><span>{inr(o.packing_charge)}</span></div>
        )}
        {Number(o.service_charge ?? 0) > 0 && (
          <div className="bill-row"><span>Service charge</span><span>{inr(o.service_charge!)}</span></div>
        )}
        {o.sgst_amount != null || o.cgst_amount != null ? (
          <>
            <div className="bill-row">
              <span>SGST{o.sgst_pct != null ? ` (${o.sgst_pct}%)` : ''}</span><span>{inr(o.sgst_amount ?? 0)}</span>
            </div>
            <div className="bill-row">
              <span>CGST{o.cgst_pct != null ? ` (${o.cgst_pct}%)` : ''}</span><span>{inr(o.cgst_amount ?? 0)}</span>
            </div>
          </>
        ) : (
          <div className="bill-row"><span>GST{o.gst_pct != null ? ` (${o.gst_pct}%)` : ''}</span><span>{inr(o.gst_amount)}</span></div>
        )}
        <div className="bill-row total"><span>Total</span><span>{inr(o.total)}</span></div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('/menu')}>
          Order more
        </button>
        {!o.is_parcel && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('/bill')}>
            🧾 Table bill
          </button>
        )}
        {done && (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.print()}>
            Save receipt
          </button>
        )}
      </div>
      {!done && !cancelled && (
        <p className="dim" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          Updates automatically — keep this page open.
        </p>
      )}
    </div>
  );
}
