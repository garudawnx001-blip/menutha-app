/**
 * PHASE 3: A NEW TABLE'S FIRST ORDER WAITS FOR ONE TAP.
 *
 * Above the board, like service requests: it is not cooking yet. "Confirm"
 * sends it to the kitchen; "Not ours" cancels it (stock comes back). Silent
 * when nothing is waiting. Same words in the app (ConfirmStrip there).
 */
import React, { useEffect, useState } from 'react';
import { confirmOrder, fetchAwaitingConfirm, rejectUnconfirmedOrder, type AwaitingOrder } from '../../lib/portalApi';
import { startPoll } from '../../lib/poll';
import { ago } from './ServiceStrip';

export function ConfirmStrip({ restaurantId, onChanged }: { restaurantId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<AwaitingOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => fetchAwaitingConfirm(restaurantId).then(setRows).catch(() => { /* board keeps working */ });
  useEffect(() => {
    load();
    const t = startPoll(load, 6000);
    return () => t.stop();
  }, [restaurantId]);

  const act = async (id: string, ok: boolean) => {
    setBusy(id); setErr('');
    setRows((prev) => prev.filter((r) => r.id !== id));
    try { await (ok ? confirmOrder(id) : rejectUnconfirmedOrder(id)); onChanged?.(); }
    catch (e: any) { setErr(e?.message ?? 'Could not update the order.'); load(); }
    finally { setBusy(null); }
  };

  if (!rows.length && !err) return null;
  return (
    <div className="glass" style={{ padding: 12, marginBottom: 14, borderLeft: '4px solid var(--primary)' }}>
      <p className="overline" style={{ marginBottom: 8, color: 'var(--primary)' }}>
        {rows.length === 1 ? 'New table — 1 order to confirm' : `New tables — ${rows.length} orders to confirm`}
      </p>
      {err && <p style={{ color: 'var(--error)', fontSize: 13 }}>{err}</p>}
      {rows.map((r) => (
        <div key={r.id} className="row-item" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            <b>{r.is_parcel ? 'Takeaway' : r.dining_table?.label ?? 'Table'}</b>
            <span className="dim">
              {' · #'}{r.order_no}{r.guest_name ? ` · ${r.guest_name}` : ''}{' · '}{ago(r.placed_at)}{' · ₹'}{Number(r.total).toFixed(2)}
            </span>
            <div className="dim" style={{ fontSize: 12.5 }}>
              {r.order_item.map((i) => `${i.qty}× ${i.name}`).join(', ')}
            </div>
          </span>
          <button className="btn btn-primary" style={{ minHeight: 40 }} disabled={busy === r.id} onClick={() => act(r.id, true)}>
            Confirm
          </button>
          <button className="chip" disabled={busy === r.id} onClick={() => act(r.id, false)}>
            Not ours
          </button>
        </div>
      ))}
    </div>
  );
}
