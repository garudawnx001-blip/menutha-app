/** Portal chrome: loads membership + plan state once, exposes it via context,
 *  renders role-aware navigation (sidebar on desktop, bottom bar on phones). */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  loadMembership, loadOutlets, rememberOutlet, type Membership, type PortalRole,
} from '../../lib/portalApi';
import { entitlementsFor, hasFeature, needsBilling, type Entitlements } from '../../lib/entitlements';
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
const NAV: { to: string; label: string; icon: string; primary?: boolean }[] = [
  { to: '/partner/orders', label: 'Orders', icon: '🧾', primary: true },
  { to: '/partner/menu', label: 'Menu', icon: '🍛', primary: true },
  { to: '/partner/tables', label: 'Tables & QR', icon: '🪑', primary: true },
  { to: '/partner/billing', label: 'Billing', icon: '💳', primary: true },
  { to: '/partner/chat', label: 'Chat', icon: '💬', primary: true },
  { to: '/partner/alerts', label: 'Alerts', icon: '🔔', primary: true },
  // Same items in the same order as the phone's More list. See MoreScreen.
  { to: '/partner/reports', label: 'Reports', icon: '📈' },
  { to: '/partner/reservations', label: 'Reservations', icon: '📅' },
  { to: '/partner/buffets', label: 'Buffets', icon: '🍽' },
  { to: '/partner/showcase', label: 'Showcase', icon: '🖼' },
  { to: '/partner/plan', label: 'Plan', icon: '⭐' },
  // "Restaurant profile", not "Settings": the overflow button is Settings now,
  // and a Settings menu whose contents include Settings is a path nobody reads
  // twice without pausing. Mirrors the app.
  { to: '/partner/bill-settings', label: 'Bill settings', icon: '🧮' },
  { to: '/partner/settings', label: 'Restaurant profile', icon: '⚙️' },
  { to: '/partner/account', label: 'Account & security', icon: '👤' },
];

