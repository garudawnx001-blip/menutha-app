/** Home: the whole business in big cards, and what needs doing today. */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminRestaurant } from './adminApi';
import { StatusChip } from './Pills';
import { daysUntil, fmtDate, fmtInr, fmtNum, relDays } from './format';
import { Icon } from './icons';
import { useConsole } from './ui';

type Attention = { r: AdminRestaurant; icon: string; tone: 'red' | 'amber' | 'blue'; text: string; when: number };

export function Home() {
  const { data, loadError, refresh, openRestaurant } = useConsole();
  const nav = useNavigate();
  const k = data?.kpis;
  const go = (filter: string) => nav(`/admin/restaurants?show=${filter}`);

  const attention = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    for (const r of data?.restaurants ?? []) {
      if (r.lifecycle === 'grace') out.push({ r, icon: 'card', tone: 'red', when: 0, text: `Payment failed — orders stop ${relDays(r.grace_until)}` });
      else if (r.lifecycle === 'trial_expired') out.push({ r, icon: 'alert', tone: 'red', when: 1, text: `Free trial ended ${relDays(r.trial_ends_at)} — orders are off` });
      else if (r.lifecycle === 'trialing' && daysUntil(r.trial_ends_at) <= 7) out.push({ r, icon: 'clock', tone: 'amber', when: 2 + daysUntil(r.trial_ends_at), text: `Free trial ends ${relDays(r.trial_ends_at)} (${fmtDate(r.trial_ends_at)})` });
      else if (r.lifecycle === 'suspended') out.push({ r, icon: 'pause', tone: 'blue', when: 50, text: 'Suspended — no orders' });
    }
    return out.sort((a, b) => a.when - b.when).slice(0, 12);
  }, [data]);

  return (
    <div className="mc-page">
      <div className="mc-heading">
        <div>
          <h1 className="mc-display">Hello</h1>
          <p className="mc-muted">Here is how Menutha is doing today.</p>
        </div>
      </div>

      {loadError && (
        <div className="mc-banner" role="alert"><span>{loadError}</span>
          <button className="mc-btn mc-btn-ghost" onClick={() => void refresh()}>Try again</button></div>
      )}

      <section className="mc-big-cards" aria-label="Key numbers">
        {k ? (
          <>
            <BigCard tone="gold" feature icon="rupee" label="Money coming in each month" value={fmtInr(k.mrr_inr)}
              sub={`From ${fmtNum(k.paying_subscriptions)} paying restaurant${k.paying_subscriptions === 1 ? '' : 's'}`}
              onClick={() => go('paying')} />
            <BigCard tone="blue" icon="sparkle" label="Will start paying soon" value={fmtInr(k.pipeline_mrr_inr)}
              sub="Autopay set up, first payment not taken yet" onClick={() => go('trialing')} />
            <BigCard icon="store" label="All restaurants" value={fmtNum(k.total)}
              sub={k.outlets ? `Includes ${fmtNum(k.outlets)} extra outlet${k.outlets === 1 ? '' : 's'}` : 'Every restaurant on Menutha'}
              onClick={() => go('all')} />
            <BigCard tone="green" icon="check" label="Active" value={fmtNum(k.active)}
              sub="Taking orders on a plan right now" onClick={() => go('active')} />
            <BigCard tone="blue" icon="clock" label="On free trial" value={fmtNum(k.trialing)}
              sub={k.expiring_7d ? `${fmtNum(k.expiring_7d)} ending within 7 days` : 'Trying Menutha for free'} onClick={() => go('trialing')} />
            <BigCard tone="gold" icon="gift" label="Complimentary" value={fmtNum(k.complimentary)}
              sub="Free forever, given by you" onClick={() => go('complimentary')} />
            <BigCard tone={k.grace ? 'red' : undefined} icon="card" label="Payment overdue (grace days)" value={fmtNum(k.grace)}
              sub="A payment failed — still working for a few days" onClick={() => go('grace')} />
            <BigCard tone={k.trial_expired ? 'amber' : undefined} icon="alert" label="Free trial ended" value={fmtNum(k.trial_expired)}
              sub="Not paying yet — orders are off" onClick={() => go('trial_expired')} />
            <BigCard tone={k.suspended ? 'red' : undefined} icon="pause" label="Suspended" value={fmtNum(k.suspended)}
              sub="Switched off by you" onClick={() => go('suspended')} />
          </>
        ) : Array.from({ length: 9 }, (_, i) => <div key={i} className="mc-bigcard mc-skel" />)}
      </section>

      <section className="mc-panel mc-attention" aria-label="What needs your attention today">
        <div className="mc-panel-head">
          <h2 className="mc-display">What needs your attention today</h2>
          {attention.length > 0 && <span className="mc-count">{attention.length}</span>}
        </div>
        {!data ? (
          <div className="mc-attn-empty"><span className="mc-spinner" /></div>
        ) : attention.length === 0 ? (
          <div className="mc-attn-empty">
            <Icon name="check" size={28} />
            <p><strong>All good.</strong> No trials ending, no failed payments.</p>
          </div>
        ) : (
          <ul className="mc-attn-list">
            {attention.map((a) => (
              <li key={a.r.id}>
                <button className={`mc-attn mc-attn-${a.tone}`} onClick={() => openRestaurant(a.r.id)}>
                  <span className="mc-attn-icon"><Icon name={a.icon} size={18} /></span>
                  <span className="mc-attn-text"><strong>{a.r.name}</strong><small>{a.text}</small></span>
                  <StatusChip r={a.r} />
                  <Icon name="chevron" size={16} className="mc-big-chev" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BigCard({ label, value, sub, tone, icon, feature, onClick }: {
  label: string; value: string; sub: string; tone?: 'green' | 'blue' | 'amber' | 'red' | 'gold';
  icon: string; feature?: boolean; onClick: () => void;
}) {
  return (
    <button className={`mc-bigcard${tone ? ` mc-tone-${tone}` : ''}${feature ? ' mc-bigcard-feature' : ''}`} onClick={onClick}>
      <span className="mc-bigcard-top"><span className="mc-bigcard-icon"><Icon name={icon} size={18} /></span>{label}</span>
      <span className="mc-bigcard-value">{value}</span>
      <span className="mc-bigcard-sub">{sub}</span>
      <span className="mc-bigcard-go">See list <Icon name="chevron" size={13} /></span>
    </button>
  );
}
