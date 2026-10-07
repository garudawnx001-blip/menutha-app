/**
 * /admin/website — edit menutha.com without touching code.
 *
 * HOW IT WORKS
 *   The public pages keep their written text in the HTML (that is what Google
 *   and a slow phone see first). /site-live.js then asks for the PUBLISHED
 *   text and swaps in anything that differs. So a bad save can never blank
 *   the site, and a change is live without a redeploy.
 *
 *   Draft     your changes, saved but not shown to anyone
 *   Publish   the draft becomes the live text; the old live text is kept
 *   History   every published version; "Put back" copies one into the draft
 *
 * The preview on the right is the REAL page, loaded with ?cms-preview=1: it
 * skips the database and shows exactly what is typed here, as you type.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleError } from './adminApi';
import {
  contentApi, DEFAULT_SITE, MAX_PHOTO_BYTES, PHOTO_TYPES, withDefaults,
  type Photo, type SiteContent, type SiteState,
} from './contentApi';
import { fmtDateTime } from './format';
import { Icon } from './icons';
import { BusyButton, CopyButton, Modal, useConsole, useToast } from './ui';
import './plans.css';
import './step6.css';

type Tab = 'hero' | 'how' | 'features' | 'pricing' | 'faqs' | 'contact' | 'footer' | 'photos' | 'history';
const TABS: { key: Tab; label: string; icon: string; page: string }[] = [
  { key: 'hero', label: 'Home page top', icon: 'home', page: '/home/index.html' },
  { key: 'how', label: 'How it works', icon: 'list', page: '/home/index.html' },
  { key: 'features', label: 'Features', icon: 'check', page: '/home/index.html' },
  { key: 'pricing', label: 'Pricing page', icon: 'tag', page: '/pricing/index.html' },
  { key: 'faqs', label: 'Questions', icon: 'sparkle', page: '/pricing/index.html' },
  { key: 'contact', label: 'Contact', icon: 'phone', page: '/contact/index.html' },
  { key: 'footer', label: 'Footer & social', icon: 'layers', page: '/home/index.html' },
  { key: 'photos', label: 'Photos', icon: 'gift', page: '/home/index.html' },
  { key: 'history', label: 'History', icon: 'clock', page: '/home/index.html' },
];
const SECTION_NAME: Record<string, string> = {
  hero: 'Home page top', how: 'How it works', features: 'Features', pricing: 'Pricing page intro',
  faq_title: 'Questions title', faqs: 'Questions', contact: 'Contact details', footer: 'Footer & social links',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changedSections = (a: SiteContent, b: SiteContent) =>
  (Object.keys(SECTION_NAME) as (keyof SiteContent)[]).filter((k) => !same(a[k], b[k]));

export function Website() {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [state, setState] = useState<SiteState | null>(null);
  const [c, setC] = useState<SiteContent | null>(null);       // what is on screen
  const [base, setBase] = useState<SiteContent | null>(null); // what is saved (draft, else live)
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('hero');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [previewOverride, setPreviewOverride] = useState<{ id: number; content: SiteContent } | null>(null);
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone');
  const [showPreview, setShowPreview] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const s: SiteState = mocked
        ? { draft: null, published: { id: 1, content: withDefaults(DEFAULT_SITE), published_at: new Date().toISOString(), by: 'system', note: 'Starting text' }, versions: [{ id: 1, status: 'published', published_at: new Date().toISOString(), by: 'system', note: 'Starting text' }] }
        : await contentApi.site();
      const b = s.draft?.content ?? s.published?.content ?? withDefaults(DEFAULT_SITE);
      setState(s); setBase(b); setC(b);
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      setError(e instanceof Error ? e.message : 'Could not load the website text.');
    }
  }, [lostAccess, mocked]);
  useEffect(() => { void load(); }, [load]);

  const dirty = !!c && !!base && !same(c, base);
  const live = state?.published?.content ?? null;
  const hasDraft = !!state?.draft;
  const vsLive = c && live ? changedSections(c, live) : [];

  // Never lose typing to a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const problem = (x: SiteContent): string | null => {
    const urls = [x.hero.photo, ...Object.values(x.footer.social)].filter(Boolean);
    if (urls.some((u) => !/^https:\/\/[^\s"'<>]+$/i.test(u))) return 'Links and photos must start with https://';
    for (const e of [x.contact.support_email, x.contact.business_email]) if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return `“${e}” does not look like an email.`;
    for (const p of [x.contact.phone, x.contact.whatsapp]) if (p && !/^[+0-9 ()-]{6,30}$/.test(p)) return `“${p}” does not look like a phone number.`;
    if (x.faqs.some((f) => !f.q.trim() || !f.a.trim())) return 'Every question needs both the question and the answer — or delete the empty one.';
    if (!x.hero.title.trim()) return 'The big home page title cannot be empty.';
    return null;
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!c) return false;
    const p = problem(c);
    if (p) { toast('bad', p); return false; }
    setSaving(true);
    try {
      if (!mocked) await contentApi.saveDraft(c);
      setBase(c);
      setState((s) => (s ? { ...s, draft: { id: s.draft?.id ?? 0, content: c, updated_at: new Date().toISOString(), by: null } } : s));
      toast('ok', 'Draft saved. Nobody sees it until you publish.');
      return true;
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return false; }
      toast('bad', e instanceof Error ? e.message : 'Could not save.');
      return false;
    } finally { setSaving(false); }
  };

  const discard = async () => {
    try {
      if (!mocked) await contentApi.discardDraft();
      toast('ok', 'Draft thrown away. The editor shows the live text again.');
      setDiscarding(false); void load();
    } catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not throw it away.'); }
  };

  const page = TABS.find((t) => t.key === tab)!.page;
  const previewContent = previewOverride?.content ?? c;

  return (
    <div className="mc-page">
      <div className="mc-heading s6-heading">
        <div>
          <h1 className="mc-display">Website</h1>
          <p className="mc-muted">Change the words, photos and contact details on menutha.com. Prices come from <strong>Plans & Prices</strong>.</p>
        </div>
        <div className="s6-actions">
          <a className="mc-btn mc-btn-ghost" href="/" target="_blank" rel="noreferrer"><Icon name="globe" size={16} />Open the live site</a>
          <button className="mc-btn mc-btn-ghost" onClick={() => setShowPreview((v) => !v)}><Icon name="phone" size={16} />{showPreview ? 'Hide preview' : 'Show preview'}</button>
          <BusyButton className="mc-btn mc-btn-ghost" busy={saving} disabled={!dirty} onClick={() => void saveDraft()}>Save draft</BusyButton>
          <button className="mc-btn mc-btn-primary" disabled={!c || (!dirty && !hasDraft)} onClick={() => setPublishing(true)}><Icon name="power" size={16} />Publish…</button>
        </div>
      </div>

      {error && <div className="mc-banner" role="alert"><span>{error}</span><button className="mc-btn mc-btn-ghost" onClick={() => void load()}>Try again</button></div>}

      {state && (
        <div className={`s6-status ${dirty ? 's6-status-amber' : hasDraft ? 's6-status-blue' : 's6-status-green'}`}>
          <Icon name={dirty ? 'alert' : hasDraft ? 'clock' : 'check'} size={18} />
          <span>{dirty ? 'You have changes that are not saved yet.'
            : hasDraft ? `A draft is saved but not live yet${vsLive.length ? ` (${vsLive.map((k) => SECTION_NAME[k]).join(', ')})` : ''}. Press Publish to show it.`
            : `The site shows the text below. Published ${fmtDateTime(state.published?.published_at)}${state.published?.by && state.published.by !== 'system' ? ` by ${state.published.by}` : ''}.`}</span>
          {hasDraft && !dirty && <button className="mc-btn mc-btn-ghost" onClick={() => setDiscarding(true)}>Throw away draft</button>}
        </div>
      )}

      <div className="s6-tabs" role="tablist" aria-label="Part of the site">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`s6-tab${tab === t.key ? ' is-on' : ''}`}
            onClick={() => { setTab(t.key); setPreviewOverride(null); }}>
            <Icon name={t.icon} size={16} />{t.label}
          </button>
        ))}
      </div>

      {!c ? <div className="mc-panel"><div className="mc-attn-empty"><span className="mc-spinner" /></div></div> : (
        <div className={`s6-editor${showPreview ? '' : ' no-preview'}`}>
          <div className="s6-form-col">
            {tab === 'hero' && <HeroForm c={c} setC={setC} goPhotos={() => setTab('photos')} />}
            {tab === 'how' && <HowForm c={c} setC={setC} />}
            {tab === 'features' && <FeaturesForm c={c} setC={setC} />}
            {tab === 'pricing' && <PricingForm c={c} setC={setC} />}
            {tab === 'faqs' && <FaqForm c={c} setC={setC} />}
            {tab === 'contact' && <ContactForm c={c} setC={setC} />}
            {tab === 'footer' && <FooterForm c={c} setC={setC} />}
            {tab === 'photos' && <Photos c={c} setC={setC} />}
            {tab === 'history' && state && (
              <History state={state} onPreview={(id, content) => setPreviewOverride({ id, content })}
                previewing={previewOverride?.id ?? null} dirty={dirty} onRestored={() => { setPreviewOverride(null); void load(); }} />
            )}
            {tab !== 'history' && tab !== 'photos' && (
              <div className="s6-card-foot s6-sticky">
                <span className="mc-small mc-muted">{dirty ? 'Not saved yet' : 'Saved'}</span>
                <button className="mc-btn mc-btn-ghost" disabled={!dirty} onClick={() => base && setC(base)}>Undo changes</button>
                <BusyButton className="mc-btn mc-btn-primary" busy={saving} disabled={!dirty} onClick={() => void saveDraft()}>Save draft</BusyButton>
              </div>
            )}
          </div>
          {showPreview && previewContent && (
            <Preview page={page} content={previewContent} device={device} setDevice={setDevice}
              label={previewOverride ? `Old version #${previewOverride.id}` : dirty || hasDraft ? 'Your draft' : 'Live text'} />
          )}
        </div>
      )}

      {publishing && c && live && (
        <PublishModal c={c} live={live} dirty={dirty} saveFirst={saveDraft} onClose={() => setPublishing(false)}
          onDone={() => { setPublishing(false); void load(); }} />
      )}
      {discarding && (
        <Modal title="Throw away the draft?" icon="x" tone="danger" onClose={() => setDiscarding(false)}
          footer={<>
            <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setDiscarding(false)}>Keep it</button>
            <button className="mc-btn mc-btn-danger mc-btn-lg" onClick={() => void discard()}>Throw away</button>
          </>}>
          <p>Your saved, unpublished changes are deleted. The live site is not touched.</p>
        </Modal>
      )}
    </div>
  );
}

// ── Preview (the real page in a frame) ─────────────────────────────────────

function Preview({ page, content, device, setDevice, label }: {
  page: string; content: SiteContent; device: 'phone' | 'desktop'; setDevice: (d: 'phone' | 'desktop') => void; label: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef(content);
  latest.current = content;
  const send = useCallback(() => {
    ref.current?.contentWindow?.postMessage({ type: 'menutha-cms-preview', content: latest.current }, window.location.origin);
  }, []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === 'menutha-cms-ready') send();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [send]);
  useEffect(() => { const t = setTimeout(send, 120); return () => clearTimeout(t); }, [content, send]);

  return (
    <aside className="s6-preview" aria-label="Preview">
      <div className="s6-preview-bar">
        <span className="mc-tag mc-tag-gold">{label}</span>
        <span className="mc-small mc-muted s6-grow">{page.replace('/index.html', '').replace('/home', 'Home') || 'Home'}</span>
        <div className="mc-seg" style={{ margin: 0 }}>
          <button className={device === 'phone' ? 'is-on' : ''} onClick={() => setDevice('phone')}>Phone</button>
          <button className={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')}>Computer</button>
        </div>
      </div>
      <div className={`s6-frame s6-frame-${device}`}>
        <iframe ref={ref} key={page} title="Website preview" src={`${page}?cms-preview=1`} onLoad={send} />
      </div>
      <p className="mc-small mc-muted">This is the real page with your text. Only you can see it here.</p>
    </aside>
  );
}

// ── Small form helpers ────────────────────────────────────────────────────

type SetC = React.Dispatch<React.SetStateAction<SiteContent | null>>;
function useSet(setC: SetC) {
  return <S extends keyof SiteContent>(section: S, patch: Partial<SiteContent[S]> | SiteContent[S]) =>
    setC((x) => (x ? { ...x, [section]: (typeof patch === 'object' && !Array.isArray(patch) && patch !== null
      ? { ...(x[section] as object), ...(patch as object) } : patch) } as SiteContent : x));
}

function Field({ label, hint, value, onChange, rows, max = 400, original, placeholder }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; max?: number; original?: string; placeholder?: string;
}) {
  const changed = original !== undefined && value !== original;
  return (
    <label className="mc-input s6-field">
      <span>{label}{hint && <em> — {hint}</em>}
        {changed && <button type="button" className="s6-reset" onClick={(e) => { e.preventDefault(); onChange(original!); }}>Back to original</button>}
      </span>
      {rows ? <textarea rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function Card({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="s6-card">
      <h2 className="s6-card-title">{title}</h2>
      {help && <p className="mc-small mc-muted" style={{ marginTop: -6, marginBottom: 12 }}>{help}</p>}
      <div className="mc-form">{children}</div>
    </section>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────

function HeroForm({ c, setC, goPhotos }: { c: SiteContent; setC: SetC; goPhotos: () => void }) {
  const set = useSet(setC);
  const d = DEFAULT_SITE.hero;
  return (
    <Card title="The top of the home page" help="The first thing every visitor reads.">
      <Field label="Small line above the title" value={c.hero.eyebrow} original={d.eyebrow} max={80} onChange={(v) => set('hero', { eyebrow: v })} />
      <Field label="Big title" value={c.hero.title} original={d.title} rows={2} max={120} onChange={(v) => set('hero', { title: v })} />
      <Field label="Text under the title" value={c.hero.text} original={d.text} rows={4} max={400} onChange={(v) => set('hero', { text: v })} />
      <Field label="Small note under the buttons" value={c.hero.note} original={d.note} max={140} onChange={(v) => set('hero', { note: v })} />
      <div className="mc-input"><span>Photo on the right <em>— optional; without one the phone picture shows</em></span>
        {c.hero.photo ? (
          <div className="s6-photo-pick">
            <img src={c.hero.photo} alt="" />
            <div><button className="mc-btn mc-btn-ghost" onClick={goPhotos}>Change photo</button>
              <button className="mc-btn mc-btn-ghost" onClick={() => set('hero', { photo: '' })}>Use the phone picture</button></div>
          </div>
        ) : <button className="mc-btn mc-btn-ghost" style={{ justifySelf: 'start' }} onClick={goPhotos}><Icon name="plus" size={16} />Choose a photo</button>}
      </div>
    </Card>
  );
}

function HowForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const set = useSet(setC);
  const d = DEFAULT_SITE.how;
  const step = (i: number, k: 'title' | 'text', v: string) =>
    set('how', { steps: c.how.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  return (
    <Card title="How it works" help="The three numbered steps on the home page.">
      <Field label="Small line above" value={c.how.eyebrow} original={d.eyebrow} max={60} onChange={(v) => set('how', { eyebrow: v })} />
      <Field label="Title" value={c.how.title} original={d.title} max={80} onChange={(v) => set('how', { title: v })} />
      {c.how.steps.map((s, i) => (
        <div key={i} className="s6-step">
          <span className="s6-step-n">{i + 1}</span>
          <div className="mc-form" style={{ flex: 1 }}>
            <Field label={`Step ${i + 1} heading`} value={s.title} original={d.steps[i]?.title} max={60} onChange={(v) => step(i, 'title', v)} />
            <Field label={`Step ${i + 1} text`} value={s.text} original={d.steps[i]?.text} rows={3} max={260} onChange={(v) => step(i, 'text', v)} />
          </div>
        </div>
      ))}
    </Card>
  );
}

function ListEditor({ label, items, original, onChange }: { label: string; items: string[]; original: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="mc-input"><span>{label}{!same(items, original) && <button type="button" className="s6-reset" onClick={() => onChange(original)}>Back to original</button>}</span>
      <div className="s6-bullets">
        {items.map((t, i) => (
          <div key={i} className="s6-bullet">
            <span aria-hidden>✓</span>
            <input value={t} maxLength={120} aria-label={`${label} ${i + 1}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="mc-icon-btn" aria-label="Remove line" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
          </div>
        ))}
        {items.length < 8 && <button type="button" className="mc-btn mc-btn-ghost" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ''])}><Icon name="plus" size={16} />Add a line</button>}
      </div>
    </div>
  );
}

function FeaturesForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const set = useSet(setC);
  const d = DEFAULT_SITE.features;
  return (
    <Card title="Features" help="The two lists: what diners get and what restaurants get.">
      <Field label="Small line above" value={c.features.eyebrow} original={d.eyebrow} max={80} onChange={(v) => set('features', { eyebrow: v })} />
      <Field label="Title" value={c.features.title} original={d.title} max={80} onChange={(v) => set('features', { title: v })} />
      <Field label="Left box heading" value={c.features.diners_title} original={d.diners_title} max={60} onChange={(v) => set('features', { diners_title: v })} />
      <ListEditor label="Left box lines" items={c.features.diners} original={d.diners} onChange={(v) => set('features', { diners: v })} />
      <Field label="Right box heading" value={c.features.restaurants_title} original={d.restaurants_title} max={60} onChange={(v) => set('features', { restaurants_title: v })} />
      <ListEditor label="Right box lines" items={c.features.restaurants} original={d.restaurants} onChange={(v) => set('features', { restaurants: v })} />
    </Card>
  );
}

function PricingForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const set = useSet(setC);
  const d = DEFAULT_SITE.pricing;
  return (
    <Card title="Pricing page — the top" help="Plan names, prices and features are changed in Plans & Prices, not here.">
      <Field label="Small line above" value={c.pricing.eyebrow} original={d.eyebrow} max={40} onChange={(v) => set('pricing', { eyebrow: v })} />
      <Field label="Title" value={c.pricing.title} original={d.title} max={100} onChange={(v) => set('pricing', { title: v })} />
      <Field label="Intro text" value={c.pricing.intro} original={d.intro} rows={4} max={400} onChange={(v) => set('pricing', { intro: v })} />
    </Card>
  );
}

function FaqForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const [removing, setRemoving] = useState<number | null>(null);
  const faqs = c.faqs;
  const put = (list: SiteContent['faqs']) => setC((x) => (x ? { ...x, faqs: list } : x));
  const move = (i: number, by: number) => {
    const j = i + by; if (j < 0 || j >= faqs.length) return;
    const l = [...faqs]; [l[i], l[j]] = [l[j], l[i]]; put(l);
  };
  return (
    <Card title="Questions and answers" help="Shown at the bottom of the pricing page, in this order.">
      <Field label="Title above the questions" value={c.faq_title} original={DEFAULT_SITE.faq_title} max={60}
        onChange={(v) => setC((x) => (x ? { ...x, faq_title: v } : x))} />
      {faqs.map((f, i) => (
        <div key={i} className="s6-faq">
          <div className="s6-faq-head">
            <strong>Question {i + 1}</strong>
            <span className="s6-grow" />
            <button className="mc-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="mc-icon-btn" aria-label="Move down" disabled={i === faqs.length - 1} onClick={() => move(i, 1)}>↓</button>
            {removing === i ? (
              <>
                <button className="mc-btn mc-btn-danger" onClick={() => { put(faqs.filter((_, j) => j !== i)); setRemoving(null); }}>Yes, delete</button>
                <button className="mc-btn mc-btn-ghost" onClick={() => setRemoving(null)}>No</button>
              </>
            ) : <button className="mc-btn mc-btn-ghost" onClick={() => setRemoving(i)}><Icon name="x" size={15} />Delete</button>}
          </div>
          <Field label="Question" value={f.q} max={160} onChange={(v) => put(faqs.map((x, j) => (j === i ? { ...x, q: v } : x)))} />
          <Field label="Answer" value={f.a} rows={3} max={800} onChange={(v) => put(faqs.map((x, j) => (j === i ? { ...x, a: v } : x)))} />
        </div>
      ))}
      {faqs.length < 20 && (
        <button className="mc-btn mc-btn-ghost" style={{ justifySelf: 'start' }} onClick={() => put([...faqs, { q: '', a: '' }])}>
          <Icon name="plus" size={16} />Add a question
        </button>
      )}
      {!same(faqs, DEFAULT_SITE.faqs) && (
        <button className="s6-reset" style={{ justifySelf: 'start' }} onClick={() => put(DEFAULT_SITE.faqs)}>Put back the original questions</button>
      )}
    </Card>
  );
}

function ContactForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const set = useSet(setC);
  const d = DEFAULT_SITE.contact;
  return (
    <Card title="Contact details" help="Shown on the Contact page. Empty phone or WhatsApp = not shown.">
      <div className="mc-form-grid">
        <Field label="Help email" value={c.contact.support_email} original={d.support_email} max={120} onChange={(v) => set('contact', { support_email: v.trim() })} />
        <Field label="Business email" value={c.contact.business_email} original={d.business_email} max={120} onChange={(v) => set('contact', { business_email: v.trim() })} />
        <Field label="Phone" hint="optional" placeholder="+91 98765 43210" value={c.contact.phone} max={30} onChange={(v) => set('contact', { phone: v })} />
        <Field label="WhatsApp" hint="optional" placeholder="+91 98765 43210" value={c.contact.whatsapp} max={30} onChange={(v) => set('contact', { whatsapp: v })} />
      </div>
      <Field label="Company name" value={c.contact.company} original={d.company} max={80} onChange={(v) => set('contact', { company: v })} />
      <Field label="Address" value={c.contact.address} original={d.address} rows={2} max={200} onChange={(v) => set('contact', { address: v })} />
    </Card>
  );
}

const SOCIAL: [keyof SiteContent['footer']['social'], string, string][] = [
  ['instagram', 'Instagram', 'https://instagram.com/menutha'], ['facebook', 'Facebook', 'https://facebook.com/menutha'],
  ['youtube', 'YouTube', 'https://youtube.com/@menutha'], ['linkedin', 'LinkedIn', 'https://linkedin.com/company/menutha'],
  ['x', 'X (Twitter)', 'https://x.com/menutha'],
];
function FooterForm({ c, setC }: { c: SiteContent; setC: SetC }) {
  const set = useSet(setC);
  return (
    <Card title="Footer and social links" help="The bottom of every page. Empty links are not shown.">
      <Field label="Line under the logo" value={c.footer.tagline} original={DEFAULT_SITE.footer.tagline} max={120} onChange={(v) => set('footer', { tagline: v })} />
      <div className="mc-form-grid">
        {SOCIAL.map(([k, l, ph]) => (
          <Field key={k} label={l} hint="optional" placeholder={ph} value={c.footer.social[k]} max={200}
            onChange={(v) => set('footer', { social: { ...c.footer.social, [k]: v.trim() } })} />
        ))}
      </div>
      <p className="mc-small mc-muted">Links must start with https://</p>
    </Card>
  );
}

// ── Photos ────────────────────────────────────────────────────────────────

function Photos({ c, setC }: { c: SiteContent; setC: SetC }) {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [list, setList] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<Photo | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setList(mocked ? [] : await contentApi.photos()); }
    catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not load photos.'); setList([]); }
  }, [lostAccess, mocked, toast]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    const f = files?.[0];
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!PHOTO_TYPES.includes(f.type)) { toast('bad', 'Only JPG, PNG or WebP photos can be used.'); return; }
    if (f.size > MAX_PHOTO_BYTES) { toast('bad', `That photo is ${(f.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`); return; }
    setBusy(true);
    try { await contentApi.uploadPhoto(f); toast('ok', 'Photo uploaded.'); void load(); }
    catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await contentApi.deletePhoto(del.path);
      if (c.hero.photo === del.url) setC((x) => (x ? { ...x, hero: { ...x.hero, photo: '' } } : x));
      toast('ok', 'Photo deleted.'); setDel(null); void load();
    } catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not delete.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="s6-card">
      <h2 className="s6-card-title">Photos</h2>
      <p className="mc-small mc-muted" style={{ marginTop: -6, marginBottom: 12 }}>JPG, PNG or WebP, up to 5 MB. Wide photos look best (about 1200 × 900).</p>
      <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} hidden onChange={(e) => void upload(e.target.files)} />
      <BusyButton className="mc-btn mc-btn-primary" busy={busy} onClick={() => input.current?.click()}><Icon name="plus" size={16} />Upload a photo</BusyButton>
      {!list ? <div className="mc-attn-empty"><span className="mc-spinner" /></div>
        : !list.length ? <p className="mc-muted" style={{ marginTop: 14 }}>No photos yet.</p>
        : (
          <div className="s6-photos">
            {list.map((p) => {
              const used = c.hero.photo === p.url;
              return (
                <figure key={p.path} className={`s6-photo${used ? ' is-used' : ''}`}>
                  <img src={p.url} alt="" loading="lazy" />
                  <figcaption>
                    {used ? <span className="mc-tag mc-tag-gold">On the home page</span>
                      : <button className="mc-btn mc-btn-ghost" onClick={() => setC((x) => (x ? { ...x, hero: { ...x.hero, photo: p.url } } : x))}>Use on home page</button>}
                    <CopyButton text={p.url} label="Copy link" />
                    <button className="mc-icon-btn" aria-label="Delete photo" onClick={() => setDel(p)}><Icon name="x" size={16} /></button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      <p className="mc-small mc-muted" style={{ marginTop: 10 }}>“Use on home page” changes your draft — press Save draft, then Publish.</p>
      {del && (
        <Modal title="Delete this photo?" icon="x" tone="danger" onClose={() => setDel(null)}
          footer={<>
            <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setDel(null)}>Keep it</button>
            <BusyButton className="mc-btn mc-btn-danger mc-btn-lg" busy={busy} onClick={remove}>Delete</BusyButton>
          </>}>
          <img src={del.url} alt="" style={{ maxWidth: '100%', borderRadius: 12 }} />
          {(c.hero.photo === del.url) && <p className="mc-note mc-note-bad">This photo is on the home page. If the live site uses it, publish a version without it first.</p>}
        </Modal>
      )}
    </section>
  );
}

// ── History ───────────────────────────────────────────────────────────────

function History({ state, onPreview, previewing, dirty, onRestored }: {
  state: SiteState; onPreview: (id: number, c: SiteContent) => void; previewing: number | null; dirty: boolean; onRestored: () => void;
}) {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [restoring, setRestoring] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async (id: number) => {
    try { onPreview(id, mocked ? withDefaults(DEFAULT_SITE) : await contentApi.siteVersion(id)); }
    catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not open it.'); }
  };
  const restore = async () => {
    if (restoring === null) return;
    setBusy(true);
    try {
      if (!mocked) await contentApi.restore(restoring);
      toast('ok', 'That version is now your draft. Check the preview, then press Publish.');
      setRestoring(null); onRestored();
    } catch (e) { if (e instanceof ConsoleError && e.denied) { lostAccess(); return; } toast('bad', e instanceof Error ? e.message : 'Could not put it back.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="s6-card">
      <h2 className="s6-card-title">History</h2>
      <p className="mc-small mc-muted" style={{ marginTop: -6, marginBottom: 12 }}>Every version that was live. “Look” shows it in the preview; “Put back” makes it your draft.</p>
      <ul className="s6-list">
        {state.versions.map((v) => (
          <li key={v.id} className={`s6-list-row${previewing === v.id ? ' is-on' : ''}`}>
            <span className="s6-list-main">
              <strong>{v.status === 'published' ? 'Live now' : `Version #${v.id}`}</strong>
              <small>{fmtDateTime(v.published_at)}{v.by && v.by !== 'system' ? ` · ${v.by}` : ''}{v.note ? ` · ${v.note}` : ''}</small>
            </span>
            <button className="mc-btn mc-btn-ghost" onClick={() => void look(v.id)}>Look</button>
            {v.status !== 'published' && <button className="mc-btn mc-btn-ghost" onClick={() => setRestoring(v.id)}>Put back</button>}
          </li>
        ))}
      </ul>
      {restoring !== null && (
        <Modal title="Put this version back?" icon="refresh" tone="gold" onClose={() => setRestoring(null)}
          footer={<>
            <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={() => setRestoring(null)}>Cancel</button>
            <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={restore}>Yes, make it my draft</BusyButton>
          </>}>
          <p>Version #{restoring} becomes your draft. The live site does not change until you press <strong>Publish</strong>.</p>
          {(dirty || state.draft) && <p className="mc-note mc-note-bad">This replaces your current draft{dirty ? ' and the changes you have not saved' : ''}.</p>}
        </Modal>
      )}
    </section>
  );
}

// ── Publish ───────────────────────────────────────────────────────────────

function PublishModal({ c, live, dirty, saveFirst, onClose, onDone }: {
  c: SiteContent; live: SiteContent; dirty: boolean; saveFirst: () => Promise<boolean>; onClose: () => void; onDone: () => void;
}) {
  const { lostAccess, mocked } = useConsole();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => changedSections(c, live), [c, live]);

  const go = async () => {
    setBusy(true);
    try {
      if (dirty && !(await saveFirst())) return;
      if (!mocked) await contentApi.publish(note.trim());
      toast('ok', 'Published. menutha.com shows it now — refresh the site to see it.');
      onDone();
    } catch (e) {
      if (e instanceof ConsoleError && e.denied) { lostAccess(); return; }
      toast('bad', e instanceof Error ? e.message : 'Could not publish.');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Publish to menutha.com?" icon="power" tone="green" onClose={onClose}
      footer={<>
        <button className="mc-btn mc-btn-ghost mc-btn-lg" onClick={onClose}>Not yet</button>
        <BusyButton className="mc-btn mc-btn-primary mc-btn-lg" busy={busy} onClick={go}>Yes, publish</BusyButton>
      </>}>
      {sections.length ? (
        <>
          <p>These parts of the site will change:</p>
          <ul className="s6-diff">{sections.map((k) => <li key={k}><Icon name="check" size={15} /><strong>{SECTION_NAME[k]}</strong></li>)}</ul>
        </>
      ) : <p>Nothing is different from the live site. Publishing keeps it the same.</p>}
      <label className="mc-input" style={{ marginTop: 12 }}><span>Note for History <em>— optional</em></span>
        <input value={note} maxLength={120} placeholder="Diwali text" onChange={(e) => setNote(e.target.value)} /></label>
      <p className="mc-small mc-muted" style={{ marginTop: 10 }}>The old text is kept in History, so you can always put it back.</p>
    </Modal>
  );
}
