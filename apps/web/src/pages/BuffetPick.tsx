/**
 * /buffet — what is on the buffet today, and telling staff you want it. #P.
 *
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO. There is no "buffet order" in
 * the schema: a buffet is a plan the owner publishes — a name, a kind, a
 * per-head price, a time window and a list of dishes — and nothing in the data
 * model records a diner choosing one. The mobile app's buffet screen has the
 * same shape: it shows the plans and counts heads, and writes nothing.
 *
 * Inventing a buffet_order table to make this button feel complete would be
 * inventing a billing path nobody has asked for and staff have no screen for.
 * So the request goes down a road that already exists end to end: request_service
 * with the plan and the headcount in the note. That reaches the same service
 * feed as "water" and "extra plates", which staff already watch, and it is
 * honest about what it is — telling the counter you want the buffet, which is
 * what actually happens in the room.
 *
 * `items` holds menu_item IDS rather than copied names, so the dish names are
 * looked up. That is the right storage decision — a renamed or deleted dish
 * cannot linger on a buffet as a stale string — and it costs one query.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { fetchDinerBuffets, fetchBuffetItemNames, requestService, type DinerBuffet } from '../lib/api';
import { Spinner, Wordmark } from '../components';
import { inr } from '../lib/types';
import { useT } from '../lib/i18n';

const window_ = (a: string | null, b: string | null) => {
  if (!a || !b) return '';
  const f = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${f(a)} – ${f(b)}`;
};

export function BuffetPick() {
  const nav = useNavigate();
  const { session } = useStore();
  const t = useT();
  const [plans, setPlans] = useState<DinerBuffet[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [heads, setHeads] = useState(2);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  useEffect(() => {
    if (!session) { nav('/table', { replace: true }); return; }
    let alive = true;
    fetchDinerBuffets(session.restaurant.id).then(async (b) => {
      if (!alive) return;
      setPlans(b);
      const ids = [...new Set(b.flatMap((p) => p.items))];
      if (ids.length) {
        const map = await fetchBuffetItemNames(ids);
        if (alive) setNames(map);
      }
    });
    return () => { alive = false; };
  }, [session?.restaurant.id]);

  if (!session) return null;

  const ask = async () => {
    const plan = plans?.find((p) => p.id === picked);
    if (!plan || busy) return;
    setBusy(true); setSaid('');
    try {
      const price = plan.kind === 'complimentary' ? t('buffet.free') : `${inr(plan.price)} pp`;
      await requestService(session, 'assistance', `Buffet: ${plan.name} × ${heads} (${price})`);
      setSaid(t('buffet.asked'));
    } catch {
      setSaid(t('buffet.askFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page fade-in">
      <div className="topbar">
        <Wordmark size={24} />
        <button className="chip" onClick={() => nav('/start')}>← {t('common.back')}</button>
      </div>

      <p className="overline" style={{ marginTop: 10 }}>{session.restaurant.name}</p>
      <h1 className="display" style={{ fontSize: 26 }}>{t('buffet.title')}</h1>

      {plans === null && <Spinner label={t('buffet.loading')} />}

      {plans !== null && plans.length === 0 && (
        <div className="center-fill" style={{ gap: 10 }}>
          <p className="muted" style={{ maxWidth: 380 }}>{t('buffet.none')}</p>
          <button className="btn btn-primary" onClick={() => nav('/menu')}>{t('start.menu')}</button>
        </div>
      )}

      {plans !== null && plans.length > 0 && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {plans.map((p) => {
            const on = picked === p.id;
            const dishes = p.items.map((id) => names[id]).filter(Boolean);
            return (
              <button
                key={p.id}
                className="glass"
                onClick={() => setPicked(on ? null : p.id)}
                aria-pressed={on}
                style={{
                  textAlign: 'left', padding: 16, border: on ? '2px solid var(--accent, #D97757)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 17 }}>{p.name}</strong>
                  <span style={{ fontWeight: 800 }}>
                    {p.kind === 'complimentary' ? t('buffet.free') : `${inr(p.price)} ${t('buffet.pp')}`}
                  </span>
                </div>
                {window_(p.starts_at, p.ends_at) && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    🕒 {window_(p.starts_at, p.ends_at)}
                  </p>
                )}
                {dishes.length > 0 && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                    {dishes.join(' · ')}
                  </p>
                )}
              </button>
            );
          })}

          {picked && (
            <div className="glass" style={{ padding: 16, display: 'grid', gap: 10 }}>
              <label>
                <span className="overline">{t('buffet.heads')}</span>
                <select className="code-input" value={heads} onChange={(e) => setHeads(Number(e.target.value))}>
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary btn-block" disabled={busy} onClick={ask}>
                {busy ? t('buffet.asking') : t('buffet.ask')}
              </button>
              {said && <p className="muted" style={{ fontSize: 13 }}>{said}</p>}
              <p className="muted" style={{ fontSize: 12 }}>{t('buffet.note')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
