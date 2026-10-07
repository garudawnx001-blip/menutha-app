/**
 * DEV-ONLY fixtures for the platform console, so the UI can be rendered and
 * reviewed without an admin login. Imported dynamically behind
 * `import.meta.env.DEV`, which Vite folds to `false` in production builds —
 * the branch and this chunk are dropped from the deployed bundle.
 */
import type { AdminOverview, AdminRestaurant, Lifecycle } from './adminApi';

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
    parent_id: null, parent_name: null, is_pilot: n % 5 === 0,
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
  restaurants.push(r('Saffron Grove — Indiranagar', 'Bengaluru', 'active', 'growth', null, {
    parent_id: restaurants[0].id, parent_name: restaurants[0].name, owner: restaurants[0].owner,
  }));
  const count = (l: Lifecycle) => restaurants.filter((x) => x.lifecycle === l).length;
  return {
    generated_at: new Date().toISOString(),
    kpis: {
      total: restaurants.length,
      outlets: restaurants.filter((x) => x.parent_id).length,
      active: count('active'), trialing: count('trialing'), trial_expired: count('trial_expired'),
      grace: count('grace'), suspended: count('suspended'),
      expiring_7d: restaurants.filter((x) =>
        (x.lifecycle === 'trialing' || x.lifecycle === 'grace') && x.ends_at &&
        new Date(x.ends_at).getTime() - Date.now() <= 7 * D).length,
      mrr_inr: 999 + 2999 + 499 + 300, pipeline_mrr_inr: 4995, paying_subscriptions: 3,
    },
    restaurants,
  };
}
