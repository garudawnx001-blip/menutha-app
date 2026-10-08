/**
 * PHASE 3: THE COUNTER (POS) -- a full bill with nobody scanning anything.
 *
 * Replaces the small "New bill -- customer did not scan" pad. What a counter
 * needs, fast:
 *   - Order type: Walk-in (counter) / Takeaway / Phone · delivery / Dine-in table
 *   - Search dishes (/ to focus, Enter adds the top match), quantity, options,
 *     a note per dish, a note for the order, customer name and mobile
 *   - Hold a half-built bill and recall it later, from any device
 *   - Ctrl+Enter places it, Alt+H holds it, Esc closes; F2 opens the counter
 * The order then sits on Billing like any other: bill, split, settle (cash /
 * UPI at counter / card), print or WhatsApp -- the same bill_compute, numbering,
 * stock and KOT as a QR order. Offline it is queued in this browser exactly as
 * before (Phase 2) and sent when the connection is back.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMenuAdmin, fetchTables, type PortalTable } from '../../lib/portalApi';
import { supabase } from '../../lib/supabase';
import { queue, isOffline, isNetworkError, noteNetworkFailure, readOfflineData, writeOfflineData, newLocalId, checkNow } from '../../lib/offline';
import { printKotDirect } from '../../lib/directPrint';
import { inr } from '../../lib/types';
import {
  POS_TYPE_LABEL, draftProblem, dropHold, holdDraft, listHolds, newRequestId, posPlaceOrder,
  type PosDraft, type PosHold, type PosLine, type PosOrderType,
} from '../../lib/pos';

type Dish = { id: string; name: string; price: number; is_available?: boolean | null; gst_rate?: number | null };
type Opt = { id: string; menu_item_id: string; name: string; choice: string | null; price_delta: number };

const EMPTY: PosDraft = { type: 'counter', tableId: '', lines: [], name: '', phone: '', notes: '' };

export function CounterPOS({ restaurantId, onCreated }: { restaurantId: string; onCreated: (orderId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [tables, setTables] = useState<PortalTable[]>([]);
  const [d, setD] = useState<PosDraft>(EMPTY);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<Dish | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [holds, setHolds] = useState<PosHold[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  /** One request id per order attempt, kept until it succeeds: a retry after a
   *  lost reply is answered with the same order, never a second one. */
  const reqId = useRef<string>(newRequestId());
  const creatingRef = useRef(false);

  // F2 opens the counter from anywhere on Billing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); setOpen(true); window.setTimeout(() => searchRef.current?.focus(), 50); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || dishes) return;
    const fromBrowser = () => {
      const c = readOfflineData(restaurantId);
      if (c && c.menu.length) { setDishes(c.menu); setTables(c.tables as any); }
      else setError('No menu saved in this browser yet. Open billing once while online so the menu is saved for offline use.');
    };
    if (isOffline()) { fromBrowser(); return; }
    Promise.all([fetchMenuAdmin(restaurantId), fetchTables(restaurantId)])
      .then(async ([menu, ts]) => {
        const ds = (menu.items as any[]).map((x) => ({ id: x.id, name: x.name, price: Number(x.price), is_available: x.is_available, gst_rate: x.gst_rate ?? null }));
        setDishes(ds);
        setTables(ts);
        writeOfflineData(restaurantId, { menu: ds, tables: ts.map((t) => ({ id: t.id, label: t.label, is_parcel: t.is_parcel })) });
        const ids = ds.map((x) => x.id);
        if (ids.length) {
          const o = await supabase.from('menu_item_option').select('id, menu_item_id, name, choice, price_delta').in('menu_item_id', ids);
          if (!o.error) setOpts(((o.data ?? []) as any[]).map((x) => ({ ...x, price_delta: Number(x.price_delta) || 0 })));
        }
      })
      .catch((e: any) => {
        if (isNetworkError(e)) { noteNetworkFailure(); fromBrowser(); return; }
        setError(e?.message ?? 'Could not load the menu.');
      });
  }, [open, dishes, restaurantId]);

  const optsOf = useMemo(() => {
    const m = new Map<string, Opt[]>();
    for (const o of opts) (m.get(o.menu_item_id) ?? m.set(o.menu_item_id, []).get(o.menu_item_id)!).push(o);
    return m;
  }, [opts]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (dishes ?? []).filter((x) => x.is_available !== false);
    return q ? all.filter((x) => x.name.toLowerCase().includes(q)) : all;
  }, [dishes, search]);

  const dineTables = tables.filter((t) => !t.is_parcel);
  const total = d.lines.reduce((a, l) => a + l.price * l.qty, 0);
  const count = d.lines.reduce((a, l) => a + l.qty, 0);

  const flash = (s: string) => { setMsg(s); window.setTimeout(() => setMsg(''), 2500); };
  const set = (p: Partial<PosDraft>) => setD((x) => ({ ...x, ...p }));

  const addLine = (dish: Dish, optionIds: string[] = []) => {
    const chosen = (optsOf.get(dish.id) ?? []).filter((o) => optionIds.includes(o.id));
    const key = dish.id + '|' + [...optionIds].sort().join(',');
    setD((x) => {
      const i = x.lines.findIndex((l) => l.key === key);
      if (i >= 0) {
        const lines = x.lines.slice();
        lines[i] = { ...lines[i], qty: Math.min(999, lines[i].qty + 1) };
        return { ...x, lines };
      }
      const line: PosLine = {
        key, menuItemId: dish.id, name: dish.name, qty: 1, optionIds,
        price: dish.price + chosen.reduce((a, o) => a + o.price_delta, 0),
        optionLabels: chosen.map((o) => (o.choice ? `${o.name}: ${o.choice}` : o.name)),
      };
      return { ...x, lines: [...x.lines, line] };
    });
  };
  const tapDish = (dish: Dish) => {
    if ((optsOf.get(dish.id) ?? []).length) { setPicking(dish); setPicked(new Set()); return; }
    addLine(dish);
  };
  const setQty = (key: string, qty: number) =>
    setD((x) => ({ ...x, lines: qty <= 0 ? x.lines.filter((l) => l.key !== key) : x.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(999, qty) } : l)) }));
  const setNote = (key: string, note: string) =>
    setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, note } : l)) }));

  const reset = () => { setD(EMPTY); setSearch(''); setError(''); reqId.current = newRequestId(); };

  const create = async () => {
    if (creatingRef.current) return;
    const problem = draftProblem(d);
    if (problem) { setError(problem); return; }
    creatingRef.current = true;
    setBusy(true); setError('');
    const saveOffline = async () => {
      const table = d.type === 'dine_in' ? tables.find((t) => t.id === d.tableId) : tables.find((t) => t.is_parcel);
      if (!table) { setError('No connection and no table saved for this order type. Try again when online.'); return; }
      const tableLabel = table.is_parcel ? 'Parcel / Takeaway' : String(table.label);
      await queue.enqueue({
        localId: newLocalId('o'), kind: 'order', label: `${tableLabel} · ${count} items`,
        args: {
          p_restaurant_id: restaurantId, p_table_id: table.id,
          p_items: d.lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, option_ids: l.optionIds })),
          p_notes: [d.notes.trim(), 'Taken at the counter (offline)'].filter(Boolean).join(' | '),
          p_guest_name: d.name.trim() || 'Walk-in', p_guest_phone: d.phone.trim() || null,
          p_client_at: new Date().toISOString(),
        },
        meta: { tableId: table.id, tableLabel, isParcel: !!table.is_parcel,
          items: d.lines.map((l) => ({ id: l.menuItemId, name: l.name, price: l.price, gst_rate: null, qty: l.qty })) },
      });
      printKotDirect({ restaurantName: '', orderNo: 'OFFLINE', tableText: tableLabel, placedAt: new Date().toISOString(),
        items: d.lines.map((l) => ({ name: l.name, qty: l.qty, note: l.note })), notes: 'Taken offline' }).catch(() => {});
      reset(); setOpen(false);
      window.alert('Saved in this browser. No connection: the order is saved, the KOT is printing, and it will be sent when the connection is back.');
    };
    try {
      if (isOffline()) { await saveOffline(); return; }
      const r = await posPlaceOrder(restaurantId, reqId.current, d);
      reset(); setOpen(false);
      flash(r.token_no ? `Order placed · Token ${r.token_no}` : 'Order placed');
      onCreated(r.id);
    } catch (e: any) {
      if (isNetworkError(e)) { noteNetworkFailure(); await saveOffline(); checkNow().catch(() => {}); }
      else setError(e?.message ?? 'Could not create that order.');
    } finally { setBusy(false); creatingRef.current = false; }
  };

  const hold = async () => {
    if (!d.lines.length) { setError('Nothing to hold yet.'); return; }
    const label = window.prompt('Name this bill (to find it later):', d.name || POS_TYPE_LABEL[d.type]);
    if (!label) return;
    try { await holdDraft(restaurantId, label, d); reset(); flash('Held. Recall it any time.'); setHolds(null); }
    catch (e: any) { setError(e?.message ?? 'Could not hold the bill.'); }
  };
  const showHolds = async () => {
    try { setHolds(await listHolds(restaurantId)); } catch (e: any) { setError(e?.message ?? 'Could not load held bills.'); }
  };
  const recall = async (h: PosHold) => {
    setD({ ...EMPTY, ...h.payload }); reqId.current = newRequestId(); setHolds(null);
    try { await dropHold(h.id); } catch { /* it simply stays in the list */ }
  };

  const onKeys = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); create(); }
    else if (e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); hold(); }
    else if (e.key === 'Escape') { setPicking(null); setNoteFor(null); }
    else if (e.key === '/' && document.activeElement !== searchRef.current && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault(); searchRef.current?.focus();
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={() => { setOpen(true); window.setTimeout(() => searchRef.current?.focus(), 50); }}>
          ＋ New bill at the counter
        </button>
        <span className="dim" style={{ fontSize: 12 }}>Walk-in, takeaway, phone or a table — no scan needed. Shortcut: F2</span>
        {msg && <span role="status" style={{ color: 'var(--primary)', fontSize: 13 }}>{msg}</span>}
      </div>
    );
  }

  return (
    <div className="glass pos" style={{ padding: 14, marginTop: 12 }} onKeyDown={onKeys}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>New bill at the counter</strong>
        <span className="dim" style={{ fontSize: 12 }}>
          / search · Enter add · Ctrl+Enter place · Alt+H hold · Esc close a box
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }} role="radiogroup" aria-label="Order type">
        {(Object.keys(POS_TYPE_LABEL) as PosOrderType[]).map((k) => (
          <button key={k} className={d.type === k ? 'chip active' : 'chip'} aria-pressed={d.type === k} onClick={() => set({ type: k })}>
            {POS_TYPE_LABEL[k]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {d.type === 'dine_in' && (
          <select className="code-input" style={{ flex: '1 1 140px' }} aria-label="Table" value={d.tableId}
            onChange={(e) => set({ tableId: e.target.value })}>
            <option value="">Choose a table…</option>
            {dineTables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        <input className="code-input" style={{ flex: '1 1 140px' }} placeholder="Customer name (optional)" value={d.name}
          maxLength={40} onChange={(e) => set({ name: e.target.value })} aria-label="Customer name" />
        <input className="code-input" style={{ flex: '1 1 140px' }} inputMode="tel" maxLength={14}
          placeholder={d.type === 'delivery' ? 'Mobile (needed)' : 'Mobile (optional)'} value={d.phone}
          onChange={(e) => set({ phone: e.target.value })} aria-label="Customer mobile" />
      </div>
      {(d.type === 'delivery' || d.notes) && (
        <input className="code-input" style={{ marginTop: 8 }} maxLength={300}
          placeholder={d.type === 'delivery' ? 'Deliver to (address, landmark)' : 'Note for the order'}
          value={d.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Order note" />
      )}

      <div className="pos-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12, marginTop: 10 }}>
        <div>
          <input ref={searchRef} className="code-input" placeholder="Search dishes…  ( / )" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search dishes"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && shown[0]) { e.preventDefault(); tapDish(shown[0]); setSearch(''); } }} />
          {dishes === null && !error && <p className="dim" style={{ fontSize: 13 }}>Loading the menu…</p>}
          <div style={{ maxHeight: 340, overflowY: 'auto', marginTop: 6 }}>
            {shown.map((x) => (
              <button key={x.id} className="row-item pos-dish" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 0 }}
                onClick={() => tapDish(x)} aria-label={`Add ${x.name}`}>
                <span style={{ minWidth: 0 }}><strong style={{ fontSize: 14 }}>{x.name}</strong>
                  {(optsOf.get(x.id) ?? []).length > 0 && <span className="dim" style={{ fontSize: 12 }}> · options</span>}</span>
                <span className="dim" style={{ fontSize: 13 }}>{inr(x.price)}</span>
              </button>
            ))}
            {dishes !== null && shown.length === 0 && (
              <p className="dim" style={{ fontSize: 13, padding: '10px 0' }}>{search ? 'No dish matches that.' : 'No available dishes on the menu yet.'}</p>
            )}
          </div>
        </div>

        <div>
          <p className="overline" style={{ marginBottom: 4 }}>This bill</p>
          {d.lines.length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nothing added yet.</p>}
          {d.lines.map((l) => (
            <div key={l.key} style={{ borderBottom: '1px solid var(--line, #e7decc)', padding: '6px 0' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{l.name}</strong>
                  {l.optionLabels.length > 0 && <span className="dim" style={{ display: 'block', fontSize: 11.5 }}>{l.optionLabels.join(' · ')}</span>}
                  {l.note && <span className="dim" style={{ display: 'block', fontSize: 11.5, fontStyle: 'italic' }}>{l.note}</span>}
                </span>
                <button className="chip" aria-label={`One fewer ${l.name}`} onClick={() => setQty(l.key, l.qty - 1)}>−</button>
                <input className="code-input" style={{ width: 52, padding: '4px 6px', textAlign: 'center' }} inputMode="numeric"
                  aria-label={`Quantity of ${l.name}`} value={l.qty}
                  onChange={(e) => setQty(l.key, Math.max(0, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0)))} />
                <button className="chip" aria-label={`One more ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)}>＋</button>
                <button className="chip" aria-label={`Note for ${l.name}`} onClick={() => setNoteFor(noteFor === l.key ? null : l.key)}>✎</button>
              </div>
              {noteFor === l.key && (
                <input className="code-input" style={{ marginTop: 4, padding: '4px 8px' }} maxLength={120} autoFocus
                  placeholder="Kitchen note, e.g. less oil" value={l.note ?? ''}
                  onChange={(e) => setNote(l.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setNoteFor(null); }} aria-label={`Kitchen note for ${l.name}`} />
              )}
            </div>
          ))}
          <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
            {count ? `${count} item(s) · about ${inr(total)} before tax and charges` : ''}
          </p>
        </div>
      </div>

      {picking && (
        <div className="glass" style={{ padding: 12, marginTop: 10 }} role="dialog" aria-label={`Options for ${picking.name}`}>
          <p className="overline" style={{ marginBottom: 6 }}>{picking.name} — options</p>
          {(optsOf.get(picking.id) ?? []).map((o) => (
            <label key={o.id} className="row-item" style={{ cursor: 'pointer', gap: 8 }}>
              <span style={{ flex: 1 }}>{o.choice ? `${o.name}: ${o.choice}` : o.name}</span>
              <span className="dim">{o.price_delta ? `+${inr(o.price_delta)}` : ''}</span>
              <input type="checkbox" checked={picked.has(o.id)} onChange={(e) => {
                const n = new Set(picked); e.target.checked ? n.add(o.id) : n.delete(o.id); setPicked(n);
              }} />
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { addLine(picking, [...picked]); setPicking(null); searchRef.current?.focus(); }}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicking(null)}>Cancel</button>
          </div>
        </div>
      )}

      {holds && (
        <div className="glass" style={{ padding: 12, marginTop: 10 }}>
          <p className="overline" style={{ marginBottom: 6 }}>Held bills</p>
          {holds.length === 0 && <p className="dim" style={{ fontSize: 13 }}>No bills on hold.</p>}
          {holds.map((h) => (
            <div key={h.id} className="row-item" style={{ gap: 8 }}>
              <span style={{ flex: 1 }}><strong>{h.label}</strong>
                <span className="dim" style={{ fontSize: 12 }}> · {(h.payload?.lines ?? []).reduce((a, l) => a + l.qty, 0)} item(s) · {new Date(h.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => recall(h)}>Recall</button>
              <button className="chip" aria-label={`Delete ${h.label}`} onClick={async () => { await dropHold(h.id).catch(() => {}); showHolds(); }}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setHolds(null)}>Close</button>
        </div>
      )}

      {error && <p className="inline-error" role="alert" style={{ margin: '10px 0 0' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} disabled={busy || !d.lines.length} onClick={create}>
          Place order
        </button>
        <button className="btn btn-glass" disabled={!d.lines.length} onClick={hold}>Hold</button>
        <button className="btn btn-glass" onClick={showHolds}>Recall</button>
        <button className="btn btn-ghost" onClick={() => { setOpen(false); reset(); }}>Close</button>
      </div>
    </div>
  );
}
