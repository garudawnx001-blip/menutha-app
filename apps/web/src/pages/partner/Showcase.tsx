/**
 * The restaurant's showcase: menu-card photos, certificates, and pictures.
 *
 * His words: like an Instagram profile. Diners looking at a restaurant they
 * have not been to want to see the room, the menu card and, in India
 * especially, the licence on the wall -- and a restaurant wants to show them.
 *
 * A LIST, NOT SLOTS. logo_url and banner_url are single fixed columns and that
 * is correct: there is one logo. A showcase grows -- three certificates today,
 * a new FSSAI next year, a second menu card when the bar menu arrives -- so it
 * is rows, and adding the fourth one costs nothing.
 *
 * NOTHING PRIVATE BELONGS HERE. The public page reads this table without a
 * login, which is the point: a certificate is a document restaurants hang on
 * the wall. Worth remembering before extending it.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  fetchMedia, addMedia, deleteMedia, uploadImage,
  type RestaurantMedia, type MediaKind,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const KINDS: { key: MediaKind; label: string; hint: string }[] = [
  { key: 'menu_card',   label: 'Menu card',   hint: 'A photo of your printed menu' },
  { key: 'certificate', label: 'Certificate', hint: 'FSSAI, GST, awards' },
  { key: 'photo',       label: 'Photo',       hint: 'The room, the food, the team' },
];

export function Showcase() {
  const { restaurant } = usePartner();
  const [rows, setRows] = useState<RestaurantMedia[]>([]);
  const [kind, setKind] = useState<MediaKind>('menu_card');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setRows(await fetchMedia(restaurant.id));
    setLoading(false);
  };
  useEffect(() => { load(); }, [restaurant.id]);

  const onPick = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const url = await uploadImage('showcase', file);
      await addMedia(restaurant.id, kind, url, caption);
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      // Named plainly: the most likely cause today is that the migration has
      // not been run yet, and "could not save" would send someone hunting
      // through the upload code instead.
      setError(e?.message ?? 'Could not save. If this is new, the showcase table may not exist yet.');
    } finally { setBusy(false); }
  };

  const remove = async (m: RestaurantMedia) => {
    if (!confirm('Remove this from your profile?')) return;
    setBusy(true);
    try { await deleteMedia(m.id); await load(); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      <p className="overline" style={{ marginTop: 12 }}>Profile</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>Your showcase</h1>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        Shown on your public page, where diners look before they visit. Your
        menu card, your licences, and photos of the place.
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      {KINDS.map((k) => {
        const mine = rows.filter((r) => r.kind === k.key);
        if (!mine.length) return null;
        return (
          <div key={k.key} style={{ marginBottom: 16 }}>
            <p className="overline" style={{ marginBottom: 6 }}>{k.label}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {mine.map((m) => (
                <div key={m.id} style={{ width: 132 }}>
                  <img src={m.url} alt={m.caption ?? k.label}
                    style={{ width: '100%', height: 132, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
                  {m.caption && <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{m.caption}</div>}
                  <button className="chip" style={{ marginTop: 4 }} disabled={busy}
                    onClick={() => remove(m)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="glass" style={{ padding: 16, marginTop: 8 }}>
        <p className="overline" style={{ marginBottom: 8 }}>Add to your profile</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="code-input" style={{ flex: '0 0 150px' }}
            value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <input className="code-input" style={{ flex: '1 1 200px' }}
            placeholder="Caption (optional)"
            value={caption} onChange={(e) => setCaption(e.target.value)} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => onPick(e.target.files?.[0])} />
          <button className="chip" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Choose image'}
          </button>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          {KINDS.find((k) => k.key === kind)?.hint}
        </p>
      </div>
    </div>
  );
}
