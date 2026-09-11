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
  /**
   * Has the autopay mandate been signed? Read from `subscriptions` by the
   * caller and handed in, so this stays pure.
   *
   * OMITTING IT GATES. Undefined is not "unknown, assume fine" -- it is false,
   * and false bars the restaurant. A caller that forgets shows up as a screen
   * the owner cannot pass, which someone reports; the opposite default shows
   * up as free Enterprise, which nobody reports.
   */
  has_mandate?: boolean;
}

export interface Entitlements {
  tier: string;
  /**
   * `setup` is a trial whose thirty days are running with no mandate armed to
   * charge on day thirty. It holds nothing, exactly like `locked`, and is kept
   * separate only because the two say opposite things to whoever is reading
   * the screen: "start your free trial" before, "your subscription ended"
   * after.
   */
  state: 'setup' | 'trial' | 'active' | 'grace' | 'locked';
  canOrder: boolean;
  features: Set<string>;
  trialEndsAt: number | null;
  graceUntil: number | null;
}

export declare function entitlementsFor(r: PlanStateInput, now?: number): Entitlements;
export declare function hasFeature(ent: Entitlements, feature: string): boolean;
/** Must this restaurant be sent to the plan screen before it may use
 *  anything? One definition, so two surfaces cannot disagree. */
export declare function needsBilling(ent: Entitlements): boolean;
/** Outlets this restaurant may hold, itself included. Infinity on Enterprise. */
export declare function outletLimit(ent: Entitlements): number;
export declare function applySubscriptionEvent(
  eventType: string,
  sub: { plan_id?: string },
  now?: number,
  /** The restaurant's trial_ends_at, so `subscription.authenticated` can tell
   *  "armed autopay, still inside the free 30 days" from "lapsed and
   *  re-subscribing". Null or past means the latter. */
  trialEndsAt?: number | null,
): null | {
  subStatus: string;
  restaurant: { plan_tier?: string; plan_status: string; grace_until: string | null };
};
