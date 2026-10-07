import React, { useEffect, useRef, useState } from 'react';
import type { AdminRestaurant } from './adminApi';
import { ActionDialog, type ActionKind } from './Actions';
import { StatusChip, TierPill } from './Pills';
import { BILLING_LABEL, LIFECYCLE_HINT, fmtDate, fmtDateTime, fmtInr, fmtNum, relDays, tierName, titleCase } from './format';
import { Icon } from './icons';

/** One restaurant: what is going on, in plain words, and big buttons to act. */
export function DetailDrawer({ restaurant: r, onClose }: { restaurant: AdminRestaurant | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<ActionKind | null>(null);

  useEffect(() => { setAction(null); }, [r?.id]);
  useEffect(() => {
    if (!r) return;
    const last = document.activeElement as HTMLElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; last?.focus?.(); };
  }, [r?.id, onClose]);

  if (!r) return null;
  const sub = r.latest_subscription;
  const outlet = !!r.parent_id;
  const suspended = r.restaurant_status === 'suspended';

  return (
    <div className="mc-drawer-layer" role="presentation">
      <div className="mc-scrim" onClick={onClose} />
      <aside ref={panelRef} className="mc-drawer" role="dialog" aria-modal="true" aria-labelledby="mc-drawer-title" tabIndex={-1}>
        <header className="mc-drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="mc-drawer-title" className="mc-display mc-drawer-title">{r.name}</h2>
            <div className="mc-drawer-meta">
              <span className="mc-muted">{r.city || 'No city'}</span>
              {outlet && <span className="mc-tag">Outlet of {r.parent_name}</span>}
              {r.is_pilot && <span className="mc-tag mc-tag-gold">Pilot</span>}
            </div>
          </div>
          <button className="mc-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>

        <div className="mc-drawer-body">
          {/* THE ANSWER FIRST: what state is it in, in one glance. */}
          <div className={`mc-hero mc-hero-${r.is_complimentary && !suspended ? 'complimentary' : r.lifecycle}`}>
            <div className="mc-hero-row">
              <StatusChip r={r} size="lg" />
              <TierPill tier={r.plan_tier} />
            </div>
            <p className="mc-hero-text">{heroSentence(r)}</p>
          </div>

          <div className="mc-actions">
            <BigAction icon="layers" label="Change plan" sub={`Now: ${tierName(r.plan_tier)}`} disabled={outlet} onClick={() => setAction('plan')} />
            <BigAction icon="calendar" label="Give more free days" sub={r.is_complimentary ? 'Not needed — never expires' : r.trial_ends_at ? `Trial ends ${fmtDate(r.trial_ends_at)}` : 'Extend the free trial'}
              disabled={outlet || r.is_complimentary} onClick={() => setAction('trial')} />
            {r.is_complimentary
              ? <BigAction icon="gift" label="Remove complimentary" sub="They will need to pay again" tone="gold" disabled={outlet} onClick={() => setAction('comp-off')} />
              : <BigAction icon="gift" label="Make complimentary" sub="Free forever, never billed" tone="gold" disabled={outlet} onClick={() => setAction('comp-on')} />}
            {suspended
              ? <BigAction icon="power" label="Switch back on" sub="Let diners order again" tone="green" onClick={() => setAction('activate')} />
              : <BigAction icon="power" label="Suspend" sub="Stop all orders now" tone="danger" onClick={() => setAction('suspend')} />}
            <BigAction icon="key" label="Reset owner login" sub="Make a new password" disabled={!r.owner} onClick={() => setAction('reset')} />
          </div>
          {outlet && <p className="mc-note">This is an outlet: its plan comes from <strong>{r.parent_name}</strong>. Open that restaurant to change the plan.</p>}

          <Section title="Owner">
            <Field label="Name" value={r.owner?.name || '—'} />
            <Field label="Username" value={r.owner?.username || '—'} copy={r.owner?.username ?? undefined} />
            <Field label="Email" value={r.owner?.email || '—'} href={r.owner?.email ? `mailto:${r.owner.email}` : undefined} copy={r.owner?.email ?? undefined} />
            <Field label="Phone" value={r.owner?.phone || r.phone || '—'} href={(r.owner?.phone || r.phone) ? `tel:${(r.owner?.phone || r.phone || '').replace(/\s+/g, '')}` : undefined} copy={r.owner?.phone || r.phone || undefined} />
          </Section>

          <Section title="Last 30 days">
            <div className="mc-stats">
              <Stat label="Orders" value={fmtNum(r.orders_30d)} />
              <Stat label="Order value" value={fmtInr(r.revenue_30d)} />
              <Stat label="Last order" value={r.last_order_at ? relDays(r.last_order_at) : 'Never'} />
              <Stat label="Tables" value={fmtNum(r.table_count)} />
              <Stat label="Dishes" value={fmtNum(r.menu_item_count)} />
              <Stat label="Staff" value={fmtNum(r.member_count)} />
            </div>
          </Section>

          <Section title="Payments">
            {r.is_complimentary ? <p className="mc-muted mc-small">Complimentary — nothing is ever charged.</p>
              : sub ? (
                <>
                  {r.billing && <Field label="Billing" value={BILLING_LABEL[r.billing] ?? titleCase(r.billing)} />}
                  <Field label={sub.charged ? 'Plan paid for' : 'Plan chosen'} value={sub.plan_name || titleCase(sub.plan_id)} />
                  <Field label="Razorpay status" value={subWords(sub)} />
                  <Field label="Next payment" value={fmtDate(sub.next_charge_at)} />
                  {sub.razorpay_subscription_id && <Field label="Razorpay ID" value={sub.razorpay_subscription_id} mono copy={sub.razorpay_subscription_id} />}
                </>
              ) : <p className="mc-muted mc-small">{r.billing === 'not_billed'
                ? 'Active without autopay — switched on by an admin, not billed through Razorpay.'
                : 'They have not set up payment yet.'}</p>}
          </Section>

          <Section title="Details">
            <Field label="Address" value={r.address || '—'} />
            <Field label="Public page" value={r.slug ? `/r/${r.slug}` : '—'} href={r.slug ? `/r/${r.slug}` : undefined} external />
            <Field label="Joined" value={fmtDateTime(r.created_at)} />
            <Field label="ID" value={r.id} mono copy={r.id} />
          </Section>
        </div>
      </aside>
      {action && <ActionDialog kind={action} r={r} onClose={() => setAction(null)} />}
    </div>
  );
}

