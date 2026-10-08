/**
 * SETTINGS → PRINTER (this computer). The same section, in the same words, as
 * the app's Settings → Printer: choose a thermal printer, test it, the roll
 * width, and whether KOTs print by themselves. Without one, every print uses
 * the browser's print dialog as before.
 */
import React, { useState } from 'react';
import {
  getDirectSettings, saveDirectSettings, choosePrinter, printTestDirect, serialSupported, usbSupported,
  type DirectSettings,
} from '../../lib/directPrint';

export function PrinterSettings({ restaurantName }: { restaurantName: string }) {
  const [p, setP] = useState<DirectSettings>(getDirectSettings());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const save = (x: Partial<DirectSettings>) => setP(saveDirectSettings(x));
  const supported = serialSupported() || usbSupported();

  const pick = async (m: 'serial' | 'usb') => {
    setBusy(m); setMsg('');
    try { setP(await choosePrinter(m)); setMsg('Printer chosen. Press "Test print".'); }
    catch (e: any) { if (!/No port selected|No device selected|cancel/i.test(String(e?.message))) setMsg(e?.message ?? 'No printer chosen.'); }
    finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setMsg('');
    try { await printTestDirect(restaurantName); setMsg('Test page sent. If it printed, bills and KOTs will print the same way.'); }
    catch (e: any) { setMsg(`The test page did not print: ${e?.message ?? 'check the printer is on and connected.'}`); }
    finally { setBusy(''); }
  };

  return (
    <div className="glass" style={{ padding: 16, marginBottom: 14 }}>
      <h3 style={{ fontWeight: 700, marginBottom: 6 }}>Printer (this computer)</h3>
      {!supported ? (
        <p className="dim" style={{ fontSize: 13 }}>
          This browser cannot talk to a printer directly. Bills and KOTs print through the browser’s print dialog.
          Chrome or Edge on a computer can print straight to a USB or Bluetooth thermal printer.
        </p>
      ) : (
        <>
          <p className="dim" style={{ fontSize: 13, margin: '0 0 8px' }}>
            Connect your 58 mm or 80 mm thermal printer by USB, or pair it with this computer over Bluetooth, then choose it here.
            Without a printer, the browser’s print dialog is used as before.
          </p>
          <div className="bill-row"><span>Printer</span><strong>{p.label ?? 'None — browser print dialog'}</strong></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
            {serialSupported() && <button className="chip" disabled={!!busy} onClick={() => pick('serial')}>Choose printer (USB serial / Bluetooth)</button>}
            {usbSupported() && <button className="chip" disabled={!!busy} onClick={() => pick('usb')}>Choose printer (USB)</button>}
            {p.method && <button className="chip" disabled={!!busy} onClick={test}>Test print</button>}
            {p.method && <button className="chip" onClick={() => save({ method: null, label: null, autoKot: false })}>Forget printer</button>}
          </div>
          <div className="bill-row">
            <span>Roll width</span>
            <span style={{ display: 'flex', gap: 6 }}>
              {(['58', '80'] as const).map((w) => (
                <button key={w} className={(p.paper ?? '80') === w ? 'chip active' : 'chip'} onClick={() => save({ paper: w })}>{w} mm</button>
              ))}
            </span>
          </div>
          <label className="bill-row" style={{ cursor: 'pointer' }}>
            <span>Print the KOT for every new order</span>
            <input type="checkbox" checked={p.autoKot} disabled={!p.method} onChange={(e) => save({ autoKot: e.target.checked })} />
          </label>
          <p className="dim" style={{ fontSize: 12 }}>These are for this browser only. KOTs print automatically while the Orders screen is open.</p>
        </>
      )}
      <label className="bill-row" style={{ cursor: 'pointer' }}>
        <span>Print the bill when it is raised</span>
        <input type="checkbox" checked={p.autoBill} onChange={(e) => save({ autoBill: e.target.checked })} />
      </label>
      {msg && <p className="inline-error" role="status" style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
