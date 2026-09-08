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

export function Account() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const read = async () => {
    const { data } = await supabase.auth.getUser();
    setEmail(data.user?.email ?? null);
    const g = (data.user?.identities ?? []).find((i) => i.provider === 'google');
    setGoogleLinked(!!g);
    setGoogleEmail((g?.identity_data as any)?.email ?? null);
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
        <p className="overline" style={{ marginBottom: 4 }}>Signed in as</p>
        <strong style={{ fontSize: 16 }}>{email ?? 'Unknown'}</strong>
        <p className="dim" style={{ fontSize: 13, marginTop: 6 }}>
          The same login works in the Menutha app on your phone — it is one account.
        </p>
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
