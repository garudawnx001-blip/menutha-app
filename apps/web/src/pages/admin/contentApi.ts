/**
 * PAYMENTS, WEBSITE AND APP SETTINGS — the console's data layer for
 * /admin/payments, /admin/website and /admin/settings.
 *
 * Same rules as adminApi.ts: every call is an admin RPC that checks
 * is_platform_admin() itself and writes admin_audit_log. Photos go to the
 * 'site-media' storage bucket, whose policies only let an admin write, and a
 * trigger logs every upload and delete. Nothing here moves money.
 */
import { consoleClient, ConsoleError } from './adminApi';

// ── Types ───────────────────────────────────────────────────────────────────

export type PayKind = 'paid' | 'failed' | 'retrying' | 'stopped' | 'setup' | 'started' | 'cancelled';

export interface PayEvent {
  id: string; at: string; kind: PayKind; amount_inr: number;
  restaurant_id: string | null; restaurant_name: string | null;
  plan_id: string | null; plan_name: string | null;
  method: string | null; error: string | null;
  razorpay_payment_id: string | null; razorpay_subscription_id: string | null;
}

export interface PaySub {
  id: string; kind: 'plan' | 'addon';
  restaurant_id: string; restaurant_name: string | null;
  plan_id: string; plan_name: string | null; status: string;
  amount_inr: number | null; months: number;
  next_charge_at: string | null; current_end: string | null; created_at: string; updated_at: string | null;
  razorpay_subscription_id: string | null; offer_code: string | null;
}

export interface PaymentsOverview {
  generated_at: string; month_start: string; last_month_start: string;
  revenue_this_month: number; revenue_last_month: number;
  events: PayEvent[]; subscriptions: PaySub[];
}

export interface AppSettings {
  trial_days: number; grace_days: number;
  support_phone: string; support_email: string; support_whatsapp: string;
  min_app_version: string; update_message: string;
  maintenance_on: boolean; maintenance_message: string; maintenance_web: boolean; maintenance_app: boolean;
  updated_at: string | null; updated_by_email: string | null;
}

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';
export interface Banner {
  id: string; text: string; tone: BannerTone;
  starts_at: string; ends_at: string | null;
  show_web: boolean; show_app: boolean;
  plan_tiers: string[] | null; restaurant_ids: string[] | null; restaurant_names: string[];
  is_active: boolean; created_at: string; updated_at: string; reach: number;
}
export interface BannerInput {
  id?: string; text: string; tone: BannerTone; starts_at: string; ends_at: string;
  show_web: boolean; show_app: boolean; plan_tiers: string[]; restaurant_ids: string[]; is_active: boolean;
}

/** The public website's editable text. Empty strings mean "keep the page's own text". */
export interface SiteContent {
  hero: { eyebrow: string; title: string; text: string; note: string; photo: string };
  how: { eyebrow: string; title: string; steps: { title: string; text: string }[] };
  features: { eyebrow: string; title: string; diners_title: string; diners: string[]; restaurants_title: string; restaurants: string[] };
  pricing: { eyebrow: string; title: string; intro: string };
  faq_title: string;
  faqs: { q: string; a: string }[];
  contact: { support_email: string; business_email: string; phone: string; whatsapp: string; company: string; address: string };
  footer: { tagline: string; social: { instagram: string; facebook: string; youtube: string; linkedin: string; x: string } };
}

export interface SiteState {
  draft: { id: number; content: SiteContent; updated_at: string; by: string | null } | null;
  published: { id: number; content: SiteContent; published_at: string; by: string | null; note: string | null } | null;
  versions: { id: number; status: 'published' | 'archived'; published_at: string | null; by: string | null; note: string | null }[];
}

export interface Photo { name: string; path: string; url: string; size: number; created_at: string | null }

/**
 * Today's website text, word for word. Used to fill any field a saved version
 * does not have, so the editor always shows something real.
 */
