/** Data layer — same Supabase contract as the mobile app (see
 *  apps/mobile/src/lib/supabaseService.ts): dining_table lookup by qr_token,
 *  menu_item + options, place_order RPC (server-side pricing), and the
 *  get_order_status RPC for guest tracking. Demo token short-circuits locally. */
import { supabase } from './supabase';
import type { CartLine, DiningTable, MenuItem, OrderView, Restaurant, Session, TableBill } from './types';
import {
  DEMO_TOKEN,
  demoMenu,
  demoOrderStatus,
  demoPlaceOrder,
  demoRecordPayment,
  demoRestaurant,
  demoTable,
} from './demo';
import { loadCheckout } from './razorpayCheckout';

export class ScanError extends Error {
  constructor(public kind: 'not_found' | 'not_accepting', message: string) {
    super(message);
  }
}

export async function resolveToken(token: string): Promise<Session> {
  if (token === DEMO_TOKEN) {
    return { token, restaurant: demoRestaurant, table: demoTable, demo: true };
  }
  const { data, error } = await supabase
    .from('dining_table')
    .select(
      'id, restaurant_id, label, is_parcel, restaurant(id, name, city, banner_url, logo_url, is_open, status, trial_ends_at, parcel_charge, gst_pct, service_charge_pct)',
    )
    .eq('qr_token', token)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScanError('not_found', 'This QR code is not recognised.');

  const r = (Array.isArray(data.restaurant) ? data.restaurant[0] : data.restaurant) as Restaurant;
  if (r.status === 'suspended') {
    throw new ScanError('not_accepting', `${r.name} is not taking orders right now.`);
  }

  // Soft lock (subscriptions model): menus stay viewable, ordering may be off.
  // get_plan_state ships with the subscriptions migration; fall back to the
  // v1 trial check if the RPC isn't deployed yet.
  let orderingDisabled = false;
  const { data: planState, error: psErr } = await supabase.rpc('get_plan_state', {
    p_restaurant_id: data.restaurant_id,
  });
  if (!psErr && planState) {
    orderingDisabled = !(planState as { can_order?: boolean }).can_order;
  } else {
    orderingDisabled = !!(r.trial_ends_at && new Date(r.trial_ends_at).getTime() < Date.now());
  }

  const table: DiningTable = {
    id: data.id,
    restaurant_id: data.restaurant_id,
    label: data.label,
    is_parcel: data.is_parcel,
  };
  return { token, restaurant: r, table, orderingDisabled };
}

/** All listed (active, in-trial) restaurants for the browse/search screen. */
export async function fetchRestaurants(): Promise<Restaurant[]> {
  const { data, error } = await supabase
    .from('restaurant')
    .select('id, name, city, banner_url, logo_url, is_open, status, trial_ends_at, parcel_charge')
    .eq('status', 'active')
    .order('name');
  if (error) throw error;
  const now = Date.now();
  return (data ?? []).filter(
    (r: Restaurant) => !r.trial_ends_at || new Date(r.trial_ends_at).getTime() > now,
  );
}

/** Start a session from search (no table QR): order as Parcel/Takeaway via the
 *  restaurant's dedicated parcel point (created at signup for every venue). */
export async function startParcelSession(restaurant: Restaurant): Promise<Session> {
  if (restaurant.id === demoRestaurant.id) {
    return { token: DEMO_TOKEN, restaurant: demoRestaurant, table: demoTable, demo: true };
  }
  const { data, error } = await supabase
    .from('dining_table')
    .select('id, restaurant_id, label, is_parcel, qr_token')
    .eq('restaurant_id', restaurant.id)
    .eq('is_parcel', true)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScanError('not_accepting', `${restaurant.name} doesn’t take takeaway orders yet — scan the QR at a table instead.`);
  return {
    token: data.qr_token,
    restaurant,
    table: { id: data.id, restaurant_id: data.restaurant_id, label: data.label, is_parcel: true },
  };
}

export async function fetchMenu(session: Session): Promise<MenuItem[]> {
  if (session.demo) return demoMenu;
  const { data, error } = await supabase
    .from('menu_item')
    .select(
      'id, name, description, price, is_veg, photo_url, sort_order, menu_item_option(id, name, choice, price_delta), menu_category(name, sort_order)',
    )
    .eq('restaurant_id', session.restaurant.id)
    .eq('is_available', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const cat = Array.isArray(row.menu_category) ? row.menu_category[0] : row.menu_category;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: Number(row.price),
      is_veg: !!row.is_veg,
      photo_url: row.photo_url,
      category: cat?.name ?? 'Menu',
      category_sort: cat?.sort_order ?? 99,
      options: (row.menu_item_option ?? []).map((o: any) => ({
        id: o.id,
        name: o.name,
        choice: o.choice,
        price_delta: Number(o.price_delta),
      })),
    };
  });
}

