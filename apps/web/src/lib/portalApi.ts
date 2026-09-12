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
    cuisine_tags?: string | null;
    slug?: string | null;
    own_website?: string | null;
    pnl_visible_to_managers?: boolean;
    open_time?: string | null;
    close_time?: string | null;
    plan_tier?: string;
    plan_status?: string;
  };
}

/** Which outlet the owner last had open. Per browser, because a manager on
 *  the counter PC and the owner on a laptop can reasonably be looking at
 *  different outlets at once. */
const OUTLET_KEY = 'menutha.outlet';
export const rememberOutlet = (id: string) => {
  try { localStorage.setItem(OUTLET_KEY, id); } catch { /* private mode */ }
};
const recalledOutlet = (): string | null => {
  try { return localStorage.getItem(OUTLET_KEY); } catch { return null; }
};

/**
 * EVERY OUTLET THIS ACCOUNT CAN OPEN, oldest first.
 *
 * The first row is the primary -- the one that holds the subscription and
 * whose plan the others read through effective_plan(). Ordering by created_at
 * makes that stable rather than incidental.
 */
export async function loadOutlets(): Promise<Membership['restaurant'][]> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return [];
  const { data } = await supabase
    .from('restaurant_member')
    .select('restaurant(*)')
    .eq('user_id', uid)
    .in('member_role', ['owner', 'manager', 'waiter', 'kitchen'])
    .order('created_at', { ascending: true });
  return (data ?? [])
    .map((row: any) => (Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant))
    .filter(Boolean) as Membership['restaurant'][];
}

export async function loadMembership(): Promise<Membership | null> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from('restaurant_member')
    .select('member_role, restaurant(*)')
    .eq('user_id', uid)
    .in('member_role', ['owner', 'manager', 'waiter', 'kitchen'])
    .order('created_at', { ascending: true });
  const rows = data ?? [];
  if (!rows.length) return null;
  /**
   * The remembered outlet if it is still one of theirs, else the first --
   * which is the primary. Falling back rather than failing matters: an outlet
   * can be closed or a membership revoked between sessions, and landing on an
   * empty portal because of a stale id in localStorage would look like the
   * account had lost its restaurant.
   */
  const wanted = recalledOutlet();
  const pick = rows.find((row: any) => {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    return r?.id === wanted;
  }) ?? rows[0];
  const r = (Array.isArray(pick.restaurant) ? pick.restaurant[0] : pick.restaurant) as Membership['restaurant'];
  return { role: (pick as any).member_role as PortalRole, restaurant: r };
}

/**
 * OPEN ANOTHER OUTLET, under the same subscription.
 *
 * The new row points at the payer through parent_id, so effective_plan()
 * resolves its tier to the parent's and one subscription covers them all.
 * complete_restaurant_signup is not reused here: it starts a fresh 30-day
 * trial and claims a username, neither of which applies to a second address
 * on an existing account.
 */
