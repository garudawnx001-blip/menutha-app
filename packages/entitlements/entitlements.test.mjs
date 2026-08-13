import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entitlementsFor,
  hasFeature,
  applySubscriptionEvent,
  GRACE_DAYS,
} from './index.js';

const NOW = Date.parse('2026-08-01T12:00:00Z');
const DAY = 864e5;

// ── Gating matrix ──────────────────────────────────────────────────────────

test('active trial grants full Growth', () => {
  const e = entitlementsFor(
    { plan_status: 'trialing', trial_ends_at: new Date(NOW + 5 * DAY).toISOString() },
    NOW,
  );
  assert.equal(e.state, 'trial');
  assert.equal(e.tier, 'growth');
  assert.ok(hasFeature(e, 'excel_upload'));
  assert.ok(hasFeature(e, 'analytics'));
  assert.ok(!hasFeature(e, 'white_label'));
  assert.ok(e.canOrder);
});

test('null trial_ends_at while trialing = unlimited (v1 semantics)', () => {
  const e = entitlementsFor({ plan_status: 'trialing', trial_ends_at: null }, NOW);
  assert.equal(e.state, 'trial');
  assert.ok(e.canOrder);
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

test('unknown event types change nothing', () => {
  assert.equal(applySubscriptionEvent('payment.captured', { plan_id: 'growth' }, NOW), null);
});

test('full lifecycle: trial → paid → halted → grace → lock', () => {
  let r = { plan_status: 'trialing', trial_ends_at: new Date(NOW + 2 * DAY).toISOString() };
  assert.equal(entitlementsFor(r, NOW).state, 'trial');

  const paid = applySubscriptionEvent('subscription.activated', { plan_id: 'growth' }, NOW);
  r = { ...r, ...paid.restaurant };
  assert.equal(entitlementsFor(r, NOW).state, 'active');

  const halted = applySubscriptionEvent('subscription.halted', { plan_id: 'growth' }, NOW + 30 * DAY);
  r = { ...r, ...halted.restaurant };
  assert.equal(entitlementsFor(r, NOW + 31 * DAY).state, 'grace');
  assert.equal(entitlementsFor(r, NOW + 30 * DAY + (GRACE_DAYS + 1) * DAY).state, 'locked');
});
