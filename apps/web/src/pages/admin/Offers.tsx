/**
 * /admin/offers — discount codes for restaurants.
 *
 * An owner types the code on their Plan screen when they subscribe. Every
 * rule is checked on the server (coupon_quote), at preview and again at
 * checkout, so nothing here is trusted to enforce anything.
 *
 * HOW A DISCOUNT REACHES RAZORPAY (there is no coupon API for subscriptions):
 *   % off / ₹ off  each plan the offer covers gets its own discounted Razorpay
 *                  plan ("Make ready" below). A subscription started with the
 *                  code is created on it, so EVERY bill is the discounted one.
 *   free months    the first payment simply moves further out.
 * An offer is saved PAUSED. Publishing is its own step, and a % / ₹ offer can
 * only be published once every plan it covers is ready at Razorpay.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleError } from './adminApi';
import { fmtDate } from './format';
import { Icon } from './icons';
import { Announcements, DeliveryStrip, useDeliveryStatus } from './Announcements';
import { NotifyBox, deliverySummary, type NotifyValue } from './NotifyBox';
import {
  inrWhole, offerLabel, plansApi,
  type Coupon, type CouponInput, type CustomerScope, type DiscountType, type EmailStatus, type RazorpayMode,
} from './plansApi';
import { BusyButton, CopyButton, Modal, useConsole, useToast } from './ui';
import './plans.css';

type Status = 'live' | 'paused' | 'scheduled' | 'ended' | 'setup';
function statusOf(c: Coupon, now = Date.now()): Status {
  const needsSetup = c.discount_type !== 'free_months' && c.plans.some((p) => !p.ready);
  if (c.ends_at && Date.parse(c.ends_at) <= now) return 'ended';
  if (!c.is_active) return needsSetup ? 'setup' : 'paused';
  if (Date.parse(c.starts_at) > now) return 'scheduled';
  return 'live';
}
const STATUS_TEXT: Record<Status, string> = {
  live: 'Live', paused: 'Paused', scheduled: 'Starts later', ended: 'Ended', setup: 'Needs setup',
};
const SCOPE_TEXT: Record<CustomerScope, string> = {
  all: 'All restaurants', new: 'New restaurants only', existing: 'Existing customers only',
};
const TIER_NAMES: Record<string, string> = { basic: 'Basic', growth: 'Growth', enterprise: 'Enterprise' };

export function Offers() {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [list, setList] = useState<Coupon[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [publishing, setPublishing] = useState<Coupon | null>(null);
  const [telling, setTelling] = useState<Coupon | null>(null);
  const [sent, setSent] = useState(0);
  const { rzp, email, reloadStatus } = useDeliveryStatus();

  const load = useCallback(async () => {
    setError('');
    try {
      if (mocked) { const { mockCoupons } = await import('./mockPlans'); setList(mockCoupons()); return; }
      setList(await plansApi.coupons());
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load offers.');
    }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);
  const done = () => { setEditing(null); setPublishing(null); setTelling(null); void load(); setSent((n) => n + 1); void reloadStatus(); };

  const pause = async (c: Coupon) => {
    try { await plansApi.setCouponActive(c.id, false); toast('ok', `${c.code} is paused. Nobody can use it now.`); void load(); }
    catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not pause.'); }
  };

  return (
    <div className="mc-page">
      <div className="mc-heading">
        <div>
          <h1 className="mc-display">Offers</h1>
          <p className="mc-muted">Discount codes for restaurants. Owners type the code on their Plan screen when they subscribe.</p>
        </div>
        <button className="mc-btn mc-btn-primary mc-btn-lg" onClick={() => setEditing('new')}><Icon name="plus" size={18} />New offer</button>
      </div>

      <DeliveryStrip rzp={rzp} email={email} />

      <div className="mc-explain">
        <span className="mc-explain-icon"><Icon name="sparkle" size={20} /></span>
        <div>
          <h3>How offers work</h3>
          <ul>
            <li><span><strong>% off or ₹ off</strong> applies to <strong>every bill</strong> of a subscription started with the code, for as long as it runs.</span></li>
            <li><span><strong>Free months</strong> push the first payment further out, on top of any free trial.</span></li>
            <li><span>A code is used when a restaurant <strong>starts a subscription</strong>. Restaurants already paying keep their current subscription and price.</span></li>
            <li><span>New offers are saved <strong>paused</strong>. Publish when you are ready — you can tell restaurants at the same time.</span></li>
          </ul>
        </div>
      </div>

      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}

      <section className="mc-offer-list" aria-label="Offers" style={{ marginBottom: 28 }}>
        {!list ? <div className="mc-panel"><div className="mc-attn-empty"><span className="mc-spinner" /></div></div>
          : list.length === 0 ? (
            <div className="mc-panel"><div className="mc-empty">
              <Icon name="sparkle" size={30} />
              <p><strong>No offers yet.</strong><br />Create a code like “WELCOME2” for two extra free months, or “GROW20” for 20% off Growth.</p>
              <button className="mc-btn mc-btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />New offer</button>
            </div></div>
          ) : list.map((c) => {
            const s = statusOf(c);
            return (
              <article key={c.id} className="mc-offer">
                <div style={{ minWidth: 0 }}>
                  <div className="mc-offer-head">
                    <span className="mc-offer-code">{c.code}</span>
                    <CopyButton text={c.code} />
                    <span className={`mc-badge mc-badge-${s}`}>{STATUS_TEXT[s]}</span>
                    {c.show_banner && <span className="mc-badge mc-badge-banner">On pricing page</span>}
                  </div>
                  <h3 className="mc-display" style={{ marginTop: 8 }}>{c.title}</h3>
                  <p className="mc-offer-label">{c.label}</p>
                  {c.description && <p className="mc-small mc-muted" style={{ marginTop: 4 }}>{c.description}</p>}
                  <div className="mc-offer-meta">
                    <span><Icon name="layers" size={14} />{c.plan_tiers?.length ? c.plan_tiers.map((t) => TIER_NAMES[t] ?? t).join(', ') : 'Every plan'}</span>
                    <span><Icon name="store" size={14} />{c.restaurant_ids?.length
                      ? `${c.restaurant_ids.length} chosen restaurant${c.restaurant_ids.length === 1 ? '' : 's'}` : SCOPE_TEXT[c.customer_scope]}</span>
                    <span><Icon name="calendar" size={14} />{fmtDate(c.starts_at)} – {c.ends_at ? fmtDate(c.ends_at) : 'no end date'}</span>
                    <span><Icon name="check" size={14} />Used {c.used}{c.usage_limit ? ` of ${c.usage_limit}` : ''}{c.pending ? ` · ${c.pending} at checkout` : ''}</span>
                  </div>
                  {c.usage_limit ? <div className="mc-usage" aria-hidden><i style={{ width: `${Math.min(100, (c.used / c.usage_limit) * 100)}%` }} /></div> : null}
                  {s === 'setup' && <p className="mc-note" style={{ maxWidth: 560 }}>Before this can go live, its discounted price has to be set up in Razorpay for {c.plans.filter((p) => !p.ready).length} plan{c.plans.filter((p) => !p.ready).length === 1 ? '' : 's'}. “Publish” walks you through it.</p>}
                </div>
                <div className="mc-offer-actions">
                  {s === 'live' || s === 'scheduled' ? (
                    <button className="mc-btn mc-btn-ghost" onClick={() => void pause(c)}><Icon name="pause" size={16} />Pause</button>
                  ) : s !== 'ended' ? (
                    <button className="mc-btn mc-btn-primary" onClick={() => setPublishing(c)}><Icon name="power" size={16} />Publish</button>
                  ) : null}
                  <button className="mc-btn mc-btn-ghost" onClick={() => setEditing(c)}><Icon name="tag" size={16} />Edit</button>
                  {(s === 'live' || s === 'scheduled') && (
                    <button className="mc-btn mc-btn-ghost" onClick={() => setTelling(c)}><Icon name="phone" size={16} />Tell restaurants</button>
                  )}
                </div>
              </article>
            );
          })}
      </section>

      <Announcements version={sent} />

      {editing && <OfferEditor offer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={done} />}
      {publishing && <PublishFlow offer={publishing} rzp={rzp} email={email} onClose={() => setPublishing(null)} onDone={done} />}
      {telling && <TellFlow offer={telling} email={email} onClose={() => setTelling(null)} onDone={done} />}
    </div>
  );
}

// ── Create / edit ────────────────────────────────────────────────────────

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const fromLocal = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:00' : '00:00:00'}`).toISOString() : '');

function OfferEditor({ offer, onClose, onDone }: { offer: Coupon | null; onClose: () => void; onDone: () => void }) {
  const { data, lostAccess } = useConsole();
  const toast = useToast();
  const used = (offer?.used ?? 0) + (offer?.pending ?? 0) > 0;
  const [f, setF] = useState<CouponInput>(() => ({
    id: offer?.id,
    code: offer?.code ?? '',
    title: offer?.title ?? '',
    description: offer?.description ?? '',
    discount_type: offer?.discount_type ?? 'free_months',
    value: offer?.value ?? 1,
    plan_tiers: offer?.plan_tiers ?? [],
    restaurant_ids: offer?.restaurant_ids ?? [],
    customer_scope: offer?.customer_scope ?? 'all',
    starts_at: offer?.starts_at ?? new Date().toISOString(),
    ends_at: offer?.ends_at ?? '',
    usage_limit: offer?.usage_limit ?? null,
    show_banner: offer?.show_banner ?? false,
    banner_text: offer?.banner_text ?? '',
  }));
  const [who, setWho] = useState<'everyone' | 'chosen'>(offer?.restaurant_ids?.length ? 'chosen' : 'everyone');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof CouponInput>(k: K, v: CouponInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const restaurants = useMemo(() => (data?.restaurants ?? []).filter((r) => !r.parent_id)
    .filter((r) => !search.trim() || `${r.name} ${r.city ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())), [data, search]);

  const problems = (): string | null => {
    if (!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(f.code)) return 'Code: 3–24 capital letters or numbers (dash and underscore allowed).';
    if (f.title.trim().length < 2) return 'Give the offer a short title.';
    if (!(f.value > 0)) return 'Enter how much the discount is.';
    if (f.discount_type === 'percent' && (f.value > 90 || !Number.isFinite(f.value))) return 'A % discount can be at most 90%.';
    if (f.discount_type !== 'percent' && !Number.isInteger(f.value)) return 'Use a whole number.';
    if (f.discount_type === 'free_months' && f.value > 12) return 'At most 12 free months.';
    if (f.ends_at && Date.parse(f.ends_at) <= Date.parse(f.starts_at)) return 'The end date must be after the start date.';
    if (who === 'chosen' && !f.restaurant_ids.length) return 'Choose at least one restaurant, or offer it to everyone.';
    if (f.usage_limit !== null && (!Number.isInteger(f.usage_limit) || f.usage_limit < 1)) return 'The use limit must be 1 or more, or empty for no limit.';
    return null;
  };

  const save = async () => {
    const p = problems();
    if (p) { setError(p); return; }
    setBusy(true); setError('');
    try {
      await plansApi.saveCoupon({ ...f, restaurant_ids: who === 'chosen' ? f.restaurant_ids : [],
        title: f.title.trim(), description: f.description.trim(), banner_text: f.banner_text.trim() });
      toast('ok', offer ? `${f.code} saved.` : `${f.code} created. It is paused until you publish it.`);
      onDone();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      const m = e instanceof Error ? e.message : 'Could not save.';
      setError(m); toast('bad', m);
    } finally { setBusy(false); }
  };

  const valueLabel = f.discount_type === 'percent' ? 'Percent off' : f.discount_type === 'amount' ? 'Rupees off each bill (before GST)' : 'Extra free months';

  return (
    <Modal wide title={offer ? `Edit ${offer.code}` : 'New offer'} icon="sparkle" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={save}>{offer ? 'Save offer' : 'Create offer (paused)'}</BusyButton>
      </>}>
      {used && <p className="mc-note" style={{ marginTop: 0, marginBottom: 12 }}>This offer has been used, so its code, discount and plans are fixed. You can still change its title, dates, limit and who it is for.</p>}
      <div className="mc-form-grid">
        <label className="mc-input"><span>Code <em>— what owners type</em></span>
          <input value={f.code} disabled={used} maxLength={24} autoCapitalize="characters" spellCheck={false}
            placeholder="WELCOME2" onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></label>
        <label className="mc-input"><span>Title</span>
          <input value={f.title} maxLength={60} placeholder="Two extra months free" onChange={(e) => set('title', e.target.value)} /></label>
        <label className="mc-input mc-span-2"><span>Description <em>— optional, shown to the owner</em></span>
          <textarea rows={2} maxLength={300} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      </div>

      <p className="mc-subhead">The discount</p>
      <div className="mc-seg" role="tablist" aria-label="Discount type">
        {([['free_months', 'Free months'], ['percent', '% off'], ['amount', '₹ off']] as [DiscountType, string][]).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={f.discount_type === t} className={f.discount_type === t ? 'is-on' : ''}
            disabled={used} onClick={() => set('discount_type', t)}>{l}</button>
        ))}
      </div>
      <div className="mc-input-row">
        <label className="mc-input mc-input-sm"><span>{valueLabel}</span>
          <input inputMode="decimal" disabled={used} value={String(f.value)}
            onChange={(e) => set('value', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} /></label>
        <div className="mc-preview" style={{ marginTop: 0, flex: 1 }}>Owners see: <strong>{f.value > 0 ? offerLabel(f.discount_type, f.value) : '—'}</strong></div>
      </div>

      <p className="mc-subhead">Which plans</p>
      <div className="mc-days">
        <button type="button" disabled={used} className={`mc-chip-big${f.plan_tiers.length === 0 ? ' is-on' : ''}`} onClick={() => set('plan_tiers', [])}>Every plan</button>
        {Object.entries(TIER_NAMES).map(([t, l]) => (
          <button key={t} type="button" disabled={used} className={`mc-chip-big${f.plan_tiers.includes(t) ? ' is-on' : ''}`}
            onClick={() => set('plan_tiers', f.plan_tiers.includes(t) ? f.plan_tiers.filter((x) => x !== t) : [...f.plan_tiers, t])}>{l}</button>
        ))}
      </div>

      <p className="mc-subhead">Who can use it</p>
      <div className="mc-seg" role="tablist">
        <button role="tab" aria-selected={who === 'everyone'} className={who === 'everyone' ? 'is-on' : ''} onClick={() => setWho('everyone')}>Any restaurant</button>
        <button role="tab" aria-selected={who === 'chosen'} className={who === 'chosen' ? 'is-on' : ''} onClick={() => setWho('chosen')}>Chosen restaurants</button>
      </div>
      {who === 'everyone' ? (
        <div className="mc-radio-list">
          {(['all', 'new', 'existing'] as CustomerScope[]).map((s) => (
            <label key={s} className={`mc-radio${f.customer_scope === s ? ' is-on' : ''}`}>
              <input type="radio" name="scope" checked={f.customer_scope === s} onChange={() => set('customer_scope', s)} />
              <span><strong>{SCOPE_TEXT[s]}</strong><small>{s === 'all' ? 'Anyone can use it once.'
                : s === 'new' ? 'Only restaurants that have never had a paid subscription.' : 'Only restaurants that have had a subscription before (for example coming back).'}</small></span>
            </label>
          ))}
        </div>
      ) : (
        <>
          <label className="mc-input" style={{ marginBottom: 8 }}><span>Search</span>
            <input value={search} placeholder="Restaurant or city" onChange={(e) => setSearch(e.target.value)} /></label>
          <div className="mc-pick-list">
            {restaurants.map((r) => (
              <label key={r.id} className="mc-pick">
                <input type="checkbox" checked={f.restaurant_ids.includes(r.id)} onChange={(e) =>
                  set('restaurant_ids', e.target.checked ? [...f.restaurant_ids, r.id] : f.restaurant_ids.filter((x) => x !== r.id))} />
                <span>{r.name}</span><small>{r.city ?? ''}</small>
              </label>
            ))}
            {!restaurants.length && <p className="mc-small mc-muted" style={{ padding: 12 }}>No restaurants match.</p>}
          </div>
          <p className="mc-small mc-muted" style={{ marginTop: 6 }}>{f.restaurant_ids.length} chosen</p>
        </>
      )}

      <p className="mc-subhead">When and how often</p>
      <div className="mc-form-grid">
        <label className="mc-input"><span>Starts</span>
          <input type="date" value={toLocal(f.starts_at)} onChange={(e) => set('starts_at', fromLocal(e.target.value) || new Date().toISOString())} /></label>
        <label className="mc-input"><span>Ends <em>— leave empty for no end</em></span>
          <input type="date" value={toLocal(f.ends_at || null)} onChange={(e) => set('ends_at', fromLocal(e.target.value, true))} /></label>
        <label className="mc-input"><span>How many restaurants can use it <em>— empty = no limit</em></span>
          <input inputMode="numeric" value={f.usage_limit ?? ''} placeholder="No limit"
            onChange={(e) => set('usage_limit', e.target.value ? Number(e.target.value.replace(/[^\d]/g, '')) : null)} /></label>
      </div>
      <p className="mc-small mc-muted" style={{ marginTop: 6 }}>Each restaurant can use an offer once.</p>

      <label className={`mc-toggle${f.show_banner ? ' is-on' : ''}`} style={{ marginTop: 14 }}>
        <input type="checkbox" checked={f.show_banner} onChange={(e) => set('show_banner', e.target.checked)} />
        <span className="mc-toggle-box" aria-hidden />
        <span><strong>Show on the pricing page as a banner</strong><small>Only for offers open to any restaurant. Shows the code while the offer is live.</small></span>
      </label>
      {f.show_banner && (
        <label className="mc-input" style={{ marginTop: 10 }}><span>Banner text</span>
          <input value={f.banner_text} maxLength={140} placeholder="Join in October: 2 extra months free" onChange={(e) => set('banner_text', e.target.value)} /></label>
      )}
      {f.show_banner && who === 'chosen' && <p className="mc-note">A banner is only shown for offers open to any restaurant.</p>}
      {error && <p className="mc-form-error" role="alert">{error}</p>}
    </Modal>
  );
}

// ── Publish (make ready → confirm + notify) ──────────────────────────────

function PublishFlow({ offer, rzp, email, onClose, onDone }: {
  offer: Coupon; rzp: RazorpayMode | null; email: EmailStatus | null; onClose: () => void; onDone: () => void;
}) {
  const { lostAccess } = useConsole();
  const toast = useToast();
  const notReady = offer.discount_type !== 'free_months' ? offer.plans.filter((p) => !p.ready) : [];
  const [step, setStep] = useState<'ready' | 'confirm'>(notReady.length ? 'ready' : 'confirm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<string>('');
  const ends = offer.ends_at ? ` Valid until ${fmtDate(offer.ends_at)}.` : '';
  const [notify, setNotify] = useState<NotifyValue>({
    on: true,
    title: `New offer: ${offer.title}`,
    body: `${offer.label}${offer.plan_tiers?.length ? ` on ${offer.plan_tiers.map((t) => TIER_NAMES[t] ?? t).join(' or ')}` : ''}.`
      + `${offer.description ? ' ' + offer.description : ''}\n\nUse code ${offer.code} on your Plan screen when you choose your plan.${ends}`,
  });

  const makeReady = async (dry: boolean) => {
    setBusy(true); setError('');
    try {
      const r = await plansApi.prepareOffer(offer.id, offer.code, dry);
      if (dry) {
        setCheck((r.plans ?? []).map((p) => `${p.plan_id}: ${inrWhole(p.charge_inr)} with GST, every ${p.payload.interval} ${p.payload.period === 'monthly' ? 'month(s)' : p.payload.period}`).join(' · ') || 'Nothing to create.');
      } else {
        toast('ok', `Ready at Razorpay for ${r.prepared ?? 0} plan${r.prepared === 1 ? '' : 's'}.`);
        setStep('confirm');
      }
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not set it up at Razorpay.');
    } finally { setBusy(false); }
  };

  const publish = async () => {
    setBusy(true); setError('');
    try {
      await plansApi.setCouponActive(offer.id, true);
      let msg = `${offer.code} is live.`;
      if (notify.on && notify.title.trim() && notify.body.trim()) {
        const r = await plansApi.broadcast({ kind: 'offer', sourceType: 'coupon', sourceId: offer.id,
          title: notify.title.trim(), body: notify.body.trim() });
        msg += ' ' + deliverySummary(r);
      }
      toast('ok', msg);
      onDone();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      const m = e instanceof Error ? e.message : 'Could not publish.';
      setError(m); toast('bad', m);
    } finally { setBusy(false); }
  };

  return (
    <Modal wide title={step === 'ready' ? 'Set up the discounted price' : `Publish ${offer.code}`} icon="power" tone="green" onClose={busy ? () => {} : onClose}
      footer={step === 'ready' ? <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={() => makeReady(false)}>Set up at Razorpay</BusyButton>
      </> : <>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={publish}>
          {notify.on ? 'Publish and notify' : 'Publish'}
        </BusyButton>
      </>}>
      {step === 'ready' ? <>
        <p className="mc-lead">So that <strong>{offer.label}</strong> is what Razorpay actually charges, each plan this offer covers needs its own discounted plan at Razorpay.</p>
        <div className="mc-impact">
          {notReady.map((p) => (
            <div key={p.plan_id} className="mc-impact-row">
              <span className="mc-impact-icon"><Icon name="rupee" size={17} /></span>
              <div><strong>{p.name}: {inrWhole(p.price_inr)}<span className="mc-arrow">→</span>{inrWhole(p.final_price_inr)} before GST</strong>
                <span>Every bill of a subscription started with {offer.code}.</span></div>
            </div>
          ))}
        </div>
        <p className="mc-note">
          {rzp === 'live' ? <strong>This creates plans in your LIVE Razorpay account. </strong> : rzp === 'test' ? <strong>Razorpay is in test mode. </strong> : null}
          Creating a plan charges nobody — it is only used when a restaurant subscribes with this code.{' '}
          <button type="button" className="mc-link" style={{ marginLeft: 0 }} disabled={busy} onClick={() => makeReady(true)}>Check the request first</button> (creates nothing).
          {check && <><br />{check}</>}
        </p>
      </> : <>
        <div className="mc-impact">
          <div className="mc-impact-row">
            <span className="mc-impact-icon"><Icon name="sparkle" size={17} /></span>
            <div><strong>{offer.code} — {offer.label}</strong>
              <span>{offer.plan_tiers?.length ? offer.plan_tiers.map((t) => TIER_NAMES[t] ?? t).join(', ') : 'Every plan'} ·{' '}
                {offer.restaurant_ids?.length ? `${offer.restaurant_ids.length} chosen restaurants` : SCOPE_TEXT[offer.customer_scope]} ·{' '}
                {fmtDate(offer.starts_at)} – {offer.ends_at ? fmtDate(offer.ends_at) : 'no end date'}
                {offer.usage_limit ? ` · up to ${offer.usage_limit} restaurants` : ''}{offer.show_banner ? ' · shown on the pricing page' : ''}</span></div>
          </div>
        </div>
        <NotifyBox value={notify} onChange={setNotify} sourceType="coupon" sourceId={offer.id} email={email} />
      </>}
      {error && <p className="mc-form-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** Tell restaurants about a live offer again (e.g. a reminder before it ends). */
