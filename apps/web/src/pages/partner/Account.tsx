/**
 * Account & security — the person behind the restaurant, on the portal.
 *
 * NEW ON THE WEB, and it mirrors the app's AccountScreen row for row: which
 * email signs in, WHICH METHODS CAN OPEN THE ACCOUNT, sign out. "Both surfaces
 * identical and interlinked" -- an owner who links Google on the phone sees it
 * linked here a second later, because it is one Supabase user.
 *
 * THE GOOGLE LINK IS THE POINT OF THIS PAGE. Supabase merges a Google sign-in
 * into an existing user only when the email MATCHES. An owner whose login is
 * one address and whose Google is another -- most of them -- would get a
 * second, empty restaurant the moment they pressed Google on the login page.
 * linkIdentity, run while signed in, attaches the identity to THIS user
 * whatever address it carries, and from then on the login page's Google
 * button lands here.
 *
 * Needs "Allow manual linking" on under Supabase -> Authentication -> Settings.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { showAppleButton, providerError } from '../../lib/authProviders';
import { resetByIdentifier, completeReset } from '../../lib/auth';

export function Account() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  /**
   * CHANGE PASSWORD, WITHOUT LEAVING THE PAGE.
   *
   * The same six-digit code the login screen's reset uses, reachable while
   * signed in -- which is where an owner actually goes looking for it. It
   * goes through completeReset like every other reset, so there is exactly
   * one way a password changes in this product and one place it can be wrong.
   */
  const [pwStep, setPwStep] = useState<'off' | 'code'>('off');
  const [pwCode, setPwCode] = useState('');
  const [pwNew, setPwNew] = useState('');

  const sendPasswordCode = async () => {
    if (!email) { setError('This account has no email address to send a code to.'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      await resetByIdentifier(email);
      setPwCode(''); setPwNew(''); setPwStep('code');
      setMsg(`A 6-digit code is on its way to ${email}.`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not send the code.');
    } finally { setBusy(false); }
  };

  const savePassword = async () => {
    if (!/^\d{6}$/.test(pwCode)) { setError('Enter the 6-digit code from the email.'); return; }
    if (pwNew.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      await completeReset(email!, pwCode, pwNew);
      setPwStep('off'); setPwCode(''); setPwNew('');
      setMsg('Password changed. It works here and in the app.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the password.');
    } finally { setBusy(false); }
  };

  const read = async () => {
    const { data } = await supabase.auth.getUser();
    setEmail(data.user?.email ?? null);
    const g = (data.user?.identities ?? []).find((i) => i.provider === 'google');
    setGoogleLinked(!!g);
    setGoogleEmail((g?.identity_data as any)?.email ?? null);
    /**
     * THE HANDLE, from the row that owns it.
     *
     * user_metadata carries the username only until complete_restaurant_signup
     * claims it, and it is not updated afterwards -- so app_user is the truth
     * and metadata is the fallback for an account that has not finished
     * registering. Showing the email alone left the owner with no way to see
     * the handle they log in with.
     */
    const uid = data.user?.id;
    if (uid) {
      const { data: row } = await supabase.from('app_user').select('username').eq('id', uid).maybeSingle();
      setUsername(row?.username ?? (data.user?.user_metadata as any)?.username ?? null);
    }
  };

  useEffect(() => {
    read();
    // The link completes on Google's page and comes back as a session update;
    // re-read so the row flips to Linked without a reload.
    const { data: sub } = supabase.auth.onAuthStateChange(() => { read(); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const link = async () => {
    setBusy(true); setError(''); setMsg('');
    const { error: err } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/partner/account` },
    });
    // Success navigates away; only a failure comes back here.
    if (err) { setBusy(false); setError(providerError(err, 'Google')); }
  };

  const unlink = async () => {
    if (!confirm('Unlink Google?\n\nYou will still sign in with your email. Google will just stop opening this account.')) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const { data } = await supabase.auth.getUserIdentities();
      const g = data?.identities?.find((i) => i.provider === 'google');
      if (!g) { setError('No Google account is linked.'); return; }
      const { error: err } = await supabase.auth.unlinkIdentity(g);
      if (err) setError(providerError(err, 'Google'));
      else { setMsg('Google unlinked.'); await read(); }
    } finally { setBusy(false); }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav('/partner', { replace: true });
  };

  return (
    <div className="fade-in" style={{ maxWidth: 560 }}>
      <p className="overline" style={{ marginTop: 12 }}>Account</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 14 }}>Your login</h1>

      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        {/* THE HANDLE FIRST. It is what the owner types to log in, and it was
            the one thing this page did not show -- an owner who had forgotten
            it had nowhere to look. */}
        <p className="overline" style={{ marginBottom: 4 }}>Username</p>
        <strong style={{ fontSize: 18 }}>{username ? `@${username}` : '—'}</strong>
        <p className="overline" style={{ margin: '12px 0 4px' }}>Email</p>
        <strong style={{ fontSize: 15 }}>{email ?? 'Unknown'}</strong>
        <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
          Log in with either, and the same password. It is one account — the same login
          works in the Menutha app on your phone.
        </p>
      </div>

      {/* CHANGE PASSWORD — the six-digit code, in place. */}
      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        <p className="overline" style={{ marginBottom: 8 }}>Password</p>
        {pwStep === 'off' ? (
          <>
            <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} disabled={busy} onClick={sendPasswordCode}>
              Change password
            </button>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
              We email a 6-digit code to {email ?? 'your address'}, then you choose the new one here.
            </p>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="acct-code">6-digit code</label>
            <input
              id="acct-code" className="code-input code-otp" inputMode="numeric" autoComplete="one-time-code"
              placeholder="••••••" maxLength={6} autoFocus value={pwCode}
              onChange={(e) => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <label className="field-label" htmlFor="acct-pw">New password</label>
            <input
              id="acct-pw" className="code-input" type="password" autoComplete="new-password"
              placeholder="At least 8 characters" value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePassword()} />
            <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 12 }}
              disabled={busy} onClick={savePassword}>
              Save new password
            </button>
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              <button className="btn btn-link" disabled={busy} onClick={sendPasswordCode}>Send another code</button>
              <button className="btn btn-link" onClick={() => { setPwStep('off'); setError(''); setMsg(''); }}>Cancel</button>
            </div>
          </>
        )}
      </div>

      <p className="overline" style={{ marginBottom: 6 }}>Sign-in methods</p>
      <div className="glass" style={{ padding: 4, marginBottom: 14 }}>
        <div className="acct-row">
          <span>Username &amp; password</span>
          <span className="acct-state ok">Active</span>
        </div>
        <div className="acct-row">
          <span>
            Google
            <small className="dim">
              {googleLinked
                ? `Linked${googleEmail ? ` · ${googleEmail}` : ''}`
                : 'Any Google account — it does not have to match your email'}
            </small>
          </span>
          <button className={`chip${busy ? ' is-busy' : ''}`} disabled={busy} onClick={googleLinked ? unlink : link}>
            {googleLinked ? 'Unlink' : 'Link'}
          </button>
        </div>
        {showAppleButton() && (
          <div className="acct-row">
            <span>Apple</span>
            <span className="acct-state">Coming soon</span>
          </div>
        )}
      </div>

      {msg && <p className="dim" style={{ fontSize: 13.5, marginBottom: 10 }}>{msg}</p>}
      {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginBottom: 10 }}>{error}</p>}

      <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
    </div>
  );
}
