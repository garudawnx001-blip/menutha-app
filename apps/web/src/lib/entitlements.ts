/** Web-side entry to the shared gating package (packages/entitlements) —
 *  single runtime source of truth for plan rules across surfaces. WHICH
 *  features each plan holds comes from the database catalog (see
 *  planCatalog.ts); the package's lists are only the offline fallback. */
export {
  entitlementsFor,
  hasFeature,
  needsBilling,
  applySubscriptionEvent,
  resolveCatalog,
  tierFor,
  TIER_FEATURES,
  ADDON_FEATURES,
  GRACE_DAYS,
} from '../../../../packages/entitlements/index.js';
export type {
  Entitlements,
  PlanStateInput,
  PlanCatalogMap,
} from '../../../../packages/entitlements/index.js';