function TellFlow({ offer, email, onClose, onDone }: { offer: Coupon; email: EmailStatus | null; onClose: () => void; onDone: () => void }) {
  const { lostAccess } = useConsole();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState<NotifyValue>({
    on: true,
    title: offer.ends_at ? `Last days: ${offer.title}` : offer.title,
    body: `${offer.label}. Use code ${offer.code} on your Plan screen when you choose your plan.${offer.ends_at ? ` Valid until ${fmtDate(offer.ends_at)}.` : ''}`,
  });
  return (
    <Modal wide title={`Tell restaurants about ${offer.code}`} icon="phone" onClose={busy ? () => {} : onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} disabled={!notify.on} onClick={async () => {
          setBusy(true);
          try {
            const r = await plansApi.broadcast({ kind: 'offer', sourceType: 'coupon', sourceId: offer.id, title: notify.title.trim(), body: notify.body.trim() });
            toast('ok', deliverySummary(r)); onDone();
          } catch (e) {
            if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
            toast('bad', e instanceof Error ? e.message : 'Could not send.');
          } finally { setBusy(false); }
        }}>Send</BusyButton>
      </>}>
      <NotifyBox value={notify} onChange={setNotify} sourceType="coupon" sourceId={offer.id} email={email} />
    </Modal>
  );
}
