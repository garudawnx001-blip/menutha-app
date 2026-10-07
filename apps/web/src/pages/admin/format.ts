import type { Lifecycle } from './adminApi';

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

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  active: 'Active',
  trialing: 'Trialing',
  trial_expired: 'Trial expired',
  grace: 'Grace',
  suspended: 'Suspended',
  lapsed: 'Lapsed',
};

export function titleCase(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
