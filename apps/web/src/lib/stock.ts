/**
 * BASIC STOCK — types and wording shared by the app and the web portal.
 *
 * MIRRORED FILE: identical copy at menutha-app-deploy/apps/web/src/lib/stock.ts.
 * The counting itself is the server's (2026-10-12b): orders take portions and
 * cancels give them back inside the same transaction; this file only says
 * what to show.
 */

export interface StockItem {
  menu_item_id: string; name: string; category_id: string | null;
  stock_qty: number; stock_low_at: number | null; is_available: boolean;
  out: boolean; low: boolean; sold: number; returned: number; stock_in: number;
}
export interface StockReport {
  day: string; enabled: boolean; items: StockItem[]; low_count: number; out_count: number;
}

/** "12 left", "Low · 2 left", "Out of stock", "Not counted". */
export function stockLabel(qty: number | null | undefined, lowAt?: number | null): string {
  if (qty == null) return 'Not counted';
  if (qty <= 0) return 'Out of stock';
  if (lowAt != null && qty <= lowAt) return `Low · ${qty} left`;
  return `${qty} left`;
}

export type StockTone = 'ok' | 'low' | 'out' | 'none';
export function stockTone(qty: number | null | undefined, lowAt?: number | null): StockTone {
  if (qty == null) return 'none';
  if (qty <= 0) return 'out';
  if (lowAt != null && qty <= lowAt) return 'low';
  return 'ok';
}

/** The one-line alert staff see on the billing and order screens, or '' when
 *  nothing needs attention. Lists at most three dishes by name. */
export function stockAlertText(r: StockReport | null | undefined): string {
  if (!r || !r.enabled) return '';
  const out = r.items.filter((i) => i.out);
  const low = r.items.filter((i) => i.low && !i.out);
  if (!out.length && !low.length) return '';
  const names = (xs: StockItem[]) => xs.slice(0, 3).map((i) => i.name).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '');
  const parts: string[] = [];
  if (out.length) parts.push(`Out of stock: ${names(out)}`);
  if (low.length) parts.push(`Running low: ${low.slice(0, 3).map((i) => `${i.name} (${i.stock_qty})`).join(', ')}${low.length > 3 ? ` +${low.length - 3}` : ''}`);
  return parts.join(' · ');
}

/** A whole number of portions from a text box, or null if it is not one. */
export function parseCount(v: string): number | null {
  const s = v.trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return Number(s);
}