/** Refresh trigger for live menu edits. Works once menu_item is in the
 *  realtime publication (2026-07-15_web_guest_access.sql); harmless before. */
export function subscribeMenu(session: Session, onChange: () => void): () => void {
  if (session.demo) return () => {};
  const channel = supabase
    .channel(`menu:${session.restaurant.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_item', filter: `restaurant_id=eq.${session.restaurant.id}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function placeOrder(
  session: Session,
  lines: CartLine[],
  notes?: string,
): Promise<{ id: string }> {
  if (!lines.length) throw new Error('Your cart is empty.');
  if (session.demo) return demoPlaceOrder(lines, notes, session.table.is_parcel);

  // Server-side pricing: only ids + qty go up, place_order re-prices everything.
  // Diner name/phone tag the order (6-arg place_order) so the kitchen and the
  // table bill can attribute it to the person who ordered.
  const { data, error } = await supabase.rpc('place_order', {
    p_restaurant_id: session.restaurant.id,
    p_table_id: session.table.id,
    p_items: lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, option_ids: l.optionIds })),
    p_notes: notes || null,
    p_guest_name: session.guest?.name || null,
    p_guest_phone: session.guest?.phone || null,
  });
  if (error) {
    const msg = String(error.message ?? '');
    if (msg.includes('row-level security') || msg.includes('trial')) {
      throw new Error('This restaurant is not accepting orders right now.');
    }
    throw error;
  }
  // The notification's contents are built server-side from the order row, so
  // the client only has to name the order. That also keeps what the kitchen
  // sees identical no matter which client placed it.
  notifyStaff((data as { id: string }).id).catch(() => {});
  return data as { id: string };
}

/** The whole table's live bill: every open order, a combined total (the
 *  default) and a per-diner split. combined.total === sum(per_person.total). */
export async function fetchTableBill(session: Session): Promise<TableBill> {
  if (session.demo) {
    const o = demoOrderStatus();
    const totals = o
      ? { subtotal: o.subtotal, packing_charge: o.packing_charge, gst_amount: o.gst_amount, total: o.total, order_count: 1 }
      : { subtotal: 0, packing_charge: 0, gst_amount: 0, total: 0, order_count: 0 };
    const who = session.guest?.name || 'You';
    return {
      table_id: session.table.id,
      orders: o
        ? [{ order_id: o.id, status: o.status, diner_name: who, diner_phone: session.guest?.phone,
             subtotal: o.subtotal, packing_charge: o.packing_charge, gst_amount: o.gst_amount, total: o.total,
             items: o.items }]
        : [],
      combined: totals,
      per_person: o ? [{ diner_name: who, diner_phone: session.guest?.phone, ...totals }] : [],
    };
  }
  const { data, error } = await supabase.rpc('get_table_bill', { p_table_id: session.table.id });
  if (error) throw error;
  return data as TableBill;
}

export async function fetchOrderStatus(session: Session | null, orderId: string): Promise<OrderView> {
  if (session?.demo || orderId === 'demo-order') {
    const v = demoOrderStatus();
    if (!v) throw new Error('Order not found.');
    return v;
  }
  const { data, error } = await supabase.rpc('get_order_status', { p_order_id: orderId });
  if (error) throw error;
  return data as OrderView;
}

// ── Diner payments — direct to the restaurant (MODULE 3) ───────────────────

export interface PaymentQr {
  order_no: number;
  amount: number;
  vpa: string | null;
  payee_name: string;
  gateway_key_id: string | null;
  paid: boolean;
}

export async function fetchPaymentQr(orderId: string, demo?: boolean): Promise<PaymentQr> {
  if (demo || orderId === 'demo-order') {
    const o = demoOrderStatus();
    return {
      order_no: o?.order_no ?? 108, amount: o?.total ?? 0,
      vpa: 'saffrongrove@demo', payee_name: 'Saffron Grove Kitchen',
      gateway_key_id: null, paid: o?.payment?.status === 'paid',
    };
  }
  const { data, error } = await supabase.rpc('get_payment_qr', { p_order_id: orderId });
  if (error) throw error;
  return data as PaymentQr;
}

/** Diner marks how they're paying: upi_qr / cash → pending until staff
 *  confirms; recorded server-side against the order. */
