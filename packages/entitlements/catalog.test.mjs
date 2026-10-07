// Entitlements read from the database catalog (public.plan_catalog).
//
// LIVE_CATALOG is the exact `catalog` object production's get_plan_state
// returned on 2026-10-08, the day the source of truth moved to the database.
// The first test is the promise the move was made on: for every tier, every
// state and every add-on, the database gives the SAME answer the hard-coded
// lists gave. check-live-catalog.mjs runs the same comparison against the live
// project on demand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entitlementsFor, resolveCatalog, tierFor, hasFeature, TIER_FEATURES, ADDON_FEATURES,
} from './index.js';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const DAY = 864e5;

export const LIVE_CATALOG = {
  tiers: {
    basic: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set', 'billing', 'upi_payments', 'basic_reports', 'location', 'single_outlet'],
    growth: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set', 'billing', 'upi_payments', 'basic_reports', 'location', 'single_outlet', 'table_chat', 'reservations', 'notifications', 'staff_roles', 'detailed_reports', 'pdf_export', 'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload'],
    enterprise: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set', 'billing', 'upi_payments', 'basic_reports', 'location', 'single_outlet', 'table_chat', 'reservations', 'notifications', 'staff_roles', 'detailed_reports', 'pdf_export', 'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload', 'multi_outlet', 'unlimited_tables', 'marketing_tools', 'priority_support', 'multi_location', 'white_label', 'dedicated_manager'],
  },
  addons: { addon_pos: ['pos_integration'], addon_marketing: ['marketing_toolkit'] },
};

const sorted = (s) => [...s].sort();

const ROWS = [];
for (const plan_tier of ['basic', 'growth', 'enterprise', 'trial', null]) {
  for (const addons of [[], ['addon_pos'], ['addon_pos', 'addon_marketing']]) {
    ROWS.push({ plan_tier, plan_status: 'active', addons });
    ROWS.push({ plan_tier, plan_status: 'trialing', trial_ends_at: new Date(NOW + 5 * DAY).toISOString(), has_mandate: true, addons });
    ROWS.push({ plan_tier, plan_status: 'trialing', trial_ends_at: new Date(NOW + 5 * DAY).toISOString(), addons });
    ROWS.push({ plan_tier, plan_status: 'grace', grace_until: new Date(NOW + DAY).toISOString(), addons });
    ROWS.push({ plan_tier, plan_status: 'grace', grace_until: new Date(NOW - DAY).toISOString(), addons });
    ROWS.push({ plan_tier, plan_status: 'cancelled', addons });
    ROWS.push({ plan_tier, plan_status: 'trialing', is_complimentary: true, addons });
  }
}

test('the database catalog gives exactly today\'s answers, for every tier, state and add-on', () => {
  for (const row of ROWS) {
    const before = entitlementsFor(row, NOW, null);            // built-in lists
    const after = entitlementsFor({ ...row, catalog: LIVE_CATALOG }, NOW);
    assert.equal(after.state, before.state, JSON.stringify(row));
    assert.equal(after.tier, before.tier, JSON.stringify(row));
    assert.equal(after.canOrder, before.canOrder, JSON.stringify(row));
    assert.deepEqual(sorted(after.features), sorted(before.features), JSON.stringify(row));
  }
});

test('the seed equals the built-in lists, tier by tier', () => {
  for (const t of Object.keys(TIER_FEATURES)) assert.deepEqual(sorted(LIVE_CATALOG.tiers[t]), sorted(TIER_FEATURES[t]), t);
  for (const a of Object.keys(ADDON_FEATURES)) assert.deepEqual(LIVE_CATALOG.addons[a], ADDON_FEATURES[a], a);
});

test('a feature removed in the database is gone; one added is granted', () => {
  const cat = { tiers: { ...LIVE_CATALOG.tiers, growth: LIVE_CATALOG.tiers.growth.filter((f) => f !== 'excel_upload') } };
  const g = entitlementsFor({ plan_status: 'active', plan_tier: 'growth', catalog: cat }, NOW);
  assert.ok(!hasFeature(g, 'excel_upload'));
  const b = entitlementsFor({ plan_status: 'active', plan_tier: 'basic',
    catalog: { tiers: { basic: [...LIVE_CATALOG.tiers.basic, 'reservations'] } } }, NOW);
  assert.ok(hasFeature(b, 'reservations'));
  // and the upgrade nudge follows the same catalog
  assert.equal(tierFor('excel_upload', cat), 'enterprise');
  assert.equal(tierFor('excel_upload', null), 'growth');
});

test('a broken or missing catalog falls back per tier, never to nothing', () => {
  for (const bad of [undefined, null, 'x', 42, [], { tiers: null }, { tiers: { growth: 'all' } },
                     { tiers: { growth: [1, 2] } }, { tiers: { constructor: ['white_label'] } }]) {
    const e = entitlementsFor({ plan_status: 'active', plan_tier: 'growth', catalog: bad }, NOW);
    assert.deepEqual(sorted(e.features), sorted(TIER_FEATURES.growth), JSON.stringify(bad));
  }
  // one valid tier is used, the others fall back
  const r = resolveCatalog({ tiers: { basic: ['qr_ordering'] } });
  assert.deepEqual(r.tiers.basic, ['qr_ordering']);
  assert.deepEqual(r.tiers.growth, TIER_FEATURES.growth);
});

test('the database can change what a tier holds, never invent a tier', () => {
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'platinum',
    catalog: { tiers: { platinum: ['white_label'] } } }, NOW);
  assert.equal(e.tier, 'basic');
  assert.ok(!hasFeature(e, 'white_label'));
});

test('add-on ids that look like Object properties find nothing', () => {
  const e = entitlementsFor({ plan_status: 'active', plan_tier: 'basic',
    addons: ['constructor', 'toString', '__proto__'], catalog: LIVE_CATALOG }, NOW);
  assert.deepEqual(sorted(e.features), sorted(TIER_FEATURES.basic));
  const viaJson = JSON.parse('{"addons":{"__proto__":["white_label"]}}');
  const e2 = entitlementsFor({ plan_status: 'active', plan_tier: 'basic', addons: ['__proto__'], catalog: viaJson }, NOW);
  assert.ok(!hasFeature(e2, 'white_label'));
});

test('a locked restaurant holds nothing whatever the catalog says', () => {
  const e = entitlementsFor({ plan_status: 'cancelled', plan_tier: 'enterprise', catalog: LIVE_CATALOG }, NOW);
  assert.equal(e.features.size, 0);
  assert.equal(e.canOrder, false);
});
