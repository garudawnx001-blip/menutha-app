/**
 * Open service requests, above the order board.
 *
 * ABOVE THE TICKETS, NOT AMONG THEM. A request for tissues is not a ticket:
 * it is not cooked, not charged, and not billed. Mixing the two would mean
 * every count, filter and total on this board needs a special case for "not
 * really an order", and the first one anybody forgets is a napkin appearing
 * on a tax invoice.
 *
 * It is also the more urgent of the two in the moment. An order has a kitchen
 * working on it; a diner waiting for a napkin is waiting on nobody, and that
 * wait is measured in glances at the counter.
 *
 * SILENT WHEN EMPTY. A permanently visible "0 requests" strip is a line of
 * chrome the staff learn to look past, which is exactly what you do not want
 * from something that must catch the eye when it does appear.
 */
import React, { useEffect, useState } from 'react';
import {
  fetchOpenServiceRequests, resolveServiceRequest, SERVICE_LABEL,
  type ServiceRequestRow,
} from '../../lib/portalApi';

/** How long ago, in the words staff would use. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min';
  return `${mins} min`;
}

export function ServiceStrip({ restaurantId }: { restaurantId: string }) {
  const [rows, setRows] = useState<ServiceRequestRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    fetchOpenServiceRequests(restaurantId).then(setRows).catch(() => { /* board keeps working */ });

  useEffect(() => {
    load();
    // Same cadence as the board's own refresh. A request that appears eight
    // seconds late is fine; one that needs a page reload to appear is not.
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [restaurantId]);

  const done = async (id: string) => {
    setBusy(id);
    // Optimistic: the row goes now. Staff tap this while walking to the table,
    // and a row that lingers for a round-trip gets tapped twice.
    setRows((prev) => prev.filter((r) => r.id !== id));
    try { await resolveServiceRequest(id); }
    catch { load(); }
    finally { setBusy(null); }
  };

  if (!rows.length) return null;

  return (
    <div className="glass" style={{ padding: 12, marginBottom: 14 }}>
      <p className="overline" style={{ marginBottom: 8, color: 'var(--primary)' }}>
        {rows.length === 1 ? '1 request' : `${rows.length} requests`}
      </p>
      {rows.map((r) => (
        <div key={r.id} className="row-item" style={{ alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{SERVICE_LABEL[r.kind] ?? r.kind}</b>
            <span className="dim">
              {' · '}{r.dining_table?.label ?? 'Table'}
              {r.guest_name ? ` · ${r.guest_name}` : ''}
              {' · '}{ago(r.created_at)}
            </span>
            {r.note && <div className="dim" style={{ fontSize: 12.5 }}>{r.note}</div>}
          </span>
          <button className="chip" disabled={busy === r.id} onClick={() => done(r.id)}>
            Done
          </button>
        </div>
      ))}
    </div>
  );
}
