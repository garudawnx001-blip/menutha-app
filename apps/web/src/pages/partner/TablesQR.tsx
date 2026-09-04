/** Tables & QR: sections (multi-section = Growth), create/remove tables,
 *  per-table QR preview, printable branded QR cards (browser print → PDF). */
import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchTables, createTable, removeTable, setTableCapacity, setTableAc, type PortalTable } from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

/** Where a scanned table QR should land. The portal and the diner app are the
 *  same deployment, so the page's own origin is always right — and it cannot
 *  drift the way a hardcoded fallback did.
 *
 *  It had drifted: VITE_WEB_ORDER_URL is not set in CI, so every QR printed or
 *  copied from the portal encoded https://worktejachar.github.io/menutha-app/#
 *  — a host with no GitHub Pages site at all, which is why scanning one showed
 *  GitHub's own "There isn't a GitHub Pages site here" page. QRs generated in
 *  the mobile app were unaffected; it passes the real domain in via app config.
 *
 *  Any trailing slash or leftover hash-router "#" is stripped so the path joins
 *  cleanly. */
const ORDER_BASE = (
  (import.meta.env.VITE_WEB_ORDER_URL as string | undefined)
  || (typeof window !== 'undefined' && window.location.origin)
  || 'https://menutha.com'
).replace(/\/*#?\/*$/, '');

/** scan.html is a real file, so this answers HTTP 200 — phone QR scanners
 *  refuse to open a 404, which /scan/<token> used to return. */
const qrLink = (token: string) => `${ORDER_BASE}/scan.html?t=${encodeURIComponent(token)}`;

/** A deterministic accent per table, from a curated in-brand palette. The
 *  point is practical, not decorative: a printed stack of table tents is
 *  otherwise identical apart from a small label, and staff have to read every
 *  one to sort them. Same label always yields the same colour, so a reprinted
 *  card matches the one already on the table. */
const CARD_ACCENTS = [
  '#D97757', // terracotta — the house colour
  '#1B5E3F', // forest
  '#C9A04E', // gold
  '#9B4B3F', // clay
  '#3E6B63', // teal
  '#8A5A83', // plum
];
function accentFor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return CARD_ACCENTS[h % CARD_ACCENTS.length];
}

/* No paper picker any more. The printer knows what paper it has and the
   browser's print dialog already asks; making the owner declare it a second
   time, in our wording, before reaching that dialog was a question we had no
   business asking — and answering it wrong printed a ruined sheet.

   The sheet adapts instead: @page uses size:auto, so the page box is whatever
   paper is selected, and the card layout keys off that width in print media
   queries (see theme.css). One tap, one dialog, right output on A4, on a
   100x150 label, or on a roll. */

/** QR as inline SVG, not a raster PNG.
 *
 *  toDataURL produces a fixed-pixel bitmap. Scaled onto a 40mm label at a
 *  thermal printer's 203–300 dpi it visibly blurs, and the client saw exactly
 *  that. An SVG has no resolution: the printer rasterises it at whatever DPI it
 *  actually has, so the same markup is crisp on a 40mm label and an A4 sheet.
 *
 *  errorCorrectionLevel 'H' costs a little density but survives a smudged or
 *  partly-worn label, which is the realistic failure on a table card. */
