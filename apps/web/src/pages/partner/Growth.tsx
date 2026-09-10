/** Growth charts for the Orders page — revenue and order count over the last
 *  week, month or year. Drawn as inline SVG: a chart library would be the
 *  single largest thing in the bundle, and this is a bar chart. */
import React, { useEffect, useState } from 'react';
import { fetchGrowth, type GrowthPeriod, type GrowthPoint } from '../../lib/portalApi';
import { supabase } from '../../lib/supabase';
import { buildReportCsv, reportFileName } from '../../lib/reportCsv';
import { printReportPdf } from '../../lib/reportPdf';
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
  // "Pick dates", which is what the app's two period controls say. One
  // phrase for one control across both surfaces -- the label is the only
  // thing that ever differed between them.
  { key: 'custom', label: 'Pick dates' },
];

/**
 * Compact money for chart labels.
 *
 * THE ₹1k BUG -- "amount is not aligning on bar graph", and it was this line:
 *
 *     if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
 *
 * Math.round(1050/1000) is 1. Math.round(1480/1000) is 1. Two bars of visibly
 * different height both printed "₹1k", so the number contradicted the picture
 * it was sitting on. It is also the likely half of "tickets are not moving to
 * reports": adding a ₹300 ticket to a ₹1,050 day still reads "₹1k", so a chart
 * that had moved looked frozen.
 *
 * Rounding to the nearest thousand was never the right compression for a
 * single restaurant's day. A day here is three or four figures, and three or
 * four figures FIT -- ₹1,480 is six characters. So the full number is printed
 * up to a lakh, with Indian digit grouping, and abbreviation starts only where
 * the string genuinely stops fitting. Where it does abbreviate it keeps one
 * decimal, so ₹1.2L and ₹1.4L stay distinguishable for the same reason.
 */
