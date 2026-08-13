/** Web-side entry to the shared gating package (packages/entitlements) —
 *  single runtime source of truth for plan features across surfaces. */
export {
  entitlementsFor,
  hasFeature,
  applySubscriptionEvent,
  TIER_FEATURES,
  ADDON_FEATURES,
  GRACE_DAYS,
} from '../../../../packages/entitlements/index.js';
export type {
  Entitlements,
  PlanStateInput,
} from '../../../../packages/entitlements/index.js';
