/** Growth charts for the Orders page — revenue and order count over the last
 *  week, month or year. Drawn as inline SVG: a chart library would be the
 *  single largest thing in the bundle, and this is a bar chart. */
import React, { useEffect, useState } from 'react';
import { fetchGrowth, type GrowthPeriod, type GrowthPoint } from '../../lib/portalApi';
import { supabase } from '../../lib/supabase';
import { buildReportCsv, reportFileName } from '../../lib/reportCsv';
import { inr } from '../../lib/types';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** How far back the top-items and peak-hours queries reach, matching the app. */
function daysForPeriod(p: GrowthPeriod, from: string, to: string): number {
  if (p === 'custom') {
    const ms = new Date(to + 'T23:59:59').getTime() - new Date(from + 'T00:00:00').getTime();
    return Math.max(1, Math.ceil(ms / 86400000));
  }
  return p === 'day' ? 1 : p === 'week' ? 7 : p === 'month' ? 30 : 365;
}

const HOUR_LABELS: Record<number, string> = {
  11: '11 -- 12 PM', 12: '12 -- 1 PM', 13: '1 -- 2 PM', 14: '2 -- 3 PM',
  17: '5 -- 6 PM', 18: '6 -- 7 PM', 19: '7 -- 8 PM', 20: '8 -- 9 PM', 21: '9 -- 10 PM',
};

/**
 * The two series this card does not itself display.
 *
 * The portal's Growth card shows a trend and a total; the app's Reports screen
 * also ranks top items and peak hours. Exporting only what this screen happens
 * to render would produce a file that differs from the phone's for the same
 * week — and the first thing anyone does with two disagreeing exports is doubt
 * the numbers rather than the export. Same queries the app uses, so both
 * surfaces emit the same document.
 */
async function fetchExtraSeries(restaurantId: string, period: GrowthPeriod, from: string, to: string) {
  const since = new Date();
  since.setDate(since.getDate() - daysForPeriod(period, from, to));

  const [itemsRes, ordersRes] = await Promise.all([
    supabase
      .from('order_item')
      .select('name, qty, unit_price, food_order!inner(restaurant_id, placed_at)')
      .eq('food_order.restaurant_id', restaurantId)
      .gte('food_order.placed_at', since.toISOString()),
    supabase
      .from('food_order')
      .select('id, total, placed_at')
      .eq('restaurant_id', restaurantId)
      .neq('status', 'cancelled')
      .gte('placed_at', since.toISOString()),
  ]);

  const agg: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const it of (itemsRes.data ?? []) as any[]) {
    if (!agg[it.name]) agg[it.name] = { name: it.name, qty: 0, revenue: 0 };
    agg[it.name].qty += it.qty;
    agg[it.name].revenue += it.qty * Number(it.unit_price);
  }
  const topItems = Object.values(agg).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  const orders = (ordersRes.data ?? []) as any[];
  const hourCounts: Record<number, number> = {};
  for (const o of orders) {
    const h = new Date(o.placed_at).getHours();
    hourCounts[h] = (hourCounts[h] || 0) + 1;
  }
  const maxCount = Math.max(...Object.values(hourCounts), 1);
  const peakHours = Object.entries(hourCounts)
    .map(([h, c]) => ({
      label: HOUR_LABELS[Number(h)] || `${Number(h) % 12 || 12} ${Number(h) >= 12 ? 'PM' : 'AM'}`,
      intensity: c / maxCount,
    }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 5);

  return { topItems, peakHours };
}

const PERIODS: { key: GrowthPeriod; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: '30 days' },
  { key: 'year', label: '12 months' },
  { key: 'custom', label: 'Custom range' },
];

