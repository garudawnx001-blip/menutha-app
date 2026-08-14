/** Restaurant settings: profile, timings, cuisine tags, UPI VPA, branding
 *  (per plan), P&L visibility toggle (owner), own gateway key id (Module 3
 *  wires the secret via Edge Function config — never client-side). */
import React, { useState } from 'react';
import {
  updateRestaurant, setPnlVisibility, uploadImage,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';

export function Settings() {
  const { restaurant, role, can, reload } = usePartner();
  const [form, setForm] = useState({
    name: restaurant.name ?? '',
    address: (restaurant as any).address ?? '',
    city: restaurant.city ?? '',
    cuisine_tags: restaurant.cuisine_tags ?? '',
    open_time: restaurant.open_time ?? '',
    close_time: restaurant.close_time ?? '',
    upi_vpa: restaurant.upi_vpa ?? '',
    own_website: restaurant.own_website ?? '',
    gateway_key_id: restaurant.gateway_key_id ?? '',
    brand_color: (restaurant as any).brand_color ?? '#1B5E3F',
    is_open: restaurant.is_open !== false,
    gst_pct: String((restaurant as any).gst_pct ?? 5),
    service_charge_pct: String((restaurant as any).service_charge_pct ?? 0),
  });
  const [pnlVisible, setPnl] = useState(!!restaurant.pnl_visible_to_managers);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      await updateRestaurant(restaurant.id, {
        name: form.name.trim() || restaurant.name,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        cuisine_tags: form.cuisine_tags.trim() || null,
        open_time: form.open_time || null,
        close_time: form.close_time || null,
        upi_vpa: form.upi_vpa.trim() || null,
        own_website: form.own_website.trim() || null,
        gateway_key_id: form.gateway_key_id.trim() || null,
        is_open: form.is_open,
        gst_pct: Math.min(28, Math.max(0, Number(form.gst_pct) || 0)),
        service_charge_pct: Math.min(25, Math.max(0, Number(form.service_charge_pct) || 0)),
        ...(can('white_label') || can('basic_theme') ? { brand_color: form.brand_color } : {}),
      });
      if (role === 'owner') await setPnlVisibility(restaurant.id, pnlVisible);
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { setError(e?.message ?? 'Save failed.'); }
    finally { setBusy(false); }
  };

  const uploadBrand = async (kind: 'logos' | 'banners', file?: File) => {
    if (!file) return;
    try {
      const url = await uploadImage(kind, file);
      await updateRestaurant(restaurant.id, kind === 'logos' ? { logo_url: url } : { banner_url: url });
      await reload();
    } catch { setError('Image upload failed.'); }
  };

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <p className="overline" style={{ marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  );

  return (
    <div className="fade-in" style={{ maxWidth: 640 }}>
      <p className="overline" style={{ marginTop: 12 }}>Settings</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 14 }}>{restaurant.name}</h1>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        <F label="Restaurant name">
          <input className="code-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </F>
        <F label="Address">
          <input className="code-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </F>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <F label="City">
              <input className="code-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: 2 }}>
            <F label="Cuisine tags (comma-separated)">
              <input className="code-input" placeholder="North Indian, Chinese, Juices"
                value={form.cuisine_tags} onChange={(e) => setForm({ ...form, cuisine_tags: e.target.value })} />
            </F>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <F label="Opens">
              <input className="code-input" type="time" value={form.open_time ?? ''} onChange={(e) => setForm({ ...form, open_time: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: 1 }}>
            <F label="Closes">
              <input className="code-input" type="time" value={form.close_time ?? ''} onChange={(e) => setForm({ ...form, close_time: e.target.value })} />
            </F>
          </div>
          <button className={form.is_open ? 'chip active' : 'chip'} style={{ marginBottom: 12 }}
            onClick={() => setForm({ ...form, is_open: !form.is_open })}>
            {form.is_open ? 'Open now' : 'Closed now'}
          </button>
        </div>
        <F label="Your website (optional — shown on your public page)">
          <input className="code-input" placeholder="https://…" value={form.own_website}
            onChange={(e) => setForm({ ...form, own_website: e.target.value })} />
        </F>
      </div>

      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Bill charges</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <F label="GST %">
              <input className="code-input" inputMode="decimal" value={form.gst_pct}
                onChange={(e) => setForm({ ...form, gst_pct: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: 1 }}>
            <F label="Service charge % (0 = none)">
              <input className="code-input" inputMode="decimal" value={form.service_charge_pct}
                onChange={(e) => setForm({ ...form, service_charge_pct: e.target.value })} />
            </F>
          </div>
        </div>
        <p className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
          Applied to every new order and shown as line items on diner bills and receipts.
        </p>

        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Payments — direct to you</h3>
        <F label="UPI ID (VPA) — diners' payment QR points here">
          <input className="code-input" placeholder="yourshop@okhdfcbank" value={form.upi_vpa}
            onChange={(e) => setForm({ ...form, upi_vpa: e.target.value })} />
        </F>
        <F label="Own Razorpay Key ID (optional — for card checkout on YOUR account)">
          <input className="code-input" placeholder="rzp_live_…" value={form.gateway_key_id}
            onChange={(e) => setForm({ ...form, gateway_key_id: e.target.value })} />
        </F>
        <p className="dim" style={{ fontSize: 12.5 }}>
          The secret key is never entered here — it's configured server-side
          when gateway checkout goes live. Menutha takes no cut of diner payments.
        </p>
      </div>

      <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Branding {can('white_label') && <span className="badge gold">White-label</span>}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="chip" style={{ cursor: 'pointer' }}>
            🖼 Logo
            <input type="file" accept="image/*" hidden onChange={(e) => uploadBrand('logos', e.target.files?.[0])} />
          </label>
          <label className="chip" style={{ cursor: 'pointer' }}>
            🖼 Banner
            <input type="file" accept="image/*" hidden onChange={(e) => uploadBrand('banners', e.target.files?.[0])} />
          </label>
          <label className="chip" style={{ gap: 8 }}>
            Brand colour
            <input type="color" value={form.brand_color} style={{ width: 26, height: 22, border: 'none', background: 'none', cursor: 'pointer' }}
              onChange={(e) => setForm({ ...form, brand_color: e.target.value })} />
          </label>
          {!can('white_label') && (
            <span className="dim" style={{ fontSize: 12.5 }}>Remove Menutha branding — Enterprise plan.</span>
          )}
        </div>
      </div>

      {role === 'owner' && (
        <div className="glass" style={{ padding: 16, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h3 style={{ fontWeight: 700 }}>P&L visible to managers</h3>
            <p className="dim" style={{ fontSize: 12.5 }}>Off by default — only you see revenue, expenses and profit.</p>
          </div>
          <button className={pnlVisible ? 'chip active' : 'chip'} onClick={() => setPnl(!pnlVisible)} aria-pressed={pnlVisible}>
            {pnlVisible ? 'Visible' : 'Hidden'}
          </button>
        </div>
      )}

      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
      </button>
    </div>
  );
}
