/**
 * DEV-ONLY fixtures for the platform console, so the UI can be rendered and
 * reviewed without an admin login. Imported dynamically behind
 * `import.meta.env.DEV`, which Vite folds to `false` in production builds —
 * the branch and this chunk are dropped from the deployed bundle.
 */
import type { AdminOverview, AdminRestaurant, AuditRow, ConsoleApi, Credentials, Lifecycle } from './adminApi';
import { ConsoleError } from './adminApi';

const D = 864e5;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * D).toISOString();

let n = 0;
function r(
  name: string, city: string, lifecycle: Lifecycle, tier: string, endsIn: number | null,
  extra: Partial<AdminRestaurant> = {},
): AdminRestaurant {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const planStatus =
    lifecycle === 'trial_expired' ? 'trialing'
      : lifecycle === 'suspended' ? 'active'
      : lifecycle === 'lapsed' ? 'cancelled' : lifecycle;
  const ends = endsIn == null ? null : iso(endsIn);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id, name, slug, city, phone: '+91 98' + String(10000000 + n * 7919).slice(0, 8),
    address: `${12 + n}, MG Road, ${city}`,
    restaurant_status: lifecycle === 'suspended' ? 'suspended' : 'active',
    parent_id: null, parent_name: null, is_pilot: n % 5 === 0, is_complimentary: false,
    created_at: iso(-(n * 9 + 3)),
    own_plan_tier: tier, own_plan_status: planStatus,
    plan_tier: tier, plan_status: planStatus,
    trial_ends_at: lifecycle === 'trialing' || lifecycle === 'trial_expired' ? ends : iso(-(n * 9 + 3) + 30),
    grace_until: lifecycle === 'grace' ? ends : null,
    lifecycle,
    ends_at: lifecycle === 'trialing' || lifecycle === 'trial_expired' || lifecycle === 'grace' ? ends : null,
    owner: {
      user_id: `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`,
      name: ['Priya Nair', 'Arjun Mehta', 'Kavya Rao', 'Rohan Iyer', 'Meera Pillai', 'Vikram Shetty'][n % 6],
      username: slug.replace(/-/g, '.').slice(0, 24), member_role: 'owner',
      email: `owner${n}@${slug.split('-')[0] || 'cafe'}.in`,
      phone: '+91 90' + String(20000000 + n * 104729).slice(0, 8),
    },
    latest_subscription: lifecycle === 'trialing' && n % 2 ? null : {
      plan_id: tier, plan_name: tier.charAt(0).toUpperCase() + tier.slice(1),
      status: lifecycle === 'active' ? 'active' : lifecycle === 'lapsed' ? 'cancelled' : lifecycle === 'grace' ? 'halted' : 'authenticated',
      current_start: iso(-12), current_end: iso(18), next_charge_at: iso(18),
      updated_at: iso(-2), razorpay_subscription_id: `sub_Mock${n}Xy7Q`,
    },
    subscriptions: [
      { plan_id: tier, status: lifecycle === 'active' ? 'active' : 'authenticated', created_at: iso(-20), updated_at: iso(-2), current_end: iso(18) },
      ...(n % 3 === 0 ? [{ plan_id: 'basic', status: 'cancelled', created_at: iso(-80), updated_at: iso(-50), current_end: null }] : []),
    ],
    addons: n % 4 === 0 ? [{ addon_id: 'addon_pos', status: 'active', updated_at: iso(-5) }] : [],
    member_count: 1 + (n % 4), table_count: 6 + (n * 3) % 20, menu_item_count: 24 + (n * 11) % 90,
    orders_30d: lifecycle === 'suspended' ? 0 : (n * 37) % 410, revenue_30d: lifecycle === 'suspended' ? 0 : ((n * 37) % 410) * 412,
    last_order_at: lifecycle === 'suspended' ? iso(-40) : iso(-(n % 3) / 4),
    ...extra,
  };
}