export async function recordDinerPayment(orderId: string, mode: 'upi_qr' | 'cash', ref?: string, demo?: boolean) {
  if (demo || orderId === 'demo-order') { demoRecordPayment(mode); return; }
  const { error } = await supabase.rpc('record_payment', {
    p_order_id: orderId, p_provider: mode, p_provider_ref: ref ?? null,
  });
  if (error) {
    if (String(error.message).includes('already exists')) return; // double-tap safe
    throw error;
  }
}

/** Card/wallet checkout on the RESTAURANT'S OWN Razorpay account. */
export async function startGatewayCheckout(orderId: string, demo?: boolean): Promise<void> {
  if (demo || orderId === 'demo-order') { demoRecordPayment('gateway'); return; }
  const { data, error } = await supabase.functions.invoke('gateway-order', {
    body: { order_id: orderId },
  });
  if (error) throw new Error((await (error as any)?.context?.text?.()) || error.message);
  await loadCheckout();
  await new Promise<void>((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: data.key_id,
      order_id: data.razorpay_order_id,
      amount: data.amount,
      currency: 'INR',
      name: data.name,
      theme: { color: '#1B5E3F' },
      handler: async (res: { razorpay_payment_id: string }) => {
        try {
          await supabase.rpc('record_payment', {
            p_order_id: orderId, p_provider: 'gateway',
            p_provider_ref: res.razorpay_payment_id,
          });
          resolve();
        } catch (e) { reject(e); }
      },
      modal: { ondismiss: () => reject(new Error('Checkout was closed before paying.')) },
    });
    rzp.open();
  });
}

/** Ask the backend to push "new order" to staff devices.
 *
 *  This used to POST to https://exp.host straight from the diner's browser,
 *  which can never work: exp.host answers the CORS preflight 200 but sends no
 *  Access-Control-Allow-Origin, so the browser blocks the request before it
 *  leaves the page. Verified live from https://menutha.com — "Failed to fetch".
 *  Every diner order comes from the web, so no staff push was ever delivered.
 *
 *  The notify-staff Edge Function does the send server-side, where CORS does
 *  not apply. Still fire-and-forget: the partner board's realtime subscription
 *  is the primary signal and does not depend on this. */
async function notifyStaff(orderId: string) {
  const { data, error } = await supabase.functions.invoke('notify-staff', {
    body: { orderId },
  });
  if (error) throw error;
  // Surfaced for debugging only — a push failure must never block ordering.
  if (import.meta.env.DEV && (data as any)?.errors?.length) {
    console.warn('[notify-staff]', (data as any).errors);
  }
}

/** The diner tells the counter they have paid the table's bill.
 *
 *  This is a CLAIM, not a settlement, and the wording everywhere says so. A
 *  static UPI QR has no webhook: money moves directly between the diner's app
 *  and the restaurant's bank, and nothing tells us it happened. Until a payment
 *  gateway is wired, the honest mechanism is that the diner says they paid, the
 *  counter is notified immediately, and staff verify in their own UPI app
 *  before settling. Staff remain the only party who can mark a bill paid.
 *
 *  Records a pending payment against each open order so the partner board's
 *  existing "Diner says they paid — confirm we received it" flow lights up,
 *  then fires one push so nobody has to be watching the screen.
 */
export async function claimTablePaid(session: Session, amount: number) {
  const bill = await fetchTableBill(session);
  const orders = (bill.orders ?? []).filter((o) => !!o.order_id);
  if (!orders.length) return;

  // Pending rows first: the board reads these, so the claim survives even if
  // the push is blocked or the staff phone is off.
  await Promise.all(
    orders.map((o) =>
      supabase.rpc('record_payment', {
        p_order_id: o.order_id,
        p_provider: 'upi_qr',
        p_provider_ref: null,
      }).then(() => undefined).catch(() => undefined),
    ),
  );

  // One push for the table, not one per order.
  await supabase.functions.invoke('notify-staff', {
    body: {
      orderId: orders[0].order_id,
      kind: 'payment_claimed',
      amount: Number(amount || 0),
    },
  }).catch(() => undefined);
}

// ── Orders the diner may still change (grace window) ───────────────────────

export interface OpenOrderItem {
  id: string; menu_item_id: string | null; name: string; qty: number; unit_price: number;
}
export interface OpenOrder {
  id: string; order_no: number; placed_at: string; released_at: string;
  total: number; status: string; editable: boolean; items: OpenOrderItem[];
}

/** Every order of mine at this table that is still inside its grace window, or
 *  released so recently the diner is probably still looking at it. Drives both
 *  the per-dish stepper on the menu and the countdown strip. */
