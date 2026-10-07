import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminOverview, AdminRestaurant, Lifecycle } from './adminApi';
import { DetailDrawer } from './DetailDrawer';
import { StatusPill, TierPill } from './Pills';
import {
  daysUntil, fmtDate, fmtInr, fmtNum, fmtTime, relDays, titleCase,
} from './format';

type Filter = 'all' | 'expiring' | Lifecycle;
type SortKey = 'name' | 'created_at' | 'ends_at' | 'plan_tier' | 'lifecycle' | 'orders_30d';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trialing', label: 'Trialing' },
  { key: 'expiring', label: 'Expiring ≤ 7d' },
  { key: 'trial_expired', label: 'Trial expired' },
  { key: 'grace', label: 'Grace' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'lapsed', label: 'Lapsed' },
];

const isExpiring = (r: AdminRestaurant) =>
  (r.lifecycle === 'trialing' || r.lifecycle === 'grace') && daysUntil(r.ends_at) <= 7;

export function Dashboard({
  email, data, refreshing, error, onRefresh, onSignOut,
}: {
  email: string;
  data: AdminOverview | null;
  refreshing: boolean;
  error: string;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tier, setTier] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search, like most consoles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = data?.restaurants ?? [];
  const tiers = useMemo(() => Array.from(new Set(rows.map((r) => r.plan_tier || 'none'))).sort(), [rows]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, expiring: 0, active: 0, trialing: 0, trial_expired: 0, grace: 0, suspended: 0, lapsed: 0 };
    for (const r of rows) { c[r.lifecycle] += 1; if (isExpiring(r)) c.expiring += 1; }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (filter === 'expiring' ? !isExpiring(r) : filter !== 'all' && r.lifecycle !== filter) return false;
      if (tier !== 'all' && (r.plan_tier || 'none') !== tier) return false;
      if (!q) return true;
      return [r.name, r.city, r.slug, r.id, r.phone, r.owner?.email, r.owner?.phone, r.owner?.name, r.parent_name]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
    const val = (r: AdminRestaurant): string | number => {
      switch (sort.key) {
        case 'name': return r.name.toLowerCase();
        case 'created_at': return new Date(r.created_at).getTime();
        case 'ends_at': return r.ends_at ? new Date(r.ends_at).getTime() : Number.MAX_SAFE_INTEGER * sort.dir;
        case 'plan_tier': return r.plan_tier || '';
        case 'lifecycle': return r.lifecycle;
        case 'orders_30d': return r.orders_30d;
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, query, filter, tier, sort]);

  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const k = data?.kpis;
  const clearAll = () => { setQuery(''); setFilter('all'); setTier('all'); };
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'ends_at' ? 1 : -1 }));

  return (
    <div className="mc-root mc-app">
      <header className="mc-top">
        <div className="mc-brand">
          <img src="/menutha-mark.svg" alt="" width={28} height={28} />
          <span className="mc-brand-name">Menutha</span>
          <span className="mc-brand-tag">Console</span>
        </div>
        <div className="mc-top-right">
          <span className="mc-updated" aria-live="polite">
            {refreshing ? 'Refreshing…' : data ? `Updated ${fmtTime(data.generated_at)}` : ''}
          </span>
          <button className="mc-btn mc-btn-ghost" onClick={onRefresh} disabled={refreshing} title="Refresh">
            <RefreshIcon spinning={refreshing} /><span className="mc-hide-sm">Refresh</span>
          </button>
          <span className="mc-user" title={email}>{email}</span>
          <button className="mc-btn mc-btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="mc-main">
        <div className="mc-heading">
          <div>
            <h1 className="mc-display">Restaurants</h1>
            <p className="mc-muted">Every restaurant on the platform, its plan and its billing state. Read-only.</p>
          </div>
        </div>

        {error && (
          <div className="mc-banner" role="alert">
            <span>{error}</span>
            <button className="mc-btn mc-btn-ghost" onClick={onRefresh}>Try again</button>
          </div>
        )}

        <section className="mc-kpis" aria-label="Key figures">
          {k ? (
            <>
              <Kpi label="Total restaurants" value={fmtNum(k.total)}
                sub={k.outlets ? `${fmtNum(k.outlets)} outlet${k.outlets === 1 ? '' : 's'} included` : 'No outlets'}
                active={filter === 'all'} onClick={() => setFilter('all')} />
              <Kpi label="Active" value={fmtNum(k.active)} tone="green"
                sub={k.grace ? `${fmtNum(k.grace)} in grace` : 'On a paid plan'}
                active={filter === 'active'} onClick={() => setFilter('active')} />
              <Kpi label="Trialing" value={fmtNum(k.trialing)} tone="blue"
                sub={k.trial_expired ? `${fmtNum(k.trial_expired)} trial${k.trial_expired === 1 ? '' : 's'} expired` : 'Trial running'}
                active={filter === 'trialing'} onClick={() => setFilter('trialing')} />
              <Kpi label="Expiring in 7 days" value={fmtNum(k.expiring_7d)} tone={k.expiring_7d ? 'amber' : undefined}
                sub="Trial or grace ending"
                active={filter === 'expiring'} onClick={() => setFilter('expiring')} />
              <Kpi label="Suspended" value={fmtNum(k.suspended)} tone={k.suspended ? 'red' : undefined}
                sub="Ordering switched off"
                active={filter === 'suspended'} onClick={() => setFilter('suspended')} />
              <Kpi label="MRR" value={fmtInr(k.mrr_inr)} tone="gold" feature
                sub={`${fmtNum(k.paying_subscriptions)} paying · ${fmtInr(k.pipeline_mrr_inr)} pipeline`}
                title="Monthly recurring revenue from subscriptions Razorpay has charged (ex-GST, multi-month plans normalised to a month, plus active add-ons). Pipeline = mandates authorised but not yet charged." />
            </>
          ) : (
            Array.from({ length: 6 }, (_, i) => <div key={i} className="mc-kpi mc-skel" />)
          )}
        </section>

        <section className="mc-panel">
          <div className="mc-toolbar">
            <div className="mc-search">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search name, city, owner email or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search restaurants"
              />
              {!query && <kbd>/</kbd>}
            </div>
            <label className="mc-select">
              <span>Plan</span>
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="all">All plans</option>
                {tiers.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </label>
          </div>

          <div className="mc-chips" role="tablist" aria-label="Status filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`mc-chip${filter === f.key ? ' is-on' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}<span className="mc-chip-n">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          <div className="mc-table-wrap">
            <table className="mc-table">
              <thead>
                <tr>
                  <Th label="Restaurant" k="name" sort={sort} onSort={sortBy} />
                  <Th label="Plan" k="plan_tier" sort={sort} onSort={sortBy} />
                  <Th label="Status" k="lifecycle" sort={sort} onSort={sortBy} />
                  <Th label="Trial / grace ends" k="ends_at" sort={sort} onSort={sortBy} />
                  <th>Subscription</th>
                  <th>Owner</th>
                  <Th label="Orders 30d" k="orders_30d" sort={sort} onSort={sortBy} align="right" />
                  <Th label="Created" k="created_at" sort={sort} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {!data && Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="mc-row-skel"><td colSpan={8}><div className="mc-skel mc-skel-line" /></td></tr>
                ))}
                {data && visible.map((r) => (
                  <tr
                    key={r.id}
                    className={`mc-row${openId === r.id ? ' is-open' : ''}`}
                    tabIndex={0}
                    onClick={() => setOpenId(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(r.id); } }}
                    aria-label={`Open ${r.name}`}
                  >
                    <td>
                      <div className="mc-cell-main">{r.name}</div>
                      <div className="mc-cell-sub">
                        {r.city || '—'}
                        {r.parent_name && <span className="mc-tag">Outlet of {r.parent_name}</span>}
                        {r.is_pilot && <span className="mc-tag mc-tag-gold">Pilot</span>}
                      </div>
                    </td>
                    <td><TierPill tier={r.plan_tier} /></td>
                    <td><StatusPill lifecycle={r.lifecycle} /></td>
                    <td><EndsCell r={r} /></td>
                    <td>
                      {r.latest_subscription ? (
                        <>
                          <div className="mc-cell-main mc-cap">{r.latest_subscription.status ?? '—'}</div>
                          <div className="mc-cell-sub">{r.latest_subscription.plan_name || titleCase(r.latest_subscription.plan_id)}</div>
                        </>
                      ) : <span className="mc-dim">None</span>}
                    </td>
                    <td className="mc-owner">
                      <div className="mc-cell-main mc-ellipsis">{r.owner?.email || '—'}</div>
                      <div className="mc-cell-sub">{r.owner?.phone || r.phone || ''}</div>
                    </td>
                    <td className="mc-num">{fmtNum(r.orders_30d)}</td>
                    <td className="mc-nowrap">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && visible.length === 0 && (
              <div className="mc-empty">
                <p>No restaurants match these filters.</p>
                <button className="mc-btn mc-btn-ghost" onClick={clearAll}>Clear filters</button>
              </div>
            )}
          </div>
          {data && (
            <div className="mc-foot">
              Showing {fmtNum(visible.length)} of {fmtNum(rows.length)}
            </div>
          )}
        </section>
      </main>

      <DetailDrawer restaurant={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone, active, onClick, feature, title }: {
  label: string; value: string; sub?: string; tone?: 'green' | 'blue' | 'amber' | 'red' | 'gold';
  active?: boolean; onClick?: () => void; feature?: boolean; title?: string;
}) {
  const cls = `mc-kpi${tone ? ` mc-tone-${tone}` : ''}${active ? ' is-on' : ''}${feature ? ' mc-kpi-feature' : ''}${onClick ? ' is-click' : ''}`;
  const body = (
    <>
      <span className="mc-kpi-label">{label}</span>
      <span className="mc-kpi-value">{value}</span>
      {sub && <span className="mc-kpi-sub">{sub}</span>}
    </>
  );
  return onClick
    ? <button className={cls} onClick={onClick} aria-pressed={active} title={title}>{body}</button>
    : <div className={cls} title={title}>{body}</div>;
}

function Th({ label, k, sort, onSort, align }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; align?: 'right';
}) {
  const on = sort.key === k;
  return (
    <th aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={align === 'right' ? 'mc-num' : ''}>
      <button className={`mc-th${on ? ' is-on' : ''}`} onClick={() => onSort(k)}>
        {label}<span className="mc-th-arrow" aria-hidden>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function EndsCell({ r }: { r: AdminRestaurant }) {
  if (!r.ends_at) return <span className="mc-dim">—</span>;
  const d = daysUntil(r.ends_at);
  const urgent = (r.lifecycle === 'trialing' || r.lifecycle === 'grace') && d <= 7;
  return (
    <>
      <div className={`mc-cell-main mc-nowrap${urgent ? ' mc-urgent' : ''}`}>{fmtDate(r.ends_at)}</div>
      <div className={`mc-cell-sub${d < 0 ? ' mc-past' : ''}`}>{relDays(r.ends_at)}</div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? 'mc-spin' : ''} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
  );
}
