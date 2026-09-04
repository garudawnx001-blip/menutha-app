/** Billing: merge a table's unpaid orders into one bill, include/exclude
 *  orders, discount (manager+), 5% GST recompute, printable GST bill,
 *  mark paid (Cash / UPI received). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchLiveOrders, createBill, payBill, fetchBillLayout, setOrdersAc, type PortalOrder } from '../../lib/portalApi';
import { renderBillHtml, type BillData } from '../../lib/billTemplate';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

interface BillDraft {
  id: string; bill_no: number; subtotal: number; discount: number; gst_amount: number; total: number;
  orders: PortalOrder[];
}

/* The paper picker is gone. A bill printed on the roll that is physically in
   the machine is the only correct outcome, and the print dialog already knows
   which one that is — asking first, in a second vocabulary, only created a way
   to be wrong. The bill now reflows off the real page width (theme.css), so
   80mm and 58mm rolls get monospace and narrow columns without anyone
   choosing. */


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
  // The owner's bill layout. Null until it loads and null forever if the
  // column is not there yet -- normaliseLayout inside the template turns both
  // into the house layout, so printing never waits on this.
  const [layout, setLayout] = useState<any>(null);
  // Which table has its per-person list expanded.
  const [splitting, setSplitting] = useState<string | null>(null);
  // Opened from a ticket on the Orders board: focus that table straight away
  // so settling is one tap from the notification, not a hunt.
  const [params] = useSearchParams();
  const focusTable = params.get('table');

  const canDiscount = role === 'owner' || role === 'manager';

  /* Synchronous re-entry guard for the three handlers that create or settle a
     bill. `busy` is React state, so setBusy only schedules a re-render — a
     second click landing before that render still passes `if (busy)`, and both
     calls reach create_table_bill. That leaves two bill rows for the same
     orders. A ref flips in the same tick, so the second click sees it. */
  const inFlight = useRef(false);
  const guard = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await fn(); } finally { inFlight.current = false; }
  };

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
    // A table opened from the Orders board sorts to the top, so the thing
    // staff just tapped is the thing they see.
    const rows = [...g.entries()];
    if (focusTable) {
      rows.sort((a, b) => (b[0] === focusTable ? 1 : 0) - (a[0] === focusTable ? 1 : 0));
    }
    return rows;
  }, [orders, focusTable]);

  const chosen = (orders ?? []).filter((o) => selected.has(o.id));
  // The restaurant-level master. With AC pricing off, the override row is not
  // shown at all -- a control that cannot change a number is a control that
  // should not be on the screen.
  const acPricing = (restaurant as any).ac_pricing === true;
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

  /** One-tap billing. Previously the only route was: find the table, tap
   *  "Select all", scroll past the list, tap "Generate bill" — two taps plus a
   *  scroll for the commonest action in the whole product. billNow takes the
   *  orders straight to a bill, bypassing the selection step entirely.
   *  The checkboxes remain for the rare arbitrary subset. */
  const billNow = (list: PortalOrder[]) => guard(async () => {
    if (!list.length || busy) return;
    setBusy(true); setError('');
    try {
      const b = await createBill(restaurant.id, list.map((o) => o.id), 0);
      setSelected(new Set(list.map((o) => o.id)));
      setDiscount('');
      setBill({ ...b, orders: list });
      const uri = billUpiUri(b.total, b.bill_no);
      setBillQr(uri
        ? await QRCode.toDataURL(uri, { margin: 1, width: 380, color: { dark: '#1C1A15', light: '#FFFDF8' } }).catch(() => '')
        : '');
    } catch (e: any) { setError(e?.message ?? 'Could not create the bill.'); }
    finally { setBusy(false); }
  });

  /** Orders at a table grouped by who ordered, for per-person billing. */
  const byDiner = (list: PortalOrder[]) => {
    const g = new Map<string, PortalOrder[]>();
    for (const o of list) {
      const key = (o.guest_name ?? '').trim() || 'Guest';
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(o);
    }
    return [...g.entries()];
  };

  const sumOf = (list: PortalOrder[]) => list.reduce((a, o) => a + Number(o.total || 0), 0);

  const generate = () => guard(async () => {
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
  });

  const settle = (mode: 'cash' | 'upi_qr') => guard(async () => {
    if (!bill || busy) return;
    setBusy(true); setError('');
    try {
      await payBill(bill.id, mode);
      setBill(null); setBillQr(''); setSelected(new Set()); setDiscount('');
      await load();
    } catch (e: any) { setError(e?.message ?? 'Could not mark the bill paid.'); }
    finally { setBusy(false); }
  });
  /**
   * The bill, in the shape the shared template renders. Everything about how
   * it LOOKS lives in that template; this only says what the numbers are.
   *
   * The SGST/CGST split is apportioned from the stored gst_amount by the two
   * configured rates rather than halved, which is the same rule the phone's
   * invoice follows: halving is only correct while the two rates are equal,
   * and 9+9 hides the error where 9+2.5 shows it on every bill.
   */
  /**
   * #R — the AC override, and null is the important value.
   *
   * null means "auto": nobody has touched it and the server resolves the
   * service rate from the table's own is_ac flag. That is the normal path and
   * the one that needs no staff action at all. true/false is a deliberate
   * correction. The three states are why this is not a boolean.
   */
  const [acChoice, setAcChoice] = useState<boolean | null>(null);

  const applyAc = async (v: boolean | null) => {
    if (busy) return;
    setAcChoice(v);
    // null = back to auto, which the server expresses as a null override. The
    // RPC takes a boolean, so "auto" is not something it can be told -- and
    // re-deriving it here would be a second implementation of the rate. Auto
    // is restored by regenerating the bill, which is the honest answer until
    // the RPC grows a null case.
    if (v === null) return;
    setBusy(true); setError('');
    try {
      const applied = await setOrdersAc(chosen.map((o) => o.id), v);
      if (!applied) {
        setError('AC pricing is not switched on in this database yet — the table’s own setting still applies.');
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the AC setting.');
    } finally { setBusy(false); }
  };

  const printData = (): BillData => {
    const b = bill!;
    const rateSum = (sgstPct + cgstPct) || 1;
    return {
      restaurant: {
        name: restaurant.name ?? '',
        address: (restaurant as any).address ?? '',
        city: restaurant.city ?? '',
        phone: (restaurant as any).phone ?? '',
        gstin: restaurant.gstin ?? '',
        fssai: (restaurant as any).fssai_no ?? '',
        thanks: (restaurant as any).bill_thanks ?? (restaurant as any).bill_footer ?? '',
        terms: (restaurant as any).bill_terms ?? '',
        logoUrl: (restaurant as any).logo_url ?? null,
      },
      billNo: `Bill #${b.bill_no}`,
      dateText: new Date().toLocaleString('en-IN'),
      // The label from the orders themselves. A bill can span several orders
      // at one table, so the first one's label is the table's; a parcel bill
      // says so, and 'Dine-in' is the honest answer when nothing carries a
      // label rather than a table number nobody chose.
      tableText: b.orders[0]?.is_parcel
        ? 'Parcel / Takeaway'
        : (b.orders[0]?.table_label ?? 'Dine-in'),
      // The diner's own name, where an order carried one -- a bill that says
      // "Guest" beside a name the kitchen already knew is a bill that looks
      // like it belongs to somebody else.
      customer: {
        name: b.orders.find((o) => o.guest_name)?.guest_name ?? 'Guest',
        phone: b.orders.find((o) => o.guest_phone)?.guest_phone ?? '',
      },
      items: b.orders.flatMap((o) => o.items.map((it) => ({
        name: it.name, qty: it.qty, unit_price: it.unit_price,
      }))),
      subtotal: b.subtotal,
      discount: b.discount,
      // SUMMED FROM THE ORDERS, not zero. I had hardcoded both when moving the
      // printed bill onto the shared template, which meant a restaurant with a
      // parcel charge or a service charge printed a bill that silently omitted
      // them while the total still included them -- the lines would not add up.
      // The orders carry the real figures; create_table_bill only returns the
      // subtotal, discount, GST and total.
      packing: b.orders.reduce((a, o) => a + Number(o.packing_charge ?? 0), 0),
      // The AC rate is already inside this number (#R): the server resolved
      // which service percentage applied from the table's own AC flag. It
      // prints as the ordinary "Service charge" line, with no mention of AC.
      service: b.orders.reduce((a, o) => a + Number((o as any).service_charge ?? 0), 0),
      sgstPct, cgstPct,
      sgst: Math.round(b.gst_amount * (sgstPct / rateSum) * 100) / 100,
      cgst: Math.round(b.gst_amount * (cgstPct / rateSum) * 100) / 100,
      total: b.total,
      payQrDataUri: billQr || null,
      upiVpa: (restaurant as any).upi_vpa ?? null,
    };
  };

  useEffect(() => {
    fetchBillLayout(restaurant.id).then(setLayout).catch(() => {});
  }, [restaurant.id]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 300);
    return () => clearTimeout(t);
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

      {byTable.map(([tableName, list]) => {
        const diners = byDiner(list);
        return (
        <section key={tableName}>
          <h2 className="cat-heading" style={{ marginBottom: 8 }}>{tableName}</h2>

          {/* The two things staff actually want, as full-width primary actions
              rather than a small "Select all" chip followed by a scroll. Both
              go straight to a finished bill in one tap. */}
          <div className="bill-actions">
            <button className="btn btn-primary" disabled={busy}
              onClick={() => billNow(list)}>
              🧾 Bill whole table · {inr(sumOf(list))}
            </button>
            {diners.length > 1 && (
              <button className="btn btn-ghost" disabled={busy}
                onClick={() => setSplitting((s) => (s === tableName ? null : tableName))}
                aria-expanded={splitting === tableName}>
                👥 Split by person ({diners.length})
              </button>
            )}
          </div>

          {splitting === tableName && diners.length > 1 && (
            <div className="glass" style={{ padding: 12, marginBottom: 10 }}>
              <p className="overline" style={{ marginBottom: 8 }}>Bill one person</p>
              {diners.map(([who, theirs]) => (
                <div key={who} className="row-item">
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{who}</strong>
                    <span className="dim" style={{ display: 'block', fontSize: 12 }}>
                      {theirs.length} order{theirs.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13 }}
                    disabled={busy} onClick={() => billNow(theirs)}>
                    Bill {inr(sumOf(theirs))}
                  </button>
                </div>
              ))}
            </div>
          )}

          <details className="pick-some">
            <summary>Or pick individual orders</summary>
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
          </details>
        </section>
      );
      })}

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
          {/* #R — THE FALLBACK, and it is only a fallback.
              The AC rate applies AUTOMATICALLY from the table's own is_ac flag:
              the QR already knows which room it is in, the server resolves the
              service percentage from it, and staff do nothing. This row exists
              for when that answer is wrong — a party moved into the AC room, a
              table flagged after the order went in — and flipping it re-totals
              the orders so the Service charge line is right before anything
              prints.

              It says "Air-conditioned", never "AC charge", and it changes a
              RATE rather than adding a line: nothing here reaches the diner's
              bill as its own row. */}
          {acPricing && (
            <div className="bill-row">
              <span>Air-conditioned table</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {([['Auto', null], ['Yes', true], ['No', false]] as [string, boolean | null][]).map(([lbl, v]) => (
                  <button
                    key={lbl}
                    className={acChoice === v ? 'chip active' : 'chip'}
                    disabled={busy}
                    onClick={() => applyAc(v)}
                  >{lbl}</button>
                ))}
              </span>
            </div>
          )}
          <div className="bill-row"><span>SGST ({sgstPct}%)</span><span>{inr(sgst)}</span></div>
          <div className="bill-row"><span>CGST ({cgstPct}%)</span><span>{inr(cgst)}</span></div>
          <div className="bill-row total"><span>Total</span><span>{inr(total)}</span></div>
          <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 12 }} disabled={busy} onClick={generate}>
            {'Generate bill'}
          </button>
        </div>
      )}

      {bill && (
        <div className="glass-strong" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
          <div className="topbar" style={{ padding: 0 }}>
            <strong>Bill #{bill.bill_no}</strong>
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button className="chip" onClick={() => setPrinting(true)}>🖨 Print bill</button>
            </span>
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
        /**
         * THE PRINTED BILL IS THE SHARED TEMPLATE NOW, not JSX that happened
         * to look similar. This block used to be its own markup — a narrow
         * centred receipt — while the phone printed a wide A4 GST table, so a
         * diner handed one from the counter and one from the phone was looking
         * at two products. Both call renderBillHtml today.
         *
         * dangerouslySetInnerHTML is doing what it says and it is safe here
         * for a specific reason rather than a hopeful one: every value the
         * template interpolates goes through its own `esc`, and the string is
         * assembled by a function in this repo, not fetched. React's escaping
         * is not available to us because the thing being inserted IS a
         * document — that is the point of sharing it.
         */
        <div
          className="printable"
          dangerouslySetInnerHTML={{ __html: renderBillHtml(printData(), layout) }}
        />
      )}
    </div>
  );
}
