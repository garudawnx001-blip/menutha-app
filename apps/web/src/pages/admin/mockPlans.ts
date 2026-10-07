/** DEV-ONLY fixtures for /admin/plans and /admin/offers under ?mock (same
 *  pattern as mockOverview.ts). Imported dynamically only when mocked, so the
 *  production bundle never loads this chunk's data. */
import type { Coupon, PlansOverview } from './plansApi';

const BASIC = ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set', 'billing', 'upi_payments', 'basic_reports', 'location', 'single_outlet'];
const GROWTH = [...BASIC, 'table_chat', 'reservations', 'notifications', 'staff_roles', 'detailed_reports', 'pdf_export', 'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload'];
const ENT = [...GROWTH, 'multi_outlet', 'unlimited_tables', 'marketing_tools', 'priority_support', 'multi_location', 'white_label', 'dedicated_manager'];

const LABELS: [string, string, boolean?][] = [
  ['qr_ordering', 'Diners scan a QR and order from their phone'], ['dynamic_menu', 'Change your menu any time, live'],
  ['instant_price_edit', 'Change prices instantly'], ['basic_theme', 'Your colours on the menu'],
  ['single_qr_set', 'One set of table QR codes'], ['billing', 'Bills with GST, ready to print'],
  ['upi_payments', 'Diners pay your UPI directly'], ['basic_reports', "Today's sales, orders and top dishes"],
  ['location', 'Map pin and directions for diners'], ['single_outlet', 'One restaurant address'],
  ['table_chat', 'Chat with tables'], ['reservations', 'Table reservations'], ['notifications', 'Order and request alerts on your phone'],
  ['staff_roles', 'Staff logins with roles'], ['detailed_reports', 'Detailed sales reports'], ['pdf_export', 'Download reports as PDF'],
  ['analytics', 'Sales charts and trends'], ['multi_language', 'Menu in more than one language'], ['inventory_alerts', 'Low-stock alerts'],
  ['multi_qr', 'Separate QR sets (bar, dining, rooftop)'], ['excel_upload', 'Upload your menu from Excel'],
  ['multi_outlet', 'Many outlets under one plan'], ['unlimited_tables', 'Unlimited tables'], ['marketing_tools', 'Marketing tools'],
  ['priority_support', 'Priority support'], ['multi_location', 'Multiple locations (older name for many outlets)', true],
  ['white_label', 'Your own branding, without the Menutha name'], ['dedicated_manager', 'A dedicated account manager'],
  ['pos_integration', 'Connect your POS (Petpooja, Vyapar, DotPe)'], ['marketing_toolkit', 'SMS and WhatsApp marketing'],
];

const row = (id: string, m: number, price: number, charge: number, subs = 0) => ({
  id, duration_months: m, price_inr: price, charge_inr: charge, gst_pct: 18, razorpay_plan_id: 'plan_mock' + id,
  subscribers: subs, paying: Math.floor(subs / 2), autopay_set_up: subs - Math.floor(subs / 2), history: [{ price_inr: price, charge_inr: charge, gst_pct: 18, effective_from: '2026-10-08T00:00:00Z', by: null, note: 'Price when the history started' }],
});

export function mockPlans(): PlansOverview {
  return {
    features: LABELS.map(([key, label, hidden], i) => ({ key, label, hidden: !!hidden, sort_order: i })),
    plans: [
      { id: 'basic', kind: 'tier', display_name: 'Basic', description: 'Everything to take QR orders and bill at one restaurant.', is_popular: false, is_active: true,
        features: BASIC, limits: {}, sort_order: 1, updated_at: '2026-10-08T00:00:00Z', restaurants: 1,
        prices: [row('basic', 1, 499, 589), row('basic_3m', 3, 1422, 1678), row('basic_6m', 6, 2695, 3180), row('basic_12m', 12, 4790, 5652)] },
      { id: 'growth', kind: 'tier', display_name: 'Growth', description: 'For a busy restaurant: table chat, reservations, staff logins, reports and Excel menu upload.', is_popular: true, is_active: true,
        features: GROWTH, limits: {}, sort_order: 2, updated_at: '2026-10-08T00:00:00Z', restaurants: 7,
        prices: [row('growth', 1, 999, 1179, 5), row('growth_3m', 3, 2847, 3359), row('growth_6m', 6, 5395, 6366), row('growth_12m', 12, 9590, 11316)] },
      { id: 'enterprise', kind: 'tier', display_name: 'Enterprise', description: 'For groups: many outlets, your own branding and a dedicated manager.', is_popular: false, is_active: true,
        features: ENT, limits: {}, sort_order: 3, updated_at: '2026-10-08T00:00:00Z', restaurants: 0,
        prices: [row('enterprise', 1, 2999, 3539), row('enterprise_3m', 3, 8547, 10085), row('enterprise_6m', 6, 16195, 19110), row('enterprise_12m', 12, 28790, 33972)] },
      { id: 'addon_pos', kind: 'addon', display_name: 'POS Integration Module', description: 'Send Menutha orders straight to your billing software.', is_popular: false, is_active: true,
        features: ['pos_integration'], limits: {}, sort_order: 10, updated_at: '2026-10-08T00:00:00Z', restaurants: 0, prices: [{ ...row('addon_pos', 1, 300, 354), razorpay_plan_id: null }] },
    ],
  };
}

export function mockCoupons(): Coupon[] {
  return [
    { id: 'c1', code: 'WELCOME2', title: 'Two extra months free', description: 'For restaurants joining this month.',
      discount_type: 'free_months', value: 2, plan_tiers: null, restaurant_ids: null, restaurant_names: [], customer_scope: 'new',
      starts_at: '2026-10-08T00:00:00Z', ends_at: '2026-10-31T23:59:00Z', usage_limit: 50, is_active: true, show_banner: true,
      banner_text: 'Join in October: 2 extra months free', created_at: '2026-10-08T00:00:00Z', published_at: '2026-10-08T00:00:00Z',
      label: '2 extra months free', used: 3, pending: 1, plans: [] },
    { id: 'c2', code: 'GROW20', title: '20% off Growth', description: null,
      discount_type: 'percent', value: 20, plan_tiers: ['growth'], restaurant_ids: null, restaurant_names: [], customer_scope: 'all',
      starts_at: '2026-10-08T00:00:00Z', ends_at: null, usage_limit: null, is_active: false, show_banner: false, banner_text: null,
      created_at: '2026-10-08T00:00:00Z', published_at: null, label: '20% off every bill', used: 0, pending: 0,
      plans: [{ plan_id: 'growth', name: 'Growth', price_inr: 999, charge_inr: 1179, final_price_inr: 799, ready: false },
              { plan_id: 'growth_3m', name: 'Growth · 3 months', price_inr: 2847, charge_inr: 3359, final_price_inr: 2278, ready: false }] },
  ];
}
