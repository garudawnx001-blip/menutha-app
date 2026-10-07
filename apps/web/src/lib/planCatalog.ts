/**
 * THE PLAN CATALOG, as the database says it is right now.
 *
 * public.get_plan_catalog() is the one public answer to "what plans exist,
 * what do they cost, what do they include, and is there an offer on?" --
 * edited from /admin/plans and /admin/offers. Every surface that shows a plan
 * reads it from here: the partner Plan screen, the entitlement gate (feature
 * lists), and the upgrade nudges.
 *
 * KEPT CURRENT three ways, because a price change must reach a screen that is
 * already open: realtime on plan_catalog and subscription_plans, a re-read
 * when the tab regains focus, and a slow poll as a floor for networks that
 * drop the socket. One module-level copy is shared by every caller, so the
 * shell and the Plan screen never disagree and never fetch twice.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { PlanCatalogMap } from '../../../../packages/entitlements/index.js';

export interface CatalogPrice {
  id: string;
  duration_months: number;
  price_inr: number;
  charge_inr: number | null;
  gst_pct: number;
  checkout_ready: boolean;
}

export interface CatalogTier {
  id: 'basic' | 'growth' | 'enterprise';
  display_name: string;
  description: string | null;
  is_popular: boolean;
  is_active: boolean;
  features: string[];
  limits: Record<string, unknown>;
  prices: CatalogPrice[];
}

export interface CatalogBanner {
  code: string;
  title: string;
  text: string;
  label: string;
  plan_tiers: string[] | null;
  customer_scope: 'all' | 'new' | 'existing';
  ends_at: string | null;
}

export interface PlanCatalog {
  tiers: CatalogTier[];
  addons: { id: string; display_name: string; description: string | null; features: string[]; price_inr: number | null }[];
  features: Record<string, { label: string; hidden: boolean; sort: number }>;
  entitlements: PlanCatalogMap;
  banners: CatalogBanner[];
  updated_at: string | null;
}

let current: PlanCatalog | null = null;
let inflight: Promise<PlanCatalog | null> | null = null;
const listeners = new Set<(c: PlanCatalog | null) => void>();

/** Fetch (deduplicated). Resolves null on failure: callers fall back to
 *  built-in lists rather than breaking. */
export function refreshPlanCatalog(): Promise<PlanCatalog | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_plan_catalog');
      if (error || !data || typeof data !== 'object') return current;
      const c = data as PlanCatalog;
      for (const t of c.tiers ?? []) for (const p of t.prices ?? []) {
        p.price_inr = Number(p.price_inr); p.gst_pct = Number(p.gst_pct);
        p.charge_inr = p.charge_inr == null ? null : Number(p.charge_inr);
      }
      current = c;
      listeners.forEach((l) => l(current));
      return current;
    } catch {
      return current;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

let channelUsers = 0;
let channel: ReturnType<typeof supabase.channel> | null = null;
let pollTimer: number | null = null;
const onFocus = () => { if (document.visibilityState !== 'hidden') void refreshPlanCatalog(); };

function startLive() {
  channelUsers += 1;
  if (channelUsers > 1) return;
  channel = supabase
    .channel(`plan-catalog-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_catalog' }, () => { void refreshPlanCatalog(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscription_plans' }, () => { void refreshPlanCatalog(); })
    .subscribe();
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  pollTimer = window.setInterval(() => { void refreshPlanCatalog(); }, 5 * 60_000);
}

function stopLive() {
  channelUsers = Math.max(0, channelUsers - 1);
  if (channelUsers > 0) return;
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onFocus);
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
}

/** The live catalog. Null until the first answer (and if it never comes). */
export function usePlanCatalog(): PlanCatalog | null {
  const [c, setC] = useState<PlanCatalog | null>(current);
  useEffect(() => {
    listeners.add(setC);
    startLive();
    void refreshPlanCatalog();
    return () => { listeners.delete(setC); stopLive(); };
  }, []);
  return c;
}

/** Plain words for a feature key; the key itself only if the catalog is unreachable. */
export function featureLabel(c: PlanCatalog | null, key: string, fallback?: Record<string, string>): string {
  return c?.features?.[key]?.label ?? fallback?.[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
}

/** Features worth showing on a price list: not the legacy aliases. */
export function visibleFeatures(c: PlanCatalog | null, keys: string[]): string[] {
  return keys.filter((k) => !c?.features?.[k]?.hidden);
}
