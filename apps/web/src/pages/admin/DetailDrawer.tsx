import React, { useEffect, useRef, useState } from 'react';
import type { AdminRestaurant } from './adminApi';
import { StatusPill, TierPill } from './Pills';
import { fmtDate, fmtDateTime, fmtInr, fmtNum, relDays, titleCase } from './format';

/** Read-only detail panel. Phase 1 has no write actions by design. */
export function DetailDrawer({ restaurant: r, onClose }: { restaurant: AdminRestaurant | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!r) return;
    lastFocus.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      lastFocus.current?.focus?.();
    };
  }, [r, onClose]);

  if (!r) return null;
  const sub = r.latest_subscription;

  return (
    <div className="mc-drawer-layer" role="presentation">
      <div className="mc-scrim" onClick={onClose} />
      <aside
        ref={panelRef}
        className="mc-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-drawer-title"
        tabIndex={-1}
      >
        <header className="mc-drawer-head">
          <div>
            <h2 id="mc-drawer-title" className="mc-display mc-drawer-title">{r.name}</h2>
            <div className="mc-drawer-meta">
              <StatusPill lifecycle={r.lifecycle} />
              <TierPill tier={r.plan_tier} />
              {r.is_pilot && <span className="mc-tag mc-tag-gold">Pilot</span>}
              <span className="mc-muted">{r.city || 'No city'}</span>
            </div>
          </div>
          <button className="mc-icon-btn" onClick={onClose} aria-label="Close details">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="mc-drawer-body">
          <Section title="Plan">
            <Field label="Tier" value={titleCase(r.plan_tier)} />
            <Field label="Plan status" value={titleCase(r.plan_status)} />
            <Field label="Trial ends" value={r.trial_ends_at ? `${fmtDate(r.trial_ends_at)} · ${relDays(r.trial_ends_at)}` : '—'} />
            <Field label="Grace until" value={r.grace_until ? `${fmtDate(r.grace_until)} · ${relDays(r.grace_until)}` : '—'} />
            <Field label="Restaurant status" value={titleCase(r.restaurant_status)} />
            {r.parent_id && (
              <Field label="Billed through" value={r.parent_name || r.parent_id}
                hint={`Outlet — plan read from the parent (own row: ${titleCase(r.own_plan_tier)} / ${titleCase(r.own_plan_status)})`} />
            )}
          </Section>

          <Section title="Owner">
            <Field label="Name" value={r.owner?.name || '—'} />
            <Field label="Email" value={r.owner?.email || '—'} href={r.owner?.email ? `mailto:${r.owner.email}` : undefined} copy={r.owner?.email ?? undefined} />
            <Field label="Phone" value={r.owner?.phone || '—'} href={r.owner?.phone ? `tel:${r.owner.phone.replace(/\s+/g, '')}` : undefined} copy={r.owner?.phone ?? undefined} />
            <Field label="Restaurant phone" value={r.phone || '—'} />
          </Section>

          <Section title="Subscription">
            {sub ? (
              <>
                <Field label="Plan" value={sub.plan_name || titleCase(sub.plan_id)} />
                <Field label="Status" value={titleCase(sub.status)} />
                <Field label="Current period" value={sub.current_start || sub.current_end ? `${fmtDate(sub.current_start)} – ${fmtDate(sub.current_end)}` : '—'} />
                <Field label="Next charge" value={fmtDate(sub.next_charge_at)} />
                <Field label="Last update" value={fmtDateTime(sub.updated_at)} />
                {sub.razorpay_subscription_id && <Field label="Razorpay ID" value={sub.razorpay_subscription_id} mono copy={sub.razorpay_subscription_id} />}
              </>
            ) : <p className="mc-muted mc-small">No subscription has been started.</p>}

            {r.subscriptions.length > 1 && (
              <div className="mc-history">
                <div className="mc-history-title">History</div>
                {r.subscriptions.map((s, i) => (
                  <div key={i} className="mc-history-row">
                    <span>{titleCase(s.plan_id)}</span>
                    <span className="mc-cap">{s.status}</span>
                    <span className="mc-muted">{fmtDate(s.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
            {r.addons.length > 0 && (
              <div className="mc-history">
                <div className="mc-history-title">Add-ons</div>
                {r.addons.map((a, i) => (
                  <div key={i} className="mc-history-row">
                    <span>{titleCase(a.addon_id.replace(/^addon_/, ''))}</span>
                    <span className="mc-cap">{a.status}</span>
                    <span className="mc-muted">{fmtDate(a.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Activity · last 30 days">
            <div className="mc-stats">
              <Stat label="Orders" value={fmtNum(r.orders_30d)} />
              <Stat label="Order value" value={fmtInr(r.revenue_30d)} />
              <Stat label="Tables" value={fmtNum(r.table_count)} />
              <Stat label="Menu items" value={fmtNum(r.menu_item_count)} />
              <Stat label="Staff" value={fmtNum(r.member_count)} />
              <Stat label="Last order" value={r.last_order_at ? relDays(r.last_order_at) : 'Never'} />
            </div>
          </Section>

          <Section title="Details">
            <Field label="Address" value={r.address || '—'} />
            <Field label="Public page" value={r.slug ? `/r/${r.slug}` : '—'} href={r.slug ? `/r/${r.slug}` : undefined} external />
            <Field label="Created" value={fmtDateTime(r.created_at)} />
            <Field label="Restaurant ID" value={r.id} mono copy={r.id} />
          </Section>
        </div>
      </aside>
    </div>
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

function Field({ label, value, hint, href, external, mono, copy }: {
  label: string; value: string; hint?: string; href?: string; external?: boolean; mono?: boolean; copy?: string;
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
        {href
          ? <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{value}</a>
          : value}
        {copy && (
          <button className="mc-copy" onClick={doCopy} aria-label={`Copy ${label}`}>{copied ? 'Copied' : 'Copy'}</button>
        )}
        {hint && <span className="mc-field-hint">{hint}</span>}
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