export async function fetchMyOpenOrders(session: Session): Promise<OpenOrder[]> {
  if (session.demo || !session.table?.id) return [];
  const { data, error } = await supabase.rpc('my_open_orders', {
    p_table_id: session.table.id,
    p_phone: session.guest?.phone ?? '',
  });
  if (error) throw error;
  return (data ?? []) as OpenOrder[];
}

/** Change a quantity before the order reaches the kitchen. qty 0 removes the
 *  line; removing the last line cancels the order. The window is enforced
 *  server-side, so a stale page cannot edit something already being cooked. */
export async function updateMyOrderItem(orderId: string, itemId: string, qty: number) {
  const { error } = await supabase.rpc('diner_update_order_item', {
    p_order_id: orderId, p_order_item_id: itemId, p_qty: qty,
  });
  if (error) throw error;
}

export async function cancelMyOrder(orderId: string) {
  const { error } = await supabase.rpc('diner_cancel_order', { p_order_id: orderId });
  if (error) throw error;
}

// ── The diner's own bill ───────────────────────────────────────────────────

export interface MyBillTotals {
  subtotal: number; packing_charge: number; service_charge?: number;
  sgst_amount?: number; cgst_amount?: number; gst_amount: number;
  total: number; order_count: number;
}
export interface MyBill {
  table_id: string;
  sgst_pct?: number | null;
  cgst_pct?: number | null;
  orders: { order_id: string; placed_at: string; status: string; total: number;
            items: { name: string; qty: number; unit_price: number; is_veg?: boolean }[] }[];
  mine: MyBillTotals;
}

/** Only this diner's unsettled orders at this table.
 *
 *  Replaces fetchTableBill on the diner's screen. Scoping happens in the
 *  database, not here: filtering a full-table payload in the client would
 *  still have put every other diner's name, phone and total on a stranger's
 *  device, and would still have shown a previous party's uncleared food to
 *  whoever scanned the table next. */
export async function fetchMyBill(session: Session): Promise<MyBill> {
  if (session.demo) {
    const o = demoOrderStatus();
    const mine = o
      ? { subtotal: o.subtotal, packing_charge: o.packing_charge, service_charge: 0,
          sgst_amount: 0, cgst_amount: 0, gst_amount: o.gst_amount, total: o.total, order_count: 1 }
      : { subtotal: 0, packing_charge: 0, service_charge: 0, sgst_amount: 0, cgst_amount: 0,
          gst_amount: 0, total: 0, order_count: 0 };
    return {
      table_id: session.table.id,
      orders: o ? [{ order_id: o.id, placed_at: new Date().toISOString(), status: o.status,
                     total: o.total, items: o.items as any }] : [],
      mine,
    };
  }
  const { data, error } = await supabase.rpc('my_table_bill', {
    p_table_id: session.table.id,
    p_phone: session.guest?.phone ?? '',
  });
  if (error) throw error;
  return data as MyBill;
}

// ── The table's current session ────────────────────────────────────────────

export interface SessionLine {
  who: string | null; name: string; qty: number; amount: number; is_veg?: boolean;
}
export interface SessionBill {
  table_id: string;
  sgst_pct?: number | null;
  cgst_pct?: number | null;
  lines: SessionLine[];
  totals: MyBillTotals;
}

/** Everything ordered at this table in the current seating.
 *
 *  Diners sharing a table see each other's dishes — that is the point of a
 *  shared bill. What they never see is a phone number, a per-person split, or
 *  a previous party's food: the session boundary moves when the table is
 *  settled or cleared, so a new seating starts from an empty page even while
 *  an older bill is still open in the back office. */
export async function fetchSessionBill(session: Session): Promise<SessionBill> {
  if (session.demo) {
    const o = demoOrderStatus();
    return {
      table_id: session.table.id,
      lines: (o?.items ?? []).map((i: any) => ({
        who: session.guest?.name?.split(' ')[0] ?? null,
        name: i.name, qty: i.qty, amount: Number(i.unit_price) * Number(i.qty),
      })),
      totals: o
        ? { subtotal: o.subtotal, packing_charge: o.packing_charge, service_charge: 0,
            sgst_amount: 0, cgst_amount: 0, gst_amount: o.gst_amount, total: o.total, order_count: 1 }
        : { subtotal: 0, packing_charge: 0, service_charge: 0, sgst_amount: 0,
            cgst_amount: 0, gst_amount: 0, total: 0, order_count: 0 },
    };
  }
  const { data, error } = await supabase.rpc('table_session_bill', {
    p_table_id: session.table.id,
  });
  if (error) throw error;
  return data as SessionBill;
}
