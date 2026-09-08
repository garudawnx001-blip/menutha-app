/**
 * Everything after the account exists, in one place.
 *
 * THE MODEL, as he finalised it. Google is the front door: "Continue with
 * Google" returns an already-verified email, so there is no inbox step. What
 * the account still lacks is a USERNAME and a PASSWORD, and this page asks
 * for both -- "Finish setup" -- before the restaurant form. Email sign-up is
 * the secondary door: it collects username + password up front and confirms
 * the address by LINK, and that link lands here with the username already in
 * user metadata, so the setup step is skipped and the restaurant form is
 * next. Either way the same user ends up with username, password and a
 * Google-or-confirmed email, and all three log-in doors open one account.
 *
 * WHO LANDS HERE AND WHAT THEY SEE
 *   - a member of a restaurant already      -> straight to the orders board
 *   - a Google user with no username yet    -> Finish setup, then the form
 *   - an email user (username in metadata)  -> the restaurant form
 *   - nobody signed in                      -> the login page
 *
 * Every read is re-run on auth changes because both doors arrive by redirect:
 * Supabase installs the session from the URL a moment after first paint.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';
import { loadMembership } from '../../lib/portalApi';
import { usernameAvailable, usernameProblem } from '../../lib/auth';

type Phase = 'checking' | 'finish' | 'restaurant';

/** `previewPhase` is for the design preview only: it draws that step from a
 *  fixture instead of reading the session. */
export function Register({ previewPhase }: { previewPhase?: Phase } = {}) {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>(previewPhase ?? 'checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** The signed-in email, read-only on the setup step: Google verified it. */
  const [email, setEmail] = useState('');
  /** The handle. Set here on the Google path, or read back off metadata on the
   *  email path; either way it is what complete_restaurant_signup claims. */
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [form, setForm] = useState({ owner: '', name: '', city: '', address: '', gstin: '' });

  const readState = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) { nav('/partner', { replace: true }); return; }
    // Already a member somewhere: this page has nothing to add. Google on the
    // log-in side redirects here too, so this is the bounce that makes one
    // redirect target safe for both new and returning owners.
    const member = await loadMembership();
    if (member) { nav('/partner/orders', { replace: true }); return; }
    setEmail(user.email ?? '');
    const meta = (user.user_metadata as any) ?? {};
    if (typeof meta.username === 'string' && meta.username) {
      setUsername(meta.username);
      setPhase('restaurant');
    } else {
      setPhase('finish');
    }
  };

  useEffect(() => {
    if (previewPhase) { setEmail('priya@ashwamedha.in'); return; }
    readState();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { readState(); });
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * FINISH SETUP: username + password on the user Google just created.
   *
   * updateUser sets the password on the SAME auth user that holds the Google
   * identity, so "email + password" signs into this account from then on,
   * and the username rides in metadata until the restaurant is created and
   * complete_restaurant_signup claims it under the unique index. The
   * availability check here is the friendly pass; the server checks again.
   */
  const finishSetup = async () => {
    const handle = username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    if (problem) { setError(problem); return; }
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    setBusy(true); setError('');
    try {
      if (!(await usernameAvailable(handle))) { setError('That username is taken. Try another.'); return; }
      const { error: err } = await supabase.auth.updateUser({
        password,
        data: { username: handle, password_set: true },
      });
      if (err) {
        setError(/reauthenticat|nonce/i.test(err.message)
          ? 'Sign in with Google again, then set your password — the session is too old to change it.'
          : err.message);
        return;
      }
      setUsername(handle);
      setPhase('restaurant');
    } catch (e: any) {
      setError(e?.message ?? 'Could not finish setup.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form.owner.trim() || !form.name.trim()) { setError('Your name and the restaurant name are required.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('complete_restaurant_signup', {
      p_manager_name: form.owner.trim(),
      p_restaurant_name: form.name.trim(),
      p_city: form.city.trim() || null,
      p_address: form.address.trim() || null,
      p_gstin: form.gstin.trim() || null,
      p_username: username || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes('not authenticated')
        ? 'Please sign in first.' : err.message);
      return;
    }
    nav('/partner/orders', { replace: true });
  };

  const stepLabel = phase === 'finish' ? 'Step 1 of 2' : 'Step 2 of 2';
  const title = phase === 'finish' ? 'Finish setting up' : 'Register your restaurant';

  return (
    <div className="page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={24} />
        <span className="badge gold">30-day free trial</span>
      </div>
      <div className="center-fill auth-fill">
        {phase !== 'checking' && (
          <div className="auth-head">
            <p className="overline">{stepLabel}</p>
            <h1 className="display auth-title">{title}</h1>
            <p className="muted auth-sub">
              {phase === 'finish'
                ? 'Google confirmed your email. Choose a username and a password so you can also sign in without Google — on the portal and in the app.'
                : 'A few details and your restaurant is live. Full Growth features for 30 days, no card needed.'}
            </p>
          </div>
        )}

        {phase === 'checking' ? (
          <div className="state-card" role="status"><div className="spinner" /><p className="dim">Opening your account…</p></div>
        ) : phase === 'finish' ? (
          <div className="glass auth-card">
            <label className="field-label" htmlFor="setup-email">Email</label>
            <input id="setup-email" className="code-input is-readonly" value={email} readOnly aria-readonly />
            <label className="field-label" htmlFor="setup-username">Username</label>
            {/* Lower-cased as typed, so what the owner sees is what is stored.
                Instagram's alphabet: letters, numbers, dot, underscore. */}
            <input
              id="setup-username"
              className="code-input" type="text" autoComplete="username" autoFocus
              placeholder="ashwamedha_lodge" value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30))} />
            <label className="field-label" htmlFor="setup-password">Password</label>
            <input id="setup-password" className="code-input" type="password" autoComplete="new-password"
              placeholder="At least 8 characters" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && finishSetup()} />
            {error && <p className="field-error">{error}</p>}
            <button className={`btn btn-glass btn-block auth-primary${busy ? ' is-busy' : ''}`} disabled={busy} onClick={finishSetup}>
              Continue
            </button>
            <p className="dim auth-note">Your restaurant details are next. No card, nothing is charged.</p>
          </div>
        ) : (
        <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 20, textAlign: 'left' }}>
          <p className="dim" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
            ✓ Signed in as {email}{username ? ` · @${username}` : ''}
          </p>
          <p className="overline" style={{ marginBottom: 6 }}>Your name</p>
          <input className="code-input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          <p className="overline" style={{ margin: '12px 0 6px' }}>Restaurant name</p>
          <input className="code-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p className="overline" style={{ margin: '12px 0 6px' }}>City</p>
              <input className="code-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <p className="overline" style={{ margin: '12px 0 6px' }}>GSTIN (optional)</p>
              <input className="code-input" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </div>
          </div>
          <p className="overline" style={{ margin: '12px 0 6px' }}>Address</p>
          <input className="code-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
          <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
            {'Start free trial'}
          </button>
          <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            Full Growth features for 30 days · no card needed · zero commission always.
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