export const DEFAULT_SITE: SiteContent = {
  hero: {
    eyebrow: 'QR ordering · Made for India',
    title: 'The menu is on the table. The order is in the kitchen.',
    text: "Diners scan the QR at their table, browse your live menu, order, and pay you directly — UPI, cash, or card. Your kitchen sees every order the second it's placed. No app installs. No commission. Ever.",
    note: "Zero hardware. Print your QR cards and you're live tonight.",
    photo: '',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Live in three steps',
    steps: [
      { title: 'Print your QR cards', text: 'Every table gets its own QR. Generate and print them from your dashboard in minutes — no hardware, no POS terminal.' },
      { title: 'Diners scan & order', text: 'The QR opens your live menu in their browser — no app download, no sign-up. They customise dishes and order from the seat.' },
      { title: 'Kitchen sees it instantly', text: 'Orders land on your live board in real time with a chime. Accept → prepare → serve, while diners track every step.' },
    ],
  },
  features: {
    eyebrow: 'Built for both sides of the table',
    title: 'One system, two happy sides',
    diners_title: '🍽️ For diners',
    diners: [
      'Scan and order in seconds — no app, no account',
      'Live menu with photos, veg/non-veg, and add-ons',
      'Track your order: placed → preparing → ready',
      'Pay by UPI, cash, or card — your choice',
    ],
    restaurants_title: '👩‍🍳 For restaurants',
    restaurants: [
      'Real-time kitchen board with an audible chime',
      'Edit the menu and prices live; Excel bulk-import',
      'One GST bill per table; daily and monthly reports',
      'Keep 100% of every payment — zero commission',
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'One flat subscription. 0% commission.',
    intro: "Diners pay you directly — UPI or cash. Menutha's only charge is the plan below. Every plan starts with a 30-day free trial of the plan you choose.",
  },
  faq_title: 'Questions, answered',
  faqs: [
    { q: 'Do you really take no commission?', a: "Really. Diner payments go straight to your UPI ID, your counter, or your own gateway account. Menutha's revenue is the subscription — that's the whole model." },
    { q: 'How do I pay for the subscription?', a: 'UPI Autopay or card e-mandate through Razorpay — set up once from your dashboard, cancel anytime. If a charge fails you get a 7-day grace period before ordering pauses; your menu never disappears.' },
    { q: 'What happens after the 30-day trial?', a: "Pick a plan to keep going. If you don't, your public menu stays visible but table ordering pauses until you subscribe." },
    { q: 'Do my diners need to install anything?', a: "No. The QR opens your menu in their phone's browser — order and pay with nothing to download." },
    { q: 'Can I change or cancel plans?', a: 'Upgrade, downgrade, or cancel from the dashboard at any time. Cancellations apply at the end of the billing cycle.' },
  ],
  contact: {
    support_email: 'support@menutha.com', business_email: 'hello@menutha.com', phone: '', whatsapp: '',
    company: 'Menutha Technologies (Daiva)', address: 'Hospet & Hubli, Karnataka, India',
  },
  footer: {
    tagline: 'Menutha Technologies · Hospet & Hubli, Karnataka',
    social: { instagram: '', facebook: '', youtube: '', linkedin: '', x: '' },
  },
};

/** A saved version merged over the defaults, so missing keys never blank a field. */
export function withDefaults(c: Partial<SiteContent> | null | undefined): SiteContent {
  const d = DEFAULT_SITE;
  const x = (c ?? {}) as Partial<SiteContent>;
  const str = (v: unknown, f: string) => (typeof v === 'string' ? v : f);
  const arr = <T,>(v: unknown, f: T[]) => (Array.isArray(v) ? (v as T[]) : f);
  return {
    hero: { ...d.hero, ...(x.hero ?? {}) },
    how: { ...d.how, ...(x.how ?? {}), steps: arr(x.how?.steps, d.how.steps).map((s) => ({ title: str(s?.title, ''), text: str(s?.text, '') })) },
    features: {
      ...d.features, ...(x.features ?? {}),
      diners: arr(x.features?.diners, d.features.diners).map((s) => str(s, '')),
      restaurants: arr(x.features?.restaurants, d.features.restaurants).map((s) => str(s, '')),
    },
    pricing: { ...d.pricing, ...(x.pricing ?? {}) },
    faq_title: str(x.faq_title, d.faq_title),
    faqs: arr(x.faqs, d.faqs).map((f) => ({ q: str(f?.q, ''), a: str(f?.a, '') })),
    contact: { ...d.contact, ...(x.contact ?? {}) },
    footer: { ...d.footer, ...(x.footer ?? {}), social: { ...d.footer.social, ...(x.footer?.social ?? {}) } },
  };
}

// ── Plumbing ───────────────────────────────────────────────────────────────

function rpcError(e: { message?: string; code?: string } | null): ConsoleError {
  if (e?.code === '42501') return new ConsoleError('You are no longer signed in as an admin.', true);
  if (!e?.message || /fetch|network/i.test(e.message)) return new ConsoleError('Could not reach the server. Nothing was changed — try again.');
  return new ConsoleError(e.message);
}
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await consoleClient().rpc(fn, args ?? {});
  if (error) throw rpcError(error);
  return data as T;
}
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export const BUCKET = 'site-media';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ── API ────────────────────────────────────────────────────────────────────

