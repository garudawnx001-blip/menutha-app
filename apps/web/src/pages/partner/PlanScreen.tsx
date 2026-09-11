/** Restaurant Portal — Plan & Billing (MODULE 1).
 *  Current plan + trial/grace/lock banners, tier cards, add-on toggles,
 *  Razorpay hosted Checkout (no card data in our code), payment history,
 *  cancel-at-cycle-end. */
import React, { useEffect, useMemo, useState } from 'react';
import { gstLines } from '../../lib/gst';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { inr } from '../../lib/types';
import { Spinner, Wordmark } from '../../components';
import { entitlementsFor, type Entitlements } from '../../lib/entitlements';

interface Plan {
  id: string;
  kind: 'tier' | 'addon';
  name: string;
  /** The BASE, pre-GST: what the card leads with and what the receipt calls
   *  the taxable value. */
  price_inr: number;
  /** What Razorpay actually collects, GST included. Authoritative -- it is the
   *  amount on the Razorpay plan, so it is displayed, never derived. */
  charge_inr: number | null;
  /** Which entitlement the row grants: a 6-month Growth plan is Growth. */
  tier: string | null;
  /** Billing cycle in months: 1 | 3 | 6 | 12. */
  duration_months: number;
  razorpay_plan_id: string | null;
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

/**
 * Billing durations, and every one of them is a REAL Razorpay plan now.
 *
 * This used to quote longer terms from a discount multiplier and then send
 * the owner to a contact page, because only monthly existed at the gateway.
 * All twelve (tier x duration) plans exist, so the term is a row in
 * subscription_plans with its own id, its own price and its own mandate --
 * nothing here computes a price any more, it only picks which rows to show.
 */
const DURATIONS = [
  { months: 1, label: 'Monthly' },
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
] as const;

const perMonthOf = (p: Plan) => Math.round(p.price_inr / Math.max(1, p.duration_months));

/** "Basic", not "basic": the tier is stored lower-case because it is a key,
 *  and a key is not a label. */
const tierLabel = (p: { tier: string | null; name: string }) =>
  (p.tier ? p.tier[0].toUpperCase() + p.tier.slice(1) : p.name);

/**
 * Money on the charge itemisation, to the paisa.
 *
 * `inr` drops trailing zeros, which is right for a price and wrong for a tax
 * line: "₹431.1" is not how 431 rupees and 10 paise is written on an invoice,
 * and "₹-0.2" puts the sign between the symbol and the number. Two decimals
 * always, sign outside.
 */
const paise = (n: number) =>
  `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/** The design preview's plans: the twelve rows the migration writes, so the
 *  preview shows the real durations and the real arithmetic. */
const PREVIEW_FEATURES: Record<string, string[]> = {
  basic: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'single_qr_set'],
  growth: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload'],
  enterprise: ['qr_ordering', 'dynamic_menu', 'instant_price_edit', 'basic_theme', 'analytics', 'multi_language', 'inventory_alerts', 'multi_qr', 'excel_upload', 'multi_location', 'white_label', 'dedicated_manager', 'priority_support'],
};
const PREVIEW_PLANS: Plan[] = ([
  ['basic', 1, 499, 589], ['growth', 1, 999, 1179], ['enterprise', 1, 2999, 3539],
  ['basic', 3, 1422, 1678], ['growth', 3, 2847, 3359], ['enterprise', 3, 8547, 10085],
  ['basic', 6, 2695, 3180], ['growth', 6, 5395, 6366], ['enterprise', 6, 16195, 19110],
  ['basic', 12, 4790, 5652], ['growth', 12, 9590, 11316], ['enterprise', 12, 28790, 33972],
] as [string, number, number, number][]).map(([tier, dm, base, charge]) => ({
  id: dm === 1 ? tier : `${tier}_${dm}m`,
  kind: 'tier' as const,
  name: tier[0].toUpperCase() + tier.slice(1) + (dm === 1 ? '' : ` · ${dm} months`),
  price_inr: base, charge_inr: charge, tier, duration_months: dm,
  razorpay_plan_id: 'plan_preview',
  features: PREVIEW_FEATURES[tier],
  sort_order: tier === 'basic' ? 1 : tier === 'growth' ? 2 : 3,
}));

export function PlanScreen({ preview }: { preview?: boolean } = {}) {
  const nav = useNavigate();
  const [restaurant, setRestaurant] = useState<{ id: string; name: string } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<PlanState | null>(null);
  const [history, setHistory] = useState<{ event_type: string; processed_at: string }[]>([]);
  const [busyPlan, setBusyPlan] = useState('');
  const [months, setMonths] = useState<number>(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /**
   * Whether autopay is armed. Feeds the entitlement below, so this page shows
   * the same state the rest of the portal is gated on.
   *
   * DECLARED HERE, WITH THE REST OF THE STATE, AND THAT POSITION IS THE WHOLE
   * POINT -- it is what took menutha.com down.
   *
   * It used to sit two hundred lines lower, beside activePlanId, which reads
   * fine in the source: `const` is hoisted, and the only consumer is a
   * useMemo. But a useMemo's DEPENDENCY ARRAY is evaluated eagerly, during
   * render, at the line it is written on -- so `[state, hasMandate]` touched
   * this binding while it was still in the temporal dead zone and threw
   * ReferenceError: Cannot access 'I' before initialization. An exception
   * during render with no error boundary above it unmounts the whole React
   * root, which is why a mistake on the plan screen showed up as a blank
   * LOG-IN page and took the entire site down rather than one route.
   *
   * TypeScript does not catch this and the build does not either: it is legal
   * code that only fails at runtime, and the minifier had merged the
   * declarations into one comma expression by the time it ran. The rule worth
   * keeping is the boring one -- all useState at the top, above the first
   * useMemo that reads any of it.
   */
  const [hasMandate, setHasMandate] = useState(false);

  // Subscribe buttons: until a plan has its razorpay_plan_id, the button reads
  // "opens soon" and explains when pressed rather than failing -- dropping the
  // ids into subscription_plans is the only thing that flips them live.
  const load = async () => {
    if (preview) {
      // Design preview: fixtures, no session. See DesignPreview. ?months= opens
      // on a given duration so every term can be looked at (and screenshotted).
      const want = Number(new URLSearchParams(window.location.search).get('months'));
      if ([1, 3, 6, 12].includes(want)) setMonths(want);
      setRestaurant({ id: 'preview', name: 'The Green Fork' } as any);
      setPlans(PREVIEW_PLANS as any);
      setState({
        plan_tier: 'trial', plan_status: 'trialing', grace_until: null, addons: [],
        trial_ends_at: new Date(Date.now() + 25 * 864e5).toISOString(),
        // A healthy mid-trial fixture: autopay already armed, or the preview
        // would show its own subject as locked.
        has_mandate: true,
      });
      setLoading(false);
      return;
    }
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) { nav('/partner', { replace: true }); return; }
    const uid = session.session.user.id;

    const { data: member } = await supabase
      .from('restaurant_member')
      .select('restaurant_id, restaurant(id, name)')
      .eq('user_id', uid)
      // owner OR manager -- the same pair create-subscription accepts. Filtering
      // to 'manager' alone meant an owner-membership account loaded the portal
      // shell (which accepts both) and was then told on this page that it
      // manages no restaurant, with no way to subscribe.
      .in('member_role', ['owner', 'manager'])
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
    // The row the live mandate is on, so Cancel appears on that card and not
    // on its three sibling durations.
    const live = (subs ?? []).find((sr: any) => ['authenticated', 'active', 'pending', 'halted'].includes(sr.status));
    setActivePlanId(live?.plan_id ?? null);
    /**
     * IS AUTOPAY ARMED -- the same question the shell's gate asks, and
     * deliberately the same two statuses, so this page and the gate cannot
     * disagree about whether somebody is let through.
     *
     * Narrower than `live` above: that one also counts `pending` and `halted`
     * so the Cancel button lands on the right card, and a subscription whose
     * charges are failing is a billing problem rather than proof of a healthy
     * mandate.
     */
    setHasMandate((subs ?? []).some((sr: any) => ['authenticated', 'active'].includes(sr.status)));
    // Open on the duration already being paid for, so a 12-month subscriber
    // does not land on Monthly and think their plan has vanished.
    const liveMonths = (planRows ?? []).find((pr: any) => pr.id === live?.plan_id)?.duration_months;
    if (liveMonths) setMonths(liveMonths as number);

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
    () => (state ? entitlementsFor({ ...(state as any), has_mandate: hasMandate }) : null),
    [state, hasMandate],
  );

  /**
   * Did they arrive here because the gate sent them, rather than to look?
   *
   * `setup` is a trial running with no mandate -- a brand-new sign-up, and the
   * only reason this page is the last step of registration. The page then
   * leads with starting the trial rather than with a price list, because
   * somebody who has just typed in their restaurant's address is not shopping.
   */
  const mustSetUp = ent?.state === 'setup';
  const lapsed = ent?.state === 'locked';

  /** Tier rows only, cheapest tier first then longest term -- add-ons have
   *  their own grid below and no duration. */
  const tiers = useMemo(
    () => plans.filter((p) => p.kind === 'tier')
      .sort((a, b) => a.sort_order - b.sort_order || a.duration_months - b.duration_months),
    [plans],
  );
  /** The monthly BASE for a tier, used only to say what a longer term saves.
   *  Read from the monthly row rather than divided out of the longer one, so
   *  the saving is the real difference between two real prices. */
  const monthlyBaseFor = (tier: string | null) =>
    (tier ? tiers.find((p) => p.tier === tier && p.duration_months === 1)?.price_inr ?? 0 : 0);

  /** The one line every card carries about when money actually moves. The
   *  trial is ours (start_at on the subscription), so a mandate set up today
   *  authorises a nominal amount that Razorpay refunds, and the first real
   *  charge waits for the trial to end. */
  const trialNote = useMemo(() => {
    // Computed here rather than through daysLeft(), which is declared further
    // down: a const arrow function is not hoisted, and reading it from a memo
    // that runs during this render would throw before it exists.
    const end = state?.trial_ends_at ? Date.parse(state.trial_ends_at) : NaN;
    const left = Number.isFinite(end) ? Math.max(0, Math.ceil((end - Date.now()) / 864e5)) : 0;
    /**
     * SAY IT THE WAY A STREAMING SERVICE SAYS IT.
     *
     * "Nothing is charged today" is true and still reads as a caveat -- the
     * owner had just watched a sheet say "Processing your payment ₹3,539" and
     * did not believe it. The shape people already trust is one sentence with
     * three facts in a fixed order: what is free, for how long, what happens
     * after, and that they can stop. No asterisk, no arithmetic.
     *
     * The backend already defers the first debit (start_at, deployed), so this
     * is only the promise being said plainly enough to be believed.
     */
    return left > 0
      ? `Free for ${left} more day(s) — then billing starts. Cancel any time.`
      : 'Free for 30 days — then billing starts. Cancel any time.';
  }, [state]);

  /** Which plan row the live subscription is actually on, so only that card
   *  offers Cancel. Null while unknown, which is why the card falls back to
   *  the tier match. */
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

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

      /**
       * ALREADY PAID -- do not open a second checkout.
       *
       * The function now refuses to mint a second mandate for a restaurant
       * that has one, and says so with this flag instead of a subscription id.
       * Opening Razorpay anyway would show an empty sheet; worse, it would
       * invite a second ₹5 authorisation for a mandate they already hold.
       *
       * This is reachable by ordinary means, not just by double-tapping: an
       * owner whose payment succeeded while the webhook was still in flight
       * sits on this screen looking at plan cards, and pressing one is the
       * obvious thing to do.
       */
      if ((data as any)?.already_subscribed) {
        await load();
        nav('/partner/orders', { replace: true });
        return;
      }

      await loadCheckout();
      const rzp = new window.Razorpay({
        key: data.razorpay_key_id,
        subscription_id: data.razorpay_subscription_id,
        name: 'Menutha',
        // THE LOGO ON THE PAYMENT PAGE. Razorpay draws whatever `image` points
        // at beside the business name; with none set the checkout showed a
        // generic placeholder, so the one screen where somebody is handing
        // over money was the least recognisably ours. A hosted URL rather
        // than a data URI -- Razorpay fetches it server-side for the hosted
        // page and for email receipts.
        image: 'https://menutha.com/menutha-mark.svg',

        /**
         * THE PROMISE LEADS, THE PRICE FOLLOWS — on Razorpay's own sheet.
         *
         * This is the screen the owner photographed with "Processing your
         * payment ₹3,539" on it, and the description is the one line we
         * control there. It used to open with a plan name and a price, which
         * is exactly what somebody expecting a free month reads as a charge.
         *
         * Saying "Free for 30 days" first puts the reassurance on the payment
         * sheet itself rather than only on the page they came from. The figure
         * is still what the mandate takes — the plan row's charged amount, GST
         * included, for the term being bought — just said in the order that
         * makes it legible.
         */
        description: (() => {
          const row = plans.find((x) => x.id === planId);
          const total = row ? gstLines(row.price_inr, row.charge_inr).total : data.plan?.price_inr;
          const per = row && row.duration_months > 1 ? `every ${row.duration_months} months` : 'a month';
          const name = data.plan?.name ?? row?.name ?? 'Menutha';
          return `Free for 30 days — then ${inr(total)} ${per}. Cancel any time. (${name})`;
        })(),
        // Terracotta, the accent every button in both products already uses.
        // The forest green here matched nothing -- it was the only place in
        // the payment flow wearing a second brand colour.
        theme: { color: '#D97757' },

        /**
         * NO METHOD CONFIG. Razorpay's default checkout, on purpose.
         *
         * A config.display block lived here that ordered UPI before Card and
         * excluded the scan-QR tab, because a QR cannot register a subscription
         * mandate and the one shown errored when scanned.
         *
         * It cost far more than it bought. A block whose instruments match
         * nothing renders EMPTY and Razorpay drops it, so asking for one UPI
         * flow and getting none of it removed the whole UPI section -- and with
         * show_default_blocks false there was nothing behind it. Desktop checkout
         * went to Cards only: no UPI, no EMandate, nothing. Trading every payment
         * method for the absence of one confusing tab.
         *
         * So the default list stands, QR included. Its mandate error is a
         * Razorpay quirk on one sub-tab; the owner can still pay by any of the
         * other methods on the sheet. Do not narrow this again without being
         * able to SEE the rendered sheet afterwards -- what a block resolves to
         * depends on the account, the device and NPCI's rules on the day, and
         * none of those are visible from here.
         */
        /**
         * THE LAST JUNCTION: mandate signed, now let them in.
         *
         * Razorpay hands control back the moment the owner finishes; OUR state
         * changes a moment later, when Razorpay's webhook reaches the edge
         * function and flips subscriptions.status. So there is nothing to read
         * yet at the instant this fires, and the old single 2.5s refresh was a
         * guess at how long that takes -- on a slow hop it reloaded a page
         * that still said "no plan", which for a new sign-up is the gate
         * refusing to open for no visible reason.
         *
         * So poll, briefly, for the state we actually need rather than for a
         * fixed delay, and send them to the dashboard the moment it arrives.
         * If it never does, stop and leave the page showing its own state --
         * the webhook may be slow or misconfigured, and a spinner that never
         * ends tells the owner less than a plan page does.
         */
        handler: () => {
          let tries = 0;
          const poll = async () => {
            tries += 1;
            await load();
            const { data: fresh } = await supabase
              .from('subscriptions').select('status')
              .eq('restaurant_id', restaurant!.id)
              .in('status', ['authenticated', 'active']).limit(1);
            if ((fresh?.length ?? 0) > 0) { nav('/partner/orders', { replace: true }); return; }
            if (tries < 6) { setTimeout(poll, 2500); return; }
            /**
             * THE MANDATE WENT THROUGH AND OUR CONFIRMATION DID NOT ARRIVE.
             *
             * Only Razorpay's webhook flips subscriptions.status, so if it is
             * slow, misconfigured, or its secret is wrong, this owner has just
             * authorised autopay and is still looking at the screen that asked
             * them to. Silence here is the worst possible answer: the obvious
             * thing to try is paying again, and a second mandate on the same
             * restaurant is a real mess to unpick.
             *
             * So say plainly that the payment side is done, that the wait is
             * ours, and that refreshing is the whole remedy.
             */
            setError(
              'Autopay was set up successfully — we just have not had confirmation back yet. '
              + 'This usually clears within a minute: refresh this page and it should show as active. '
              + 'Please do NOT set up a second plan. If it is still not showing in a few minutes, contact support.',
            );
          };
          setTimeout(poll, 2000);
        },
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
          className="btn btn-glass btn-sm"
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

      {/* THE OFFER, STATED ONCE AND LOUDLY, ABOVE THE CARDS.

          Every plan on this page is free for the first 30 days -- the
          deferral is per-subscription (start_at), so it applies whichever tier
          and whichever billing cycle is chosen, not only the cheapest. That is
          worth saying at the top, because a page of prices with a small note
          under each button reads as a page of prices.

          Three facts, the order every streaming service uses: it is free, for
          how long, and that stopping is allowed. What it costs afterwards
          belongs on the card, where it differs per plan. */}
      {/* THE NEW SIGN-UP, and the reason this page is now the last step of
          registering rather than a tab somebody might visit.

          `setup` is a trial whose thirty days are already running with nothing
          armed to charge on day thirty. Under the gate it holds no features,
          so this is the only page they can reach -- which makes the copy
          matter: they have just finished typing in their restaurant, they are
          not shopping, and the honest thing to say is that this is the last
          step and it costs nothing today.

          Deliberately not phrased as a warning. Nothing has gone wrong. */}
      {mustSetUp && (
        <div className="glass" style={{ padding: 16, marginTop: 14, borderColor: 'var(--gold)' }}>
          <strong style={{ color: '#8a6a25', fontSize: 16 }}>
            One last step — start your 30-day free trial
          </strong>
          <p className="muted" style={{ fontSize: 14, margin: '6px 0 0' }}>
            Pick a plan below to begin. <strong>You are not charged today</strong> — setting
            up autopay is what starts the free 30 days, and the first payment is
            taken only when they end. Cancel any time before then and you pay
            nothing at all.
          </p>
          {/* THE ONE NUMBER THAT LOOKS LIKE A CHARGE AND IS NOT.
              Razorpay registers a UPI AutoPay mandate THROUGH a small debit --
              a few rupees, refunded automatically, which their own docs tell
              merchants not to capture. We cannot set or waive that amount:
              there is no API field for it and the minimum mandate value is ₹1,
              because a mandate cannot be registered on nothing.
              So the only honest fix is to say what it is here, before the
              checkout sheet shows it and somebody reads "₹5" as the start of
              being billed. */}
          {/* PROMOTED FROM A FOOTNOTE. This was one grey line under the offer,
              which is the wrong weight for the only number on the whole flow
              that LOOKS like a charge and is not. An owner who meets an
              unexplained ₹5 on the payment sheet does not read the small print
              above it -- they stop, or they pay twice trying to work out what
              happened. Both of those cost more than the space this takes. */}
          <div className="plan-refund">
            <p className="plan-refund-lead">
              <strong>₹0 today</strong> for your 30-day free trial.
            </p>
            <p className="plan-refund-line">
              To set up autopay, <strong>₹5 is temporarily debited</strong> to verify your
              UPI or card — <strong className="plan-refund-key">and it is refunded automatically.</strong>
            </p>
            <p className="plan-refund-foot">
              You are only charged your plan price after the 30 days. Cancel any time.
            </p>
          </div>
        </div>
      )}

      {/* COMING BACK AFTER A LAPSE. Different message, same page: they have
          used the product, so the thing to say is what is paused and that
          nothing was thrown away. */}
      {lapsed && (
        <div className="glass" style={{ padding: 16, marginTop: 14, borderColor: 'rgba(197,64,47,0.5)' }}>
          <strong style={{ color: 'var(--error)', fontSize: 16 }}>
            Choose a plan to switch everything back on
          </strong>
          <p className="muted" style={{ fontSize: 14, margin: '6px 0 0' }}>
            Your menu, tables, orders and settings are all exactly as you left them —
            nothing has been deleted. Ordering is paused until a plan is active.
          </p>
        </div>
      )}

      {ent?.state === 'trial' && (
        <div className="glass" style={{ padding: 16, marginTop: 14, borderColor: 'var(--gold)' }}>
          <strong style={{ color: '#8a6a25', fontSize: 16 }}>
            {ent.trialEndsAt === null
              ? 'Free for your first 30 days'
              : `Free for ${daysLeft(ent.trialEndsAt)} more day(s)`}
          </strong>
          <p className="muted" style={{ fontSize: 14, margin: '6px 0 0' }}>
            Every plan below starts free — any tier, any billing cycle. Nothing is
            charged today: you set up autopay now and the first payment is taken
            when the free period ends. Cancel any time before then and you pay
            nothing at all.
          </p>
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
      {error && <p className="inline-error" style={{ marginTop: 12 }}>{error}</p>}

      <h2 className="cat-heading">Plans</h2>
      {/* HOW LONG YOU PAY FOR, and each one is a real plan at the gateway.
          A duration with no rows is not offered -- before the migration runs
          only monthly exists, and a tab that leads to an empty grid is worse
          than a tab that is not there. */}
      <div className="seg" style={{ width: 'fit-content', marginBottom: 12 }}>
        {DURATIONS.filter((d) => tiers.some((p) => p.duration_months === d.months)).map((d) => (
          <button
            key={d.months}
            className={months === d.months ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setMonths(d.months)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="menu-grid">
        {tiers.filter((p) => p.duration_months === months).map((p) => {
          /** The tier this row grants, and whether THIS row is the one being
           *  billed -- not merely its tier, or all four durations of a tier
           *  would claim to be current and three of their Cancel presses
           *  would 404 on a subscription that does not exist. */
          const isTier = !!p.tier && state?.plan_tier === p.tier && ent?.state === 'active';
          const isCurrent = isTier && (!activePlanId || activePlanId === p.id);
          const g = gstLines(p.price_inr, p.charge_inr);
          const perMonth = perMonthOf(p);
          /** Saving against paying monthly for the same length of time. Off
           *  the BASE, because that is the number being compared. */
          const monthlyBase = monthlyBaseFor(p.tier);
          const saved = monthlyBase ? monthlyBase * p.duration_months - p.price_inr : 0;
          return (
            <div key={p.id} className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, borderColor: isCurrent ? 'var(--primary)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <h3 className="display" style={{ fontSize: 21 }}>
                  {tierLabel(p)}
                  {/* ONE RECOMMENDATION, and Growth because it is the tier
                      that actually fits a single restaurant taking orders all
                      day -- Basic has no analytics and no Excel import, which
                      is the first thing an owner with 164 dishes asks for.
                      A page where every card shouts is a page with no
                      recommendation at all, so only this one is marked. */}
                  {p.tier === 'growth' && (
                    <span className="badge plan-pick">Most restaurants pick this</span>
                  )}
                </h3>
                <span style={{ textAlign: 'right' }}>
                  {/* THE BASE LEADS, and the total is directly under it. The
                      base is the price this product quotes everywhere -- the
                      pricing page, the marketing site -- so leading with it is
                      what makes those pages and this one agree. The charged
                      total is never more than a line away, because the mandate
                      amount is the one that must be no surprise. */}
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {inr(p.price_inr)}
                    <span className="dim" style={{ fontSize: 12 }}>
                      {p.duration_months === 1 ? '/mo' : ` / ${p.duration_months} months`}
                    </span>
                  </span>
                  <span className="dim" style={{ display: 'block', fontSize: 11.5 }}>
                    + 18% GST · {inr(g.total)} billed
                  </span>
                  {p.duration_months > 1 && (
                    <span className="dim" style={{ display: 'block', fontSize: 11.5 }}>
                      works out at {inr(perMonth)}/month
                    </span>
                  )}
                </span>
              </div>
              {/* WHAT TODAY COSTS -- the only number most people are actually
                  asking, and it was nowhere on this card. Everything above is
                  what happens in a month's time; this is the answer to "what
                  do I pay to start", said once, in the largest type on the
                  card, with the price it replaces struck through beside it.

                  The struck figure is the GST-INCLUSIVE total, not the base:
                  it has to be the number they would otherwise have been
                  charged today, or the comparison is a smaller saving than it
                  looks and the card is quietly overselling. */}
              <div className="plan-today">
                <s className="plan-today-was">{inr(g.total)}</s>
                <strong className="plan-today-now">₹0 today</strong>
                <span className="plan-today-free">free for 30 days</span>
              </div>
              {/* The whole offer in one sentence a tired person can read at
                  the end of service. Deliberately above the feature list: the
                  decision is made on this line, not on the features. */}
              <p className="plan-plain">
                Free for 30 days. Then <strong>{inr(g.total)}</strong>
                {p.duration_months === 1 ? ' a month' : ` every ${p.duration_months} months`}.
                Cancel any time before then and you pay nothing.
              </p>
              {saved > 0 && (
                <span className="badge gold" style={{ alignSelf: 'flex-start' }}>Saves {inr(saved)} vs monthly</span>
              )}
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.features.map((f) => (
                  <li key={f} className="muted" style={{ fontSize: 13.5 }}>✓ {FEATURE_LABELS[f] ?? f}</li>
                ))}
              </ul>

              {/* WHAT THE MANDATE WILL TAKE, itemised the way the receipt
                  itemises it. CGST and SGST are the two halves Indian GST is
                  charged in; the round-off is shown rather than folded into
                  the tax line so the invoice reconciles to the paisa. */}
              <div className="plan-charge">
                <div><span>Plan{p.duration_months > 1 ? ` · ${p.duration_months} months` : ''}</span><span>{paise(g.base)}</span></div>
                <div><span>CGST 9%</span><span>{paise(g.cgst)}</span></div>
                <div><span>SGST 9%</span><span>{paise(g.sgst)}</span></div>
                {g.roundOff !== 0 && <div><span>Round off</span><span>{paise(g.roundOff)}</span></div>}
                <div className="plan-charge-total"><span>Total {p.duration_months === 1 ? 'per month' : `every ${p.duration_months} months`}</span><span>{inr(g.total)}</span></div>
              </div>

              {isCurrent ? (
                <button className="btn btn-ghost btn-block" disabled={busyPlan !== ''} onClick={() => callFn('cancel', p.id)}>
                  {busyPlan === p.id ? 'Working…' : 'Current plan · Cancel at cycle end'}
                </button>
              ) : (
                <button className="btn btn-primary btn-block" disabled={busyPlan !== ''}
                  onClick={() => (p.razorpay_plan_id
                    ? callFn('subscribe', p.id)
                    : setError('Online subscription is being switched on. Your 30-day trial continues meanwhile, and nothing is charged.'))}>
                  {busyPlan === p.id ? 'Opening checkout…'
                    : !p.razorpay_plan_id ? 'Online payment opens soon'
                    : (ent?.state === 'active' ? 'Switch to this plan' : `Choose ${tierLabel(p)}`)}
                </button>
              )}
              {/* AND AGAIN, DIRECTLY UNDER THE BUTTON THAT OPENS RAZORPAY.
                  The banner explains it once at the top; this is the last
                  thing read before the sheet appears, which is the moment the
                  ₹5 is actually met. Six words, so it can be taken in at a
                  glance rather than read. */}
              {!isCurrent && p.razorpay_plan_id && (
                <p className="plan-refund-cta">₹5 verification hold, fully refunded.</p>
              )}
              {/* THE WHOLE PROMISE, ON THE CARD IT APPLIES TO. The note used to
                  say only that nothing is charged today; naming THIS plan's own
                  price and cycle is what turns a caveat into an offer somebody
                  can act on without doing arithmetic of their own. */}
              <p className="dim" style={{ fontSize: 11.5, margin: 0 }}>
                {trialNote.replace(
                  'billing starts',
                  `${inr(g.total)} ${p.duration_months > 1 ? `every ${p.duration_months} months` : 'a month'}`,
                )}
              </p>
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
