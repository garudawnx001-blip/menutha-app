/**
 * /admin/plans — Plans & Prices.
 *
 * Each plan: what it is called, what it costs for 1/3/6/12 months, whether it
 * is offered, and the checklist of what it includes. The checklist IS the
 * product's entitlements (public.plan_catalog): ticking a box switches the
 * feature on for every restaurant on that plan, in the portal and the app.
 *
 * THE PRICE RULE, stated on the page and in every confirmation:
 *   new sign-ups pay the new price from the moment it is saved;
 *   restaurants already paying keep their price for as long as their autopay
 *   runs, and meet the new one only if they start a new subscription.
 * That is not a policy choice made for convenience: a Razorpay plan cannot be
 * edited, so a running subscription keeps the amount it was signed at -- and
 * a UPI AutoPay mandate is approved by the owner for that amount. Moving them
 * silently would be both impossible and wrong.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleError } from './adminApi';
import { fmtDate } from './format';
import { Icon } from './icons';
import { Announcements, DeliveryStrip, useDeliveryStatus } from './Announcements';
import { NotifyBox, deliverySummary, type NotifyValue } from './NotifyBox';
import {
  DURATION_LABEL, chargeFor, inrWhole, plansApi,
  type CatalogPlan, type EmailStatus, type FeatureDef, type PlansOverview, type PricePreview, type RazorpayMode,
} from './plansApi';
import { BusyButton, Modal, useConsole, useToast } from './ui';
import './plans.css';

export function Plans() {
  const { lostAccess, mocked } = useConsole();
  const [data, setData] = useState<PlansOverview | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CatalogPlan | null>(null);
  const [pricing, setPricing] = useState<CatalogPlan | null>(null);
  const [sent, setSent] = useState(0);
  const { rzp, email, reloadStatus } = useDeliveryStatus();

  const load = useCallback(async () => {
    setError('');
    try {
      if (mocked) { const { mockPlans } = await import('./mockPlans'); setData(mockPlans()); return; }
      setData(await plansApi.overview());
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load the plans.');
    }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);

  const featureMap = useMemo(() => new Map((data?.features ?? []).map((f) => [f.key, f])), [data]);
  const tiers = (data?.plans ?? []).filter((p) => p.kind === 'tier');
  const addons = (data?.plans ?? []).filter((p) => p.kind === 'addon');
  const done = () => { setEditing(null); setPricing(null); void load(); setSent((n) => n + 1); void reloadStatus(); };

  return (
    <div className="mc-page">
      <div className="mc-heading"><div>
        <h1 className="mc-display">Plans &amp; Prices</h1>
        <p className="mc-muted">What each plan costs and what it includes. Changes reach the website, the app and every restaurant portal straight away.</p>
      </div></div>

      <DeliveryStrip rzp={rzp} email={email} />

      <div className="mc-explain">
        <span className="mc-explain-icon"><Icon name="rupee" size={20} /></span>
        <div>
          <h3>How a change works</h3>
          <ul>
            <li><span><strong>New price:</strong> new sign-ups pay it from the moment you save.</span></li>
            <li><span><strong>Restaurants already paying keep their current price</strong> for as long as their autopay runs. They move to a new price only if they start a new subscription — for example after cancelling, or choosing another plan.</span></li>
            <li><span><strong>Features:</strong> ticking or unticking a feature changes it for everyone on that plan, straight away.</span></li>
            <li><span>Each change can tell the affected restaurants in the app, by push and by email.</span></li>
          </ul>
        </div>
      </div>

      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}

      <h2 className="mc-display mc-section-title">Plans <small>— what restaurants choose from</small></h2>
      <section className="mc-plan-grid" aria-label="Plans">
        {!data ? Array.from({ length: 3 }, (_, i) => <div key={i} className="mc-plan-card mc-skel" style={{ minHeight: 420 }} />)
          : tiers.map((p, i) => (
            <PlanCard key={p.id} p={p} prev={i > 0 ? tiers[i - 1] : null} featureMap={featureMap}
              onEdit={() => setEditing(p)} onPrices={() => setPricing(p)} />
          ))}
      </section>

      {addons.length > 0 && <>
        <h2 className="mc-display mc-section-title">Add-ons <small>— extras on top of any plan</small></h2>
        <section className="mc-plan-grid mc-plan-grid-addons" aria-label="Add-ons">
          {addons.map((p) => (
            <PlanCard key={p.id} p={p} featureMap={featureMap} onEdit={() => setEditing(p)} onPrices={() => setPricing(p)} />
          ))}
        </section>
      </>}

      <Announcements version={sent} />

      {editing && data && (
        <EditPlanModal plan={editing} all={data.plans} features={data.features} email={email}
          onClose={() => setEditing(null)} onDone={done} />
      )}
      {pricing && (
        <PriceModal plan={pricing} rzp={rzp} email={email} onClose={() => setPricing(null)} onDone={done} />
      )}
    </div>
  );
}

function PlanCard({ p, prev, featureMap, onEdit, onPrices }: {
  p: CatalogPlan; prev?: CatalogPlan | null; featureMap: Map<string, FeatureDef>; onEdit: () => void; onPrices: () => void;
}) {
  const monthly = p.prices.find((r) => r.duration_months === 1) ?? p.prices[0];
  const shown = p.features.filter((f) => !featureMap.get(f)?.hidden);
  // What sets this plan apart: what it adds over the one below it.
  const peek = prev ? shown.filter((f) => !prev.features.includes(f)) : shown;
  const subscribers = p.prices.reduce((n, r) => n + r.subscribers, 0);
  return (
    <article className={`mc-plan-card${p.is_popular ? ' is-popular' : ''}${p.is_active ? '' : ' is-off'}`}>
      <div className="mc-plan-top">
        <h3 className="mc-display">{p.display_name}</h3>
        {p.is_popular && <span className="mc-badge mc-badge-popular"><Icon name="sparkle" size={13} />Most popular</span>}
        {!p.is_active && <span className="mc-badge mc-badge-off">Hidden</span>}
      </div>
      <p className="mc-plan-desc">{p.description || <span className="mc-dim">No description yet.</span>}</p>

      <div className="mc-price-list">
        {p.prices.map((r) => (
          <div key={r.id} className={`mc-price-row${r === monthly ? ' is-big' : ''}`}>
            <span>{p.kind === 'addon' ? 'Monthly' : DURATION_LABEL[r.duration_months] ?? `${r.duration_months} months`}</span>
            <strong>{inrWhole(r.price_inr)}</strong>
            <small>
              {r.charge_inr ? `${inrWhole(r.charge_inr)} with ${r.gst_pct}% GST` : `+ ${r.gst_pct}% GST`}
              {r.duration_months > 1 ? ` · ${inrWhole(r.price_inr / r.duration_months)}/month` : ''}
              {r.subscribers > 0 ? ` · ${r.subscribers} paying at this price` : ''}
              {!r.razorpay_plan_id ? ' · not on sale online yet' : ''}
            </small>
          </div>
        ))}
      </div>

      <div>
        <p className="mc-small mc-muted" style={{ marginBottom: 8 }}>
          {p.kind === 'tier'
            ? <><strong style={{ color: 'var(--mc-ink)' }}>{p.restaurants}</strong> restaurant{p.restaurants === 1 ? '' : 's'} on this plan{subscribers ? ` · ${subscribers} with autopay` : ''} · {shown.length} features</>
            : <><strong style={{ color: 'var(--mc-ink)' }}>{p.restaurants}</strong> using it</>}
        </p>
        <div className="mc-feature-peek">
          {prev && <span className="mc-feature-chip is-add">Everything in {prev.display_name}, plus:</span>}
          {peek.slice(0, 6).map((f) => <span key={f} className="mc-feature-chip">{featureMap.get(f)?.label ?? f}</span>)}
          {peek.length > 6 && <span className="mc-feature-chip">+{peek.length - 6} more</span>}
          {prev && peek.length === 0 && <span className="mc-feature-chip">nothing extra yet</span>}
        </div>
      </div>

      <div className="mc-plan-actions">
        <button className="mc-btn mc-btn-ghost" onClick={onEdit}><Icon name="layers" size={16} />Plan &amp; features</button>
        <button className="mc-btn mc-btn-primary" onClick={onPrices}><Icon name="rupee" size={16} />Change prices</button>
      </div>
    </article>
  );
}

// ── Edit name, description, popular, on/off and features ─────────────────

function EditPlanModal({ plan, all, features, email, onClose, onDone }: {
  plan: CatalogPlan; all: CatalogPlan[]; features: FeatureDef[]; email: EmailStatus | null;
  onClose: () => void; onDone: () => void;
}) {
  const { lostAccess } = useConsole();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(plan.display_name);
  const [desc, setDesc] = useState(plan.description ?? '');
  const [popular, setPopular] = useState(plan.is_popular);
  const [active, setActive] = useState(plan.is_active);
  const [picked, setPicked] = useState<Set<string>>(new Set(plan.features));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ordered = useMemo(() => {
    const keys = features.map((f) => f.key);
    return [...keys.filter((k) => picked.has(k))];
  }, [features, picked]);
  const added = ordered.filter((f) => !plan.features.includes(f));
  const removed = plan.features.filter((f) => !picked.has(f));
  const featuresChanged = added.length + removed.length > 0;
  const otherChanged = name.trim() !== plan.display_name || (desc.trim() || null) !== (plan.description ?? null)
    || popular !== plan.is_popular || active !== plan.is_active;
  const label = (k: string) => features.find((f) => f.key === k)?.label ?? k;

  const [notify, setNotify] = useState<NotifyValue>({ on: false, title: '', body: '' });
  const goReview = () => {
    if (!name.trim()) { setError('Give the plan a name.'); return; }
    if (plan.kind === 'tier' && !picked.has('qr_ordering')) {
      setError('Every plan must keep "Diners scan a QR and order" — without it the plan cannot take orders.'); return;
    }
    setError('');
    const lines: string[] = [];
    if (added.length) lines.push(`Now included: ${added.map(label).join(', ')}.`);
    if (removed.length) lines.push(`No longer included: ${removed.map(label).join(', ')}.`);
    setNotify({
      on: featuresChanged,
      title: `Your ${name.trim()} plan has changed`,
      body: `${lines.join('\n')}${lines.length ? '\n\n' : ''}This applies to your restaurant from today. Your price does not change.`,
    });
    setStep(2);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      await plansApi.savePlan({ id: plan.id, display_name: name.trim(), description: desc.trim(),
        is_popular: popular, is_active: active, features: ordered });
      let msg = `${name.trim()} saved.`;
      if (notify.on && notify.title.trim() && notify.body.trim()) {
        const r = await plansApi.broadcast({ kind: 'plan_update', sourceType: 'plan', sourceId: plan.id,
          title: notify.title.trim(), body: notify.body.trim() });
        msg += ' ' + deliverySummary(r);
      }
      toast('ok', msg);
      onDone();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      const m = e instanceof Error ? e.message : 'Could not save. Nothing was changed.';
      setError(m); toast('bad', m);
    } finally { setBusy(false); }
  };

  const copyFrom = (id: string) => {
    const src = all.find((p) => p.id === id);
    if (src) setPicked(new Set([...picked, ...src.features]));
  };

  return (
    <Modal wide title={step === 1 ? `Edit ${plan.display_name}` : 'Check and save'} icon="layers" onClose={onClose}
      footer={step === 1 ? <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <button className="mc-btn mc-btn-primary mc-btn-lg" disabled={!featuresChanged && !otherChanged} onClick={goReview}>
          Review changes
        </button>
      </> : <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setStep(1)} disabled={busy}>Back</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={save}>
          {notify.on ? 'Save and notify' : 'Save'}
        </BusyButton>
      </>}>
      <div className="mc-steps" aria-hidden><span className="is-on" /><span className={step === 2 ? 'is-on' : ''} /></div>
      {step === 1 ? <>
        <div className="mc-form-grid">
          <label className="mc-input"><span>Plan name</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <div />
          <label className="mc-input mc-span-2"><span>Short description <em>— shown on the pricing page and the Plan screen</em></span>
            <textarea rows={2} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        </div>
        {plan.kind === 'tier' && (
          <label className={`mc-toggle${popular ? ' is-on' : ''}`} style={{ marginTop: 12 }}>
            <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} />
            <span className="mc-toggle-box" aria-hidden />
            <span><strong>Mark as “Most popular”</strong><small>Only one plan can carry this. Choosing it here removes it from the others.</small></span>
          </label>
        )}
        <label className={`mc-toggle${active ? ' is-on' : ''}`} style={{ marginTop: 8 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="mc-toggle-box" aria-hidden />
          <span><strong>Offered to new restaurants</strong><small>Turn off to hide it from the pricing page and the Plan screen. Restaurants already on it keep it.</small></span>
        </label>

        <p className="mc-subhead">What it includes</p>
        <div className="mc-check-tools">
          <span>{picked.size} ticked</span>
          {plan.kind === 'tier' && all.filter((p) => p.kind === 'tier' && p.id !== plan.id).map((p) => (
            <button key={p.id} type="button" onClick={() => copyFrom(p.id)}>Add everything in {p.display_name}</button>
          ))}
        </div>
        <div className="mc-check-list">
          {features.map((f) => (
            <label key={f.key} className={`mc-check${picked.has(f.key) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picked.has(f.key)} onChange={(e) => {
                const n = new Set(picked);
                if (e.target.checked) n.add(f.key); else n.delete(f.key);
                setPicked(n);
              }} />
              <span>{f.label}{f.hidden && <small>Older name, kept so old screens keep working — tick it with “Many outlets”.</small>}</span>
            </label>
          ))}
        </div>
        <p className="mc-note">
          <strong>Limits:</strong> how many outlets a restaurant may have follows “Many outlets under one plan”
          (one outlet without it, unlimited with it). Menutha has no limit on tables, staff or menu items on any plan today.
        </p>
      </> : <>
        <div className="mc-impact">
          {featuresChanged && (
            <div className="mc-impact-row">
              <span className="mc-impact-icon"><Icon name="layers" size={17} /></span>
              <div>
                <strong>Changes what restaurants on {name.trim()} can use — straight away</strong>
                <div className="mc-feature-peek" style={{ marginTop: 8 }}>
                  {added.map((f) => <span key={f} className="mc-feature-chip is-add">+ {label(f)}</span>)}
                  {removed.map((f) => <span key={f} className="mc-feature-chip is-remove">{label(f)}</span>)}
                </div>
              </div>
            </div>
          )}
          {otherChanged && (
            <div className="mc-impact-row">
              <span className="mc-impact-icon"><Icon name="tag" size={17} /></span>
              <div>
                <strong>Name and display</strong>
                <span>
                  {name.trim() !== plan.display_name && <>Renamed <s>{plan.display_name}</s><span className="mc-arrow">→</span>{name.trim()}. </>}
                  {popular !== plan.is_popular && (popular ? 'Marked most popular. ' : 'No longer marked most popular. ')}
                  {active !== plan.is_active && (active ? 'Offered to new restaurants again. ' : 'Hidden from new restaurants; current ones keep it. ')}
                  {(desc.trim() || null) !== (plan.description ?? null) && 'New description.'}
                </span>
              </div>
            </div>
          )}
          {removed.length > 0 && (
            <p className="mc-note mc-note-bad">Restaurants on this plan will lose {removed.map(label).join(', ')} the moment you save. Their data is kept.</p>
          )}
        </div>
        <NotifyBox value={notify} onChange={setNotify} sourceType="plan" sourceId={plan.id} email={email} />
      </>}
      {error && <p className="mc-form-error" role="alert">{error}</p>}
    </Modal>
  );
}

// ── Change prices ────────────────────────────────────────────────────────

function PriceModal({ plan, rzp, email, onClose, onDone }: {
  plan: CatalogPlan; rzp: RazorpayMode | null; email: EmailStatus | null; onClose: () => void; onDone: () => void;
}) {
  const { lostAccess } = useConsole();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [prices, setPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(plan.prices.map((r) => [r.id, String(Math.round(r.price_inr))])));
  const [gst, setGst] = useState(String(Math.round(plan.prices[0]?.gst_pct ?? 18)));
  const [previews, setPreviews] = useState<PricePreview[]>([]);
  const [check, setCheck] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notify, setNotify] = useState<NotifyValue>({ on: true, title: '', body: '' });

  const gstNum = Number(gst);
  const changed = plan.prices.filter((r) => {
    const v = Number(prices[r.id]);
    return Number.isFinite(v) && (Math.round(v) !== Math.round(r.price_inr) || gstNum !== Math.round(r.gst_pct));
  });
  const invalid = plan.prices.some((r) => {
    const v = Number(prices[r.id]);
    return !Number.isInteger(v) || v < 1 || v > 1_000_000;
  }) || !Number.isInteger(gstNum) || gstNum < 0 || gstNum > 28;
  const per = (r: { duration_months: number }) => (plan.kind === 'addon' || r.duration_months === 1 ? 'a month' : `every ${r.duration_months} months`);

  const review = async () => {
    setBusy(true); setError('');
    try {
      const pv = await Promise.all(changed.map((r) => plansApi.pricePreview(r.id, Number(prices[r.id]), gstNum)));
      setPreviews(pv);
      const lines = pv.map((x) => `${x.name}: ${inrWhole(x.new_price_inr)} + GST = ${inrWhole(x.new_charge_inr)} ${per(x)}`
        + ` (was ${inrWhole(x.old_charge_inr)})`);
      setNotify({
        on: true,
        title: `${plan.display_name} prices are changing`,
        body: `New prices for restaurants that join ${plan.display_name} from today:\n${lines.join('\n')}\n\n`
          + 'If you already pay for Menutha with autopay, nothing changes for you: you keep your current price for as long as your autopay continues.',
      });
      setStep(2);
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not check the change.');
    } finally { setBusy(false); }
  };

  const dryRun = async () => {
    setBusy(true); setError('');
    try {
      const out: Record<string, string> = {};
      for (const r of changed) {
        const d = await plansApi.changePrice(r.id, Number(prices[r.id]), gstNum, true);
        out[r.id] = d.payload
          ? `Razorpay would get: ${inrWhole(d.payload.item.amount / 100)} charged ${d.payload.interval === 1 ? 'every' : `every ${d.payload.interval}`} ${d.payload.period === 'monthly' ? (d.payload.interval === 1 ? 'month' : 'months') : d.payload.period}`
          : 'No request built.';
      }
      setCheck(out);
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not check with Razorpay.');
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setError('');
    const ok: string[] = [];
    const failed: string[] = [];
    for (const r of changed) {
      try {
        await plansApi.changePrice(r.id, Number(prices[r.id]), gstNum);
        ok.push(r.id);
      } catch (e) {
        if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
        failed.push(`${DURATION_LABEL[r.duration_months] ?? r.id}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    let msg = ok.length ? `${ok.length} price${ok.length === 1 ? '' : 's'} saved.` : '';
    if (ok.length && notify.on && notify.title.trim() && notify.body.trim()) {
      try {
        const b = await plansApi.broadcast({ kind: 'price_update', sourceType: 'plan', sourceId: plan.id,
          title: notify.title.trim(), body: notify.body.trim() });
        msg += ' ' + deliverySummary(b);
      } catch (e) {
        if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
        msg += ' The prices are saved, but the message could not be sent.';
      }
    }
    setBusy(false);
    if (failed.length) {
      // Close and reload either way: whatever did save must show, and a retry
      // must start from the prices as they now are.
      toast('bad', `${msg ? msg + ' ' : ''}Not changed — ${failed.join(' · ')}`);
      onDone();
      return;
    }
    toast('ok', msg);
    onDone();
  };

  return (
    <Modal wide title={step === 1 ? `${plan.display_name} prices` : 'Check and confirm'} icon="rupee" onClose={busy ? () => {} : onClose}
      footer={step === 1 ? <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} disabled={!changed.length || invalid} onClick={review}>
          Review {changed.length || ''} change{changed.length === 1 ? '' : 's'}
        </BusyButton>
      </> : <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setStep(1)} disabled={busy}>Back</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={apply}>
          {notify.on ? 'Save prices and notify' : 'Save prices'}
        </BusyButton>
      </>}>
      <div className="mc-steps" aria-hidden><span className="is-on" /><span className={step === 2 ? 'is-on' : ''} /></div>
      {step === 1 ? <>
        <p className="mc-lead">Type the new price <strong>before GST</strong>, in whole rupees. The amount with GST is worked out for you.</p>
        <div className="mc-price-edit">
          {plan.prices.map((r) => {
            const v = Number(prices[r.id]);
            const isChanged = changed.includes(r);
            return (
              <div key={r.id} className={`mc-price-edit-row${isChanged ? ' is-changed' : ''}`}>
                <strong>{plan.kind === 'addon' ? 'Monthly' : DURATION_LABEL[r.duration_months] ?? r.id}</strong>
                <span className="mc-old">Now {inrWhole(r.price_inr)} · {r.charge_inr ? inrWhole(r.charge_inr) : '—'} with GST</span>
                <span className="mc-input-prefix"><i>₹</i>
                  <input inputMode="numeric" aria-label={`New price, ${DURATION_LABEL[r.duration_months]}`}
                    value={prices[r.id]} onChange={(e) => setPrices({ ...prices, [r.id]: e.target.value.replace(/[^\d]/g, '') })} />
                </span>
                <span className="mc-new">
                  {Number.isInteger(v) && v >= 1 ? <>= <strong>{inrWhole(chargeFor(v, gstNum || 0))}</strong> with GST {per(r)}</> : <span className="mc-field-bad">Enter a price</span>}
                  {r.subscribers > 0 && isChanged && <><br /><small className="mc-dim">{r.subscribers} paying restaurant{r.subscribers === 1 ? '' : 's'} keep {inrWhole(r.charge_inr)}</small></>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mc-input-row" style={{ marginTop: 14 }}>
          <label className="mc-input mc-input-sm"><span>GST %</span>
            <input inputMode="numeric" value={gst} onChange={(e) => setGst(e.target.value.replace(/[^\d]/g, ''))} /></label>
          <p className="mc-small mc-muted" style={{ paddingBottom: 12 }}>Applies to every length of this plan you change.</p>
        </div>
      </> : <>
        <div className="mc-impact">
          {previews.map((x) => (
            <div key={x.plan_id} className="mc-impact-row">
              <span className="mc-impact-icon"><Icon name="rupee" size={17} /></span>
              <div>
                <strong>{x.name}: {inrWhole(x.old_charge_inr)}<span className="mc-arrow">→</span>{inrWhole(x.new_charge_inr)} {per(x)} (with GST)</strong>
                <span>
                  New sign-ups pay {inrWhole(x.new_price_inr)} + {x.new_gst_pct}% GST from now.
                  {x.subscribers_keep_old_price > 0
                    ? ` ${x.subscribers_keep_old_price} restaurant${x.subscribers_keep_old_price === 1 ? '' : 's'} already paying keep ${inrWhole(x.old_charge_inr)}.`
                    : ' Nobody is paying at the old price yet.'}
                  {check[x.plan_id] && <><br />{check[x.plan_id]}</>}
                </span>
              </div>
            </div>
          ))}
          <div className="mc-impact-row">
            <span className="mc-impact-icon"><Icon name="card" size={17} /></span>
            <div>
              <strong>{rzp === 'live' ? 'A new plan is made in your LIVE Razorpay account' : rzp === 'test' ? 'A new plan is made in Razorpay test mode' : 'A new Razorpay plan is made'}</strong>
              <span>
                Razorpay plans cannot be edited, so each new price gets its own. Making a plan charges nobody — it is only
                used when a restaurant subscribes. <button type="button" className="mc-link" style={{ marginLeft: 0 }} onClick={dryRun} disabled={busy}>
                  Check the Razorpay request first</button> (nothing is created).
              </span>
            </div>
          </div>
        </div>
        <NotifyBox value={notify} onChange={setNotify} sourceType="plan" sourceId={plan.kind === 'tier' ? plan.id : plan.id} email={email} />
        <p className="mc-small mc-muted" style={{ marginTop: 10 }}>Price history is kept: last change {fmtDate(plan.prices[0]?.history?.[0]?.effective_from ?? null)}.</p>
      </>}
      {error && <p className="mc-form-error" role="alert">{error}</p>}
    </Modal>
  );
}
