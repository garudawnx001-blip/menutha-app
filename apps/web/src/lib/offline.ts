/**
 * OFFLINE MODE in the portal: the same queue as the app (lib/offlineQueue.ts,
 * mirrored) on this browser's localStorage, the connection check, and the
 * browser's copies of the menu, tables, price settings and open orders.
 *
 * Works while the portal tab stays open: an order taken at the counter with
 * the connection down is saved here, its KOT prints, and it is sent when the
 * connection is back. (Opening the portal from scratch with no connection
 * needs the site itself cached; that is not part of this step.)
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { OfflineQueue, type KV, type QueueState } from './offlineQueue';
import type { PricingSnapshot } from './offlineCalc';

const kv: KV = {
  get: async (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: async (k, v) => { try { localStorage.setItem(k, v); } catch { /* full / private mode */ } },
};
const uid = () => (globalThis as any).crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

export const queue = new OfflineQueue(kv, async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}, uid);

export type ConnState = 'online' | 'offline' | 'syncing';
type Conn = { state: ConnState; pending: number; conflicts: number };
let conn: Conn = { state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online', pending: 0, conflicts: 0 };
const subs = new Set<(c: Conn) => void>();
const emit = (p: Partial<Conn>) => { conn = { ...conn, ...p }; subs.forEach((f) => f(conn)); };
queue.subscribe((s: QueueState) => emit({
  pending: s.ops.filter((o) => o.status === 'pending').length,
  conflicts: s.ops.filter((o) => o.status === 'conflict').length,
}));

let timer: ReturnType<typeof setInterval> | null = null;
let watching: string | null = null;

export async function checkNow(restaurantId: string | null = watching): Promise<ConnState> {
  if (!restaurantId) return conn.state;
  let ok = false;
  try {
    const { error } = await supabase.rpc('sync_ping', { p_restaurant_id: restaurantId });
    ok = !error || /PGRST202|could not find the function/i.test(String(error.message ?? '')) || !!(error as any).code;
  } catch { ok = false; }
  if (!ok) { emit({ state: 'offline' }); return 'offline'; }
  await queue.load();
  if (queue.open().some((o) => o.status === 'pending')) {
    emit({ state: 'syncing' });
    const rep = await queue.sync();
    emit({ state: rep.reachable ? 'online' : 'offline' });
    if (rep.reachable) queue.prune().catch(() => {});
    return rep.reachable ? 'online' : 'offline';
  }
  emit({ state: 'online' });
  return 'online';
}

export function watchConnection(restaurantId: string) {
  if (watching === restaurantId && timer) return;
  watching = restaurantId;
  if (timer) clearInterval(timer);
  queue.load().then(() => checkNow(restaurantId)).catch(() => {});
  timer = setInterval(() => { checkNow(restaurantId).catch(() => {}); }, 15_000);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { checkNow(restaurantId).catch(() => {}); });
    window.addEventListener('offline', () => emit({ state: 'offline' }));
  }
}

export function useConnection(restaurantId: string) {
  const [c, setC] = useState<Conn>(conn);
  useEffect(() => {
    watchConnection(restaurantId);
    subs.add(setC); setC(conn);
    return () => { subs.delete(setC); };
  }, [restaurantId]);
  return { ...c, syncNow: () => checkNow(restaurantId) };
}
export function noteNetworkFailure() { emit({ state: 'offline' }); }
export const isOffline = () => conn.state === 'offline';
export const isNetworkError = (e: any) => /failed to fetch|networkerror|network request failed|fetch failed|load failed|timeout/i.test(String(e?.message ?? e));

export interface OfflineDish { id: string; name: string; price: number; is_available?: boolean | null; gst_rate?: number | null }
export interface OfflineTable { id: string; label: string; is_parcel?: boolean | null }
export interface OfflineOpenOrder {
  id: string; order_no: number; table_id?: string | null; table_label?: string; is_parcel?: boolean;
  total: number; placed_at: string; items: { name: string; qty: number; unit_price: number }[];
}
export interface OfflineData { at: string; menu: OfflineDish[]; tables: OfflineTable[]; pricing: PricingSnapshot & { name?: string }; openOrders: OfflineOpenOrder[] }
const DATA = (rid: string) => `menutha.offline.data.v1.${rid}`;

export function readOfflineData(restaurantId: string): OfflineData | null {
  try { return JSON.parse(localStorage.getItem(DATA(restaurantId)) ?? 'null'); } catch { return null; }
}
export function writeOfflineData(restaurantId: string, patch: Partial<OfflineData>) {
  const cur = readOfflineData(restaurantId) ?? { at: '', menu: [], tables: [], pricing: {}, openOrders: [] };
  try { localStorage.setItem(DATA(restaurantId), JSON.stringify({ ...cur, ...patch, at: new Date().toISOString() })); } catch { /* full */ }
}
export const newLocalId = (p: string) => `${p}:${uid()}`;
