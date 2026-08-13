/** Restaurant Portal sign-in: phone OTP (owners & invited staff) or
 *  email + password (existing Menuva staff credentials). */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';

export function PartnerLogin() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'otp' | 'email'>('otp');
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
    nav('/partner/orders', { replace: true });
  };

  const signInEmail = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) { setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message); return; }
    nav('/partner/orders', { replace: true });
  };

  return (
    <div className="page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={24} />
        <span className="badge gold">Restaurant Portal</span>
      </div>
      <div className="center-fill" style={{ gap: 14 }}>
        <p className="overline">For restaurants</p>
        <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 36px)' }}>Run your restaurant from anywhere</h1>
        <p className="muted" style={{ maxWidth: 440, fontSize: 14.5 }}>
          Live orders, menu, billing, QR codes and your plan — from any phone or
          computer. Zero commission: diners always pay you directly.
        </p>

        <div className="glass" style={{ width: '100%', maxWidth: 420, padding: 20, textAlign: 'left' }}>
          <div className="chip-row" style={{ paddingBottom: 6 }}>
            <button className={tab === 'otp' ? 'chip active' : 'chip'} onClick={() => { setTab('otp'); setError(''); }}>📱 Phone OTP</button>
            <button className={tab === 'email' ? 'chip active' : 'chip'} onClick={() => { setTab('email'); setError(''); }}>✉️ Email</button>
          </div>

          {tab === 'otp' ? (
            !otpSent ? (
              <>
                <p className="overline" style={{ margin: '8px 0 6px' }}>Mobile number</p>
                <input className="code-input" inputMode="tel" placeholder="98765 43210" value={phone}
                  onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendOtp()} />
                {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={busy} onClick={sendOtp}>
                  {busy ? 'Sending…' : 'Send OTP'}
                </button>
              </>
            ) : (
              <>
                <p className="overline" style={{ margin: '8px 0 6px' }}>Enter the 6-digit code sent to {e164()}</p>
                <input className="code-input" inputMode="numeric" autoFocus placeholder="••••••" value={otp}
                  onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verifyOtp()} />
                {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
                <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={busy || otp.trim().length < 4} onClick={verifyOtp}>
                  {busy ? 'Verifying…' : 'Verify & sign in'}
                </button>
                <button className="chip" style={{ marginTop: 10 }} onClick={() => { setOtpSent(false); setOtp(''); }}>← Change number</button>
              </>
            )
          ) : (
            <>
              <p className="overline" style={{ margin: '8px 0 6px' }}>Email</p>
              <input className="code-input" type="email" autoComplete="email" placeholder="you@restaurant.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="overline" style={{ margin: '14px 0 6px' }}>Password</p>
              <input className="code-input" type="password" autoComplete="current-password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && signInEmail()} />
              {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 10 }}>{error}</p>}
              <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || !email || !password} onClick={signInEmail}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </>
          )}
        </div>

        <p className="dim" style={{ fontSize: 12.5, maxWidth: 400 }}>
          New restaurant? Sign in with your phone — you'll register your
          restaurant right after (10-day free trial, full Growth features).
        </p>
      </div>
    </div>
  );
}
