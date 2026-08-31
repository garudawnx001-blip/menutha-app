/** Portal chrome: loads membership + plan state once, exposes it via context,
 *  renders role-aware navigation (sidebar on desktop, bottom bar on phones). */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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

/**
 * THE section list. Same sections, same names, same order as the partner app's
 * navigation (apps/mobile/src/app/(restaurant)/manager/_layout.tsx) — keep the
 * two in step when either changes.
 *
 * They had drifted: this called it "Orders" and the app called it "Live"; this
 * had Reservations and Staff as sections while the app buried them inside
 * Settings; Reports lived inside the Orders board here and was a top-level
 * section there. Someone moving between their phone and a laptop was learning
 * the product twice.
 *
 * `primary` marks the four that stay on the bar when there is no room for nine
 * — everything else moves behind More. Measured: nine items at 64px minimum
 * need ~612px, and a 360px phone has ~348px, so four of them were sitting off
 * the right edge of a scroller with its scrollbar hidden. Nothing on screen
 * said they were there.
 */
const NAV: { to: string; label: string; icon: string; roles: PortalRole[]; primary?: boolean }[] = [
  { to: '/partner/orders', label: 'Orders', icon: '🧾', roles: ['owner', 'manager', 'waiter', 'kitchen'], primary: true },
  { to: '/partner/menu', label: 'Menu', icon: '🍛', roles: ['owner', 'manager'], primary: true },
  { to: '/partner/tables', label: 'Tables & QR', icon: '🪑', roles: ['owner', 'manager'], primary: true },
  { to: '/partner/billing', label: 'Billing', icon: '💳', roles: ['owner', 'manager', 'waiter'], primary: true },
  { to: '/partner/reports', label: 'Reports', icon: '📈', roles: ['owner', 'manager'] },
  { to: '/partner/reservations', label: 'Reservations', icon: '📅', roles: ['owner', 'manager'] },
  { to: '/partner/staff', label: 'Staff', icon: '👥', roles: ['owner'] },
  { to: '/partner/plan', label: 'Plan', icon: '⭐', roles: ['owner'] },
  // "Restaurant profile", not "Settings": the overflow button is Settings now,
  // and a Settings menu whose contents include Settings is a path nobody reads
  // twice without pausing. Mirrors the app.
  { to: '/partner/settings', label: 'Restaurant profile', icon: '⚙️', roles: ['owner', 'manager'] },
];

export function PartnerShell() {
  const nav = useNavigate();
  const [member, setMember] = useState<Membership | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Phone bar overflow. Closes on navigation so the sheet never covers the
  // section it just opened.
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMoreOpen(false); }, [loc.pathname]);

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

  const items = NAV.filter((n) => n.roles.includes(member.role));

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
          {/* Wide screens list every section; the phone bar shows the four
              primary ones plus More, because nine never fitted and the four
              that overflowed were simply invisible. `.portal-more-only` and
              `.portal-bar-only` are the two halves of that split (theme.css). */}
          {items.filter((n) => n.primary).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => 'portal-link' + (isActive ? ' active' : '')}>
              <span aria-hidden>{n.icon}</span>
              <span className="portal-link-label">{n.label}</span>
            </NavLink>
          ))}

          {/* The rest. On a wide screen this is just more of the sidebar; on a
              phone it is a sheet that More opens. One list either way, so the
              order of sections never changes with the width of the screen. */}
          <div className={'portal-rest' + (moreOpen ? ' open' : '')}>
            {items.filter((n) => !n.primary).map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => 'portal-link' + (isActive ? ' active' : '')}>
                <span aria-hidden>{n.icon}</span>
                <span className="portal-link-label">{n.label}</span>
              </NavLink>
            ))}
            <button
              className="portal-link"
              onClick={async () => { await supabase.auth.signOut(); nav('/partner', { replace: true }); }}
            >
              <span aria-hidden>↩︎</span>
              <span className="portal-link-label">Sign out</span>
            </button>
          </div>

          {items.some((n) => !n.primary) && (
            <button
              className={'portal-link portal-more' + (moreOpen ? ' active' : '')}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span aria-hidden>⋯</span>
              <span className="portal-link-label">Settings</span>
            </button>
          )}
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
