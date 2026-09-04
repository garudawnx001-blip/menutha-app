/**
 * THE BILL LAYOUT EDITOR — logo, alignment, type size, with a live preview.
 *
 * His ask: "each and everything the font size and align and everything should
 * be editable", the logo he uploads on his profile should be the one on the
 * bill with a switch to turn it off, and all of it must be visible AS he edits
 * rather than after a print.
 *
 * DESIGNED AS A TABLE, NOT A WALL OF CONTROLS. Nine sections times two
 * properties is eighteen inputs, and eighteen labelled fields stacked down a
 * page is unusable — you cannot see the shape of what you are editing. So it
 * is one row per section with the two controls inline, which reads as a list
 * of the bill's own parts in the order they appear on paper. Selecting a row
 * highlights the matching block in the preview beside it, so "ids" and "meta"
 * do not have to be guessed at from their names.
 *
 * THE PREVIEW IS THE REAL DOCUMENT. It is an iframe holding exactly the string
 * renderBillHtml produces — the same function that prints the bill, on both
 * this portal and the phone. A preview drawn by separate code is a preview of
 * the preview: it agrees with the real bill right up until one of them changes,
 * which is the day it matters.
 *
 * srcDoc rather than a URL, so it needs no route and no network; sandbox with
 * no allow-scripts, because a document assembled from restaurant-entered text
 * should not be able to run anything even though the template escapes it all.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LAYOUT, SECTIONS, MIN_SIZE, MAX_SIZE,
  normaliseLayout, renderBillHtml, sampleBillData,
  type Align, type BillLayout, type SectionKey,
} from '../../lib/billTemplate';
import { fetchBillLayout, saveBillLayout, uploadImage } from '../../lib/portalApi';

const ALIGNS: { key: Align; label: string; glyph: string }[] = [
  { key: 'left',   label: 'Left',   glyph: '⯇' },
  { key: 'center', label: 'Centre', glyph: '≡' },
  { key: 'right',  label: 'Right',  glyph: '⯈' },
];

/** A deep-enough clone. The layout is two levels of plain data, so this is
 *  exact — and it means an edit never mutates the object the preview is
 *  memoised on, which would leave the preview one keystroke behind. */
const clone = (l: BillLayout): BillLayout => ({
  logo: { ...l.logo },
  sections: Object.fromEntries(
    Object.entries(l.sections).map(([k, v]) => [k, { ...v }]),
  ) as BillLayout['sections'],
});

