/**
 * STOCK (2026-10-12b) — under Reports, same block in the same place as the
 * app's Reports → Stock. Off until the owner or a manager switches it on.
 *
 * Per dish: count it or not, "Stock in" when a batch is made or delivered,
 * "Set count" after a physical count, and a low-stock warning level. A dish
 * that reaches 0 leaves the QR menu by itself and comes back on Stock in.
 * Recipes and ingredient costing come later.
 */
import React, { useEffect, useState } from 'react';
import { fetchStockReport, setStockEnabled, stockIn, stockSet, fetchDishesWithStock } from '../../lib/portalApi';
import { stockLabel, stockTone, parseCount, type StockReport } from '../../lib/stock';

type Dish = Awaited<ReturnType<typeof fetchDishesWithStock>>[number];

export function StockSection({ restaurantId, canManage }: { restaurantId: string; canManage: boolean }) {
  const [report, setReport] = useState<StockReport | null>(null);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'counted' | 'all'>('counted');

  const load = async () => {
    setError('');
    try {
      const [r, d] = await Promise.all([fetchStockReport(restaurantId), fetchDishesWithStock(restaurantId)]);
      setReport(r); setDishes(d);
    } catch (e: any) {
      setError(/PGRST202|could not find the function|stock_qty/i.test(String(e?.message))
        ? 'Stock arrives with the Phase 2 database update.' : (e?.message ?? 'Could not load stock.'));
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [restaurantId]);

  const act = (key: string, fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(key); setError('');
    try { await fn(); await load(); } catch (e: any) { setError(e?.message ?? 'Could not change the stock.'); }
    finally { setBusy(''); }
  };

  const askCount = (title: string, initial = ''): number | null | undefined => {
    const v = window.prompt(title, initial);
    if (v == null) return undefined;
    const n = parseCount(v);
    if (n == null) { setError('Type a whole number of portions, e.g. 12.'); return undefined; }
    return n;
  };

  const sold = new Map((report?.items ?? []).map((i) => [i.menu_item_id, i]));
  const shown = (dishes ?? []).filter((d) => filter === 'all' || d.stock_qty != null);

  return (
    <div className="glass" style={{ padding: 18, marginTop: 18 }}>
      <div className="topbar" style={{ padding: 0 }}>
        <p className="overline" style={{ margin: 0 }}>Stock</p>
        {report && canManage && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={!!report.enabled} disabled={!!busy}
              onChange={act('toggle', () => setStockEnabled(restaurantId, !report.enabled))} />
            Count stock
          </label>
        )}
      </div>
      <p className="dim" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
        Orders take portions and cancelled orders give them back. A dish at 0 leaves the QR menu until you add stock.
        Dishes you do not count are never limited.
      </p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {report && !report.enabled && <p className="muted" style={{ fontSize: 14 }}>Stock counting is off.</p>}
      {report?.enabled && (
        <>
          <p style={{ fontSize: 14, margin: '0 0 8px' }}>
            <b>{report.out_count}</b> out of stock · <b>{report.low_count}</b> running low
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className={filter === 'counted' ? 'chip active' : 'chip'} onClick={() => setFilter('counted')}>Counted dishes</button>
            <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>All dishes</button>
          </div>
          {shown.length === 0 && (
            <p className="muted" style={{ fontSize: 14 }}>No dish is counted yet. Choose “All dishes” and press “Stock in” on one.</p>
          )}
          {shown.map((d) => {
            const tone = stockTone(d.stock_qty, d.stock_low_at);
            const r = sold.get(d.id);
            return (
              <div key={d.id} className="row-item" style={{ alignItems: 'center' }}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{d.name}</strong>
                  <span className={`stock-badge stock-${tone}`}>{stockLabel(d.stock_qty, d.stock_low_at)}</span>
                  {r && (r.sold || r.stock_in) ? (
                    <span className="dim" style={{ display: 'block', fontSize: 12 }}>
                      Today: sold {r.sold}{r.returned ? `, back ${r.returned}` : ''}{r.stock_in ? `, in ${r.stock_in}` : ''}
                      {d.stock_low_at != null ? ` · warn at ${d.stock_low_at}` : ''}
                    </span>
                  ) : d.stock_low_at != null ? <span className="dim" style={{ display: 'block', fontSize: 12 }}>warn at {d.stock_low_at}</span> : null}
                </span>
                {canManage && (
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="chip" disabled={!!busy} onClick={() => {
                      const n = askCount(`Stock in: how many portions of ${d.name} came in?`);
                      if (n) act(`in-${d.id}`, () => stockIn(d.id, n))();
                    }}>Stock in</button>
                    {d.stock_qty != null && (
                      <>
                        <button className="chip" disabled={!!busy} onClick={() => {
                          const n = askCount(`Set count: how many portions of ${d.name} are there now?`, String(d.stock_qty ?? ''));
                          if (n != null) act(`set-${d.id}`, () => stockSet(d.id, n, d.stock_low_at))();
                        }}>Set count</button>
                        <button className="chip" disabled={!!busy} onClick={() => {
                          const v = window.prompt(`Warn when ${d.name} is down to how many? (empty = no warning)`, d.stock_low_at == null ? '' : String(d.stock_low_at));
                          if (v == null) return;
                          const n = v.trim() === '' ? null : parseCount(v);
                          if (v.trim() !== '' && n == null) { setError('Type a whole number, e.g. 5.'); return; }
                          act(`low-${d.id}`, () => stockSet(d.id, d.stock_qty, n))();
                        }}>Warn at</button>
                        <button className="chip" disabled={!!busy} onClick={() => {
                          if (window.confirm(`Stop counting ${d.name}? It will never be limited again until you stock it in.`)) {
                            act(`stop-${d.id}`, () => stockSet(d.id, null, null))();
                          }
                        }}>Stop counting</button>
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
