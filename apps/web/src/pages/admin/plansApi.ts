/**
 * PLANS, PRICES, OFFERS AND NOTICES — the console's data layer for
 * /admin/plans and /admin/offers.
 *
 * Same rules as adminApi.ts: every read and write is an admin RPC or an
 * admin-only edge function that re-checks is_platform_admin() itself. Nothing
 * here hides data or refuses an action on its own; the UI only draws.
 *
 *   admin_* RPCs     — read and edit the catalog, offers and notices
 *   admin-plans      — anything that must create a Razorpay plan (new price,
 *                      offer made ready). Razorpay first, database second.
 *   deliver-notice   — push + email for a broadcast
 *   send-email       — email status / retry
 */
import { consoleClient, ConsoleError } from './adminApi';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PriceRow {
  id: string;
  duration_months: number;
  price_inr: number;
  charge_inr: number | null;
  gst_pct: number;
  razorpay_plan_id: string | null;
  subscribers: number;
  history: { price_inr: number; charge_inr: number | null; gst_pct: number; effective_from: string; by: string | null; note: string | null }[];
}

export interface CatalogPlan {
  id: string;
  kind: 'tier' | 'addon';
  display_name: string;
  description: string | null;
  is_popular: boolean;
  is_active: boolean;
  features: string[];
  limits: Record<string, unknown>;
  sort_order: number;
  updated_at: string;
  restaurants: number;
  prices: PriceRow[];
}

export interface FeatureDef { key: string; label: string; hidden: boolean; sort_order: number }

export interface PlansOverview { plans: CatalogPlan[]; features: FeatureDef[] }

export interface PricePreview {
  plan_id: string; name: string; duration_months: number; kind: string; tier: string | null;
  old_price_inr: number; old_charge_inr: number | null; old_gst_pct: number;
  new_price_inr: number; new_charge_inr: number; new_gst_pct: number;
  subscribers_keep_old_price: number; restaurants_on_plan: number;
}

export type DiscountType = 'percent' | 'amount' | 'free_months';
export type CustomerScope = 'all' | 'new' | 'existing';

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  value: number;
  plan_tiers: string[] | null;
  restaurant_ids: string[] | null;
  restaurant_names: string[];
  customer_scope: CustomerScope;
  starts_at: string;
  ends_at: string | null;
  usage_limit: number | null;
  is_active: boolean;
  show_banner: boolean;
  banner_text: string | null;
  created_at: string;
  published_at: string | null;
  label: string;
  used: number;
  pending: number;
  plans: { plan_id: string; name: string; price_inr: number; charge_inr: number | null; final_price_inr: number; ready: boolean }[];
}

export interface CouponInput {
  id?: string;
  code: string;
  title: string;
  description: string;
  discount_type: DiscountType;
  value: number;
  plan_tiers: string[];          // empty = all plans
  restaurant_ids: string[];      // empty = all restaurants
  customer_scope: CustomerScope;
  starts_at: string;             // ISO
  ends_at: string;               // ISO or ''
  usage_limit: number | null;
  show_banner: boolean;
  banner_text: string;
}

export interface NoticePreview { restaurants: number; with_email: number; without_email: number; names: string[] }

export interface Broadcast {
  id: string; kind: string; source_type: string; source_id: string | null;
  title: string; body: string; audience_count: number; created_at: string; created_by_email: string | null;
  read_count: number;
  push_result: { devices?: number; sent?: number; error_count?: number; errors?: string[]; at?: string } | null;
  email: Record<string, number>;
}

export interface EmailStatus {
  configured: boolean; from: string; domain: string;
  counts: Record<string, number>;
  last: { status: string; last_error: string | null; updated_at: string } | null;
}

export type RazorpayMode = 'live' | 'test' | 'missing' | 'unknown';

