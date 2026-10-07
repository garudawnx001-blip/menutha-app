/** Activity: everything done in this console, newest first (admin_audit_log). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleError, type AuditRow } from './adminApi';
import { ACTION_LABEL, fmtDateTime, relDays, tierName, titleCase } from './format';
import { Icon } from './icons';
import { useConsole } from './ui';

const ICON: Record<string, string> = {
  'restaurant.set_plan': 'layers', 'restaurant.extend_trial': 'calendar', 'restaurant.complimentary_on': 'gift',
  'restaurant.complimentary_off': 'gift', 'restaurant.suspend': 'pause', 'restaurant.activate': 'power',
  'restaurant.login_reset': 'key', 'restaurant.create': 'plus', 'admin.sign_in': 'user', 'admin.claimed': 'user',
  'plan.update': 'layers', 'plan.price_change': 'rupee', 'offer.create': 'sparkle', 'offer.update': 'sparkle',
  'offer.ready': 'card', 'offer.publish': 'power', 'offer.pause': 'pause', 'notice.broadcast': 'phone',
};

/** "Growth → Enterprise", "Free trial → Active" — only what changed. */
function whatChanged(a: AuditRow): string {
  const b = a.before ?? {}, f = a.after ?? {};
  const parts: string[] = [];
  if (b.plan_tier !== f.plan_tier && f.plan_tier) parts.push(`${tierName(b.plan_tier as string)} → ${tierName(f.plan_tier as string)}`);
  if (b.plan_status !== f.plan_status && f.plan_status) parts.push(`${titleCase(b.plan_status as string)} → ${titleCase(f.plan_status as string)}`);
  if (b.trial_ends_at !== f.trial_ends_at && f.trial_ends_at) parts.push(`trial ends ${new Date(String(f.trial_ends_at)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  if (a.action === 'restaurant.create' && f.name) parts.push(String(f.name) + (f.is_complimentary ? ' · complimentary' : ''));
  if (a.action === 'plan.price_change' && a.target_id) {
    parts.push(`${a.target_id}: ₹${b.price_inr} → ₹${f.price_inr} (₹${b.charge_inr} → ₹${f.charge_inr} with GST)`);
  }
  if (a.action === 'plan.update' && f.display_name) {
    const was = Array.isArray(b.features) ? (b.features as string[]) : [];
    const now = Array.isArray(f.features) ? (f.features as string[]) : [];
    const add = now.filter((x) => !was.includes(x)).length, rem = was.filter((x) => !now.includes(x)).length;
    parts.push(`${f.display_name}${add ? ` · +${add} feature${add === 1 ? '' : 's'}` : ''}${rem ? ` · −${rem} feature${rem === 1 ? '' : 's'}` : ''}`);
  }
  if (a.action.startsWith('offer.') && (f.code || b.code)) parts.push(String(f.code ?? b.code));
  if (a.action === 'notice.broadcast' && f.title) parts.push(`“${f.title}” · ${f.restaurants ?? 0} restaurants`);
  return parts.join(' · ');
}

export function Activity() {
  const { api, data, openRestaurant, lostAccess } = useConsole();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const names = useMemo(() => new Map((data?.restaurants ?? []).map((r) => [r.id, r.name])), [data]);

  const load = useCallback(async () => {
    setError('');
    try { setRows(await api.fetchActivity()); }
    catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load activity.');
    }
  }, [api, lostAccess]);
  // Reload whenever the overview refreshes, so a just-made change shows up.
  useEffect(() => { void load(); }, [load, data?.generated_at]);

  return (
    <div className="mc-page">
      <div className="mc-heading"><div>
        <h1 className="mc-display">Activity</h1>
        <p className="mc-muted">Everything changed from this console, newest first.</p>
      </div></div>
      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}
      <section className="mc-panel">
        {!rows ? <div className="mc-attn-empty"><span className="mc-spinner" /></div>
          : rows.length === 0 ? <div className="mc-attn-empty"><Icon name="list" size={26} /><p>Nothing yet. Changes you make will appear here.</p></div>
          : (
            <ul className="mc-feed">
              {rows.map((a) => {
                const name = a.target_type === 'restaurant' && a.target_id ? names.get(a.target_id) ?? 'A restaurant' : null;
                return (
                  <li key={a.id} className="mc-feed-row">
                    <span className="mc-feed-icon"><Icon name={ICON[a.action] ?? 'list'} size={17} /></span>
                    <span className="mc-feed-text">
                      <strong>{ACTION_LABEL[a.action] ?? titleCase(a.action)}</strong>
                      {name && a.target_id && (names.has(a.target_id)
                        ? <button className="mc-link" onClick={() => openRestaurant(a.target_id!)}>{name}</button>
                        : <span> {name}</span>)}
                      {whatChanged(a) && <small>{whatChanged(a)}</small>}
                    </span>
                    <span className="mc-feed-when" title={fmtDateTime(a.at)}>{relDays(a.at) === 'today' ? fmtDateTime(a.at).split(', ').pop() : relDays(a.at)}<small>{a.actor_email}</small></span>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </div>
  );
}
