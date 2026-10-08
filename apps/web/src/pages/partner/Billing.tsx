/** Billing: merge a table's unpaid orders into one bill, include/exclude
 *  orders, discount (manager+), 5% GST recompute, printable GST bill,
 *  mark paid (Cash / UPI received). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SettlePanel } from './SettlePanel';
import { OfflineTill } from './OfflineTill';
import { writeOfflineData } from '../../lib/offline';
import { payModeLabel } from '../../lib/splitPay';
import { stockAlertText, type StockReport } from '../../lib/stock';
import { fetchStockReport, fetchLiveOrders, fetchOrdersByIds, createBill, quoteBill, fetchBillMoney, recordBillPrint, type SettleResult, fetchBillLayout, setOrdersAc, waiveService, setParcelPacking, voidTableBill, voidBill, setBillChargeLine, removeBillChargeLine, setBillGuests, staffSetOrderItemQty, setBillService, billShareToken, type BillChargeLine, type PortalOrder } from '../../lib/portalApi';
import { CounterPOS } from './CounterPOS';
import { TableTools } from './TableTools';
import { renderBillHtml, billNumbersFromBreakdown, billLabel, billDateText, whatsappBillLink, needsGstinWarning, GSTIN_WARNING, type BillData } from '../../lib/billTemplate';
import { printBillDirect, getDirectSettings } from '../../lib/directPrint';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

interface BillDraft {
  id: string; bill_no: number; subtotal: number; discount: number; gst_amount: number; total: number;
  /** The restaurant's own series number (26-27/0001); null on older bills. */
  invoice_no?: string | null;
  /** The server's calculation, stored on the bill. What the paper prints. */
  breakdown?: any;
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
        const fresh = await fetchBillMoney(bill.id);
        if (fresh) {
          setBill((b) => (b ? { ...b, total: fresh.total, breakdown: fresh.breakdown } : b));
          setParcelBoxes(fresh.parcel_boxes);
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
  /** Which table has its write-off reasons open. One at a time. */
  const [writingOff, setWritingOff] = useState<string | null>(null);
  /**
   * ONE-OFF CHARGES ON THIS BILL -- cake cutting, corkage, a delivery fee.
   *
   * Not Bill settings, which holds the owner's STANDING lines and applies them
   * to every order through reprice_order. This is tonight, this table, this
   * reason. Staff have been handling these by not handling them: the only
   * lever on the screen was a discount, which is the wrong sign.
   *
   * The lines live on the bill, so they survive a reload and a second device
   * sees them. Local state is only what is on screen.
   */
  const [extraLines, setExtraLines] = useState<BillChargeLine[]>([]);
  const [chargeLabel, setChargeLabel] = useState('');
  const [chargeValue, setChargeValue] = useState('');
  const [chargeKind, setChargeKind] = useState<'flat' | 'percent'>('flat');
  /** Phase 3: GST on a one-off charge (on by default, as before). */
  const [chargeTaxable, setChargeTaxable] = useState(true);
  /** Phase 3: guests, for an area charge per person. */
  const [guests, setGuests] = useState('');
  const [chargeBusy, setChargeBusy] = useState(false);
  /** Which order has its items open for correction. One at a time: this is the
   *  destructive end of the screen and it should take a deliberate tap. */
  const [editingItems, setEditingItems] = useState<string | null>(null);
  /** Phase 3: the table whose Move / merge / split panel is open. */
  const [moving, setMoving] = useState<string | null>(null);
  const [itemBusy, setItemBusy] = useState<string>('');
  // Opened from a ticket on the Orders board: focus that table straight away
  // so settling is one tap from the notification, not a hunt.
  const [params] = useSearchParams();
  const focusTable = params.get('table');

  // Who may discount / cancel is the owner's choice in Bill settings
  // (default owner + manager). The server checks it again either way.
  const rolesOf = (k: string): string[] =>
    Array.isArray((restaurant as any)[k]) ? (restaurant as any)[k] : ['owner', 'manager'];
  const canDiscount = role === 'owner' || rolesOf('bill_discount_roles').includes(String(role));
  const canCancel = role === 'owner' || rolesOf('bill_cancel_roles').includes(String(role));
  const svcPctSet = Number((restaurant as any).service_charge_pct ?? 0) > 0;

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
      // This browser's offline copy: what is open, and the price settings.
      const r: any = restaurant;
      writeOfflineData(restaurant.id, {
        openOrders: all.filter((o) => !o.paid).map((o: any) => ({
          id: o.id, order_no: o.order_no, table_id: o.table_id ?? null, table_label: o.table_label, is_parcel: !!o.is_parcel,
          total: Number(o.total), placed_at: o.placed_at, items: (o.items ?? []).map((i: any) => ({ name: i.name, qty: i.qty, unit_price: Number(i.unit_price) })),
        })),
        pricing: { name: r.name, sgst_pct: r.sgst_pct, cgst_pct: r.cgst_pct, gst_mode: r.gst_mode, prices_include_gst: r.prices_include_gst,
                   round_off_bills: r.round_off_bills, parcel_charge: r.parcel_charge, tax_packing: r.tax_packing },
      });
    } catch (e: any) { setError(e?.message ?? 'Could not load orders.'); }
  };
  useEffect(() => { load(); }, [restaurant.id]);

  /* LOW / OUT OF STOCK, where staff take orders and bill. Quiet when stock
     counting is off or nothing needs attention; refreshed with the orders. */
  const [stock, setStock] = useState<StockReport | null>(null);
  useEffect(() => {
    fetchStockReport(restaurant.id).then(setStock).catch(() => setStock(null));
  }, [restaurant.id, orders]);
  const stockLine = stockAlertText(stock);

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
  const localTotal = Math.round((taxable + gst) * 100) / 100;

  /**
   * THE PREVIEW IS THE SERVER'S OWN CALCULATION. quote_bill runs exactly the
   * arithmetic create_table_bill stores, so the figure on this screen is the
   * figure on the paper. The local sum above is only a fallback for a
   * database that has not had the 2026-10-08 update.
   */
  const [quote, setQuote] = useState<any>(null);
  const chosenKey = chosen.map((o) => `${o.id}:${o.total}`).join(',');
  useEffect(() => {
    if (!chosen.length) { setQuote(null); return; }
    let live = true;
    const t = setTimeout(() => {
      quoteBill(restaurant.id, chosen.map((o) => o.id), disc)
        .then((q) => { if (live) setQuote(q); })
        .catch(() => { if (live) setQuote(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [restaurant.id, chosenKey, disc]);
  const qn = quote ? billNumbersFromBreakdown(quote) : null;
  const total = qn ? qn.total : localTotal;

  /**
   * DID THE SERVER CHARGE WHAT THE SCREEN PROMISED?
   *
   * createBill does its own arithmetic; this page does its own from the
   * orders' already-repriced figures. They should agree, and when they do not
   * -- a service charge the bill's own sum leaves out, a GST rate that is not
   * the one the restaurant is registered for -- the old behaviour was to print
   * the server's number under this page's items and say nothing about it.
   *
   * A bill is a promise about a number somebody is about to hand over. If the
   * two disagree, staff have to know BEFORE the paper does. A rupee of
   * tolerance keeps ordinary rounding quiet.
   */
  const reconcile = (charged: number, promised: number, breakdown?: any) => {
    // A bill with a breakdown IS the one calculation -- there is no second
    // opinion left to disagree with it (an AC charge added on raising is part
    // of it, not a discrepancy).
    if (breakdown) return;
    if (Math.abs(Number(charged) - promised) <= 1) return;
    setError(
      `Check this bill before handing it over: the screen came to ${inr(promised)} `
      + `and the bill was raised at ${inr(Number(charged))}. The bill is the figure that `
      + 'counts and it is what will print. If this keeps happening, the tax or service settings need a look.',
    );
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
      const billed = await billedOrders(list);
      setSelected(new Set(list.map((o) => o.id)));
      setDiscount('');
      setBill({ ...b, orders: billed }); setParcelBoxes(0); setParcelNote('');
      if (getDirectSettings().autoBill) autoPrintFor.current = b.id;
      // billNow skips the preview, so the promise it is measured against is
      // the orders' own totals rather than this page's running figures --
      // as the bill left them (a duplicated parcel fee is dropped on billing).
      reconcile(b.total, sumOf(billed), b.breakdown);
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

  /** The orders re-read after billing (see fetchOrdersByIds). If the re-read
   *  fails the bill still exists and is right; the page falls back to what it
   *  had rather than refusing to show it. */
  const billedOrders = async (list: PortalOrder[]) => {
    try {
      const fresh = await fetchOrdersByIds(list.map((o) => o.id));
      return fresh.length === list.length ? fresh : list;
    } catch { return list; }
  };

  const generate = () => guard(async () => {
    if (!chosen.length || busy) return;
    setBusy(true); setError('');
    try {
      const b = await createBill(restaurant.id, chosen.map((o) => o.id), disc);
      const billed = await billedOrders(chosen);
      setBill({ ...b, orders: billed }); setParcelBoxes(0); setParcelNote('');
      if (getDirectSettings().autoBill) autoPrintFor.current = b.id;
      // The server may have dropped a duplicated parcel fee while billing;
      // that correction is not a disagreement worth warning about.
      reconcile(b.total, total - (sumOf(chosen) - sumOf(billed)), b.breakdown);
    } catch (e: any) { setError(e?.message ?? 'Could not create the bill.'); }
    finally { setBusy(false); }
  });

  /**
   * WRITE THE TABLE OFF, WITH A REASON.
   *
   * Reports read a void as revenue LOST rather than revenue earned, which is
   * the whole point: an owner can finally see how much walks out of the door.
   * Confirmed rather than instant -- it closes every unpaid order at the table
   * and frees it for the next party, which is not a thing to do by mis-click.
   */
  const writeOff = (tableId: string | null, tableName: string, amount: number, reason: string) => guard(async () => {
    if (!tableId) { setError('Parcel and takeaway orders are not seated at a table, so there is no table bill to write off.'); return; }
    if (!window.confirm(
      `Write off ${inr(amount)} at ${tableName}?\n\n`
      + 'This closes every unpaid order at the table and frees it for the next party. '
      + 'It is recorded as revenue LOST, never as money taken.',
    )) return;
    setBusy(true); setError('');
    try {
      await voidTableBill(tableId, reason);
      setWritingOff(null);
      setSelected(new Set());
      setBill(null);
      await load();
    } catch (e: any) {
      setError(/PGRST202|could not find the function/i.test(String(e?.message ?? ''))
        ? 'Writing a bill off needs a database update that has not been run yet. The table is unchanged.'
        : (e?.message ?? 'Could not write the bill off.'));
    } finally { setBusy(false); }
  });

  /** A bill raised against the wrong table. Nobody has paid; the orders go
   *  back on the board and the cancelled bill stays on record. */
  const cancelBill = () => guard(async () => {
    if (!bill) return;
    if (!window.confirm(
      `Cancel ${billLabel(bill)}?\n\n`
      + 'The orders go back on the board so you can bill them again. '
      + 'Nothing is deleted — the cancelled bill stays on record.',
    )) return;
    setBusy(true); setError('');
    try {
      await voidBill(bill.id);
      setBill(null); setSelected(new Set()); setDiscount(''); setParcelBoxes(0); setParcelNote('');
      setExtraLines([]);
      await load();
    } catch (e: any) {
      setError(/PGRST202|could not find the function/i.test(String(e?.message ?? ''))
        ? 'Cancelling a raised bill needs a database update that has not been run yet. Nothing has changed.'
        : (e?.message ?? 'Could not cancel the bill.'));
    } finally { setBusy(false); }
  });

  /** Add or replace a line. The id is derived from the label so that typing the
   *  same charge twice corrects it rather than stacking two of it. */
  const addCharge = () => guard(async () => {
    if (!bill || chargeBusy) return;
    const label = chargeLabel.trim();
    const value = Number(chargeValue.replace(/[^\d.]/g, '')) || 0;
    if (!label) { setError('Give the charge a name — it prints on the diner’s bill.'); return; }
    if (value <= 0) { setError('A charge needs an amount.'); return; }
    setChargeBusy(true); setError('');
    try {
      const r = await setBillChargeLine(
        bill.id, label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'charge',
        label, chargeKind, value, chargeTaxable,
      );
      if (!r.applied) { setError(`Charge not added: ${r.reason ?? 'the bill is closed.'}`); return; }
      setExtraLines(r.extra_lines ?? []);
      const fresh = await fetchBillMoney(bill.id).catch(() => null);
      setBill((b) => (b ? { ...b, total: fresh?.total ?? r.total, breakdown: fresh?.breakdown ?? b.breakdown } : b));
      setChargeLabel(''); setChargeValue(''); setChargeTaxable(true);
    } catch (e: any) {
      setError(/PGRST202|could not find the function/i.test(String(e?.message ?? ''))
        ? 'One-off charges need a database update that has not been run yet. The bill is unchanged.'
        : /access denied/i.test(String(e?.message ?? ''))
          ? 'Adding a charge to a bill needs a manager.'
          : (e?.message ?? 'Could not add the charge.'));
    } finally { setChargeBusy(false); }
  });

  const saveGuests = () => guard(async () => {
    if (!bill) return;
    const n = Math.round(Number(guests));
    if (!Number.isFinite(n) || n < 1 || n > 500) { setError('Guests must be between 1 and 500.'); return; }
    setChargeBusy(true); setError('');
    try {
      const r = await setBillGuests(bill.id, n);
      if (!r.applied) { setError(`Not changed: ${r.reason ?? 'the bill is closed.'}`); return; }
      const fresh = await fetchBillMoney(bill.id).catch(() => null);
      setBill((x) => (x ? { ...x, total: fresh?.total ?? r.total, breakdown: fresh?.breakdown ?? x.breakdown } : x));
    } catch (e: any) {
      setError(e?.message ?? 'Could not set the guests.');
    } finally { setChargeBusy(false); }
  });

  const dropCharge = (lineId: string) => guard(async () => {
    if (!bill || chargeBusy) return;
    setChargeBusy(true); setError('');
    try {
      const r = await removeBillChargeLine(bill.id, lineId);
      if (!r.applied) { setError(`Charge not removed: ${r.reason ?? 'the bill is closed.'}`); return; }
      setExtraLines(r.extra_lines ?? []);
      const fresh = await fetchBillMoney(bill.id).catch(() => null);
      setBill((b) => (b ? { ...b, total: fresh?.total ?? r.total, breakdown: fresh?.breakdown ?? b.breakdown } : b));
    } catch (e: any) {
      setError(e?.message ?? 'Could not remove the charge.');
    } finally { setChargeBusy(false); }
  });

  /**
   * CORRECTING WHAT WAS ORDERED. "That's two dosas, not three." "They sent one
   * back."
   *
   * The diner's own edit window closes the moment the order reaches the
   * kitchen, so until now the only answers were to discount the bill by
   * roughly the right amount or to charge for food nobody ate. The server
   * reprices from the change, so service and GST follow it; nothing is
   * computed here.
   *
   * Refused while a live bill stands on the order, and it names the bill --
   * cancel that first, correct, raise again. Manager only.
   */
  const changeItemQty = (itemId: string, qty: number) => guard(async () => {
    if (itemBusy) return;
    setItemBusy(itemId); setError('');
    try {
      await staffSetOrderItemQty(itemId, qty);
      await load();
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      setError(/PGRST202|could not find the function/i.test(msg)
        ? 'Correcting an order needs a database update that has not been run yet. Nothing has changed.'
        : /access denied/i.test(msg)
          ? 'Correcting what was ordered needs a manager.'
          : (msg || 'Could not change the item.'));
    } finally { setItemBusy(''); }
  });

  /** The bill is paid (SettlePanel talked to the server). Say so — with the
   *  change to hand back — and clear the screen for the next table. */
  const [paidNote, setPaidNote] = useState('');
  const settled = (r: SettleResult) => guard(async () => {
    const label = bill ? billLabel(bill) : 'Bill';
    const how = r.tenders?.length > 1
      ? r.tenders.map((t) => `${payModeLabel(t.mode)} ${inr(Number(t.amount))}`).join(' + ')
      : payModeLabel(r.mode);
    setPaidNote(`${label} · ${inr(Number(r.total))} paid (${how})`
      + (Number(r.change_due) > 0 ? ` · return ${inr(Number(r.change_due))} change` : ''));
    setBill(null); setSelected(new Set()); setDiscount(''); setParcelBoxes(0); setParcelNote('');
    setExtraLines([]);
    await load();
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
        header: (restaurant as any).bill_header ?? '',
        paper: (restaurant as any).bill_paper ?? null,
        gstMode: (restaurant as any).gst_mode ?? null,
      },
      billNo: billLabel(b),
      // The date the bill was RAISED, in India time, from the server -- never
      // the moment of printing on whatever clock this computer keeps.
      dateText: billDateText((b as any).issued_at ?? (b as any).created_at),
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
      /**
       * PACKING WAS PRINTING TWICE. createBill returns `subtotal` as
       * sum(subtotal + packing_charge) -- packing is already inside it -- and
       * the template prints a separate "Packing charge" row beneath it. The
       * grand total counts it once, so the column did not add up to the total
       * under it. Subtotal is food, packing is packing.
       */
      subtotal: b.subtotal - b.orders.reduce((a, o) => a + Number(o.packing_charge ?? 0), 0),
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
      /* A bill raised after the 2026-10-08 update carries the server's whole
         calculation. Every number on the paper then comes from it -- items,
         every charge (AC, boxes, one-off lines included), taxable value, tax,
         round-off, total -- so the column always adds up to the total under
         it. Everything above is only for a bill raised before that. */
      ...(b.breakdown ? billNumbersFromBreakdown(b.breakdown) : {}),
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
  const printBill = async () => {
    if (!bill) return;
    // Counted first: the second and later prints of one bill say DUPLICATE.
    const n = await recordBillPrint(bill.id);
    // Straight to the thermal printer chosen in Settings → Printer (Web
    // Serial / WebUSB), as ESC/POS from the same data; else the print dialog.
    const out = await printBillDirect({ ...printData(), duplicate: n != null && n > 1 }, layout);
    if (out.via === 'dialog' && out.reason) setError(`Printed with the browser's print dialog: ${out.reason}`);
  };

  /* "Print the bill when it is raised" (Settings → Printer): once the raised
     bill is on screen, print it once. */
  const autoPrintFor = useRef<string | null>(null);
  useEffect(() => {
    if (bill && autoPrintFor.current === bill.id) { autoPrintFor.current = null; printBill(); }
  }, [bill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A free wa.me link to the online copy of this bill (/b/<token>). Opened
   *  synchronously so the browser does not block it as a pop-up. */
  const shareWhatsApp = async () => {
    if (!bill) return;
    const win = window.open('', '_blank');
    const token = await billShareToken(bill.id);
    if (!token) {
      win?.close();
      setError('Sharing a bill needs the database update for online bills.');
      return;
    }
    const link = whatsappBillLink({
      baseUrl: window.location.origin, token, restaurantName: restaurant.name ?? 'our restaurant',
      label: billLabel(bill), total: bill.total,
      phone: bill.orders.find((o) => o.guest_phone)?.guest_phone ?? null,
    });
    if (win) win.location.href = link; else window.location.href = link;
  };

  if (orders === null) return <Spinner label="Loading unpaid orders…" />;

  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Billing</p>
      <h1 className="display" style={{ fontSize: 26 }}>Settle a table</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        Pick the orders to merge into one bill. Diners pay at the counter — cash,
        or UPI or card at the counter, recorded here.
      </p>
      {error && <p className="inline-error" style={{ margin: '10px 0' }}>{error}</p>}
      {stockLine && <p className="stock-alert" role="status">{stockLine}</p>}
      {/* GST CHARGED WITHOUT A GSTIN. Billing carries on exactly as set up;
          the owner is told, and the paper says "Bill of supply" until the
          GSTIN is on the profile. */}
      {canDiscount && needsGstinWarning(restaurant.gstin, qn?.sgstPct ?? sgstPct, qn?.cgstPct ?? cgstPct) && (
        <p className="inline-error" role="status" style={{ margin: '10px 0' }}>{GSTIN_WARNING}</p>
      )}

      {/* THE COUNTER'S OWN ORDER PAD. Not every customer scans -- some walk in
          and say what they want -- and without this the till could not bill
          them at all, which made a working customer phone a precondition for
          taking money. */}
      {/* OFFLINE (Phase 2): the connection, and the offline till when it is down. */}
      <OfflineTill restaurantId={restaurant.id} onSynced={() => load()} />
      <CounterPOS restaurantId={restaurant.id} onCreated={() => load()} />

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
            {/* The honest way to close a table nobody is going to pay for.
                Ghost, and last: it is the rare action, and it must never sit
                where a thumb reaching for "Bill whole table" can find it. */}
            {canCancel && (
              <button className="btn btn-ghost" disabled={busy}
                title="Walkout, on the house, or billed by mistake"
                aria-expanded={writingOff === tableName}
                onClick={() => setWritingOff((w) => (w === tableName ? null : tableName))}>
                ✕ Write off
              </button>
            )}
          </div>

          {/* THE REASON IS THE POINT, so it is asked before anything happens
              rather than assumed. Reports group write-offs by it: "we lost
              ₹4,200 to walkouts this month" is a number an owner can act on,
              and one undifferentiated "void" bucket is not. */}
          {writingOff === tableName && (
            <div className="glass" style={{ padding: 12, marginBottom: 10 }}>
              <p className="overline" style={{ marginBottom: 6 }}>
                Write off {inr(sumOf(list))} — why?
              </p>
              <p className="dim" style={{ fontSize: 12, margin: '0 0 8px' }}>
                Closes every unpaid order at this table and frees it for the next party.
                Recorded as revenue lost, never as money taken.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  ['walkout', 'Walked out'],
                  ['comped', 'On the house'],
                  ['staff_error', 'Staff error'],
                  ['duplicate', 'Duplicate'],
                  ['other', 'Other'],
                ] as const).map(([value, label]) => (
                  <button key={value} className="chip" disabled={busy}
                    onClick={() => writeOff(list[0]?.table_id ?? null, tableName, sumOf(list), value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

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

          {/* CORRECTING THE ORDER ITSELF, one step further in than picking
              which orders to bill. Deliberately behind its own toggle: it
              changes what the kitchen was told, not just what is being
              charged. */}
          <div style={{ padding: '0 16px 10px' }}>
            <button className="chip" onClick={() => setEditingItems((x) => (x === tableName ? null : tableName))}
              aria-expanded={editingItems === tableName}>
              ✎ Correct an item
            </button>{' '}
            <button className="chip" onClick={() => setMoving((x) => (x === tableName ? null : tableName))}
              aria-expanded={moving === tableName}>
              ⇄ Move / merge / split
            </button>
          </div>
          {moving === tableName && (
            <TableTools restaurantId={restaurant.id} tableId={list[0]?.table_id ?? null} orders={list}
              onDone={() => { setMoving(null); load(); }} />
          )}
          {editingItems === tableName && (
            <div className="glass" style={{ padding: '8px 16px', marginBottom: 10 }}>
              <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
                Changing a quantity reprices the order — service and GST follow it.
                Set a quantity to zero to take the dish off. An order left with nothing is cancelled.
              </p>
              {list.map((o) => (
                <div key={o.id}>
                  <p className="overline" style={{ margin: '8px 0 2px' }}>#{o.order_no}</p>
                  {(o.items ?? []).map((it: any) => (
                    <div key={it.id} className="row-item">
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 14 }}>{it.name}</strong>
                        <span className="dim" style={{ display: 'block', fontSize: 12 }}>{inr(it.unit_price)} each</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="chip" disabled={!!itemBusy}
                          aria-label={`One fewer ${it.name}`}
                          onClick={() => changeItemQty(it.id, Math.max(0, Number(it.qty) - 1))}>−</button>
                        <b style={{ minWidth: 18, textAlign: 'center' }}>{it.qty}</b>
                        <button className="chip" disabled={!!itemBusy}
                          aria-label={`One more ${it.name}`}
                          onClick={() => changeItemQty(it.id, Number(it.qty) + 1)}>+</button>
                        <button className="chip" disabled={!!itemBusy}
                          aria-label={`Remove ${it.name}`}
                          onClick={() => changeItemQty(it.id, 0)}>✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
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
          {/* VOLUNTARY (CCPA 2022): not on the bill unless the guest agreed,
              and anyone at the till can take it off in one tap. */}
          {(service > 0 || waived || svcPctSet) && (
            <div className="bill-row">
              <span>Service charge (voluntary)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{service > 0 ? inr(service) : 'Not added'}</span>
                <button className={`chip${waiving ? ' is-busy' : ''}`} disabled={waiving}
                  onClick={() => toggleWaive(service > 0)}>
                  {service > 0 ? 'Remove' : 'Guest agreed — add'}
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
          {qn && qn.discount > 0 && (
            <div className="bill-row"><span>After discount</span><span>{inr(qn.subtotal - qn.discount)}</span></div>
          )}
          {qn?.chargeLines?.map((c, i) => (
            <div className="bill-row" key={`${c.label}-${i}`}><span>{c.label}</span><span>{inr(c.amount)}</span></div>
          ))}
          {qn && <div className="bill-row"><span>Taxable value</span><span>{inr(qn.taxable ?? 0)}</span></div>}
          {!(qn && qn.sgst + qn.cgst === 0 && /SUPPLY/.test(qn.docTitle ?? '')) && (<>
          <div className="bill-row"><span>SGST ({qn ? qn.sgstPct : sgstPct}%){qn?.pricesIncludeGst ? ' included' : ''}</span><span>{inr(qn ? qn.sgst : sgst)}</span></div>
          <div className="bill-row"><span>CGST ({qn ? qn.cgstPct : cgstPct}%){qn?.pricesIncludeGst ? ' included' : ''}</span><span>{inr(qn ? qn.cgst : cgst)}</span></div>
          </>)}
          {qn && qn.roundOff ? <div className="bill-row"><span>Round off</span><span>{inr(qn.roundOff)}</span></div> : null}
          <div className="bill-row total"><span>Total</span><span>{inr(total)}</span></div>
          <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 12 }} disabled={busy} onClick={generate}>
            {getDirectSettings().autoBill ? 'Raise bill & print' : 'Raise bill'}
          </button>
        </div>
      )}

      {bill && (
        <div className="glass-strong" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
          <div className="topbar" style={{ padding: 0 }}>
            <strong>{billLabel(bill)}</strong>
            {/* The way back from a bill raised against the wrong table.
                Before this the only exits were "mark it paid" and "leave it
                unpaid on record for ever". */}
            {canCancel && (
              <button className="btn btn-glass btn-sm" disabled={busy} onClick={cancelBill}>
                ✕ Cancel bill
              </button>
            )}
          </div>
          {/* PRINT AND WHATSAPP, SIDE BY SIDE AND FULL SIZE. The share button
              used to be a small glass chip in the corner and the owner could
              not find it. Same order and words as the app. */}
          <div className="bill-share-row" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-glass" style={{ flex: 1 }} onClick={printBill}>🖨 Print bill</button>
            <button className="btn btn-whatsapp" style={{ flex: 1 }} onClick={shareWhatsApp}
              title="Send the guest a link to this bill on WhatsApp">
              💬 Share on WhatsApp
            </button>
          </div>
          <div className="bill-row total"><span>To collect</span><span>{inr(bill.total)}</span></div>
          {svcPctSet && bill.breakdown && (
            <div className="bill-row">
              <span>Service charge (voluntary)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{Number(bill.breakdown.service_p) > 0 ? inr(Number(bill.breakdown.service_p) / 100) : 'Not added'}</span>
                <button className={`chip${waiving ? ' is-busy' : ''}`} disabled={waiving}
                  onClick={() => guard(async () => {
                    setWaiving(true); setError('');
                    try {
                      const r = await setBillService(bill.id, !(Number(bill.breakdown.service_p) > 0));
                      if (r?.applied === false && r.reason) setError(r.reason);
                      const fresh = await fetchBillMoney(bill.id);
                      if (fresh) setBill((b) => (b ? { ...b, total: fresh.total, breakdown: fresh.breakdown } : b));
                    } catch (e: any) { setError(e?.message ?? 'Could not change the service charge.'); }
                    finally { setWaiving(false); }
                  })}>
                  {Number(bill.breakdown.service_p) > 0 ? 'Remove' : 'Guest agreed — add'}
                </button>
              </span>
            </div>
          )}

          {/* Every one-off already on this bill, each removable. Shown before
              the composer so the answer to "did that go on?" is on screen
              rather than one more tap away. */}
          {extraLines.map((l) => (
            <div className="bill-row" key={l.id}>
              <span>{l.label}{l.kind === 'percent' ? ` (${l.value}%)` : ''}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{inr(l.amount)}</span>
                <button className="chip" disabled={chargeBusy} onClick={() => dropCharge(l.id)}
                  aria-label={`Remove ${l.label}`}>✕</button>
              </span>
            </div>
          ))}

          {/* A charge this restaurant does not always make. Bill settings holds
              the ones it always does. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <input
              className="code-input" style={{ flex: '2 1 150px', padding: '6px 10px' }}
              placeholder="Cake cutting, corkage…"
              value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)}
              aria-label="What the charge is for"
            />
            <input
              className="code-input" style={{ flex: '0 1 90px', padding: '6px 10px', textAlign: 'right' }}
              inputMode="decimal" placeholder={chargeKind === 'flat' ? '₹' : '%'}
              value={chargeValue} onChange={(e) => setChargeValue(e.target.value)}
              aria-label="How much"
            />
            {([['flat', '₹'], ['percent', '%']] as const).map(([k, lbl]) => (
              <button key={k} className={chargeKind === k ? 'chip active' : 'chip'}
                aria-pressed={chargeKind === k}
                onClick={() => setChargeKind(k)}>{lbl}</button>
            ))}
            <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={chargeTaxable} onChange={(e) => setChargeTaxable(e.target.checked)} />
              GST on this charge
            </label>
            <button className={`btn btn-glass btn-sm${chargeBusy ? ' is-busy' : ''}`}
              disabled={chargeBusy} onClick={addCharge}>Add charge</button>
          </div>
          <p className="dim" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
            On this bill only. Charges every bill should carry belong in Bill settings.
          </p>
          {(bill as any)?.breakdown?.ac_label && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span className="dim" style={{ fontSize: 12.5 }}>Guests (for a per-person area charge)</span>
              <input className="code-input" style={{ width: 80, padding: '6px 10px' }} inputMode="numeric"
                value={guests} onChange={(e) => setGuests(e.target.value.replace(/\D/g, '').slice(0, 3))}
                aria-label="Guests" placeholder="1" />
              <button className="btn btn-glass btn-sm" disabled={chargeBusy || !guests} onClick={saveGuests}>Set guests</button>
            </div>
          )}

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

          <SettlePanel
            billId={bill.id}
            total={Number(bill.total)}
            items={Array.isArray(bill.breakdown?.items) ? bill.breakdown.items : []}
            disabled={busy}
            onSettled={settled}
          />
        </div>
      )}

      {paidNote && (
        <div className="glass" role="status" style={{ padding: 12, marginTop: 12, borderColor: 'var(--success, #2e7d32)' }}
          onClick={() => setPaidNote('')}>
          <strong>{paidNote}</strong>
          <span className="dim" style={{ display: 'block', fontSize: 12 }}>Tap to dismiss</span>
        </div>
      )}

    </div>
  );
}
