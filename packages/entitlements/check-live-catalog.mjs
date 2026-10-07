// Compare the LIVE database catalog with the built-in lists, for every state.
//   node packages/entitlements/check-live-catalog.mjs
// Reads only public data (get_plan_catalog) with the publishable key.
import { entitlementsFor, TIER_FEATURES } from './index.js';

const SB = process.env.SB_URL || 'https://xnhcziciilylzcaupqoq.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_zmrlV7bkDZ_cJiIHxd0Slg_0H192fIe';

const res = await fetch(`${SB}/rest/v1/rpc/get_plan_catalog`, {
  method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: '{}',
});
if (!res.ok) { console.error('get_plan_catalog failed', res.status, await res.text()); process.exit(2); }
const live = (await res.json()).entitlements;

let diffs = 0;
const now = Date.now();
for (const plan_tier of [...Object.keys(TIER_FEATURES), 'trial']) {
  for (const plan_status of ['active', 'trialing', 'grace', 'cancelled']) {
    const row = { plan_tier, plan_status, has_mandate: true, trial_ends_at: new Date(now + 864e5).toISOString(),
                  grace_until: new Date(now + 864e5).toISOString(), addons: ['addon_pos', 'addon_marketing'] };
    const a = [...entitlementsFor(row, now, null).features].sort().join(',');
    const b = [...entitlementsFor(row, now, live).features].sort().join(',');
    if (a !== b) { diffs++; console.log(`DIFF ${plan_tier}/${plan_status}\n  code: ${a}\n  db:   ${b}`); }
  }
}
console.log(diffs ? `${diffs} difference(s) between the database and the built-in lists` : 'Database catalog matches the built-in lists for every tier and state.');
process.exitCode = diffs ? 1 : 0;
