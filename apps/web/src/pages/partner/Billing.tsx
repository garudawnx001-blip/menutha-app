/** Billing: merge a table's unpaid orders into one bill, include/exclude
 *  orders, discount (manager+), 5% GST recompute, printable GST bill,
 *  mark paid (Cash / UPI received). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchLiveOrders, createBill, payBill, fetchBillLayout, setOrdersAc, waiveService, setParcelPacking, type PortalOrder } from '../../lib/portalApi';
import { supabase } from '../../lib/supabase';
import { WalkIn } from './WalkIn';
import { renderBillHtml, type BillData } from '../../lib/billTemplate';
import { printBillHtml } from '../../lib/printBill';
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
  const [waiving, setWaiving] = useState(false);
  /** Boxes currently charged on the open bill. Mirrors bill.parcel_boxes, and
   *  reset whenever a different bill is raised. */
  const [parcelBoxes, setParcelBoxes] = useState(0);
  const [parcelBusy, setParcelBusy] = useState(false);
  const [parcelNote, setParcelNote] = useState('');

  /**
   * Optimistic on the count, truthful on the money.
   *
   * The number moves immediately -- a stepper that waits for a round trip
   * gets pressed twice. The TOTAL only changes when the server says what it
   * actually charged, because that is the figure somebody is about to be
   * asked to pay.
   */
  const changeBoxes = (next: number) => guard(async () => {
    const n = Math.max(0, next);
    if (!bill || parcelBusy) return;
    const prev = parcelBoxes;
    setParcelBoxes(n);
    setParcelBusy(true);
    setParcelNote('');
    try {
      const r = await setParcelPacking(bill.id, n);
      if (!r.applied && r.reason) {
        setParcelBoxes(Number(r.parcel_boxes ?? prev));
        setParcelNote(r.reason);
      } else {
        setParcelBoxes(Number(r.parcel_boxes ?? n));
        /* Re-read the row rather than adding the delta locally. The server
           owns the total -- it also backs out whatever this function charged
           before -- and a number the counter is about to collect should come
           from the same place the printed sheet reads. */
        const { data: fresh } = await supabase
          .from('bill').select('total, parcel_charge, parcel_boxes')
          .eq('id', bill.id).maybeSingle();
        if (fresh) {
          setBill((b) => (b ? { ...b, total: Number((fresh as any).total) } : b));
          setParcelBoxes(Number((fresh as any).parcel_boxes ?? n));
        }
      }
    } catch (e: any) {
      setParcelBoxes(prev);
      setParcelNote(e?.message ?? 'Could not change the packing charge.');
    } finally { setParcelBusy(false); }
  });

