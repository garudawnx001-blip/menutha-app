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
  gst_amount: number;
  total: number;
  placed_at?: string | null;
  ready_at?: string | null;
  served_at?: string | null;
  restaurant_name?: string;
  items: { name: string; qty: number; unit_price: number; options?: unknown; is_veg?: boolean }[];
}

export interface Session {
  token: string;
  restaurant: Restaurant;
  table: DiningTable;
  demo?: boolean;
  /** Soft lock (subscription paused / trial over): menu stays viewable,
   *  placing orders is disabled (also enforced server-side). */
  orderingDisabled?: boolean;
}

/** Mirrors the server-side pricing in place_order (5% GST, 2-decimal rounding). */
export const GST_PCT = 5;

export function calcBill(lines: CartLine[], packing: number) {
  const subtotal = lines.reduce((a, l) => a + (l.price + l.optionDelta) * l.qty, 0);
  const gst = Math.round((subtotal + packing) * GST_PCT) / 100;
  const total = Math.round((subtotal + packing + gst) * 100) / 100;
  return { subtotal, packing, gst, total };
}

export const inr = (n: number) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
