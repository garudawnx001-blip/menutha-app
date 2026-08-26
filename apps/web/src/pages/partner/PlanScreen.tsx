/** Restaurant Portal — Plan & Billing (MODULE 1).
 *  Current plan + trial/grace/lock banners, tier cards, add-on toggles,
 *  Razorpay hosted Checkout (no card data in our code), payment history,
 *  cancel-at-cycle-end. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { inr } from '../../lib/types';
import { Spinner, Wordmark } from '../../components';
import { entitlementsFor, type Entitlements } from '../../lib/entitlements';

interface Plan {
  id: string;
  kind: 'tier' | 'addon';
  name: string;
  price_inr: number;
  features: string[];
  sort_order: number;
}

interface PlanState {
  plan_tier: string;
  plan_status: string;
  trial_ends_at: string | null;
  grace_until: string | null;
  addons: string[];
}

/** Billing periods. The discounts are a commercial decision, not a technical
 *  one — they live here as one line each so they can be changed without
 *  touching anything else. Checkout still runs monthly: Razorpay is not wired
 *  for longer terms yet, so the longer periods are quoted honestly and settled
 *  by invoice rather than pretending the button does something it doesn't. */
const PERIODS = [
  { key: 'monthly', label: 'Monthly', months: 1, discount: 0 },
  { key: 'half', label: '6 months', months: 6, discount: 0.10 },
  { key: 'annual', label: 'Annual', months: 12, discount: 0.20 },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

/** Price for a whole term, rounded to the rupee. */
function termPrice(monthly: number, months: number, discount: number) {
  return Math.round(monthly * months * (1 - discount));
}

const FEATURE_LABELS: Record<string, string> = {
  qr_ordering: 'QR ordering & billing',
  dynamic_menu: 'Dynamic menu',
  instant_price_edit: 'Instant price editing',
  basic_theme: 'Theme customization',
  single_qr_set: '1 QR set',
  analytics: 'Analytics dashboards',
  multi_language: 'Multi-language menu',
  inventory_alerts: 'Inventory alerts',
  multi_qr: 'Multiple QR sets (bar / dining / rooftop)',
  excel_upload: 'Excel bulk menu upload',
  multi_location: 'Multi-location management',
  white_label: 'Custom branding / white-label',
  dedicated_manager: 'Dedicated account manager',
  priority_support: 'Priority support',
  pos_integration: 'POS integration (Petpooja / Vyapar / DotPe)',
  marketing_toolkit: 'SMS / WhatsApp marketing toolkit',
};

import { loadCheckout } from '../../lib/razorpayCheckout';

export function PlanScreen() {
  const nav = useNavigate();
  const [restaurant, setRestaurant] = useState<{ id: string; name: string } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<PlanState | null>(null);
  const [history, setHistory] = useState<{ event_type: string; processed_at: string }[]>([]);
  const [busyPlan, setBusyPlan] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('monthly');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) { nav('/partner', { replace: true }); return; }
    const uid = session.session.user.id;

    const { data: member } = await supabase
      .from('restaurant_member')
      .select('restaurant_id, restaurant(id, name)')
      .eq('user_id', uid)
      .eq('member_role', 'manager')
      .limit(1)
      .maybeSingle();
    if (!member) { setError('This account does not manage a restaurant.'); setLoading(false); return; }
    const r = (Array.isArray(member.restaurant) ? member.restaurant[0] : member.restaurant) as any;
    setRestaurant(r);

    const [{ data: planRows }, { data: planState }, { data: subs }] = await Promise.all([
      supabase.from('subscription_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.rpc('get_plan_state', { p_restaurant_id: r.id }),
      supabase.from('subscriptions').select('status, next_charge_at, plan_id').eq('restaurant_id', r.id),
    ]);
    setPlans((planRows ?? []) as Plan[]);
    setState(planState as PlanState);
    void subs; // next_charge_at shown via state below when present

    const { data: events } = await supabase
      .from('subscription_events')
      .select('event_type, processed_at')
      .order('processed_at', { ascending: false })
      .limit(10);
    setHistory(events ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const ent: Entitlements | null = useMemo(
    () => (state ? entitlementsFor(state) : null),
    [state],
  );

  const callFn = async (action: 'subscribe' | 'cancel', planId: string) => {
    setBusyPlan(planId);
    setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      const { data, error: fnErr } = await supabase.functions.invoke('create-subscription', {
        body: { action, restaurant_id: restaurant!.id, plan_id: planId },
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (fnErr) throw new Error((await fnErr?.context?.text?.()) || fnErr.message);
      if (action === 'cancel') { await load(); return; }

      await loadCheckout();
      const rzp = new window.Razorpay({
        key: data.razorpay_key_id,
        subscription_id: data.razorpay_subscription_id,
        name: 'Menutha',
        description: `${data.plan.name} — ${inr(data.plan.price_inr)}/month`,
        theme: { color: '#1B5E3F' },
        handler: () => { setTimeout(load, 2500); }, // webhook flips state; refresh shortly after
      });
      rzp.open();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong — please try again.');
    } finally {
      setBusyPlan('');
    }
  };

  if (loading) return <Spinner label="Loading your plan…" />;

  const daysLeft = (t: number | null) =>
    t === null ? null : Math.max(0, Math.ceil((t - Date.now()) / 864e5));

  return (
    <div className="page fade-in">
      <div className="topbar">
        <Wordmark size={22} />
        <button
          className="chip"
          onClick={async () => { await supabase.auth.signOut(); nav('/partner', { replace: true }); }}
        >
          Sign out
        </button>
      </div>

      <p className="overline" style={{ marginTop: 12 }}>{restaurant?.name ?? 'Restaurant Portal'}</p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>Plan & Billing</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
        Zero commission — diners always pay you directly. Your subscription is
        Menutha's only charge.
      </p>

      {ent?.state === 'trial' && (
        <div className="glass" style={{ padding: 14, marginTop: 14, borderColor: 'var(--gold)' }}>
          <strong style={{ color: '#8a6a25' }}>Free trial — full Growth features.</strong>{' '}
          <span className="muted" style={{ fontSize: 14 }}>
            {ent.trialEndsAt === null
              ? 'No end date set.'
              : `${daysLeft(ent.trialEndsAt)} day(s) left — pick a plan below to keep everything running.`}
          </span>
        </div>
      )}
      {ent?.state === 'grace' && (
        <div className="glass" style={{ padding: 14, marginTop: 14, borderColor: 'rgba(197,64,47,0.5)' }}>
          <strong style={{ color: 'var(--error)' }}>Payment problem.</strong>{' '}
          <span className="muted" style={{ fontSize: 14 }}>
            Your last charge failed. Everything keeps working for {daysLeft(ent.graceUntil)} more day(s) —
            update payment or re-subscribe below to avoid ordering being paused.
          </span>
        </div>
      )}
      {ent?.state === 'locked' && (
        <div className="glass" style={{ padding: 14, marginTop: 14, borderColor: 'rgba(197,64,47,0.6)' }}>
          <strong style={{ color: 'var(--error)' }}>Subscription paused.</strong>{' '}
          <span className="muted" style={{ fontSize: 14 }}>
            Your menu stays visible to diners, but new orders are disabled.
            Choose a plan below to switch ordering back on instantly.
          </span>
        </div>
      )}
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginTop: 12 }}>{error}</p>}

      <h2 className="cat-heading">Plans</h2>
      {/* Billing period. Longer terms are quoted at a discount; monthly is the
          only one the gateway can take today, so the others say so plainly
          rather than dropping the diner into a monthly checkout. */}
      <div className="seg" style={{ width: 'fit-content', marginBottom: 12 }}>
        {PERIODS.map((pd) => (
          <button
            key={pd.key}
            className={period === pd.key ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setPeriod(pd.key)}
          >
            {pd.label}{pd.discount > 0 ? ` · save ${Math.round(pd.discount * 100)}%` : ''}
          </button>
        ))}
      </div>
      <div className="menu-grid">
        {plans.filter((p) => p.kind === 'tier').map((p) => {
          const isCurrent = state?.plan_tier === p.id && ent?.state === 'active';
          const pd = PERIODS.find((x) => x.key === period)!;
          const term = termPrice(p.price_inr, pd.months, pd.discount);
          const perMonth = Math.round(term / pd.months);
          const saved = p.price_inr * pd.months - term;
          return (
            <div key={p.id} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, borderColor: isCurrent ? 'var(--primary)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <h3 className="display" style={{ fontSize: 21 }}>{p.name}</h3>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {inr(perMonth)}<span className="dim" style={{ fontSize: 12 }}>/mo</span>
                  </span>
                  {pd.months > 1 && p.price_inr > 0 && (
                    <span className="dim" style={{ display: 'block', fontSize: 11.5 }}>
                      {inr(term)} every {pd.months} months
                    </span>
                  )}
                </span>
              </div>
              {pd.months > 1 && saved > 0 && (
                <span className="badge gold" style={{ alignSelf: 'flex-start' }}>Saves {inr(saved)}</span>
              )}
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.features.map((f) => (
                  <li key={f} className="muted" style={{ fontSize: 13.5 }}>✓ {FEATURE_LABELS[f] ?? f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <button className="btn btn-ghost btn-block" disabled={busyPlan !== ''} onClick={() => callFn('cancel', p.id)}>
                  {busyPlan === p.id ? 'Working…' : 'Current plan · Cancel at cycle end'}
                </button>
              ) : pd.months > 1 ? (
                <>
                  <a className="btn btn-ghost btn-block" href="/contact/">
                    Ask us about {pd.label.toLowerCase()} billing
                  </a>
                  <p className="dim" style={{ fontSize: 11.5 }}>
                    Longer terms are invoiced directly — online checkout is monthly for now.
                  </p>
                </>
              ) : (
                <button className="btn btn-primary btn-block" disabled={busyPlan !== ''} onClick={() => callFn('subscribe', p.id)}>
                  {busyPlan === p.id ? 'Opening checkout…' : (ent?.state === 'active' ? `Switch to ${p.name}` : `Choose ${p.name}`)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="cat-heading">Add-ons</h2>
      <div className="menu-grid">
        {plans.filter((p) => p.kind === 'addon').map((p) => {
          const active = state?.addons?.includes(p.id);
          return (
            <div key={p.id} className="glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 15.5, fontWeight: 600 }}>{p.name}</h3>
                <p className="muted" style={{ fontSize: 13 }}>
                  {(p.features ?? []).map((f) => FEATURE_LABELS[f] ?? f).join(' · ')}
                  {p.price_inr > 0 ? ` · ${inr(p.price_inr)}/mo` : ''}
                </p>
              </div>
              <button
                className={active ? 'btn btn-ghost' : 'btn btn-primary'}
                disabled={busyPlan !== ''}
                onClick={() => callFn(active ? 'cancel' : 'subscribe', p.id)}
              >
                {busyPlan === p.id ? '…' : active ? 'Remove' : 'Add'}
              </button>
            </div>
          );
        })}
      </div>

      <h2 className="cat-heading">Payment history</h2>
      <div className="glass" style={{ padding: 16 }}>
        {history.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>No billing events yet.</p>
        ) : (
          history.map((h, i) => (
            <div key={i} className="bill-row">
              <span>{h.event_type.replace('subscription.', '').replace(/^\w/, (c) => c.toUpperCase())}</span>
              <span>{new Date(h.processed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          ))
        )}
      </div>

      <p className="dim" style={{ fontSize: 12, textAlign: 'center', margin: '18px 0 8px' }}>
        Payments are processed by Razorpay (UPI Autopay & cards). Menutha never
        stores your payment details.
      </p>
    </div>
  );
}
