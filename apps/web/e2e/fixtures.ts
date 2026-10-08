import type { Page, Route } from '@playwright/test';

/**
 * A fake Supabase for the browser: every REST/RPC call the page makes is
 * answered here, so a test never reads or writes the live database. Anything
 * not listed answers an empty list, which every screen treats as "nothing yet".
 */
export type Calls = { rpc: Record<string, any[]>; rest: string[] };

export const VISIT = '11111111-1111-4111-8111-111111111111';
export const visitPayload = {
  visit: VISIT,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  table: { id: '22222222-2222-4222-8222-222222222222', restaurant_id: '33333333-3333-4333-8333-333333333333', label: 'Table 4', is_parcel: false },
  restaurant: { id: '33333333-3333-4333-8333-333333333333', slug: 'udupi', name: 'Udupi Test Kitchen', city: 'Bengaluru',
    is_open: true, status: 'active', parcel_charge: 10, gst_pct: 5, service_charge_pct: 0 },
  ordering_disabled: false,
};

export const MENU = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Masala Dosa', description: 'Crisp, with chutney', price: 90, is_veg: true,
    photo_url: null, sort_order: 1, menu_item_option: [], menu_category: { name: 'Breakfast', sort_order: 1 } },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Filter Coffee', description: null, price: 30, is_veg: true,
    photo_url: null, sort_order: 2, menu_item_option: [], menu_category: { name: 'Drinks', sort_order: 2 } },
];

export const PUBLIC_BILL = {
  bill_no: 41, invoice_no: '26-27/0041', issued_at: '2026-10-08T09:30:00Z', table: 'Table 4',
  restaurant: { name: 'Udupi Test Kitchen', address: 'MG Road', city: 'Bengaluru', phone: '', gstin: '', fssai_no: '',
    sgst_pct: 2.5, cgst_pct: 2.5 },
  items: [{ name: 'Masala Dosa', qty: 2, unit_price: 90 }],
  total: 189, gst_amount: 9, sgst_amount: 4.5, cgst_amount: 4.5, discount: 0,
  breakdown: {
    version: 3, doc_title: 'BILL OF SUPPLY', items: [{ name: 'Masala Dosa', qty: 2, rate_p: 9000, amount_p: 18000, gst_rate: 5 }],
    food_p: 18000, discount_p: 0, food_net_p: 18000, service_p: 0, charges: [], packing_p: 0, boxes_p: 0, ac_p: 0,
    extras: [], taxed: {}, taxable_p: 18000, tax_buckets: [], sgst_rate: 2.5, cgst_rate: 2.5, sgst_p: 450, cgst_p: 450,
    tax_p: 900, tax_included_p: 0, round_off_p: 0, total_p: 18900, total: 189, token_no: null, order_type: 'dine_in',
  },
};

export async function fakeSupabase(page: Page, rpc: Record<string, (body: any) => any> = {}): Promise<Calls> {
  const calls: Calls = { rpc: {}, rest: [] };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/supabase\.co\/(rest|auth|functions|storage)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    const m = url.pathname.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/);
    if (m) {
      const name = m[1];
      let body: any = {};
      try { body = route.request().postDataJSON(); } catch { /* no body */ }
      (calls.rpc[name] ??= []).push(body);
      const h = rpc[name];
      if (h) {
        const out = h(body);
        if (out && out.__error) return json(route, 400, { message: out.__error, hint: out.hint ?? null, code: 'P0001' });
        return json(route, 200, out);
      }
      return json(route, 200, null);
    }
    calls.rest.push(url.pathname + url.search);
    if (url.pathname.endsWith('/rest/v1/menu_item')) return json(route, 200, MENU);
    if (url.pathname.includes('/auth/v1/')) return json(route, 401, { message: 'not signed in' });
    return json(route, 200, []);
  });
  // Realtime is a websocket; with nothing on the other end the app falls back to polling.
  await page.route(/supabase\.co\/realtime/, (route) => route.abort());
  return calls;
}

/** No sideways scrolling: the page is never wider than the screen. */
export async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
