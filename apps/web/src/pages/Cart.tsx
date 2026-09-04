/** Cart & checkout — line steppers, cooking instructions, the bill (subtotal,
 *  parcel packing charge, 5% GST) mirroring the server's place_order math. */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { placeOrder } from '../lib/api';
import { calcBill, inr } from '../lib/types';
import { useStore } from '../store';
import { useT, translateTableLabel } from '../lib/i18n';
import { Spinner } from '../components';
import { Stepper, VegMark, Wordmark } from '../components';

export function Cart() {
  const nav = useNavigate();
  const { session, cart, setQty, clearCart } = useStore();
  const t = useT();
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  // What everyone else at this table has already ordered (shared session).


  useEffect(() => {
    // /table, not / --  is the marketing landing on the deployed site.
    // /table, not '/' -- the site root is the marketing landing on the
    // deployed site, and a diner must never be sent to a restaurant login.
    if (!session) nav('/table', { replace: true });
  }, [session]);
  // A Spinner, not null: the redirect runs in an effect, after this render,
  // so null paints a blank white frame on the way to the gate.
  if (!session) return <Spinner label="…" />;

  const packing = session.table.is_parcel ? Number(session.restaurant.parcel_charge ?? 0) : 0;
  const sgstPct = Number(session.restaurant.sgst_pct ?? 2.5);
  const cgstPct = Number(session.restaurant.cgst_pct ?? 2.5);
  const svcPct = Number(session.restaurant.service_charge_pct ?? 0);
  const bill = calcBill(cart, packing, sgstPct, cgstPct, svcPct);

  const submit = async () => {
    if (placing || !cart.length) return;
    setPlacing(true);
    setError('');
    try {
      const order = await placeOrder(session, cart, notes.trim() || undefined);
      clearCart();
      nav(`/track/${order.id}`, { replace: true });
    } catch (e: any) {
      setError(e?.message ?? t('common.somethingWrong'));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/menu')}>← {t('cart.back')}</button>
        <Wordmark size={20} />
      </div>

      <h1 className="display" style={{ fontSize: 28, margin: '10px 0 2px' }}>{t('cart.title')}</h1>
      <p className="muted" style={{ fontSize: 14 }}>
        {session.restaurant.name} ·{' '}
        {session.table.is_parcel ? t('menu.parcel') : translateTableLabel(session.table.label)}
      </p>

      {!cart.length ? (
        <div className="center-fill">
          <p className="muted">{t('cart.empty')}</p>
          <button className="btn btn-primary" onClick={() => nav('/menu')}>{t('cart.browse')}</button>
        </div>
      ) : (
        <>
          <div className="glass" style={{ padding: 16, marginTop: 16 }}>
            {cart.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: i < cart.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <VegMark veg={l.isVeg} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: 15 }}>{l.name}</p>
                  {l.optionLabels.length > 0 && (
                    <p className="muted" style={{ fontSize: 12.5 }}>{l.optionLabels.join(' · ')}</p>
                  )}
                  <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {inr((l.price + l.optionDelta) * l.qty)}
                  </p>
                </div>
                <Stepper qty={l.qty} onChange={(q) => setQty(i, q)} />
              </div>
            ))}
          </div>


          <div style={{ marginTop: 16 }}>
            <p className="overline" style={{ marginBottom: 8 }}>{t('cart.instructions')}</p>
            <textarea
              className="notes"
              placeholder={t('cart.instructionsPh')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="glass" style={{ padding: 16, marginTop: 16 }}>
            <div className="bill-row"><span>{t('bill.subtotal')}</span><span>{inr(bill.subtotal)}</span></div>
            {packing > 0 && (
              <div className="bill-row"><span>{t('bill.packing')}</span><span>{inr(packing)}</span></div>
            )}
            {bill.service > 0 && (
              <div className="bill-row"><span>Service charge ({svcPct}%)</span><span>{inr(bill.service)}</span></div>
            )}
            <div className="bill-row"><span>SGST ({sgstPct}%)</span><span>{inr(bill.sgst)}</span></div>
            <div className="bill-row"><span>CGST ({cgstPct}%)</span><span>{inr(bill.cgst)}</span></div>
            <div className="bill-row total"><span>Total</span><span>{inr(bill.total)}</span></div>
            <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
              {t('cart.payAtRestaurant')}
            </p>
          </div>

          {error && (
            <p style={{ color: 'var(--error)', fontSize: 14, marginTop: 12 }}>{error}</p>
          )}

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 16 }}
            disabled={placing}
            onClick={submit}
          >
            {placing ? t('cart.place') + '…' : `${t('cart.place')} · ${inr(bill.total)}`}
          </button>
          <p className="dim" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            {t('cart.kitchenSeesNow')}
          </p>
        </>
      )}
    </div>
  );
}
