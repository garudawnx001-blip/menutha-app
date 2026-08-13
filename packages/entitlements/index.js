/**
 * Menutha feature gating — shared, framework-free (plain ESM, no build step).
 * Single runtime source of truth for what a restaurant's plan unlocks, used by
 * Menutha Web (portal + customer flows) and, later, the customer app.
 *
 * Rules (see MODULE 1 spec):
 *  - Active trial = full Growth features.
 *  - Payment failure → 'grace' (7 days, features keep working, banner shown)
 *    → after grace_until, soft lock: menus stay visible, ordering disabled.
 *  - 'locked' / 'cancelled' (with no active trial) = no paid features + no ordering.
 */

export const TIER_FEATURES = {
  basic: [
    'qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set',
  ],
  growth: [
    'qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme',
    'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload',
  ],
  enterprise: [
    'qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme',
    'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload',
    'multi_location', 'white_label', 'dedicated_manager', 'priority_support',
  ],
};

export const ADDON_FEATURES = {
  addon_pos: ['pos_integration'],
  addon_marketing: ['marketing_toolkit'],
};

export const GRACE_DAYS = 7;

const toTime = (v) => (v ? new Date(v).getTime() : null);

/**
 * Compute the effective entitlements for a restaurant.
 * @param {object} r - restaurant-ish record:
 *   { plan_tier, plan_status, trial_ends_at, grace_until, addons?: string[] }
 * @param {number} [now] - ms epoch (injectable for tests)
 * @returns {{ tier: string, state: 'trial'|'active'|'grace'|'locked',
 *            canOrder: boolean, features: Set<string>,
 *            trialEndsAt: number|null, graceUntil: number|null }}
 */
export function entitlementsFor(r, now = Date.now()) {
  const status = r?.plan_status || 'trialing';
  const trialEndsAt = toTime(r?.trial_ends_at);
  const graceUntil = toTime(r?.grace_until);
  const addons = Array.isArray(r?.addons) ? r.addons : [];

  const trialLive = status === 'trialing' && (trialEndsAt === null || trialEndsAt > now);
  const graceLive = status === 'grace' && graceUntil !== null && graceUntil > now;

  let state;
  let tier;
  if (status === 'active') {
    state = 'active';
    tier = TIER_FEATURES[r?.plan_tier] ? r.plan_tier : 'basic';
  } else if (trialLive) {
    state = 'trial';
    tier = 'growth'; // trial = full Growth
  } else if (graceLive) {
    state = 'grace';
    tier = TIER_FEATURES[r?.plan_tier] ? r.plan_tier : 'basic';
  } else {
    state = 'locked'; // expired trial, exhausted grace, cancelled, or locked
    tier = 'none';
  }

  const features = new Set(state === 'locked' ? [] : TIER_FEATURES[tier] ?? []);
  if (state !== 'locked') {
    for (const a of addons) for (const f of ADDON_FEATURES[a] ?? []) features.add(f);
  }

  return { tier, state, canOrder: state !== 'locked', features, trialEndsAt, graceUntil };
}

/**
 * @param {ReturnType<typeof entitlementsFor>} ent
 * @param {string} feature
 */
export function hasFeature(ent, feature) {
  return ent.features.has(feature);
}

/**
 * Webhook → local state transitions (mirrored by the razorpay-webhook Edge
 * Function; kept here so the exact table is unit-tested in Node CI).
 * @param {string} eventType - e.g. 'subscription.charged'
 * @param {{ plan_id?: string }} sub - the local subscription row (plan id known)
 * @param {number} [now]
 * @returns {null | { subStatus: string, restaurant: { plan_tier?: string, plan_status: string, grace_until: string|null } }}
 */
export function applySubscriptionEvent(eventType, sub, now = Date.now()) {
  const tier = sub?.plan_id && TIER_FEATURES[sub.plan_id] ? sub.plan_id : 'basic';
  switch (eventType) {
    case 'subscription.authenticated':
      return { subStatus: 'authenticated',
        restaurant: { plan_tier: tier, plan_status: 'active', grace_until: null } };
    case 'subscription.activated':
      return { subStatus: 'active',
        restaurant: { plan_tier: tier, plan_status: 'active', grace_until: null } };
    case 'subscription.charged':
      return { subStatus: 'active',
        restaurant: { plan_tier: tier, plan_status: 'active', grace_until: null } };
    case 'subscription.pending': // payment being retried by Razorpay
      return { subStatus: 'pending',
        restaurant: { plan_tier: tier, plan_status: 'grace',
          grace_until: new Date(now + GRACE_DAYS * 864e5).toISOString() } };
    case 'subscription.halted': // retries exhausted
      return { subStatus: 'halted',
        restaurant: { plan_tier: tier, plan_status: 'grace',
          grace_until: new Date(now + GRACE_DAYS * 864e5).toISOString() } };
    case 'subscription.cancelled':
      return { subStatus: 'cancelled',
        restaurant: { plan_status: 'cancelled', grace_until: null } };
    case 'subscription.completed':
      return { subStatus: 'completed',
        restaurant: { plan_status: 'cancelled', grace_until: null } };
    default:
      return null; // unhandled event types are recorded but change nothing
  }
}
