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
import { usernameAvailable, usernameProblem, cleanHandle, passwordProblem } from '../../lib/auth';

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
  /** Step 2's email field -- prefilled from Google, editable. See the note on
   *  the input. */
  const [newEmail, setNewEmail] = useState('');

  const [form, setForm] = useState({
    owner: '', name: '', city: '', address: '', gstin: '', phone: '', maps_url: '',
  });

  /**
   * IS SUPABASE STILL MID-HANDSHAKE?
   *
   * Google comes back to /partner/register#access_token=... and supabase-js
   * reads that fragment asynchronously. Until it has, getUser() answers null
   * quite legitimately -- the session is seconds away, not absent.
   *
   * Only the artifacts that mean "a session is coming" count. An error in the
   * hash is not one of them: that handshake has already failed, and waiting on
   * it would strand somebody on a spinner.
   */
  const oauthLanding = () =>
    /[#&](access_token|refresh_token)=/.test(window.location.hash)
    || /[?&]code=/.test(window.location.search);

  const readState = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      /**
       * THE BUG THIS PAGE WAS REPORTED FOR, and it is one line.
       *
       * This bounced on the first null user. /partner IS the log-in page, so
       * signing up with Google landed on the log-in form -- holding a valid
       * Google session, one beat before it arrived. onAuthStateChange below
       * would have re-run this with the real user, but the navigation had
       * already fired and taken this component's subscription with it.
       *
       * So when the URL says a session is on its way, do nothing and let the
       * auth listener make the call. The screen is already showing its
       * "Opening your account" state, which is the truth while we wait.
       */
      if (oauthLanding()) return;
      nav('/partner', { replace: true });
      return;
    }
    // Already a member somewhere: this page has nothing to add. Google on the
    // log-in side redirects here too, so this is the bounce that makes one
    // redirect target safe for both new and returning owners.
    const member = await loadMembership();
    if (member) { nav('/partner/orders', { replace: true }); return; }
    setEmail(user.email ?? '');
    setNewEmail((prev) => prev || (user.email ?? ''));
    const meta = (user.user_metadata as any) ?? {};
    if (typeof meta.username === 'string' && meta.username) {
      setUsername(meta.username);
      setPhase('restaurant');
    } else {
      setPhase('finish');
    }
  };

  useEffect(() => {
    if (previewPhase) { setEmail('owner@your-restaurant.in'); return; }
    readState();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { readState(); });
    /**
     * A FLOOR UNDER THE WAIT. Waiting on the auth listener is right, but only
     * while it can still arrive. If the handshake never completes -- a token
     * rejected, the network gone -- the honest destination is the log-in page,
     * not a spinner nobody can leave. Ten seconds is far longer than the
     * exchange takes and short enough not to read as a hang.
     */
    const bail = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) nav('/partner', { replace: true });
    }, 10_000);
    return () => { window.clearTimeout(bail); sub.subscription.unsubscribe(); };
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
    // Finish-setup SETS the first password on a Google-created account, so it
    // is the same rule as sign-up and as Change password -- and it was the
    // one place with no letter-and-digit check at all.
    const pwBad = passwordProblem(password);
    if (pwBad) { setError(pwBad); return; }
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
      // A changed email is confirmed from the new inbox; the account keeps
      // working under the Google address until then. Never fatal here -- the
      // owner is one step from their restaurant, and Account can retry it.
      const mail = newEmail.trim();
      if (mail && mail !== email) {
        await supabase.auth.updateUser({ email: mail }).catch(() => {});
      }
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
    if (err) {
      setBusy(false);
      setError(err.message.includes('not authenticated')
        ? 'Please sign in first.' : err.message);
      return;
    }

    /**
     * PHONE AND THE MAP LINK, written straight after.
     *
     * complete_restaurant_signup takes a fixed set of parameters and is called
     * by both surfaces; widening it would mean another migration through the
     * one path where a failure costs somebody their entire sign-up. Both
     * columns already exist, the restaurant is already created, and the owner
     * is already its member — so this is an ordinary update.
     *
     * NOT FATAL IF IT FAILS. The account and the restaurant exist by this
     * point and both fields are editable on Restaurant profile. Blocking a
     * sign-up on a phone number would be the wrong trade.
     */
    if (form.phone.trim() || form.maps_url.trim()) {
      try {
        const { data: s } = await supabase.auth.getSession();
        const uid = s.session?.user?.id;
        const { data: m } = await supabase.from('restaurant_member')
          .select('restaurant_id').eq('user_id', uid).limit(1).maybeSingle();
        if (m?.restaurant_id) {
          await supabase.from('restaurant').update({
            phone: form.phone.trim() || null,
            maps_url: form.maps_url.trim() || null,
          }).eq('id', m.restaurant_id);
        }
      } catch { /* editable later on Restaurant profile */ }
    }

    setBusy(false);
    /**
     * STEP 4 IS THE PLAN, and this line is the whole reason it was missing.
     *
     * Sign-up ended here, on the orders board. The restaurant did have a real
     * thirty-day trial -- complete_restaurant_signup sets trial_ends_at -- so
     * the gate let them in and everything worked, which is exactly why nobody
     * noticed: what it did NOT have was an autopay mandate. Thirty days later
     * the trial lapsed with nothing on file to charge, and a working
     * restaurant went dark with no warning and no way for us to bill it.
     *
     * So the last step of signing up is arming the trial, not skipping it. The
     * shell's gate enforces the same thing for anyone who leaves mid-way or
     * arrives by another route; this is simply the front door.
     */
    nav('/partner/plan', { replace: true });
  };

  const stepLabel = phase === 'finish' ? 'Step 2 of 3' : 'Step 3 of 3';
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
                ? 'Google confirmed your email. Set your username, email and password — they log you in without Google, on the portal and in the app.'
                : 'A few details and your restaurant is live. Free for 30 days, then choose a plan — nothing is charged today.'}
            </p>
          </div>
        )}

        {phase === 'checking' ? (
          <div className="state-card" role="status"><div className="spinner" /><p className="dim">Opening your account…</p></div>
        ) : phase === 'finish' ? (
          <div className="glass auth-card">
            {/* EDITABLE. Google supplied it and confirmed it; an owner whose
                Google is a personal address can still log in as the
                restaurant's. A changed address is confirmed from that inbox
                (Supabase sends the link), so the step says so rather than
                pretending it changed on the spot. */}
            <label className="field-label" htmlFor="setup-email">Email</label>
            <input id="setup-email" className="code-input" type="email" autoComplete="email"
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            {newEmail.trim() && newEmail.trim() !== email && (
              <p className="dim" style={{ fontSize: 12, margin: '-6px 0 10px' }}>
                We'll send a confirmation link to {newEmail.trim()}; the new address works once you open it.
              </p>
            )}
            <label className="field-label" htmlFor="setup-username">Username</label>
            {/* Lower-cased as typed, so what the owner sees is what is stored.
                Instagram's alphabet: letters, numbers, dot, underscore. */}
            <input
              id="setup-username"
              className="code-input" type="text" autoComplete="username" autoFocus
              placeholder="your_restaurant" value={username}
              onChange={(e) => setUsername(cleanHandle(e.target.value))} />
            <label className="field-label" htmlFor="setup-password">Password</label>
            <input id="setup-password" className="code-input" type="password" autoComplete="new-password"
              placeholder="8+ characters, with a letter and a number" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && finishSetup()} />
            {error && <p className="field-error">{error}</p>}
            <button className={`btn btn-primary btn-block auth-primary${busy ? ' is-busy' : ''}`} disabled={busy} onClick={finishSetup}>
              Continue
            </button>
            <p className="dim auth-note">Your restaurant details are next. Nothing is charged today.</p>
          </div>
        ) : (
        <div className="glass auth-card">
          {/* THE SAME CARD AS STEP 2. This was a bare .glass with its own width,
              padding and label style (overline + inline margins); the step before
              it used auth-card and field-label. One form system across the three
              steps now, and the same one the phone draws. */}
          <p className="dim auth-signed">
            ✓ Signed in as {email}{username ? ` � @${username}` : ''}
          </p>
          <label className="field-label" htmlFor="reg-owner">Your name</label>
          <input id="reg-owner" className="code-input" autoComplete="name" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          <label className="field-label" htmlFor="reg-name">Restaurant name</label>
          <input id="reg-name" className="code-input" autoComplete="organization" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="field-2col">
            <div>
              <label className="field-label" htmlFor="reg-city">City</label>
              <input id="reg-city" className="code-input" autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label className="field-label" htmlFor="reg-gstin">GSTIN <span className="field-opt">(optional)</span></label>
              <input id="reg-gstin" className="code-input" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </div>
          </div>
          <label className="field-label" htmlFor="reg-address">Address</label>
          <input id="reg-address" className="code-input" placeholder="Street, area, landmark" autoComplete="street-address"
            value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <label className="field-label" htmlFor="reg-phone">Phone</label>
          <input id="reg-phone" className="code-input" inputMode="tel" autoComplete="tel" placeholder="For diners, and for us to reach you"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

          {/* THE MAP LINK, BESIDE THE TYPED ADDRESS AND NOT INSTEAD OF IT.
              A typed address is what prints on the bill; a Maps link is what a
              diner taps to be driven there. Most owners already have one —
              their restaurant is on Maps — and pasting it is faster and far
              more accurate than describing a location in words. The pin picker
              on Restaurant profile stays for anyone who would rather stand in
              the doorway and press a button. */}
          <label className="field-label" htmlFor="reg-maps">
            Google Maps link <span className="field-opt">(optional)</span>
          </label>
          <input id="reg-maps" className="code-input" inputMode="url" placeholder="https://maps.app.goo.gl/…"
            value={form.maps_url} onChange={(e) => setForm({ ...form, maps_url: e.target.value })} />
          <p className="dim field-help">
            Open your restaurant in Google Maps, tap Share, and paste the link here. Diners tap it
            to navigate. You can add or change this later in Restaurant profile.
          </p>
          {error && <p className="field-error">{error}</p>}
          <button className={`btn btn-primary btn-block auth-primary${busy ? ' is-busy' : ''}`} disabled={busy} onClick={submit}>
            Start 30-day free trial
          </button>
          {/* Was "Full Enterprise features for 30 days � no card needed".
              Both halves had stopped being true: the trial runs at the tier
              they choose, and the gate on the next screen asks for an autopay
              mandate before anything opens. Promising the opposite here only
              moves the surprise thirty seconds later, where it costs more. */}
          <p className="dim auth-note">
            Every plan free for 30 days � zero commission always � cancel any time.
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
