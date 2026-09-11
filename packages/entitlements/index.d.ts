export declare const TIER_FEATURES: Record<string, string[]>;
export declare const ADDON_FEATURES: Record<string, string[]>;
export declare const GRACE_DAYS: number;
/** The tier a trial runs at: Enterprise, so the trial shows the whole product. */
export declare const TRIAL_TIER: string;

export interface PlanStateInput {
  plan_tier?: string | null;
  plan_status?: string | null;
  trial_ends_at?: string | null;
  grace_until?: string | null;
  addons?: string[];
}

export interface Entitlements {
  tier: string;
  state: 'trial' | 'active' | 'grace' | 'locked';
  canOrder: boolean;
  features: Set<string>;
  trialEndsAt: number | null;
  graceUntil: number | null;
}

export declare function entitlementsFor(r: PlanStateInput, now?: number): Entitlements;
export declare function hasFeature(ent: Entitlements, feature: string): boolean;
/** Outlets this restaurant may hold, itself included. Infinity on Enterprise. */
export declare function outletLimit(ent: Entitlements): number;
export declare function applySubscriptionEvent(
  eventType: string,
  sub: { plan_id?: string },
  now?: number,
): null | {
  subStatus: string;
  restaurant: { plan_tier?: string; plan_status: string; grace_until: string | null };
};
