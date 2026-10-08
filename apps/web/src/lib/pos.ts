/**
 * PHASE 3: STAFF BILLING WITHOUT ANY SCAN (POS) -- the data side, shared by
 * the portal's counter screen. The app has the same calls (src/lib/pos.ts).
 *
 * Every order goes through pos_place_order -> place_order_core: the server
 * prices it exactly as a QR order (area prices, GST, service, packing), gives
 * it the same numbering, stock and KOT, and bills it through the same
 * bill_compute. Nothing here computes money.
 */
import { supabase } from './supabase';

export type PosOrderType = 'counter' | 'takeaway' | 'delivery' | 'dine_in';

export const POS_TYPE_LABEL: Record<PosOrderType, string> = {
  counter: 'Walk-in (counter)',
  takeaway: 'Takeaway',
  delivery: 'Phone / delivery',
  dine_in: 'Dine-in table',
};

export interface PosLine {
  /** dish id + chosen options, so the same dish with different options is two lines */
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  optionIds: string[];
  optionLabels: string[];
  note?: string;
}

export interface PosDraft {
  type: PosOrderType;
  tableId: string;
  lines: PosLine[];
  name: string;
  phone: string;
  notes: string;
}

/** A request id that stays the same across retries of ONE order, so a lost
 *  reply can never place it twice (the server remembers it). */
export function newRequestId(): string {
  const r = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pos-${r}`;
}

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
}
export const isIndianMobile = (phone: string) => /^[6-9]\d{9}$/.test(digitsOnly(phone));

/** What is wrong with this draft, in words for the counter, or null. */
export function draftProblem(d: PosDraft): string | null {
  if (!d.lines.length) return 'Add at least one dish.';
  if (d.lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999)) return 'Each quantity must be 1 to 999.';
  if (d.type === 'dine_in' && !d.tableId) return 'Choose a table for a dine-in order.';
  if (d.phone.trim() && !isIndianMobile(d.phone)) return 'Enter a 10-digit Indian mobile number, or leave it empty.';
  if (d.type === 'delivery' && !isIndianMobile(d.phone)) return 'A delivery order needs the customer’s mobile number.';
  return null;
}

export async function posPlaceOrder(restaurantId: string, requestId: string, d: PosDraft):
  Promise<{ id: string; table_id: string; token_no?: number | null; duplicate?: boolean }> {
  const problem = draftProblem(d);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc('pos_place_order', {
    p_key: requestId,
    p_restaurant_id: restaurantId,
    p_order_type: d.type,
    p_items: d.lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, option_ids: l.optionIds,
      ...(l.note?.trim() ? { note: l.note.trim().slice(0, 120) } : {}) })),
    p_table_id: d.type === 'dine_in' ? d.tableId : null,
    p_notes: d.notes.trim() || null,
    p_customer_name: d.name.trim() || null,
    p_customer_phone: d.phone.trim() ? digitsOnly(d.phone) : null,
    p_client_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return data as any;
}

// ── Hold and recall ────────────────────────────────────────────────────────
export interface PosHold { id: string; label: string; payload: PosDraft; created_at: string }

export async function listHolds(restaurantId: string): Promise<PosHold[]> {
  const { data, error } = await supabase.from('pos_hold').select('id, label, payload, created_at')
    .eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as PosHold[];
}
export async function holdDraft(restaurantId: string, label: string, d: PosDraft): Promise<void> {
  const { error } = await supabase.from('pos_hold').insert({ restaurant_id: restaurantId, label: label.slice(0, 60), payload: d });
  if (error) throw error;
}
export async function dropHold(id: string): Promise<void> {
  const { error } = await supabase.from('pos_hold').delete().eq('id', id);
  if (error) throw error;
}

// ── Moving orders ──────────────────────────────────────────────────────────
export async function moveTableOrders(fromTableId: string, toTableId: string): Promise<{ moved: number; from?: string; to?: string }> {
  const { data, error } = await supabase.rpc('move_table_orders', { p_from: fromTableId, p_to: toTableId });
  if (error) throw new Error(error.message);
  return data as any;
}
/** toTableId null = a separate order on the same table (to bill it on its own). */
export async function moveOrderItem(orderItemId: string, qty: number, toTableId: string | null) {
  const { data, error } = await supabase.rpc('move_order_item', { p_order_item_id: orderItemId, p_qty: qty, p_to_table: toTableId });
  if (error) throw new Error(error.message);
  return data as { new_order_id: string; moved: number; to: string; source_cancelled: boolean };
}
