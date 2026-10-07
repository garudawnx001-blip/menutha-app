/**
 * PLATFORM CONSOLE — data layer.
 *
 * AN ISOLATED SUPABASE CLIENT, deliberately not the one in lib/supabase.
 *
 * The shared client is created eagerly, persists the partner-portal session,
 * and reads OAuth tokens out of the URL (implicit flow). If the console used
 * it, a Google return to /admin would land in the partner session, and
 * signing a non-admin out of the console would also sign them out of their
 * restaurant portal.
 *
 * So the console has its own client:
 *   - its own storageKey  -> its session never mixes with the portal's;
 *   - PKCE flow           -> Google comes back as /admin?code=..., which the
 *                            shared implicit client ignores.
 *
 * Every read and write goes through SECURITY DEFINER RPCs (or the
 * admin-accounts edge function) that call is_platform_admin() first; nothing
 * here is trusted to hide data or refuse an action. The UI only decides what
 * to draw.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://xnhcziciilylzcaupqoq.supabase.co';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_zmrlV7bkDZ_cJiIHxd0Slg_0H192fIe';

let client: SupabaseClient | null = null;

export function consoleClient(): SupabaseClient {
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        storageKey: 'menutha-console-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

// ── Types: mirror public.admin_list_restaurants() ─────────────────────────

export type Lifecycle = 'active' | 'trialing' | 'trial_expired' | 'grace' | 'suspended' | 'lapsed';
export type Tier = 'basic' | 'growth' | 'enterprise';
export const TIERS: Tier[] = ['basic', 'growth', 'enterprise'];
export type PlanStatus = 'trialing' | 'active' | 'grace' | 'cancelled';

export interface AdminSubscription {
  plan_id: string | null;
  plan_name?: string | null;
  status: string | null;
  current_start?: string | null;
  current_end: string | null;
  next_charge_at?: string | null;
  created_at?: string | null;
  updated_at: string | null;
  razorpay_subscription_id?: string | null;
  /** Razorpay has taken at least one real payment on it. */
  charged?: boolean;
}

/**
 * How a restaurant is billed (from its payer), so "Active" can say which kind:
 *   complimentary  free forever, given by an admin
 *   paying         live autopay that Razorpay has charged at least once
 *   autopay_set_up live autopay, first charge not taken yet
 *   not_billed     switched to Active by an admin, no autopay (paid outside Razorpay)
 *   none           anything else
 */
export type Billing = 'complimentary' | 'paying' | 'autopay_set_up' | 'not_billed' | 'none';

export interface AdminOwner {
  user_id: string;
  name: string | null;
  username?: string | null;
  member_role?: string | null;
  email: string | null;
  phone: string | null;
}

export interface AdminRestaurant {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  phone: string | null;
  address: string | null;
  restaurant_status: string | null;
  parent_id: string | null;
  parent_name: string | null;
  is_pilot: boolean | null;
  is_complimentary: boolean;
  created_at: string;
  own_plan_tier: string | null;
  own_plan_status: string | null;
  plan_tier: string | null;
  plan_status: string | null;
  trial_ends_at: string | null;
  grace_until: string | null;
  lifecycle: Lifecycle;
  billing?: Billing;
  ends_at: string | null;
  owner: AdminOwner | null;
  latest_subscription: AdminSubscription | null;
  subscriptions: AdminSubscription[];
  addons: { addon_id: string; status: string; updated_at: string | null }[];
  member_count: number;
  table_count: number;
  menu_item_count: number;
  orders_30d: number;
  revenue_30d: number;
  last_order_at: string | null;
}

export interface AdminKpis {
  total: number;
  outlets: number;
  active: number;
  complimentary: number;
  trialing: number;
  trial_expired: number;
  grace: number;
  suspended: number;
  expiring_7d: number;
  mrr_inr: number;
  pipeline_mrr_inr: number;
  /** Restaurants Razorpay has actually charged (not subscription rows). */
  paying_subscriptions: number;
  /** Restaurants with autopay set up, no charge yet. */
  autopay_set_up?: number;
  /** "Active" split by how it is billed; the four always add up to `active`. */
  active_complimentary?: number;
  active_paying?: number;
  active_autopay?: number;
  active_not_billed?: number;
}

export interface AdminOverview {
  generated_at: string;
  kpis: AdminKpis;
  restaurants: AdminRestaurant[];
}

