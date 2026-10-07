/**
 * /admin/payments — every subscription payment, read-only.
 *
 * Built from what the Razorpay webhook already records (subscription_events)
 * and the subscriptions table. Nothing on this page can move money: there is
 * no refund, retry or cancel button by design. For anything deeper, each row
 * links to the same item in the Razorpay dashboard.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleError } from './adminApi';
import { contentApi, mockPayments, type PayEvent, type PayKind, type PaySub, type PaymentsOverview } from './contentApi';
import { fmtDate, fmtDateTime, fmtInr, fmtNum, relDays } from './format';
import { Icon } from './icons';
import { downloadCsv } from './csv';
import { useConsole } from './ui';
import './step6.css';

const RZP = 'https://dashboard.razorpay.com/app';
const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', emandate: 'Bank mandate', nach: 'Bank mandate', wallet: 'Wallet' };
const methodName = (m: string | null) => (m ? METHOD[m.toLowerCase()] ?? m : '—');

export const KIND_TEXT: Record<PayKind, string> = {
  paid: 'Paid', failed: 'Payment failed', retrying: 'Retrying payment', stopped: 'Payment stopped',
  setup: 'Autopay set up (₹0)', started: 'Plan started', cancelled: 'Cancelled',
};
const KIND_HINT: Record<PayKind, string> = {
  paid: 'Money received', failed: 'The bank or card said no',
  retrying: 'Razorpay will try again on its own', stopped: 'All retries failed — the restaurant must fix it',
  setup: 'No money yet — first payment comes later', started: 'Subscription switched on',
  cancelled: 'Will not charge again',
};
const KIND_TONE: Record<PayKind, string> = {
  paid: 'green', failed: 'red', retrying: 'amber', stopped: 'red', setup: 'blue', started: 'blue', cancelled: 'grey',
};

const SUB_TEXT: Record<string, string> = {
  created: 'Checkout started, not finished', authenticated: 'Autopay set up — first payment not taken yet',
  active: 'Paying', pending: 'Payment failed — Razorpay is retrying', halted: 'Payment stopped — all retries failed',
  cancelled: 'Cancelled', completed: 'Finished',
};
const SUB_TONE: Record<string, string> = {
  created: 'grey', authenticated: 'blue', active: 'green', pending: 'amber', halted: 'red', cancelled: 'grey', completed: 'grey',
};

type Tab = 'all' | 'problems' | 'upcoming' | 'restaurant';
type Period = 'this' | 'last' | '90' | 'all';
const PERIOD_TEXT: Record<Period, string> = { this: 'This month', last: 'Last month', '90': 'Last 90 days', all: 'All time' };
const PROBLEM: PayKind[] = ['failed', 'retrying', 'stopped'];

export function Payments() {
  const { lostAccess, mocked } = useConsole();
  const [o, setO] = useState<PaymentsOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | PayKind>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [rid, setRid] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setO(mocked ? mockPayments() : await contentApi.payments()); }
    catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load payments.');
    } finally { setBusy(false); }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const inPeriod = useCallback((at: string) => {
    if (!o) return true;
    const t = Date.parse(at);
    if (period === 'this') return t >= Date.parse(o.month_start);
    if (period === 'last') return t >= Date.parse(o.last_month_start) && t < Date.parse(o.month_start);
    if (period === '90') return t >= now - 90 * 864e5;
    return true;
  }, [o, period, now]);

  const match = useCallback((e: { restaurant_name: string | null; plan_name: string | null; razorpay_payment_id?: string | null; razorpay_subscription_id: string | null }) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.restaurant_name, e.plan_name, e.razorpay_payment_id, e.razorpay_subscription_id].some((v) => v && v.toLowerCase().includes(q));
  }, [query]);

  const events = useMemo(() => (o?.events ?? []).filter((e) =>
    inPeriod(e.at) && match(e) && (kind === 'all' || e.kind === kind)), [o, inPeriod, match, kind]);

  const problems = useMemo(() => ({
    events: (o?.events ?? []).filter((e) => PROBLEM.includes(e.kind) && match(e)),
    subs: (o?.subscriptions ?? []).filter((s) => (s.status === 'pending' || s.status === 'halted') && match(s)),
  }), [o, match]);

  const upcoming = useMemo(() => (o?.subscriptions ?? [])
    .filter((s) => ['active', 'authenticated', 'pending'].includes(s.status) && s.next_charge_at && Date.parse(s.next_charge_at) >= now - 864e5 && match(s))
    .sort((a, b) => Date.parse(a.next_charge_at!) - Date.parse(b.next_charge_at!)), [o, match, now]);

  const restaurants = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of o?.events ?? []) if (e.restaurant_id) m.set(e.restaurant_id, e.restaurant_name ?? 'Restaurant');
    for (const s of o?.subscriptions ?? []) if (s.restaurant_id) m.set(s.restaurant_id, s.restaurant_name ?? 'Restaurant');
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [o]);

  const next30 = upcoming.filter((s) => Date.parse(s.next_charge_at!) <= now + 30 * 864e5).reduce((t, s) => t + (s.amount_inr ?? 0), 0);
  const problemCount = problems.subs.length + problems.events.filter((e) => Date.parse(e.at) >= now - 30 * 864e5).length;
  const change = o ? o.revenue_this_month - o.revenue_last_month : 0;

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (tab === 'upcoming') {
      downloadCsv(`menutha-upcoming-renewals-${stamp}.csv`,
        ['Next payment date', 'Restaurant', 'Plan', 'Amount (INR, incl. GST)', 'Status', 'Offer code', 'Razorpay subscription'],
        upcoming.map((s) => [s.next_charge_at?.slice(0, 10) ?? '', s.restaurant_name ?? '', s.plan_name ?? s.plan_id,
          (s.amount_inr ?? 0).toFixed(2), SUB_TEXT[s.status] ?? s.status, s.offer_code ?? '', s.razorpay_subscription_id ?? '']));
      return;
    }
    const list = tab === 'problems' ? problems.events : tab === 'restaurant' ? (o?.events ?? []).filter((e) => e.restaurant_id === rid) : events;
    downloadCsv(`menutha-payments-${tab}-${stamp}.csv`,
      ['Date and time', 'Restaurant', 'What happened', 'Plan', 'Amount (INR, incl. GST)', 'Paid with', 'Reason', 'Razorpay payment', 'Razorpay subscription'],
      list.map((e) => [new Date(e.at).toLocaleString('en-IN'), e.restaurant_name ?? '', KIND_TEXT[e.kind], e.plan_name ?? '',
        e.amount_inr.toFixed(2), e.method ?? '', e.error ?? '', e.razorpay_payment_id ?? '', e.razorpay_subscription_id ?? '']));
  };

  return (
    <div className="mc-page">
      <div className="mc-heading">
        <div>
          <h1 className="mc-display">Payments</h1>
          <p className="mc-muted">Every plan payment from every restaurant. This page only shows — it never charges or refunds anyone.</p>
        </div>
        <a className="mc-btn mc-btn-ghost" href={`${RZP}/dashboard`} target="_blank" rel="noreferrer">
          <Icon name="card" size={16} />Open Razorpay
        </a>
      </div>

      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}

      <section className="mc-big-cards s6-four" aria-label="Money">
        <Card tone="feature" icon="rupee" label="Money received this month" value={o ? fmtInr(o.revenue_this_month) : '…'}
          sub={o ? (change === 0 ? 'Same as last month' : `${change > 0 ? '▲' : '▼'} ${fmtInr(Math.abs(change))} compared with last month`) : ''} />
        <Card icon="calendar" label="Money received last month" value={o ? fmtInr(o.revenue_last_month) : '…'} sub="Whole calendar month (India time)" />
        <Card tone="blue" icon="clock" label="Expected in the next 30 days" value={o ? fmtInr(next30) : '…'}
          sub={`${fmtNum(upcoming.filter((s) => Date.parse(s.next_charge_at!) <= now + 30 * 864e5).length)} payment(s) due`} onClick={() => setTab('upcoming')} />
        <Card tone={problemCount ? 'red' : 'green'} icon={problemCount ? 'alert' : 'check'} label="Payment problems"
          value={o ? fmtNum(problemCount) : '…'} sub={problemCount ? 'Failed or stopped — tap to see who' : 'Nothing to follow up'} onClick={() => setTab('problems')} />
      </section>

      <div className="mc-seg" role="tablist" aria-label="Show">
        {([['all', 'All payments'], ['problems', `Problems${problemCount ? ` (${problemCount})` : ''}`], ['upcoming', 'Coming up'], ['restaurant', 'One restaurant']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <section className="mc-panel">
        <div className="mc-toolbar">
          {tab !== 'restaurant' ? (
            <div className="mc-search">
              <Icon name="search" size={17} />
              <input type="search" placeholder="Search restaurant, plan or Razorpay ID…" value={query}
                onChange={(e) => setQuery(e.target.value)} aria-label="Search payments" />
            </div>
          ) : (
            <label className="mc-select" style={{ flex: 1 }}>
              <span>Restaurant</span>
              <select value={rid} onChange={(e) => setRid(e.target.value)}>
                <option value="">Choose a restaurant…</option>
                {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          {tab === 'all' && (
            <>
              <label className="mc-select"><span>When</span>
                <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                  {(Object.keys(PERIOD_TEXT) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_TEXT[p]}</option>)}
                </select></label>
              <label className="mc-select"><span>What</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as 'all' | PayKind)}>
                  <option value="all">Everything</option>
                  {(Object.keys(KIND_TEXT) as PayKind[]).map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}
                </select></label>
            </>
          )}
          <button className="mc-btn mc-btn-ghost" onClick={exportCsv} disabled={!o || (tab === 'restaurant' && !rid)}>
            <Icon name="copy" size={16} />Download (CSV)
          </button>
          <button className="mc-btn mc-btn-ghost" onClick={() => void load()} disabled={busy} title="Get the latest">
            <Icon name="refresh" size={16} className={busy ? 'mc-spin' : ''} />
          </button>
        </div>

        {!o ? <div className="mc-attn-empty"><span className="mc-spinner" /></div>
          : tab === 'all' ? <EventTable list={events} empty={o.events.length ? 'Nothing matches. Try “All time” or clear the search.' : 'No payments yet. When a restaurant pays, it shows here within a minute.'} />
          : tab === 'problems' ? <Problems events={problems.events} subs={problems.subs} />
          : tab === 'upcoming' ? <Upcoming list={upcoming} />
          : <OneRestaurant rid={rid} o={o} />}
      </section>
      <p className="mc-small mc-muted" style={{ marginTop: 10 }}>
        Amounts include GST. “Autopay set up” is the ₹0 check Razorpay does when an owner signs up — the first real payment comes after the free trial.
      </p>
    </div>
  );
}

function Card({ icon, label, value, sub, tone, onClick }: {
  icon: string; label: string; value: string; sub?: string; tone?: 'feature' | 'red' | 'green' | 'blue'; onClick?: () => void;
}) {
  const cls = `mc-bigcard${tone === 'feature' ? ' mc-bigcard-feature' : tone ? ` mc-tone-${tone}` : ''}`;
  const inner = (
    <>
      <span className="mc-bigcard-top"><span className="mc-bigcard-icon"><Icon name={icon} size={18} /></span>{label}</span>
      <span className="mc-bigcard-value">{value}</span>
      {sub && <span className="mc-bigcard-sub">{sub}</span>}
    </>
  );
  return onClick ? <button className={cls} onClick={onClick}>{inner}</button> : <div className={cls}>{inner}</div>;
}

function KindBadge({ k }: { k: PayKind }) {
  return <span className={`s6-pill s6-${KIND_TONE[k]}`} title={KIND_HINT[k]}>{KIND_TEXT[k]}</span>;
}
function SubBadge({ s }: { s: string }) {
  return <span className={`s6-pill s6-${SUB_TONE[s] ?? 'grey'}`}>{SUB_TEXT[s] ?? s}</span>;
}

function RzpLink({ e }: { e: { razorpay_payment_id?: string | null; razorpay_subscription_id: string | null } }) {
  const href = e.razorpay_payment_id ? `${RZP}/payments/${e.razorpay_payment_id}`
    : e.razorpay_subscription_id ? `${RZP}/subscriptions/${e.razorpay_subscription_id}` : null;
  return href ? <a className="mc-link" href={href} target="_blank" rel="noreferrer">See in Razorpay ↗</a> : <span className="mc-dim">—</span>;
}

function EventTable({ list, empty }: { list: PayEvent[]; empty: string }) {
  const { openRestaurant, data } = useConsole();
  const known = useMemo(() => new Set((data?.restaurants ?? []).map((r) => r.id)), [data]);
  if (!list.length) return <div className="mc-empty"><Icon name="card" size={28} /><p>{empty}</p></div>;
  const total = list.filter((e) => e.kind === 'paid').reduce((t, e) => t + e.amount_inr, 0);
  return (
    <>
      <div className="mc-table-wrap s6-scroll">
        <table className="mc-table">
          <thead><tr><th>When</th><th>Restaurant</th><th>What happened</th><th>Plan</th><th className="mc-num">Amount</th><th>Paid with</th><th>Razorpay</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td className="mc-nowrap"><div className="mc-cell-main">{fmtDate(e.at)}</div><div className="mc-cell-sub">{fmtDateTime(e.at).split(', ').pop()}</div></td>
                <td>{e.restaurant_id && known.has(e.restaurant_id)
                  ? <button className="mc-link" onClick={() => openRestaurant(e.restaurant_id!)}>{e.restaurant_name}</button>
                  : <span>{e.restaurant_name ?? 'Unknown restaurant'}</span>}</td>
                <td><KindBadge k={e.kind} />{e.error && <div className="mc-cell-sub">{e.error}</div>}</td>
                <td>{e.plan_name ?? '—'}</td>
                <td className="mc-num">{e.amount_inr ? fmtInr(e.amount_inr) : '—'}</td>
                <td>{methodName(e.method)}</td>
                <td><RzpLink e={e} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mc-foot">{fmtNum(list.length)} item(s){total ? ` · ${fmtInr(total)} received` : ''}</div>
    </>
  );
}

function Problems({ events, subs }: { events: PayEvent[]; subs: PaySub[] }) {
  if (!events.length && !subs.length) {
    return <div className="mc-empty"><Icon name="check" size={28} /><p><strong>No payment problems.</strong><br />Every restaurant’s autopay is working.</p></div>;
  }
  return (
    <div className="s6-pad">
      {subs.length > 0 && (
        <>
          <p className="mc-subhead">Restaurants to call now</p>
          <ul className="s6-list">
            {subs.map((s) => (
              <li key={s.id} className="s6-list-row">
                <span className="s6-list-main"><strong>{s.restaurant_name ?? 'Restaurant'}</strong><small>{s.plan_name} · {s.amount_inr ? fmtInr(s.amount_inr) : '—'}</small></span>
                <SubBadge s={s.status} />
                {s.razorpay_subscription_id && <a className="mc-link" href={`${RZP}/subscriptions/${s.razorpay_subscription_id}`} target="_blank" rel="noreferrer">Razorpay ↗</a>}
              </li>
            ))}
          </ul>
          <p className="mc-note">Their orders keep working during the grace days. Ask the owner to open <strong>Plan</strong> in their app and fix the payment method.</p>
        </>
      )}
      {events.length > 0 && (<><p className="mc-subhead">Failed payments</p><EventTable list={events} empty="" /></>)}
    </div>
  );
}

function Upcoming({ list }: { list: PaySub[] }) {
  if (!list.length) return <div className="mc-empty"><Icon name="calendar" size={28} /><p>No payments are scheduled yet.</p></div>;
  return (
    <div className="mc-table-wrap s6-scroll">
      <table className="mc-table">
        <thead><tr><th>Next payment</th><th>Restaurant</th><th>Plan</th><th className="mc-num">Amount</th><th>Status</th><th>Razorpay</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td className="mc-nowrap"><div className="mc-cell-main">{fmtDate(s.next_charge_at)}</div><div className="mc-cell-sub">{relDays(s.next_charge_at)}</div></td>
              <td>{s.restaurant_name ?? '—'}</td>
              <td>{s.plan_name}{s.months > 1 ? ` · every ${s.months} months` : ''}{s.offer_code && <div className="mc-cell-sub">Offer {s.offer_code}</div>}</td>
              <td className="mc-num">{s.amount_inr ? fmtInr(s.amount_inr) : '—'}</td>
              <td><SubBadge s={s.status} /></td>
              <td><RzpLink e={s} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OneRestaurant({ rid, o }: { rid: string; o: PaymentsOverview }) {
  if (!rid) return <div className="mc-empty"><Icon name="store" size={28} /><p>Choose a restaurant above to see all its payments.</p></div>;
  const subs = o.subscriptions.filter((s) => s.restaurant_id === rid);
  const evs = o.events.filter((e) => e.restaurant_id === rid);
  const paid = evs.filter((e) => e.kind === 'paid');
  const total = paid.reduce((t, e) => t + e.amount_inr, 0);
  return (
    <div className="s6-pad">
      <div className="mc-stats" style={{ marginBottom: 14 }}>
        <div className="mc-stat"><span className="mc-stat-label">Paid in total</span><span className="mc-stat-value">{fmtInr(total)}</span></div>
        <div className="mc-stat"><span className="mc-stat-label">Payments</span><span className="mc-stat-value">{fmtNum(paid.length)}</span></div>
        <div className="mc-stat"><span className="mc-stat-label">Last payment</span><span className="mc-stat-value">{paid[0] ? fmtDate(paid[0].at) : '—'}</span></div>
      </div>
      {subs.length > 0 && (
        <>
          <p className="mc-subhead">Plans</p>
          <ul className="s6-list">
            {subs.map((s) => (
              <li key={s.id} className="s6-list-row">
                <span className="s6-list-main"><strong>{s.plan_name}</strong>
                  <small>Started {fmtDate(s.created_at)}{s.next_charge_at ? ` · next payment ${fmtDate(s.next_charge_at)}` : ''}{s.amount_inr ? ` · ${fmtInr(s.amount_inr)}` : ''}</small></span>
                <SubBadge s={s.status} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mc-subhead">History</p>
      <EventTable list={evs} empty="Nothing recorded for this restaurant yet." />
    </div>
  );
}
