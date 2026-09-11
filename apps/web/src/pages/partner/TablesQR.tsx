/** Tables & QR: sections (multi-section = Growth), create/remove tables,
 *  per-table QR preview, printable branded QR cards (browser print → PDF). */
import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchTables, createTable, removeTable, setTableCapacity, setTableAc, updateTableSetup, type PortalTable } from '../../lib/portalApi';
import { renderQrSheetHtml, accentFor } from '../../lib/billTemplate';
import { printBillHtml } from '../../lib/printBill';
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
  /** Kind and AC charge at CREATION, so an AC room is priced the moment it
   *  exists rather than after somebody remembers to come back. */
  const [kind, setKind] = useState('non_ac');
  const [acAmt, setAcAmt] = useState('');
  const [acKind, setAcKind] = useState<'flat' | 'percent'>('flat');
  /** Which existing table has its editor open. One at a time: a page of open
   *  forms is a page nobody finishes. */
  const [editing, setEditing] = useState<string | null>(null);
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
      /**
       * The kind and the AC charge are written in a SECOND call, not passed
       * to createTable.
       *
       * createTable already carries its own fallback ladder for a database
       * without seating_capacity, and threading four more optional columns
       * through it would mean a fallback for every combination. updateTableSetup
       * degrades on its own, so the table is created either way and the extra
       * fields land when the migration has run.
       */
      const made = (await fetchTables(restaurant.id)).find((t) => t.label === label.trim());
      if (made) {
        await updateTableSetup(made.id, {
          table_kind: kind,
          ac_charge_value: kind === 'ac' ? Number(acAmt || 0) : 0,
          ac_charge_kind: acKind,
        }).catch(() => { /* the table exists; the extras can be edited */ });
      }
      setLabel('');
      setSeats('');
      setAcAmt('');
      load();
    } catch (e: any) { setError(e?.message ?? 'Could not add the table.'); }
  };


  /**
   * THE PRINTED CARDS ARE THE SHARED TEMPLATE NOW.
   *
   * They used to be JSX plus rules in theme.css, while the phone built its own
   * HTML for the same card — so a QR card reprinted from the phone was not the
   * card already on the table. renderQrSheetHtml is what both surfaces call,
   * accentFor moved into it as well (each surface had its own copy of the
   * palette, so a table could get two different colours), and the sheet is
   * written into a hidden iframe and printed from there.
   *
   * An iframe rather than this document: printing the page means the portal's
   * own stylesheet is in play and every rule in it is a chance for the card to
   * come out differently here than on the phone. An empty iframe has no
   * stylesheet but the one the template carries, which is exactly the point.
   */
  const printCards = async (list: PortalTable[]) => {
    setError('');
    try {
      const cards = await Promise.all(list.map(async (t) => ({
        restaurantName: restaurant.name,
        tableLabel: t.is_parcel ? 'Takeaway' : t.label,
        qrSvg: await QRCode.toString(qrLink(t.qr_token), {
          type: 'svg', margin: 1, errorCorrectionLevel: 'H',
          color: { dark: '#1C1A15', light: '#FFFDF8' },
        }),
        accent: accentFor(t.label),
      })));

      // The same isolated-iframe printer the bill uses. It had its own copy
      // of this, with a 1s cleanup that cancelled the job on browsers where
      // print() resolves when the dialog OPENS rather than when it closes.
      printBillHtml(renderQrSheetHtml(cards));
    } catch (e: any) {
      setError(e?.message ?? 'Could not prepare the cards for printing.');
    }
  };

  if (!tables) return <Spinner label="Loading tables…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Tables & QR</p>
          <h1 className="display" style={{ fontSize: 26 }}>{tables.length} QR codes</h1>
        </div>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => printCards(tables)}>🖨 Print all QR cards</button>
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
        {/* WHAT KIND OF TABLE, chosen here rather than inferred from the name.
            "AC 3" and "Hall 2" told us nothing a bill could use. */}
        <select
          className="code-input" style={{ width: 132 }}
          value={kind} onChange={(e) => setKind(e.target.value)}
          aria-label="Table type"
        >
          <option value="non_ac">Non-AC</option>
          <option value="ac">AC</option>
          <option value="room">Room</option>
        </select>
        {/* THE AC CHARGE, ON THE TABLE, only when the table is one. Priced
            where the owner already is, so nobody has to find Bill settings. */}
        {kind === 'ac' && (
          <>
            <input
              className="code-input" style={{ width: 108 }} inputMode="decimal"
              placeholder="AC charge" value={acAmt}
              onChange={(e) => setAcAmt(e.target.value)}
              aria-label="AC charge amount"
            />
            <select
              className="code-input" style={{ width: 74 }}
              value={acKind} onChange={(e) => setAcKind(e.target.value as 'flat' | 'percent')}
              aria-label="AC charge kind"
            >
              <option value="flat">₹</option>
              <option value="percent">%</option>
            </select>
          </>
        )}
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
                        key={`seats-${t.id}-${t.seating_capacity ?? ''}`}
                        className="code-input"
                        inputMode="numeric"
                        placeholder="—"
                        defaultValue={t.seating_capacity ?? ''}
                        style={{ width: 62, padding: '4px 8px', fontSize: 12.5 }}
                        onBlur={async (e) => {
                          const raw = e.target.value.trim();
                          const next = raw === '' ? null : Number(raw);
                          if (next !== null && !Number.isFinite(next)) {
                            setError(`Seats has to be a number — ${t.label} is unchanged.`);
                            load();
                            return;
                          }
                          if ((t.seating_capacity ?? null) === next) return;
                          try {
                            setError('');
                            await setTableCapacity(t.id, next);
                          } catch (err: any) {
                            setError(err?.message ?? `Could not save the seat count for ${t.label}.`);
                          }
                          load();
                        }}
                      />
                    </label>
                  )}
                  {/* EDIT ON AN EXISTING TABLE. Every one of these settings
                      arrived after the tables did, so a create-only form would
                      leave a restaurant's whole floor on the defaults with no
                      way to correct them.

                      Collapsed behind Edit, and one open at a time: the row
                      already carries a QR, a name, seats and four buttons, and
                      a page of permanently-open forms is a page nobody
                      finishes. */}
                  {!t.is_parcel && editing === t.id && (
                    <div className="glass" style={{ padding: 10, marginTop: 8, display: 'grid', gap: 8 }}>
                      <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Type
                        {/* KEYED ON THE STORED VALUE, and that is not cosmetic.
                            These are uncontrolled inputs, so React keeps
                            whatever the user picked on screen even when the
                            save failed -- staff would set an AC charge, watch
                            it stick, and every bill from that table would be
                            short by it until somebody reconciled the day.
                            Folding the stored value into the key remounts the
                            control after each save, so what is on screen is
                            always what the database actually holds. */}
                        <select
                          key={`kind-${t.id}-${t.table_kind ?? ''}-${t.is_ac ? 1 : 0}`}
                          className="code-input" style={{ flex: 1, padding: '4px 8px', fontSize: 12.5 }}
                          defaultValue={t.table_kind ?? (t.is_ac ? 'ac' : 'non_ac')}
                          onChange={async (e) => {
                            const v = e.target.value;
                            try {
                              setError('');
                              await updateTableSetup(t.id, {
                                table_kind: v,
                                // Leaving a charge on a table that is no longer
                                // AC would bill for cooling it does not have.
                                ...(v === 'ac' ? {} : { ac_charge_value: 0 }),
                              });
                            } catch (err: any) {
                              setError(err?.message ?? `Could not change the type of ${t.label}.`);
                            }
                            load();
                          }}
                        >
                          <option value="non_ac">Non-AC</option>
                          <option value="ac">AC</option>
                          <option value="room">Room</option>
                        </select>
                      </label>

                      <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Availability
                        <select
                          key={`avail-${t.id}-${t.availability ?? ''}`}
                          className="code-input" style={{ flex: 1, padding: '4px 8px', fontSize: 12.5 }}
                          defaultValue={t.availability ?? 'available'}
                          onChange={async (e) => {
                            try {
                              setError('');
                              await updateTableSetup(t.id, { availability: e.target.value });
                            } catch (err: any) {
                              setError(err?.message ?? `Could not change availability for ${t.label}.`);
                            }
                            load();
                          }}
                        >
                          <option value="available">Available</option>
                          <option value="reserved">Reserved — blocks new scans</option>
                        </select>
                      </label>

                      {/* Only on an AC table. A charge field on a Room is a
                          question with no right answer. */}
                      {(t.table_kind ?? (t.is_ac ? 'ac' : 'non_ac')) === 'ac' && (
                        <label className="dim" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          AC charge
                          <input
                            key={`acval-${t.id}-${t.ac_charge_value ?? 0}`}
                            className="code-input" inputMode="decimal"
                            style={{ width: 78, padding: '4px 8px', fontSize: 12.5 }}
                            defaultValue={t.ac_charge_value ?? 0}
                            onBlur={async (e) => {
                              const v = Number(e.target.value.trim() || 0);
                              if (!Number.isFinite(v) || v < 0) {
                                setError(`An AC charge has to be a number that is not negative — ${t.label} is unchanged.`);
                                load();
                                return;
                              }
                              if (Number(t.ac_charge_value ?? 0) === v) return;
                              try {
                                setError('');
                                await updateTableSetup(t.id, { ac_charge_value: v });
                              } catch (err: any) {
                                setError(err?.message ?? `Could not save the AC charge for ${t.label}.`);
                              }
                              load();
                            }}
                          />
                          <select
                            key={`ackind-${t.id}-${t.ac_charge_kind ?? ''}`}
                            className="code-input" style={{ width: 66, padding: '4px 8px', fontSize: 12.5 }}
                            defaultValue={t.ac_charge_kind ?? 'flat'}
                            onChange={async (e) => {
                              try {
                                setError('');
                                await updateTableSetup(t.id, { ac_charge_kind: e.target.value });
                              } catch (err: any) {
                                setError(err?.message ?? `Could not change the AC charge type for ${t.label}.`);
                              }
                              load();
                            }}
                          >
                            <option value="flat">₹</option>
                            <option value="percent">%</option>
                          </select>
                        </label>
                      )}
                      <p className="dim" style={{ fontSize: 11, margin: 0 }}>
                        ₹ is charged once per bill. % is worked out on the food subtotal.
                      </p>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {!t.is_parcel && (
                      <button
                        className={editing === t.id ? 'chip active' : 'chip'}
                        onClick={() => setEditing(editing === t.id ? null : t.id)}
                      >
                        {editing === t.id ? 'Done' : '✎ Edit'}
                      </button>
                    )}
                    <button className="chip" onClick={() => printCards([t])}>🖨 Print</button>
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

    </div>
  );
}
