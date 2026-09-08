/**
 * WHAT A LOCKED FEATURE LOOKS LIKE.
 *
 * Two rules, and they are the whole design:
 *
 *   1. SHOW IT, DON'T HIDE IT. A feature that vanishes teaches the owner the
 *      product cannot do it. A feature that is visible and locked teaches them
 *      what their plan is for. Hiding is also how support calls start: "the
 *      web says you can take reservations" / "I don't have that screen".
 *
 *   2. SAY WHICH PLAN, AND OFFER IT. A lock with no way out is a wall. Every
 *      nudge names the tier that includes the feature and links to Plan.
 *
 * The one exception is `state === 'locked'` -- an expired subscription. There
 * the whole product is read-only and ordering is off, so the nudge says that
 * instead of naming a tier.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { usePartner } from './PartnerShell';
import { TIER_FEATURES } from '../../lib/entitlements';

/** The cheapest tier that includes a feature — so the nudge can name it
 *  rather than always pushing the most expensive one. */
export function tierFor(feature: string): 'basic' | 'growth' | 'enterprise' | null {
  for (const t of ['basic', 'growth', 'enterprise'] as const) {
    if ((TIER_FEATURES as any)[t]?.includes(feature)) return t;
  }
  return null;
}

const LABEL: Record<string, string> = {
  basic: 'Basic', growth: 'Growth', enterprise: 'Enterprise',
};

export function UpgradeNudge({ feature, what }: { feature: string; what: string }) {
  const nav = useNavigate();
  const { ent } = usePartner();
  const tier = tierFor(feature);
  const expired = ent.state === 'locked';

  return (
    <div className="state-card" role="note">
      <div className="state-mark state-mark-soft" aria-hidden>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <strong>{expired ? 'Your subscription has ended' : `${what} is on ${LABEL[tier ?? 'growth']}`}</strong>
      <p className="dim">
        {expired
          ? 'Everything is still here and nothing has been deleted — new orders are paused until a plan is active again.'
          : `Your plan does not include ${what.toLowerCase()} yet. Everything you have set up stays exactly as it is.`}
      </p>
      <button className="btn btn-primary" onClick={() => nav('/partner/plan')}>
        {expired ? 'Choose a plan' : `See ${LABEL[tier ?? 'growth']}`}
      </button>
    </div>
  );
}

/**
 * Wraps a section: renders it when the plan allows, and the nudge when it
 * does not. `what` is the human name used in the sentence, so a caller reads
 * as one line: <Gate feature="reservations" what="Reservations">…</Gate>
 */
export function Gate({ feature, what, children }: {
  feature: string; what: string; children: React.ReactNode;
}) {
  const { can } = usePartner();
  if (can(feature)) return <>{children}</>;
  return <UpgradeNudge feature={feature} what={what} />;
}