function short(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * A ROUND NUMBER AT OR ABOVE THE PEAK, and the gridlines that go with it.
 *
 * A chart whose tallest bar is exactly the top of the plot has no headroom and
 * no scale: you cannot read a height off it, only compare heights to each
 * other. Rounding the ceiling up to 1/2/5 x 10^n gives an axis whose labels are
 * numbers a person would actually say -- ₹1,500 rather than ₹1,483 -- and four
 * evenly spaced lines to read against.
 */
function niceCeiling(peak: number): number {
  if (peak <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(peak));
  const norm = peak / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const GRIDLINES = 4;

/**
 * The bar chart. "A clear and perfect graph, more detailed."
 *
 * WHAT WAS WRONG, beyond the ₹1k rounding fixed in `short` above: there was no
 * axis and no gridline of any kind, so a bar's height meant nothing on its own;
 * a day with no takings drew a one-pixel sliver indistinguishable from a
 * rendering artefact; and the bars ran the full width of their column with a
 * 3px gap, which at seven columns is a row of slabs rather than a chart.
 *
 * WHAT IT HAS NOW: a labelled Y axis with four gridlines behind the bars, a
 * ceiling rounded to a number worth reading, zero-days drawn as an explicit
 * flat marker on the baseline rather than almost-nothing, and bars capped at a
 * sensible width so a seven-day view does not look like a bar-code.
 */
function Bars({ points, metric }: { points: GrowthPoint[]; metric: 'revenue' | 'orders' }) {
  const money = metric === 'revenue';
  const vals = points.map((p) => (money ? p.revenue : p.orders));
  const peak = Math.max(...vals, 0);
  const top = niceCeiling(peak);
  const fmt = (n: number) => (money ? short(n) : String(Math.round(n)));
  // Fewer labels than bars on the 30-day view, or they overlap into mush.
  const step = points.length > 14 ? Math.ceil(points.length / 8) : 1;

  /* Top to bottom, so the array reads the way the axis is drawn. */
  const ticks = Array.from({ length: GRIDLINES + 1 }, (_, i) => (top * (GRIDLINES - i)) / GRIDLINES);

  return (
    <div className="growth-wrap">
      {/* The scale. `aria-hidden` because the figures are already in the
          chart's own label and in each bar's title -- a screen reader reading
          five axis numbers before reaching the data is worse than not having
          them. */}
      <div className="growth-axis" aria-hidden>
        {ticks.map((v, i) => (
          <span key={i} style={{ top: `${(i / GRIDLINES) * 100}%` }}>{fmt(v)}</span>
        ))}
      </div>

      <div
        className="growth-chart"
        role="img"
        aria-label={
          `${money ? 'Revenue' : 'Orders'} by period. `
          + `Peak ${money ? inr(peak) : peak}. `
          + points.map((p) => `${p.label}: ${money ? inr(p.revenue) : p.orders}`).join('; ')
        }
      >
        {/* Behind the bars, at the same percentages as the axis labels. The
            last tick is the baseline the bars stand on and is left undrawn --
            it would double with the bottom of the plot. */}
        <div className="growth-grid" aria-hidden>
          {ticks.slice(0, GRIDLINES).map((_, i) => (
            <span key={i} style={{ top: `${(i / GRIDLINES) * 100}%` }} />
          ))}
        </div>

        {points.map((p, i) => {
          const v = money ? p.revenue : p.orders;
          const pct = top > 0 ? (v / top) * 100 : 0;
          const label = i % step === 0;
          return (
            <div key={i} className="growth-col">
              {/* THE NUMBERS ON THE BARS. His reference showed the value
                  printed on the chart, and the figures were previously only in
                  a `title` tooltip -- invisible on a touch screen, which is
                  where he reads this. Money on top, order count under it,
                  because he asked for both.
                  Printed on the same cadence as the tick labels: at 30 bars
                  every column would otherwise carry two numbers eleven pixels
                  apart, which is the mush the tick step already avoids. */}
              <span className="growth-bar-wrap">
                {/* ON ITS OWN BAR. The label used to sit on a fixed line at the
                    top of the column, so a short bar had its number floating
                    high above it -- the tester's screenshot. Anchored to the
                    bar's height now: its bottom is the bar's own percentage. */}
                <span className="growth-val" aria-hidden
                  style={{ bottom: v > 0 ? `calc(${Math.max(pct, 1.5)}% + 3px)` : '6px' }}>
                  {label && v > 0 ? (<><b>{short(p.revenue)}</b><i>{p.orders}</i></>) : null}
                </span>
                {/* A DAY WITH NOTHING TAKEN IS A FACT, not an absence. It used
                    to render as a 1% sliver -- about a pixel and a half, which
                    reads as a glitch rather than a zero. It is now a flat
                    marker sitting on the baseline, wide as the bar, clearly
                    deliberate and clearly empty. */}
                <span
                  className={v > 0 ? 'growth-bar' : 'growth-bar empty'}
                  style={v > 0 ? { height: `${Math.max(pct, 1.5)}%` } : undefined}
                  title={`${p.label}: ${inr(p.revenue)}, ${p.orders} order${p.orders === 1 ? '' : 's'}`}
                />
              </span>
              <span className="growth-tick">{label ? p.label : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Growth({ restaurantId }: { restaurantId: string }) {
  const [period, setPeriod] = useState<GrowthPeriod>('week');
  /** Single-day mode: a custom range whose ends match. UI-only, so no new
   *  GrowthPeriod key and nothing changes server-side. */
  const [single, setSingle] = useState(false);
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
  /**
   * ONE PAYLOAD, TWO EXPORTS. Extracted so the CSV and the PDF are built from
   * the identical object: two exports of the same report that assemble their
   * own inputs is how a spreadsheet and a document come to disagree about a
   * total, and nobody looking at them would know which to believe.
   */
  const buildPayload = async () => {
    const { data: rest } = await supabase
      .from('restaurant').select('name').eq('id', restaurantId).single();
    const extra = await fetchExtraSeries(restaurantId, period, from, to);
    return {
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
  };

  const downloadCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const payload = await buildPayload();
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

  /**
   * THE PDF THE PORTAL NEVER HAD. The phone has offered CSV and PDF side by
   * side for months; here CSV was the only option, so an owner at the counter
   * machine could not produce the one document you hand to an accountant.
   *
   * A blocked pop-up is the ONE failure this has, and it is common enough that
   * saying so matters -- a button that visibly does nothing is what gets
   * reported as broken.
   */
  const openPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const ok = printReportPdf(await buildPayload());
      if (!ok) setError('Your browser blocked the report window. Allow pop-ups for this site and try again.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not build the report.');
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
            style={{ padding: '0 10px', fontSize: 14, width: 'auto' }}
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
            title="Download this report as a CSV for Excel"
          >
            {'⬇ CSV'}
          </button>
          {/* Beside CSV, on the same row and with the same disabled rule: the
              two are the same export in two formats, and separating them would
              invite exporting one range while looking at another. */}
          <button
            className={`chip${exporting ? ' is-busy' : ''}`}
            onClick={openPdf}
            disabled={exporting || !points}
            title="Open this report as a PDF to print or save"
          >
            {'⬇ PDF'}
          </button>
          {period === 'custom' && (
            <>
              {/* ONE DAY vs A RANGE. He asked for a single-date option; the
                  control only offered a range, so picking one day meant setting
                  the same date twice and hoping you had.
                  No new period key and no API change: a single day IS a custom
                  range whose ends match, which fetchGrowth already handles. The
                  toggle just collapses the two inputs into one and keeps `to`
                  pinned to `from`. */}
              <button
                className={single ? 'chip active' : 'chip'}
                onClick={() => {
                  const next = !single;
                  setSingle(next);
                  if (next) setTo(from);
                }}
                title={single ? 'Switch back to a date range' : 'Report on one day'}
              >
                {single ? 'One day' : 'Range'}
              </button>
              {/* Native date inputs: a real calendar on every platform, and no
                  date-picker dependency in the bundle. */}
              <input type="date" className="code-input"
                aria-label={single ? 'Date' : 'From date'}
                style={{ padding: '0 8px', fontSize: 13, width: 'auto' }}
                value={from} max={single ? iso(new Date()) : to}
                onChange={(e) => { setFrom(e.target.value); if (single) setTo(e.target.value); }} />
              {!single && (
                <>
                  <span className="dim" style={{ fontSize: 12 }}>to</span>
                  <input type="date" className="code-input" aria-label="To date"
                    style={{ padding: '0 8px', fontSize: 13, width: 'auto' }}
                    value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="seg" style={{ marginTop: 12, width: 'fit-content' }}>
        <button className={metric === 'revenue' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMetric('revenue')}>Revenue</button>
        <button className={metric === 'orders' ? 'seg-btn active' : 'seg-btn'} onClick={() => setMetric('orders')}>Orders</button>
      </div>

      {error && <p className="inline-error" style={{ marginTop: 10 }}>{error}</p>}
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
