/**
 * /admin — the platform console. Lazy-loaded from App.tsx, so none of this is
 * in the bundle a diner or a restaurant downloads.
 *
 * WHAT A NON-ADMIN SEES. Signed out at exactly /admin: a plain "Sign in"
 * card with one Google button and no mention of an admin area. Signed in but
 * not an admin: the generic "Page not found", and the console's own session is
 * dropped (scope 'local' — the partner portal's session, which lives in a
 * different client and storage key, is untouched). Any deeper /admin/... path
 * is a 404 for everyone who is not a signed-in admin.
 *
 * This file only decides what to draw. The data and every action are
 * protected in Postgres: each RPC re-checks is_platform_admin() and raises
 * otherwise, and the admin-accounts edge function does the same.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import {
  checkIsAdmin, consoleClient, realApi, startAdminSession, type AdminOverview, type ConsoleApi,
} from './adminApi';
import { Shell } from './Shell';
import { Home } from './Home';
import { Restaurants } from './Restaurants';
import { Activity } from './Activity';
import { ComingNext } from './ComingNext';
import { DetailDrawer } from './DetailDrawer';
import { CreateAccount } from './CreateAccount';
import { NotFound } from './NotFound';
import { Ctx, ToastProvider, useToast, type ConsoleCtx } from './ui';
import { GoogleMark } from '../partner/GoogleMark';
import './admin.css';

type Gate =
  | { kind: 'loading' }
  | { kind: 'signin'; error?: string }
  | { kind: 'notfound' }
  | { kind: 'admin'; email: string };

/** noindex/nofollow for as long as the console is mounted. Pages serves one
 *  SPA shell for every route, so the tag has to be added here (deploy.yml also
 *  writes it into the static /admin/index.html for crawlers that do not run JS). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Menutha';
    return () => { meta.remove(); document.title = prevTitle; };
  }, []);
}

/** Strip ?code= / OAuth error params once the client has consumed them. */
function cleanUrl() {
  const u = new URL(window.location.href);
  if (u.searchParams.has('code') || u.searchParams.has('error') || u.searchParams.has('error_description')) {
    window.history.replaceState(null, '', u.pathname);
  }
}

