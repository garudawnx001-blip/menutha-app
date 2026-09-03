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
  ready_at?: string | null;
  released_at?: string | null;
  items: { id: string; name: string; qty: number; unit_price: number; is_veg?: boolean }[];
  paid?: boolean;
  /** Diner-initiated payment awaiting one-tap staff confirmation. */
  pendingPayment?: { id: string; provider: string } | null;
}

export async function fetchLiveOrders(restaurantId: string, statuses: string[]): Promise<PortalOrder[]> {
  const { data, error } = await supabase
    .from('food_order')
    .select('id, order_no, status, is_parcel, subtotal, packing_charge, gst_amount, total, notes, placed_at, ready_at, released_at, guest_name, guest_phone, dining_table(label), order_item(id, name, qty, unit_price, is_veg), payment(id, status, provider)')
    .eq('restaurant_id', restaurantId)
    .in('status', statuses)
    // The grace window is a query predicate, not a job: an order becomes
    // visible to staff the moment its release time passes, with nothing
    // scheduled. Orders still inside their window have not reached the
    // restaurant yet and must not appear on the board.
    .lte('released_at', new Date().toISOString())
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
  /** Owner-supplied Kannada / Hindi names. Blank means the diner sees a
   *  transliteration of the English name — see lib/translit.ts. */
  name_kn?: string | null; name_hi?: string | null;
  price: number; is_veg: boolean; is_available: boolean; photo_url: string | null; sort_order: number;
}

const ADMIN_COLS = 'id, category_id, name, description, price, is_veg, is_available, photo_url, sort_order';
const ADMIN_COLS_I18N = ADMIN_COLS.replace('name,', 'name, name_kn, name_hi,');

export async function fetchMenuAdmin(restaurantId: string) {
  const dishes = (cols: string) =>
    supabase.from('menu_item').select(cols).eq('restaurant_id', restaurantId).order('sort_order');

  // Same reason as fetchMenu: PostgREST 400s on a column that does not exist,
  // so asking for the translated names before the migration lands would take
  // out the whole menu screen. Try, then fall back — this keeps the deploy and
  // the migration independent of each other rather than ordered.
  let [{ data: cats, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase.from('menu_category').select('id, name, sort_order').eq('restaurant_id', restaurantId).order('sort_order'),
    dishes(ADMIN_COLS_I18N),
  ]);
  if (e2) ({ data: items, error: e2 } = await dishes(ADMIN_COLS));
  if (e1 || e2) throw e1 ?? e2;
  return { categories: (cats ?? []) as PortalCategory[], items: (items ?? []) as unknown as PortalDish[] };
}

export async function upsertCategory(restaurantId: string, name: string, id?: string) {
  const { error } = id
    ? await supabase.from('menu_category').update({ name }).eq('id', id)
    : await supabase.from('menu_category').insert({ restaurant_id: restaurantId, name, sort_order: 99 });
  if (error) throw error;
}

