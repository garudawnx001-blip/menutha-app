import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entitlementsFor,
  needsBilling,
  hasFeature,
  outletLimit,
  applySubscriptionEvent,
  GRACE_DAYS,
} from './index.js';

const NOW = Date.parse('2026-08-01T12:00:00Z');
const DAY = 864e5;

// ── Gating matrix ──────────────────────────────────────────────────────────

const trialing = (extra) => ({
  plan_status: 'trialing',
  trial_ends_at: new Date(NOW + 5 * DAY).toISOString(),
  has_mandate: true,
  ...extra,
});

test('a trial runs at the tier they chose, not at the best one we have', () => {
  // The rule, stated once: a trial is the paid product with the money switched
  // off. It used to be a blanket Enterprise for everyone, which meant a Basic
  // sign-up spent thirty days with Analytics and white-label and then lost
  // both on the day we first charged them -- a downgrade they never asked for,
  // arriving as the product breaking.
  for (const tier of ['basic', 'growth', 'enterprise']) {
    const e = entitlementsFor(trialing({ plan_tier: tier }), NOW);
    assert.equal(e.state, 'trial', tier + ' should be trialing');
    assert.equal(e.tier, tier);
    assert.ok(e.canOrder);
    // and exactly the paid set for that tier, nothing more
    const paid = entitlementsFor({ plan_status: 'active', plan_tier: tier }, NOW);
    assert.deepEqual([...e.features].sort(), [...paid.features].sort());
  }
});

test('a trial NEVER resolves to a tier above the one chosen', () => {
  // The property the whole change exists to hold. Anything unrecognised --
  // the literal 'trial' default on a fresh restaurant row, a typo, a tier
  // written by some future plan we have not taught this file about -- lands on
  // the LOWEST tier. An unknown purchase resolving upward is how a trial
  // silently becomes free Enterprise.
  for (const bad of [undefined, null, 'trial', 'ENTERPRISE', 'platinum', '', 0]) {
    const e = entitlementsFor(trialing({ plan_tier: bad }), NOW);
    assert.equal(e.tier, 'basic', 'plan_tier ' + JSON.stringify(bad) + ' must fall back to basic');
    assert.ok(!hasFeature(e, 'white_label'), 'and must not carry Enterprise features');
    assert.ok(!hasFeature(e, 'analytics'), 'nor Growth ones');
  }
});

test('a Basic trial is Basic: no excel_upload, no analytics, ordering on', () => {
  const e = entitlementsFor(trialing({ plan_tier: 'basic' }), NOW);
  assert.ok(hasFeature(e, 'qr_ordering'));
  assert.ok(hasFeature(e, 'billing'));
  assert.ok(!hasFeature(e, 'excel_upload'));
  assert.ok(!hasFeature(e, 'analytics'));
  assert.ok(e.canOrder);
});

test('an Enterprise trial still gets the whole product', () => {
  const e = entitlementsFor(trialing({ plan_tier: 'enterprise' }), NOW);
  assert.ok(hasFeature(e, 'white_label'));
  assert.ok(hasFeature(e, 'multi_outlet'));
  assert.ok(hasFeature(e, 'reservations'));
  assert.ok(hasFeature(e, 'excel_upload'));
});

test('location is on every tier, and off when locked', () => {
  for (const tier of ['basic', 'growth', 'enterprise']) {
    const e = entitlementsFor({ plan_status: 'active', plan_tier: tier }, NOW);
    assert.ok(hasFeature(e, 'location'), `${tier} should have location`);
  }
  const locked = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW - DAY).toISOString() }, NOW,
  );
  assert.ok(!hasFeature(locked, 'location'));
});

test('outlet limit: one everywhere except Enterprise', () => {
  assert.equal(outletLimit(entitlementsFor({ plan_status: 'active', plan_tier: 'basic' }, NOW)), 1);
  assert.equal(outletLimit(entitlementsFor({ plan_status: 'active', plan_tier: 'growth' }, NOW)), 1);
  assert.equal(outletLimit(entitlementsFor({ plan_status: 'active', plan_tier: 'enterprise' }, NOW)), Infinity);
  // A trial follows its chosen tier here too: an Enterprise trial may open
  // outlets, a Basic one may not. Under the blanket Enterprise trial, a Basic
  // sign-up could create outlets it would lose on day 30.
  const trialAt = (plan_tier) => outletLimit(entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW + DAY).toISOString(),
      has_mandate: true, plan_tier }, NOW));
  assert.equal(trialAt('enterprise'), Infinity);
  assert.equal(trialAt('basic'), 1);
  assert.equal(trialAt('growth'), 1);
  assert.equal(trialAt(undefined), 1, 'no plan chosen must not unlock outlets');
});

test('each tier contains the one below it', () => {
  const of = (t) => entitlementsFor({ plan_status: 'active', plan_tier: t }, NOW).features;
  const [basic, growth, ent] = [of('basic'), of('growth'), of('enterprise')];
  for (const f of basic) assert.ok(growth.has(f), `growth is missing ${f}`);
  for (const f of growth) assert.ok(ent.has(f), `enterprise is missing ${f}`);
});

