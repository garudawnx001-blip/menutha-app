/**
 * WHAT A RESTAURANT IS ALLOWED TO DO, in one place.
 *
 * This module is the only answer to "can they?" in the product. It is copied
 * into three places -- packages/entitlements in each repo, and mirrored into
 * apps/mobile/src/lib because Metro will not resolve outside apps/mobile --
 * and the copies MUST stay identical. Two implementations of this question
 * would disagree eventually, and the one nobody checked would be the one
 * deciding whether a diner can order.
 *
 * ── THE FOUR STATES ───────────────────────────────────────────────────────
 *
 *   trial    30 days from sign-up. FULL ENTERPRISE ACCESS, deliberately: the
 *            point of a trial is to try the product, and a restaurant that
 *            never sees reservations or chat cannot decide it wants them.
 *   active   the tier they actually pay for.
 *   grace    a charge failed. Everything keeps working for GRACE_DAYS while
 *            the banner asks them to renew -- a card that expired on a
 *            Saturday must not close the restaurant's ordering.
 *   locked   trial ran out, grace ran out, or they cancelled. They can still
 *            log in and see everything they own; ORDERING IS OFF and the only
 *            action offered is to subscribe. Nothing is deleted, ever.
 *
 * `locked` is the internal name for what the owner is shown as "expired" --
 * the word describes what it does to the product rather than to the invoice.
 *
 * ── THE TIERS ─────────────────────────────────────────────────────────────
 * Each tier is a superset of the one below it, built by spreading, so a
 * feature can never be in Growth and missing from Enterprise by a typo.
 */

/** Everything a paying restaurant gets at the entry price. */
const BASIC = [
  'qr_ordering',          // diners scan and order
  'dynamic_menu',         // live menu edits
  'instant_price_edit',
  'basic_theme',
  'single_qr_set',
  'billing',              // bills, GST, the printed sheet
  'upi_payments',         // diners pay the restaurant's own UPI
  'basic_reports',        // today's sales, orders, top dishes
  'location',             // the map pin -- EVERY tier, by decision
  'single_outlet',
];

/** Basic, plus the things a restaurant asks for once it is busy. */
const GROWTH = [
  ...BASIC,
  'table_chat',           // diner <-> restaurant messages
  'reservations',
  'notifications',        // push and the alerts feed
  'staff_roles',
  'detailed_reports',
  'pdf_export',
  // Long-standing keys the portal already gates on; they belong to the same
  // tier as the features above and are kept so existing gates keep working.
  'analytics',
  'multi_language',
  'inventory_alerts',
  'multi_qr',
  'excel_upload',
];

/** Growth, plus everything that only matters at more than one address. */
const ENTERPRISE = [
  ...GROWTH,
  'multi_outlet',         // unlimited outlets under one subscription
  'unlimited_tables',
  'marketing_tools',
  'priority_support',
  'multi_location',       // legacy alias for multi_outlet; kept for old gates
  'white_label',
  'dedicated_manager',
];

export const TIER_FEATURES = {
  basic: BASIC,
  growth: GROWTH,
  enterprise: ENTERPRISE,
};

export const ADDON_FEATURES = {
  addon_pos: ['pos_integration'],
  addon_marketing: ['marketing_toolkit'],
};

export const GRACE_DAYS = 7;

/** The tier a trial runs at. Enterprise, so the trial shows the whole
 *  product; see the note at the top. */
export const TRIAL_TIER = 'enterprise';

const toTime = (v) => (v ? new Date(v).getTime() : null);

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
    tier = TRIAL_TIER;
  } else if (graceLive) {
    state = 'grace';
    tier = TIER_FEATURES[r?.plan_tier] ? r.plan_tier : 'basic';
  } else {
    state = 'locked';
    tier = 'none';
  }

  // Locked keeps NOTHING except the ability to look and to subscribe. The
  // screens stay reachable; the features they gate do not.
  const features = new Set(state === 'locked' ? [] : TIER_FEATURES[tier] ?? []);
  if (state !== 'locked') {
    for (const a of addons) for (const f of ADDON_FEATURES[a] ?? []) features.add(f);
  }

  return { tier, state, canOrder: state !== 'locked', features, trialEndsAt, graceUntil };
}

export function hasFeature(ent, feature) {
  return ent.features.has(feature);
}

/**
 * How many outlets this restaurant may hold, INCLUDING itself.
 *
 * Enterprise is unlimited by decision; everything else is the one address
 * they signed up with. Returned as a number so a caller can say "3 of 3"
 * without a special case for infinity -- Infinity compares the way a limit
 * should and prints as "unlimited" where it is shown.
 */
export function outletLimit(ent) {
  return hasFeature(ent, 'multi_outlet') ? Infinity : 1;
}

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
    case 'subscription.pending':
      return { subStatus: 'pending',
        restaurant: { plan_tier: tier, plan_status: 'grace',
          grace_until: new Date(now + GRACE_DAYS * 864e5).toISOString() } };
    case 'subscription.halted':
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
      return null;
  }
}