/** Compact money for axis labels — ₹1,24,500 is unreadable at 11px. */
function short(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

function Bars({ points, metric }: { points: GrowthPoint[]; metric: 'revenue' | 'orders' }) {
  const vals = points.map((p) => (metric === 'revenue' ? p.revenue : p.orders));
  const peak = Math.max(1, ...vals);
  // Fewer labels than bars on the 30-day view, or they overlap into mush.
  const step = points.length > 14 ? Math.ceil(points.length / 8) : 1;
  return (
    <div className="growth-chart" role="img"
      aria-label={`${metric === 'revenue' ? 'Revenue' : 'Orders'} by period, peak ${metric === 'revenue' ? inr(peak) : peak}`}>
      {points.map((p, i) => {
        const v = metric === 'revenue' ? p.revenue : p.orders;
        const pct = (v / peak) * 100;
        return (
          <div key={i} className="growth-col">
            <span className="growth-bar-wrap">
              <span
                className={v > 0 ? 'growth-bar' : 'growth-bar empty'}
                style={{ height: `${Math.max(pct, v > 0 ? 4 : 1)}%` }}
                title={`${p.label}: ${metric === 'revenue' ? inr(p.revenue) : `${p.orders} orders`}`}
              />
            </span>
            <span className="growth-tick">{i % step === 0 ? p.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Growth({ restaurantId }: { restaurantId: string }) {
  const [period, setPeriod] = useState<GrowthPeriod>('week');
  // Default the custom range to the last 7 days so the pickers open populated.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const [points, setPoints] = useState<GrowthPoint[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setPoints(null); setError('');
    fetchGrowth(restaurantId, period, from, to)
      .then((p) => alive && setPoints(p))
      .catch((e: any) => alive && setError(e?.message ?? 'Could not load growth.'));
    return () => { alive = false; };
  }, [restaurantId, period, from, to]);

  const total = (points ?? []).reduce((a, p) => a + p.revenue, 0);
  const count = (points ?? []).reduce((a, p) => a + p.orders, 0);
  // Second half vs first half — a plain, honest read on direction that does not
  // need a baseline the restaurant has not been running long enough to have.
  const half = Math.floor((points?.length ?? 0) / 2);
  const first = (points ?? []).slice(0, half).reduce((a, p) => a + p.revenue, 0);
  const second = (points ?? []).slice(half).reduce((a, p) => a + p.revenue, 0);
  const trend = first > 0 ? Math.round(((second - first) / first) * 100) : null;

  const [exporting, setExporting] = useState(false);

  /**
   * Hand the browser the file.
   *
   * A Blob and an object URL rather than a data: URI — a year of orders is
   * comfortably past the length a data: URI can carry in some browsers, and a
   * report that silently truncates is worse than one that fails. The URL is
   * revoked afterwards so the blob is not held for the life of the tab.
   */
  const downloadCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { data: rest } = await supabase
        .from('restaurant').select('name').eq('id', restaurantId).single();
      const extra = await fetchExtraSeries(restaurantId, period, from, to);

      const payload = {
        restaurantName: rest?.name || 'Restaurant',
        periodLabel: PERIODS.find((p) => p.key === period)?.label ?? String(period),
        from: period === 'custom'
          ? from
          : isoDay(new Date(Date.now() - daysForPeriod(period, from, to) * 86400000)),
        to: period === 'custom' ? to : isoDay(new Date()),
        totalRevenue: total,
        totalOrders: count,
        points: points ?? [],
        topItems: extra.topItems,
        peakHours: extra.peakHours,
        generatedAt: new Date(),
      };

      const blob = new Blob([buildReportCsv(payload)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportFileName(payload, 'csv');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? 'Could not build the report file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="overline">Growth</p>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
            {points ? inr(total) : '—'}
          </h2>
          <p className="dim" style={{ fontSize: 12.5 }}>
            {points ? `${count} order${count === 1 ? '' : 's'}` : 'Loading…'}
            {trend !== null && points && (
              <>
                {' · '}
                <span style={{ color: trend >= 0 ? 'var(--success, #1b8a3e)' : 'var(--error)', fontWeight: 700 }}>
                  {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
                </span>
                {' vs the first half'}
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* A dropdown rather than a chip row: five options no longer fit on a
              phone without wrapping into a second line of clutter. */}
          <select
            className="code-input"
            // 44px, not the 35px this used to be. It is the control that drives
            // the whole Reports screen, and it sat below the size a thumb
            // reliably hits. Height rather than vertical padding so the box
            // cannot shrink back when the font metrics change.
            style={{ padding: '0 10px', fontSize: 14, width: 'auto', minHeight: 44 }}
            value={period}
            onChange={(e) => setPeriod(e.target.value as GrowthPeriod)}
            aria-label="Reporting period"
          >
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {/* The report download the client asked for. It sits beside the
              period control because what you export is whatever that control is
              showing — putting it anywhere else invites exporting one range
              while looking at another. */}
          <button
            className={`chip${exporting ? ' is-busy' : ''}`}
            onClick={downloadCsv}
            disabled={exporting || !points}
            style={{ minHeight: 44 }}
            title="Download this report as a CSV for Excel"
          >
            {'⬇ CSV'}
          </button>
          {period === 'custom' && (
            <>
              {/* Native date inputs: a real calendar on every platform, and no
                  date-picker dependency in the bundle. */}
              <input type="date" className="code-input" aria-label="From date"
                style={{ padding: '7px 8px', fontSize: 12.5, width: 'auto' }}
                value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              <span className="dim" style={{ fontSize: 12 }}>to</span>
              <input type="date" className="code-input" aria-label="To date"
                style={{ padding: '7px 8px', fontSize: 12.5, width: 'auto' }}
                value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>
      </div>

      <div className="seg" style={{ marginTop: 12, width: 'fit-content' }}>
        <button className={metric === 'revenue' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMetric('revenue')}>Revenue</button>
        <button className={metric === 'orders' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMetric('orders')}>Orders</button>
      </div>

      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
      {points && !error && (
        points.some((p) => p.orders > 0) ? (
          <>
            <Bars points={points} metric={metric} />
            <p className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
              Peak {metric === 'revenue'
                ? short(Math.max(...points.map((p) => p.revenue)))
                : Math.max(...points.map((p) => p.orders))}
              {' · cancelled orders are not counted'}
            </p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13.5, marginTop: 12 }}>
            No orders in this period yet — the chart fills in as orders come through.
          </p>
        )
      )}
    </div>
  );
}
