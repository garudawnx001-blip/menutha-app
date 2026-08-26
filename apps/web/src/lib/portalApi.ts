/** Restaurant Portal data layer (MODULE 2). Everything is RLS-guarded
 *  server-side; these helpers only shape queries and types. */
import { supabase } from './supabase';
import type { Restaurant } from './types';

export type PortalRole = 'owner' | 'manager' | 'waiter' | 'kitchen';

export interface Membership {
  role: PortalRole;
  restaurant: Restaurant & {
    address?: string | null;
    gstin?: string | null;
    upi_vpa?: string | null;
    cuisine_tags?: string | null;
    own_website?: string | null;
    gateway_key_id?: string | null;
    pnl_visible_to_managers?: boolean;
    open_time?: string | null;
    close_time?: string | null;
    plan_tier?: string;
    plan_status?: string;
  };
}

export async function loadMembership(): Promise<Membership | null> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return null;
  // Claim any pending staff invites for this phone (no-op otherwise).
  await supabase.rpc('claim_staff_invites').then(() => {}, () => {});
  const { data } = await supabase
    .from('restaurant_member')
    .select('member_role, restaurant(*)')
    .eq('user_id', uid)
    .in('member_role', ['owner', 'manager', 'waiter', 'kitchen'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const r = (Array.isArray(data.restaurant) ? data.restaurant[0] : data.restaurant) as Membership['restaurant'];
  return { role: data.member_role as PortalRole, restaurant: r };
}

// ── Orders ─────────────────────────────────────────────────────────────────

export interface PortalOrder {
  id: string;
  order_no: number;
  status: string;
  is_parcel: boolean;
  subtotal: number;
  packing_charge: number;
  gst_amount: number;
  total: number;
  notes?: string | null;
  placed_at: string;
  table_label?: string;
  guest_name?: string | null;
  guest_phone?: string | null;
  items: { name: string; qty: number; unit_price: number; is_veg?: boolean }[];
  paid?: boolean;
  /** Diner-initiated payment awaiting one-tap staff confirmation. */
  pendingPayment?: { id: string; provider: string } | null;
}

export async function fetchLiveOrders(restaurantId: string, statuses: string[]): Promise<PortalOrder[]> {
  const { data, error } = await supabase
    .from('food_order')
    .select('id, order_no, status, is_parcel, subtotal, packing_charge, gst_amount, total, notes, placed_at, guest_name, guest_phone, dining_table(label), order_item(name, qty, unit_price, is_veg), payment(id, status, provider)')
    .eq('restaurant_id', restaurantId)
    .in('status', statuses)
    .order('placed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    table_label: (Array.isArray(row.dining_table) ? row.dining_table[0] : row.dining_table)?.label,
    items: row.order_item ?? [],
    paid: (row.payment ?? []).some((p: any) => p.status === 'paid'),
    pendingPayment: (row.payment ?? []).find((p: any) => p.status === 'created') ?? null,
  }));
}

