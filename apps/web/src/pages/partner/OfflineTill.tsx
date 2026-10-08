/**
 * OFFLINE TILL — the connection indicator and, while the connection is down,
 * the tables with orders taken in this browser, a provisional bill and
 * payment for each, and what is waiting to be sent. Same words and order as
 * the app's OfflineTill. The server prices the bill and gives the invoice
 * number at sync; a different total, a dish that ran out or a table paid on
 * another device is asked about here, never adjusted silently.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { SettlePanel } from './SettlePanel';
import type { SettleResult } from '../../lib/portalApi';
import { queue, useConnection, readOfflineData, newLocalId, type OfflineData } from '../../lib/offline';
import { ref, type QueuedOp } from '../../lib/offlineQueue';
import { provisionalBill } from '../../lib/offlineCalc';
import { printBillDirect } from '../../lib/directPrint';
import { billDateText, type BillData } from '../../lib/billTemplate';
import { rupees } from '../../lib/splitPay';

export function ConnectionBadge({ restaurantId }: { restaurantId: string }) {
  const c = useConnection(restaurantId);
  const cls = c.state === 'online' ? 'conn-online' : c.state === 'syncing' ? 'conn-syncing' : 'conn-offline';
  const text = c.state === 'online'
    ? (c.conflicts ? `Online · ${c.conflicts} need a decision` : 'Online')
    : c.state === 'syncing' ? `Sending ${c.pending}…` : `Offline · ${c.pending} saved in this browser`;
  return (
    <button className={`conn-badge ${cls}`} onClick={() => { c.syncNow().catch(() => {}); }}
      title="Tap to check the connection now" aria-label={`Connection: ${text}`}>
      <span className="conn-dot" /> {text}
    </button>
  );
}

type TableGroup = { key: string; label: string; isParcel: boolean; offline: QueuedOp[]; server: OfflineData['openOrders'] };

export function OfflineTill({ restaurantId, onSynced }: { restaurantId: string; onSynced?: () => void }) {
  const c = useConnection(restaurantId);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [billing, setBilling] = useState<string | null>(null);
  /** An order refused at sync, open for "remove a dish". */
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => queue.subscribe((st) => setOps([...st.ops])), []);
  useEffect(() => { if (c.state === 'online' && c.pending === 0) onSynced?.(); }, [c.state, c.pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => readOfflineData(restaurantId), [restaurantId, c.state, ops.length]);

  const billedLocal = useMemo(() => {
    const ids = new Set<string>();
    for (const o of ops) if (o.kind === 'bill' && o.status !== 'discarded') {
      for (const x of (o.args.p_order_ids as any[]) ?? []) ids.add(typeof x === 'object' ? x.$ref : x);
    }
    return ids;
  }, [ops]);

  const tables = useMemo<TableGroup[]>(() => {
    const g = new Map<string, TableGroup>();
    const put = (key: string, label: string, isParcel: boolean) => {
      if (!g.has(key)) g.set(key, { key, label, isParcel, offline: [], server: [] });
      return g.get(key)!;
    };
    for (const o of ops) {
      if (o.kind !== 'order' || o.status === 'discarded' || billedLocal.has(o.localId)) continue;
      if (o.status === 'done' && c.state === 'online') continue;
      put(String(o.meta?.tableId ?? ''), o.meta?.tableLabel ?? 'Table', !!o.meta?.isParcel).offline.push(o);
    }
    if (c.state !== 'online') {
      for (const so of data?.openOrders ?? []) {
        if (billedLocal.has(so.id)) continue;
        put(String(so.table_id ?? ''), so.is_parcel ? 'Parcel / Takeaway' : (so.table_label ?? 'Table'), !!so.is_parcel).server.push(so);
      }
    }
    return [...g.values()].filter((t) => t.offline.length || t.server.length);
  }, [ops, data, billedLocal, c.state]);

  const open = ops.filter((o) => o.status === 'pending' || o.status === 'conflict');
  if (c.state === 'online' && open.length === 0 && tables.length === 0) {
    return <div style={{ margin: '10px 0' }}><ConnectionBadge restaurantId={restaurantId} /></div>;
  }

  const pricing = data?.pricing ?? {};
  const provisional = (t: TableGroup) => provisionalBill(pricing,
    t.offline.map((o) => ({ lines: (o.meta?.items ?? []).map((i: any) => ({ price: i.price, qty: i.qty, gst_rate: i.gst_rate })), isParcel: !!o.meta?.isParcel })),
    t.server.map((so) => so.total));

  const billData = (t: TableGroup, ref_: string, totalP: number): BillData => {
    const p = provisional(t);
    return {
      restaurant: { name: String((pricing as any).name ?? ''), address: '', city: '', phone: '', gstin: '', fssai: '', thanks: '', terms: '', logoUrl: null },
      docTitle: 'ORDER SUMMARY (PROVISIONAL)', billNo: `Offline ref ${ref_} · invoice no. given when online`,
      dateText: billDateText(new Date().toISOString()), tableText: t.label, customer: { name: 'Guest', phone: '' },
      items: [
        ...t.server.flatMap((so) => so.items.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price }))),
        ...t.offline.flatMap((o) => (o.meta?.items ?? []).map((i: any) => ({ name: i.name, qty: i.qty, unit_price: i.price }))),
      ],
      subtotal: p.itemsP / 100, discount: 0, packing: p.packingP / 100, service: 0,
      sgstPct: p.ratePct / 2, cgstPct: p.ratePct / 2, sgst: p.taxP / 200, cgst: p.taxP / 200,
      roundOff: p.roundOffP / 100, total: totalP / 100,
    } as BillData;
  };

  const settleOffline = (t: TableGroup) => async (_id: string, tenders: unknown[]): Promise<SettleResult> => {
    const p = provisional(t);
    const offRef = await queue.nextRef();
    const bLocal = newLocalId('b');
    await queue.enqueue({
      localId: bLocal, kind: 'bill', label: `${t.label} · ${offRef}`,
      args: { p_restaurant_id: restaurantId, p_order_ids: [...t.server.map((so) => so.id), ...t.offline.map((o) => ref(o.localId))],
              p_discount: 0, p_client_ref: offRef, p_client_at: new Date().toISOString() },
      meta: { tableLabel: t.label, provisionalP: p.totalP },
    });
    await queue.enqueue({
      localId: newLocalId('s'), kind: 'settle', label: `${t.label} · ${offRef}`, expectTotalP: p.totalP,
      args: { p_bill_id: ref(bLocal), p_tenders: tenders }, meta: { tableLabel: t.label },
    });
    printBillDirect(billData(t, offRef, p.totalP), null).catch(() => {});
    setBilling(null);
    c.syncNow().catch(() => {});
    const parts = (tenders as any[]).map((x, i) => ({ seq: i + 1, mode: x.mode, amount: x.amount, tendered: x.tendered ?? null,
      change_due: x.tendered ? Math.max(0, x.tendered - x.amount) : 0, payer: x.payer ?? null }));
    return { id: bLocal, status: 'paid', mode: parts.length > 1 ? 'split' : parts[0]?.mode, total: p.totalP / 100,
      change_due: parts.reduce((a, x) => a + x.change_due, 0), tenders: parts };
  };

  const decide = (o: QueuedOp) => {
    const msg = o.error?.message ?? 'The server refused this.';
    if (o.kind === 'settle' && o.error?.code === 'AMOUNT') {
      const serverP = Number(o.result?.serverTotalP ?? 0);
      const diff = serverP - Number(o.expectTotalP ?? 0);
      if (window.confirm(`The bill came out different. ${msg}\n\n${diff > 0 ? `Collect ${rupees(diff)} more` : `Give back ${rupees(-diff)}`} and settle at ${rupees(serverP)}?`)) {
        const tenders = [...((o.args.p_tenders as any[]) ?? [])].map((x) => ({ ...x }));
        const last = tenders[tenders.length - 1];
        last.amount = Math.round(Number(last.amount) * 100 + diff) / 100;
        if (last.tendered != null && last.tendered < last.amount) last.tendered = last.amount;
        queue.retry(o.localId, { args: { ...o.args, p_tenders: tenders }, expectTotalP: serverP }).then(() => c.syncNow());
      }
      return;
    }
    if (o.kind === 'order') { setEditing(o.localId); return; }   // choices shown under it
    const paidElsewhere = /already paid/i.test(msg);
    if (window.confirm(`${o.kind === 'bill' ? 'This offline bill' : 'This payment'} was not accepted — ${o.label}: ${msg}${paidElsewhere ? '\n\nIt was paid on another device. If you also took money for it, give it back.' : ''}\n\nOK = discard it, Cancel = keep for later`)) {
      queue.discard(o.localId);
    }
  };

  return (
    <div className="glass" style={{ padding: 14, margin: '12px 0' }}>
      <div className="topbar" style={{ padding: 0 }}>
        <strong>{c.state === 'online' ? 'Sending what was saved offline' : 'Offline till'}</strong>
        <ConnectionBadge restaurantId={restaurantId} />
      </div>
      {c.state !== 'online' && (
        <p className="dim" style={{ fontSize: 12.5, margin: '6px 0' }}>
          No connection. Take orders with “New bill” as usual — they are saved in this browser, the KOT prints,
          and everything is sent when the connection is back. Totals here are provisional; the server gives the invoice number.
        </p>
      )}
      {tables.map((t) => {
        const p = provisional(t);
        return (
          <div key={t.key} style={{ borderTop: '1px solid var(--border, #e5ded0)', paddingTop: 8, marginTop: 8 }}>
            <div className="bill-row"><strong>{t.label}</strong><strong>{rupees(p.totalP)}</strong></div>
            <p className="dim" style={{ fontSize: 12, margin: 0 }}>
              {[...t.server.map((so) => `#${so.order_no}`), ...t.offline.map(() => 'new (offline)')].join(' · ')} · provisional
            </p>
            {billing === t.key ? (
              <SettlePanel billId={`offline-${t.key}`} total={p.totalP / 100}
                items={t.offline.flatMap((o) => (o.meta?.items ?? []).map((i: any) => ({ name: i.name, qty: i.qty, amount_p: Math.round(i.price * 100) * i.qty })))}
                settle={settleOffline(t)} onSettled={() => setBilling(null)} />
            ) : (
              <button className="chip" style={{ marginTop: 6 }} onClick={() => setBilling(t.key)}>Bill & take payment</button>
            )}
          </div>
        );
      })}
      {open.length > 0 && <p className="dim" style={{ fontSize: 12, margin: '10px 0 2px' }}>Waiting to be sent</p>}
      {open.map((o) => (
        <React.Fragment key={o.localId}>
          <div className="row-item">
            <span style={{ fontSize: 13, color: o.status === 'conflict' ? 'var(--danger, #a32020)' : undefined }}>
              {o.kind === 'order' ? 'Order' : o.kind === 'bill' ? 'Bill' : 'Payment'} · {o.label}
              {o.status === 'conflict' ? ` — ${o.error?.message ?? 'needs a decision'}` : ''}
            </span>
            {o.status === 'conflict' && <button className="chip" onClick={() => decide(o)}>Decide</button>}
          </div>
          {editing === o.localId && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 8px' }}>
              {(o.meta?.items ?? []).length > 1 && (o.meta?.items ?? []).map((it: any, i: number) => (
                <button key={`${it.id}-${i}`} className="chip" onClick={() => {
                  const left = (o.meta?.items ?? []).filter((_: any, k: number) => k !== i);
                  setEditing(null);
                  if (!left.length) { queue.discard(o.localId); return; }
                  queue.retry(o.localId, { args: { ...o.args, p_items: left.map((x: any) => ({ menu_item_id: x.id, qty: x.qty, option_ids: [] })) },
                                           meta: { ...o.meta, items: left } }).then(() => c.syncNow());
                }}>Remove {it.qty}× {it.name}</button>
              ))}
              <button className="chip" onClick={() => { setEditing(null); queue.retry(o.localId).then(() => c.syncNow()); }}>Send as it is</button>
              <button className="chip" onClick={() => { setEditing(null); queue.discard(o.localId); }}>Discard order</button>
              <button className="chip" onClick={() => setEditing(null)}>Keep for later</button>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
