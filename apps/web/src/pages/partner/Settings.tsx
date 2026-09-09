/** Restaurant settings: profile, timings, cuisine tags, UPI VPA, branding
 *  (per plan), P&L visibility toggle (owner), UPI ID (diners pay it directly
 *  wires the secret via Edge Function config — never client-side). */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  updateRestaurant, uploadImage, addOutlet, rememberOutlet,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { LocationPicker, type LatLng } from './LocationPicker';
import { UpgradeNudge } from './Gate';

/**
 * ONE FIELD: a label over its input.
 *
 * DECLARED AT MODULE SCOPE, AND THAT IS THE ENTIRE FIX. This used to be a
 * `const F = (...) => ...` inside Settings(), which is what he reported as
 * "typing is difficult for user because for every letter tapping is required".
 *
 * A component declared inside a render body gets a NEW function identity on
 * every render. React compares element types by identity, so on each keystroke
 * it saw a different component in that slot: it unmounted the old subtree and
 * mounted a fresh one, destroying and recreating the <input> underneath. A
 * freshly mounted input is not focused, so the caret was lost after every
 * single character and the owner had to tap the field again to type the next.
 *
 * Not a re-render problem and not solvable with a key or a ref -- the element
 * TYPE has to be stable across renders, and the only way to make it stable is
 * to stop creating it during the render. The markup below is untouched; only
 * its declaration site moved.
 */
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p className="overline" style={{ marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  );
}