export const NEXT_STATUS: Record<string, string> = {
  placed: 'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

export async function advanceOrder(orderId: string, next: string) {
  const { error } = await supabase.rpc('advance_order_status', {
    p_order_id: orderId,
    p_new_status: next,
  });
  if (error) throw error;
}

// ── Menu ───────────────────────────────────────────────────────────────────

export interface PortalCategory { id: string; name: string; sort_order: number }
export interface PortalDish {
  id: string; category_id: string | null; name: string; description: string | null;
  price: number; is_veg: boolean; is_available: boolean; photo_url: string | null; sort_order: number;
}

export async function fetchMenuAdmin(restaurantId: string) {
  const [{ data: cats, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase.from('menu_category').select('id, name, sort_order').eq('restaurant_id', restaurantId).order('sort_order'),
    supabase.from('menu_item').select('id, category_id, name, description, price, is_veg, is_available, photo_url, sort_order').eq('restaurant_id', restaurantId).order('sort_order'),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  return { categories: (cats ?? []) as PortalCategory[], items: (items ?? []) as PortalDish[] };
}

export async function upsertCategory(restaurantId: string, name: string, id?: string) {
  const { error } = id
    ? await supabase.from('menu_category').update({ name }).eq('id', id)
    : await supabase.from('menu_category').insert({ restaurant_id: restaurantId, name, sort_order: 99 });
  if (error) throw error;
}

export async function saveDish(restaurantId: string, dish: Partial<PortalDish> & { name: string; price: number }, id?: string) {
  const payload = { ...dish, restaurant_id: restaurantId };
  const { error } = id
    ? await supabase.from('menu_item').update(payload).eq('id', id)
    : await supabase.from('menu_item').insert(payload);
  if (error) throw error;
}

export async function deleteDish(id: string) {
  const { error } = await supabase.from('menu_item').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadImage(folder: 'dishes' | 'logos' | 'banners' | 'receipts', file: File): Promise<string> {
  const path = `${folder}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
  const { error } = await supabase.storage.from('restaurant').upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from('restaurant').getPublicUrl(path).data.publicUrl;
}

export async function listDishImages(): Promise<Map<string, string>> {
  const { data } = await supabase.storage.from('restaurant').list('dishes', { limit: 1000 });
  const map = new Map<string, string>();
  for (const f of data ?? []) {
    map.set(f.name.toLowerCase(), supabase.storage.from('restaurant').getPublicUrl(`dishes/${f.name}`).data.publicUrl);
  }
  return map;
}

// ── Tables & QR ────────────────────────────────────────────────────────────

export interface PortalTable { id: string; label: string; room: string | null; is_parcel: boolean; qr_token: string; is_active: boolean }

export async function fetchTables(restaurantId: string): Promise<PortalTable[]> {
  const { data, error } = await supabase
    .from('dining_table')
    .select('id, label, room, is_parcel, qr_token, is_active')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as PortalTable[];
}

export async function createTable(restaurantId: string, label: string, room: string | null) {
  const token = 'qr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const { error } = await supabase.from('dining_table').insert({
    restaurant_id: restaurantId, label, room, qr_token: token,
  });
  if (error) throw error;
}

export async function removeTable(id: string) {
  const { error } = await supabase.from('dining_table').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

// ── Billing ────────────────────────────────────────────────────────────────

export async function createBill(restaurantId: string, orderIds: string[], discount: number) {
  const { data, error } = await supabase.rpc('create_table_bill', {
    p_restaurant_id: restaurantId, p_order_ids: orderIds, p_discount: discount,
  });
  if (error) throw error;
  return data as { id: string; bill_no: number; subtotal: number; discount: number; gst_amount: number; total: number };
}

export async function payBill(billId: string, mode: 'cash' | 'upi_qr') {
  const { error } = await supabase.rpc('mark_bill_paid', { p_bill_id: billId, p_mode: mode });
  if (error) throw error;
}

/** One-tap confirmation of a diner-initiated UPI/cash payment. */
export async function confirmPayment(paymentId: string) {
  const { error } = await supabase.rpc('mark_payment_paid', { p_payment_id: paymentId });
  if (error) throw error;
}

// ── Revenue (P&L) ──────────────────────────────────────────────────────────
// The Expenses section was removed at the client's request; get_pnl is kept
// because the revenue half still backs the Orders growth charts.
export async function fetchPnl(restaurantId: string, monthISO: string) {
  const { data, error } = await supabase.rpc('get_pnl', {
    p_restaurant_id: restaurantId, p_month: monthISO + '-01',
  });
  if (error) throw error;
  return data as { month: string; revenue: number; expenses: number; profit: number };
}

// ── Reservations ───────────────────────────────────────────────────────────

export interface Reservation { id: string; party_size: number; booked_for: string; status: string }

export async function fetchReservations(restaurantId: string): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from('table_booking').select('id, party_size, booked_for, status')
    .eq('restaurant_id', restaurantId)
    .gte('booked_for', new Date(Date.now() - 864e5).toISOString())
    .order('booked_for');
  if (error) throw error;
  return (data ?? []) as Reservation[];
}

export async function setReservationStatus(id: string, status: 'confirmed' | 'seated' | 'no_show') {
  const { error } = await supabase.from('table_booking').update({ status }).eq('id', id);
  if (error) throw error;
}

// ── Staff ──────────────────────────────────────────────────────────────────

export interface StaffRow { id: string; member_role: PortalRole; user: { name: string | null; phone: string | null; email: string | null } }

export async function fetchStaff(restaurantId: string): Promise<StaffRow[]> {
  const { data, error } = await supabase
    .from('restaurant_member')
    .select('id, member_role, app_user(name, phone, email)')
    .eq('restaurant_id', restaurantId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, member_role: r.member_role,
    user: (Array.isArray(r.app_user) ? r.app_user[0] : r.app_user) ?? { name: null, phone: null, email: null },
  }));
}

export async function inviteStaff(restaurantId: string, phone: string, role: 'manager' | 'waiter' | 'kitchen') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) throw new Error('Enter a valid phone number.');
  const { error } = await supabase.from('staff_invite').insert({
    restaurant_id: restaurantId, phone: digits, invite_role: role,
  });
  if (error) throw error;
}

export async function fetchInvites(restaurantId: string) {
  const { data } = await supabase
    .from('staff_invite').select('id, phone, invite_role, claimed_at')
    .eq('restaurant_id', restaurantId).is('claimed_at', null);
  return data ?? [];
}

export async function removeStaff(memberId: string) {
  const { error } = await supabase.from('restaurant_member').delete().eq('id', memberId);
  if (error) throw error;
}

export async function revokeInvite(id: string) {
  const { error } = await supabase.from('staff_invite').delete().eq('id', id);
  if (error) throw error;
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function updateRestaurant(restaurantId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('restaurant').update(patch).eq('id', restaurantId);
  if (error) throw error;
}


/** Delete a category. Callers must move or delete its dishes first — the
 *  portal blocks the action rather than orphaning dishes behind the diner's
 *  category filter, where they become effectively invisible. */
export async function deleteCategory(id: string) {
  const { error } = await supabase.from('menu_category').delete().eq('id', id);
  if (error) throw error;
}

// ── Growth ─────────────────────────────────────────────────────────────────

export type GrowthPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface GrowthPoint { label: string; revenue: number; orders: number }

/** Revenue and order counts bucketed for the growth charts.
 *
 *  Cancelled orders are excluded — they are not sales. Buckets are built in the
 *  browser's local timezone so "today" means the restaurant's today, not UTC's.
 *  Nothing is ever deleted or aggregated away: every bucket is derived from the
 *  order rows themselves, so any historical range stays queryable for as long
 *  as the orders exist.
 *
 *  `from`/`to` (ISO yyyy-mm-dd) drive the custom range; otherwise the period
 *  name picks the window.
 */
export async function fetchGrowth(
  restaurantId: string,
  period: GrowthPeriod,
  from?: string,
  to?: string,
): Promise<GrowthPoint[]> {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (period === 'custom' && from && to) {
    start = new Date(from + 'T00:00:00');
    end = new Date(to + 'T23:59:59');
  } else if (period === 'day') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start.setDate(now.getDate() - 6);
  } else if (period === 'month') {
    start.setDate(now.getDate() - 29);
  } else {
    start.setMonth(now.getMonth() - 11, 1);
  }
  if (period !== 'custom') start.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('food_order')
    .select('placed_at, total, status')
    .eq('restaurant_id', restaurantId)
    .neq('status', 'cancelled')
    .gte('placed_at', start.toISOString())
    .lte('placed_at', end.toISOString())
    .order('placed_at');
  if (error) throw error;

  const buckets = new Map<string, GrowthPoint>();
  const hourKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const monKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Pre-seed every bucket so quiet stretches render as gaps in the trend
  // rather than disappearing and making the chart lie about its shape.
  const spanDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
  let mode: 'hour' | 'day' | 'month';
  if (period === 'day') mode = 'hour';
  else if (period === 'year' || spanDays > 92) mode = 'month';
  else mode = 'day';

  if (mode === 'hour') {
    for (let h = 0; h < 24; h++) {
      const d = new Date(start); d.setHours(h);
      buckets.set(hourKey(d), { label: `${h}`, revenue: 0, orders: 0 });
    }
  } else if (mode === 'month') {
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      buckets.set(monKey(cur), { label: MON[cur.getMonth()], revenue: 0, orders: 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else {
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (d > end) break;
      buckets.set(dayKey(d), {
        label: spanDays <= 7 ? DAY[d.getDay()] : String(d.getDate()),
        revenue: 0, orders: 0,
      });
    }
  }

  for (const row of (data ?? []) as { placed_at: string; total: number }[]) {
    const d = new Date(row.placed_at);
    const key = mode === 'hour' ? hourKey(d) : mode === 'month' ? monKey(d) : dayKey(d);
    const b = buckets.get(key);
    if (!b) continue;
    b.revenue += Number(row.total || 0);
    b.orders += 1;
  }
  return [...buckets.values()];
}