export const contentApi = {
  async payments(): Promise<PaymentsOverview> {
    const o = await rpc<PaymentsOverview>('admin_payments_overview');
    o.revenue_this_month = Number(o.revenue_this_month) || 0;
    o.revenue_last_month = Number(o.revenue_last_month) || 0;
    for (const e of o.events) e.amount_inr = Number(e.amount_inr) || 0;
    for (const s of o.subscriptions) { s.amount_inr = n(s.amount_inr); s.months = Number(s.months) || 1; }
    return o;
  },

  async settings(): Promise<AppSettings> {
    const s = await rpc<AppSettings>('admin_get_app_settings');
    return { ...s, trial_days: Number(s.trial_days), grace_days: Number(s.grace_days) };
  },
  saveSettings: (p: Partial<AppSettings>) => rpc<AppSettings>('admin_save_app_settings', { p }),

  async banners(): Promise<Banner[]> {
    const list = await rpc<Banner[]>('admin_list_banners');
    for (const b of list) { b.reach = Number(b.reach) || 0; b.restaurant_names = b.restaurant_names ?? []; }
    return list;
  },
  saveBanner: (b: BannerInput) => rpc<Banner>('admin_save_banner', { p: {
    ...(b.id ? { id: b.id } : {}), text: b.text, tone: b.tone, starts_at: b.starts_at, ends_at: b.ends_at,
    show_web: b.show_web, show_app: b.show_app, plan_tiers: b.plan_tiers, restaurant_ids: b.restaurant_ids, is_active: b.is_active,
  } }),
  deleteBanner: (id: string) => rpc<void>('admin_delete_banner', { p_id: id }),
  bannerReach: (tiers: string[], ids: string[]) =>
    rpc<number>('admin_banner_reach', { p_tiers: tiers.length ? tiers : null, p_ids: ids.length ? ids : null }).then(Number),

  async site(): Promise<SiteState> {
    const s = await rpc<SiteState>('admin_site_content');
    if (s.draft) s.draft.content = withDefaults(s.draft.content);
    if (s.published) s.published.content = withDefaults(s.published.content);
    s.versions = s.versions ?? [];
    return s;
  },
  siteVersion: async (id: number) => withDefaults(await rpc<SiteContent>('admin_site_version', { p_id: id })),
  saveDraft: (c: SiteContent) => rpc<{ id: number; updated_at: string }>('admin_save_site_draft', { p_content: c }),
  publish: (note: string) => rpc<{ id: number; published_at: string }>('admin_publish_site', { p_note: note }),
  discardDraft: () => rpc<void>('admin_discard_site_draft'),
  restore: (id: number) => rpc<{ id: number }>('admin_restore_site_version', { p_id: id }),

  async photos(): Promise<Photo[]> {
    const c = consoleClient();
    const { data, error } = await c.storage.from(BUCKET).list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw rpcError(error as { message?: string });
    return (data ?? []).filter((f) => f.id && !f.name.startsWith('.')).map((f) => ({
      name: f.name, path: f.name, size: Number((f.metadata as { size?: number } | null)?.size) || 0,
      created_at: f.created_at ?? null,
      url: c.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
    }));
  },
  async uploadPhoto(file: File): Promise<Photo> {
    if (!PHOTO_TYPES.includes(file.type)) throw new ConsoleError('Only JPG, PNG or WebP photos can be used.');
    if (file.size > MAX_PHOTO_BYTES) throw new ConsoleError('That photo is bigger than 5 MB. Please pick a smaller one.');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo';
    const path = `${Date.now().toString(36)}-${base}.${ext}`;
    const c = consoleClient();
    const { error } = await c.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (error) {
      if (/row-level|policy|unauthor|403/i.test(error.message)) throw new ConsoleError('You are no longer signed in as an admin.', true);
      throw new ConsoleError(error.message || 'The photo could not be uploaded. Try again.');
    }
    return { name: path, path, size: file.size, created_at: new Date().toISOString(), url: c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  },
  async deletePhoto(path: string): Promise<void> {
    const { error } = await consoleClient().storage.from(BUCKET).remove([path]);
    if (error) throw new ConsoleError(error.message || 'The photo could not be removed. Try again.');
  },
};

// ── Preview data (dev ?mock only) ─────────────────────────────────────────

export function mockPayments(): PaymentsOverview {
  const now = Date.now(), D = 864e5;
  const iso = (d: number) => new Date(now - d * D).toISOString();
  return {
    generated_at: new Date().toISOString(),
    month_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    last_month_start: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString(),
    revenue_this_month: 2358, revenue_last_month: 1179,
    events: [
      { id: 'e1', at: iso(1), kind: 'paid', amount_inr: 1179, restaurant_id: 'r1', restaurant_name: 'Spice Garden', plan_id: 'growth', plan_name: 'Growth', method: 'upi', error: null, razorpay_payment_id: 'pay_demo1', razorpay_subscription_id: 'sub_demo1' },
      { id: 'e2', at: iso(2), kind: 'failed', amount_inr: 589, restaurant_id: 'r2', restaurant_name: 'Hampi Café', plan_id: 'basic', plan_name: 'Basic', method: 'card', error: 'Card declined by bank', razorpay_payment_id: 'pay_demo2', razorpay_subscription_id: 'sub_demo2' },
      { id: 'e3', at: iso(4), kind: 'setup', amount_inr: 0, restaurant_id: 'r3', restaurant_name: 'Ashwamedha', plan_id: 'growth', plan_name: 'Growth', method: 'upi', error: null, razorpay_payment_id: null, razorpay_subscription_id: 'sub_demo3' },
      { id: 'e4', at: iso(35), kind: 'paid', amount_inr: 1179, restaurant_id: 'r1', restaurant_name: 'Spice Garden', plan_id: 'growth', plan_name: 'Growth', method: 'upi', error: null, razorpay_payment_id: 'pay_demo0', razorpay_subscription_id: 'sub_demo1' },
    ],
    subscriptions: [
      { id: 's1', kind: 'plan', restaurant_id: 'r1', restaurant_name: 'Spice Garden', plan_id: 'growth', plan_name: 'Growth', status: 'active', amount_inr: 1179, months: 1, next_charge_at: new Date(now + 9 * D).toISOString(), current_end: null, created_at: iso(60), updated_at: iso(1), razorpay_subscription_id: 'sub_demo1', offer_code: null },
      { id: 's2', kind: 'plan', restaurant_id: 'r2', restaurant_name: 'Hampi Café', plan_id: 'basic', plan_name: 'Basic', status: 'pending', amount_inr: 589, months: 1, next_charge_at: new Date(now + 1 * D).toISOString(), current_end: null, created_at: iso(40), updated_at: iso(2), razorpay_subscription_id: 'sub_demo2', offer_code: null },
      { id: 's3', kind: 'plan', restaurant_id: 'r3', restaurant_name: 'Ashwamedha', plan_id: 'growth', plan_name: 'Growth', status: 'authenticated', amount_inr: 1179, months: 1, next_charge_at: new Date(now + 26 * D).toISOString(), current_end: null, created_at: iso(4), updated_at: iso(4), razorpay_subscription_id: 'sub_demo3', offer_code: 'WELCOME2' },
    ],
  };
}

export function mockSettings(): AppSettings {
  return {
    trial_days: 30, grace_days: 7, support_phone: '', support_email: 'support@menutha.com', support_whatsapp: '',
    min_app_version: '', update_message: 'A new version of Menutha is ready. Please update the app to keep using it.',
    maintenance_on: false, maintenance_message: 'Menutha is getting a quick upgrade. Some things may be slow for a few minutes.',
    maintenance_web: true, maintenance_app: true, updated_at: null, updated_by_email: null,
  };
}
