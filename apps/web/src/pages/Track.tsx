/** The diner's order screen — confirmation, what they ordered, and the pay
 *  section. Deliberately NOT a kitchen-status timeline: see the note in the
 *  render below. Polls get_order_status for cancellation and payment state. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchOrderStatus, fetchPaymentQr, startGatewayCheckout, type PaymentQr } from '../lib/api';
import { buildUpiUri, isValidVpa } from '../../../../packages/payments/index.js';
import type { OrderView } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';
import { useT, translateTableLabel } from '../lib/i18n';


/** Pay the restaurant directly: dynamic UPI QR from THEIR VPA, optional card
 *  checkout on THEIR gateway, or cash at the counter. Zero platform fees. */
function PaymentPanel({ order, demo, onChanged }: { order: OrderView; demo?: boolean; onChanged: () => void }) {
  // This was missing, and the panel referenced a `t` that existed only in the
  // sibling component below — so every render threw "t is not defined" and the
  // whole tracking screen went blank. It shipped because CI runs `npx vite
  // build` with tsc deliberately skipped: esbuild strips types without ever
  // resolving identifiers, so an undefined name compiles cleanly and fails in
  // the diner's hand instead.
  const t = useT();
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
    catch (e: any) { setError(e?.message ?? t('common.somethingWrong')); }
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
          {p.provider === 'cash' ? t('track.payingCash') : t('track.upiMarked')}
        </strong>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          {t('track.awaitingConfirm')}
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
          {busy === 'gw' ? t('common.opening') : `💳 ${t('track.payCard')}`}
        </button>
      )}
      <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
        {t('track.payDirect')}
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

export function Track() {
  const { id = '' } = useParams();
  const t = useT();
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

  if (!order && !failed) return <Spinner label={t('track.loading')} />;

  if (failed && !order) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <h1 className="display" style={{ fontSize: 26 }}>{t('track.loadFail')}</h1>
        <p className="muted" style={{ maxWidth: 380 }}>
          {t('track.connError')}
        </p>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>{t('common.retry')}</button>
      </div>
    );
  }

  const o = order!;
  const cancelled = o.status === 'cancelled';
  const done = o.status === 'served';

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/menu')}>← {t('cart.back')}</button>
        <span className="badge gold">
          {o.is_parcel
            ? `📦 ${t('menu.parcel')}`
            : `🍽 ${o.table_label ? translateTableLabel(o.table_label) : t('common.table')}`}
        </span>
      </div>

      <p className="overline" style={{ marginTop: 12 }}>
        {o.restaurant_name}{o.order_no ? ` · ${t('track.orderNo')} #${o.order_no}` : ''}
      </p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>
        {cancelled ? t('track.cancelled') : done ? t('track.servedEnjoy') : t('track.live')}
      </h1>

      {cancelled ? (
        <div className="glass" style={{ padding: 18, marginTop: 18, borderColor: 'rgba(199,107,92,0.5)' }}>
          <p style={{ color: 'var(--error)', fontWeight: 700 }}>{t('track.cancelledBody')}</p>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            {t('track.speakToStaff')}
          </p>
        </div>
      ) : (
        <div className="glass" style={{ padding: '20px', marginTop: 18 }}>
          {/* Order confirmed + what was ordered. The kitchen's stage-by-stage
              status was removed on the client's instruction: the diner is
              sitting at the table and can see their food arrive, so a
              Placed/Cooking/Ready/Served timeline was theatre that invited
              "why is it still on Preparing?" questions at the counter. The
              kitchen still runs those statuses on their own board. */}
          <p style={{ fontSize: 34, lineHeight: 1 }} aria-hidden>✓</p>
          <h2 style={{ fontSize: 21, fontWeight: 700, marginTop: 8 }}>
            {t('track.confirmed')}
          </h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
            {t('track.confirmedBody')}
            {o.is_parcel ? ' the counter' : ` ${session?.table.label ?? 'your table'}`}.
          </p>
          {/* Passive estimate only. Deliberately no alert, push or countdown
              ticking down to a promise: diners are anonymous with no push
              channel, and telling someone their food is ready when the kitchen
              is backed up is worse than saying nothing. A quiet "about N
              minutes" on a page they already have open is the honest limit. */}
          {(o as any).ready_at && !done && !cancelled && (() => {
            const mins = Math.max(0, Math.round((new Date((o as any).ready_at).getTime() - Date.now()) / 60000));
            return (
              <p className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                {mins > 0 ? `${t('track.approx')} ${mins} ${t('track.minutes')}` : t('track.anyMoment')}
              </p>
            );
          })()}

          <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            {(o.items ?? []).map((it, i) => (
              <div key={i} className="bill-row" style={{ fontSize: 14 }}>
                <span>{it.qty} × {it.name}</span>
                <span>{inr(it.unit_price * it.qty)}</span>
              </div>
            ))}
            {o.notes && (
              <p className="dim" style={{ fontSize: 12.5, fontStyle: 'italic', marginTop: 6 }}>“{o.notes}”</p>
            )}
          </div>
        </div>
      )}

      {!cancelled && (
        <PaymentPanel order={o} demo={session?.demo || id === 'demo-order'} onChanged={() => {
          fetchOrderStatus(session, id).then(setOrder).catch(() => {});
        }} />
      )}

      <div className="glass" style={{ padding: 16, marginTop: 16 }}>
        <p className="overline" style={{ marginBottom: 10 }}>{t('track.receipt')}</p>
        {o.items.map((it, i) => (
          <div key={i} className="bill-row">
            <span>{it.qty} × {it.name}</span>
            <span>{inr(it.unit_price * it.qty)}</span>
          </div>
        ))}
        <div className="bill-row"><span>{t('bill.subtotal')}</span><span>{inr(o.subtotal)}</span></div>
        {Number(o.packing_charge) > 0 && (
          <div className="bill-row"><span>{t('bill.packing')}</span><span>{inr(o.packing_charge)}</span></div>
        )}
        {Number(o.service_charge ?? 0) > 0 && (
          <div className="bill-row"><span>{t('bill.service')}</span><span>{inr(o.service_charge!)}</span></div>
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
          {t('track.orderMore')}
        </button>
        {!o.is_parcel && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('/bill')}>
            🧾 Table bill
          </button>
        )}
        {done && (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.print()}>
            {t('track.saveReceipt')}
          </button>
        )}
      </div>
      {!done && !cancelled && (
        <p className="dim" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          {t('track.autoUpdates')}
        </p>
      )}
    </div>
  );
}