export async function addOutlet(parentId: string, name: string, city: string | null): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error('Please sign in again.');

  /**
   * ONE LEVEL ONLY, AND THE PARENT IS THE ROOT.
   *
   * The database refuses an outlet whose parent is itself an outlet, and it is
   * right to: two levels means `effective_plan()` has to walk a chain, and a
   * chain is how one branch quietly ends up on a different tier from the
   * subscription paying for it. But an owner adding an outlet while VIEWING an
   * outlet is an ordinary thing to do, and hitting a constraint error for it
   * would be a dead end. So the parent is resolved to the top of the tree here
   * rather than trusted from the caller.
   */
  const { data: parentRow } = await supabase
    .from('restaurant')
    .select('parent_id')
    .eq('id', parentId)
    .maybeSingle();
  const rootId = (parentRow as any)?.parent_id ?? parentId;

  const { data: created, error } = await supabase
    .from('restaurant')
    .insert({ name: name.trim(), city: city?.trim() || null, parent_id: rootId, status: 'active' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const { error: memberErr } = await supabase
    .from('restaurant_member')
    .insert({ restaurant_id: created.id, user_id: uid, member_role: 'manager' });
  if (memberErr) throw new Error(memberErr.message);

  // A parcel row, exactly as sign-up creates for a first outlet, so takeaway
  // works from the moment the outlet exists.
  await supabase.from('dining_table').insert({
    restaurant_id: created.id, label: 'Parcel', is_parcel: true,
    qr_token: `qr_${String(created.id).slice(0, 8)}_parcel`,
  });

  return created.id as string;
}

// ── Orders ─────────────────────────────────────────────────────────────────

export interface PortalOrder {
  id: string;
  order_no: number;
  status: string;
  is_parcel: boolean;
  subtotal: number;
  packing_charge: number;
  /** Already carries the AC-or-normal rate the server resolved (#R). */
  service_charge?: number;
  gst_amount: number;
  total: number;
  notes?: string | null;
  placed_at: string;
  table_label?: string;
  /** The table id, so an alert that names a table can find its ticket. */
  table_id?: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  ready_at?: string | null;
  released_at?: string | null;
  items: { id: string; name: string; qty: number; unit_price: number; is_veg?: boolean }[];
  paid?: boolean;
  /** Diner-initiated payment awaiting one-tap staff confirmation. */
  pendingPayment?: { id: string; provider: string } | null;
}

/** Set once if the database has no food_order.settled_at yet (#V is a staged
 *  migration run by hand). Module scope: a fact about the server. */
let settledColumnMissing = false;
/** service_waived arrives with a staged migration, and PostgREST 400s the WHOLE
 *  query on a column it has not seen -- which would take the Billing board down
 *  rather than costing one label. Asked for once, dropped for the session. */
let waivedColumnMissing = false;

/**
 * CLOSING A BILL THAT WILL NEVER BE PAID, and cancelling one raised by
 * mistake. Two different decisions, deliberately two functions.
 *
 * void_table_bill has been in the database since the settle-or-void round and
 * NOTHING has ever called it, on either surface. So the only way to clear a
 * table that walked out was to mark it paid -- which records money the
 * restaurant never took, and staff will always choose it over leaving a table
 * nagging at them. The missing button was quietly inflating the takings.
 *
 * void_bill is new (2026-09-12_void_bill.sql) and answers the other case: the
 * bill was raised against the wrong table, nobody has paid, and the orders
 * need to go back on the board.
 */
export async function voidTableBill(tableId: string, reason: string, note?: string) {
  const { error } = await supabase.rpc('void_table_bill', {
    p_table_id: tableId, p_reason: reason, p_note: note ?? null,
  });
  if (error) throw error;
}

/**
 * A ONE-OFF CHARGE ON ONE BILL -- cake cutting, corkage, a delivery fee.
 *
 * Distinct from restaurant.bill_charges, which is the owner's STANDING policy
 * and is applied to every order by reprice_order. This is tonight, table six.
 *
 * The RPC replaces rather than accumulates, so calling it twice with the same
 * line id is one line, and a retry after a dropped connection cannot double
 * charge. `applied: false` with a reason is a refusal the UI should show --
 * a paid bill, for instance -- not an error to throw.
 */
export interface BillChargeLine { id: string; label: string; kind: 'flat' | 'percent'; value: number; amount: number }
export interface BillChargeResult {
  applied: boolean; reason?: string;
  extra_charge: number; extra_lines: BillChargeLine[]; total: number;
}

export async function setBillChargeLine(
  billId: string, lineId: string, label: string, kind: 'flat' | 'percent', value: number,
): Promise<BillChargeResult> {
  const { data, error } = await supabase.rpc('set_bill_charge_line', {
    p_bill_id: billId, p_line_id: lineId, p_label: label, p_kind: kind, p_value: value,
  });
  if (error) throw error;
  return data as BillChargeResult;
}

export async function removeBillChargeLine(billId: string, lineId: string): Promise<BillChargeResult> {
  const { data, error } = await supabase.rpc('remove_bill_charge_line', {
    p_bill_id: billId, p_line_id: lineId,
  });
  if (error) throw error;
  return data as BillChargeResult;
}

/** Correct a quantity after the food has gone to the kitchen -- qty 0 removes
 *  the line, and an order left with nothing is cancelled. Manager only, and
 *  refused while a live bill stands on the order (cancel that bill first). */
export async function staffSetOrderItemQty(orderItemId: string, qty: number) {
  const { data, error } = await supabase.rpc('staff_set_order_item_qty', {
    p_order_item_id: orderItemId, p_qty: qty,
  });
  if (error) throw error;
  return data as { order_id: string; cancelled: boolean; items_left: number; total: number };
}

export async function voidBill(billId: string, reason = 'staff_error') {
  const { error } = await supabase.rpc('void_bill', { p_bill_id: billId, p_reason: reason });
  if (error) throw error;
}

export async function fetchLiveOrders(restaurantId: string, statuses: string[]): Promise<PortalOrder[]> {
  // service_charge rides along: the printed bill sums it off the orders
  // (#R -- the AC rate is already inside it), and it was silently printing as
  // zero while the total included it.
  const BASE = 'id, order_no, status, is_parcel, subtotal, packing_charge, service_charge, gst_amount, total, notes, placed_at, ready_at, released_at, guest_name, guest_phone, table_id, dining_table(label), order_item(id, name, qty, unit_price, is_veg), payment(id, status, provider)';
  // service_waived tells Billing whether the charge is already off this bill.
  // charge_lines rides with service_waived: both arrive by staged migration and
  // both are dropped together if PostgREST has not seen them, so one absent
  // column cannot take the billing board down.
  const cols = () => (waivedColumnMissing ? BASE : `${BASE}, service_waived, charge_lines`);

  /**
   * #V — A SETTLED ORDER IS NEITHER LIVE WORK NOR BILLABLE.
   *
   * mark_bill_paid has never written food_order.status, so a paid-for order
   * keeps a live status for ever and stays on the board. Both callers want the
   * same thing from this: the Orders board wants what is still being cooked or
   * carried, and Billing wants what is still owed. A settled order is neither.
   *
   * SETTLEMENT, not payment: a diner can pay before the food is cooked, so a
   * payment filter would hide real work from the kitchen.
   */
  const run = (withSettled: boolean) => {
    let q = supabase
      .from('food_order')
      .select(cols())
      .eq('restaurant_id', restaurantId)
      .in('status', statuses)
      // The grace window is a query predicate, not a job: an order becomes
      // visible to staff the moment its release time passes, with nothing
      // scheduled. Orders still inside their window have not reached the
      // restaurant yet and must not appear on the board.
      .lte('released_at', new Date().toISOString());
    if (withSettled) q = q.is('settled_at', null);
    return q.order('placed_at', { ascending: true });
  };

  let { data, error } = settledColumnMissing ? await run(false) : await run(true);
  /**
   * TWO STAGED COLUMNS, SO TWO STEPS -- and in this order, because they cost
   * different things.
   *
   * Until the migrations run, the board behaves as it does today rather than
   * failing. Losing the live board because a column is absent would be far
   * worse than showing a settled ticket on it, or than not knowing whether a
   * service charge was waived. 42703 does not say WHICH column, so the first
   * retry drops the cheaper one (a label) and only the second drops the
   * filter (a behaviour).
   */
  if (error && error.code === '42703' && !waivedColumnMissing) {
    waivedColumnMissing = true;
    ({ data, error } = settledColumnMissing ? await run(false) : await run(true));
  }
  if (error && error.code === '42703') {
    settledColumnMissing = true;
    ({ data, error } = await run(false));
  }
  if (error) throw error;
  return (data ?? []).map(toPortalOrder);
}

/**
 * A FOOD_ORDER ROW AS THE BOARD EXPECTS IT, and the only place that
 * translation happens.
 *
 * PostgREST returns the embedded relations under their TABLE names --
 * order_item, dining_table, payment -- while PortalOrder reads items,
 * table_label and paid. Those are different shapes, and nothing but this
 * function bridges them.
 *
 * It used to live inline in fetchLiveOrders, which meant fetchDoneOrders
 * (written later, for the same rows) skipped it entirely and returned
 * `data as unknown as PortalOrder[]`. That double cast is the whole bug: it
 * tells the compiler to stop checking, so a row with no `items` field
 * typechecked perfectly and reached the board, where `o.items.reduce(...)`
 * threw "Cannot read properties of undefined" and -- with no error boundary
 * above it -- unmounted the entire React root. Ashwamedha's dashboard went
 * blank the moment the account went active, because `active` is what makes
 * the board fetch done orders at all.
 *
 * One exported mapper, used by every loader, so a third one cannot quietly
 * reintroduce this.
 */
export function toPortalOrder(row: any): PortalOrder {
  return {
    ...row,
    table_label: (Array.isArray(row.dining_table) ? row.dining_table[0] : row.dining_table)?.label,
    items: row.order_item ?? [],
    paid: (row.payment ?? []).some((p: any) => p.status === 'paid'),
    pendingPayment: (row.payment ?? []).find((p: any) => p.status === 'created') ?? null,
  };
}

/**
 * WHAT IS DONE -- served, OR settled, and not cancelled.
 *
 * The tester: "tickets are not moving to reports". They were, all along;
 * what was wrong was the board's own count. mark_bill_paid sets settled_at
 * and leaves status alone (a dish still owed is still owed), and the ladder
 * placed → accepted → preparing → ready → served is only climbed by tapping
 * the ticket. A restaurant that bills straight from `placed` -- Ashwamedha:
 * 39 orders in seven days, every one still `placed`, none `served` -- had a
 * "Served today" of nothing, because fetchLiveOrders also HIDES settled
 * orders, by design. Every number keyed on served undercounted; Reports,
 * which counts every non-cancelled order, did not. So the board and the
 * headers count what Reports counts: an order is done when it was served or
 * when it was paid for, whichever the counter got to first.
 */
export async function fetchDoneOrders(
  restaurantId: string, sinceISO: string, untilISO: string,
): Promise<PortalOrder[]> {
  const BASE = 'id, order_no, status, is_parcel, subtotal, packing_charge, service_charge, gst_amount, total, notes, placed_at, ready_at, released_at, guest_name, guest_phone, table_id, dining_table(label), order_item(id, name, qty, unit_price, is_veg), payment(id, status, provider)';
  const q = supabase
    .from('food_order')
    .select(BASE)
    .eq('restaurant_id', restaurantId)
    .neq('status', 'cancelled')
    .or('status.eq.served,settled_at.not.is.null')
    .gte('placed_at', sinceISO).lte('placed_at', untilISO)
    .order('placed_at', { ascending: true });
  const { data, error } = await q;
  if (error) {
    // settled_at is a staged column; before it lands, served is all there is.
    if ((error as any).code === '42703') {
      const { data: d2, error: e2 } = await supabase
        .from('food_order').select(BASE)
        .eq('restaurant_id', restaurantId).eq('status', 'served')
        .gte('placed_at', sinceISO).lte('placed_at', untilISO)
        .order('placed_at', { ascending: true });
      if (e2) throw e2;
      return (d2 ?? []).map(toPortalOrder);
    }
    throw error;
  }
  return (data ?? []).map(toPortalOrder);
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

/**
 * A BILL FOR SOMEONE WHO NEVER SCANNED ANYTHING.
 *
 * Most diners scan the QR. Some walk in, sit down and tell the counter what
 * they want -- and until now the till had no way to bill them at all, which
 * made the whole product conditional on the customer owning a working phone.
 *
 * THIS GOES THROUGH place_order, THE SAME RPC THE DINER'S PHONE CALLS, and
 * that is the entire design. Prices, option deltas, the packing charge, the
 * service rate, SGST and CGST are all computed server-side from ids and
 * quantities; the client sends no money at all. A second "manual" path that
 * priced things itself would be a second opinion about what somebody owes,
 * and the first time the two disagreed it would be over a real bill in a real
 * customer's hand.
 *
 * So a walk-in order is an ordinary order. It reaches the board, the kitchen,
 * Billing and the reports exactly like a scanned one, and everything
 * downstream -- waivers, discounts, GST, the printed sheet -- already works on
 * it without knowing where it came from.
 */
export async function placeStaffOrder(
  restaurantId: string,
  tableId: string,
  lines: { menuItemId: string; qty: number }[],
  guestName?: string,
): Promise<string> {
  if (!lines.length) throw new Error('Add at least one dish.');
  const { data, error } = await supabase.rpc('place_order', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_items: lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, option_ids: [] })),
    p_notes: 'Taken at the counter',
    // The ticket says who it is for. "Walk-in" is not decoration: on a board of
    // scanned orders the one nobody scanned for is the one staff have to
    // attribute by memory.
    p_guest_name: guestName?.trim() || 'Walk-in',
    p_guest_phone: null,
  });
  if (error) throw new Error(error.message);
  return (data as any)?.id as string;
}

