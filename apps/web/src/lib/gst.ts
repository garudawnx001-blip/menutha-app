/**
 * Subscription money, itemised the way the receipt has to show it.
 *
 * THE DECISION, and the one place it lives: plan prices are quoted as a BASE
 * (₹499), GST at 18% goes on top, and the amount Razorpay actually collects is
 * that total ROUNDED TO THE NEAREST RUPEE -- ₹589, not ₹588.82. Rounded by
 * decision, because a whole-rupee charge is what a UPI mandate reads well as.
 *
 * The 18 paise that rounding creates is NOT hidden inside the GST figure. A
 * tax invoice must reconcile to the paisa, so it is carried as its own line:
 *
 *     Base          499.00
 *     CGST 9%        44.91
 *     SGST 9%        44.91
 *     Round off       0.18
 *     Total         589.00
 *
 * Mirrors apps/mobile/src/lib/gst.ts line for line. An owner reading the plan
 * on the counter machine and then on their phone sees one set of numbers.
 */

export const GST_PCT = 18;

export interface GstBreakdown {
  /** Taxable value, the quoted plan price. */
  base: number;
  /** Half of the GST each. Same-state supply; see `igst` for inter-state. */
  cgst: number;
  sgst: number;
  /** The full 18%, for an inter-state supply where IGST replaces CGST+SGST. */
  igst: number;
  /** base + GST, to the paisa, before rounding. */
  exact: number;
  /** What is actually collected: `exact` to the nearest rupee. */
  charge: number;
  /** charge - exact. At most ±50 paise; printed as its own line. */
  roundOff: number;
}

const p2 = (n: number) => Math.round(n * 100) / 100;

export function gstBreakdown(base: number): GstBreakdown {
  const gst = p2(base * GST_PCT / 100);
  const exact = p2(base + gst);
  const charge = Math.round(exact);
  return {
    base: p2(base),
    cgst: p2(gst / 2),
    sgst: p2(gst / 2),
    igst: gst,
    exact,
    charge,
    roundOff: p2(charge - exact),
  };
}

/** The charged amount alone, for a button label. */
export const gstCharge = (base: number) => gstBreakdown(base).charge;
