/** Demo mode — scan token "demo" (or the landing page's "Try the demo").
 *  Renders the full flow with local data and a simulated kitchen so the web
 *  app can be exercised with no backend, no SMS, and no printed QR. */
import type { DiningTable, MenuItem, OrderStatus, OrderView, Restaurant, CartLine } from './types';
import { calcBill } from './types';

export const DEMO_TOKEN = 'demo';

export const demoRestaurant: Restaurant = {
  id: 'demo-restaurant',
  name: 'Saffron Grove Kitchen',
  city: 'Hospet',
  banner_url: '',
  logo_url: '',
  is_open: true,
  status: 'active',
  trial_ends_at: null,
  parcel_charge: 20,
};

/** Directory fallback shown when the live Supabase directory is unreachable
 *  (e.g. project paused), so the pilot restaurant stays discoverable in search.
 *  Live rows from the DB take precedence and dedupe these out by name. */
export const directoryFallback: Restaurant[] = [
  demoRestaurant,
  {
    id: 'ashwamedha',
    name: 'Ashwamedha Lodge and Family Restaurant',
    city: 'Hospet',
    banner_url: '',
    logo_url: '',
    is_open: true,
    status: 'active',
    trial_ends_at: null,
    parcel_charge: 20,
  },
];

export const demoTable: DiningTable = {
  id: 'demo-table',
  restaurant_id: 'demo-restaurant',
  label: 'Table 4',
  is_parcel: false,
};

const opt = (id: string, name: string, choice: string, delta: number) => ({
  id,
  name,
  choice,
  price_delta: delta,
});

export const demoMenu: MenuItem[] = [
  {
    id: 'd1', name: 'Paneer Tikka Angara', price: 320, is_veg: true,
    description: 'Char-grilled cottage cheese, smoked chilli marinade, mint chutney.',
    photo_url: null, category: 'Starters', category_sort: 1,
    options: [opt('d1s1', 'Spice level', 'Classic', 0), opt('d1s2', 'Spice level', 'Angara (hot)', 0), opt('d1a1', 'Add-on', 'Extra mint chutney', 20)],
  },
  {
    id: 'd2', name: 'Ghee Roast Chicken', price: 380, is_veg: false,
    description: 'Mangalorean-style ghee roast, curry leaves, byadgi chillies.',
    photo_url: null, category: 'Starters', category_sort: 1, options: [],
  },
  {
    id: 'd3', name: 'Dal Makhani', price: 290, is_veg: true,
    description: 'Black urad simmered overnight, slow-finished with white butter.',
    photo_url: null, category: 'Mains', category_sort: 2,
    options: [opt('d3a1', 'Add-on', 'Extra butter', 25)],
  },
  {
    id: 'd4', name: 'Nalli Nihari', price: 520, is_veg: false,
    description: 'Lamb shank braised six hours, saffron, slow spices, ginger juliennes.',
    photo_url: null, category: 'Mains', category_sort: 2, options: [],
  },
  {
    id: 'd5', name: 'Hyderabadi Veg Dum Biryani', price: 340, is_veg: true,
    description: 'Aged basmati, layered vegetables, fried onion, served with salan.',
    photo_url: null, category: 'Mains', category_sort: 2,
    options: [opt('d5s1', 'Portion', 'Regular', 0), opt('d5s2', 'Portion', 'Family (serves 2)', 220)],
  },
  {
    id: 'd6', name: 'Butter Garlic Naan (2)', price: 110, is_veg: true,
    description: 'Tandoor-blistered, brushed with garlic butter.',
    photo_url: null, category: 'Breads', category_sort: 3, options: [],
  },
  {
    id: 'd7', name: 'Kesar Pista Kulfi', price: 160, is_veg: true,
    description: 'Hand-churned saffron kulfi, pistachio crumble, falooda.',
    photo_url: null, category: 'Desserts', category_sort: 4, options: [],
  },
  {
    id: 'd8', name: 'Masala Chaas', price: 90, is_veg: true,
    description: 'Spiced buttermilk, roasted cumin, curry leaf tempering.',
    photo_url: null, category: 'Beverages', category_sort: 5, options: [],
  },
];

/** Simulated kitchen: status derives from time since the order was placed, so
 *  the tracking page animates Placed → Accepted → Preparing → Ready → Served. */
const STAGES: { after: number; status: OrderStatus }[] = [
  { after: 0, status: 'placed' },
  { after: 8_000, status: 'accepted' },
  { after: 16_000, status: 'preparing' },
  { after: 34_000, status: 'ready' },
  { after: 50_000, status: 'served' },
];

const KEY = 'menutha-web:demo-order';

export function demoPlaceOrder(lines: CartLine[], notes: string | undefined, isParcel: boolean): { id: string } {
  const bill = calcBill(lines, isParcel ? Number(demoRestaurant.parcel_charge ?? 0) : 0);
  const order = {
    placedAt: Date.now(),
    notes: notes ?? '',
    lines,
    bill,
    isParcel,
  };
  sessionStorage.setItem(KEY, JSON.stringify(order));
  return { id: 'demo-order' };
}

const PAY_KEY = 'menutha-web:demo-payment';

export function demoRecordPayment(mode: string) {
  sessionStorage.setItem(PAY_KEY, JSON.stringify({ provider: mode, status: mode === 'gateway' ? 'paid' : 'created', at: Date.now() }));
}

function demoPayment(): { provider: string; status: 'created' | 'paid' } | null {
  const raw = sessionStorage.getItem(PAY_KEY);
  if (!raw) return null;
  const p = JSON.parse(raw);
  // Simulated staff confirmation ~6s after the diner marks paid.
  if (p.status === 'created' && Date.now() - p.at > 6000) p.status = 'paid';
  return { provider: p.provider, status: p.status };
}

export function demoOrderStatus(): OrderView | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const o = JSON.parse(raw) as {
    placedAt: number;
    lines: CartLine[];
    bill: { subtotal: number; packing: number; gst: number; total: number };
    isParcel: boolean;
  };
  const elapsed = Date.now() - o.placedAt;
  let status: OrderStatus = 'placed';
  for (const s of STAGES) if (elapsed >= s.after) status = s.status;
  return {
    id: 'demo-order',
    order_no: 108,
    status,
    payment: demoPayment(),
    is_parcel: o.isParcel,
    table_label: demoTable.label,
    subtotal: o.bill.subtotal,
    packing_charge: o.bill.packing,
    gst_amount: o.bill.gst,
    total: o.bill.total,
    placed_at: new Date(o.placedAt).toISOString(),
    ready_at: elapsed >= 34_000 ? new Date(o.placedAt + 34_000).toISOString() : null,
    served_at: elapsed >= 50_000 ? new Date(o.placedAt + 50_000).toISOString() : null,
    restaurant_name: demoRestaurant.name,
    items: o.lines.map((l) => ({
      name: l.name,
      qty: l.qty,
      unit_price: l.price + l.optionDelta,
      options: l.optionLabels,
      is_veg: l.isVeg,
    })),
  };
}