export function Settings() {
  const nav = useNavigate();
  const { restaurant, role, can, reload } = usePartner();
  const [form, setForm] = useState({
    name: restaurant.name ?? '',
    address: (restaurant as any).address ?? '',
    phone: (restaurant as any).phone ?? '',
    gstin: (restaurant as any).gstin ?? '',
    city: restaurant.city ?? '',
    cuisine_tags: restaurant.cuisine_tags ?? '',
    open_time: restaurant.open_time ?? '',
    close_time: restaurant.close_time ?? '',
    upi_vpa: restaurant.upi_vpa ?? '',
    upi_account_type: (restaurant as any).upi_account_type ?? 'personal',
    own_website: restaurant.own_website ?? '',
    brand_color: (restaurant as any).brand_color ?? '#1B5E3F',
    is_open: restaurant.is_open !== false,
    grace_seconds: String((restaurant as any).grace_seconds ?? 60),
    map_label: (restaurant as any).map_label ?? (restaurant as any).address ?? '',
    maps_url: (restaurant as any).maps_url ?? '',
    /* The tax and service rates, the FSSAI number, the footer trio and the AC
       toggle are NOT here any more: they belong to Bill settings, which is the
       only page that shows or writes them. A page must not carry state it
       cannot display -- a seeded value saved back from here would silently
       undo a change made there a minute earlier. */
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /** The map pin. Null until the owner sets one; every tier may. */
  const [pin, setPin] = useState<LatLng | null>(
    (restaurant as any).lat != null && (restaurant as any).lng != null
      ? { lat: Number((restaurant as any).lat), lng: Number((restaurant as any).lng) }
      : null,
  );
  const [error, setError] = useState('');

  /** A second address, for an account whose plan allows one. */
  const [outletName, setOutletName] = useState('');
  const [outletCity, setOutletCity] = useState('');
  const [addingOutlet, setAddingOutlet] = useState(false);

  const createOutlet = async () => {
    if (!outletName.trim()) { setError('Give the new outlet a name.'); return; }
    setAddingOutlet(true); setError('');
    try {
      // The new row points at THIS restaurant, which is the one holding the
      // subscription -- effective_plan() resolves the child's tier to it.
      const id = await addOutlet(restaurant.id, outletName, outletCity);
      setOutletName(''); setOutletCity('');
      rememberOutlet(id);
      // Straight into the new outlet: the next thing anyone does is set up its
      // menu, and the switcher would otherwise still be pointing here.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that outlet.');
    } finally { setAddingOutlet(false); }
  };

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    // The AC service rate and its tolerated second write moved to Bill
    // settings with the rest of the bill's numbers.
    try {
      /**
       * CLAMPED ONCE, AND WRITTEN BACK — the owner has to see what was saved.
       *
       * The bound was applied on the way to the database and nowhere else, and
       * `form` is seeded once from `restaurant` with no re-seed on reload, so a
       * corrected value stayed invisible: the number on screen was a lie about
       * the number in force. Writing it back makes the correction show.
       *
       * Only the change window is left here. The tax and service rates moved
       * to Bill settings, and this page no longer sends them -- a field it
       * does not show must not be written from a seed that may now be stale,
       * or saving a phone number would quietly undo a GST change made a minute
       * earlier on the other page.
       */
      const clamped = {
        grace_seconds: Math.min(900, Math.max(0, Math.round(Number(form.grace_seconds) || 0))),
      };
      setForm((f) => ({ ...f, grace_seconds: String(clamped.grace_seconds) }));

      await updateRestaurant(restaurant.id, {
        name: form.name.trim() || restaurant.name,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        gstin: form.gstin.trim().toUpperCase() || null,
        city: form.city.trim() || null,
        cuisine_tags: form.cuisine_tags.trim() || null,
        open_time: form.open_time || null,
        close_time: form.close_time || null,
        upi_vpa: form.upi_vpa.trim() || null,
        upi_account_type: form.upi_account_type,
        own_website: form.own_website.trim() || null,
        is_open: form.is_open,
        // Same bounds the database enforces, so a typo is corrected here rather
        // than bounced back as a constraint error.
        grace_seconds: clamped.grace_seconds,
        // The pin, and the line shown under it. Sent as nulls when cleared, so
        // "no location" is storable rather than only "never set".
        lat: pin ? pin.lat : null,
        lng: pin ? pin.lng : null,
        map_label: form.map_label.trim() || null,
        // Set at sign-up, editable here for ever after -- an owner who skipped
        // it, moved, or got a new short link should not have to re-register.
        maps_url: form.maps_url.trim() || null,
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

  return (
    <div className="fade-in" style={{ maxWidth: 640 }}>
      <p className="overline" style={{ marginTop: 12 }}>Restaurant profile</p>
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
        {/* CHARGES AND THE BILL LAYOUT MOVED OUT, to their own section.
            They were three scrolls down a form about addresses and opening
            hours, while the phone has kept them as their own screen since
            they were built -- so "change it in Bill settings" meant two
            different journeys depending on which device the owner was
            holding. See BillSettings. */}
        {/* WHERE THE OUTLET IS. Every tier -- knowing where a restaurant is is
            not a premium feature. Diners see this pin on the menu. */}
        {/* THE LINK A DINER TAPS. The pin below answers "how far is it";
            this answers "take me there", and the two are not the same job --
            which is why both are here rather than one standing in for the
            other. */}
        <F label="Google Maps link">
          <input className="code-input" inputMode="url" placeholder="https://maps.app.goo.gl/..."
            value={form.maps_url} onChange={(e) => setForm({ ...form, maps_url: e.target.value })} />
          <p className="dim" style={{ fontSize: 12, margin: '6px 0 0' }}>
            Open your restaurant in Google Maps, tap Share, paste it here. Diners tap it to navigate.
          </p>
        </F>

        <F label="Location on the map">
          <LocationPicker
            value={pin}
            label={form.map_label}
            onChange={setPin}
            onLabelChange={(v) => setForm((f) => ({ ...f, map_label: v }))}
          />
        </F>
        {/* MORE THAN ONE ADDRESS. Enterprise, unlimited, one subscription --
            a new outlet is a restaurant row pointing at this one, so it gets
            its own menu, tables, QR codes and reports and reads its plan from
            here. Locked tiers see the nudge rather than nothing. */}
        <F label="Outlets">
          {can('multi_outlet') ? (
            <>
              <p className="dim" style={{ fontSize: 13, margin: '0 0 10px' }}>
                Each outlet has its own menu, tables, QR codes and reports. One subscription
                covers them all, and the switcher at the top left moves between them.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="code-input" style={{ flex: '1 1 180px' }} placeholder="New outlet name"
                  value={outletName} onChange={(e) => setOutletName(e.target.value)} />
                <input className="code-input" style={{ flex: '1 1 120px' }} placeholder="City"
                  value={outletCity} onChange={(e) => setOutletCity(e.target.value)} />
              </div>
              <button type="button" className={`btn btn-ghost`}
                style={{ marginTop: 10 }} disabled={addingOutlet} onClick={createOutlet}>
                Add outlet
              </button>
            </>
          ) : (
            <UpgradeNudge feature="multi_outlet" what="Multiple outlets" />
          )}
        </F>
        <F label="Bill settings">
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>
            Taxes, custom charges and the printed layout have their own section now —
            the same place the app keeps them.
          </p>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }}
            onClick={() => nav('/partner/bill-settings')}>
            Open Bill settings →
          </button>
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
        <p className="dim" style={{ fontSize: 12.5 }}>
          Diners pay this UPI ID directly. Menutha takes no cut of diner payments.
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

      <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy} onClick={save}>
        {saved ? 'Saved ✓' : 'Save settings'}
      </button>
    </div>
  );
}