function QrImg({ token, size = 132 }: { token: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(qrLink(token), {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'H',
      color: { dark: '#1C1A15', light: '#FFFDF8' },
    })
      .then((s: string) => alive && setSvg(s))
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);
  if (!svg) return null;
  return (
    <span
      className="qr-svg"
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }}
      aria-label="Table QR code"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function TablesQR() {
  const { restaurant, can } = usePartner();
  const [tables, setTables] = useState<PortalTable[] | null>(null);
  const [label, setLabel] = useState('');
  const [section, setSection] = useState('');
  // Seats at creation (see createTable). A string, not a number, so the field
  // can be genuinely EMPTY -- 0 is not the same answer as "not recorded", and
  // a numeric state would have to pick one of them to start from.
  const [seats, setSeats] = useState('');
  const [printTables, setPrintTables] = useState<PortalTable[] | null>(null);
  const [error, setError] = useState('');

  const load = () => fetchTables(restaurant.id).then(setTables).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [restaurant.id]);

  const sections = useMemo(() => {
    const g = new Map<string, PortalTable[]>();
    for (const t of tables ?? []) {
      const key = t.is_parcel ? 'Parcel / Takeaway' : (t.room || 'Main');
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(t);
    }
    return [...g.entries()];
  }, [tables]);

  const add = async () => {
    if (!label.trim()) return;
    if (section.trim() && !can('multi_qr') && sections.some(([s]) => s !== 'Main' && s !== 'Parcel / Takeaway' && s !== section.trim())) {
      setError('Multiple QR sections (bar / dining / rooftop) need the Growth plan.');
      return;
    }
    try {
      const n = seats.trim() === '' ? null : Number(seats.trim());
      if (n !== null && !Number.isFinite(n)) { setError('Seats must be a number.'); return; }
      await createTable(restaurant.id, label.trim(), section.trim() || null, n);
      setLabel('');
      setSeats('');
      load();
    } catch (e: any) { setError(e?.message ?? 'Could not add the table.'); }
  };

  useEffect(() => {
    if (!printTables) return;
    // Nothing to inject any more: one stylesheet covers every paper size.
    // The delay is only so the QR SVGs finish rendering before the dialog
    // freezes the document.
    const t = setTimeout(() => { window.print(); setPrintTables(null); }, 350);
    return () => clearTimeout(t);
  }, [printTables]);

  if (!tables) return <Spinner label="Loading tables…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Tables & QR</p>
          <h1 className="display" style={{ fontSize: 26 }}>{tables.length} QR codes</h1>
        </div>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => setPrintTables(tables)}>🖨 Print all QR cards</button>
        </span>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      <div className="glass" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="code-input" style={{ flex: 2, minWidth: 140 }} placeholder="Table label — e.g. Table 7"
          value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input className="code-input" style={{ flex: 1, minWidth: 120 }}
          placeholder={can('multi_qr') ? 'Section (Bar / Rooftop…)' : 'Section — Growth plan'}
          value={section} onChange={(e) => setSection(e.target.value)} disabled={!can('multi_qr')} />
        {/* SEATS, ASKED ONCE, WHILE HE IS ADDING THE TABLE. Narrow and
            optional -- it sits between the section and the button because
            that is the order the questions come in his head: what is it
            called, where is it, how many sit at it. */}
        <input className="code-input" style={{ width: 92 }} inputMode="numeric"
          placeholder="Seats" value={seats}
          onChange={(e) => setSeats(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-primary" style={{ padding: '12px 18px' }} disabled={!label.trim()} onClick={add}>Add table</button>
      </div>
      {!can('multi_qr') && (
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Want separate QR sets for bar / dining / rooftop? <NavLink to="/partner/plan" style={{ fontWeight: 700 }}>Upgrade to Growth →</NavLink>
        </p>
      )}

      {sections.map(([name, list]) => (
        <section key={name}>
          <h2 className="cat-heading">{name}</h2>
          <div className="menu-grid">
            {list.map((t) => (
              <div key={t.id} className="glass" style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
                <QrImg token={t.qr_token} size={104} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700 }}>{t.label}</p>
                  <p className="dim" style={{ fontSize: 12, wordBreak: 'break-all' }}>{t.qr_token}</p>
                  {/* SEATS, so a reservation can be matched to a table. The
                      booking already captures party size; without this, "party
                      of 6" is a number nobody can act on unless they know the
                      room by heart.
                      Blank is a real value meaning not recorded -- a
                      restaurant that never fills this in keeps working exactly
                      as it does now. */}
                  {/* AC, AND IT IS THE SWITCH THAT MAKES AC PRICING REAL.
                      order_charges() already resolves a charge scoped to "AC
                      tables" — but only when the restaurant has AC pricing on
                      AND the table is marked here. Nothing on any surface could
                      set that flag, so the charge matched nothing and the
                      feature added nothing to any bill. Same row as Seats
                      because they are the same kind of fact about a table, and
                      hidden on the parcel row, which is not a table anyone sits
                      at — air-conditioned or otherwise. */}
                  {!t.is_parcel && (
                    <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!t.is_ac}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          try { await setTableAc(t.id, on); load(); }
                          catch (err: any) { setError(err?.message ?? 'Could not change the AC setting.'); }
                        }}
                      />
                      Air-conditioned
                    </label>
                  )}
                  {!t.is_parcel && (
                    <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      Seats
                      <input
                        className="code-input"
                        inputMode="numeric"
                        placeholder="—"
                        defaultValue={t.seating_capacity ?? ''}
                        style={{ width: 62, padding: '4px 8px', fontSize: 12.5 }}
                        onBlur={async (e) => {
                          const raw = e.target.value.trim();
                          const next = raw === '' ? null : Number(raw);
                          if (next !== null && !Number.isFinite(next)) return;
                          if ((t.seating_capacity ?? null) === next) return;
                          try { await setTableCapacity(t.id, next); load(); }
                          catch { /* the field keeps what was typed; next blur retries */ }
                        }}
                      />
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="chip" onClick={() => setPrintTables([t])}>🖨 Print</button>
                    <button className="chip" onClick={() => navigator.clipboard?.writeText(qrLink(t.qr_token))}>Copy link</button>
                    {!t.is_parcel && (
                      <button className="chip" onClick={async () => {
                        if (confirm(`Remove ${t.label}? Its printed QR stops working.`)) { await removeTable(t.id); load(); }
                      }}>✕</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {printTables && (
        <div className="printable">
          <div className="qr-sheet">
            {printTables.map((t) => (
              <div key={t.id} className="qr-card" style={{ ['--card-accent' as any]: accentFor(t.label) }}>
                <p className="qr-eyebrow">Scan · Order · Relax</p>
                <p className="qr-house">{restaurant.name}</p>
                <span className="qr-table">{t.is_parcel ? 'Takeaway' : t.label}</span>
                <div>
                  <span className="qr-well"><QrImg token={t.qr_token} size={200} /></span>
                </div>
                <p className="qr-cta">Point your camera here</p>
                <p className="qr-steps">
                  The menu opens straight away — browse, order,<br />
                  and pay from your phone. No app to install.
                </p>
                <p className="qr-foot">Powered by Menutha</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