export function mockOverview(): AdminOverview {
  n = 0;
  const restaurants = [
    r('Saffron Grove Kitchen', 'Bengaluru', 'active', 'growth', null),
    r('The Malabar Table', 'Kochi', 'trialing', 'trial', 3),
    r('Chai & Chaat Co.', 'Pune', 'trialing', 'trial', 19),
    r('Coastal Curry House', 'Mangaluru', 'active', 'enterprise', null),
    r('Dosa Republic', 'Chennai', 'trial_expired', 'trial', -4),
    r('Tandoor Tales', 'Delhi', 'grace', 'basic', 5),
    r('Biryani Bazaar', 'Hyderabad', 'suspended', 'growth', null),
    r('Green Leaf Café', 'Mysuru', 'trialing', 'trial', 1),
    r('Spice Route Bistro', 'Mumbai', 'active', 'basic', null),
    r('Udupi Express', 'Udupi', 'lapsed', 'basic', null),
    r('Rasoi by the Lake', 'Bhopal', 'trialing', 'trial', 27),
  ];
  restaurants.push(r('Namma Mess', 'Bengaluru', 'active', 'enterprise', null, { is_complimentary: true, latest_subscription: null, subscriptions: [] }));
  restaurants.push(r('Saffron Grove — Indiranagar', 'Bengaluru', 'active', 'growth', null, {
    parent_id: restaurants[0].id, parent_name: restaurants[0].name, owner: restaurants[0].owner,
  }));
  const count = (l: Lifecycle) => restaurants.filter((x) => x.lifecycle === l).length;
  return {
    generated_at: new Date().toISOString(),
    kpis: {
      total: restaurants.length,
      outlets: restaurants.filter((x) => x.parent_id).length,
      active: count('active'), complimentary: restaurants.filter((x) => x.is_complimentary).length, trialing: count('trialing'), trial_expired: count('trial_expired'),
      grace: count('grace'), suspended: count('suspended'),
      expiring_7d: restaurants.filter((x) =>
        (x.lifecycle === 'trialing' || x.lifecycle === 'grace') && x.ends_at &&
        new Date(x.ends_at).getTime() - Date.now() <= 7 * D).length,
      mrr_inr: 999 + 2999 + 499 + 300, pipeline_mrr_inr: 4995, paying_subscriptions: 3,
    },
    restaurants,
  };
}

// ── DEV mock API: the whole console works offline, nothing leaves the tab ──

const wait = (ms = 450) => new Promise((res) => setTimeout(res, ms));
const fakePassword = () => 'Mock-' + Math.random().toString(36).slice(2, 6) + '-Only-' + Math.random().toString(36).slice(2, 6);

/** Recompute lifecycle the way the server does, after a mock write. */
function relife(x: AdminRestaurant) {
  const now = Date.now();
  if (x.is_complimentary) { x.plan_status = 'active'; x.trial_ends_at = null; x.grace_until = null; }
  const ps = x.plan_status ?? 'trialing';
  x.lifecycle = x.restaurant_status === 'suspended' ? 'suspended'
    : ps === 'active' ? 'active'
    : ps === 'grace' && (!x.grace_until || Date.parse(x.grace_until) > now) ? 'grace'
    : ps === 'trialing' && (!x.trial_ends_at || Date.parse(x.trial_ends_at) > now) ? 'trialing'
    : ps === 'trialing' ? 'trial_expired' : 'lapsed';
  x.ends_at = ps === 'trialing' ? x.trial_ends_at : ps === 'grace' ? x.grace_until : null;
}

