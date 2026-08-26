/** Tables & QR: sections (multi-section = Growth), create/remove tables,
 *  per-table QR preview, printable branded QR cards (browser print → PDF). */
import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchTables, createTable, removeTable, type PortalTable } from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const ORDER_BASE =
  (import.meta.env.VITE_WEB_ORDER_URL as string | undefined) ??
  'https://worktejachar.github.io/menutha-app/#';

const qrLink = (token: string) => `${ORDER_BASE}/scan.html?t=${token}`;

function QrImg({ token, size = 132 }: { token: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(qrLink(token), { margin: 1, width: size * 2, color: { dark: '#1C1A15', light: '#FFFDF8' } })
      .then(setSrc).catch(() => {});
  }, [token, size]);
  return src ? <img src={src} width={size} height={size} alt="Table QR code" style={{ borderRadius: 10 }} /> : null;
}

export function TablesQR() {
  const { restaurant, can } = usePartner();
  const [tables, setTables] = useState<PortalTable[] | null>(null);
  const [label, setLabel] = useState('');
  const [section, setSection] = useState('');
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
      await createTable(restaurant.id, label.trim(), section.trim() || null);
      setLabel('');
      load();
    } catch (e: any) { setError(e?.message ?? 'Could not add the table.'); }
  };

  useEffect(() => {
    if (printTables) {
      const t = setTimeout(() => { window.print(); setPrintTables(null); }, 350);
      return () => clearTimeout(t);
    }
  }, [printTables]);

  if (!tables) return <Spinner label="Loading tables…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Tables & QR</p>
          <h1 className="display" style={{ fontSize: 26 }}>{tables.length} QR codes</h1>
        </div>
        <button className="chip" onClick={() => setPrintTables(tables)}>🖨 Print all QR cards</button>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
            {printTables.map((t) => (
              <div key={t.id} style={{ border: '2px solid #E7DECC', borderRadius: 20, padding: 24, textAlign: 'center', pageBreakInside: 'avoid' }}>
                <p style={{ fontFamily: 'Georgia, serif', fontSize: 30, fontWeight: 700 }}>
                  <span style={{ color: '#1B5E3F' }}>menu</span>tha
                </p>
                <p style={{ color: '#6B6557', fontSize: 14, margin: '2px 0 14px' }}>{restaurant.name} · {t.label}</p>
                <QrImg token={t.qr_token} size={220} />
                <p style={{ fontWeight: 700, fontSize: 16, marginTop: 14 }}>Scan to see the menu & order</p>
                <p style={{ color: '#C9A04E', fontSize: 10.5, letterSpacing: 2, marginTop: 8 }}>
                  NO APP · NO SIGN-UP · POWERED BY MENUTHA
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
