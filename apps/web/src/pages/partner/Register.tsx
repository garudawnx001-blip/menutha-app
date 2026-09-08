/** The two steps after the account exists: connect Google (required), then
 *  register the restaurant. The confirmation email lands here, and so does the
 *  Google link on its way back. Atomic server-side bootstrap for the second
 *  step: owner role, restaurant, membership, Parcel table, 30-day full-Growth
 *  trial -- the trial starts the moment the restaurant is created. */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';
import { providerError } from '../../lib/authProviders';

export function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ owner: '', name: '', city: '', address: '', gstin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /**
   * STEP 1 OF 2 ON THIS PAGE: CONNECT GOOGLE, required.
   *
   * Every account has Google attached from day one, so "Continue with Google"
   * on the login page -- portal or phone -- always lands in this restaurant
   * rather than minting a second, empty one. ANY Google account: the address
   * does not have to match the sign-up email, because most owners' Google is
   * personal and their business email is not. Nothing is adopted silently; a
   * gmail typed at sign-up is just an address until this step connects an
   * actual Google identity.
   *
   * linkIdentity runs in the browser and comes back to THIS page, so the
   * identities are re-read on load and on every auth event -- the gate opens
   * by itself the moment the link lands. `checking` keeps the form from
   * flashing before the first read answers.
   */
  const [googleLinked, setGoogleLinked] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [linking, setLinking] = useState(false);
  /** The username chosen at sign-up, read back off user metadata and passed to
   *  complete_restaurant_signup, which claims it under the unique index. */
  const [metaUsername, setMetaUsername] = useState<string | null>(null);

  const readIdentities = async () => {
    const { data } = await supabase.auth.getUser();
    const g = (data.user?.identities ?? []).find((i) => i.provider === 'google');
    setGoogleLinked(!!g);
    setGoogleEmail((g?.identity_data as any)?.email ?? null);
    // The handle chosen at sign-up rode here in user metadata; this is the
    // first call with a session, so this page is where it gets claimed.
    setMetaUsername((data.user?.user_metadata as any)?.username ?? null);
    setChecking(false);
  };

  useEffect(() => {
    readIdentities();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { readIdentities(); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const connectGoogle = async () => {
    setLinking(true); setError('');
    const { error: err } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/partner/register` },
    });
    // Success navigates away; only a failure comes back here. The likeliest
    // failure is a project toggle, not this code, and the message says so.
    if (err) {
      setLinking(false);
      setError(/manual linking|not enabled|disabled/i.test(err.message)
        ? 'Google linking is switched off on the server (Supabase → Authentication → Settings → Allow manual linking).'
        : providerError(err, 'Google'));
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
      p_username: metaUsername,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes('not authenticated')
        ? 'Please sign in first.' : err.message);
      return;
    }
    nav('/partner/orders', { replace: true });
  };

  return (
    <div className="page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="topbar">
        <Wordmark size={24} />
        <span className="badge gold">30-day free trial</span>
      </div>
      <div className="center-fill" style={{ gap: 14 }}>
        <p className="overline">{googleLinked ? 'Step 2 of 2' : 'Step 1 of 2'}</p>
        <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 34px)' }}>
          {googleLinked ? 'Register your restaurant' : 'Connect Google'}
        </h1>

        {checking ? null : !googleLinked ? (
          /* THE GATE. The restaurant form is not drawn until a Google identity
             is on the account -- required, by decision, so that every account
             can be opened with one tap on either surface. Any Google account. */
          <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 20, textAlign: 'left' }}>
            <p className="dim" style={{ fontSize: 14, margin: '0 0 14px' }}>
              So you can also sign in with one tap. Use <b>any</b> Google account — it does not have to
              match the email you signed up with.
            </p>
            {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginBottom: 10 }}>{error}</p>}
            <button className={`btn btn-glass btn-block${linking ? ' is-busy' : ''}`} disabled={linking} onClick={connectGoogle}>
              <span aria-hidden style={{ marginRight: 8 }}>🇬</span>
              Connect Google
            </button>
            <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
              Google opens in this tab and brings you straight back here. Nothing is posted anywhere.
            </p>
          </div>
        ) : (
        <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 20, textAlign: 'left' }}>
          {googleEmail && (
            <p className="dim" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
              ✓ Google connected · {googleEmail}
            </p>
          )}
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
