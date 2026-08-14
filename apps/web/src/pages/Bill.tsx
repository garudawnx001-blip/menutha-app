/** Table bill — the whole table's live bill from get_table_bill. DEFAULT view
 *  is the combined table total (one bill for everyone); a toggle switches to the
 *  per-person split. The combined total always equals the sum of the per-person
 *  totals to the paisa (place_order rounds once per order), so both views
 *  reconcile exactly. Polls every 6s so orders placed by others at the table
 *  appear live. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchTableBill } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { TableBill } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';

function TotalsBlock({ b, sgstPct, cgstPct }: {
  b: { subtotal: number; packing_charge: number; service_charge?: number; sgst_amount?: number; cgst_amount?: number; gst_amount: number; total: number };
  sgstPct?: number | null; cgstPct?: number | null;
}) {
  const hasSplit = b.sgst_amount != null || b.cgst_amount != null;
  return (
    <>
      <div className="bill-row"><span>Subtotal</span><span>{inr(b.subtotal)}</span></div>
      {Number(b.packing_charge) > 0 && (
        <div className="bill-row"><span>Packing charge</span><span>{inr(b.packing_charge)}</span></div>
      )}
      {Number(b.service_charge ?? 0) > 0 && (
        <div className="bill-row"><span>Service charge</span><span>{inr(b.service_charge!)}</span></div>
      )}
      {hasSplit ? (
        <>
          <div className="bill-row"><span>SGST{sgstPct != null ? ` (${sgstPct}%)` : ''}</span><span>{inr(b.sgst_amount ?? 0)}</span></div>
          <div className="bill-row"><span>CGST{cgstPct != null ? ` (${cgstPct}%)` : ''}</span><span>{inr(b.cgst_amount ?? 0)}</span></div>
        </>
      ) : (
        <div className="bill-row"><span>GST</span><span>{inr(b.gst_amount)}</span></div>
      )}
      <div className="bill-row total"><span>Total</span><span>{inr(b.total)}</span></div>
    </>
  );
}

export function Bill() {
  const nav = useNavigate();
  const { session } = useStore();
  const [bill, setBill] = useState<TableBill | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<'combined' | 'split'>('combined');
  const [vpa, setVpa] = useState<string | null>(null);
  const [payQr, setPayQr] = useState('');
  const timer = useRef<ReturnType<typeof setInterval>>();

  // The restaurant's UPI ID isn't part of the cached scan session, so read it
  // directly (public-readable) — this is what makes the pay QR appear here.
  useEffect(() => {
    if (!session?.restaurant.id) return;
    supabase.from('restaurant').select('upi_vpa').eq('id', session.restaurant.id).single()
      .then(({ data }) => setVpa((data?.upi_vpa as string) ?? null))
      .catch(() => {});
  }, [session?.restaurant.id]);

  /** upi://pay for the amount currently shown, regenerated when it changes. */
  const buildPayUri = (amount: number) => {
    if (!vpa || !(amount > 0)) return '';
    const p = new URLSearchParams({
      pa: vpa.trim(), pn: (session?.restaurant.name || 'Restaurant').slice(0, 60),
      am: amount.toFixed(2), tn: `${session?.table.label ?? 'Table'} bill`, cu: 'INR',
    });
    return 'upi://pay?' + p.toString();
  };

  useEffect(() => {
    if (!session) {
      nav('/', { replace: true });
      return;
    }
    let alive = true;
    const load = () =>
      fetchTableBill(session)
        .then((b) => alive && (setBill(b), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    timer.current = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(timer.current);
    };
  }, [session?.table.id]);

  // Render the QR whenever the payable amount or VPA changes.
  useEffect(() => {
    const amt = bill
      ? (mode === 'split'
          ? Number(bill.per_person.find((p) => (p.diner_phone ?? '') === (session?.guest?.phone ?? '').trim())?.total ?? bill.combined.total)
          : Number(bill.combined.total))
      : 0;
    if (!vpa || !(amt > 0) || !session) { setPayQr(''); return; }
    const p = new URLSearchParams({
      pa: vpa.trim(), pn: (session.restaurant.name || 'Restaurant').slice(0, 60),
      am: amt.toFixed(2), tn: `${session.table.label ?? 'Table'} bill`, cu: 'INR',
    });
    QRCode.toDataURL('upi://pay?' + p.toString(), {
      margin: 1, width: 380, color: { dark: '#1C1A15', light: '#FFFDF8' },
    }).then(setPayQr).catch(() => setPayQr(''));
  }, [vpa, bill, mode, session?.guest?.phone]);

  if (!session) return null;
  if (!bill && !failed) return <Spinner label="Adding up your table…" />;

  if (failed && !bill) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <h1 className="display" style={{ fontSize: 26 }}>Couldn’t load the bill</h1>
        <p className="muted" style={{ maxWidth: 380 }}>
          Check your connection and try again — nothing has been charged.
        </p>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  const b = bill!;
  const empty = !b.orders.length;

  // Amount the diner is looking at: the whole table, or their own share in split.
  const myPhone = (session.guest?.phone ?? '').trim();
  const mine = b.per_person.find((p) => (p.diner_phone ?? '') === myPhone);
  const payAmount = mode === 'split' && mine ? Number(mine.total) : Number(b.combined.total);
  const payLabel = mode === 'split' && mine ? `your share` : `the table total`;
  const payUri = buildPayUri(payAmount);
  // Reconciliation guard shown in split mode — the paisa-exact sum of people.
  const splitSum = b.per_person.reduce((a, p) => a + Number(p.total), 0);
  const reconciles = Math.round(splitSum * 100) === Math.round(Number(b.combined.total) * 100);

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/menu')}>← Menu</button>
        <Wordmark size={20} />
      </div>

      <p className="overline" style={{ marginTop: 12 }}>
        {session.restaurant.name}{session.table.is_parcel ? '' : ` · ${session.table.label}`}
      </p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>Table bill</h1>

      {empty ? (
        <div className="center-fill">
          <p className="muted">No open orders at this table yet.</p>
          <button className="btn btn-primary" onClick={() => nav('/menu')}>Browse the menu</button>
        </div>
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Bill view" style={{ marginTop: 16 }}>
            <button
              role="tab" aria-selected={mode === 'combined'}
              className={mode === 'combined' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMode('combined')}
            >
              Whole table
            </button>
            <button
              role="tab" aria-selected={mode === 'split'}
              className={mode === 'split' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMode('split')}
            >
              Split by person
            </button>
          </div>

          {mode === 'combined' ? (
            <>
              <p className="muted" style={{ fontSize: 13.5, margin: '14px 0 8px' }}>
                {b.combined.order_count} order{b.combined.order_count === 1 ? '' : 's'} · one bill for the table
              </p>
              {b.orders.map((o) => (
                <div key={o.order_id} className="glass" style={{ padding: 16, marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{o.diner_name || 'Guest'}</strong>
                    <span className="muted" style={{ fontSize: 12.5, textTransform: 'capitalize' }}>{o.status}</span>
                  </div>
                  {o.items.map((it, i) => (
                    <div key={i} className="bill-row" style={{ fontSize: 14 }}>
                      <span>{it.qty} × {it.name}</span>
                      <span>{inr(it.unit_price * it.qty)}</span>
                    </div>
                  ))}
                  <div className="bill-row" style={{ marginTop: 4 }}>
                    <span className="muted">Order total</span><span>{inr(o.total)}</span>
                  </div>
                </div>
              ))}
              <div className="glass" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
                <p className="overline" style={{ marginBottom: 10 }}>Table total</p>
                <TotalsBlock b={b.combined} sgstPct={b.sgst_pct} cgstPct={b.cgst_pct} />
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13.5, margin: '14px 0 8px' }}>
                Each person’s own dishes, taxed exactly — the parts add up to the table total.
              </p>
              {b.per_person.map((p, i) => (
                <div key={i} className="glass" style={{ padding: 16, marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{p.diner_name || 'Guest'}</strong>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {p.order_count} order{p.order_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}><TotalsBlock b={p} sgstPct={b.sgst_pct} cgstPct={b.cgst_pct} /></div>
                </div>
              ))}
              <div className="glass" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
                <div className="bill-row total">
                  <span>{reconciles ? 'Adds up to the table total' : 'Table total'}</span>
                  <span>{inr(b.combined.total)}</span>
                </div>
              </div>
            </>
          )}

          {/* Scan-to-pay for exactly what's on screen */}
          {payUri ? (
            <div className="glass" style={{ padding: 16, marginTop: 16 }}>
              <p className="overline" style={{ marginBottom: 6 }}>
                Pay {inr(payAmount)} — {payLabel}
              </p>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {payQr && (
                  <img src={payQr} width={132} height={132} alt="UPI payment QR"
                    style={{ borderRadius: 12, border: '1px solid var(--line-strong)' }} />
                )}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p className="muted" style={{ fontSize: 13.5 }}>
                    Scan with any UPI app, or tap below — pays{' '}
                    <strong>{session.restaurant.name}</strong> directly, no fees.
                  </p>
                  <a className="btn btn-primary btn-block" style={{ marginTop: 10 }} href={payUri}>
                    Pay {inr(payAmount)} via UPI
                  </a>
                </div>
              </div>
            </div>
          ) : null}

          <p className="dim" style={{ fontSize: 12, textAlign: 'center', marginTop: 14 }}>
            {payUri
              ? 'Paying by UPI or cash? Just pay — the restaurant marks it received on their side.'
              : 'Pay at the restaurant — cash or UPI at the counter.'} Updates live as your table orders.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('/menu')}>Order more</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.print()}>Save bill</button>
          </div>
        </>
      )}
    </div>
  );
}