export function PartnerShell() {
  const nav = useNavigate();
  const [member, setMember] = useState<Membership | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Phone bar overflow. Closes on navigation so the sheet never covers the
  // section it just opened.
  const [moreOpen, setMoreOpen] = useState(false);
  /** Every outlet this account can open. One entry is the ordinary case; the
   *  picker only appears when there are more. */
  const [outlets, setOutlets] = useState<Membership['restaurant'][]>([]);
  /**
   * IS AUTOPAY ARMED? A live subscription row is what separates "a trial that
   * will renew" from "a thirty-day countdown to a silent lockout with nothing
   * on file" -- and the second was what every new sign-up got.
   *
   * `authenticated` counts as much as `active`. The mandate is signed at the
   * zero-rupee authentication transaction; `active` only arrives after the
   * first real charge on day 30, so waiting for it would gate every restaurant
   * for the whole of its trial.
   *
   * Starts null, meaning NOT YET KNOWN, which is deliberately different from
   * false. The redirect below waits for it rather than bouncing an owner to
   * the plan screen during the half-second before the answer arrives.
   */
  const [hasMandate, setHasMandate] = useState<boolean | null>(null);

  const switchOutlet = async (id: string) => {
    rememberOutlet(id);
    // A full reload rather than a state swap: every open section holds data
    // for the outlet it was opened with, and re-fetching them piecemeal is how
    // one stale panel ends up showing another outlet's orders.
    window.location.reload();
  };
  const loc = useLocation();
  useEffect(() => { setMoreOpen(false); }, [loc.pathname]);

  const reload = async () => {
    try {
      const m = await loadMembership();
      if (!m) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { nav('/partner', { replace: true }); return; }
        setError('This account is not linked to a restaurant yet. Register your restaurant below to get started.');
      }
      setMember(m);
      setOutlets(await loadOutlets().catch(() => []));

      if (m?.restaurant?.id) {
        // RLS ("subscriptions: owner read" / is_manager_of) already limits this
        // to the caller's own restaurants, so no server round-trip of our own.
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('id')
          .eq('restaurant_id', m.restaurant.id)
          .in('status', ['authenticated', 'active'])
          .limit(1);
        setHasMandate((subs?.length ?? 0) > 0);
      } else {
        setHasMandate(false);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your restaurant.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const ent = useMemo(
    () => (member
      ? entitlementsFor({ ...(member.restaurant as any), has_mandate: hasMandate === true })
      : null),
    [member, hasMandate],
  );

  /**
   * THE HARD GATE.
   *
   * Until now this shell showed a BANNER for a locked restaurant and let it
   * walk into every screen anyway -- individual features were gated, routes
   * were not. So "your subscription has ended" sat above a working orders
   * board. Under the new rule there is no working anything without a plan or
   * an armed trial.
   *
   * THREE ROUTES STAY OPEN, and each for a reason rather than as a courtesy:
   * `plan` because it is where we are sending them and a redirect loop is not
   * a gate; `account` so nobody is locked out of their own password or email;
   * and `register`, which belongs to an account with no restaurant yet and
   * must not be dragged into a billing screen for a restaurant that does not
   * exist.
   *
   * `replace` so the back button cannot walk backwards into the app -- it
   * would be a gate with a documented bypass.
   */
  const gateRoute = '/partner/plan';
  const GATE_EXEMPT = ['/partner/plan', '/partner/account', '/partner/register'];
  const barred = ent ? needsBilling(ent) : false;
  useEffect(() => {
    // hasMandate === null means the answer is still in flight. Redirecting on
    // an unknown would bounce every owner to billing on each page load.
    if (hasMandate === null || !ent || !barred) return;
    if (GATE_EXEMPT.some((p) => loc.pathname.startsWith(p))) return;
    nav(gateRoute, { replace: true });
  }, [barred, hasMandate, ent, loc.pathname]);

  /**
   * THE WAY OUT OF THE GATE, and its absence is the bug the client hit.
   *
   * They paid on their phone, which advanced correctly. The same account on a
   * PC sat on the plan page and stayed there through every refresh -- only
   * logging out and back in released it.
   *
   * It was never a caching problem. loadMembership fetches restaurant(*) from
   * the server on every call, so the PC WAS re-reading the truth each refresh.
   * The gate above simply had one direction: it pushes somebody TO the plan
   * page when barred and never pulls them OFF it once they are not, because
   * that page is exempt from its own redirect -- correctly, or the redirect
   * would loop. So a PC with perfectly fresh, perfectly unbarred state stayed
   * exactly where it was. Logging in worked only because login lands on
   * /partner/orders rather than /partner/plan.
   *
   * This is the other direction. Stranding somebody on a billing screen they
   * have already satisfied is the same class of fault as letting an unpaid
   * one through.
   *
   * Only from `plan`. Account and register are places an owner goes
   * deliberately, and yanking them to the board mid-edit because a webhook
   * landed would be its own bug.
   */
  /**
   * ONLY ON THE TRANSITION, never on arrival -- and this ref is the whole
   * difference between a fix and a new bug.
   *
   * Leaving without it: any unbarred owner who taps "Plan" in the nav to look
   * at their subscription or switch tier gets thrown straight back to Orders,
   * because they are unbarred and standing on /partner/plan. The billing page
   * would be unreachable for exactly the people who pay us.
   *
   * So the exit fires only for somebody this shell has actually SEEN barred
   * and then seen released -- which is the second device watching a payment
   * land, and nobody else.
   */
  const wasBarred = React.useRef(false);
  useEffect(() => {
    if (hasMandate === null || !ent) return;
    if (barred) { wasBarred.current = true; return; }
    if (!wasBarred.current) return;              // arrived already paid: leave them be
    if (!loc.pathname.startsWith('/partner/plan')) return;
    wasBarred.current = false;
    nav('/partner/orders', { replace: true });
  }, [barred, hasMandate, ent, loc.pathname]);

  /**
   * A SECOND DEVICE HAS TO NOTICE, and nothing was telling it to look.
   *
   * PlanScreen polls after checkout, but that poll lives in the Razorpay
   * success handler -- it only ever runs on the device that opened Razorpay.
   * Every other screen the owner has open learns nothing until it remounts.
   *
   * So: re-read on focus, and poll while the gate is actually holding
   * somebody. Both are cheap and both stop only when they should.
   *
   * FOCUS is the one that matters in practice. The owner pays on the phone,
   * turns to the PC and clicks the window -- that click is the signal, and it
   * arrives before they have thought to refresh.
   *
   * The interval runs ONLY while barred. Once through the gate it stops,
   * because polling a subscription every five seconds for the rest of the
   * session is a request every restaurant would pay for in battery and
   * nobody would benefit from.
   */
  useEffect(() => {
    const onFocus = () => { reload(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!barred) return;
    const t = setInterval(() => { reload(); }, 5000);
    return () => clearInterval(t);
  }, [barred]);

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

  /* NO ROLE FILTER ANY MORE. Menutha is a single-owner product: there are no
     staff logins to hide sections from, so every section in NAV is a section
     this person can open. The filter was the last thing reading `roles`, which
     is why the field is gone from the list above rather than left set to
     ['owner'] on every row -- a filter that always passes is a filter someone
     later has to read and work out is dead. */
  const items = NAV;

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
            {/* ONE OUTLET: its name, as before. SEVERAL: a picker, because
                the name is also the answer to "which one am I editing?" and
                that question only exists once there is more than one. The
                choice is remembered per browser -- an owner at head office
                and a manager on the counter PC can be in different outlets. */}
            {outlets.length > 1 ? (
              <select
                className="outlet-switch"
                aria-label="Which outlet"
                value={member.restaurant.id}
                onChange={(e) => switchOutlet(e.target.value)}
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            ) : (
              <span className="dim" style={{ fontSize: 11.5, display: 'block', marginTop: 2 }}>
                {member.restaurant.name}
              </span>
            )}
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

/** For the design preview only: the shell's context from a fixture, so a
 *  section page can be drawn without a session. Nothing here reaches the
 *  network on its own; a page that saves would fail, which is fine for a
 *  screenshot. */
export function PartnerPreviewProvider({ children }: { children: React.ReactNode }) {
  const restaurant = {
    id: 'preview', name: 'The Green Fork', city: 'Bengaluru', address: '12 Residency Road',
    phone: '98765 43210', gstin: '29ABCDE1234F1Z5', upi_vpa: 'greenfork@okhdfcbank', upi_account_type: 'merchant',
    open_time: '11:00', close_time: '23:00', cuisine_tags: 'North Indian · South Indian · Chinese',
    plan_tier: 'trial', plan_status: 'trialing', is_open: true,
    trial_ends_at: new Date(Date.now() + 25 * 864e5).toISOString(),
    // The fixture is a HEALTHY restaurant mid-trial, so it must carry the
    // mandate -- without it the entitlement is `setup` and the preview would
    // render the whole portal locked.
    has_mandate: true,
  } as any;
  const ent = entitlementsFor(restaurant);
  const value: PartnerCtx = {
    role: 'owner' as PortalRole, restaurant, ent,
    can: (f) => hasFeature(ent, f),
    reload: async () => {},
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
