/** Portal chrome: loads membership + plan state once, exposes it via context,
 *  renders role-aware navigation (sidebar on desktop, bottom bar on phones). */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { loadMembership, type Membership, type PortalRole } from '../../lib/portalApi';
import { entitlementsFor, hasFeature, type Entitlements } from '../../lib/entitlements';
import { Spinner, Wordmark } from '../../components';

interface PartnerCtx {
  role: PortalRole;
  restaurant: Membership['restaurant'];
  ent: Entitlements;
  can: (feature: string) => boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<PartnerCtx | null>(null);
export function usePartner(): PartnerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePartner outside PartnerShell');
  return c;
}

const NAV: { to: string; label: string; icon: string; roles: PortalRole[] }[] = [
  { to: '/partner/orders', label: 'Orders', icon: '🧾', roles: ['owner', 'manager', 'waiter', 'kitchen'] },
  { to: '/partner/menu', label: 'Menu', icon: '🍛', roles: ['owner', 'manager'] },
  { to: '/partner/tables', label: 'Tables & QR', icon: '🪑', roles: ['owner', 'manager'] },
  { to: '/partner/billing', label: 'Billing', icon: '💳', roles: ['owner', 'manager', 'waiter'] },
  { to: '/partner/expenses', label: 'Expenses', icon: '📒', roles: ['owner', 'manager'] },
  { to: '/partner/reservations', label: 'Reservations', icon: '📅', roles: ['owner', 'manager'] },
  { to: '/partner/staff', label: 'Staff', icon: '👥', roles: ['owner'] },
  { to: '/partner/plan', label: 'Plan', icon: '⭐', roles: ['owner'] },
  { to: '/partner/settings', label: 'Settings', icon: '⚙️', roles: ['owner', 'manager'] },
];

export function PartnerShell() {
  const nav = useNavigate();
  const [member, setMember] = useState<Membership | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const m = await loadMembership();
      if (!m) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { nav('/partner', { replace: true }); return; }
        setError('This account is not linked to a restaurant yet. Ask the owner to invite your phone number, then sign in again.');
      }
      setMember(m);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your restaurant.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const ent = useMemo(
    () => (member ? entitlementsFor(member.restaurant as any) : null),
    [member],
  );

  if (loading) return <Spinner label="Opening your restaurant…" />;
  if (!member || !ent) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <p className="muted" style={{ maxWidth: 400 }}>{error || 'No restaurant linked to this account yet.'}</p>
        <button className="btn btn-primary" onClick={() => nav('/partner/register')}>
          Register a new restaurant →
        </button>
        <button className="btn btn-ghost" onClick={async () => { await supabase.auth.signOut(); nav('/partner', { replace: true }); }}>
          Sign out
        </button>
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(member.role))
    .filter((n) => !(n.to === '/partner/expenses' && member.role === 'manager' && !member.restaurant.pnl_visible_to_managers));

  return (
    <Ctx.Provider
      value={{
        role: member.role,
        restaurant: member.restaurant,
        ent,
        can: (f) => hasFeature(ent, f),
        reload,
      }}
    >
      <div className="portal">
        <aside className="portal-nav">
          <div className="portal-brand">
            <Wordmark size={19} />
            <span className="dim" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }}>
              {member.restaurant.name}
            </span>
          </div>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => 'portal-link' + (isActive ? ' active' : '')}>
              <span aria-hidden>{n.icon}</span>
              <span className="portal-link-label">{n.label}</span>
            </NavLink>
          ))}
          <button
            className="portal-link"
            style={{ marginTop: 'auto' }}
            onClick={async () => { await supabase.auth.signOut(); nav('/partner', { replace: true }); }}
          >
            <span aria-hidden>↩︎</span>
            <span className="portal-link-label">Sign out</span>
          </button>
        </aside>
        <main className="portal-main">
          {ent.state === 'grace' && (
            <div className="glass" style={{ padding: 12, margin: '10px 0', borderColor: 'rgba(197,64,47,0.5)', fontSize: 13.5 }}>
              <strong style={{ color: 'var(--error)' }}>Payment problem</strong>
              <span className="muted"> — service continues for now. </span>
              <NavLink to="/partner/plan" style={{ fontWeight: 700 }}>Fix billing →</NavLink>
            </div>
          )}
          {ent.state === 'locked' && (
            <div className="glass" style={{ padding: 12, margin: '10px 0', borderColor: 'rgba(197,64,47,0.6)', fontSize: 13.5 }}>
              <strong style={{ color: 'var(--error)' }}>Ordering paused</strong>
              <span className="muted"> — your menu is view-only for diners. </span>
              <NavLink to="/partner/plan" style={{ fontWeight: 700 }}>Choose a plan →</NavLink>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </Ctx.Provider>
  );
}
