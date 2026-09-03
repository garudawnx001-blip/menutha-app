/** Restaurant Portal sign-in: phone OTP (owners & invited staff) or
 *  email + password (existing Menuva staff credentials). */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';

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
  // Email, not OTP. Phone OTP is still a UI stub — SMS is not configured, and
  // the send fails with "SMS login is not configured yet". Defaulting the
  // portal to it stranded the one real user, who signs in with email and
  // password, on a form that cannot work. Both surfaces default to email until
  // OTP is wired, and then both flip together.
  const [tab, setTab] = useState<'otp' | 'email'>('email');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav('/partner/orders', { replace: true });
    });
  }, []);

  const e164 = () => '+91' + phone.replace(/\D/g, '').slice(-10);

  const sendOtp = async () => {
    if (phone.replace(/\D/g, '').length < 10) { setError('Enter a 10-digit mobile number.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164() });
    setBusy(false);
    if (err) { setError(err.message.includes('provider') ? 'SMS login is not configured yet — use the Email tab.' : err.message); return; }
    setOtpSent(true);
  };

  const verifyOtp = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.verifyOtp({ phone: e164(), token: otp.trim(), type: 'sms' });
    setBusy(false);
    if (err) { setError('That code didn’t match — try again.'); return; }
    // Brand-new owners go straight to registering their restaurant; returning
    // accounts land on the live board.
    nav(mode === 'signup' ? '/partner/register' : '/partner/orders', { replace: true });
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
    const em = (emailRef.current?.value || email).trim();
    const pw = passwordRef.current?.value || password;
    if (!em || !pw) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: em, password: pw });
    setBusy(false);
    if (err) { setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message); return; }
    nav('/partner/orders', { replace: true });
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
    if (pw.length < 6) { setError('Choose a password of at least 6 characters.'); return; }
    setBusy(true); setError('');
    const { data, error: err } = await supabase.auth.signUp({ email: em, password: pw });
    setBusy(false);
    if (err) {
      setError(/already registered|already been registered/i.test(err.message)
        ? 'That email already has an account — switch to “Log in” above.'
        : err.message);
      return;
    }
    if (!data.session) {
      setMode('login');
      setError('Account created. Confirm the email we just sent, then log in here.');
      return;
    }
    nav('/partner/register', { replace: true });
  };

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
            ? 'Create your account with an email and a password, then register your restaurant — QR ordering, live kitchen board and billing. 10-day free trial, no card, zero commission.'
            : 'Live orders, menu, billing, QR codes and your plan — from any phone or computer. Zero commission: diners always pay you directly.'}
        </p>

        <div className="glass" style={{ width: '100%', maxWidth: 420, padding: 20, textAlign: 'left' }}>
          {/* Prominent Log in / Sign up switch */}
          <div className="seg" role="tablist" aria-label="Log in or sign up" style={{ marginBottom: 14 }}>
            <button role="tab" aria-selected={mode === 'login'}
              className={mode === 'login' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => { setMode('login'); setError(''); setOtpSent(false); }}>Log in</button>
            <button role="tab" aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => { setMode('signup'); setTab('email'); setError(''); setOtpSent(false); }}>Sign up</button>
          </div>

          {mode === 'login' && (
            <div className="chip-row" style={{ paddingBottom: 6 }}>
              <button className={tab === 'email' ? 'chip active' : 'chip'} onClick={() => { setTab('email'); setError(''); }}>✉️ Email</button>
              <button className={tab === 'otp' ? 'chip active' : 'chip'} onClick={() => { setTab('otp'); setError(''); }}>📱 Phone OTP</button>
            </div>
          )}
          {mode === 'signup' && (
            <p className="overline" style={{ marginBottom: 2, color: 'var(--primary)' }}>Create your account</p>
          )}

          {tab === 'otp' ? (
            !otpSent ? (
              <>
                <p className="overline" style={{ margin: '8px 0 6px' }}>Mobile number</p>
                <input className="code-input" inputMode="tel" placeholder="98765 43210" value={phone}
                  onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendOtp()} />
                {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 14 }} disabled={busy} onClick={sendOtp}>
                  {mode === 'signup' ? 'Send OTP to sign up' : 'Send OTP'}
                </button>
              </>
            ) : (
              <>
                <p className="overline" style={{ margin: '8px 0 6px' }}>Enter the 6-digit code sent to {e164()}</p>
                <input className="code-input" inputMode="numeric" autoFocus placeholder="••••••" value={otp}
                  onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verifyOtp()} />
                {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 14 }} disabled={busy || otp.trim().length < 4} onClick={verifyOtp}>
                  {mode === 'signup' ? 'Verify & create account' : 'Verify & sign in'}
                </button>
                <button className="chip" style={{ marginTop: 10 }} onClick={() => { setOtpSent(false); setOtp(''); }}>← Change number</button>
              </>
            )
          ) : (
            <>
              <p className="overline" style={{ margin: '8px 0 6px' }}>Email</p>
              <input className="code-input" type="email" autoComplete="email" placeholder="you@restaurant.com"
                ref={emailRef} value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="overline" style={{ margin: '14px 0 6px' }}>Password</p>
              <input className="code-input" type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
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
            </>
          )}
        </div>

        <p className="dim" style={{ fontSize: 12.5, maxWidth: 400 }}>
          {mode === 'signup'
            ? 'Already have an account? Tap “Log in” above.'
            : 'New restaurant? Tap “Sign up” above to create your account and register — 10-day free trial, full Growth features.'}
        </p>
      </div>
    </div>
  );
}
