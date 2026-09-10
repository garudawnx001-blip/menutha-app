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
import {
  resetByIdentifier, completeReset, changePassword, passwordProblem,
  usernameAvailable, usernameProblem, cleanHandle,
} from '../../lib/auth';

export function Account() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(false);
  /** Username and email, EDITABLE. Both surfaces showed them read-only, and
   *  "unable to add username" was the accurate report: an owner who arrived
   *  by Google before the finish-setup step, or any account with no handle,
   *  had nowhere to set one. Built here first; the phone mirrors it. */
  const [idStep, setIdStep] = useState<'off' | 'form'>('off');
  const [newHandle, setNewHandle] = useState('');
  const [newEmail, setNewEmail] = useState('');
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
  /**
   * TWO FLOWS, AND THE DIFFERENCE IS WHETHER THEY KNOW THE OLD PASSWORD.
   *
   *   'form'  signed in and remembers it: current + new + re-type. No code --
   *           someone who can already prove who they are should not be sent
   *           to their inbox to do it again.
   *   'code'  they do not remember it: the same six-digit code the login
   *           screen's Forgot password uses, reachable from the link below.
   *
   * Instagram draws exactly this pair, and the link between them is what
   * stops the first screen being a dead end for the person who needs it most.
   */
  const [pwStep, setPwStep] = useState<'off' | 'form' | 'code'>('off');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwRetype, setPwRetype] = useState('');
  const [pwOthers, setPwOthers] = useState(false);
  const [pwCode, setPwCode] = useState('');
  const [pwNew, setPwNew] = useState('');

  const resetPwFields = () => {
    setPwCurrent(''); setPwNew(''); setPwRetype(''); setPwCode(''); setPwOthers(false);
  };

  const submitChange = async () => {
    if (!email) { setError('This account has no email address.'); return; }
    if (pwNew !== pwRetype) { setError('The two new passwords do not match.'); return; }
    const problem = passwordProblem(pwNew);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      await changePassword(email, pwCurrent, pwNew, pwOthers);
      setPwStep('off'); resetPwFields();
      setMsg(pwOthers
        ? 'Password changed, and other devices have been signed out.'
        : 'Password changed. It works here and in the app.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the password.');
    } finally { setBusy(false); }
  };

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
    const problem = passwordProblem(pwNew);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      await completeReset(email!, pwCode, pwNew);
      setPwStep('off'); setPwCode(''); setPwNew('');
      setMsg('Password changed. It works here and in the app.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the password.');
    } finally { setBusy(false); }
  };

  /**
   * SAVE USERNAME AND/OR EMAIL.
   *
   * Username: app_user.username is the row the login resolves (see the
   * username-login function), and the "app_user: update own" policy lets an
   * owner write their own row. The unique index on lower(username) is the
   * final arbiter; its refusal (23505) becomes "taken". user_metadata is
   * mirrored so the fallback this page reads agrees with the row.
   *
   * Email: Supabase changes it only after the owner confirms from the new
   * inbox (and, with secure email change on, the old one too), so this
   * cannot say "done" -- it says what to do next.
   */
  const saveIdentity = async () => {
    const handle = cleanHandle(newHandle.trim());
    const wantsHandle = handle !== (username ?? '');
    const mail = newEmail.trim();
    const wantsEmail = !!mail && mail !== (email ?? '');
    if (!wantsHandle && !wantsEmail) { setIdStep('off'); return; }
    if (wantsHandle) {
      const problem = usernameProblem(handle);
      if (problem) { setError(problem); return; }
    }
    if (wantsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      setError('That does not look like an email address.'); return;
    }
    setBusy(true); setError(''); setMsg('');
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error('Please sign in again.');
      if (wantsHandle) {
        if (!(await usernameAvailable(handle))) { setError('That username is taken. Try another.'); return; }
        const { data: rows, error: err } = await supabase
          .from('app_user').update({ username: handle }).eq('id', uid).select('id');
        if (err) {
          if ((err as any).code === '23505') { setError('That username is taken. Try another.'); return; }
          throw err;
        }
        if (!rows || rows.length === 0) {
          throw new Error('The username was not saved — you may not have permission to change it.');
        }
        await supabase.auth.updateUser({ data: { username: handle } });
      }
      if (wantsEmail) {
        const { error: err } = await supabase.auth.updateUser({ email: mail });
        if (err) throw err;
        setMsg(`Check ${mail} for a confirmation link — the email changes once you open it.`);
      }
      setIdStep('off');
      await read();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.');
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
        {idStep === 'off' ? (
          <>
            <p className="overline" style={{ marginBottom: 4 }}>Username</p>
            <strong style={{ fontSize: 18 }}>{username ? `@${username}` : '—'}</strong>
            <p className="overline" style={{ margin: '12px 0 4px' }}>Email</p>
            <strong style={{ fontSize: 15 }}>{email ?? 'Unknown'}</strong>
            <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
              Log in with either, and the same password. It is one account — the same login
              works in the Menutha app on your phone.
            </p>
            <button className="btn btn-glass btn-block" style={{ marginTop: 12 }} disabled={busy}
              onClick={() => { setNewHandle(username ?? ''); setNewEmail(email ?? ''); setError(''); setMsg(''); setIdStep('form'); }}>
              {username ? 'Change username or email' : 'Set a username'}
            </button>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="acct-username">Username</label>
            {/* Lower-cased as typed, the same alphabet sign-up allows. */}
            <input id="acct-username" className="code-input" type="text" autoComplete="username" autoFocus
              placeholder="your_restaurant" value={newHandle}
              onChange={(e) => setNewHandle(cleanHandle(e.target.value))} />
            <p className="dim" style={{ fontSize: 12, margin: '4px 0 10px' }}>
              3–30 letters, numbers, dots or underscores. This is what you type to log in.
            </p>
            <label className="field-label" htmlFor="acct-email">Email</label>
            <input id="acct-email" className="code-input" type="email" autoComplete="email"
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveIdentity()} />
            <p className="dim" style={{ fontSize: 12, margin: '4px 0 10px' }}>
              A new address takes effect once you confirm it from the link we send there.
            </p>
            {/* Beside the field, not only at the foot of the page. */}
            {error && <p className="field-error">{error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} style={{ flex: 1 }} disabled={busy} onClick={saveIdentity}>
                Save
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => { setIdStep('off'); setError(''); }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* CHANGE PASSWORD — the six-digit code, in place. */}
      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        <p className="overline" style={{ marginBottom: 8 }}>Password</p>
        {pwStep === 'off' ? (
          <>
            <button className={`btn btn-glass btn-block${busy ? ' is-busy' : ''}`} disabled={busy}
              onClick={() => { resetPwFields(); setError(''); setMsg(''); setPwStep('form'); }}>
              Change password
            </button>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
              Enter your current password and choose a new one. Forgotten it? There is a link on
              that screen.
            </p>
          </>
        ) : pwStep === 'form' ? (
          /* FLOW 1: signed in and remembers the old password. No code. */
          <>
            <label className="field-label" htmlFor="pw-current">Current password</label>
            <input id="pw-current" className="code-input" type="password" autoComplete="current-password"
              autoFocus value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
            <label className="field-label" htmlFor="pw-new">New password</label>
            <input id="pw-new" className="code-input" type="password" autoComplete="new-password"
              placeholder="8+ characters, with a letter and a number"
              value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            <label className="field-label" htmlFor="pw-retype">Re-type new password</label>
            <input id="pw-retype" className="code-input" type="password" autoComplete="new-password"
              value={pwRetype} onChange={(e) => setPwRetype(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitChange()} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={pwOthers} onChange={(e) => setPwOthers(e.target.checked)} />
              <span style={{ fontSize: 13.5 }}>Log out of other devices</span>
            </label>

            {error && <p className="field-error">{error}</p>}
            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 8 }}
              disabled={busy} onClick={submitChange}>
              Change password
            </button>
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              {/* THE WAY OUT for the person who cannot fill the first field --
                  without it this screen is a dead end for exactly the owner
                  who needs it most. It starts flow 2 in place. */}
              <button className="btn btn-link" disabled={busy} onClick={sendPasswordCode}>
                Forgot your password?
              </button>
              <button className="btn btn-link" onClick={() => { setPwStep('off'); resetPwFields(); setError(''); }}>
                Cancel
              </button>
            </div>
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
              placeholder="8+ characters, with a letter and a number" value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePassword()} />
            <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 12 }}
              disabled={busy} onClick={savePassword}>
              Save new password
            </button>
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              <button className="btn btn-link" disabled={busy} onClick={sendPasswordCode}>Send another code</button>
              <button className="btn btn-link" onClick={() => { setPwStep('form'); setError(''); setMsg(''); }}>‹ Back</button>
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
          <button className={`btn btn-glass btn-sm${busy ? ' is-busy' : ''}`} disabled={busy} onClick={googleLinked ? unlink : link}>
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
      {error && <p className="inline-error">{error}</p>}

      <button className="btn btn-glass" style={{ color: 'var(--error)' }} onClick={signOut}>Sign out</button>
    </div>
  );
}
