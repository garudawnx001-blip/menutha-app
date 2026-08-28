/** Tables & QR: sections (multi-section = Growth), create/remove tables,
 *  per-table QR preview, printable branded QR cards (browser print → PDF). */
import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchTables, createTable, removeTable, type PortalTable } from '../../lib/portalApi';
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

/** QR as inline SVG, not a raster PNG.
 *
 *  toDataURL produces a fixed-pixel bitmap. Scaled onto a 40mm label at a
 *  thermal printer's 203–300 dpi it visibly blurs, and the client saw exactly
 *  that. An SVG has no resolution: the printer rasterises it at whatever DPI it
 *  actually has, so the same markup is crisp on a 40mm label and an A4 sheet.
 *
 *  errorCorrectionLevel 'H' costs a little density but survives a smudged or
 *  partly-worn label, which is the realistic failure on a table card. */
/** Paper a restaurant actually feeds into its printer.
 *
 *  @page takes ONE size per document, so the chosen one is written into a
 *  dedicated <style> immediately before printing. Each format gets its own
 *  layout rather than one design scaled down: on a 40mm square there is room
 *  for a QR and a table number and nothing else, and pretending otherwise is
 *  how you get the unreadable output the client photographed. */
const CARD_FORMATS = {
  a4:     { label: 'A4 sheet',      page: 'size: A4; margin: 10mm;',            cls: 'cf-a4' },
  l100x150: { label: '100 × 150 mm', page: 'size: 100mm 150mm; margin: 5mm;',  cls: 'cf-100' },
  l50:    { label: '50 × 50 mm',    page: 'size: 50mm 50mm; margin: 2mm;',      cls: 'cf-50' },
  l40:    { label: '40 × 40 mm',    page: 'size: 40mm 40mm; margin: 1.5mm;',    cls: 'cf-40' },
} as const;
type CardFmt = keyof typeof CARD_FORMATS;

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
  const [printTables, setPrintTables] = useState<PortalTable[] | null>(null);
  const [cardFmt, setCardFmt] = useState<CardFmt>('a4');
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
      await createTable(restaurant.id, label.trim(), section.trim() || null);
      setLabel('');
      load();
    } catch (e: any) { setError(e?.message ?? 'Could not add the table.'); }
  };

  useEffect(() => {
    if (!printTables) return;
    // @page allows one active size per document, so write the chosen one just
    // before printing rather than shipping four dead rules.
    const id = 'menutha-card-format';
    let tag = document.getElementById(id) as HTMLStyleElement | null;
    if (!tag) { tag = document.createElement('style'); tag.id = id; document.head.appendChild(tag); }
    tag.textContent = `@page { ${CARD_FORMATS[cardFmt].page} }`;
    const t = setTimeout(() => { window.print(); setPrintTables(null); }, 350);
    return () => clearTimeout(t);
  }, [printTables, cardFmt]);

  if (!tables) return <Spinner label="Loading tables…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Tables & QR</p>
          <h1 className="display" style={{ fontSize: 26 }}>{tables.length} QR codes</h1>
        </div>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Label printers take 40mm and 50mm squares and 100×150 portrait;
              each needs its own layout, not A4 shrunk down. */}
          <select className="code-input" style={{ padding: '6px 8px', fontSize: 12.5, width: 'auto' }}
            value={cardFmt} onChange={(e) => setCardFmt(e.target.value as CardFmt)} aria-label="Card size">
            {(Object.keys(CARD_FORMATS) as CardFmt[]).map((k) => (
              <option key={k} value={k}>{CARD_FORMATS[k].label}</option>
            ))}
          </select>
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
          <div className={`qr-sheet ${CARD_FORMATS[cardFmt].cls}`}>
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
