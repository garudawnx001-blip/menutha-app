/**
 * The Reports export, as a CSV both surfaces produce identically.
 *
 * MIRRORED FILE. The mobile app has a byte-identical copy at
 * apps/mobile/src/lib/reportCsv.ts. The two live in separate repositories, so a
 * shared package is not available; this is the same arrangement as
 * lib/translit.ts, and for the same reason. Edit one, mirror the other — an
 * owner who exports the same week from the phone and from the counter PC must
 * get the same file, or the numbers will be questioned rather than the export.
 *
 * Four decisions that matter more than they look:
 *
 * 1. A UTF-8 BOM is written first. Excel on Windows assumes the system code
 *    page for a .csv with no BOM, which turns every ₹ into "â‚¹" and every
 *    Kannada dish name into a row of boxes. The BOM is three bytes that make
 *    the difference between a file the client can use and one they send back.
 *
 * 2. CRLF line endings, per RFC 4180 and because the destination is Excel.
 *
 * 3. Numbers are written raw — 1234.5, not "₹ 1,234.50". The whole point of a
 *    CSV is that somebody sums the column; a formatted number is text, and
 *    text sums to zero. The rupee lives in the column heading instead.
 *
 * 4. Any field starting with = + - or @ is prefixed with an apostrophe. Excel
 *    treats those as formulas, and dish names are typed by restaurant staff
 *    into a field that ends up in a file an accountant opens. This is the
 *    standard CSV-injection guard and it costs one character.
 */

export type ReportCsvInput = {
  restaurantName: string;
  /** "This week", "30 days", … — what the period control was showing. */
  periodLabel: string;
  from: string;
  to: string;
  totalRevenue: number;
  totalOrders: number;
  points: { label: string; revenue: number; orders: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  peakHours: { label: string; intensity: number }[];
  /** Pass the moment of export; this module never reads the clock itself. */
  generatedAt: Date;
};

const NL = '\r\n';

/** One CSV field: escaped, and defused if Excel would read it as a formula. */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const row = (...cells: (string | number | null | undefined)[]) =>
  cells.map(cell).join(',');

/** Two decimals, no separators, no symbol — a number a spreadsheet can add. */
const money = (n: number) => (Number(n) || 0).toFixed(2);

export function buildReportCsv(r: ReportCsvInput): string {
  const lines: string[] = [];

  lines.push(row('Menutha — Sales report'));
  lines.push(row('Restaurant', r.restaurantName));
  lines.push(row('Period', r.periodLabel));
  lines.push(row('From', r.from));
  lines.push(row('To', r.to));
  lines.push(row('Generated', r.generatedAt.toISOString()));
  lines.push('');

  lines.push(row('Summary'));
  lines.push(row('Total revenue (INR)', money(r.totalRevenue)));
  lines.push(row('Total orders', r.totalOrders));
  lines.push(row(
    'Average order value (INR)',
    money(r.totalOrders > 0 ? r.totalRevenue / r.totalOrders : 0),
  ));
  lines.push('');

  lines.push(row('Trend'));
  lines.push(row('Bucket', 'Revenue (INR)', 'Orders'));
  for (const p of r.points) lines.push(row(p.label, money(p.revenue), p.orders));
  if (!r.points.length) lines.push(row('(no data in this period)'));
  lines.push('');

  lines.push(row('Top items'));
  lines.push(row('Rank', 'Item', 'Quantity', 'Revenue (INR)'));
  r.topItems.forEach((t, i) => lines.push(row(i + 1, t.name, t.qty, money(t.revenue))));
  if (!r.topItems.length) lines.push(row('(no items sold in this period)'));
  lines.push('');

  lines.push(row('Peak hours'));
  lines.push(row('Hour', 'Share of busiest hour (%)'));
  for (const h of r.peakHours) {
    lines.push(row(h.label, Math.round((Number(h.intensity) || 0) * 100)));
  }
  if (!r.peakHours.length) lines.push(row('(no orders in this period)'));

  // BOM first — see note 1 above.
  return '﻿' + lines.join(NL) + NL;
}

/** A filename that sorts chronologically and survives every filesystem. */
export function reportFileName(r: Pick<ReportCsvInput, 'restaurantName' | 'from' | 'to'>, ext: string) {
  const slug = (r.restaurantName || 'menutha')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'menutha';
  const range = r.from === r.to ? r.from : `${r.from}_to_${r.to}`;
  return `${slug}-report-${range}.${ext}`;
}