/**
 * REMOVE (or restore) THE SERVICE CHARGE ON A BILL.
 *
 * A per-bill decision, made at the till because a diner asked -- which is why
 * it lives in Billing and not in Bill settings, where the defaults live.
 *
 * The server does the arithmetic. GST is charged on subtotal PLUS service, so
 * dropping the charge changes the tax and the total; waive_order_service sets
 * the flag and repricess, and service, SGST, CGST and total all fall out of
 * the one existing calculation. Nothing here computes money.
 */
export async function waiveService(orderIds: string[], waive: boolean): Promise<void> {
  const { error } = await supabase.rpc('waive_order_service', {
    p_order_ids: orderIds,
    p_waive: waive,
  });
  if (error) throw new Error(error.message);
}

export async function upsertCategory(
restaurantId: string, name: string, id?: string) {
  const { error } = id
    ? await supabase.from('menu_category').update({ name }).eq('id', id)
    : await supabase.from('menu_category').insert({ restaurant_id: restaurantId, name, sort_order: 99 });
  if (error) throw error;
}

export async function saveDish(restaurantId: string, dish: Partial<PortalDish> & { name: string; price: number }, id?: string) {
  const payload: Record<string, unknown> = { ...dish, restaurant_id: restaurantId };
  // `.select('id')` is what makes a refusal detectable -- the same reason it
  // is on deleteDish below. A write the policy filters out comes back with no
  // error and no rows, and without this that reported SUCCESS. toggleAvailable
  // is optimistic, so the owner would watch the switch flip while the database
  // kept the old value, and nothing on screen would ever say so.
  const write = (p: Record<string, unknown>) =>
    id
      ? supabase.from('menu_item').update(p).eq('id', id).select('id')
      : supabase.from('menu_item').insert(p).select('id');

  let { data, error } = await write(payload);
  if (error) {
    // Before the name_kn/name_hi migration reaches a database, writing them is
    // a 400 — and a failed save loses the owner's typing. Retry without them so
    // the dish itself still saves; the translated names simply wait.
    const { name_kn, name_hi, ...rest } = payload;
    if (name_kn !== undefined || name_hi !== undefined) ({ data, error } = await write(rest));
  }
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(id
      ? 'The dish was not saved — you may not have permission to change it.'
      : 'The dish was not added — you may not have permission to change this menu.');
  }
}