export async function saveDish(restaurantId: string, dish: Partial<PortalDish> & { name: string; price: number }, id?: string) {
  const payload: Record<string, unknown> = { ...dish, restaurant_id: restaurantId };
  const write = (p: Record<string, unknown>) =>
    id ? supabase.from('menu_item').update(p).eq('id', id) : supabase.from('menu_item').insert(p);

  let { error } = await write(payload);
  if (error) {
    // Before the name_kn/name_hi migration reaches a database, writing them is
    // a 400 — and a failed save loses the owner's typing. Retry without them so
    // the dish itself still saves; the translated names simply wait.
    const { name_kn, name_hi, ...rest } = payload;
    if (name_kn !== undefined || name_hi !== undefined) ({ error } = await write(rest));
  }
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

// ── Prep timer ─────────────────────────────────────────────────────────────
// Replaces the accept/preparing/ready/served workflow: an order starts its own
// countdown when it lands. These are staff-side tools only — neither notifies
// the diner.

/** Pull an order's countdown to zero. */
export async function markOrderReadyNow(orderId: string) {
  const { error } = await supabase.rpc('mark_order_ready_now', { p_order_id: orderId });
  if (error) throw error;
}

/** Nudge one order's deadline by +/- minutes, without changing the
 *  restaurant's default prep time. */
export async function adjustOrderTimer(orderId: string, deltaMinutes: number) {
  const { error } = await supabase.rpc('adjust_order_timer', {
    p_order_id: orderId, p_delta_minutes: deltaMinutes,
  });
  if (error) throw error;
}

/** Persist a new category order. Writes sort_order from array position, so the
 *  list the owner sees is the list diners get. */
export async function reorderCategories(ids: string[]) {
  await Promise.all(
    ids.map((id, i) =>
      supabase.from('menu_category').update({ sort_order: i }).eq('id', id),
    ),
  );
}

/** Delete a category, moving any dishes in it to Uncategorised first.
 *
 *  Previously delete was blocked whenever a category held dishes, which made
 *  seeded categories permanently undeletable — exactly the ones a restaurant
 *  most wants gone. Detaching rather than refusing keeps the dishes (they are
 *  the valuable thing) while letting the category go. */
export async function deleteCategoryWithDishes(id: string) {
  const { error: detachErr } = await supabase
    .from('menu_item').update({ category_id: null }).eq('category_id', id);
  if (detachErr) throw detachErr;
  const { error } = await supabase.from('menu_category').delete().eq('id', id);
  if (error) throw error;
}

// ── Bulk dish images ───────────────────────────────────────────────────────

/** Normalise a name or filename to something matchable.
 *  "Paneer Tikka" and "paneer-tikka.jpg" both become "paneertikka", so the
 *  owner can shoot photos, name them roughly after the dish, and drop the lot
 *  in at once. */
const matchKey = (s: string) =>
  s.replace(/\.[a-z0-9]+$/i, '')       // drop extension
   .toLowerCase()
   .replace(/[^a-z0-9]+/g, '');        // drop spaces, dashes, underscores

export interface BulkImageResult {
  matched: { file: string; dish: string }[];
  unmatched: string[];
  failed: { file: string; reason: string }[];
}

/** Upload many dish photos at once, attaching each to the dish whose name it
 *  matches. Uploading and matching are separate concerns: a file that matches
 *  nothing is reported rather than silently dropped, because a photo that
 *  quietly went nowhere is worse than one that says it did not land. */
export async function bulkUploadDishImages(
  files: File[],
  dishes: { id: string; name: string; photo_url?: string | null }[],
): Promise<BulkImageResult> {
  const byKey = new Map<string, { id: string; name: string }>();
  for (const d of dishes) byKey.set(matchKey(d.name), { id: d.id, name: d.name });

  const out: BulkImageResult = { matched: [], unmatched: [], failed: [] };

  for (const f of files) {
    const dish = byKey.get(matchKey(f.name));
    if (!dish) { out.unmatched.push(f.name); continue; }
    try {
      const url = await uploadImage('dishes', f);
      const { error } = await supabase
        .from('menu_item').update({ photo_url: url }).eq('id', dish.id);
      if (error) throw error;
      out.matched.push({ file: f.name, dish: dish.name });
    } catch (e: any) {
      out.failed.push({ file: f.name, reason: e?.message ?? 'upload failed' });
    }
  }
  return out;
}

/** Persist a new dish order within a category. */
export async function reorderDishes(ids: string[]) {
  await Promise.all(
    ids.map((id, i) => supabase.from('menu_item').update({ sort_order: i }).eq('id', id)),
  );
}

// ── Staff order edits — owner and manager only ─────────────────────────────
// Customers change their mind after the grace window, or walk out. Staff can
// fix an order at any time, but the role check lives in the database, not
// here: a waiter must not be able to quietly remove items from a bill, and a
// hidden button is not a permission.

/** Change a quantity on a live order. qty 0 removes the line; removing the
 *  last line cancels the order. Re-totals server-side. */
export async function staffUpdateOrderItem(orderId: string, itemId: string, qty: number) {
  const { error } = await supabase.rpc('staff_update_order_item', {
    p_order_id: orderId, p_order_item_id: itemId, p_qty: qty,
  });
  if (error) throw error;
}

export async function staffCancelOrder(orderId: string) {
  const { error } = await supabase.rpc('staff_cancel_order', { p_order_id: orderId });
  if (error) throw error;
}

/* ── Custom bill charges ───────────────────────────────────────────────────
   Rows, not columns, so the owner can add a charge without us shipping code.
   See the 2026-09-03_bill_options migration for why.

   The AMOUNT is never computed here. `order_charges(order_id)` resolves what
   applies and what it comes to, server-side, for both this portal and the app
   -- a bill that differs between the laptop and the phone is the fastest way
   to lose trust in the totals. This module only manages the DEFINITIONS. */

export type ChargeKind = 'flat' | 'percent';
export type ChargeScope = 'all' | 'dine_in' | 'parcel' | 'ac' | 'non_ac';

export interface RestaurantCharge {
  id: string;
  restaurant_id: string;
  label: string;
  kind: ChargeKind;
  value: number;
  applies_to: ChargeScope;
  is_active: boolean;
  sort_order: number;
}

export async function fetchCharges(restaurantId: string): Promise<RestaurantCharge[]> {
  const { data, error } = await supabase
    .from('restaurant_charge')
    .select('id, restaurant_id, label, kind, value, applies_to, is_active, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('sort_order')
    .order('label');
  if (error) throw error;
  return (data ?? []) as RestaurantCharge[];
}

export async function saveCharge(
  restaurantId: string,
  c: Partial<RestaurantCharge> & { label: string; kind: ChargeKind; value: number },
): Promise<void> {
  const row = {
    restaurant_id: restaurantId,
    label: c.label.trim(),
    kind: c.kind,
    // Clamped here as well as in the check constraint: a negative charge is a
    // discount, and a discount that arrives through the charges table would
    // bypass every place a discount is meant to be recorded.
    value: Math.max(0, Number(c.value) || 0),
    applies_to: c.applies_to ?? 'all',
    is_active: c.is_active ?? true,
    sort_order: c.sort_order ?? 0,
  };
  const { error } = c.id
    ? await supabase.from('restaurant_charge').update(row).eq('id', c.id)
    : await supabase.from('restaurant_charge').insert(row);
  if (error) throw error;
}

export async function deleteCharge(id: string): Promise<void> {
  const { error } = await supabase.from('restaurant_charge').delete().eq('id', id);
  if (error) throw error;
}

/* ── Buffets ───────────────────────────────────────────────────────────────
   The table, the two kinds and the per-person price have existed since the
   original schema; what has never existed is a way for an owner to CREATE one.
   The diner side can already select a buffet, so this is the missing half
   rather than a new feature.

   `items` is a jsonb array of menu_item ids -- what is ON the buffet today.
   Stored as ids rather than copied names so a price or spelling fix on a dish
   flows through, and so a dish removed from the menu cannot linger on a
   buffet as a stale string. */

export type BuffetKind = 'complimentary' | 'paid';

export interface Buffet {
  id: string;
  restaurant_id: string;
  name: string;
  kind: BuffetKind;
  price: number;
  items: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export async function fetchBuffets(restaurantId: string): Promise<Buffet[]> {
  const { data, error } = await supabase
    .from('buffet')
    .select('id, restaurant_id, name, kind, price, items, starts_at, ends_at, is_active')
    .eq('restaurant_id', restaurantId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((b: any) => ({
    ...b,
    items: Array.isArray(b.items) ? b.items : [],
  })) as Buffet[];
}

export async function saveBuffet(
  restaurantId: string,
  b: Partial<Buffet> & { name: string; kind: BuffetKind },
): Promise<void> {
  const row = {
    restaurant_id: restaurantId,
    name: b.name.trim(),
    kind: b.kind,
    // A complimentary buffet is always zero. Letting a price linger on one
    // after switching kind is how an in-hotel guest gets charged for the
    // breakfast that comes with the room.
    price: b.kind === 'complimentary' ? 0 : Math.max(0, Number(b.price) || 0),
    items: b.items ?? [],
    starts_at: b.starts_at || null,
    ends_at: b.ends_at || null,
    is_active: b.is_active ?? true,
  };
  const { error } = b.id
    ? await supabase.from('buffet').update(row).eq('id', b.id)
    : await supabase.from('buffet').insert(row);
  if (error) throw error;
}

export async function deleteBuffet(id: string): Promise<void> {
  const { error } = await supabase.from('buffet').delete().eq('id', id);
  if (error) throw error;
}

/* ── Service requests, staff side ──────────────────────────────────────────
   Open requests for the board. Kept separate from orders on purpose: a request
   for tissues is not a ticket, must not be cooked, and must never reach a
   bill. See 2026-09-03_service_requests. */

export interface ServiceRequestRow {
  id: string;
  table_id: string | null;
  kind: string;
  note: string | null;
  guest_name: string | null;
  created_at: string;
  dining_table?: { label: string } | null;
}

export async function fetchOpenServiceRequests(restaurantId: string): Promise<ServiceRequestRow[]> {
  const { data, error } = await supabase
    .from('service_request')
    .select('id, table_id, kind, note, guest_name, created_at, dining_table(label)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'open')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as any as ServiceRequestRow[];
}

export async function resolveServiceRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_service_request', { p_id: id });
  if (error) throw error;
}

/** Oldest first, and labelled in staff language rather than the enum. */
export const SERVICE_LABEL: Record<string, string> = {
  clean_table: 'Clean the table',
  tissues: 'Tissues',
  sauce: 'Sauce',
  plates: 'Extra plates',
  water: 'Water',
  cutlery: 'Cutlery',
  assistance: 'Wants someone',
};
