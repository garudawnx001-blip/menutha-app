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

  /**
   * IS THE AUTOPAY MANDATE SIGNED? The caller reads it from `subscriptions`
   * and hands it in, because this function is pure and deliberately stays so.
   *
   * `=== true` RATHER THAN TRUTHY, and that is the whole safety property of
   * this file. A caller that forgets to pass it sends `undefined`, which
   * becomes false, which gates. A gate whose default is "open" is not a gate
   * -- it is a gate-shaped thing that lets through exactly the callers nobody
   * remembered to update. So the omission fails closed and shows up as a
   * screen the owner cannot get past, which is loud, rather than as free
   * Enterprise access, which is silent.
   */
  const mandate = r?.has_mandate === true;

  /**
   * A TRIAL NEEDS A DATE. Null used to mean "unlimited" -- v1 semantics, from
   * when there was no billing to run out of. Under a hard gate that reading is
   * a hole big enough to drive the product through: any restaurant row created
   * outside the sign-up RPC has no trial_ends_at, and would have drawn
   * permanent free Enterprise without ever seeing a plan.
   *
   * Null now means what it says: no trial has been started.
   */
  const trialDated = trialEndsAt !== null && trialEndsAt > now;
  const trialLive = status === 'trialing' && trialDated;
  const graceLive = status === 'grace' && graceUntil !== null && graceUntil > now;

  let state;
  let tier;
  if (status === 'active') {
    state = 'active';
    tier = TIER_FEATURES[r?.plan_tier] ? r.plan_tier : 'basic';
  } else if (trialLive && mandate) {
    state = 'trial';
    tier = TRIAL_TIER;
  } else if (trialLive) {
    /**
     * A TRIAL RUNNING WITHOUT A MANDATE, which is the state this whole change
     * exists to name. The thirty days are real and ticking, but nothing has
     * been armed to charge on day thirty -- so left alone it is a countdown to
     * a silent lockout with no card on file. That is precisely what production
     * was doing to every new sign-up.
     *
     * Held apart from `locked` because the two are opposite messages. This one
     * is "start your free trial", before anything has been used; locked is
     * "your subscription ended", after. One screen saying both would be wrong
     * for whoever is reading it.
     */
    state = 'setup';
    tier = 'none';
  } else if (graceLive) {
    state = 'grace';
    tier = TIER_FEATURES[r?.plan_tier] ? r.plan_tier : 'basic';
  } else {
    state = 'locked';
    tier = 'none';
  }

  /**
   * `setup` AND `locked` ARE THE SAME ENTITLEMENT and differ only in what the
   * owner is told. Both hold nothing, and both leave the ability to look and
   * to subscribe -- the screens stay reachable, the features they gate do not.
   * Deriving them from one predicate keeps it impossible for a later edit to
   * grant `setup` something `locked` does not have.
   */
  const barred = state === 'setup' || state === 'locked';

  const features = new Set(barred ? [] : TIER_FEATURES[tier] ?? []);
  if (!barred) {
    for (const a of addons) for (const f of ADDON_FEATURES[a] ?? []) features.add(f);
  }

  return { tier, state, canOrder: !barred, features, trialEndsAt, graceUntil };
}

/**
 * THE ROUTING QUESTION, in one place so both surfaces cannot answer it
 * differently: must this restaurant be sent to the plan screen before it may
 * use anything?
 *
 * Exported rather than left as `state === 'setup' || state === 'locked'`
 * written out at each gate, because that expression repeated across two
 * surfaces is two places to forget a state when one is added.
 */
export function needsBilling(ent) {
  return ent?.state === 'setup' || ent?.state === 'locked';
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

export function applySubscriptionEvent(eventType, sub, now = Date.now(), trialEndsAt = null) {
  const tier = sub?.plan_id && TIER_FEATURES[sub.plan_id] ? sub.plan_id : 'basic';
  const trialRunning = trialEndsAt !== null && trialEndsAt > now;
  switch (eventType) {
    /**
     * THE MANDATE IS SIGNED, and no money has moved: this is the zero-rupee
     * authentication transaction, with the first real charge on day 30.
     *
     * Setting 'active' here used to END the free trial the moment the owner
     * armed autopay -- somebody on the Enterprise trial who picked Basic lost
     * Analytics and Excel upload about ten seconds after signing up, having
     * paid nothing and been told nothing. Arming a mandate is not the same
     * event as paying for a tier.
     *
     * plan_tier is still recorded: it is the plan they chose, and it is what
     * the first charge will activate. Only the STATUS waits.
     *
     * A lapsed restaurant re-subscribing has no trial left, and for them
     * authentication genuinely is the thing that revives the account.
     */
    case 'subscription.authenticated':
      return { subStatus: 'authenticated',
        restaurant: { plan_tier: tier,
          plan_status: trialRunning ? 'trialing' : 'active', grace_until: null } };
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
