/** Restaurants: one searchable list, with filters anyone can read. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AdminRestaurant } from './adminApi';
import { StatusChip, TierPill } from './Pills';
import { daysUntil, fmtDate, fmtNum, relDays, tierName } from './format';
import { Icon } from './icons';
import { useConsole } from './ui';

type Filter = 'all' | 'active' | 'complimentary' | 'paying' | 'autopay' | 'not_billed' | 'trialing' | 'expiring' | 'trial_expired' | 'grace' | 'suspended' | 'lapsed';

/** "Paying" means Razorpay has actually charged them (server's `billing`). */
const billingOf = (r: AdminRestaurant) => r.billing
  ?? (r.is_complimentary ? 'complimentary'
    : r.latest_subscription?.status === 'active' && r.latest_subscription?.charged ? 'paying'
    : r.latest_subscription?.status === 'authenticated' ? 'autopay_set_up'
    : r.lifecycle === 'active' ? 'not_billed' : 'none');
type SortKey = 'name' | 'created_at' | 'ends_at' | 'orders_30d';

const FILTERS: { key: Filter; label: string; test: (r: AdminRestaurant) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'active', label: 'Active', test: (r) => r.lifecycle === 'active' },
  { key: 'complimentary', label: 'Complimentary', test: (r) => r.is_complimentary },
  { key: 'paying', label: 'Paying', test: (r) => billingOf(r) === 'paying' },
  { key: 'autopay', label: 'Autopay set up', test: (r) => billingOf(r) === 'autopay_set_up' },
  { key: 'not_billed', label: 'Active · not billed', test: (r) => r.lifecycle === 'active' && billingOf(r) === 'not_billed' },
  { key: 'trialing', label: 'On free trial', test: (r) => r.lifecycle === 'trialing' },
  { key: 'expiring', label: 'Trial ends in 7 days', test: (r) => (r.lifecycle === 'trialing' || r.lifecycle === 'grace') && daysUntil(r.ends_at) <= 7 },
  { key: 'trial_expired', label: 'Free trial ended', test: (r) => r.lifecycle === 'trial_expired' },
  { key: 'grace', label: 'Payment overdue', test: (r) => r.lifecycle === 'grace' },
  { key: 'suspended', label: 'Suspended', test: (r) => r.lifecycle === 'suspended' },
  { key: 'lapsed', label: 'Stopped paying', test: (r) => r.lifecycle === 'lapsed' },
];

export function Restaurants() {
  const { data, openRestaurant, loadError, refresh } = useConsole();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.some((f) => f.key === params.get('show')) ? params.get('show') : 'all') as Filter;
  const setFilter = (f: Filter) => setParams(f === 'all' ? {} : { show: f }, { replace: true });
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = data?.restaurants ?? [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const list = rows.filter((r) => {
      if (!test(r)) return false;
      if (tier !== 'all' && (r.plan_tier || 'none') !== tier) return false;
      if (!q) return true;
      return [r.name, r.city, r.slug, r.id, r.phone, r.owner?.email, r.owner?.phone, r.owner?.name, r.owner?.username, r.parent_name]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
    const val = (r: AdminRestaurant): string | number => {
      switch (sort.key) {
        case 'name': return r.name.toLowerCase();
        case 'created_at': return new Date(r.created_at).getTime();
        case 'ends_at': return r.ends_at ? new Date(r.ends_at).getTime() : Number.MAX_SAFE_INTEGER * sort.dir;
        case 'orders_30d': return r.orders_30d;
      }
    };
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, query, filter, tier, sort]);

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' || key === 'ends_at' ? 1 : -1 }));

  return (
    <div className="mc-page">
      <div className="mc-heading">
        <div>
          <h1 className="mc-display">Restaurants</h1>
          <p className="mc-muted">Tap a restaurant to see it and change its plan.</p>
        </div>
      </div>
      {loadError && (
        <div className="mc-banner" role="alert"><span>{loadError}</span>
          <button className="mc-btn mc-btn-ghost" onClick={() => void refresh()}>Try again</button></div>
      )}

      <section className="mc-panel">
        <div className="mc-toolbar">
          <div className="mc-search">
            <Icon name="search" size={17} />
            <input ref={searchRef} type="search" placeholder="Search by name, city, owner, phone or username…"
              value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search restaurants" />
            {!query && <kbd>/</kbd>}
          </div>
          <label className="mc-select">
            <span>Plan</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="all">All plans</option>
              {['basic', 'growth', 'enterprise', 'trial'].map((t) => <option key={t} value={t}>{tierName(t)}</option>)}
            </select>
          </label>
        </div>

        <div className="mc-chips" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key}
              className={`mc-chip${filter === f.key ? ' is-on' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}<span className="mc-chip-n">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className="mc-table-wrap">
          <table className="mc-table">
            <thead>
              <tr>
                <Th label="Restaurant" k="name" sort={sort} onSort={sortBy} />
                <th>Status</th>
                <th>Plan</th>
                <Th label="Free trial / grace ends" k="ends_at" sort={sort} onSort={sortBy} />
                <th>Owner</th>
                <Th label="Orders (30 days)" k="orders_30d" sort={sort} onSort={sortBy} align="right" />
                <Th label="Joined" k="created_at" sort={sort} onSort={sortBy} />
              </tr>
            </thead>
            <tbody>
              {!data && Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="mc-row-skel"><td colSpan={7}><div className="mc-skel mc-skel-line" /></td></tr>
              ))}
              {data && visible.map((r) => (
                <tr key={r.id} className="mc-row" tabIndex={0} onClick={() => openRestaurant(r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRestaurant(r.id); } }}
                  aria-label={`Open ${r.name}`}>
                  <td>
                    <div className="mc-cell-main">{r.name}</div>
                    <div className="mc-cell-sub">
                      {r.city || '—'}
                      {r.parent_name && <span className="mc-tag">Outlet of {r.parent_name}</span>}
                    </div>
                  </td>
                  <td><StatusChip r={r} /></td>
                  <td><TierPill tier={r.plan_tier} /></td>
                  <td><EndsCell r={r} /></td>
                  <td className="mc-owner">
                    <div className="mc-cell-main mc-ellipsis">{r.owner?.name || r.owner?.username || '—'}</div>
                    <div className="mc-cell-sub mc-ellipsis">{r.owner?.phone || r.owner?.email || r.phone || ''}</div>
                  </td>
                  <td className="mc-num">{fmtNum(r.orders_30d)}</td>
                  <td className="mc-nowrap">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone: cards instead of a wide table. */}
          <ul className="mc-cards">
            {data && visible.map((r) => (
              <li key={r.id}>
                <button className="mc-rcard" onClick={() => openRestaurant(r.id)}>
                  <span className="mc-rcard-top"><strong>{r.name}</strong><StatusChip r={r} /></span>
                  <span className="mc-rcard-sub">{r.city || '—'} · {tierName(r.plan_tier)}{r.ends_at && !r.is_complimentary ? ` · ends ${relDays(r.ends_at)}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>

          {data && visible.length === 0 && (
            <div className="mc-empty">
              <p>No restaurants here.</p>
              <button className="mc-btn mc-btn-ghost" onClick={() => { setQuery(''); setTier('all'); setFilter('all'); }}>Show all</button>
            </div>
          )}
        </div>
        {data && <div className="mc-foot">Showing {fmtNum(visible.length)} of {fmtNum(rows.length)}</div>}
      </section>
    </div>
  );
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
  if (r.is_complimentary) return <span className="mc-dim">Never</span>;
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