function heroSentence(r: AdminRestaurant): string {
  if (r.restaurant_status === 'suspended') return 'You switched this restaurant off. Diners cannot order.';
  if (r.is_complimentary) return `Free forever on ${tierName(r.plan_tier)}, courtesy of Menutha. Never billed, never expires.`;
  switch (r.lifecycle) {
    case 'trialing': return r.trial_ends_at ? `Free trial ends ${fmtDate(r.trial_ends_at)} (${relDays(r.trial_ends_at)}).` : LIFECYCLE_HINT.trialing;
    case 'trial_expired': return `Free trial ended ${fmtDate(r.trial_ends_at)}. Diners cannot order until they pay.`;
    case 'grace': return `A payment failed. Orders keep working until ${fmtDate(r.grace_until)} (${relDays(r.grace_until)}).`;
    case 'active':
      switch (r.billing) {
        case 'not_billed': return `Active on ${tierName(r.plan_tier)}, switched on by an admin. No autopay, so Menutha is not billing them through Razorpay.`;
        case 'autopay_set_up': return `Active on ${tierName(r.plan_tier)}. Autopay is set up; Razorpay has not taken the first payment yet.`;
        default: return `Paying for ${tierName(r.plan_tier)}. Everything is on.`;
      }
    default: return LIFECYCLE_HINT[r.lifecycle];
  }
}

/** An `active` subscription Razorpay has never charged is not "Paying" yet. */
export const subWords = (s: { status: string | null; charged?: boolean }) =>
  s.status === 'active' && s.charged === false ? 'Autopay set up — first payment pending' : payWords(s.status);

const payWords = (s: string | null) => ({
  active: 'Paying', authenticated: 'Autopay set up — first payment pending', created: 'Started, not finished',
  pending: 'Payment failing', halted: 'Payment stopped', cancelled: 'Cancelled', completed: 'Finished',
} as Record<string, string>)[s ?? ''] ?? titleCase(s);

function BigAction({ icon, label, sub, onClick, disabled, tone }: {
  icon: string; label: string; sub: string; onClick: () => void; disabled?: boolean; tone?: 'danger' | 'gold' | 'green';
}) {
  return (
    <button className={`mc-big-action${tone ? ` mc-big-${tone}` : ''}`} onClick={onClick} disabled={disabled}>
      <span className="mc-big-icon"><Icon name={icon} size={20} /></span>
      <span className="mc-big-text"><strong>{label}</strong><small>{sub}</small></span>
      <Icon name="chevron" size={16} className="mc-big-chev" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mc-section">
      <h3 className="mc-section-title">{title}</h3>
      <div className="mc-fields">{children}</div>
    </section>
  );
}

function Field({ label, value, href, external, mono, copy }: {
  label: string; value: string; href?: string; external?: boolean; mono?: boolean; copy?: string;
}) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ }
  };
  return (
    <div className="mc-field">
      <span className="mc-field-label">{label}</span>
      <span className={`mc-field-value${mono ? ' mc-mono' : ''}`}>
        {href ? <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{value}</a> : value}
        {copy && <button className="mc-copy" onClick={doCopy} aria-label={`Copy ${label}`}>{copied ? 'Copied' : 'Copy'}</button>}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mc-stat">
      <span className="mc-stat-value">{value}</span>
      <span className="mc-stat-label">{label}</span>
    </div>
  );
}
