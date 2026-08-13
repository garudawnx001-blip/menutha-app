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
  items: { name: string; qty: number; unit_price: number; is_veg?: boolean }[];
  paid?: boolean;
  /** Diner-initiated payment awaiting one-tap staff confirmation. */
  pendingPayment?: { id: string; provider: string } | null;
}

export async function fetchLiveOrders(restaurantId: string, statuses: string[]): Promise<PortalOrder[]> {
  const { data, error } = await supabase
    .from('food_order')
    .select('id, order_no, status, is_parcel, subtotal, packing_charge, gst_amount, total, notes, placed_at, dining_table(label), order_item(name, qty, unit_price, is_veg), payment(id, status, provider)')
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

// ── Expenses & P&L ─────────────────────────────────────────────────────────

export interface Expense { id: string; category: string; amount: number; note: string | null; spent_on: string; receipt_url: string | null }

export async function fetchExpenses(restaurantId: string, monthISO: string): Promise<Expense[]> {
  const start = monthISO + '-01';
  const end = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('expense').select('id, category, amount, note, spent_on, receipt_url')
    .eq('restaurant_id', restaurantId).gte('spent_on', start).lt('spent_on', end)
    .order('spent_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Expense[];
}

export async function addExpense(restaurantId: string, e: { category: string; amount: number; note?: string; spent_on: string; receipt_url?: string }) {
  const { error } = await supabase.from('expense').insert({ restaurant_id: restaurantId, ...e });
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from('expense').delete().eq('id', id);
  if (error) throw error;
}

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

export async function setPnlVisibility(restaurantId: string, visible: boolean) {
  const { error } = await supabase.rpc('set_pnl_visibility', {
    p_restaurant_id: restaurantId, p_visible: visible,
  });
  if (error) throw error;
}
