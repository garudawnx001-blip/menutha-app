/**
 * THE PROVISIONAL TOTAL of a bill raised while offline.
 *
 * MIRRORED FILE: identical copy at menutha-app-deploy/apps/web/src/lib/offlineCalc.ts.
 *
 * The real calculation is the server's (bill_compute) and runs at sync. This
 * reproduces the common case — dish prices, the restaurant's GST rates (or a
 * dish's own), prices that include GST, a parcel charge, round-off — so the
 * amount collected offline is almost always the amount the server arrives
 * at. When it is not (a standing charge line, a discount rule, a price changed
 * meanwhile), the sync stops and staff are shown both figures; nothing is
 * adjusted silently. Everything in integer paise.
 */

export interface PricingSnapshot {
  sgst_pct?: number | null; cgst_pct?: number | null;
  gst_mode?: string | null;               // 'composition' | 'unregistered' = no tax lines
  prices_include_gst?: boolean | null;
  round_off_bills?: boolean | null;
  parcel_charge?: number | null;          // per parcel order
  tax_packing?: boolean | null;
}
export interface CalcLine { price: number; qty: number; gst_rate?: number | null }
export interface Provisional { itemsP: number; packingP: number; taxP: number; roundOffP: number; totalP: number; ratePct: number }

const P = (r: number) => Math.round((Number(r) || 0) * 100);

/** One offline order. */
export function provisionalOrder(s: PricingSnapshot, lines: CalcLine[], isParcel: boolean): Provisional {
  const noTax = s.gst_mode === 'composition' || s.gst_mode === 'unregistered';
  const base = (Number(s.sgst_pct ?? 2.5) || 0) + (Number(s.cgst_pct ?? 2.5) || 0);
  const buckets = new Map<number, number>();               // rate -> amount paise
  let itemsP = 0;
  for (const l of lines) {
    const a = P(l.price) * Math.max(0, Math.round(l.qty));
    itemsP += a;
    const rate = noTax ? 0 : (l.gst_rate != null ? Number(l.gst_rate) : base);
    buckets.set(rate, (buckets.get(rate) ?? 0) + a);
  }
  const packingP = isParcel ? P(s.parcel_charge ?? 0) : 0;
  if (packingP && (s.tax_packing ?? true) && !noTax) buckets.set(base, (buckets.get(base) ?? 0) + packingP);
  let taxP = 0;
  const incl = !!s.prices_include_gst;
  for (const [rate, amt] of buckets) {
    if (!rate) continue;
    // half SGST, half CGST, each rounded (as the server does per bucket)
    const half = (x: number) => (incl ? Math.round((x * rate) / (100 + rate) / 2) : Math.round((x * rate) / 100 / 2));
    taxP += half(amt) * 2;
  }
  const raw = incl ? itemsP + packingP : itemsP + packingP + taxP;
  const roundOffP = s.round_off_bills ? Math.round(raw / 100) * 100 - raw : 0;
  return { itemsP, packingP, taxP, roundOffP, totalP: raw + roundOffP, ratePct: base };
}

/** A whole offline bill: offline orders worked out here, plus orders the
 *  server had already priced (their stored totals), less a discount. */
export function provisionalBill(s: PricingSnapshot, offline: { lines: CalcLine[]; isParcel: boolean }[],
                                serverTotals: number[] = [], discount = 0): Provisional {
  const parts = offline.map((o) => provisionalOrder(s, o.lines, o.isParcel));
  const sum = (k: keyof Provisional) => parts.reduce((a, p) => a + (p[k] as number), 0);
  const serverP = serverTotals.reduce((a, t) => a + P(t), 0);
  const discP = Math.min(P(discount), sum('totalP') + serverP);
  return {
    itemsP: sum('itemsP'), packingP: sum('packingP'), taxP: sum('taxP'), roundOffP: sum('roundOffP'),
    totalP: sum('totalP') + serverP - discP,
    ratePct: parts[0]?.ratePct ?? 0,
  };
}