test('null trial_ends_at means no trial was ever started, not an endless one', () => {
  // v1 read this as unlimited, from when there was no billing to run out of.
  // Under the hard gate that is a hole: any restaurant row created outside the
  // sign-up RPC has no trial_ends_at and would have drawn permanent free
  // Enterprise without ever seeing a plan.
  const e = entitlementsFor({ plan_status: 'trialing', trial_ends_at: null }, NOW);
  assert.equal(e.state, 'locked');
  assert.equal(e.features.size, 0);
  assert.ok(!e.canOrder);
});

test('a live trial with no mandate is `setup` -- gated, not trialing', () => {
  // The thirty days are real and ticking, but nothing is armed to charge on
  // day thirty. This is what production did to every new sign-up.
  const e = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW + 10 * DAY).toISOString() },
    NOW,
  );
  assert.equal(e.state, 'setup');
  assert.equal(e.features.size, 0);
  assert.ok(!e.canOrder);
  assert.ok(needsBilling(e));
});

test('the same trial WITH a mandate is a real trial', () => {
  const e = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW + 10 * DAY).toISOString(),
      has_mandate: true },
    NOW,
  );
  assert.equal(e.state, 'trial');
  assert.ok(e.canOrder);
  assert.ok(!needsBilling(e));
});

test('omitting has_mandate gates rather than grants', () => {
  // The safety property of the whole change: a caller that forgets to pass it
  // fails CLOSED. Loud (a screen nobody can pass) rather than silent (free
  // Enterprise for anyone the update missed).
  const forgot = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW + DAY).toISOString() }, NOW);
  assert.ok(needsBilling(forgot));
  // And nothing but an explicit true counts.
  for (const v of [1, 'yes', {}, null, undefined]) {
    const e = entitlementsFor(
      { plan_status: 'trialing', trial_ends_at: new Date(NOW + DAY).toISOString(),
        has_mandate: v }, NOW);
    assert.ok(needsBilling(e), `has_mandate: ${String(v)} must not unlock`);
  }
});

test('an active subscription never needs the mandate flag', () => {
  // `active` means Razorpay has charged, so the mandate exists by definition.
  // Requiring the flag here would lock out every paying restaurant.
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'growth' }, NOW);
  assert.equal(e.state, 'active');
  assert.ok(e.canOrder);
  assert.ok(!needsBilling(e));
});

test('expired trial with no subscription = locked, ordering off', () => {
  const e = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW - DAY).toISOString() },
    NOW,
  );
  assert.equal(e.state, 'locked');
  assert.equal(e.features.size, 0);
  assert.ok(!e.canOrder);
});

test('active Basic gets Basic only', () => {
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'basic' }, NOW);
  assert.equal(e.state, 'active');
  assert.ok(hasFeature(e, 'qr_ordering'));
  assert.ok(!hasFeature(e, 'excel_upload'));
  assert.ok(!hasFeature(e, 'analytics'));
});

test('active Growth unlocks excel_upload + multi_qr', () => {
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'growth' }, NOW);
  assert.ok(hasFeature(e, 'excel_upload'));
  assert.ok(hasFeature(e, 'multi_qr'));
  assert.ok(!hasFeature(e, 'white_label'));
});

test('active Enterprise unlocks white_label + multi_location', () => {
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'enterprise' }, NOW);
  assert.ok(hasFeature(e, 'white_label'));
  assert.ok(hasFeature(e, 'multi_location'));
  assert.ok(hasFeature(e, 'priority_support'));
});

test('add-ons stack on any tier', () => {
  const e = entitlementsFor(
    { plan_status: 'active', plan_tier: 'basic', addons: ['addon_pos', 'addon_marketing'] },
    NOW,
  );
  assert.ok(hasFeature(e, 'pos_integration'));
  assert.ok(hasFeature(e, 'marketing_toolkit'));
});

test('grace keeps features + ordering, with banner state', () => {
  const e = entitlementsFor(
    { plan_status: 'grace', plan_tier: 'growth', grace_until: new Date(NOW + 3 * DAY).toISOString() },
    NOW,
  );
  assert.equal(e.state, 'grace');
  assert.ok(hasFeature(e, 'excel_upload'));
  assert.ok(e.canOrder);
});

test('exhausted grace = soft lock (no features, no ordering)', () => {
  const e = entitlementsFor(
    { plan_status: 'grace', plan_tier: 'growth', grace_until: new Date(NOW - 1).toISOString() },
    NOW,
  );
  assert.equal(e.state, 'locked');
  assert.ok(!e.canOrder);
  assert.equal(e.features.size, 0);
});

test('cancelled with no trial = locked', () => {
  const e = entitlementsFor({ plan_status: 'cancelled', plan_tier: 'growth' }, NOW);
  assert.equal(e.state, 'locked');
  assert.ok(!e.canOrder);
});

// ── Webhook transitions (trial → paid → halted → grace → lock) ────────────

test('subscription.activated flips restaurant to active tier', () => {
  const t = applySubscriptionEvent('subscription.activated', { plan_id: 'growth' }, NOW);
  assert.equal(t.subStatus, 'active');
  assert.deepEqual(t.restaurant, { plan_tier: 'growth', plan_status: 'active', grace_until: null });
});

