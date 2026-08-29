/** Restaurant settings: profile, timings, cuisine tags, UPI VPA, branding
 *  (per plan), P&L visibility toggle (owner), own gateway key id (Module 3
 *  wires the secret via Edge Function config — never client-side). */
import React, { useState } from 'react';
import {
  updateRestaurant, uploadImage,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';

export function Settings() {
  const { restaurant, role, can, reload } = usePartner();
  const [form, setForm] = useState({
    name: restaurant.name ?? '',
    address: (restaurant as any).address ?? '',
    phone: (restaurant as any).phone ?? '',
    gstin: (restaurant as any).gstin ?? '',
    bill_footer: (restaurant as any).bill_footer ?? '',
    city: restaurant.city ?? '',
    cuisine_tags: restaurant.cuisine_tags ?? '',
    open_time: restaurant.open_time ?? '',
    close_time: restaurant.close_time ?? '',
    upi_vpa: restaurant.upi_vpa ?? '',
    upi_account_type: (restaurant as any).upi_account_type ?? 'personal',
    own_website: restaurant.own_website ?? '',
    gateway_key_id: restaurant.gateway_key_id ?? '',
    brand_color: (restaurant as any).brand_color ?? '#1B5E3F',
    is_open: restaurant.is_open !== false,
    sgst_pct: String((restaurant as any).sgst_pct ?? 2.5),
    cgst_pct: String((restaurant as any).cgst_pct ?? 2.5),
    service_charge_pct: String((restaurant as any).service_charge_pct ?? 0),
    grace_seconds: String((restaurant as any).grace_seconds ?? 60),
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      await updateRestaurant(restaurant.id, {
        name: form.name.trim() || restaurant.name,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        gstin: form.gstin.trim().toUpperCase() || null,
        bill_footer: form.bill_footer.trim() || null,
        city: form.city.trim() || null,
        cuisine_tags: form.cuisine_tags.trim() || null,
        open_time: form.open_time || null,
        close_time: form.close_time || null,
        upi_vpa: form.upi_vpa.trim() || null,
        upi_account_type: form.upi_account_type,
        own_website: form.own_website.trim() || null,
        gateway_key_id: form.gateway_key_id.trim() || null,
        is_open: form.is_open,
        // gst_pct is kept in sync as sgst+cgst by a DB trigger.
        sgst_pct: Math.min(14, Math.max(0, Number(form.sgst_pct) || 0)),
        cgst_pct: Math.min(14, Math.max(0, Number(form.cgst_pct) || 0)),
        service_charge_pct: Math.min(25, Math.max(0, Number(form.service_charge_pct) || 0)),
        // Same bounds the database enforces, so a typo is corrected here rather
        // than bounced back as a constraint error.
        grace_seconds: Math.min(900, Math.max(0, Math.round(Number(form.grace_seconds) || 0))),
        ...(can('white_label') || can('basic_theme') ? { brand_color: form.brand_color } : {}),
      });
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
        {/* What appears on the printed bill. A tax invoice needs the
            restaurant's own identity on it, not just a name — these all render
            in the bill header, with the logo above them. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <F label="Phone (on bill)">
            <input className="code-input" inputMode="tel" placeholder="98765 43210"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </F>
          <F label="GSTIN (on bill)">
            <input className="code-input" placeholder="29ABCDE1234F1Z5"
              value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
          </F>
        </div>
        <F label="Bill footer message">
          <input className="code-input" placeholder="Thank you — please visit again!"
            value={form.bill_footer} onChange={(e) => setForm({ ...form, bill_footer: e.target.value })} />
          <span className="dim" style={{ fontSize: 12 }}>
            Printed at the bottom of every bill. Leave blank for none.
          </span>
        </F>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
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
        {/* Wraps, and the children may shrink.
            `input[type=time]` carries an intrinsic minimum width that flex:1
            alone will not shrink below, so two of them plus the Open/Closed
            chip needed ~350px and overflowed a 305px screen — pushing the chip
            off the right edge entirely. minWidth:0 lets them compress and the
            wrap gives the chip its own line when they cannot. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <F label="Opens">
              <input className="code-input" type="time" value={form.open_time ?? ''} onChange={(e) => setForm({ ...form, open_time: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
            <F label="SGST %">
              <input className="code-input" inputMode="decimal" value={form.sgst_pct}
                onChange={(e) => setForm({ ...form, sgst_pct: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
            <F label="CGST %">
              <input className="code-input" inputMode="decimal" value={form.cgst_pct}
                onChange={(e) => setForm({ ...form, cgst_pct: e.target.value })} />
            </F>
          </div>
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
            <F label="Service charge %">
              <input className="code-input" inputMode="decimal" value={form.service_charge_pct}
                onChange={(e) => setForm({ ...form, service_charge_pct: e.target.value })} />
            </F>
          </div>
        </div>
        <p className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
          Indian GST convention: SGST + CGST are charged as equal halves (2.5% + 2.5% = 5% for
          restaurants). Both appear as separate lines on every diner bill, receipt and printed bill —
          total GST is {(Number(form.sgst_pct) || 0) + (Number(form.cgst_pct) || 0)}%.
          {' '}<strong>0 is a valid setting</strong> and is saved as zero; a 0% line simply doesn’t
          appear on the bill. Changes apply to <strong>new orders</strong> — orders already placed
          keep the rates they were priced at, so an existing bill still shows the old charges.
        </p>

        {/* The grace window, which the portal could not set at all - it had a
            prep-time field instead, and prep time is gone. This is the setting
            that actually changes what a diner experiences. */}
        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Order timing</h3>
        <F label="Change window (seconds)">
          <input className="code-input" inputMode="numeric" style={{ maxWidth: 140 }}
            value={form.grace_seconds}
            onChange={(e) => setForm({ ...form, grace_seconds: e.target.value })} />
          <span className="dim" style={{ fontSize: 12 }}>
            How long a diner has to change or cancel an order before it reaches you.
            Nothing appears on the Orders board until it elapses, so it is time you
            never spend cooking something that gets withdrawn. <strong>0</strong> sends
            orders through instantly. An order keeps the window it was placed with, so
            changing this never cuts short someone who is mid-order.
          </span>
        </F>

        <h3 style={{ fontWeight: 700, marginBottom: 10 }}>Payments — direct to you</h3>
        <F label="UPI ID (VPA) — diners' payment QR points here">
          <input className="code-input" placeholder="yourshop@okhdfcbank" value={form.upi_vpa}
            onChange={(e) => setForm({ ...form, upi_vpa: e.target.value })} />
        </F>
        {/* Account type drives the diner's payment panel. Payment apps cap
            one-tap payments to PERSONAL UPI IDs (commonly ₹2,000) because they
            are person-to-person; merchant IDs are P2M and uncapped. Nothing in
            our link can change that — the class is resolved by the payment
            provider from the ID itself — so we ask, and adapt the diner's
            screen rather than showing a button that will be refused. */}
        <F label="What kind of UPI ID is this?">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['personal', 'Personal', 'One-tap works up to ₹2,000; above that diners scan the QR.'],
              ['merchant', 'Merchant / Business', 'One-tap works at any amount. No limits shown to diners.'],
            ] as const).map(([val, label, hint]) => (
              <button
                key={val}
                type="button"
                className={form.upi_account_type === val ? 'chip active' : 'chip'}
                onClick={() => setForm({ ...form, upi_account_type: val })}
                title={hint}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="dim" style={{ fontSize: 12 }}>
            {form.upi_account_type === 'merchant'
              ? 'Diners get one-tap payment at any amount.'
              : 'Diners get one-tap up to ₹2,000; above that the bill shows a large QR to scan with the camera. A free merchant UPI ID (PhonePe / Paytm / GPay for Business) removes the limit.'}
          </span>
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

      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
      </button>
    </div>
  );
}