/**
 * DELETE A DISH — and say what happened, because it used to say nothing.
 *
 * Vishal: the Delete button "is not work for any items". Two faults stacked:
 *
 *   1. THE DATABASE REFUSED IT. order_item.menu_item_id references menu_item
 *      with no ON DELETE clause, so NO ACTION applies and any dish that appears
 *      on a past order cannot be deleted — 23503. In a trading restaurant that
 *      is every dish, which is why it failed for EVERY item and not for a few.
 *      Fixed by 2026-09-04_delete_dish_fk.sql, which makes it SET NULL: the
 *      line item snapshots name and price at order time, so history is intact
 *      without the link.
 *   2. NOBODY WAS TOLD. The call site awaited this with no try/catch, so the
 *      rejection went nowhere: no message, no closed form, no change on screen.
 *      A button that fails invisibly is indistinguishable from a dead one, and
 *      that is what he reported.
 *
 * `.select()` is what makes a refusal detectable at all. Without it PostgREST
 * answers a delete that matched nothing with 204 and no error — so a policy
 * that filtered the row out would look exactly like success, and the dish
 * would still be there after the form closed.
 */
/**
 * Raised when a dish cannot be removed because it appears on past orders.
 *
 * A distinct type rather than a string match, because the UI has to do
 * something specific about this one and nothing about the others: it offers
 * Hide instead. Matching on message text would break the moment the wording is
 * translated, which for this app is a matter of when rather than if.
 */
export class DishInUseError extends Error {
  readonly dishId: string;
  constructor(dishId: string) {
    super('on past orders');
    this.name = 'DishInUseError';
    this.dishId = dishId;
  }
}

/**
 * HIDE A DISH. Takes it off the diner's menu and leaves the record alone.
 *
 * This is the honest destination for a dish that has been sold. `is_available`
 * is already what the diner menu filters on, so a hidden dish stops being
 * orderable immediately, keeps its place in the owner's own list, keeps every
 * bill it appears on readable, and can be brought back by switching it on.
 */
export async function hideDish(id: string) {
  const { data, error } = await supabase
    .from('menu_item').update({ is_available: false }).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('The dish was not hidden — you may not have permission to change it.');
  }
}

export async function deleteDish(id: string) {
  const { data, error } = await supabase
    .from('menu_item').delete().eq('id', id).select('id');

  if (error) {
    // 23503 is foreign_key_violation: the dish is referenced by an order line.
    //
    // NO MIGRATION FILENAME IN AN OWNER'S FACE. This used to read "Run the
    // pending database update (delete_dish_fk)" -- my own copy, and an
    // instruction the person reading it cannot act on and should never have
    // been shown. Vishal read the whole thing as "Deleting menu items are not
    // working", which is the correct reading of a message that names a task
    // for somebody else.
    //
    // The caller turns this into an offer to hide the dish instead, which is
    // the outcome the owner actually wants: off the menu, history intact.
    if ((error as any).code === '23503') throw new DishInUseError(id);
    throw error;
  }

  // No error and no rows: the row was filtered out rather than deleted. Never
  // report that as success.
  if (!data || data.length === 0) {
    // TRUTHFUL, because zero rows has more than one cause and this used to
    // assert the least likely one. PostgREST answers a delete that matched
    // nothing with 204 either way: the row may already be gone (two tabs, or
    // a second tap), or it may be invisible to this account. Naming a cause we
    // have not established is how an owner ends up hunting a permission
    // problem that was never there -- which is exactly what happened here.
    throw new Error('That dish is no longer there — it may already have been removed. Refresh the menu to see what is current.');
  }
}