export default function AdminApp() {
  useNoIndex();
  const loc = useLocation();
  const isRoot = /^\/admin\/?$/.test(loc.pathname);

  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [api, setApi] = useState<ConsoleApi>(realApi);
  const mocked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // DEV-ONLY preview states: /admin?mock, ?mock=denied, ?mock=signin.
      // import.meta.env.DEV is false in production builds, so this block and
      // the fixtures chunk are not shipped.
      if (import.meta.env.DEV) {
        const m = new URLSearchParams(window.location.search).get('mock');
        if (m !== null || sessionStorage.getItem('menutha-console-mock')) {
          mocked.current = true;
          sessionStorage.setItem('menutha-console-mock', '1');
          if (m === 'denied') { setGate({ kind: 'notfound' }); return; }
          if (m === 'signin') { setGate({ kind: 'signin' }); return; }
          const { mockApi } = await import('./mockOverview');
          if (cancelled) return;
          setApi(mockApi());
          setGate({ kind: 'admin', email: 'menutha45@gmail.com' });
          return;
        }
      }

      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get('error_description');
      const client = consoleClient();
      const { data: s } = await client.auth.getSession();   // also completes a ?code= exchange
      cleanUrl();
      if (cancelled) return;

      const session = s.session;
      if (!session) {
        setGate({ kind: 'signin', error: oauthError ? 'Sign-in was cancelled or failed. Please try again.' : undefined });
        return;
      }

      let ok = false;
      try { ok = await checkIsAdmin(); } catch { ok = false; }
      if (cancelled) return;
      if (!ok) {
        await client.auth.signOut({ scope: 'local' });
        setGate({ kind: 'notfound' });
        return;
      }

      // Bind + audit. Non-fatal: the admin check above already passed.
      try { await startAdminSession(session.user.id); } catch { /* logged server-side when it works */ }
      if (cancelled) return;
      setGate({ kind: 'admin', email: session.user.email ?? '' });
    })();

    const { data: sub } = consoleClient().auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT' && !mocked.current) {
        setGate((g) => (g.kind === 'admin' ? { kind: 'signin' } : g));
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = async () => {
    setGate({ kind: 'loading' });
    const { error } = await consoleClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/admin`, queryParams: { prompt: 'select_account' } },
    });
    if (error) setGate({ kind: 'signin', error: 'Could not reach Google. Please try again.' });
  };

  const signOut = useCallback(async () => {
    if (mocked.current) { try { sessionStorage.removeItem('menutha-console-mock'); } catch { /* ignore */ } }
    else await consoleClient().auth.signOut({ scope: 'local' });
    setGate({ kind: 'signin' });
  }, []);

  const lostAccess = useCallback(async () => {
    await consoleClient().auth.signOut({ scope: 'local' });
    setGate({ kind: 'notfound' });
  }, []);

  if (gate.kind === 'loading') return <div className="mc-root mc-center"><span className="mc-spinner" aria-label="Loading" /></div>;
  if (gate.kind === 'notfound') return <NotFound />;
  if (gate.kind === 'signin') return isRoot ? <SignIn error={gate.error} onGoogle={signIn} /> : <NotFound />;

  return (
    <ToastProvider>
      <Console email={gate.email} api={api} mocked={mocked.current} signOut={signOut} lostAccess={lostAccess} />
    </ToastProvider>
  );
}

function Console({ email, api, mocked, signOut, lostAccess }: {
  email: string; api: ConsoleApi; mocked: boolean; signOut: () => void; lostAccess: () => void;
}) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setRefreshing(true); setLoadError('');
    try {
      setData(await api.fetchOverview());
    } catch (e) {
      if ((e as { denied?: boolean })?.denied) { lostAccess(); return; }
      setLoadError('Could not load the latest numbers. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, [api, lostAccess]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Fresh numbers when the tab comes back into view; cheap and keeps it honest.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const closeDrawer = useCallback(() => setOpenId(null), []);
  const ctx = useMemo<ConsoleCtx>(() => ({
    email, data, refreshing, loadError, refresh, api, mocked,
    openRestaurant: (id) => setOpenId(id),
    openCreate: () => setCreating(true),
    signOut, lostAccess: () => { toast('bad', 'You are no longer signed in as an admin.'); lostAccess(); },
  }), [email, data, refreshing, loadError, refresh, api, mocked, signOut, lostAccess, toast]);

  const open = openId ? data?.restaurants.find((r) => r.id === openId) ?? null : null;

  return (
    <Ctx.Provider value={ctx}>
      <Shell>
        <Routes>
          <Route index element={<Home />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="plans" element={<ComingNext section="plans" />} />
          <Route path="offers" element={<ComingNext section="offers" />} />
          <Route path="payments" element={<ComingNext section="payments" />} />
          <Route path="website" element={<ComingNext section="website" />} />
          <Route path="settings" element={<ComingNext section="settings" />} />
          <Route path="activity" element={<Activity />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
      <DetailDrawer restaurant={open} onClose={closeDrawer} />
      {creating && <CreateAccount onClose={() => setCreating(false)} />}
    </Ctx.Provider>
  );
}

function SignIn({ error, onGoogle }: { error?: string; onGoogle: () => void }) {
  return (
    <div className="mc-root mc-center mc-signin-bg">
      <div className="mc-signin">
        <img src="/menutha-mark.svg" alt="" width={44} height={44} className="mc-signin-mark" />
        <h1 className="mc-display">Sign in</h1>
        <p className="mc-muted">Continue with your Google account.</p>
        <button className="mc-google" onClick={onGoogle}>
          <GoogleMark size={18} />
          <span>Continue with Google</span>
        </button>
        {error && <p className="mc-signin-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