test('subscription.charged keeps active and clears grace', () => {
  const t = applySubscriptionEvent('subscription.charged', { plan_id: 'enterprise' }, NOW);
  assert.equal(t.restaurant.plan_status, 'active');
  assert.equal(t.restaurant.grace_until, null);
});

test('subscription.halted starts a 7-day grace window', () => {
  const t = applySubscriptionEvent('subscription.halted', { plan_id: 'growth' }, NOW);
  assert.equal(t.subStatus, 'halted');
  assert.equal(t.restaurant.plan_status, 'grace');
  assert.equal(Date.parse(t.restaurant.grace_until), NOW + GRACE_DAYS * DAY);
});

test('subscription.pending also protects with grace', () => {
  const t = applySubscriptionEvent('subscription.pending', { plan_id: 'basic' }, NOW);
  assert.equal(t.restaurant.plan_status, 'grace');
});

test('subscription.cancelled → cancelled (locked once trial gone)', () => {
  const t = applySubscriptionEvent('subscription.cancelled', { plan_id: 'growth' }, NOW);
  assert.equal(t.restaurant.plan_status, 'cancelled');
  const e = entitlementsFor({ plan_status: 'cancelled', plan_tier: 'growth' }, NOW);
  assert.equal(e.state, 'locked');
});

test('signing the mandate mid-trial does NOT end the trial', () => {
  // The zero-rupee authentication transaction. No money has moved, so the
  // thirty free days must survive it -- arming autopay on day one should not
  // start the clock on a subscription nobody has been charged for.
  const trialEnd = NOW + 30 * DAY;
  const t = applySubscriptionEvent('subscription.authenticated', { plan_id: 'basic' }, NOW, trialEnd);
  assert.equal(t.subStatus, 'authenticated');
  assert.equal(t.restaurant.plan_status, 'trialing');
  assert.equal(t.restaurant.plan_tier, 'basic', 'the chosen plan is still recorded');

  // And the trial that results runs at Basic -- the tier they picked, free.
  // Day 30 charges that same tier, so nothing changes but the balance.
  const e = entitlementsFor({ ...t.restaurant, trial_ends_at: new Date(trialEnd).toISOString(), has_mandate: true }, NOW);
  assert.equal(e.state, 'trial');
  assert.equal(e.tier, 'basic');
});

test('the trial tier and the first charge agree, for every tier', () => {
  // The whole point, end to end: what `authenticated` records is what the
  // trial runs at, and what a later charge activates. If those two ever
  // diverge, the owner experiences it as features vanishing on billing day.
  const trialEnd = NOW + 30 * DAY;
  for (const tier of ['basic', 'growth', 'enterprise']) {
    const auth = applySubscriptionEvent('subscription.authenticated', { plan_id: tier }, NOW, trialEnd);
    const during = entitlementsFor(
      { ...auth.restaurant, trial_ends_at: new Date(trialEnd).toISOString(), has_mandate: true }, NOW);
    const charged = applySubscriptionEvent('subscription.charged', { plan_id: tier }, trialEnd);
    const after = entitlementsFor(
      { ...charged.restaurant, trial_ends_at: new Date(trialEnd).toISOString(), has_mandate: true }, trialEnd + DAY);
    assert.equal(during.tier, tier);
    assert.equal(after.tier, tier);
    assert.deepEqual([...during.features].sort(), [...after.features].sort(),
      tier + ': the trial and the paid plan must grant the same thing');
  }
});

test('the same mandate AFTER the trial has lapsed does activate', () => {
  // A restaurant coming back. There is no trial left to protect, so
  // authenticating is the thing that revives the account.
  const t = applySubscriptionEvent('subscription.authenticated', { plan_id: 'growth' }, NOW, NOW - DAY);
  assert.equal(t.restaurant.plan_status, 'active');
  assert.equal(t.restaurant.plan_tier, 'growth');
});

test('unknown event types change nothing', () => {

  assert.equal(applySubscriptionEvent('payment.captured', { plan_id: 'growth' }, NOW), null);
});

test('full lifecycle: trial → paid → halted → grace → lock', () => {
  // has_mandate: the lifecycle starts AFTER the owner armed autopay, which is
  // now the only way a trial runs at all.
  let r = { plan_status: 'trialing', trial_ends_at: new Date(NOW + 2 * DAY).toISOString(),
            has_mandate: true };
  assert.equal(entitlementsFor(r, NOW).state, 'trial');

  const paid = applySubscriptionEvent('subscription.activated', { plan_id: 'growth' }, NOW);
  r = { ...r, ...paid.restaurant };
  assert.equal(entitlementsFor(r, NOW).state, 'active');

  const halted = applySubscriptionEvent('subscription.halted', { plan_id: 'growth' }, NOW + 30 * DAY);
  r = { ...r, ...halted.restaurant };
  assert.equal(entitlementsFor(r, NOW + 31 * DAY).state, 'grace');
  assert.equal(entitlementsFor(r, NOW + 30 * DAY + (GRACE_DAYS + 1) * DAY).state, 'locked');
});