export async function uploadImage(folder: 'dishes' | 'logos' | 'banners' | 'receipts' | 'showcase', file: File): Promise<string> {
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

export interface PortalTable {
  id: string; label: string; room: string | null; is_parcel: boolean;
  qr_token: string; is_active: boolean;
  /** How many this table seats. NULL means not recorded -- treat as unknown,
   *  never as zero. */
  seating_capacity: number | null;
  /** Air-conditioned. Drives the 'AC tables' charge scope -- see setTableAc. */
  is_ac?: boolean | null;
  /** ac | non_ac | room. Optional so the page still renders against a
   *  database where 2026-09-11_table_setup has not been run yet. */
  table_kind?: string | null;
  /** available | reserved. Reserved blocks a NEW seating, never an existing one. */
  availability?: string | null;
  /** Per-table AC charge. 0 = none. */
  ac_charge_value?: number | null;
  /** flat = rupees once per bill; percent = of the food subtotal. */
  ac_charge_kind?: string | null;
}

/** Everything the table-setup form can change, in one patch. */
export interface TableSetupPatch {
  table_kind?: string;
  availability?: string;
  seating_capacity?: number | null;
  ac_charge_value?: number;
  ac_charge_kind?: string;
}

/**
 * ONE WRITE FOR THE WHOLE FORM, and it degrades rather than failing.
 *
 * These columns arrive with a migration the owner runs by hand, so a portal
 * deployed before that migration would otherwise throw 42703 and take the
 * Tables page down -- the same failure mode seating_capacity already guards
 * against with seatsColumnMissing.
 *
 * On an unknown-column error it retries with only the fields that have always
 * existed. The owner's capacity edit still lands; the new fields simply wait
 * for the migration, which is a far better outcome than a broken page.
 */
export async function updateTableSetup(id: string, patch: TableSetupPatch): Promise<void> {
  const clean: Record<string, unknown> = { ...patch };
  if (patch.seating_capacity != null) {
    clean.seating_capacity = Math.min(40, Math.max(1, Math.round(patch.seating_capacity)));
  }
  const { error } = await supabase.from('dining_table').update(clean).eq('id', id);
  if (!error) return;
  if ((error as any).code !== '42703') throw error;

  const fallback: Record<string, unknown> = {};
  if ('seating_capacity' in clean) fallback.seating_capacity = clean.seating_capacity;
  if (patch.table_kind) fallback.is_ac = patch.table_kind === 'ac';
  if (!Object.keys(fallback).length) return;
  const { error: e2 } = await supabase.from('dining_table').update(fallback).eq('id', id);
  if (e2) throw e2;
}

/**
 * A PAGE MUST NOT DIE BECAUSE AN OPTIONAL COLUMN IS NOT THERE YET.
 *
 * This selected `seating_capacity` unconditionally the moment that field was
 * added to the UI — and the migration adding the column is staged, not run. So
 * PostgREST answered the whole query with 42703 "column
 * dining_table.seating_capacity does not exist", fetchTables threw, and Tables
 * & QR — the page an owner opens to PRINT THEIR QR CARDS — showed an error
 * instead of loading. Verified against production, not inferred: the same
 * select without that one column returns 200.
 *
 * That was mine, and it is the same mistake the public showcase page was
 * already written to avoid: the gallery there loads separately and fails to an
 * empty list precisely so a missing table cannot take a whole page down.
 *
 * So seats are OPTIONAL here in the real sense. The base columns always load;
 * the capacity column is asked for once and, if the database does not have it
 * yet, dropped for the rest of the session. Nothing to undo after the
 * migration runs — the first successful attempt simply keeps it.
 */
let seatsColumnMissing = false;

export async function fetchTables(restaurantId: string): Promise<PortalTable[]> {
  const BASE = 'id, label, room, is_parcel, qr_token, is_active';
  // The optional tier: everything a hand-run migration may not have added yet.
  const EXTRA = 'seating_capacity, is_ac, table_kind, availability, ac_charge_value, ac_charge_kind';
  const run = (cols: string) => supabase
    .from('dining_table')
    .select(cols)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('created_at');

  if (!seatsColumnMissing) {
    const { data, error } = await run(`${BASE}, ${EXTRA}`);
    if (!error) return (data ?? []) as unknown as PortalTable[];
    // 42703 is "undefined_column". Anything else is a real failure and must
    // surface — a network error dressed up as a missing column would hide it.
    if (error.code !== '42703') throw error;
    seatsColumnMissing = true;
  }

  const { data, error } = await run(BASE);
  if (error) throw error;
  // Pre-migration: the page still renders, every new field simply reads as
  // its default rather than taking the Tables screen down.
  return (data ?? []).map((t: any) => ({
    ...t, seating_capacity: null, is_ac: null,
    table_kind: null, availability: null, ac_charge_value: null, ac_charge_kind: null,
  })) as PortalTable[];
}

/** SEATS AT CREATION, not only afterwards.
 *
 *  The per-row Seats field could always edit a table's capacity, but a table
 *  was born with none -- so the number existed only for tables somebody
 *  remembered to go back and fill in, and reservations had nothing to match a
 *  party size against for the rest. Asking once, while the owner is already
 *  thinking about the table they are adding, is the only point at which this
 *  gets answered for every table rather than for some.
 *
 *  Optional, and null is a real value meaning not recorded: a restaurant that
 *  leaves it blank keeps working exactly as it does now. Clamped to the same
 *  1..40 as setTableCapacity, so the two ways in cannot disagree.
 *
 *  A resilient insert, for the reason fetchTables is resilient: sending a
 *  column PostgREST has not seen yet fails the WHOLE insert, and failing to
 *  create a table is a great deal worse than creating one without a seat
 *  count. It falls back once, then remembers.
 */
/**
 * SEVERAL TABLES, ONE INSERT.
 *
 * A loop of createTable calls would be N round trips over a restaurant's wifi
 * and, worse, N chances to stop halfway: ask for ten and get six, with no way
 * to tell which six without counting. One insert either lands or does not.
 *
 * Each row needs its own qr_token, so the tokens are minted here rather than
 * defaulted in the database -- the same 12-character shape createTable uses,
 * because the printed QR and the /scan/<token> route both depend on it.
 *
 * The same seating_capacity fallback ladder as createTable: that column
 * arrives with a migration the owner runs by hand, and a batch that 42703s is
 * a batch that adds nothing at all.
 */
export async function createTables(
  restaurantId: string,
  labels: string[],
  room: string | null,
  seats?: number | null,
): Promise<number> {
  if (!labels.length) return 0;
  const capped = seats == null ? null : Math.min(40, Math.max(1, Math.round(seats)));
  const base = labels.map((label) => ({
    restaurant_id: restaurantId,
    label,
    room,
    qr_token: 'qr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
  }));

  if (capped != null && !seatsColumnMissing) {
    const { error } = await supabase
      .from('dining_table')
      .insert(base.map((r) => ({ ...r, seating_capacity: capped })));
    if (!error) return base.length;
    if (error.code !== '42703') throw error;
    seatsColumnMissing = true;
  }
  const { error } = await supabase.from('dining_table').insert(base);
  if (error) throw error;
  return base.length;
}

export async function createTable(
  restaurantId: string,
  label: string,
  room: string | null,
  seats?: number | null,
) {
  const token = 'qr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const base = { restaurant_id: restaurantId, label, room, qr_token: token };
  const capped = seats == null ? null : Math.min(40, Math.max(1, Math.round(seats)));

  if (capped != null && !seatsColumnMissing) {
    const { error } = await supabase.from('dining_table').insert({ ...base, seating_capacity: capped });
    if (!error) return;
    if (error.code !== '42703') throw error;
    seatsColumnMissing = true;
  }
  const { error } = await supabase.from('dining_table').insert(base);
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
  const bill = data as { id: string; bill_no: number; subtotal: number; discount: number; gst_amount: number; total: number };

  /**
   * THE AC CHARGE, ADDED AFTER THE BILL EXISTS.
   *
   * A second call rather than part of create_table_bill, because the deployed
   * version of that function matches no version in this repo and is not to be
   * rewritten from guesswork -- it is the one path that moves money.
   *
   * NON-FATAL, and deliberately so. This does nothing at all unless the table
   * carries an AC charge, so the overwhelmingly common outcome is a no-op. If
   * the migration has not been run, or the table has none, or the RPC simply
   * fails, the bill already EXISTS and is correct without it. Letting that
   * throw would turn "no AC charge to add" into "the bill would not raise",
   * with a diner waiting at the counter.
   *
   * The function is idempotent, so a retry of this whole call cannot
   * double-charge.
   */
  await supabase.rpc('apply_table_ac_charge', { p_bill_id: bill.id }).then(
    () => {}, () => {},
  );

  return bill;
}

/**
 * PACKING FOR LEFTOVERS ON A DINE-IN BILL.
 *
 * Never automatic. A packing fee reached every dine-in bill for weeks because
 * a charge applied itself with no scope and nobody chose it per meal -- so
 * this runs only when a human has named a number of boxes.
 *
 * REPLACES rather than adds: staff guess the box count before the food is
 * packed and are wrong about as often as right, so calling with 3 then 2
 * leaves a bill charged for 2. `boxes = 0` removes the line entirely.
 *
 * Errors DO surface here, unlike the AC charge above. This is a deliberate
 * act with a number typed into it, and silently doing nothing after somebody
 * asked for three boxes is worse than telling them it failed.
 */
export async function setParcelPacking(billId: string, boxes: number) {
  const { data, error } = await supabase.rpc('apply_parcel_charge', {
    p_bill_id: billId, p_boxes: Math.max(0, Math.round(boxes || 0)),
  });
  if (error) throw error;
  return data as {
    applied: boolean; reason?: string;
    parcel_charge: number; parcel_boxes: number; fee_per_box?: number;
  };
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
// ── Reservations ───────────────────────────────────────────────────────────

/** Includes WHO booked. The staff page showed date, party size and status but
 *  never the name or phone, so a booking could not be attributed or called --
 *  the two things staff actually need when someone does not turn up. */
export interface Reservation {
  id: string; party_size: number; booked_for: string; status: string;
  guest_name: string | null; guest_phone: string | null;
}

export async function fetchReservations(restaurantId: string): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from('table_booking').select('id, party_size, booked_for, status, guest_name, guest_phone')
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


// ── Settings ───────────────────────────────────────────────────────────────

/** The columns a staged migration adds. A patch containing one of these before
 *  the migration has run fails the WHOLE update with 42703 -- so saving a phone
 *  number would report an error about a map. Dropped once, for the session. */
const STAGED_COLUMNS = ['lat', 'lng', 'map_label'];
let stagedColumnsMissing = false;

export async function updateRestaurant(restaurantId: string, patch: Record<string, unknown>) {
  const without = (p: Record<string, unknown>) => {
    const copy = { ...p };
    for (const k of STAGED_COLUMNS) delete copy[k];
    return copy;
  };

  const send = (p: Record<string, unknown>) =>
    supabase.from('restaurant').update(p).eq('id', restaurantId);

  const { error } = await send(stagedColumnsMissing ? without(patch) : patch);
  if (!error) return;
  // 42703 = undefined_column. Retry without them rather than telling the owner
  // their restaurant name could not be saved.
  if ((error as any).code === '42703') {
    stagedColumnsMissing = true;
    const { error: retry } = await send(without(patch));
    if (retry) throw retry;
    return;
  }
  throw error;
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
    /* THE DAYS FIRST, THE LABELS SECOND -- and that order is a bug fix.
     *
     * The label used to be chosen with `spanDays <= 7 ? weekday : number`, and
     * spanDays is a CEILING over a partial day: "This week" starts at midnight
     * six days ago and ends at the current time, which is 6 days and a few
     * hours, so it ceilings to 7 and the +1 makes 8. The week view therefore
     * failed its own <= 7 test every time and has always shown bare day
     * numbers -- "30 31 1 2 3 4 5" in his screenshot -- when it was written to
     * show Mon/Tue/Wed. Counting the buckets that are actually produced asks
     * the question that was meant.
     *
     * AND THE MONTH IS BACK. Bare day numbers running across a month boundary
     * read as nonsense: 30, 31, then 1. Where a run crosses into a new month
     * -- and on the first column, which otherwise has no anchor at all -- the
     * month goes in front of the number, so the axis says where it is. */
    const days: Date[] = [];
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (d > end) break;
      days.push(d);
    }
    const weekdays = days.length <= 7;
    days.forEach((d, i) => {
      const newMonth = i === 0 || d.getDate() === 1;
      buckets.set(dayKey(d), {
        label: weekdays
          ? DAY[d.getDay()]
          : newMonth ? `${MON[d.getMonth()]} ${d.getDate()}` : String(d.getDate()),
        revenue: 0, orders: 0,
      });
    });
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
/**
 * Served sales over a range, for the Orders board's header. The board used to
 * sum "served today" client-side from the live fetch; the phone's board now
 * answers for a chosen period (Today / week / 30 days / 12 months / dates),
 * and the portal matches it. Served only -- the same rule the header always
 * had: realised sales, not orders in flight.
 */
export async function fetchServedSales(
  restaurantId: string, sinceISO: string, untilISO: string,
): Promise<{ sales: number; count: number }> {
  // Done = served OR settled, not cancelled -- see fetchDoneOrders.
  const { data, error } = await supabase
    .from('food_order').select('total')
    .eq('restaurant_id', restaurantId).neq('status', 'cancelled')
    .or('status.eq.served,settled_at.not.is.null')
    .gte('placed_at', sinceISO).lte('placed_at', untilISO);
  if (error) throw error;
  const rows = data ?? [];
  return { sales: rows.reduce((a, o: any) => a + Number(o.total || 0), 0), count: rows.length };
}

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

/* ── Profile showcase: menu cards, certificates, photos ────────────────────
   The restaurant's shop window, shown on its public page. A LIST rather than
   fixed columns, because it grows: three certificates today, a new licence
   next year, a second menu card when the bar menu arrives. See the
   2026-09-03_profile_showcase migration. */

export type MediaKind = 'menu_card' | 'certificate' | 'photo';

export interface RestaurantMedia {
  id: string;
  restaurant_id: string;
  kind: MediaKind;
  url: string;
  caption: string | null;
  sort_order: number;
}

export async function fetchMedia(restaurantId: string): Promise<RestaurantMedia[]> {
  const { data, error } = await supabase
    .from('restaurant_media')
    .select('id, restaurant_id, kind, url, caption, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('kind')
    .order('sort_order');
  // Soft-fail: an app deployed before the migration should show a profile
  // without a showcase, not a broken page.
  if (error) return [];
  return (data ?? []) as RestaurantMedia[];
}

export async function addMedia(
  restaurantId: string, kind: MediaKind, url: string, caption?: string,
): Promise<void> {
  const { error } = await supabase.from('restaurant_media').insert({
    restaurant_id: restaurantId, kind, url,
    caption: caption?.trim() || null,
  });
  if (error) throw error;
}

export async function deleteMedia(id: string): Promise<void> {
  const { error } = await supabase.from('restaurant_media').delete().eq('id', id);
  if (error) throw error;
}

/** How many a table seats. Null clears it back to "not recorded", which is a
 *  real state -- a restaurant that never fills this in should keep working
 *  exactly as it does today rather than matching against an invented number. */
/**
 * IS THIS TABLE AIR-CONDITIONED — the switch that was missing.
 *
 * AC pricing looked broken because nothing could ever satisfy it. The MODEL was
 * already complete: order_charges() resolves a charge scoped to 'ac' when the
 * restaurant has ac_pricing on AND the order's table is_ac, in flat or percent,
 * and the charges page already offers "AC tables" as a scope. But no screen on
 * any surface could set dining_table.is_ac, so that last clause never matched
 * and an AC charge added nothing to any bill.
 *
 * One switch, not a new field: the column has existed since the bill_options
 * migration, which is now applied.
 */
export async function setTableAc(id: string, isAc: boolean): Promise<void> {
  const { error } = await supabase
    .from('dining_table').update({ is_ac: isAc }).eq('id', id);
  if (error) throw error;
}

export async function setTableCapacity(id: string, seats: number | null): Promise<void> {
  const { error } = await supabase
    .from('dining_table')
    .update({ seating_capacity: seats == null ? null : Math.min(40, Math.max(1, Math.round(seats))) })
    .eq('id', id);
  if (error) throw error;
}

/* ── Bill layout ───────────────────────────────────────────────────────────
 *
 * How the bill is typeset: logo on or off and where it comes from, and the
 * alignment and type size of every section. Stored as one jsonb document --
 * see 2026-09-04_bill_layout.sql for why one column rather than eighteen.
 *
 * BOTH OF THESE TOLERATE THE COLUMN NOT BEING THERE. The migration is staged
 * and run by hand, so there is a window in which this code is deployed and the
 * column is not. A missing column must mean "the house layout", not a settings
 * page that will not open -- the same rule the seats column already follows,
 * and for the same reason it was written: I once took Tables & QR down by
 * selecting a column PostgREST had not seen yet.
 */
let billLayoutColumnMissing = false;

export async function fetchBillLayout(restaurantId: string): Promise<any | null> {
  if (billLayoutColumnMissing) return null;
  const { data, error } = await supabase
    .from('restaurant').select('bill_layout').eq('id', restaurantId).single();
  if (error) {
    if (error.code === '42703') { billLayoutColumnMissing = true; return null; }
    throw error;
  }
  return (data as any)?.bill_layout ?? null;
}

/** Throws a SENTENCE, not a Postgres code. If the column is not there yet the
 *  owner needs to know their change was not kept and why, in words that tell
 *  them who can fix it -- "42703" tells them nothing and looks like a bug. */
export async function saveBillLayout(restaurantId: string, layout: any): Promise<void> {
  const { error } = await supabase
    .from('restaurant').update({ bill_layout: layout }).eq('id', restaurantId);
  if (error) {
    if (error.code === '42703' || /bill_layout/.test(error.message ?? '')) {
      billLayoutColumnMissing = true;
      throw new Error('Bill layout cannot be saved yet — this restaurant’s database is still being updated. Everything else on this page saves normally.');
    }
    throw error;
  }
}

/** #R — the staff fallback for AC.
 *
 *  The automatic path needs none of this: the order's table carries is_ac and
 *  the server resolves the service rate from it with nobody choosing anything.
 *  This exists for when the automatic answer is wrong -- a party moved to the
 *  AC room, a table flagged after the order went in -- and it sets an override
 *  and re-totals, so the "Service charge" line changes before the bill prints.
 *
 *  Tolerates the function not existing: it arrives with a staged migration, and
 *  until that runs the automatic path is simply the only path, which is the
 *  behaviour today. Returns false so the caller can say so rather than claim a
 *  change that did not happen. */
export async function setOrdersAc(orderIds: string[], isAc: boolean): Promise<boolean> {
  if (!orderIds.length) return false;
  const { error } = await supabase.rpc('set_orders_ac', {
    p_order_ids: orderIds, p_is_ac: isAc,
  });
  if (!error) return true;
  if (error.code === 'PGRST202') return false;
  throw error;
}

/* ── Chat: the restaurant's side of the diner conversations ────────────────
 *
 * One row per TABLE that has ever said something, newest activity first, with
 * the last line and an unread count -- which is the shape an inbox needs and
 * is also exactly what the Notifications badge counts.
 *
 * Fetched as one query and grouped here rather than as a query per table: a
 * restaurant with thirty tables would otherwise open thirty round trips to
 * draw one list.
 */

export interface ChatThread {
  table_id: string;
  table_label: string;
  last_body: string;
  last_at: string;
  last_from: string;
  unread: number;
  guest_name: string | null;
}

export interface PortalMessage {
  id: string;
  from_role: string;
  body: string;
  created_at: string;
  guest_name: string | null;
  read_at: string | null;
}

export async function fetchChatThreads(restaurantId: string): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from('message')
    .select('id, table_id, from_role, body, created_at, guest_name, read_at, dining_table(label)')
    .eq('restaurant_id', restaurantId)
    .not('table_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const byTable = new Map<string, ChatThread>();
  for (const row of (data ?? []) as any[]) {
    const label = (Array.isArray(row.dining_table) ? row.dining_table[0] : row.dining_table)?.label ?? 'Table';
    let th = byTable.get(row.table_id);
    if (!th) {
      // Rows arrive newest-first, so the first one seen for a table IS its last
      // message. Nothing later should overwrite that.
      th = {
        table_id: row.table_id, table_label: label,
        last_body: row.body, last_at: row.created_at, last_from: row.from_role,
        unread: 0, guest_name: row.guest_name ?? null,
      };
      byTable.set(row.table_id, th);
    }
    if (row.from_role === 'diner' && !row.read_at) th.unread += 1;
  }
  return [...byTable.values()];
}

export async function fetchThreadMessages(tableId: string): Promise<PortalMessage[]> {
  const { data, error } = await supabase
    .from('message')
    .select('id, from_role, body, created_at, guest_name, read_at')
    .eq('table_id', tableId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as PortalMessage[];
}

export async function sendRestaurantMessage(restaurantId: string, tableId: string, body: string) {
  const text = body.trim();
  if (!text) return;
  const { error } = await supabase.from('message').insert({
    restaurant_id: restaurantId,
    table_id: tableId,
    from_role: 'restaurant',
    body: text.slice(0, 500),
  });
  if (error) throw error;
}

/** Definer function: it checks is_staff_of itself, so a table id alone is not
 *  enough to clear someone else's unread count. */
export async function markThreadRead(tableId: string) {
  await supabase.rpc('mark_thread_read', { p_table_id: tableId });
}

/**
 * Every diner message for this restaurant, live.
 *
 * ONE CHANNEL FOR THE WHOLE RESTAURANT rather than one per open thread: the
 * inbox, the badge and the open conversation all want the same event, and
 * three subscriptions to the same rows is three times the socket traffic and
 * three places for a reconnect to go wrong.
 */
export function subscribeRestaurantMessages(
  restaurantId: string,
  onMessage: (m: PortalMessage & { table_id: string }) => void,
): () => void {
  const channel = supabase
    .channel(`chat-portal:${restaurantId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => onMessage(payload.new as PortalMessage & { table_id: string }),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/* ── Notifications ─────────────────────────────────────────────────────────
 *
 * DERIVED, NOT STORED. There is no notification table and deliberately so: a
 * notification here is not a new fact, it is a VIEW of facts that already
 * exist -- an order was placed, a table asked for something, a diner sent a
 * message. Writing a row for each would mean two sources of truth that can
 * disagree, and the first time they did the inbox would be lying about work
 * that had already been done.
 *
 * So the feed is three small queries merged and sorted. Each item carries
 * enough to open the EXACT thing it is about, which is the whole point: he
 * asked for deep links that land on the right screen every time, and an item
 * that only knows its own kind cannot do that.
 */

export type NotifKind = 'order' | 'service' | 'chat';

export interface Notification {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  at: string;
  unread: boolean;
  /** Where tapping it goes. Built here so both surfaces route identically. */
  to: string;
}

const NOTIF_SERVICE_LABEL: Record<string, string> = {
  clean_table: 'Clean the table', tissues: 'Tissues', water: 'Water', sauce: 'Sauce',
  plates: 'Extra plates', cutlery: 'Cutlery', assistance: 'Someone at the table',
};

export async function fetchNotifications(restaurantId: string): Promise<Notification[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [orders, services, msgs] = await Promise.all([
    supabase
      .from('food_order')
      .select('id, order_no, total, placed_at, dining_table(label)')
      .eq('restaurant_id', restaurantId)
      .gte('placed_at', since)
      .neq('status', 'cancelled')
      .order('placed_at', { ascending: false })
      .limit(40),
    supabase
      .from('service_request')
      .select('id, table_id, kind, status, created_at, dining_table(label)')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('message')
      .select('id, table_id, body, created_at, read_at, from_role, dining_table(label)')
      .eq('restaurant_id', restaurantId)
      .eq('from_role', 'diner')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const label = (row: any) =>
    (Array.isArray(row.dining_table) ? row.dining_table[0] : row.dining_table)?.label ?? 'Table';

  const out: Notification[] = [];

  for (const o of (orders.data ?? []) as any[]) {
    out.push({
      id: `order:${o.id}`, kind: 'order',
      title: `New order · ${label(o)}`,
      body: `#${o.order_no} · ${inrPlain(o.total)}`,
      at: o.placed_at,
      // An order is "unread" while it is still work. The board is the record
      // of whether it has been dealt with, not a flag on the notification.
      unread: true,
      to: `/partner/orders?order=${o.id}`,
    });
  }

  for (const s of (services.data ?? []) as any[]) {
    out.push({
      id: `svc:${s.id}`, kind: 'service',
      title: `${label(s)} asked for something`,
      body: NOTIF_SERVICE_LABEL[s.kind] ?? s.kind,
      at: s.created_at,
      unread: s.status === 'open',
      to: `/partner/orders?table=${s.table_id ?? ''}`,
    });
  }

  for (const m of (msgs.data ?? []) as any[]) {
    out.push({
      id: `msg:${m.id}`, kind: 'chat',
      title: `Message from ${label(m)}`,
      body: m.body,
      at: m.created_at,
      unread: !m.read_at,
      to: `/partner/chat?table=${m.table_id}`,
    });
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Plain rupee formatting, local to this file so the feed does not have to
 *  import the diner app's formatter. */
function inrPlain(n: number) {
  return '₹' + Math.round(Number(n ?? 0)).toLocaleString('en-IN');
}

/**
 * WHAT A TABLE IS ASKING FOR, requests and messages in one list.
 *
 * The board used to learn about these in two places and show them in neither:
 * open service requests went to a banner ABOVE the orders, and a diner's
 * message went to the Chat page entirely. So "table 4 ordered a thali and also
 * asked for water" was two facts on two screens, and the floor staff had to
 * join them up while walking.
 *
 * This returns both, in one shape, keyed by the table LABEL rather than the
 * id -- the orders board groups its tickets by label (it has no table_id on a
 * ticket), so the label is the only join that works without reshaping the
 * board's own data.
 *
 * Messages are limited to a diner's UNREAD ones. A read message is a
 * conversation already handled; putting it back on the order card would make
 * the card louder every time somebody replied.
 */
export interface TableSignal {
  id: string;
  kind: 'request' | 'message';
  tableLabel: string;
  /** "Water", or the message body. Already display-ready. */
  text: string;
  guestName: string | null;
  createdAt: string;
}

export async function fetchTableSignals(restaurantId: string): Promise<TableSignal[]> {
  const [reqs, msgs] = await Promise.all([
    supabase
      .from('service_request')
      .select('id, kind, note, guest_name, created_at, dining_table(label)')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'open')
      .order('created_at', { ascending: true }),
    supabase
      .from('message')
      .select('id, body, guest_name, created_at, dining_table(label)')
      .eq('restaurant_id', restaurantId)
      .eq('from_role', 'diner')
      .is('read_at', null)
      .not('table_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(200),
  ]);

  const labelOf = (row: any) =>
    (Array.isArray(row.dining_table) ? row.dining_table[0] : row.dining_table)?.label ?? 'Table';

  const out: TableSignal[] = [];

  for (const r of (reqs.data ?? []) as any[]) {
    out.push({
      id: r.id,
      kind: 'request',
      tableLabel: labelOf(r),
      // The note is the diner's own words and beats our label for the kind.
      text: (r.note && String(r.note).trim()) || SERVICE_KIND_LABEL[r.kind] || r.kind,
      guestName: r.guest_name ?? null,
      createdAt: r.created_at,
    });
  }
  for (const m of (msgs.data ?? []) as any[]) {
    out.push({
      id: m.id,
      kind: 'message',
      tableLabel: labelOf(m),
      text: m.body,
      guestName: m.guest_name ?? null,
      createdAt: m.created_at,
    });
  }

  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** Kind -> the word staff use for it. Kept here so the board and the strip
 *  cannot drift into calling the same request two different things. */
export const SERVICE_KIND_LABEL: Record<string, string> = {
  water: 'Water',
  waiter: 'Waiter',
  bill: 'The bill',
  cutlery: 'Cutlery',
  napkins: 'Napkins',
  clean: 'Clean the table',
  help: 'Help',
};
