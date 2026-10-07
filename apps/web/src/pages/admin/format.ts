import type { AdminRestaurant, Lifecycle } from './adminApi';

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export const fmtInr = (n: number | null | undefined) => inr0.format(Number(n) || 0);
export const fmtNum = (n: number | null | undefined) => num.format(Number(n) || 0);
export const fmtDate = (s: string | null | undefined) => (s ? day.format(new Date(s)) : '—');
export const fmtDateTime = (s: string | null | undefined) => (s ? dayTime.format(new Date(s)) : '—');
export const fmtTime = (s: string | null | undefined) => (s ? time.format(new Date(s)) : '');

/** "in 3 days", "2 days ago", "today" — whole days, which is all a trial needs. */
export function relDays(s: string | null | undefined, now = Date.now()): string {
  if (!s) return '';
  const d = Math.round((new Date(s).getTime() - now) / 864e5);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export const daysUntil = (s: string | null | undefined, now = Date.now()) =>
  s ? (new Date(s).getTime() - now) / 864e5 : Infinity;

/** The words an owner of the business would use — no billing jargon. */
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  active: 'Active',
  trialing: 'On free trial',
  trial_expired: 'Free trial ended',
  grace: 'Payment overdue',
  suspended: 'Suspended',
  lapsed: 'Stopped paying',
};

/** The one-line "what does that mean" under each status. */
export const LIFECYCLE_HINT: Record<Lifecycle, string> = {
  active: 'Paying and taking orders',
  trialing: 'Using Menutha free for now',
  trial_expired: 'Free days are over — orders are off',
  grace: 'A payment failed — a few grace days left',
  suspended: 'Switched off by you — no orders',
  lapsed: 'Cancelled their plan — orders are off',
};

/** Complimentary is shown as its own status: it is the first thing to know. */
export type Display = Lifecycle | 'complimentary';
export const displayOf = (r: Pick<AdminRestaurant, 'lifecycle' | 'is_complimentary'>): Display =>
  r.is_complimentary && r.lifecycle !== 'suspended' ? 'complimentary' : r.lifecycle;

export const DISPLAY_LABEL: Record<Display, string> = { ...LIFECYCLE_LABEL, complimentary: 'Complimentary' };

export const TIER_LABEL: Record<string, string> = { basic: 'Basic', growth: 'Growth', enterprise: 'Enterprise', trial: 'No plan yet' };
export const tierName = (t: string | null | undefined) => TIER_LABEL[t ?? ''] ?? titleCase(t);

export function titleCase(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Plain-language names for audit actions. */
export const ACTION_LABEL: Record<string, string> = {
  'admin.sign_in': 'Signed in to the console',
  'admin.claimed': 'Admin access set up',
  'restaurant.set_plan': 'Changed plan',
  'restaurant.extend_trial': 'Extended free trial',
  'restaurant.complimentary_on': 'Made complimentary',
  'restaurant.complimentary_off': 'Removed complimentary',
  'restaurant.suspend': 'Suspended restaurant',
  'restaurant.activate': 'Switched restaurant back on',
  'restaurant.login_reset': 'Reset owner login',
  'restaurant.create': 'Created restaurant account',
  'plan.update': 'Changed a plan',
  'plan.price_change': 'Changed a price',
  'offer.create': 'Created an offer',
  'offer.update': 'Edited an offer',
  'offer.ready': 'Set up an offer at Razorpay',
  'offer.publish': 'Published an offer',
  'offer.pause': 'Paused an offer',
  'notice.broadcast': 'Sent a message to restaurants',
};
