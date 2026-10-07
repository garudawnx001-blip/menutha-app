/**
 * App settings from /admin/settings, for the partner web.
 *
 *   useTrialDays()           the free-trial length shown in sign-up and Plan copy
 *   usePlatformNotices(rid)  banners + maintenance notice + help contacts
 *
 * Both fall back to today's values (30 days, no banners) if the database
 * cannot be reached, so a network hiccup never changes what an owner reads.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const DEFAULT_TRIAL_DAYS = 30;

export interface PlatformNotices {
  banners: { id: string; text: string; tone: 'info' | 'success' | 'warning' | 'danger'; updated_at: string }[];
  maintenance: { message: string } | null;
  support: { phone: string; email: string; whatsapp: string };
  trial_days: number;
}

let trialCache: number | null = null;
let trialPromise: Promise<number> | null = null;

function loadTrialDays(): Promise<number> {
  if (trialCache !== null) return Promise.resolve(trialCache);
  if (!trialPromise) {
    trialPromise = Promise.resolve(supabase.rpc('get_app_config'))
      .then(({ data, error }) => {
        const n = Number((data as { trial_days?: unknown } | null)?.trial_days);
        trialCache = !error && Number.isInteger(n) && n > 0 ? n : DEFAULT_TRIAL_DAYS;
        return trialCache;
      })
      .catch(() => { trialPromise = null; return DEFAULT_TRIAL_DAYS; });
  }
  return trialPromise;
}

/** The free-trial length in days. 30 until the setting arrives, and if it cannot. */
export function useTrialDays(): number {
  const [n, setN] = useState<number>(trialCache ?? DEFAULT_TRIAL_DAYS);
  useEffect(() => {
    let on = true;
    void loadTrialDays().then((v) => { if (on) setN(v); });
    return () => { on = false; };
  }, []);
  return n;
}

const EMPTY: PlatformNotices = { banners: [], maintenance: null, support: { phone: '', email: '', whatsapp: '' }, trial_days: DEFAULT_TRIAL_DAYS };

/** Banners and the maintenance notice for this restaurant. Re-checked every 5 minutes and on focus. */
export function usePlatformNotices(restaurantId: string | null | undefined): PlatformNotices {
  const [v, setV] = useState<PlatformNotices>(EMPTY);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('my_platform_notices', { p_restaurant_id: restaurantId ?? null, p_surface: 'web' });
        if (!on || error || !data) return;
        const d = data as Partial<PlatformNotices>;
        setV({
          banners: Array.isArray(d.banners) ? d.banners : [],
          maintenance: d.maintenance && typeof d.maintenance.message === 'string' ? d.maintenance : null,
          support: { phone: d.support?.phone ?? '', email: d.support?.email ?? '', whatsapp: d.support?.whatsapp ?? '' },
          trial_days: Number(d.trial_days) || DEFAULT_TRIAL_DAYS,
        });
      } catch { /* keep what we have */ }
    };
    void load();
    const t = window.setInterval(load, 5 * 60 * 1000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { on = false; window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [restaurantId]);
  return v;
}
