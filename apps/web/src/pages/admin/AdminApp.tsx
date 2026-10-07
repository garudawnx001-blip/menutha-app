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
 * This file only decides what to draw. The data is protected in Postgres: every
 * RPC the console calls re-checks is_platform_admin() and raises otherwise.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import {
  checkIsAdmin, consoleClient, fetchOverview, startAdminSession, type AdminOverview,
} from './adminApi';
import { Dashboard } from './Dashboard';
import { NotFound } from './NotFound';
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
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mocked = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true); setLoadError('');
    try {
      if (import.meta.env.DEV && mocked.current) {
        const { mockOverview } = await import('./mockOverview');
        await new Promise((r) => setTimeout(r, 350));
        setData(mockOverview());
      } else {
        setData(await fetchOverview());
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // Lost admin rights mid-session: become a 404, like any other non-admin.
      if (code === '42501') { await consoleClient().auth.signOut({ scope: 'local' }); setGate({ kind: 'notfound' }); return; }
      setLoadError('Could not load the latest data. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // DEV-ONLY preview states: /admin?mock, ?mock=denied, ?mock=signin.
      // import.meta.env.DEV is false in production builds, so this block and
      // the fixtures chunk are not shipped.
      if (import.meta.env.DEV) {
        const m = new URLSearchParams(window.location.search).get('mock');
        if (m !== null) {
          mocked.current = true;
          if (m === 'denied') { setGate({ kind: 'notfound' }); return; }
          if (m === 'signin') { setGate({ kind: 'signin' }); return; }
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
        setData(null);
        setGate((g) => (g.kind === 'admin' ? { kind: 'signin' } : g));
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (gate.kind === 'admin' && !data) void load();
  }, [gate.kind, data, load]);

  const signIn = async () => {
    setGate({ kind: 'loading' });
    const { error } = await consoleClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/admin`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) setGate({ kind: 'signin', error: 'Could not reach Google. Please try again.' });
  };

  const signOut = async () => {
    if (!mocked.current) await consoleClient().auth.signOut({ scope: 'local' });
    setData(null);
    setGate({ kind: 'signin' });
  };

  if (gate.kind === 'loading') return <div className="mc-root mc-center"><span className="mc-spinner" aria-label="Loading" /></div>;
  if (gate.kind === 'notfound') return <NotFound />;
  if (gate.kind === 'signin') return isRoot ? <SignIn error={gate.error} onGoogle={signIn} /> : <NotFound />;

  return (
    <Routes>
      <Route
        index
        element={
          <Dashboard
            email={gate.email}
            data={data}
            refreshing={refreshing}
            error={loadError}
            onRefresh={load}
            onSignOut={signOut}
          />
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
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
