/** First-restaurant registration for a signed-in account with no membership.
 *  Atomic server-side bootstrap: owner role, restaurant, membership, Parcel
 *  table, 10-day full-Growth trial. */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components';

export function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ owner: '', name: '', city: '', address: '', gstin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.owner.trim() || !form.name.trim()) { setError('Your name and the restaurant name are required.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.rpc('complete_restaurant_signup', {
      p_manager_name: form.owner.trim(),
      p_restaurant_name: form.name.trim(),
      p_city: form.city.trim() || null,
      p_address: form.address.trim() || null,
      p_gstin: form.gstin.trim() || null,
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
        <span className="badge gold">10-day free trial</span>
      </div>
      <div className="center-fill" style={{ gap: 14 }}>
        <p className="overline">Almost there</p>
        <h1 className="display" style={{ fontSize: 'clamp(26px, 5vw, 34px)' }}>Register your restaurant</h1>
        <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 20, textAlign: 'left' }}>
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
            Full Growth features for 10 days · no card needed · zero commission always.
          </p>
        </div>
      </div>
    </div>
  );
}
