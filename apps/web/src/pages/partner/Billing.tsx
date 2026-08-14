/** Billing: merge a table's unpaid orders into one bill, include/exclude
 *  orders, discount (manager+), 5% GST recompute, printable GST bill,
 *  mark paid (Cash / UPI received). */
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { fetchLiveOrders, createBill, payBill, type PortalOrder } from '../../lib/portalApi';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

interface BillDraft {
  id: string; bill_no: number; subtotal: number; discount: number; gst_amount: number; total: number;
  orders: PortalOrder[];
}

export function Billing() {
  const { restaurant, role } = usePartner();
  const [orders, setOrders] = useState<PortalOrder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState('');
  const [bill, setBill] = useState<BillDraft | null>(null);
  const [billQr, setBillQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  const canDiscount = role === 'owner' || role === 'manager';

  const load = async () => {
    try {
      const all = await fetchLiveOrders(restaurant.id, ['placed', 'accepted', 'preparing', 'ready', 'served']);
      setOrders(all.filter((o) => !o.paid));
    } catch (e: any) { setError(e?.message ?? 'Could not load orders.'); }
  };
  useEffect(() => { load(); }, [restaurant.id]);

  const byTable = useMemo(() => {
    const g = new Map<string, PortalOrder[]>();
    for (const o of orders ?? []) {
      const key = o.is_parcel ? '📦 Parcel' : (o.table_label ?? 'Table');
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(o);
    }
    return [...g.entries()];
  }, [orders]);

  const chosen = (orders ?? []).filter((o) => selected.has(o.id));
  const subtotal = chosen.reduce((a, o) => a + o.subtotal + o.packing_charge, 0);
  const service = chosen.reduce((a, o) => a + Number((o as any).service_charge ?? 0), 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  // Owner-configured Indian GST split (SGST + CGST), matching place_order.
  const sgstPct = Number((restaurant as any).sgst_pct ?? 2.5);
  const cgstPct = Number((restaurant as any).cgst_pct ?? 2.5);
  const taxable = subtotal + service - disc;
  const sgst = Math.round(taxable * sgstPct) / 100;
  const cgst = Math.round(taxable * cgstPct) / 100;
  const gst = sgst + cgst;
  const total = Math.round((taxable + gst) * 100) / 100;

  /** upi://pay deep link for the exact bill total — same VPA diners pay. */
  const billUpiUri = (amount: number, billNo: number | string) => {
    const vpa = (restaurant as any).upi_vpa as string | undefined;
    if (!vpa) return '';
    const p = new URLSearchParams({
      pa: vpa.trim(), pn: (restaurant.name || 'Restaurant').slice(0, 60),
      am: Number(amount).toFixed(2), tn: `Bill #${billNo}`, cu: 'INR',
    });
    return 'upi://pay?' + p.toString();
  };

  const generate = async () => {
    if (!chosen.length || busy) return;
    setBusy(true); setError('');
    try {
      const b = await createBill(restaurant.id, chosen.map((o) => o.id), disc);
      setBill({ ...b, orders: chosen });
      // Scan-to-pay QR for the exact bill total (blank if no VPA configured).
      const uri = billUpiUri(b.total, b.bill_no);
      setBillQr(uri
        ? await QRCode.toDataURL(uri, { margin: 1, width: 380, color: { dark: '#1C1A15', light: '#FFFDF8' } }).catch(() => '')
        : '');
    } catch (e: any) { setError(e?.message ?? 'Could not create the bill.'); }
    finally { setBusy(false); }
  };

  const settle = async (mode: 'cash' | 'upi_qr') => {
    if (!bill || busy) return;
    setBusy(true); setError('');
    try {
      await payBill(bill.id, mode);
      setBill(null); setBillQr(''); setSelected(new Set()); setDiscount('');
      await load();
    } catch (e: any) { setError(e?.message ?? 'Could not mark the bill paid.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (printing) {
      const t = setTimeout(() => { window.print(); setPrinting(false); }, 300);
      return () => clearTimeout(t);
    }
  }, [printing]);

  if (orders === null) return <Spinner label="Loading unpaid orders…" />;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Billing</p>
      <h1 className="display" style={{ fontSize: 26 }}>Settle a table</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        Pick the orders to merge into one bill. Diners pay you directly — cash
        or your own UPI.
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, margin: '10px 0' }}>{error}</p>}

      {byTable.length === 0 && (
        <div className="glass" style={{ padding: 20, marginTop: 14, textAlign: 'center' }}>
          <p className="muted">No unpaid orders right now. 🎉</p>
        </div>
      )}

      {byTable.map(([tableName, list]) => (
        <section key={tableName}>
          <h2 className="cat-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            {tableName}
            <button className="chip" onClick={() => {
              const next = new Set(selected);
              const allIn = list.every((o) => next.has(o.id));
              list.forEach((o) => (allIn ? next.delete(o.id) : next.add(o.id)));
              setSelected(next);
            }}>
              {list.every((o) => selected.has(o.id)) ? 'Unselect all' : 'Select all'}
            </button>
          </h2>
          <div className="glass" style={{ padding: '4px 16px' }}>
            {list.map((o) => (
              <label key={o.id} className="row-item" style={{ cursor: 'pointer' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.has(o.id)} style={{ width: 18, height: 18 }}
                    onChange={() => {
                      const next = new Set(selected);
                      next.has(o.id) ? next.delete(o.id) : next.add(o.id);
                      setSelected(next);
                    }} />
                  <span>
                    <span style={{ fontWeight: 600, fontSize: 14.5 }}>#{o.order_no}</span>
                    <span className="muted" style={{ fontSize: 13 }}> · {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ').slice(0, 60)}</span>
                  </span>
                </span>
                <span style={{ fontWeight: 700 }}>{inr(o.subtotal + o.packing_charge)}</span>
              </label>
            ))}
          </div>
        </section>
      ))}

      {chosen.length > 0 && !bill && (
        <div className="glass-strong" style={{ padding: 16, marginTop: 16 }}>
          <div className="bill-row"><span>{chosen.length} order(s) — subtotal</span><span>{inr(subtotal)}</span></div>
          {canDiscount && (
            <div className="bill-row">
              <span>Discount (₹)</span>
              <input className="code-input" style={{ width: 110, padding: '6px 10px', textAlign: 'right' }}
                inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
          )}
          {service > 0 && (
            <div className="bill-row"><span>Service charge</span><span>{inr(service)}</span></div>
          )}
          <div className="bill-row"><span>SGST ({sgstPct}%)</span><span>{inr(sgst)}</span></div>
          <div className="bill-row"><span>CGST ({cgstPct}%)</span><span>{inr(cgst)}</span></div>
          <div className="bill-row total"><span>Total</span><span>{inr(total)}</span></div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={generate}>
            {busy ? 'Creating bill…' : 'Generate bill'}
          </button>
        </div>
      )}

      {bill && (
        <div className="glass-strong" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
          <div className="topbar" style={{ padding: 0 }}>
            <strong>Bill #{bill.bill_no}</strong>
            <button className="chip" onClick={() => setPrinting(true)}>🖨 Print GST bill</button>
          </div>
          <div className="bill-row total"><span>To collect</span><span>{inr(bill.total)}</span></div>

          {/* Scan-to-pay: UPI QR for the exact bill total */}
          {billQr ? (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <img src={billQr} width={132} height={132} alt="UPI QR for this bill"
                style={{ borderRadius: 12, border: '1px solid var(--line-strong)' }} />
              <p className="muted" style={{ fontSize: 13.5, flex: 1, minWidth: 170 }}>
                Show this to the diner — any UPI app scans it and pays <strong>{inr(bill.total)}</strong> straight to you.
                Or take cash below.
              </p>
            </div>
          ) : (
            <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
              Add your UPI ID in Settings to show a scan-to-pay QR on every bill.
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => settle('cash')}>
              ₹ Cash received
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => settle('upi_qr')}>
              UPI received
            </button>
          </div>
        </div>
      )}

      {printing && bill && (
        <div className="printable" style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 13 }}>
          <h2 style={{ fontFamily: 'Georgia, serif' }}>{restaurant.name}</h2>
          <p>{restaurant.address ?? ''} {restaurant.city ?? ''}</p>
          {restaurant.gstin && <p>GSTIN: {restaurant.gstin}</p>}
          <hr style={{ margin: '10px 0' }} />
          <p><strong>TAX INVOICE — Bill #{bill.bill_no}</strong> · {new Date().toLocaleString('en-IN')}</p>
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
            <tbody>
              {bill.orders.flatMap((o) => o.items.map((it, i) => (
                <tr key={o.id + i}>
                  <td style={{ padding: '3px 0' }}>{it.qty}× {it.name}</td>
                  <td style={{ textAlign: 'right' }}>{inr(it.unit_price * it.qty)}</td>
                </tr>
              )))}
              <tr><td style={{ paddingTop: 8 }}>Subtotal</td><td style={{ textAlign: 'right', paddingTop: 8 }}>{inr(bill.subtotal)}</td></tr>
              {bill.discount > 0 && <tr><td>Discount</td><td style={{ textAlign: 'right' }}>− {inr(bill.discount)}</td></tr>}
              <tr><td>SGST {sgstPct}%</td><td style={{ textAlign: 'right' }}>{inr(bill.gst_amount * (sgstPct / (sgstPct + cgstPct || 1)))}</td></tr>
              <tr><td>CGST {cgstPct}%</td><td style={{ textAlign: 'right' }}>{inr(bill.gst_amount * (cgstPct / (sgstPct + cgstPct || 1)))}</td></tr>
              <tr style={{ fontWeight: 700 }}><td style={{ paddingTop: 6 }}>TOTAL</td><td style={{ textAlign: 'right', paddingTop: 6 }}>{inr(bill.total)}</td></tr>
            </tbody>
          </table>
          {/* Scan-to-pay QR embedded IN the printed/shared bill itself */}
          {billQr && (
            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
              <img src={billQr} width={120} height={120} alt="" style={{ border: '1px solid #ddd', borderRadius: 8 }} />
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <strong>Scan to pay {inr(bill.total)}</strong><br />
                Any UPI app · pays {restaurant.name} directly<br />
                <span style={{ color: '#666' }}>{(restaurant as any).upi_vpa}</span>
              </div>
            </div>
          )}
          <p style={{ marginTop: 14, fontSize: 11, color: '#666' }}>SAC 996331 · Thank you — powered by Menutha</p>
        </div>
      )}
    </div>
  );
}
