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
 *                            shared implicit client ignores (it only acts on a
 *                            #access_token fragment, or on a ?code= whose PKCE
 *                            verifier sits in ITS storage — and this one's
 *                            verifier sits under the console's key).
 *
 * Every read goes through SECURITY DEFINER RPCs that call is_platform_admin()
 * first; nothing here is trusted to hide data. The UI only decides what to
 * draw.
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
  created_at: string;
  own_plan_tier: string | null;
  own_plan_status: string | null;
  plan_tier: string | null;
  plan_status: string | null;
  trial_ends_at: string | null;
  grace_until: string | null;
  lifecycle: Lifecycle;
  ends_at: string | null;
  owner: { user_id: string; name: string | null; email: string | null; phone: string | null } | null;
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
  trialing: number;
  trial_expired: number;
  grace: number;
  suspended: number;
  expiring_7d: number;
  mrr_inr: number;
  pipeline_mrr_inr: number;
  paying_subscriptions: number;
}

export interface AdminOverview {
  generated_at: string;
  kpis: AdminKpis;
  restaurants: AdminRestaurant[];
}

// ── Calls ─────────────────────────────────────────────────────────────────

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

export async function fetchOverview(): Promise<AdminOverview> {
  const { data, error } = await consoleClient().rpc('admin_list_restaurants');
  if (error) throw error;
  const o = data as AdminOverview;
  // numeric columns arrive as JSON numbers, but be defensive about strings
  o.kpis.mrr_inr = Number(o.kpis.mrr_inr) || 0;
  o.kpis.pipeline_mrr_inr = Number(o.kpis.pipeline_mrr_inr) || 0;
  for (const r of o.restaurants) r.revenue_30d = Number(r.revenue_30d) || 0;
  return o;
}
