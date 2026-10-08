/**
 * A BILL FOR SOMEONE WHO NEVER SCANNED ANYTHING.
 *
 * The product assumed the diner's phone: scan the QR, order, get billed. Most
 * do. Some walk in, sit down and tell the counter what they want -- and the
 * till had no way to bill them at all, which quietly made a working customer
 * phone a precondition for taking money. This is the counter's own order pad.
 *
 * WHAT IT DELIBERATELY IS NOT: a second pricing engine. Every line here sends
 * a dish id and a quantity to place_order -- the same RPC the diner's phone
 * calls -- and the server prices it. The running total on screen is drawn from
 * the menu prices for the person tapping, and it says so; the number that ends
 * up on the bill is the server's. A manual path that computed money itself
 * would eventually disagree with the scanned path, and it would do it over a
 * real bill in a real customer's hand.
 *
 * A walk-in order is therefore an ORDINARY order. It lands on the board, the
 * kitchen sees it, Billing bills it, reports count it, and the service-charge
 * waiver and discount work on it -- none of them knowing or caring that nobody
 * scanned a QR.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMenuAdmin, fetchTables, placeStaffOrder, type PortalTable } from '../../lib/portalApi';
import { queue, isOffline, isNetworkError, noteNetworkFailure, readOfflineData, writeOfflineData, newLocalId, checkNow } from '../../lib/offline';
import { printKotDirect } from '../../lib/directPrint';
import { inr } from '../../lib/types';

type Dish = { id: string; name: string; price: number; is_available?: boolean | null; gst_rate?: number | null };

export function WalkIn({ restaurantId, onCreated }: {
  restaurantId: string;
  /** Reload the board and select the new order. */
  onCreated: (orderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [tables, setTables] = useState<PortalTable[]>([]);
  const [tableId, setTableId] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || dishes) return;
    // OFFLINE: the menu and tables this browser saved last time it was online.
    const fromBrowser = () => {
      const d = readOfflineData(restaurantId);
      if (d && d.menu.length) {
        setDishes(d.menu); setTables(d.tables as any);
        setTableId(((d.tables as any[]).find((t) => t.is_parcel) ?? d.tables[0])?.id ?? '');
      } else setError('No menu saved in this browser yet. Open billing once while online so the menu is saved for offline use.');
    };
    if (isOffline()) { fromBrowser(); return; }
    Promise.all([fetchMenuAdmin(restaurantId), fetchTables(restaurantId)])
      .then(([menu, ts]) => {
        const ds = (menu.items as any[]).map((d) => ({
          id: d.id, name: d.name, price: Number(d.price), is_available: d.is_available, gst_rate: d.gst_rate ?? null,
        }));
        setDishes(ds);
        writeOfflineData(restaurantId, { menu: ds, tables: ts.map((t) => ({ id: t.id, label: t.label, is_parcel: t.is_parcel })) });
        setTables(ts);
        // TAKEAWAY IS THE DEFAULT, because a walk-in who is not at a table is
        // the commonest case and every restaurant already has that row -- it
        // is created with the restaurant. Staff can still pick a real table.
        setTableId((ts.find((t) => t.is_parcel) ?? ts[0])?.id ?? '');
      })
      .catch((e: any) => {
        if (isNetworkError(e)) { noteNetworkFailure(); fromBrowser(); return; }
        setError(e?.message ?? 'Could not load the menu.');
      });
  }, [open, dishes, restaurantId]);

  const lines = useMemo(
    () => Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => ({ menuItemId: id, qty: n })),
    [qty],
  );

  /** Indicative only -- the server prices the order. Shown because a counter
   *  needs to be able to say "that's about nine hundred" before committing. */
  const roughTotal = useMemo(() => {
    if (!dishes) return 0;
    const by = new Map(dishes.map((d) => [d.id, d.price]));
    return lines.reduce((a, l) => a + (by.get(l.menuItemId) ?? 0) * l.qty, 0);
  }, [lines, dishes]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (dishes ?? []).filter((d) => d.is_available !== false);
    return q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all;
  }, [dishes, search]);

  const bump = (id: string, by: number) =>
    setQty((m) => {
      const n = Math.max(0, (m[id] ?? 0) + by);
      const next = { ...m };
      if (n === 0) delete next[id]; else next[id] = n;
      return next;
    });

  /**
   * NO GUARD AT ALL BEFORE THIS. `disabled={busy || !lines.length}` was the
   * only thing standing between a double click and two staff orders -- and
   * `disabled` is bound to state, which lands a render later than the second
   * click does. Two orders is two kitchen tickets and two lines on the bill
   * for one walk-in, which somebody then has to explain to the customer.
   */
  const creatingRef = useRef(false);

  const create = async () => {
    if (creatingRef.current) return;
    if (!lines.length) { setError('Add at least one dish.'); return; }
    if (!tableId) { setError('Pick where this order is for.'); return; }
    creatingRef.current = true;
    setBusy(true); setError('');
    /* SAVED IN THIS BROWSER when there is no connection: queued with its own
       request id (never placed twice), KOT printed now, sent and priced by the
       server when the connection is back. */
    const saveOffline = async () => {
      const table = tables.find((t) => t.id === tableId);
      const byId = new Map((dishes ?? []).map((d) => [d.id, d]));
      const items = lines.map((l) => ({ id: l.menuItemId, name: byId.get(l.menuItemId)?.name ?? 'Dish',
        price: byId.get(l.menuItemId)?.price ?? 0, gst_rate: byId.get(l.menuItemId)?.gst_rate ?? null, qty: l.qty }));
      const tableLabel = table?.is_parcel ? 'Parcel / Takeaway' : String(table?.label ?? 'Table');
      await queue.enqueue({
        localId: newLocalId('o'), kind: 'order', label: `${tableLabel} · ${items.reduce((a, i) => a + i.qty, 0)} items`,
        args: {
          p_restaurant_id: restaurantId, p_table_id: tableId,
          p_items: lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, option_ids: [] })),
          p_notes: 'Taken at the counter (offline)', p_guest_name: 'Walk-in', p_guest_phone: null,
          p_client_at: new Date().toISOString(),
        },
        meta: { tableId, tableLabel, isParcel: !!table?.is_parcel, items },
      });
      printKotDirect({ restaurantName: '', orderNo: 'OFFLINE', tableText: tableLabel, placedAt: new Date().toISOString(),
        items: items.map((i) => ({ name: i.name, qty: i.qty })), notes: 'Taken offline' }).catch(() => {});
      setQty({}); setSearch(''); setOpen(false);
      window.alert('Saved in this browser. No connection: the order is saved, the KOT is printing, and it will be sent when the connection is back.');
    };
    try {
      if (isOffline()) { await saveOffline(); return; }
      const id = await placeStaffOrder(restaurantId, tableId, lines);
      setQty({}); setSearch(''); setOpen(false);
      onCreated(id);
    } catch (e: any) {
      if (isNetworkError(e)) { noteNetworkFailure(); await saveOffline(); checkNow().catch(() => {}); }
      else setError(e?.message ?? 'Could not create that order.');
    } finally { setBusy(false); creatingRef.current = false; }
  };

  if (!open) {
    return (
      <button className="btn btn-glass" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        ＋ New bill — customer did not scan
      </button>
    );
  }

  return (
    <div className="glass" style={{ padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>New bill</strong>
        <span className="dim" style={{ fontSize: 12.5 }}>
          Pick the dishes. Prices and tax are worked out by the server, exactly as for a scanned order.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
        <select className="code-input" style={{ flex: '1 1 160px' }} aria-label="Where this order is for"
          value={tableId} onChange={(e) => setTableId(e.target.value)}>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>{t.is_parcel ? 'Takeaway / counter' : t.label}</option>
          ))}
        </select>
        <input className="code-input" style={{ flex: '2 1 200px' }} placeholder="Search dishes…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {dishes === null && !error && <p className="dim" style={{ fontSize: 13 }}>Loading the menu…</p>}

      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {shown.map((d) => {
          const n = qty[d.id] ?? 0;
          return (
            <div key={d.id} className="row-item">
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{d.name}</strong>
                <span className="dim" style={{ fontSize: 13 }}> · {inr(d.price)}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="chip" aria-label={`One fewer ${d.name}`} disabled={!n}
                  onClick={() => bump(d.id, -1)}>−</button>
                <span style={{ minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                <button className="chip" aria-label={`One more ${d.name}`}
                  onClick={() => bump(d.id, +1)}>＋</button>
              </span>
            </div>
          );
        })}
        {dishes !== null && shown.length === 0 && (
          <p className="dim" style={{ fontSize: 13, padding: '10px 0' }}>
            {search ? 'No dish matches that.' : 'No available dishes on the menu yet.'}
          </p>
        )}
      </div>

      {error && <p className="inline-error" style={{ margin: '10px 0 0' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} disabled={busy || !lines.length}
          onClick={create}>
          Create order
        </button>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); setQty({}); setError(''); }}>
          Cancel
        </button>
        <span className="dim" style={{ fontSize: 12.5 }}>
          {lines.length ? `${lines.reduce((a, l) => a + l.qty, 0)} item(s) · about ${inr(roughTotal)} before tax` : 'Nothing added yet'}
        </span>
      </div>
    </div>
  );
}
