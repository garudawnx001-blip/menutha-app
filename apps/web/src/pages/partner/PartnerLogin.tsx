/** Restaurant Portal sign-in. THE MODEL, as he finalised it: Google is the
 *  front door of sign-up (verified email, no inbox step; username + password
 *  are set on Register right after), email sign-up is the secondary door
 *  (username + password up front, confirmed by a SIX-DIGIT CODE). Log in is
 *  one field -- username OR email -- plus password, or the Google button; all
 *  of them open the same account.
 *
 *  CODES, NOT LINKS, for confirming and for resetting. Custom SMTP is on the
 *  project, so the templates carry {{ .Token }} and the whole thing finishes
 *  on this screen: no hop to a mail client and back, and nothing lost when the
 *  link opens on a device that is not the one being fixed. The links still
 *  work -- the same mail carries both -- so nobody who reaches for one is
 *  stranded. Logging IN is still a password; there is no OTP login.
 *
 *  THE SHAPE IS INSTAGRAM'S, at his direction and from his screenshot:
 *  field, password, Log in, "Forgot password?" under it, then "Continue with
 *  Google" as the alternate action, and "Create new account" as an outlined
 *  anchor at the bottom. The app draws the same screen in the same order, so
 *  the two are one product rather than two that resemble each other.
 *
 *  Apple is drawn where it is expected and disabled until its provider is
 *  configured. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';
import {
  showAppleButton, APPLE_COMING_SOON, APPLE_PENDING_MESSAGE, providerError,
} from '../../lib/authProviders';
import {
  loginWithIdentifier, resetByIdentifier, completeReset, otpErrorSentence, passwordProblem,
  usernameAvailable, usernameProblem, cleanHandle,
} from '../../lib/auth';
import { GoogleMark } from './GoogleMark';

export function PartnerLogin() {
  const nav = useNavigate();
  /** THE SIGN-UP LINKS HAVE TO LAND ON SIGN UP. The marketing site's trial
   *  CTAs arrive with ?mode=signup. Read once; after that the anchor at the
   *  bottom owns the mode. */
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'signup' ? 'signup' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Sign-up succeeded but the address must be confirmed first. */
  const [signupSent, setSignupSent] = useState(false);
  /** The six-digit code from the confirmation mail. The link in the same mail
   *  still works; this is the path that does not leave the screen. */
  const [signupCode, setSignupCode] = useState('');

  const confirmSignupCode = async () => {
    if (!/^\d{6}$/.test(signupCode)) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true); setError('');
    const { data, error: err } = await supabase.auth.verifyOtp({
      email: email.trim(), token: signupCode, type: 'signup',
    });
    setBusy(false);
    if (err) { setError(otpErrorSentence(err.message)); return; }
    if (!data.session) { setError('That code did not match. Check it and try again.'); return; }
    nav('/partner/register', { replace: true });
  };
  /**
   * THE CODE THAT NEVER ARRIVED.
   *
   * Without this the screen was a dead end: the only way out was "Use a
   * different email", and going back to change it and submitting the same
   * address returns "already registered" -- so an owner whose mail was slow,
   * filtered or mistyped had no way forward at all. The phone has offered a
   * resend since this screen was built. Cooldown for the same reason it has
   * one: Supabase rate-limits resends, and a disabled button that says when
   * is kinder than an error that says no.
   */
  const [signupAgain, setSignupAgain] = useState(0);
  const [signupNote, setSignupNote] = useState('');
  const resendSignup = async () => {
    setBusy(true); setError(''); setSignupNote('');
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/partner/register` },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSignupCode('');
    setSignupNote('Sent. It can take a minute to arrive.');
    setSignupAgain(Date.now() + 24_000);
  };

  /** Instagram-style handle, sign-up only. Checked for format and

   *  availability before the account is created; CLAIMED when the restaurant
   *  is (Register), because that is the first call with a session. */
  const [username, setUsername] = useState('');

  /**
   * THE RESET LINK LANDS HERE with a recovery token in the fragment. The hash
   * is read SYNCHRONOUSLY, before the session check runs, because the
   * PASSWORD_RECOVERY event can arrive after that check -- and losing the
   * race means the redirect wins and the reader never sees this form. This
   * page is the recovery screen for the phone as well as the laptop.
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
   * GOOGLE. A redirect, not a popup: a popup is what mobile browsers block.
   * ONE REDIRECT TARGET FOR BOTH MODES: Register. It bounces anyone who is
   * already a member to the orders board, asks a brand-new Google user for a
   * username and password ("Finish setup"), and shows the restaurant form to
   * the rest -- so the button does the right thing whether the owner meant
   * "log in" or "sign up".
   */
  const signInWithGoogle = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/partner/register` },
    });
    if (err) { setBusy(false); setError(providerError(err, 'Google')); }
  };

  /** Read the DOM, not just state: Chrome's saved-credential autofill paints
   *  values without firing input events, so state can be empty while the
   *  fields look full. */
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const signInEmail = async () => {
    const id = (emailRef.current?.value || email).trim();
    const pw = passwordRef.current?.value || password;
    if (!id || !pw) { setError('Enter your username or email, and your password.'); return; }
    setBusy(true); setError('');
    try {
      await loginWithIdentifier(id, pw);
      nav('/partner/orders', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signUpEmail = async () => {
    const em = (emailRef.current?.value || email).trim();
    const pw = passwordRef.current?.value || password;
    if (!em || !pw) { setError('Enter your email and choose a password.'); return; }
    // ONE PASSWORD RULE, WHEREVER A PASSWORD IS SET. This asked for eight
    // characters and nothing else while Change password also required a
    // letter and a digit, so an owner could sign up with "aaaaaaaa" and meet
    // the real rule months later on a different screen.
    const pwBad = passwordProblem(pw);
    if (pwBad) { setError(pwBad); return; }
    const handle = username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      if (!(await usernameAvailable(handle))) { setBusy(false); setError('That username is taken. Try another.'); return; }
    } catch (e: any) {
      setBusy(false); setError(e?.message ?? 'Could not check that username.'); return;
    }
    /* The handle rides in user metadata until the restaurant is created and
       complete_restaurant_signup claims it. emailRedirectTo: the confirmation
       link lands on Register, where the restaurant form is. */
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
        ? 'That email already has an account — log in instead.'
        : err.message);
      return;
    }
    if (!data.session) { setSignupSent(true); return; }
    nav('/partner/register', { replace: true });
  };

  /**
   * FORGOT PASSWORD, BY CODE.
   *
   * The reset mail carries a six-digit code, so the whole thing finishes on
   * this screen: send, type the code, choose the password. No hop to a mail
   * client and back, and nothing to lose if the link opens on a device that
   * is not the one being fixed. `resetIdent` is captured when the code is
   * sent, because the field above is editable and the code belongs to the
   * identifier it was sent for.
   */
  const [resetStep, setResetStep] = useState<'off' | 'code'>('off');
  const [resetIdent, setResetIdent] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPw, setResetPw] = useState('');
  const [resetAgain, setResetAgain] = useState(0);

  /**
   * A COOLDOWN THAT ENDS ON ITS OWN.
   *
   * Both resend buttons compared Date.now() DURING RENDER, and a comparison
   * in render only re-evaluates when something else causes a render. Nothing
   * does for those twenty-four seconds -- so the button stayed disabled
   * saying "in a moment" until the reader happened to type in a field, which
   * on this screen they have no reason to do. The clock has to tick.
   */
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const until = Math.max(resetAgain, signupAgain);
    if (until <= Date.now()) return;
    const id = setTimeout(() => setNow(Date.now()), until - Date.now() + 50);
    return () => clearTimeout(id);
  }, [resetAgain, signupAgain]);

  const forgotPassword = async () => {
    const id = (emailRef.current?.value || email).trim();
    if (!id) { setError('Type your username or email above first, then use “Forgot password?”.'); return; }
    setBusy(true); setError('');
    try {
      await resetByIdentifier(id);
      setResetIdent(id);
      setResetCode('');
      setResetStep('code');
      setResetAgain(Date.now() + 30_000);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the reset code.');
    } finally {
      setBusy(false);
    }
  };

  const saveResetPassword = async () => {
    if (!/^\d{6}$/.test(resetCode)) { setError('Enter the 6-digit code from the email.'); return; }
    // A reset SETS a password, so it asks what setting one asks everywhere
    // else. Meeting the rule for the first time while locked out is the worst
    // moment to meet it.
    const resetBad = passwordProblem(resetPw);
    if (resetBad) { setError(resetBad); return; }
    setBusy(true); setError('');
    try {
      await completeReset(resetIdent, resetCode, resetPw);
      nav('/partner/orders', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Could not set that password.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: 'login' | 'signup') => {
    setMode(m); setError(""); setSignupSent(false); setSignupCode(""); setResetStep("off");
  };

  const Header = ({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) => (
    <div className="auth-head">
      <p className="overline">{eyebrow}</p>
      <h1 className="display auth-title">{title}</h1>
      <p className="muted auth-sub">{sub}</p>
    </div>
  );

  const googleButton = (
    <button type="button" className="btn btn-google btn-block" disabled={busy} onClick={signInWithGoogle}>
      <GoogleMark size={16} />
      <span>Continue with Google</span>
    </button>
  );

  const appleButton = showAppleButton() ? (
    <button
      type="button"
      className="btn btn-google btn-block"
      disabled={APPLE_COMING_SOON || busy}
      aria-disabled={APPLE_COMING_SOON}
      title={APPLE_COMING_SOON ? APPLE_PENDING_MESSAGE : undefined}
      onClick={() => setError(APPLE_PENDING_MESSAGE)}
    >
      <span aria-hidden style={{ fontSize: 16 }}></span>
      <span>Continue with Apple</span>
      {APPLE_COMING_SOON && <span className="dim" style={{ fontSize: 12 }}>coming soon</span>}
    </button>
  ) : null;

  // The recovery screen replaces the login card: someone who followed a reset
  // link came to do exactly one thing.
  if (recovery) {
    return (
      <div className="page fade-in login-lens auth-page">
        <div className="topbar">
          <Wordmark size={24} />
          <span className="badge gold">Restaurant Portal</span>
        </div>
        <div className="center-fill auth-fill">
          <Header
            eyebrow="Password reset"
            title={done ? 'Password changed' : 'Choose a new password'}
            sub={done ? 'Use it on the portal and in the Menutha app — it is the same account.' : 'At least 8 characters. It works on the portal and in the app.'}
          />
          <div className="glass auth-card">
            {done ? (
              <button className="btn btn-glass btn-block" onClick={() => nav('/partner/orders', { replace: true })}>
                Open my orders
              </button>
            ) : (
              <>
                <label className="field-label" htmlFor="new-password">New password</label>
                <input id="new-password" className="code-input" type="password" autoComplete="new-password"
                  placeholder="At least 8 characters" autoFocus
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveNewPassword()} />
                {error && <p className="field-error">{error}</p>}
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

  // The reset card replaces the login card rather than sitting under it:
  // someone who asked for a code came to do exactly one thing, and a login
  // form beside it is how they end up typing the password they have forgotten.
  if (resetStep === 'code') {
    return (
      <div className="page fade-in login-lens auth-page">
        <div className="topbar">
          <Wordmark size={24} />
          <span className="badge gold">Restaurant Portal</span>
        </div>
        <div className="center-fill auth-fill">
          <Header
            eyebrow="Password reset"
            title="Check your email"
            sub={`If that account exists, a 6-digit code is on its way to its email. Enter it here with your new password — it is the same account on the portal and in the app.`}
          />
          <div className="glass auth-card">
            <label className="field-label" htmlFor="reset-code">6-digit code</label>
            <input
              id="reset-code" className="code-input code-otp" inputMode="numeric" autoComplete="one-time-code"
              placeholder="••••••" maxLength={6} autoFocus value={resetCode}
              onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <label className="field-label" htmlFor="reset-pw">New password</label>
            <input
              id="reset-pw" className="code-input" type="password" autoComplete="new-password"
              placeholder="At least 8 characters" value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveResetPassword()} />
            {error && <p className="field-error">{error}</p>}
            <button className={`btn btn-glass btn-block auth-primary${busy ? ' is-busy' : ''}`}
              disabled={busy} onClick={saveResetPassword}>
              Set password and log in
            </button>
            <div className="auth-providers" style={{ marginTop: 12 }}>
              <button className="btn btn-link" disabled={busy || now < resetAgain} onClick={forgotPassword}>
                {now < resetAgain ? 'Send another code in a moment' : 'Send another code'}
              </button>
              <button className="btn btn-link" onClick={() => { setResetStep('off'); setError(''); }}>
                ‹ Back to log in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in login-lens auth-page">
      <div className="topbar">
        <Wordmark size={24} />
        <span className="badge gold">Restaurant Portal</span>
      </div>
      <div className="center-fill auth-fill">
        {mode === 'login' ? (
          <Header
            eyebrow="Log in"
            title="Welcome back, chef."
            sub="Live orders, menu, billing, QR codes and your plan — from any phone or computer. Zero commission: diners always pay you directly."
          />
        ) : (
          <Header
            eyebrow="Create account"
            title="Get your restaurant online."
            sub="QR ordering, live kitchen board and billing. 30-day free trial, no card, zero commission."
          />
        )}

        <div className="glass auth-card">
          {mode === 'signup' && signupSent ? (
            /* THE ACCOUNT EXISTS, THE EMAIL IS NOT YET CONFIRMED. Shown in place
               of the form: nothing went wrong, and a red line saying "account
               created" is a contradiction the reader has to resolve. */
            <div className="auth-sent">
              <div className="auth-sent-mark" aria-hidden>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </div>
              <strong>Check your email</strong>
              <p className="dim" style={{ fontSize: 13.5, margin: '6px 0 14px' }}>
                We sent a 6-digit code to <b>{email.trim()}</b>. Type it here — or tap the link in the
                same email. Until one of the two, the account cannot log in.
              </p>
              <div style={{ textAlign: 'left' }}>
                <label className="field-label" htmlFor="signup-code">6-digit code</label>
                <input
                  id="signup-code" className="code-input code-otp" inputMode="numeric" autoComplete="one-time-code"
                  placeholder="••••••" maxLength={6} autoFocus value={signupCode}
                  onChange={(e) => setSignupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && confirmSignupCode()} />
              </div>
              {error && <p className="field-error">{error}</p>}
              <button className={`btn btn-glass btn-block auth-primary${busy ? ' is-busy' : ''}`}
                disabled={busy} onClick={confirmSignupCode}>
                Confirm and continue
              </button>
              {signupNote && <p className="dim" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{signupNote}</p>}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-link" disabled={busy || now < signupAgain} onClick={resendSignup}>
                  {now < signupAgain ? 'Send another code in a moment' : 'Send another code'}
                </button>
                <button className="btn btn-link" onClick={() => { setSignupSent(false); setError(''); setSignupCode(''); setSignupNote(''); }}>
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <>
              <label className="field-label" htmlFor="auth-id">
                {mode === 'signup' ? 'Email' : 'Username, email'}
              </label>
              <input
                id="auth-id"
                className="code-input"
                type={mode === 'signup' ? 'email' : 'text'}
                autoComplete={mode === 'signup' ? 'email' : 'username'}
                placeholder={mode === 'signup' ? 'you@restaurant.com' : 'username or you@restaurant.com'}
                ref={emailRef} value={email} onChange={(e) => setEmail(e.target.value)} />

              {mode === 'signup' && (
                <>
                  <label className="field-label" htmlFor="auth-username">Username</label>
                  <input
                    id="auth-username"
                    className="code-input" type="text" autoComplete="username"
                    placeholder="your_restaurant" value={username}
                    onChange={(e) => setUsername(cleanHandle(e.target.value))} />
                </>
              )}

              <label className="field-label" htmlFor="auth-password">Password</label>
              <div className="field-row">
                <input
                  id="auth-password"
                  className="code-input" type={reveal ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                  ref={passwordRef} value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (mode === 'signup' ? signUpEmail() : signInEmail())} />
                <button type="button" className="btn btn-link field-reveal" onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}>
                  {reveal ? 'HIDE' : 'SHOW'}
                </button>
              </div>

              {error && <p className="field-error">{error}</p>}

              {/* "Log in", in clear glass -- the client's call for this page,
                  and the same word in the same material the app uses. */}
              <button className={`btn btn-glass btn-block auth-primary${busy ? ' is-busy' : ''}`} disabled={busy}
                onClick={mode === 'signup' ? signUpEmail : signInEmail}>
                {mode === 'signup' ? 'Create account' : 'Log in'}
              </button>

              {mode === 'login' && (
                <button className="btn btn-link auth-forgot" disabled={busy} onClick={forgotPassword}>
                  Forgot password?
                </button>
              )}

              <div className="auth-divider"><span>or</span></div>

              {/* THE ALTERNATE ACTION, below the form, with the Google G --
                  exactly where and how the app draws it. On sign-up it is
                  still the front door in substance (Google confirms the
                  email; Register asks for username + password next), it just
                  sits where a second option sits. */}
              <div className="auth-providers">
                {googleButton}
                {appleButton}
              </div>
              {mode === 'signup' && (
                <p className="dim auth-note">
                  With Google there is nothing to confirm — you pick a username and password on the next screen.
                </p>
              )}
            </>
          )}
        </div>

        {/* THE BOTTOM ANCHOR, outlined and quiet: nine in ten people arriving
            here already have an account. Same outlined control the app pins
            to the bottom of its login screen. */}
        <div className="auth-anchor">
          <div className="auth-rule" />
          <p className="dim auth-anchor-note">
            {mode === 'login' ? 'New to Menutha?' : 'Already have an account?'}
          </p>
          <button className="btn btn-ghost auth-anchor-btn" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Create new account' : 'Log in'}
          </button>
          <p className="dim auth-fine">30 days free · 0% commission · no card to start</p>
        </div>
      </div>
    </div>
  );
}