export interface BroadcastInput {
  kind: 'plan_update' | 'price_update' | 'offer' | 'general';
  sourceType: 'plan' | 'coupon' | 'all';
  sourceId: string | null;
  title: string;
  body: string;
  link?: string;
}

export interface BroadcastResult {
  broadcast_id: string;
  restaurants: number;
  emails_queued: number;
  no_email: number;
  push?: { devices?: number; sent?: number; error_count?: number } | null;
  email?: { sent?: number; pending_domain?: number; not_configured?: number; failed?: number } | null;
  deliveryError?: string;
}

// ── Plumbing ───────────────────────────────────────────────────────────────

function rpcError(e: { message?: string; code?: string } | null): ConsoleError {
  if (e?.code === '42501') return new ConsoleError('You are no longer signed in as an admin.', true);
  if (!e?.message || /fetch|network/i.test(e.message)) return new ConsoleError('Could not reach the server. Check your connection and try again.');
  return new ConsoleError(e.message);
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await consoleClient().rpc(fn, args ?? {});
  if (error) throw rpcError(error);
  return data as T;
}

/** Call an admin edge function with the console session. 404 "not found" = not an admin. */
async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const c = consoleClient();
  const { data: s } = await c.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new ConsoleError('You are no longer signed in as an admin.', true);
  const { data, error } = await c.functions.invoke(name, { body, headers: { Authorization: `Bearer ${token}` } });
  if (error) {
    let msg = '';
    let status = 0;
    try {
      const ctx = (error as { context?: Response }).context;
      status = ctx?.status ?? 0;
      msg = ((await ctx?.json()) as { error?: string })?.error ?? '';
    } catch { /* not JSON */ }
    if (status === 404 && (!msg || msg === 'not found')) throw new ConsoleError('You are no longer signed in as an admin.', true);
    throw new ConsoleError(msg || 'Could not reach the server. Nothing was changed — try again.');
  }
  return data as T;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

// ── API ────────────────────────────────────────────────────────────────────

