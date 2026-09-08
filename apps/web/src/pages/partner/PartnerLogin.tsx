/** Restaurant Portal sign-in. THE MODEL, as he finalised it: Google is the
 *  front door of sign-up (verified email, no inbox step; username + password
 *  are set on Register right after), email sign-up is the secondary door
 *  (username + password up front, confirmed by LINK). Log in is one field --
 *  username OR email -- plus password, or the Google button; all of them open
 *  the same account. No PIN, no OTP anywhere. Apple is drawn where it is
 *  expected and disabled until its provider is configured. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';
import {
  showAppleButton, APPLE_COMING_SOON, APPLE_PENDING_MESSAGE, providerError,
} from '../../lib/authProviders';
import { loginWithIdentifier, resetByIdentifier, usernameAvailable, usernameProblem } from '../../lib/auth';

export function PartnerLogin() {
  const nav = useNavigate();
  /** THE SIGN-UP LINKS HAVE TO LAND ON SIGN UP.
   *
   *  The marketing site now offers Log in and Sign up side by side, and its
   *  trial CTAs ("Start your 10-day free trial", "Get started") mean sign up
   *  too. Every one of them used to arrive here on the LOGIN state, so a
   *  restaurant that pressed "start free trial" was shown a password field for
   *  an account it does not have yet — the link went somewhere, but not where
   *  it said it went.
   *
   *  Read once, on arrival. After that the toggle owns the mode, so pressing
   *  "Log in" is not undone by the URL that brought you here. */
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'signup' ? 'signup' : 'login',
  );
  /**
   * THE MODEL, as he settled it. Email + password is the account -- standard
   * Supabase sign-up with email confirmation and a reset link. "Continue with
   * Google" is the other door to the SAME account, because sign-up links a
   * Google identity to every user it creates (see Register). There is no
   * one-time-code login: it was built, and he chose a password instead.
   */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Sign-up succeeded but the project requires the email to be confirmed
   *  first. Its own flag, not the reset-link one: reusing `sent` would show
   *  "a reset link is on its way" to someone who just created an account. */
  const [signupSent, setSignupSent] = useState(false);
  /** Instagram-style handle, sign-up only. Checked for format and
   *  availability before the account is created; CLAIMED when the restaurant
   *  is (Register), because that is the first call with a session. */
  const [username, setUsername] = useState('');

  /**
   * AND THEN THE RESET LINK HAD TO LAND SOMEWHERE.
   *
   * Adding "Forgot password" sends an email whose link comes back HERE with a
   * recovery token in the fragment. Two things would have happened without
   * this, and both are worse than not offering the reset at all:
   *
   *   1. Supabase exchanges that token for a real session, and the effect
   *      below would have seen a session and bounced straight to the orders
   *      board — logged in, with the password still the one they forgot, and
   *      no screen anywhere that lets them change it.
   *   2. There was no set-a-new-password form in this product on any surface.
   *      The app's reset opens a browser, so this page is the recovery screen
   *      for the phone as well as the laptop.
   *
   * The hash is read SYNCHRONOUSLY, before the session check runs, because the
   * PASSWORD_RECOVERY event can arrive after that check — and losing the race
   * means the redirect wins and the reader never sees this form.
   */
  const [recovery, setRecovery] = useState(
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery'),
  );
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (recovery) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav('/partner/orders', { replace: true });
    });
  }, [recovery]);

  const saveNewPassword = async () => {
    if (newPassword.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (err) {
      setError(/expired|invalid/i.test(err.message)
        ? 'That reset link has expired — request a new one below.'
        : err.message);
      return;
    }
    setDone(true);
  };

  /**
   * GOOGLE. A redirect, not a popup: a popup is what mobile browsers block,
   * and the counter machine is as likely to be a phone as a laptop.
   *
   * ONE REDIRECT TARGET FOR BOTH MODES: Register. It bounces anyone who is
   * already a member to the orders board, asks a brand-new Google user for a
   * username and password ("Finish setup"), and shows the restaurant form to
   * the rest -- so the button does the right thing whether the owner meant
   * "log in" or "sign up", and there is no path on which Google mints a
   * second, empty account without the owner noticing. Supabase resolves the
   * session from the URL on load, so there is nothing to hand-carry.
   */
  const signInWithGoogle = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/partner/register` },
    });
    // On success the browser is already navigating away; only a failure
    // returns here with the page still on screen.
    if (err) { setBusy(false); setError(providerError(err, 'Google')); }
  };

  /**
   * READ THE DOM, NOT JUST STATE -- this is the blocked Login button.
   *
   * He reported the button showing the not-allowed cursor with both fields
   * visibly filled. `busy` cannot be the cause (every handler clears it before
   * returning) and the inputs are correctly controlled, which leaves
   * `!email || !password` evaluating truthy while the fields LOOK full.
   *
   * That is Chrome's saved-credential autofill: the browser paints the value
   * into the field but does not fire an input event or expose the value until
   * the user interacts with the page. React state stays empty, so the old
   * the old `disabled={busy || !email || !password}` kept the button dead on
   * exactly the machine where the password was already saved.
   *
   * So the gate is gone (see the button) and the values are read from the
   * inputs at submit, falling back to state. Validation moved in here, where
   * it can say what is wrong instead of silently refusing to be pressed.
   */
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const signInEmail = async () => {
    const id = (emailRef.current?.value || email).trim();
    const pw = passwordRef.current?.value || password;
    if (!id || !pw) { setError('Enter your username or email, and your password.'); return; }
    setBusy(true); setError('');
    try {
      // Username or email -- lib/auth decides which it was and resolves a
      // username on the server, so the reader never has to know the
      // difference and this page never learns another account's email.
      await loginWithIdentifier(id, pw);
      nav('/partner/orders', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * SIGN UP ACTUALLY CREATED NOTHING.
   *
   * Pressing "Sign up" switched the heading and forced the Email tab — and
   * then rendered the same email + password form with the same "Login" button
   * calling the same signInEmail. A restaurant with no account typed one in
   * and was told "Email or password is incorrect", which is true and useless:
   * there was no control anywhere on this page that would have made the
   * account. The only working path was phone OTP, and SMS is not configured.
   *
   * supabase.auth.signUp is the missing half. Where email confirmation is off
   * the call returns a session and the new owner goes straight to registering
   * the restaurant; where it is on there is no session yet, so we say so
   * plainly and put them on the Log in side rather than dropping them on a
   * screen that will reject them.
   */
  const signUpEmail = async () => {
    const em = (emailRef.current?.value || email).trim();
    const pw = passwordRef.current?.value || password;
    if (!em || !pw) { setError('Enter your email and choose a password.'); return; }
    // EIGHT, TO MATCH THE APP. The phone's signup has always demanded 8 and
    // this had none until a moment ago — the same account, two different rules,
    // so an owner who signed up here with six characters would meet a form on
    // their phone that rejects what the laptop just accepted. Converged on the
    // stricter of the two, which is also the one already shipping.
    if (pw.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    /* emailRedirectTo: the confirmation link lands on Register, where the
       restaurant form is -- the username and password were collected here,
       so Register skips its setup step. Supabase reads the session out of
       the URL on that page. */
    const handle = username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    // Asked BEFORE creating the account, so a taken handle is a one-line
    // correction here rather than a dead end on Register. The server checks
    // again when the restaurant is created; this is the friendly pass.
    try {
      if (!(await usernameAvailable(handle))) { setBusy(false); setError('That username is taken. Try another.'); return; }
    } catch (e: any) {
      setBusy(false); setError(e?.message ?? 'Could not check that username.'); return;
    }
    // The handle rides in user metadata until the account is verified and the
    // restaurant is created, at which point complete_restaurant_signup claims
    // it under the unique index. It cannot be claimed earlier: with "Confirm
    // email" on there is no session -- and no auth.uid() -- yet.
    const { data, error: err } = await supabase.auth.signUp({
      email: em, password: pw,
      options: {
        emailRedirectTo: `${window.location.origin}/partner/register`,
        data: { username: handle },
      },
    });
    setBusy(false);
    if (err) {
      setError(/already registered|already been registered/i.test(err.message)
        ? 'That email already has an account — switch to “Log in” above.'
        : err.message);
      return;
    }
    if (!data.session) {
      // "Confirm email" is on for the project: the account exists but cannot
      // do anything until the link is opened. Say exactly that, and stay on
      // Sign up so the form does not look like it rejected them.
      setSignupSent(true);
      return;
    }
    nav('/partner/register', { replace: true });
  };

  /**
   * FORGOT PASSWORD — the app had it, the portal did not.
   *
   * Same account, same email-based reset, and only one of the two surfaces
   * offered a way back in. An owner locked out at the laptop had to find their
   * phone to recover a password they use on both. That is the kind of gap that
   * looks small until it is 9pm and the till is the laptop.
   *
   * Word-for-word the same behaviour as StaffLoginScreen's: it reads the email
   * already typed above rather than asking for it twice, and it says the same
   * thing whether or not that address has an account — telling a stranger which
   * emails are registered is not something a login form should do.
   */
  const [sent, setSent] = useState(false);
  const forgotPassword = async () => {
    const id = (emailRef.current?.value || email).trim();
    if (!id) { setError('Type your username or email above first, then use “Forgotten password”.'); return; }
    setBusy(true); setError('');
    try {
      // A username is resolved on the server, an email goes straight through,
      // and the answer is the same sentence either way -- see lib/auth.
      await resetByIdentifier(id);
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the reset link.');
    } finally {
      setBusy(false);
    }
  };

  // The recovery screen replaces the login card rather than sitting beside it.
  // Someone who followed a reset link came to do exactly one thing, and putting
  // a login form they cannot use next to it is how they end up typing the old
  // password again.
  if (recovery) {
    return (
      <div className="page fade-in login-lens" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <div className="topbar">
          <Wordmark size={24} />
          <span className="badge gold">Restaurant Portal</span>
        </div>
        <div className="center-fill" style={{ gap: 14 }}>
          <p className="overline">Password reset</p>
          <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 36px)' }}>
            {done ? 'Password changed' : 'Choose a new password'}
          </h1>
          <div className="glass" style={{ width: '100%', maxWidth: 420, padding: 20, textAlign: 'left' }}>
            {done ? (
              <>
                <p className="muted" style={{ fontSize: 14 }}>
                  Use it on the portal and in the Menutha app — it is the same account.
                </p>
                <button className="btn btn-glass btn-block" style={{ marginTop: 16 }}
                  onClick={() => nav('/partner/orders', { replace: true })}>
                  Open my orders
                </button>
              </>
            ) : (
              <>
                <p className="overline" style={{ margin: '2px 0 6px' }}>New password</p>
                <input className="code-input" type="password" autoComplete="new-password"
                  placeholder="At least 8 characters" autoFocus
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveNewPassword()} />
                {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 16 }}
                  disabled={busy} onClick={saveNewPassword}>
                  Save new password
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    // login-lens scopes the no-orange override to THIS page. See theme.css.
    <div className="page fade-in login-lens" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={24} />
        <span className="badge gold">Restaurant Portal</span>
      </div>
      <div className="center-fill" style={{ gap: 14 }}>
        <p className="overline">For restaurants</p>
        <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 36px)' }}>
          {mode === 'signup' ? 'Get your restaurant online' : 'Run your restaurant from anywhere'}
        </h1>
        <p className="muted" style={{ maxWidth: 440, fontSize: 14.5 }}>
          {mode === 'signup'
            ? 'Continue with Google, pick a username and password, then register your restaurant — QR ordering, live kitchen board and billing. 30-day free trial, no card, zero commission.'
            : 'Live orders, menu, billing, QR codes and your plan — from any phone or computer. Zero commission: diners always pay you directly.'}
        </p>

        <div className="glass" style={{ width: '100%', maxWidth: 420, padding: 20, textAlign: 'left' }}>
          {/* Prominent Log in / Sign up switch */}
          <div className="seg" role="tablist" aria-label="Log in or sign up" style={{ marginBottom: 14 }}>
            <button role="tab" aria-selected={mode === 'login'}
              className={mode === 'login' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => { setMode('login'); setError(''); setSignupSent(false); }}>Log in</button>
            <button role="tab" aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => { setMode('signup'); setError(''); setSignupSent(false); }}>Sign up</button>
          </div>

          {mode === 'signup' && (
            <p className="overline" style={{ marginBottom: 2, color: 'var(--primary)' }}>Create your account</p>
          )}
          {/* THE ACCOUNT EXISTS, THE EMAIL IS NOT YET CONFIRMED. Shown in place
              of the form rather than as an error under it: nothing went wrong,
              and a red line saying "account created" is a contradiction the
              reader has to resolve. The link in the mail lands on Register,
              where Connect Google and the restaurant details are the next two
              steps. */}
          {mode === 'signup' && signupSent && (
            <div className="glass" style={{ padding: 16, marginTop: 10 }}>
              <strong>Check your email</strong>
              <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
                We sent a confirmation link to <b>{email.trim()}</b>. Open it and you will land on the
                next step — your restaurant details. Until the link is opened, the account cannot log in.
              </p>
              <button className="chip" style={{ marginTop: 10 }} onClick={() => { setSignupSent(false); setError(''); }}>
                ← Use a different email
              </button>
            </div>
          )}

          {/* THE PROVIDERS, ABOVE THE FORM. One tap is the shortest path in and
              belongs at the top; the email field is for anyone who would rather
              type an address than hand over an account. */}
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {/* GOOGLE IS THE FRONT DOOR. On sign-up it is the primary path:
                Google hands back a verified email, so there is no inbox step,
                and Register asks for the username and password next. On log
                in it opens the same account -- Supabase attaches a Google
                sign-in to the user whose verified email matches, and every
                Google-first account already carries the identity. The hint
                says so in one line; it used to warn about a second account,
                which this model no longer has a path to. */}
            <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} disabled={busy}
              onClick={signInWithGoogle}>
              <span aria-hidden style={{ marginRight: 8 }}>🇬</span>
              Continue with Google
            </button>
            <p className="dim" style={{ fontSize: 12, margin: '-2px 0 0', textAlign: 'center' }}>
              {mode === 'signup'
                ? 'Fastest: Google confirms your email, then you pick a username and password.'
                : 'Same account as your username and password.'}
            </p>
            {/* Drawn on iOS and the web, hidden on Android. Disabled until the
                Apple Developer config exists -- pressing it says so rather than
                failing with a provider error nobody can act on. */}
            {showAppleButton() && (
              <button
                className="btn btn-glass btn-block"
                disabled={APPLE_COMING_SOON || busy}
                aria-disabled={APPLE_COMING_SOON}
                title={APPLE_COMING_SOON ? APPLE_PENDING_MESSAGE : undefined}
                onClick={() => setError(APPLE_PENDING_MESSAGE)}
              >
                <span aria-hidden style={{ marginRight: 8 }}></span>
                Continue with Apple
                {APPLE_COMING_SOON && (
                  <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>coming soon</span>
                )}
              </button>
            )}
          </div>

          {/* The providers, the divider and the form all step aside while the
              confirmation panel is up -- a form under "check your email" reads
              as "and also fill this in again". */}
          {!(mode === 'signup' && signupSent) && (<>
          <p className="overline" style={{ textAlign: 'center', margin: '14px 0 4px', opacity: 0.7 }}>
            {mode === 'signup' ? 'or sign up with email' : 'or use your username or email'}
          </p>

          {(
            <>
              {/* ONE FIELD ON LOG IN: USERNAME OR EMAIL -- the Instagram shape
                  he sent a screenshot of. Either opens the same account; an
                  email signs in directly, a username is resolved on the server
                  (see lib/auth). On SIGN UP it is the email, and the handle
                  gets its own field under it. */}
              <p className="overline" style={{ margin: '8px 0 6px' }}>
                {mode === 'signup' ? 'Email' : 'Username or email'}
              </p>
              <input
                className="code-input"
                type={mode === 'signup' ? 'email' : 'text'}
                autoComplete={mode === 'signup' ? 'email' : 'username'}
                placeholder={mode === 'signup' ? 'you@restaurant.com' : 'username or you@restaurant.com'}
                ref={emailRef} value={email} onChange={(e) => setEmail(e.target.value)} />
              {mode === 'signup' && (
                <>
                  <p className="overline" style={{ margin: '14px 0 6px' }}>Username</p>
                  {/* Lower-cased as typed, so what the owner sees is what is
                      stored -- "Ashwin" and "ashwin" are one name. Instagram's
                      alphabet: letters, numbers, dot, underscore. */}
                  <input
                    className="code-input" type="text" autoComplete="username"
                    placeholder="ashwamedha_lodge" value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30))} />
                </>
              )}
              <p className="overline" style={{ margin: '14px 0 6px' }}>Password</p>
              <input className="code-input" type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                ref={passwordRef} value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (mode === 'signup' ? signUpEmail() : signInEmail())} />
              {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
              {/* "Login", in clear glass — the client's override for this page:
                  "Instead of open my restaurant we can put login without orange
                  color like if we click on phone and email feel." The app says
                  the same word in the same material, so the portal and the
                  phone are one product rather than two that resemble each
                  other. The orange primary stays the default everywhere else. */}
              <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 16 }} disabled={busy}
                onClick={mode === 'signup' ? signUpEmail : signInEmail}>
                {mode === 'signup' ? 'Create account' : 'Login'}
              </button>
              {mode === 'login' && (
                sent ? (
                  <p className="dim" style={{ fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>
                    If that address has an account, a reset link is on its way to it.
                  </p>
                ) : (
                  <button className="chip" style={{ marginTop: 10, width: '100%' }} disabled={busy} onClick={forgotPassword}>
                    Forgotten password?
                  </button>
                )
              )}
            </>
          )}
          </>)}
        </div>

        <p className="dim" style={{ fontSize: 12.5, maxWidth: 400 }}>
          {mode === 'signup'
            ? 'Already have an account? Tap “Log in” above.'
            : 'New restaurant? Tap “Sign up” above to create your account and register — 30-day free trial, full Growth features.'}
        </p>
      </div>
    </div>
  );
}
