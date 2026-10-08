/**
 * PHASE 3: A FREE CRASH LOG, kept in our own database (log_client_error).
 *
 * What it records: the message, a short stack and the screen -- never a phone
 * number, a name or a token (scrubbed here and again on the server). Offline,
 * reports wait in this browser (at most 20) and are sent when it is back.
 * It must never be the thing that breaks a page, so every step swallows its
 * own errors.
 */
import { supabase } from './supabase';

const KEY = 'menutha-web:crashq';
const VERSION = (import.meta as any).env?.VITE_APP_VERSION ?? 'web';

type Report = { surface: 'web-portal' | 'web-diner'; message: string; stack?: string; where: string; at: number };

const scrub = (s: string) => s
  .replace(/[6-9]\d{9}/g, '[phone]')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/(token|visit|access_token|apikey)=[^&\s]+/gi, '$1=…');

function read(): Report[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list: Report[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-20))); } catch { /* storage full or blocked */ }
}

let flushing = false;
export async function flushCrashes(): Promise<void> {
  if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    let list = read();
    while (list.length) {
      const r = list[0];
      const { error } = await supabase.rpc('log_client_error', {
        p_surface: r.surface, p_message: r.message, p_stack: r.stack ?? null, p_where: r.where, p_app_version: VERSION,
      });
      if (error && /network|fetch/i.test(error.message)) break;   // try again later
      list = list.slice(1);
      write(list);
    }
  } catch { /* offline: keep the queue */ } finally { flushing = false; }
}

export function reportCrash(error: unknown, where?: string) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const path = where ?? (typeof location !== 'undefined' ? location.pathname : '');
    const report: Report = {
      surface: path.startsWith('/partner') || path.startsWith('/admin') ? 'web-portal' : 'web-diner',
      message: scrub(String(e.message || e.name || 'Error')).slice(0, 500),
      stack: scrub(String(e.stack || '')).slice(0, 4000) || undefined,
      where: scrub(path).slice(0, 200),
      at: Date.now(),
    };
    write([...read(), report]);
    flushCrashes();
  } catch { /* never throw from the crash reporter */ }
}

let installed = false;
/** Uncaught errors and rejected promises, once per page. */
export function installCrashHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // Resource load errors (an image 404) are not crashes.
    if ((ev as ErrorEvent).error) reportCrash((ev as ErrorEvent).error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = (ev as PromiseRejectionEvent).reason;
    // A failed network call is not a crash; the screen already says so.
    if (r && /network|fetch|load failed/i.test(String(r?.message ?? r))) return;
    reportCrash(r);
  });
  window.addEventListener('online', () => { flushCrashes(); });
  flushCrashes();
}
