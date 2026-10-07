/**
 * /admin/settings — the switches for the whole Menutha app.
 *
 *   Free trial + grace days    read by sign-up, the console's "create
 *                              restaurant", checkout and the payment webhook
 *   Help contacts              shown in the partner app and the phone app
 *   App update                 phones older than this version are asked to update
 *   Maintenance notice         a calm "we are upgrading" strip
 *   Announcement banners       a message at the top of the partner web and/or app
 *
 * Every save shows what will change first, then calls one admin RPC that
 * re-checks the admin and writes the audit log. Nothing here sends a push or
 * an email.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleError } from './adminApi';
import {
  contentApi, mockSettings,
  type AppSettings as Settings, type Banner, type BannerInput, type BannerTone,
} from './contentApi';
import { fmtDate, fmtDateTime } from './format';
import { Icon } from './icons';
import { BusyButton, Modal, useConsole, useToast } from './ui';
import './plans.css';
import './step6.css';

const TONES: { key: BannerTone; label: string }[] = [
  { key: 'info', label: 'Blue — news' },
  { key: 'success', label: 'Green — good news' },
  { key: 'warning', label: 'Yellow — please note' },
  { key: 'danger', label: 'Red — important' },
];
const AUDIENCE_PLANS: [string, string][] = [['basic', 'Basic'], ['growth', 'Growth'], ['enterprise', 'Enterprise'], ['trial', 'On free trial']];

const LABEL: Record<string, string> = {
  trial_days: 'Free trial days', grace_days: 'Grace days after a failed payment',
  support_phone: 'Help phone', support_email: 'Help email', support_whatsapp: 'Help WhatsApp',
  min_app_version: 'Oldest app version allowed', update_message: 'Update message',
  maintenance_on: 'Maintenance notice', maintenance_message: 'Maintenance message',
  maintenance_web: 'Show on website', maintenance_app: 'Show in the app',
};
const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : v === '' || v === null || v === undefined ? '(empty)' : String(v));

type Section = 'days' | 'help' | 'update' | 'maintenance';
const KEYS: Record<Section, (keyof Settings)[]> = {
  days: ['trial_days', 'grace_days'],
  help: ['support_phone', 'support_email', 'support_whatsapp'],
  update: ['min_app_version', 'update_message'],
  maintenance: ['maintenance_on', 'maintenance_message', 'maintenance_web', 'maintenance_app'],
};

export function AppSettings() {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [f, setF] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const s = mocked ? mockSettings() : await contentApi.settings();
      setSaved(s); setF(s);
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load settings.');
    }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const changed = (sec: Section) => (f && saved ? KEYS[sec].filter((k) => f[k] !== saved[k]) : []);

  const problem = (sec: Section): string | null => {
    if (!f) return null;
    if (sec === 'days') {
      if (!Number.isInteger(f.trial_days) || f.trial_days < 1 || f.trial_days > 365) return 'Free trial days: a whole number from 1 to 365.';
      if (!Number.isInteger(f.grace_days) || f.grace_days < 0 || f.grace_days > 60) return 'Grace days: a whole number from 0 to 60.';
    }
    if (sec === 'help') {
      if (f.support_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.support_email)) return 'The help email does not look right.';
      if (!/^[+0-9 ()-]{0,30}$/.test(f.support_phone)) return 'The phone number can only have numbers, spaces and + ( ) -.';
      if (!/^[+0-9 ()-]{0,30}$/.test(f.support_whatsapp)) return 'The WhatsApp number can only have numbers, spaces and + ( ) -.';
    }
    if (sec === 'update') {
      if (!/^([0-9]{1,4}(\.[0-9]{1,4}){0,2})?$/.test(f.min_app_version)) return 'The version looks like 0.9.2 — numbers and dots only, or leave it empty.';
      if (!f.update_message.trim()) return 'Write the message people will see.';
    }
    if (sec === 'maintenance') {
      if (!f.maintenance_message.trim()) return 'Write the maintenance message.';
      if (f.maintenance_on && !f.maintenance_web && !f.maintenance_app) return 'Choose where to show it: website, app, or both.';
    }
    return null;
  };

  const askSave = (sec: Section) => {
    const p = problem(sec);
    if (p) { toast('bad', p); return; }
    setConfirm(sec);
  };

  const doSave = async () => {
    if (!f || !confirm) return;
    setBusy(true);
    const patch: Partial<Settings> = {};
    for (const k of changed(confirm)) (patch as Record<string, unknown>)[k] = f[k];
    try {
      const s = mocked ? { ...f } : await contentApi.saveSettings(patch);
      const next = { ...f, ...s, trial_days: Number(s.trial_days), grace_days: Number(s.grace_days) };
      setSaved(next); setF(next);
      toast('ok', 'Saved. It is live now.');
      setConfirm(null);
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      toast('bad', e instanceof Error ? e.message : 'Could not save.');
    } finally { setBusy(false); }
  };

  const undo = (sec: Section) => setF((x) => (x && saved ? { ...x, ...Object.fromEntries(KEYS[sec].map((k) => [k, saved[k]])) } : x));

  const foot = (sec: Section) => {
    const c = changed(sec);
    return (
      <div className="s6-card-foot">
        <span className="mc-small mc-muted">{c.length ? `${c.length} unsaved change${c.length === 1 ? '' : 's'}` : 'No changes'}</span>
        <button className="mc-btn mc-btn-ghost" disabled={!c.length} onClick={() => undo(sec)}>Undo</button>
        <button className="mc-btn mc-btn-primary" disabled={!c.length} onClick={() => askSave(sec)}>Save…</button>
      </div>
    );
  };

  return (
    <div className="mc-page">
      <div className="mc-heading"><div>
        <h1 className="mc-display">App Settings</h1>
        <p className="mc-muted">Switches for the whole Menutha app. Each one shows you what will change before it saves.</p>
      </div></div>

      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}
      {!f ? <div className="mc-panel"><div className="mc-attn-empty"><span className="mc-spinner" /></div></div> : (
        <>
          {saved?.updated_at && <p className="mc-small mc-muted" style={{ margin: '-10px 0 16px' }}>Last changed {fmtDateTime(saved.updated_at)}{saved.updated_by_email ? ` by ${saved.updated_by_email}` : ''}.</p>}

          <div className="s6-grid">
            <section className="s6-card">
              <h2 className="s6-card-title"><Icon name="calendar" size={20} />Free trial and grace days</h2>
              <div className="mc-form-grid">
                <Stepper label="Free trial days" hint="for new restaurants" value={f.trial_days} min={1} max={365} onChange={(v) => set('trial_days', v)} />
                <Stepper label="Grace days" hint="after a payment fails" value={f.grace_days} min={0} max={60} onChange={(v) => set('grace_days', v)} />
              </div>
              <div className="mc-preview">
                New restaurants use Menutha <strong>free for {f.trial_days} day{f.trial_days === 1 ? '' : 's'}</strong>.
                If a payment fails, orders keep working for <strong>{f.grace_days} more day{f.grace_days === 1 ? '' : 's'}</strong>.
              </div>
              <p className="mc-note">Only restaurants that sign up <strong>after</strong> you save get the new trial length. Restaurants already on a trial keep their dates. The website text (“Free for 30 days”) is changed separately in <strong>Website</strong>.</p>
              {foot('days')}
            </section>

            <section className="s6-card">
              <h2 className="s6-card-title"><Icon name="phone" size={20} />Help contacts</h2>
              <div className="mc-form">
                <label className="mc-input"><span>Help phone <em>— optional</em></span>
                  <input inputMode="tel" maxLength={30} value={f.support_phone} placeholder="+91 98765 43210" onChange={(e) => set('support_phone', e.target.value)} /></label>
                <label className="mc-input"><span>Help WhatsApp <em>— optional</em></span>
                  <input inputMode="tel" maxLength={30} value={f.support_whatsapp} placeholder="+91 98765 43210" onChange={(e) => set('support_whatsapp', e.target.value)} /></label>
                <label className="mc-input"><span>Help email</span>
                  <input type="email" maxLength={120} value={f.support_email} placeholder="support@menutha.com" onChange={(e) => set('support_email', e.target.value.trim())} /></label>
              </div>
              <div className="s6-mini-preview">
                <span className="mc-small mc-muted">Restaurants see:</span>
                <div>Need help? {[f.support_phone && `Call ${f.support_phone}`, f.support_whatsapp && `WhatsApp ${f.support_whatsapp}`, f.support_email && `Email ${f.support_email}`].filter(Boolean).join(' · ') || 'No contacts set'}</div>
              </div>
              {foot('help')}
            </section>

            <section className="s6-card">
              <h2 className="s6-card-title"><Icon name="refresh" size={20} />App update</h2>
              <div className="mc-form">
                <label className="mc-input"><span>Oldest app version allowed <em>— leave empty to never ask</em></span>
                  <input value={f.min_app_version} maxLength={14} placeholder="for example 0.9.2" onChange={(e) => set('min_app_version', e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                <label className="mc-input"><span>Message on old phones</span>
                  <textarea rows={2} maxLength={300} value={f.update_message} onChange={(e) => set('update_message', e.target.value)} /></label>
              </div>
              <div className="s6-phone">
                <div className="s6-phone-screen">
                  <Icon name="refresh" size={26} />
                  <strong>Update Menutha</strong>
                  <span>{f.update_message || '…'}</span>
                  <span className="s6-phone-btn">Update now</span>
                </div>
              </div>
              <p className="mc-note">{f.min_app_version
                ? <>Phones with an app <strong>older than {f.min_app_version}</strong> will see this screen and cannot continue until they update. Only set a version that is already live in the Play Store and App Store.</>
                : <>Nobody is asked to update.</>}
                {' '}The update check is in app builds made from now on (newer than 0.9.1).</p>
              {foot('update')}
            </section>

            <section className="s6-card">
              <h2 className="s6-card-title"><Icon name="alert" size={20} />Maintenance notice</h2>
              <label className={`mc-toggle${f.maintenance_on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={f.maintenance_on} onChange={(e) => set('maintenance_on', e.target.checked)} />
                <span className="mc-toggle-box" aria-hidden />
                <span><strong>{f.maintenance_on ? 'Notice is ON' : 'Notice is off'}</strong><small>A calm strip at the top. It does not stop anything working.</small></span>
              </label>
              <label className="mc-input" style={{ marginTop: 12 }}><span>Message</span>
                <textarea rows={2} maxLength={300} value={f.maintenance_message} onChange={(e) => set('maintenance_message', e.target.value)} /></label>
              <div className="s6-checks">
                <label><input type="checkbox" checked={f.maintenance_web} onChange={(e) => set('maintenance_web', e.target.checked)} /> Partner website</label>
                <label><input type="checkbox" checked={f.maintenance_app} onChange={(e) => set('maintenance_app', e.target.checked)} /> Phone app</label>
              </div>
              <div className={`s6-strip s6-strip-warning${f.maintenance_on ? '' : ' is-dim'}`}><Icon name="alert" size={16} /><span>{f.maintenance_message || '…'}</span></div>
              {foot('maintenance')}
            </section>
          </div>

          <Banners />
        </>
      )}

      {confirm && f && saved && (
        <Modal title="Save these changes?" icon="check" tone="green" onClose={() => setConfirm(null)}
          footer={<>
            <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setConfirm(null)}>Not yet</button>
            <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={doSave}>Yes, save</BusyButton>
          </>}>
          <ul className="s6-diff">
            {changed(confirm).map((k) => (
              <li key={k}><span>{LABEL[k] ?? k}</span><s>{show(saved[k])}</s><Icon name="chevron" size={14} /><strong>{show(f[k])}</strong></li>
            ))}
          </ul>
          <p className="mc-small mc-muted" style={{ marginTop: 10 }}>It takes effect straight away on the website. Phones pick it up the next time the app opens.</p>
        </Modal>
      )}
    </div>
  );
}

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  return (
    <div className="mc-input"><span>{label} <em>— {hint}</em></span>
      <div className="s6-stepper">
        <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>−</button>
        <input inputMode="numeric" aria-label={label} value={Number.isFinite(value) ? String(value) : ''}
          onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, ''); onChange(d === '' ? NaN : Number(d)); }}
          onBlur={() => { if (!Number.isFinite(value)) onChange(min); else onChange(clamp(value)); }} />
        <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
      </div>
    </div>
  );
}

// ── Announcement banners ─────────────────────────────────────────────────

function bannerState(b: Banner, now = Date.now()): { text: string; cls: string } {
  if (!b.is_active) return { text: 'Off', cls: 'paused' };
  if (b.ends_at && Date.parse(b.ends_at) <= now) return { text: 'Ended', cls: 'ended' };
  if (Date.parse(b.starts_at) > now) return { text: 'Starts later', cls: 'scheduled' };
  return { text: 'Showing now', cls: 'live' };
}
function audienceText(b: { plan_tiers: string[] | null; restaurant_ids: string[] | null; restaurant_names?: string[] }) {
  if (b.restaurant_ids?.length) return `${b.restaurant_ids.length} chosen restaurant${b.restaurant_ids.length === 1 ? '' : 's'}`;
  if (b.plan_tiers?.length) return b.plan_tiers.map((t) => AUDIENCE_PLANS.find((p) => p[0] === t)?.[1] ?? t).join(', ');
  return 'Every restaurant';
}

function Banners() {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [list, setList] = useState<Banner[] | null>(null);
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList(mocked ? [] : await contentApi.banners()); }
    catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      toast('bad', e instanceof Error ? e.message : 'Could not load banners.'); setList([]);
    }
  }, [lostAccess, mocked, toast]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (b: Banner) => {
    try {
      await contentApi.saveBanner({ id: b.id, text: b.text, tone: b.tone, starts_at: b.starts_at, ends_at: b.ends_at ?? '',
        show_web: b.show_web, show_app: b.show_app, plan_tiers: b.plan_tiers ?? [], restaurant_ids: b.restaurant_ids ?? [], is_active: !b.is_active });
      toast('ok', b.is_active ? 'Banner turned off.' : 'Banner turned on.'); void load();
    } catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not change it.'); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try { await contentApi.deleteBanner(deleting.id); toast('ok', 'Banner deleted.'); setDeleting(null); void load(); }
    catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not delete.'); }
    finally { setBusy(false); }
  };

  return (
    <section style={{ marginTop: 28 }}>
      <div className="mc-heading" style={{ marginBottom: 12 }}>
        <div><h2 className="mc-display" style={{ fontSize: 24 }}>Announcement banners</h2>
          <p className="mc-muted">A short message at the top of the partner website and/or the phone app.</p></div>
        <button className="mc-btn mc-btn-primary mc-btn-lg" onClick={() => setEditing('new')}><Icon name="plus" size={18} />New banner</button>
      </div>
      <div className="mc-panel">
        {!list ? <div className="mc-attn-empty"><span className="mc-spinner" /></div>
          : !list.length ? <div className="mc-empty"><Icon name="sparkle" size={28} /><p>No banners yet. Try one like “New: print QR cards for every section.”</p>
              <button className="mc-btn mc-btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />New banner</button></div>
          : (
            <ul className="s6-list s6-pad">
              {list.map((b) => {
                const st = bannerState(b);
                return (
                  <li key={b.id} className="s6-banner-row">
                    <div className={`s6-strip s6-strip-${b.tone}`}><Icon name="sparkle" size={16} /><span>{b.text}</span></div>
                    <div className="s6-banner-meta">
                      <span className={`mc-badge mc-badge-${st.cls}`}>{st.text}</span>
                      <span><Icon name="store" size={14} />{audienceText(b)} · {b.reach} restaurant{b.reach === 1 ? '' : 's'}</span>
                      <span><Icon name="phone" size={14} />{[b.show_web && 'Website', b.show_app && 'App'].filter(Boolean).join(' + ')}</span>
                      <span><Icon name="calendar" size={14} />{fmtDate(b.starts_at)} – {b.ends_at ? fmtDate(b.ends_at) : 'no end date'}</span>
                      <span className="s6-grow" />
                      <button className="mc-btn mc-btn-ghost" onClick={() => void toggle(b)}><Icon name={b.is_active ? 'pause' : 'power'} size={16} />{b.is_active ? 'Turn off' : 'Turn on'}</button>
                      <button className="mc-btn mc-btn-ghost" onClick={() => setEditing(b)}><Icon name="tag" size={16} />Edit</button>
                      <button className="mc-btn mc-btn-ghost" onClick={() => setDeleting(b)}><Icon name="x" size={16} />Delete</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      {editing && <BannerEditor banner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />}
      {deleting && (
        <Modal title="Delete this banner?" icon="x" tone="danger" onClose={() => setDeleting(null)}
          footer={<>
            <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setDeleting(null)}>Keep it</button>
            <BusyButton className="mc-btn mc-btn-danger mc-btn-lg" busy={busy} onClick={remove}>Delete</BusyButton>
          </>}>
          <div className={`s6-strip s6-strip-${deleting.tone}`}><span>{deleting.text}</span></div>
          <p className="mc-small mc-muted" style={{ marginTop: 10 }}>It disappears from every screen. To hide it for a while instead, use “Turn off”.</p>
        </Modal>
      )}
    </section>
  );
}

const toDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const fromDay = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:00' : '00:00:00'}`).toISOString() : '');

function BannerEditor({ banner, onClose, onDone }: { banner: Banner | null; onClose: () => void; onDone: () => void }) {
  const { data, lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [f, setF] = useState<BannerInput>(() => ({
    id: banner?.id, text: banner?.text ?? '', tone: banner?.tone ?? 'info',
    starts_at: banner?.starts_at ?? new Date().toISOString(), ends_at: banner?.ends_at ?? '',
    show_web: banner?.show_web ?? true, show_app: banner?.show_app ?? true,
    plan_tiers: banner?.plan_tiers ?? [], restaurant_ids: banner?.restaurant_ids ?? [], is_active: banner?.is_active ?? true,
  }));
  const [who, setWho] = useState<'all' | 'plans' | 'chosen'>(banner?.restaurant_ids?.length ? 'chosen' : banner?.plan_tiers?.length ? 'plans' : 'all');
  const [search, setSearch] = useState('');
  const [reach, setReach] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof BannerInput>(k: K, v: BannerInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const tiers = who === 'plans' ? f.plan_tiers : [];
  const ids = who === 'chosen' ? f.restaurant_ids : [];
  useEffect(() => {
    let off = false;
    if (mocked) { setReach(data?.restaurants.length ?? 0); return; }
    const t = setTimeout(() => {
      contentApi.bannerReach(tiers, ids).then((n) => { if (!off) setReach(n); }).catch(() => { if (!off) setReach(null); });
    }, 250);
    return () => { off = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, tiers.join(','), ids.join(','), mocked]);

  const restaurants = useMemo(() => (data?.restaurants ?? []).filter((r) => !r.parent_id)
    .filter((r) => !search.trim() || `${r.name} ${r.city ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())), [data, search]);

  const save = async () => {
    if (f.text.trim().length < 2) { setError('Write the message (at least 2 letters).'); return; }
    if (!f.show_web && !f.show_app) { setError('Choose where to show it: website, app, or both.'); return; }
    if (f.ends_at && Date.parse(f.ends_at) <= Date.parse(f.starts_at)) { setError('The end date must be after the start date.'); return; }
    if (who === 'plans' && !f.plan_tiers.length) { setError('Pick at least one plan, or show it to everyone.'); return; }
    if (who === 'chosen' && !f.restaurant_ids.length) { setError('Pick at least one restaurant, or show it to everyone.'); return; }
    setBusy(true); setError('');
    try {
      if (!mocked) await contentApi.saveBanner({ ...f, text: f.text.trim(), plan_tiers: tiers, restaurant_ids: ids });
      toast('ok', banner ? 'Banner saved.' : f.is_active ? 'Banner is live.' : 'Banner saved (off).');
      onDone();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      const m = e instanceof Error ? e.message : 'Could not save.'; setError(m); toast('bad', m);
    } finally { setBusy(false); }
  };

  return (
    <Modal wide title={banner ? 'Edit banner' : 'New banner'} icon="sparkle" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Cancel</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={save}>{banner ? 'Save banner' : f.is_active ? 'Show banner' : 'Save (off)'}</BusyButton>
      </>}>
      <label className="mc-input"><span>Message <em>— {200 - f.text.length} letters left</em></span>
        <textarea rows={2} maxLength={200} value={f.text} placeholder="New: print QR cards for every section of your restaurant." onChange={(e) => set('text', e.target.value)} /></label>

      <p className="mc-subhead">Colour</p>
      <div className="s6-swatches">
        {TONES.map((t) => (
          <button key={t.key} type="button" className={`s6-swatch s6-strip-${t.key}${f.tone === t.key ? ' is-on' : ''}`} onClick={() => set('tone', t.key)} aria-pressed={f.tone === t.key}>
            {f.tone === t.key && <Icon name="check" size={16} />}{t.label}
          </button>
        ))}
      </div>

      <p className="mc-subhead">Preview</p>
      <div className={`s6-strip s6-strip-${f.tone}`}><Icon name="sparkle" size={16} /><span>{f.text.trim() || 'Your message appears here.'}</span></div>

      <p className="mc-subhead">Where</p>
      <div className="s6-checks">
        <label><input type="checkbox" checked={f.show_web} onChange={(e) => set('show_web', e.target.checked)} /> Partner website (menutha.com/partner)</label>
        <label><input type="checkbox" checked={f.show_app} onChange={(e) => set('show_app', e.target.checked)} /> Phone app</label>
      </div>

      <p className="mc-subhead">Who sees it</p>
      <div className="mc-seg" role="tablist">
        {([['all', 'Everyone'], ['plans', 'Some plans'], ['chosen', 'Chosen restaurants']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={who === k} className={who === k ? 'is-on' : ''} onClick={() => setWho(k)}>{l}</button>
        ))}
      </div>
      {who === 'plans' && (
        <div className="mc-days">
          {AUDIENCE_PLANS.map(([t, l]) => (
            <button key={t} type="button" className={`mc-chip-big${f.plan_tiers.includes(t) ? ' is-on' : ''}`}
              onClick={() => set('plan_tiers', f.plan_tiers.includes(t) ? f.plan_tiers.filter((x) => x !== t) : [...f.plan_tiers, t])}>{l}</button>
          ))}
        </div>
      )}
      {who === 'chosen' && (
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
        </>
      )}
      <div className="mc-preview">{reach === null ? 'Counting…' : <>This reaches <strong>{reach} restaurant{reach === 1 ? '' : 's'}</strong>.</>}</div>

      <p className="mc-subhead">When</p>
      <div className="mc-form-grid">
        <label className="mc-input"><span>Starts</span>
          <input type="date" value={toDay(f.starts_at)} onChange={(e) => set('starts_at', fromDay(e.target.value) || new Date().toISOString())} /></label>
        <label className="mc-input"><span>Ends <em>— empty = until you turn it off</em></span>
          <input type="date" value={toDay(f.ends_at || null)} onChange={(e) => set('ends_at', fromDay(e.target.value, true))} /></label>
      </div>
      <label className={`mc-toggle${f.is_active ? ' is-on' : ''}`} style={{ marginTop: 14 }}>
        <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        <span className="mc-toggle-box" aria-hidden />
        <span><strong>{f.is_active ? 'On' : 'Off'}</strong><small>Off keeps it saved without showing it.</small></span>
      </label>
      {error && <p className="mc-form-error" role="alert">{error}</p>}
    </Modal>
  );
}
