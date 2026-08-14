export interface Restaurant {
  id: string;
  name: string;
  city?: string | null;
  banner_url?: string | null;
  logo_url?: string | null;
  is_open?: boolean;
  status?: string;
  trial_ends_at?: string | null;
  parcel_charge?: number | null;
  /** Owner-configurable pricing (server is the source of truth). */
  gst_pct?: number | null;
  /** Indian GST split — SGST + CGST (gst_pct is kept as their sum). */
  sgst_pct?: number | null;
  cgst_pct?: number | null;
  service_charge_pct?: number | null;
}

export interface DiningTable {
  id: string;
  restaurant_id: string;
  label: string;
  is_parcel: boolean;
}

export interface MenuOption {
  id: string;
  name: string; // option group, e.g. "Spice level"
  choice: string; // e.g. "Medium"
  price_delta: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  is_veg: boolean;
  photo_url?: string | null;
  category: string;
  category_sort: number;
  options: MenuOption[];
}

export interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  isVeg: boolean;
  optionIds: string[];
  optionLabels: string[];
  optionDelta: number;
}

export type OrderStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface OrderView {
  id: string;
  order_no?: number | null;
  status: OrderStatus;
  /** Latest live payment on the order (null = nothing recorded yet). */
  payment?: { provider: string; status: 'created' | 'paid' } | null;
  is_parcel?: boolean;
  table_label?: string | null;
  subtotal: number;
  packing_charge: number;
  service_charge?: number;
  sgst_amount?: number;
  cgst_amount?: number;
  gst_amount: number;
  gst_pct?: number | null;
  sgst_pct?: number | null;
  cgst_pct?: number | null;
  total: number;
  placed_at?: string | null;
  ready_at?: string | null;
  served_at?: string | null;
  restaurant_name?: string;
  items: { name: string; qty: number; unit_price: number; options?: unknown; is_veg?: boolean }[];
}

/** The diner's lightweight identity, captured once on first open (no OTP,
 *  no account). Tags every order they place so the kitchen and the table bill
 *  can attribute each order to a person. */
export interface Guest {
  name: string;
  phone: string;
}

export interface Session {
  token: string;
  restaurant: Restaurant;
  table: DiningTable;
  demo?: boolean;
  /** Soft lock (subscription paused / trial over): menu stays viewable,
   *  placing orders is disabled (also enforced server-side). */
  orderingDisabled?: boolean;
  /** Who's ordering at this table (persists across re-scans in the session). */
  guest?: Guest;
}

// ── Table bill (get_table_bill RPC) ────────────────────────────────────────
// DEFAULT view = the whole table as one combined total. SPLIT view = the same
// orders grouped per diner. combined.total always === sum(per_person.total)
// because place_order rounds once per order (single source of truth).

export interface BillTotals {
  subtotal: number;
  packing_charge: number;
  service_charge?: number;
  sgst_amount?: number;
  cgst_amount?: number;
  gst_amount: number;
  total: number;
  order_count: number;
}

export interface BillOrderLine {
  name: string;
  qty: number;
  unit_price: number;
  options?: unknown;
  is_veg?: boolean;
}

export interface BillOrder {
  order_id: string;
  placed_at?: string | null;
  status: string;
  diner_name?: string | null;
  diner_phone?: string | null;
  subtotal: number;
  packing_charge: number;
  service_charge?: number;
  sgst_amount?: number;
  cgst_amount?: number;
  gst_amount: number;
  total: number;
  items: BillOrderLine[];
}

export interface PersonBill extends BillTotals {
  diner_name: string;
  diner_phone?: string | null;
}

export interface TableBill {
  table_id: string;
  /** Tax rates in force for this restaurant (Indian SGST + CGST split). */
  sgst_pct?: number | null;
  cgst_pct?: number | null;
  orders: BillOrder[];
  combined: BillTotals;
  per_person: PersonBill[];
}

/** Mirrors the server-side pricing in place_order: owner-configurable GST %
 *  and service-charge % (defaults 5 / 0), 2-decimal rounding once per order. */
export const GST_PCT = 5;

export function calcBill(
  lines: CartLine[], packing: number,
  sgstPct = GST_PCT / 2, cgstPct = GST_PCT / 2, svcPct = 0,
) {
  const subtotal = lines.reduce((a, l) => a + (l.price + l.optionDelta) * l.qty, 0);
  const service = Math.round(subtotal * svcPct) / 100;
  const taxable = subtotal + packing + service;
  // Rounded per component, exactly as place_order does server-side.
  const sgst = Math.round(taxable * sgstPct) / 100;
  const cgst = Math.round(taxable * cgstPct) / 100;
  const gst = sgst + cgst;
  const total = Math.round((taxable + gst) * 100) / 100;
  return { subtotal, packing, service, sgst, cgst, gst, total };
}

export const inr = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