('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  /**
   * WAIVED IS READ OFF THE ORDERS, not held in a checkbox.
   *
   * The server owns this: waive_order_service sets the flag and repricess, so
   * the orders coming back from the board already say what happened. A local
   * boolean would be a second opinion that survives a reload and outlives a
   * failed call -- the screen claiming a charge was dropped when it was not.
   */
  const waived = chosen.length > 0 && chosen.every((o) => (o as any).service_waived === true);

  const toggleWaive = (next: boolean) => guard(async () => {
    if (!chosen.length || waiving) return;
    setWaiving(true); setError('');
    try {
      await waiveService(chosen.map((o) => o.id), next);
      await load();
    } catch (e: any) {
      // PGRST202 is PostgREST saying the function is not in its schema -- the
      // migration has not been run. That is a sentence somebody can act on,
      // where the raw error is not.
      setError(/PGRST202|could not find the function/i.test(String(e?.message ?? ''))
        ? 'Removing the service charge needs the database update that is staged for this restaurant. Nothing has changed on this bill.'
        : (e?.message ?? 'Could not change the service charge.'));
    } finally { setWaiving(false); }
  });
  /**
   * A DISCOUNT CANNOT BE NEGATIVE, and this was only clamped at the top.
   *
   * `-500` made taxable = subtotal + service + 500: the "discount" INCREASED
   * the bill, the GST on it, and the UPI QR the diner is shown and pays. A
   * bound at one end of a money field is not a bound.
   */
  const disc = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  // Owner-configured Indian GST split (SGST + CGST), matching place_order.
  const sgstPct = Number((restaurant as any).sgst_pct ?? 2.5);
  const cgstPct = Number((restaurant as any).cgst_pct ?? 2.5);
  const taxable = subtotal + service - disc;
  const sgst = Math.round(taxable * sgstPct) / 100;
  const cgst = Math.round(taxable * cgstPct) / 100;
  const gst = sgst + cgst;
  const total = Math.round((taxable + gst) * 100) / 100;

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
      setBill({ ...b, orders: list }); setParcelBoxes(0); setParcelNote('');
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
      setBill({ ...b, orders: chosen }); setParcelBoxes(0); setParcelNote('');
    } catch (e: any) { setError(e?.message ?? 'Could not create the bill.'); }
    finally { setBusy(false); }
  });

  const settle = (mode: 'cash' | 'upi_qr') => guard(async () => {
    if (!bill || busy) return;
    setBusy(true); setError('');
    try {
      await payBill(bill.id, mode);
      setBill(null); setSelected(new Set()); setDiscount(''); setParcelBoxes(0); setParcelNote('');
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

  const applyAc = (v: boolean | null) => guard(async () => {
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
  });

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
      // The owner's own lines, as applied to THIS order. A snapshot, not the
      // restaurant's current rules -- see BillData.chargeLines.
      chargeLines: (b.orders ?? []).flatMap((o: any) => (o.charge_lines ?? [])).map((c: any) => ({
        label: String(c.label ?? 'Charge'), amount: Number(c.amount) || 0,
      })),
      serviceWaived: waived,
    };
  };

  useEffect(() => {
    fetchBillLayout(restaurant.id).then(setLayout).catch(() => {});
  }, [restaurant.id]);

  /**
   * THE REAL BILL PRINTS THE SAME WAY THE SAMPLE DOES -- through an isolated
   * iframe, not by printing this page.
   *
   * It used to inject the bill into the portal and call window.print(), which
   * gave the PORTAL's print CSS a say in what came out. On paper under 100mm
   * that stylesheet forces .printable to Courier and overrides the sizes, so
   * a real bill on an 80mm thermal roll printed in a different typeface from
   * the sample the owner had just approved on the same screen -- and from the
   * phone's. The iframe carries none of this page's CSS, so the template's
   * own thermal rules are the only ones in force and all three documents are
   * the same one.
   */
  const printBill = () => {
    if (!bill) return;
    printBillHtml(renderBillHtml(printData(), layout));
  };

  if (orders === null) return <Spinner label="Loading unpaid orders…" />;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Billing</p>
      <h1 className="display" style={{ fontSize: 26 }}>Settle a table</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        Pick the orders to merge into one bill. Diners pay you directly — cash
        or your own UPI.
      </p>
      {error && <p className="inline-error" style={{ margin: '10px 0' }}>{error}</p>}

      {/* THE COUNTER'S OWN ORDER PAD. Not every customer scans -- some walk in
          and say what they want -- and without this the till could not bill
          them at all, which made a working customer phone a precondition for
          taking money. */}
      <WalkIn restaurantId={restaurant.id} onCreated={() => load()} />

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
                  <button className="btn btn-primary btn-sm"
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
          {/* SERVICE CHARGE, WAIVED HERE AND NOWHERE ELSE. It is a decision
              about THIS bill for THIS customer who just asked -- the same kind
              of decision as the discount beside it -- so it lives on the bill,
              not in Bill settings, which holds defaults and layout.

              Waiving repricess the orders on the server: service, SGST, CGST
              and total all fall out of the one calculation. GST is charged on
              subtotal PLUS service, so a waiver that only hid the line would
              print a total that does not add up. */}
          {(service > 0 || waived) && (
            <div className="bill-row">
              <span>Service charge</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{waived ? 'Waived' : inr(service)}</span>
                <button className={`chip${waiving ? ' is-busy' : ''}`} disabled={waiving}
                  onClick={() => toggleWaive(!waived)}>
                  {waived ? 'Put it back' : 'Remove'}
                </button>
              </span>
            </div>
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
              <button className="btn btn-glass btn-sm" onClick={printBill}>🖨 Print bill</button>
            </span>
          </div>
          <div className="bill-row total"><span>To collect</span><span>{inr(bill.total)}</span></div>

          {/**
            * PACKING FOR LEFTOVERS, on a dine-in bill, chosen by a person.
            *
            * The diner ate in and wants the rest boxed. Nothing about that is
            * knowable in advance, which is exactly why it must never be
            * automatic -- a packing fee that applied itself to every dine-in
            * bill is the bug this whole line of work came from.
            *
            * The stepper EDITS rather than accumulates: staff guess the box
            * count before the food is packed and are wrong about as often as
            * right, so 3 then 2 leaves the bill charged for 2, and 0 removes
            * the line. Nothing here can double-charge.
            *
            * A takeaway bill is refused by the function itself, because those
            * orders already carry packing from order time.
            */}
          <div className="parcel-pack">
            <span style={{ flex: 1, minWidth: 0 }}>
              Packing for leftovers
              {parcelBoxes > 0 && <b>{` — ${parcelBoxes} box${parcelBoxes === 1 ? '' : 'es'}`}</b>}
            </span>
            <button
              className="chip" disabled={parcelBusy || parcelBoxes <= 0}
              aria-label="One box fewer"
              onClick={() => changeBoxes(parcelBoxes - 1)}
            >−</button>
            <b style={{ minWidth: 18, textAlign: 'center' }}>{parcelBoxes}</b>
            <button
              className="chip" disabled={parcelBusy}
              aria-label="One box more"
              onClick={() => changeBoxes(parcelBoxes + 1)}
            >+</button>
          </div>
          {parcelNote && <p className="dim" style={{ fontSize: 12, margin: '4px 0 0' }}>{parcelNote}</p>}

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

    </div>
  );
}