export interface AuditRow {
  id: number;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

/** What "Create restaurant account" / "Reset login" hand back — ONCE. */
export interface Credentials {
  username: string | null;
  password: string;
  login_url: string;
  restaurant_id?: string;
  name?: string | null;
}

export interface NewRestaurantInput {
  restaurant_name: string;
  city: string;
  owner_name: string;
  phone: string;
  username: string;
  tier: Tier;
  complimentary: boolean;
}

/** What "Give more free days" reports back. */
export interface ExtendTrialResult {
  done: boolean;
  new_trial_end: string;
  /** True when the Razorpay autopay's first charge was moved too. */
  moved_autopay: boolean;
  replay?: boolean;
}

/** Everything the console can do. Real (Supabase) and DEV mock share it. */
export interface ConsoleApi {
  fetchOverview(): Promise<AdminOverview>;
  fetchActivity(): Promise<AuditRow[]>;
  setPlan(id: string, tier: Tier, status: PlanStatus): Promise<void>;
  extendTrial(id: string, by: { days: number } | { until: string }, key: string): Promise<ExtendTrialResult>;
  setComplimentary(id: string, on: boolean, opts?: { tier?: Tier; trialDays?: number }): Promise<void>;
  setStatus(id: string, status: 'active' | 'suspended'): Promise<void>;
  resetLogin(id: string): Promise<Credentials>;
  createRestaurant(input: NewRestaurantInput): Promise<Credentials>;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** An error the UI can show as-is. `denied` = no longer an admin. */
export class ConsoleError extends Error {
  constructor(message: string, public denied = false) { super(message); }
}

function rpcError(e: { message?: string; code?: string } | null): ConsoleError {
  if (e?.code === '42501') return new ConsoleError('You are no longer signed in as an admin.', true);
  if (!e?.message || /fetch|network/i.test(e.message)) return new ConsoleError('Could not reach the server. Check your connection and try again.');
  return new ConsoleError(e.message);
}

// ── Real implementation ────────────────────────────────────────────────────

async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await consoleClient().rpc(fn, args ?? {});
  if (error) throw rpcError(error);
  return data as T;
}

async function accountsFn(body: Record<string, unknown>): Promise<Credentials> {
  return edgeFn<Credentials>('admin-accounts', body);
}

async function edgeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const c = consoleClient();
  const { data: s } = await c.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new ConsoleError('You are no longer signed in as an admin.', true);
  const { data, error } = await c.functions.invoke(name, {
    body, headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    let msg = '';
    let status = 0;
    try {
      const ctx = (error as { context?: Response }).context;
      status = ctx?.status ?? 0;
      msg = ((await ctx?.json()) as { error?: string })?.error ?? '';
    } catch { /* body was not JSON */ }
    if (status === 404 && (!msg || msg === 'not found')) throw new ConsoleError('You are no longer signed in as an admin.', true);
    throw new ConsoleError(msg || 'Could not reach the server. Nothing was changed — try again.');
  }
  return data as T;
}

export const realApi: ConsoleApi = {
  async fetchOverview() {
    const o = await rpc<AdminOverview>('admin_list_restaurants');
    // numeric columns arrive as JSON numbers, but be defensive about strings
    o.kpis.mrr_inr = Number(o.kpis.mrr_inr) || 0;
    o.kpis.pipeline_mrr_inr = Number(o.kpis.pipeline_mrr_inr) || 0;
    o.kpis.complimentary = Number(o.kpis.complimentary) || 0;
    for (const r of o.restaurants) {
      r.revenue_30d = Number(r.revenue_30d) || 0;
      r.is_complimentary = r.is_complimentary === true;
    }
    return o;
  },
  async fetchActivity() {
    const { data, error } = await consoleClient()
      .from('admin_audit_log').select('*').order('at', { ascending: false }).limit(150);
    if (error) throw rpcError(error);
    return (data ?? []) as AuditRow[];
  },
  async setPlan(id, tier, status) { await rpc('admin_set_plan', { p_restaurant_id: id, p_tier: tier, p_status: status }); },
  /**
   * Goes through the admin-free-days edge function, not the RPC directly: for a
   * restaurant with autopay set up, the first Razorpay charge has to move to
   * the same date, and only the server holds the Razorpay key. `key` makes a
   * repeated press safe (the days are never added twice).
   */
  async extendTrial(id, by, key) {
    return edgeFn<ExtendTrialResult>('admin-free-days', 'days' in by
      ? { key, restaurant_id: id, days: by.days }
      : { key, restaurant_id: id, until: by.until });
  },
  async setComplimentary(id, on, opts) {
    await rpc('admin_set_complimentary', {
      p_restaurant_id: id, p_on: on, p_tier: opts?.tier ?? null, p_trial_days: opts?.trialDays ?? 7,
    });
  },
  async setStatus(id, status) { await rpc('admin_set_restaurant_status', { p_restaurant_id: id, p_status: status }); },
  resetLogin: (id) => accountsFn({ action: 'reset_login', restaurant_id: id }),
  createRestaurant: (input) => accountsFn({ action: 'create_restaurant', ...input }),
};

// ── Session calls (unchanged from phase 1) ─────────────────────────────────

/** True only for a platform admin. Anything else — including an error — is
 *  treated as "not an admin" by the caller, so a failure never opens a door. */
export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await consoleClient().rpc('is_platform_admin');
  if (error) throw error;
  return data === true;
}

/** Binds a pending admin row on first sign-in and writes the audit entry.
 *  Once per browser session per user, so a refresh is not a new sign-in. */
export async function startAdminSession(userId: string): Promise<void> {
  const key = `menutha-console-started:${userId}`;
  try { if (sessionStorage.getItem(key)) return; } catch { /* storage blocked: just log again */ }
  const { error } = await consoleClient().rpc('admin_session_start');
  if (error) throw error;
  try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
}