export function mockApi(): ConsoleApi {
  let state = mockOverview();
  const log: AuditRow[] = [];
  let seq = 1;
  const find = (id: string) => {
    const x = state.restaurants.find((y) => y.id === id);
    if (!x) throw new ConsoleError('No such restaurant');
    return x;
  };
  const audit = (action: string, id: string, before: unknown, after: unknown) => {
    log.unshift({ id: seq++, actor_email: 'menutha45@gmail.com', action, target_type: 'restaurant', target_id: id,
      before: before as AuditRow['before'], after: after as AuditRow['after'], at: new Date().toISOString() });
  };
  const snap = (x: AdminRestaurant) => ({ plan_tier: x.plan_tier, plan_status: x.plan_status, trial_ends_at: x.trial_ends_at,
    status: x.restaurant_status, is_complimentary: x.is_complimentary });
  const kpis = () => {
    const rs = state.restaurants;
    const c = (l: Lifecycle) => rs.filter((x) => x.lifecycle === l).length;
    state.kpis = { ...state.kpis, total: rs.length, active: c('active'), trialing: c('trialing'), trial_expired: c('trial_expired'),
      grace: c('grace'), suspended: c('suspended'), complimentary: rs.filter((x) => x.is_complimentary).length,
      expiring_7d: rs.filter((x) => (x.lifecycle === 'trialing' || x.lifecycle === 'grace') && x.ends_at && Date.parse(x.ends_at) - Date.now() <= 7 * D).length };
  };
  const change = async (id: string, action: string, fn: (x: AdminRestaurant) => void) => {
    await wait();
    const x = find(id); const before = snap(x);
    if (x.name.includes('Fail')) throw new ConsoleError('Mock failure: the server said no.');
    fn(x); relife(x); kpis(); audit(action, id, before, snap(x));
  };
  return {
    async fetchOverview() { await wait(250); return { ...state, generated_at: new Date().toISOString(), restaurants: state.restaurants.map((x) => ({ ...x })) }; },
    async fetchActivity() { await wait(250); return log.slice(); },
    setPlan: (id, tier, status) => change(id, 'restaurant.set_plan', (x) => {
      if (x.parent_id) throw new ConsoleError('This is an outlet — its plan is read from the parent restaurant. Change the parent instead.');
      if (x.is_complimentary && status !== 'active') throw new ConsoleError('This restaurant is complimentary (always active). Remove complimentary first.');
      x.plan_tier = tier; x.plan_status = status;
      x.grace_until = status === 'grace' ? new Date(Date.now() + 7 * D).toISOString() : null;
    }),
    extendTrial: (id, by) => change(id, 'restaurant.extend_trial', (x) => {
      if (x.is_complimentary) throw new ConsoleError('This restaurant is complimentary and never expires — there is no trial to extend.');
      const base = Math.max(Date.now(), x.trial_ends_at ? Date.parse(x.trial_ends_at) : 0);
      x.trial_ends_at = 'days' in by ? new Date(base + by.days * D).toISOString() : new Date(by.until).toISOString();
      if (x.plan_status !== 'active' && x.plan_status !== 'grace') x.plan_status = 'trialing';
    }),
    setComplimentary: (id, on, opts) => change(id, on ? 'restaurant.complimentary_on' : 'restaurant.complimentary_off', (x) => {
      x.is_complimentary = on;
      if (on) { x.plan_tier = opts?.tier ?? x.plan_tier; }
      else { x.plan_status = 'trialing'; x.trial_ends_at = new Date(Date.now() + (opts?.trialDays ?? 7) * D).toISOString(); }
    }),
    setStatus: (id, status) => change(id, status === 'suspended' ? 'restaurant.suspend' : 'restaurant.activate', (x) => { x.restaurant_status = status; }),
    async resetLogin(id) {
      await wait(); const x = find(id);
      audit('restaurant.login_reset', id, null, { user_id: x.owner?.user_id });
      return { username: x.owner?.username ?? null, password: fakePassword(), login_url: 'https://menutha.com/partner' } as Credentials;
    },
    async createRestaurant(input) {
      await wait(700);
      if (state.restaurants.some((x) => x.owner?.username === input.username)) throw new ConsoleError('That username is already taken. Choose another.');
      const x = r(input.restaurant_name, input.city, input.complimentary ? 'active' : 'trialing', input.tier, input.complimentary ? null : 30, {
        is_complimentary: input.complimentary, latest_subscription: null, subscriptions: [], addons: [], orders_30d: 0, revenue_30d: 0,
        last_order_at: null, created_at: new Date().toISOString(), member_count: 1, table_count: 1, menu_item_count: 0,
      });
      x.owner = { user_id: 'mock-user', name: input.owner_name, username: input.username, member_role: 'owner', email: null, phone: input.phone || null };
      relife(x);
      state = { ...state, restaurants: [x, ...state.restaurants] }; kpis();
      audit('restaurant.create', x.id, null, snap(x));
      return { username: input.username, password: fakePassword(), login_url: 'https://menutha.com/partner', restaurant_id: x.id };
    },
  };
}