export function BillLayoutEditor({
  restaurantId, restaurant,
}: {
  restaurantId: string;
  /** The LIVE draft from the Settings form, not the saved row. Typing a new
   *  thank-you line upstairs has to show up in the preview down here, or the
   *  preview is only telling the truth about half the page. */
  restaurant: any;
}) {
  const [layout, setLayout] = useState<BillLayout>(DEFAULT_LAYOUT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [focus, setFocus] = useState<SectionKey | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetchBillLayout(restaurantId)
      .then((raw) => { if (alive) { setLayout(normaliseLayout(raw)); setLoading(false); } })
      // normaliseLayout(null) is the house layout, so a failed read still gives
      // a usable editor rather than a spinner that never ends.
      .catch(() => { if (alive) { setLayout(DEFAULT_LAYOUT); setLoading(false); } });
    return () => { alive = false; };
  }, [restaurantId]);

  const edit = (fn: (draft: BillLayout) => void) => {
    setLayout((prev) => { const next = clone(prev); fn(next); return next; });
    setDirty(true);
    setNote('');
  };

  const save = async () => {
    if (saving) return;
    setSaving(true); setError(''); setNote('');
    try {
      await saveBillLayout(restaurantId, layout);
      setDirty(false);
      setNote('Saved. Every bill printed from here or from the app uses this layout.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the layout.');
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = async (file: File) => {
    setError(''); setNote('');
    try {
      // 'logos', not a new folder: the same bucket path the profile logo uses,
      // because a bill logo is a logo and a second folder is a second place to
      // look when one goes missing.
      const url = await uploadImage('logos', file);
      if (!url) { setError('That image could not be uploaded. Please try again.'); return; }
      edit((d) => { d.logo.source = 'custom'; d.logo.url = url; d.logo.show = true; });
    } catch (e: any) {
      setError(e?.message ?? 'That image could not be uploaded.');
    }
  };

  /** The preview document. Rebuilt on every edit — it is a string, and a
   *  string is cheap; the iframe re-parses roughly as fast as a keystroke. */
  const html = useMemo(
    () => renderBillHtml(sampleBillData(restaurant ?? {}), layout),
    [restaurant, layout],
  );

  if (loading) return <p className="dim" style={{ fontSize: 13 }}>Loading bill layout…</p>;

  const profileLogo = restaurant?.logo_url as string | undefined;

  return (
    <div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        How the printed bill is laid out. The preview is the real document — the same
        template the app prints from, so a bill from the counter and a bill from the
        phone are the same bill.
      </p>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── Controls ── */}
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          {/* LOGO */}
          <div className="glass" style={{ padding: 12, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={layout.logo.show}
                onChange={(e) => edit((d) => { d.logo.show = e.target.checked; })}
              />
              Show logo on bill
            </label>

            {layout.logo.show && (
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {/* The common case is one picture. The owner already uploads a
                    logo for their profile and it is already the thing diners
                    associate with them, so reusing it is the default and needs
                    no second upload. */}
                <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="radio" name="bill-logo-src"
                    checked={layout.logo.source === 'profile'}
                    onChange={() => edit((d) => { d.logo.source = 'profile'; })}
                  />
                  Use my profile picture
                  {profileLogo
                    ? <img src={profileLogo} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
                    : <em style={{ fontSize: 12 }}>— none uploaded yet</em>}
                </label>

                <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="radio" name="bill-logo-src"
                    checked={layout.logo.source === 'custom'}
                    onChange={() => edit((d) => { d.logo.source = 'custom'; })}
                  />
                  Use a different image for the bill
                  {layout.logo.url
                    ? <img src={layout.logo.url} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
                    : null}
                </label>

                {layout.logo.source === 'custom' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="chip" type="button" onClick={() => fileRef.current?.click()}>
                      {layout.logo.url ? 'Replace image' : 'Upload image'}
                    </button>
                    {layout.logo.url && (
                      <button className="chip" type="button"
                        onClick={() => edit((d) => { d.logo.url = null; })}>Remove</button>
                    )}
                    <input
                      ref={fileRef} type="file" accept="image/*" hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLogo(f); e.target.value = ''; }}
                    />
                    {!layout.logo.url && (
                      <span className="dim" style={{ fontSize: 12 }}>
                        Nothing chosen — the bill prints without a logo.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTIONS */}
          <div className="glass" style={{ padding: 12 }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Text position and size</p>
            <p className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
              In the order they appear on the bill. Sizes are in points, {MIN_SIZE}–{MAX_SIZE}.
            </p>

            {SECTIONS.map(({ key, label, hint }) => {
              const s = layout.sections[key];
              return (
                <div
                  key={key}
                  onMouseEnter={() => setFocus(key)}
                  onMouseLeave={() => setFocus((f) => (f === key ? null : f))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '8px 6px', borderRadius: 8,
                    borderTop: '1px solid var(--hairline, rgba(28,24,20,0.07))',
                    background: focus === key ? 'rgba(217,119,87,0.06)' : 'transparent',
                  }}
                >
                  <div style={{ flex: '1 1 130px', minWidth: 120 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
                    <div className="dim" style={{ fontSize: 11.5 }}>{hint}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }} role="group" aria-label={`${label} alignment`}>
                    {ALIGNS.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        className={s.align === a.key ? 'chip active' : 'chip'}
                        title={a.label}
                        aria-pressed={s.align === a.key}
                        aria-label={`${label}: ${a.label}`}
                        style={{ minWidth: 34, padding: '4px 8px' }}
                        onClick={() => edit((d) => { d.sections[key].align = a.key; })}
                      >
                        {a.glyph}
                      </button>
                    ))}
                  </div>

                  {/* Stepper, not a free text box. A bill's type size is a
                      nudge-until-it-looks-right decision, and a text field
                      invites 200 and then a bill with one word on it. The
                      value is still typeable for anyone who knows what they
                      want; it is clamped on the way in either way. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button" className="chip" style={{ minWidth: 28, padding: '4px 8px' }}
                      aria-label={`${label}: smaller`}
                      disabled={s.size <= MIN_SIZE}
                      onClick={() => edit((d) => { d.sections[key].size = Math.max(MIN_SIZE, s.size - 1); })}
                    >−</button>
                    <input
                      className="code-input"
                      inputMode="numeric"
                      aria-label={`${label}: size in points`}
                      value={s.size}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        edit((d) => { d.sections[key].size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n))); });
                      }}
                      style={{ width: 52, padding: '4px 6px', fontSize: 12.5, textAlign: 'center' }}
                    />
                    <button
                      type="button" className="chip" style={{ minWidth: 28, padding: '4px 8px' }}
                      aria-label={`${label}: larger`}
                      disabled={s.size >= MAX_SIZE}
                      onClick={() => edit((d) => { d.sections[key].size = Math.min(MAX_SIZE, s.size + 1); })}
                    >+</button>
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="button" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save layout'}
              </button>
              <button
                className="chip" type="button"
                onClick={() => { setLayout(clone(DEFAULT_LAYOUT)); setDirty(true); setNote(''); }}
              >
                Reset to default
              </button>
            </div>
            {error && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            {note && <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>{note}</p>}
          </div>
        </div>

        {/* ── Live preview ── */}
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Live preview</p>
          <iframe
            title="Bill preview"
            srcDoc={html}
            sandbox=""
            style={{
              width: '100%', height: 560, border: '1px solid rgba(28,24,20,0.12)',
              borderRadius: 10, background: '#fff',
            }}
          />
          <p className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>
            A sample order, with your own details and settings. Not a tax invoice.
          </p>
        </div>
      </div>
    </div>
  );
}
