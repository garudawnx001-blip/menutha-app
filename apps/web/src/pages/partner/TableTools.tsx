/**
 * PHASE 3: MOVE, MERGE AND SPLIT, on Billing.
 *
 *   - Move this table's orders to another table (or merge them into a table
 *     that already has orders).
 *   - Move some of a dish to another table, or split it off into its own
 *     order on this table so it can be billed on its own.
 * Refused by the server for anything already on a bill or paid ("cancel that
 * bill first"), exactly like an edit. Same words in the app.
 */
import React, { useEffect, useState } from 'react';
import { fetchTables, type PortalOrder, type PortalTable } from '../../lib/portalApi';
import { moveOrderItem, moveTableOrders } from '../../lib/pos';

export function TableTools({ restaurantId, tableId, orders, onDone }: {
  restaurantId: string; tableId: string | null; orders: PortalOrder[]; onDone: () => void;
}) {
  const [tables, setTables] = useState<PortalTable[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [itemTarget, setItemTarget] = useState<Record<string, string>>({});
  const [itemQty, setItemQty] = useState<Record<string, number>>({});

  useEffect(() => { fetchTables(restaurantId).then(setTables).catch(() => {}); }, [restaurantId]);
  const others = tables.filter((t) => t.id !== tableId);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); onDone(); } catch (e: any) { setErr(e?.message ?? 'Could not move that.'); } finally { setBusy(false); }
  };

  return (
    <div className="glass" style={{ padding: '8px 16px', marginBottom: 10 }}>
      {tableId && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13.5 }}>Move or merge this table into</span>
          <select className="code-input" style={{ flex: '1 1 140px', padding: '6px 10px' }} value={target}
            onChange={(e) => setTarget(e.target.value)} aria-label="Target table">
            <option value="">Choose a table…</option>
            {others.map((t) => <option key={t.id} value={t.id}>{t.is_parcel ? 'Takeaway / parcel' : t.label}</option>)}
          </select>
          <button className="btn btn-glass btn-sm" disabled={busy || !target}
            onClick={() => run(() => moveTableOrders(tableId, target))}>Move all</button>
        </div>
      )}
      <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
        Move part of a dish to another table, or split it off to bill it on its own. Not possible once a bill is raised on it.
      </p>
      {orders.map((o) => (o.items ?? []).map((it: any) => (
        <div key={it.id} className="row-item" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 140px', minWidth: 0 }}>
            <strong style={{ fontSize: 13.5 }}>{it.name}</strong>
            <span className="dim" style={{ fontSize: 12 }}> · #{o.order_no} · {it.qty}</span>
          </span>
          <input className="code-input" style={{ width: 56, padding: '4px 6px', textAlign: 'center' }} inputMode="numeric"
            aria-label={`How many ${it.name} to move`} value={itemQty[it.id] ?? 1}
            onChange={(e) => setItemQty((m) => ({ ...m, [it.id]: Math.max(1, Math.min(Number(it.qty), Number(e.target.value.replace(/\D/g, '')) || 1)) }))} />
          <select className="code-input" style={{ flex: '1 1 130px', padding: '4px 8px' }} value={itemTarget[it.id] ?? ''}
            onChange={(e) => setItemTarget((m) => ({ ...m, [it.id]: e.target.value }))} aria-label={`Where to move ${it.name}`}>
            <option value="">Separate bill, same table</option>
            {others.map((t) => <option key={t.id} value={t.id}>{t.is_parcel ? 'Takeaway / parcel' : t.label}</option>)}
          </select>
          <button className="chip" disabled={busy}
            onClick={() => run(() => moveOrderItem(it.id, itemQty[it.id] ?? 1, itemTarget[it.id] || null))}>Move</button>
        </div>
      )))}
      {err && <p className="inline-error" role="alert" style={{ marginTop: 6 }}>{err}</p>}
    </div>
  );
}
