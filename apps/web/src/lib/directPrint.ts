/**
 * DIRECT THERMAL PRINTING from the browser — Web Serial or WebUSB, where the
 * browser has them (Chrome / Edge on a computer; Chrome on Android for USB).
 * Everything else, and any failure, falls back to the normal print dialog
 * (printBillHtml), exactly as before.
 *
 *   Web Serial  a USB printer that shows up as a COM port, or a Bluetooth
 *               printer paired with the computer (Bluetooth "serial port").
 *   WebUSB      a USB printer of the printer class.
 *
 * The bytes are lib/escpos.ts, built from the same data and layout as the
 * HTML bill — the same file the phone uses over Bluetooth.
 *
 * Settings live in this browser (localStorage): the printer is next to a
 * computer, not next to a restaurant.
 */
import { billEscPos, kotEscPos, testPageEscPos, type PaperCols } from './escpos';
import { renderBillHtml, renderKotHtml, type BillData } from './billTemplate';
import { printBillHtml } from './printBill';

export type DirectMethod = 'serial' | 'usb';
export interface DirectSettings { method: DirectMethod | null; label: string | null; paper: '58' | '80' | null; autoKot: boolean; autoBill: boolean }
const KEY = 'menutha.directPrint.v1';
const DEFAULTS: DirectSettings = { method: null, label: null, paper: null, autoKot: false, autoBill: false };

export function getDirectSettings(): DirectSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveDirectSettings(p: Partial<DirectSettings>): DirectSettings {
  const next = { ...getDirectSettings(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

const nav: any = typeof navigator !== 'undefined' ? navigator : {};
export const serialSupported = () => !!nav.serial;
export const usbSupported = () => !!nav.usb;
export const directSupported = () => serialSupported() || usbSupported();

/** Ask the browser for a printer (must run from a click). */
export async function choosePrinter(method: DirectMethod): Promise<DirectSettings> {
  if (method === 'serial') {
    const port = await nav.serial.requestPort();
    const info = port.getInfo?.() ?? {};
    return saveDirectSettings({ method, label: info.usbVendorId ? `USB serial ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : 'Serial / Bluetooth port' });
  }
  const dev = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] }).catch(() => nav.usb.requestDevice({ filters: [] }));
  return saveDirectSettings({ method, label: dev.productName || 'USB printer' });
}

async function sendSerial(bytes: Uint8Array) {
  const ports = await nav.serial.getPorts();
  const port = ports[0];
  if (!port) throw new Error('The printer is not connected to this computer any more. Choose it again in Settings.');
  if (!port.writable) await port.open({ baudRate: 9600 });
  const w = port.writable.getWriter();
  try { await w.write(bytes); } finally { w.releaseLock(); }
}

async function sendUsb(bytes: Uint8Array) {
  const devs = await nav.usb.getDevices();
  const dev = devs[0];
  if (!dev) throw new Error('The printer is not connected to this computer any more. Choose it again in Settings.');
  if (!dev.opened) await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  const iface = dev.configuration.interfaces.find((i: any) => i.alternates.some((a: any) => a.interfaceClass === 7))
    ?? dev.configuration.interfaces[0];
  if (!iface.claimed) await dev.claimInterface(iface.interfaceNumber);
  const alt = iface.alternates.find((a: any) => a.interfaceClass === 7) ?? iface.alternates[0];
  const ep = alt.endpoints.find((e: any) => e.direction === 'out');
  if (!ep) throw new Error('This USB device has no printer output.');
  for (let i = 0; i < bytes.length; i += 4096) await dev.transferOut(ep.endpointNumber, bytes.slice(i, i + 4096));
}

async function send(bytes: Uint8Array) {
  const s = getDirectSettings();
  if (s.method === 'serial' && serialSupported()) return sendSerial(bytes);
  if (s.method === 'usb' && usbSupported()) return sendUsb(bytes);
  throw new Error('No direct printer is set up in this browser.');
}

const cols = (paper?: string | null): PaperCols => ((getDirectSettings().paper ?? (paper === '58' ? '58' : '80')) === '58' ? 32 : 48);
const directOn = () => { const s = getDirectSettings(); return !!s.method && directSupported(); };

export type Outcome = { via: 'direct' } | { via: 'dialog'; reason?: string };

export async function printBillDirect(d: BillData, layout: any): Promise<Outcome> {
  if (directOn()) {
    try { await send(billEscPos(d, layout, { cols: cols(d.restaurant.paper) })); return { via: 'direct' }; }
    catch (e: any) { printBillHtml(renderBillHtml(d, layout)); return { via: 'dialog', reason: e?.message }; }
  }
  printBillHtml(renderBillHtml(d, layout));
  return { via: 'dialog' };
}

export async function printKotDirect(k: Parameters<typeof renderKotHtml>[0], opts: { silentFallback?: boolean } = {}): Promise<Outcome> {
  if (directOn()) {
    try { await send(kotEscPos({ ...k, cols: cols(k.paper) })); return { via: 'direct' }; }
    catch (e: any) { if (!opts.silentFallback) printBillHtml(renderKotHtml(k)); return { via: 'dialog', reason: e?.message }; }
  }
  if (!opts.silentFallback) printBillHtml(renderKotHtml(k));
  return { via: 'dialog' };
}

export async function printTestDirect(restaurantName: string) {
  await send(testPageEscPos(restaurantName, cols(null)));
}