export const plansApi = {
  async overview(): Promise<PlansOverview> {
    const o = await rpc<PlansOverview>('admin_plans_overview');
    for (const p of o.plans) {
      for (const r of p.prices) {
        r.price_inr = Number(r.price_inr); r.gst_pct = Number(r.gst_pct);
        r.charge_inr = num(r.charge_inr); r.subscribers = Number(r.subscribers) || 0;
      }
      p.restaurants = Number(p.restaurants) || 0;
    }
    return o;
  },
  savePlan: (p: { id: string; display_name: string; description: string; is_popular: boolean; is_active: boolean; features: string[] }) =>
    rpc<{ plan: CatalogPlan; added: string[]; removed: string[]; restaurants: number }>('admin_save_plan', {
      p_id: p.id, p_display_name: p.display_name, p_description: p.description,
      p_is_popular: p.is_popular, p_is_active: p.is_active, p_features: p.features,
    }),
  pricePreview: (planId: string, price: number, gst: number) =>
    rpc<PricePreview>('admin_price_change_preview', { p_plan_id: planId, p_price: price, p_gst: gst }),
  changePrice: (planId: string, price: number, gst: number, dryRun = false) =>
    fn<{ razorpay_plan_id?: string; dry_run?: boolean; payload?: { period: string; interval: number; item: { amount: number } }; razorpay_mode: RazorpayMode }>(
      'admin-plans', { action: 'change_price', plan_id: planId, price_inr: price, gst_pct: gst, dry_run: dryRun }),
  async razorpayMode(): Promise<RazorpayMode> {
    try { return (await fn<{ razorpay_mode: RazorpayMode }>('admin-plans', { action: 'status' })).razorpay_mode; }
    catch (e) { if (e instanceof ConsoleError && e.denied) throw e; return 'unknown'; }
  },
  async emailStatus(): Promise<EmailStatus | null> {
    try { return await fn<EmailStatus>('send-email', { action: 'status' }); }
    catch (e) { if (e instanceof ConsoleError && e.denied) throw e; return null; }
  },
  retryEmails: (broadcastId?: string) =>
    fn<{ tried: number; sent: number; pending_domain: number; not_configured: number; failed: number }>(
      'send-email', { action: 'process', ...(broadcastId ? { broadcast_id: broadcastId } : {}) }),

  async coupons(): Promise<Coupon[]> {
    const list = await rpc<Coupon[]>('admin_list_coupons');
    for (const c of list) {
      c.value = Number(c.value); c.used = Number(c.used) || 0; c.pending = Number(c.pending) || 0;
      c.usage_limit = num(c.usage_limit);
      c.restaurant_names = c.restaurant_names ?? [];
      for (const p of c.plans ?? []) { p.price_inr = Number(p.price_inr); p.final_price_inr = Number(p.final_price_inr); p.charge_inr = num(p.charge_inr); }
    }
    return list;
  },
  saveCoupon: (c: CouponInput) => rpc<Coupon>('admin_save_coupon', { p: {
    ...(c.id ? { id: c.id } : {}),
    code: c.code, title: c.title, description: c.description,
    discount_type: c.discount_type, value: c.value,
    plan_tiers: c.plan_tiers, restaurant_ids: c.restaurant_ids,
    customer_scope: c.customer_scope, starts_at: c.starts_at, ends_at: c.ends_at,
    usage_limit: c.usage_limit ?? '', show_banner: c.show_banner, banner_text: c.banner_text,
  } }),
  setCouponActive: (id: string, on: boolean) => rpc<Coupon>('admin_set_coupon_active', { p_id: id, p_on: on }),
  prepareOffer: (id: string, code: string, dryRun = false) =>
    fn<{ prepared?: number; dry_run?: boolean; plans?: { plan_id: string; charge_inr: number; payload: { period: string; interval: number } }[]; razorpay_mode: RazorpayMode }>(
      'admin-plans', { action: 'prepare_offer', coupon_id: id, code, dry_run: dryRun }),

  noticePreview: (sourceType: string, sourceId: string | null) =>
    rpc<NoticePreview>('admin_notice_preview', { p_source_type: sourceType, p_source_id: sourceId }),

  /**
   * Tell the affected restaurants. The in-app notices and the queued emails
   * are written in ONE database transaction first; push and email delivery
   * follow and can only fall short, never undo the notices.
   */
  async broadcast(b: BroadcastInput): Promise<BroadcastResult> {
    const r = await rpc<BroadcastResult>('admin_broadcast_notice', {
      p_kind: b.kind, p_source_type: b.sourceType, p_source_id: b.sourceId,
      p_title: b.title, p_body: b.body, p_link: b.link ?? '/partner/plan',
    });
    try {
      const d = await fn<{ push: BroadcastResult['push']; email: BroadcastResult['email'] }>('deliver-notice', { broadcast_id: r.broadcast_id });
      return { ...r, push: d.push, email: d.email };
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) throw e;
      return { ...r, deliveryError: e instanceof Error ? e.message : 'Push could not be sent.' };
    }
  },
  broadcasts: () => rpc<Broadcast[]>('admin_list_broadcasts'),
};

export type PlansApi = typeof plansApi;

// ── Words ──────────────────────────────────────────────────────────────────

export const DURATION_LABEL: Record<number, string> = { 1: 'Monthly', 3: '3 months', 6: '6 months', 12: '12 months' };
export const inrWhole = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN');
/** The database's own formula (plan_charge_for), for previews only. */
export const chargeFor = (price: number, gst: number) => Math.round((price * (100 + gst)) / 100);

export function offerLabel(type: DiscountType, value: number): string {
  if (type === 'percent') return `${value}% off every bill`;
  if (type === 'amount') return `₹${Math.round(value).toLocaleString('en-IN')} off every bill`;
  return `${value} extra month${value === 1 ? '' : 's'} free`;
}
