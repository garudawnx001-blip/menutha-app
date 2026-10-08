/**
 * DIRECT THERMAL PRINTING — ESC/POS bytes for the bill and the KOT, built from
 * THE SAME DATA AND LAYOUT as the HTML in billTemplate.ts: the same sections,
 * in the same bands and order, with each section's alignment from the owner's
 * bill layout, the same heading (Tax invoice / Bill of supply), the same
 * numbers from the server's breakdown, DUPLICATE on reprints.
 *
 * MIRRORED FILE: identical copy at menutha-app-deploy/apps/web/src/lib/escpos.ts
 * (the phone sends it over Bluetooth; the browser over Web Serial / WebUSB).
 *
 * What a text-mode thermal printer cannot do, and what this does instead:
 *   * no logo, no fonts: plain text; the name prints double size;
 *   * no ₹ glyph in the printer's code page: amounts print as "Rs 1,234.00";
 *   * no Indian scripts: non-Latin characters are dropped (dish names print in
 *     English). Owners who need Kannada/Hindi on paper keep system printing.
 * Widths: 58 mm roll = 32 characters, 80 mm = 48 (Font A).
 */
import {
  normaliseLayout, SECTIONS, billHeading, consolidateChargeLines, SAC, billDateText,
  type BillData, type SectionKey, type Place, type Align,
} from './billTemplate';

export type PaperCols = 32 | 48;
export const colsForPaper = (paper: string | null | undefined): PaperCols => (paper === '58' ? 32 : 48);

const ESC = 0x1b; const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN: Record<Align, number[]> = { left: [ESC, 0x61, 0], center: [ESC, 0x61, 1], right: [ESC, 0x61, 2] };
const BOLD_ON = [ESC, 0x45, 1]; const BOLD_OFF = [ESC, 0x45, 0];
const SIZE_NORMAL = [GS, 0x21, 0x00]; const SIZE_DOUBLE = [GS, 0x21, 0x11]; const SIZE_TALL = [GS, 0x21, 0x01];
const FEED = (n: number) => [ESC, 0x64, Math.max(0, Math.min(10, n))];
const CUT = [GS, 0x56, 0x42, 0x00];
const OPEN_DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa];

/** Plain printable ASCII: ₹ → "Rs", typographic marks → their ASCII cousins,
 *  anything else outside 0x20–0x7e dropped. */
export function toAscii(s: unknown): string {
  return String(s ?? '')
    .replace(/₹\s?/g, 'Rs ')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/×/g, 'x').replace(/·/g, '-').replace(/[•●]/g, '*')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7e\n]/g, '');
}
export const money = (n: number) =>
  'Rs ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Word-wrap to `w` columns. Long words are cut. */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of toAscii(text).split('\n')) {
    let line = '';
    for (const word0 of para.split(' ')) {
      let word = word0;
      while (word.length > w) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** Left text and right text on one line; the left wraps if both cannot fit. */
export function lr(left: string, right: string, w: number): string[] {
  const L = toAscii(left); const R = toAscii(right);
  if (L.length + 1 + R.length <= w) return [L + ' '.repeat(w - L.length - R.length) + R];
  const lines = wrap(L, Math.max(8, w - R.length - 1));
  const last = lines.pop() ?? '';
  if (last.length + 1 + R.length <= w) return [...lines, last + ' '.repeat(w - last.length - R.length) + R];
  return [...lines, last, ' '.repeat(Math.max(0, w - R.length)) + R];
}

class Buf {
  bytes: number[] = [...INIT];
  raw(b: number[]) { this.bytes.push(...b); return this; }
  text(s: string) { for (const ch of toAscii(s)) this.bytes.push(ch.charCodeAt(0)); return this; }
  line(s = '') { return this.text(s).raw([0x0a]); }
  lines(xs: string[]) { xs.forEach((x) => this.line(x)); return this; }
  align(a: Align) { return this.raw(ALIGN[a]); }
  rule(w: number, ch = '-') { return this.align('left').line(ch.repeat(w)); }
  done(cut = true, drawer = false) {
    this.raw(SIZE_NORMAL).raw(BOLD_OFF).raw(FEED(4));
    if (cut) this.raw(CUT);
    if (drawer) this.raw(OPEN_DRAWER);
    return new Uint8Array(this.bytes);
  }
}

/** The bill as ESC/POS bytes. `d` and `layout` are exactly what renderBillHtml
 *  takes, so the paper from the thermal printer and the PDF agree line for line. */
export function billEscPos(d: BillData, layoutRaw: any, opts: { cols?: PaperCols; openDrawer?: boolean } = {}): Uint8Array {
  const w: number = opts.cols ?? colsForPaper(d.restaurant.paper);
  const l = normaliseLayout(layoutRaw);
  const b = new Buf();
  const title = billHeading(d);
  const isSupply = /SUPPLY/.test(title);
  const untaxed = new Set((d.untaxedLabels ?? []).map((s) => s.toLowerCase()));

  const sec: Record<SectionKey, () => void> = {
    name: () => {
      b.align(l.sections.name.align).raw(BOLD_ON).raw(w >= 48 ? SIZE_DOUBLE : SIZE_TALL);
      b.lines(wrap(d.restaurant.name, w >= 48 ? Math.floor(w / 2) : w));
      b.raw(SIZE_NORMAL).raw(BOLD_OFF);
      if (d.restaurant.header?.trim()) b.lines(wrap(d.restaurant.header, w));
      if (d.restaurant.gstMode === 'composition') {
        b.lines(wrap('Composition taxable person, not eligible to collect tax on supplies', w));
      }
    },
    address: () => {
      const a = [d.restaurant.address, d.restaurant.city].filter(Boolean).join(', ');
      if (!a && !d.restaurant.phone) return;
      b.align(l.sections.address.align);
      if (a) b.lines(wrap(a, w));
      if (d.restaurant.phone) b.line(`Ph: ${d.restaurant.phone}`);
    },
    ids: () => {
      if (!d.restaurant.gstin && !d.restaurant.fssai) return;
      b.align(l.sections.ids.align);
      if (d.restaurant.gstin) b.line(`GSTIN: ${d.restaurant.gstin}`);
      if (d.restaurant.fssai) b.line(`FSSAI: ${d.restaurant.fssai}`);
    },
    meta: () => {
      b.rule(w).align(l.sections.meta.align).raw(BOLD_ON).lines(wrap(`${title} - ${d.billNo}`, w)).raw(BOLD_OFF);
      b.lines(wrap(`${d.dateText} - ${d.tableText}`, w));
      if (d.customer.name && d.customer.name !== 'Guest') {
        b.lines(wrap(`Bill to: ${d.customer.name}${d.customer.phone ? ` - ${d.customer.phone}` : ''}`, w));
      }
    },
    items: () => {
      b.rule(w).align('left');
      b.raw(BOLD_ON).lines(lr('Item', w >= 48 ? 'Qty      Rate      Amount' : 'Qty    Amount', w)).raw(BOLD_OFF);
      for (const it of d.items) {
        const amt = money(it.unit_price * it.qty).replace('Rs ', '');
        const right = w >= 48
          ? `${String(it.qty).padStart(3)} ${money(it.unit_price).replace('Rs ', '').padStart(9)} ${amt.padStart(11)}`
          : `${String(it.qty).padStart(3)} ${amt.padStart(10)}`;
        b.lines(lr(it.name, right, w));
        if (it.note) b.lines(wrap(`  ${it.note}`, w));
      }
      b.rule(w);
    },
    totals: () => {
      b.align('left');
      const row = (k: string, v: string) => b.lines(lr(k, v, w));
      row('Subtotal', money(d.subtotal));
      if (d.discount > 0) row('Discount', '- ' + money(d.discount));
      if (d.packing > 0) row('Packing charge', money(d.packing));
      if (d.serviceWaived) row('Service charge', 'Waived');
      else if (d.service > 0) row('Service charge (voluntary)', money(d.service));
      for (const c of consolidateChargeLines(d.chargeLines)) {
        row(`${c.label}${untaxed.has(c.label.toLowerCase()) ? ' (no GST)' : ''}`, money(c.amount));
      }
      const tax = d.sgst + d.cgst;
      if (d.taxable != null && !(isSupply && tax === 0)) row('Taxable value', money(d.taxable));
      if (!(tax === 0 && (isSupply || (d.docTitle && d.taxable != null)))) {
        const incl = d.pricesIncludeGst ? ' (incl.)' : '';
        if (d.taxBuckets && d.taxBuckets.length > 1) {
          for (const t of d.taxBuckets) {
            row(`SGST @ ${t.sgstPct}% on ${money(t.taxable)}${incl}`, money(t.sgst));
            row(`CGST @ ${t.cgstPct}% on ${money(t.taxable)}${incl}`, money(t.cgst));
          }
        } else {
          row(`SGST @ ${d.sgstPct}%${incl}`, money(d.sgst));
          row(`CGST @ ${d.cgstPct}%${incl}`, money(d.cgst));
        }
        row(`Total tax${incl}`, money(tax));
      }
      if (d.roundOff) row('Round off', `${d.roundOff < 0 ? '- ' : ''}${money(Math.abs(d.roundOff))}`);
      b.rule(w, '=');
      b.raw(BOLD_ON).raw(SIZE_TALL).lines(lr('TOTAL', money(d.total), w)).raw(SIZE_NORMAL).raw(BOLD_OFF);
      if (d.duplicate) b.align('center').raw(BOLD_ON).line('DUPLICATE COPY').raw(BOLD_OFF);
    },
    thanks: () => { if (d.restaurant.thanks) b.align(l.sections.thanks.align).raw(BOLD_ON).lines(wrap(d.restaurant.thanks, w)).raw(BOLD_OFF); },
    terms: () => { if (d.restaurant.terms) b.align(l.sections.terms.align).lines(wrap(d.restaurant.terms, w)); },
    footer: () => {
      const kind = /ORDER SUMMARY/.test(title) ? 'order summary, not a tax invoice' : isSupply ? 'bill of supply' : 'tax invoice';
      b.align(l.sections.footer.align)
        .lines(wrap(`SAC ${SAC} - computer-generated ${kind}${d.pricesIncludeGst ? ' - prices include GST' : ''} - powered by Menutha`, w));
    },
  };

  for (const place of ['top', 'middle', 'bottom'] as Place[]) {
    const keys = SECTIONS.filter((s) => l.sections[s.key].place === place).map((s) => s.key);
    if (place !== 'top' && keys.length) b.line();
    keys.forEach((k) => sec[k]());
  }
  return b.done(true, !!opts.openDrawer);
}

/** The KOT as ESC/POS bytes — the same fields as renderKotHtml: big order
 *  number, table, time (India), dishes and notes, no prices. */
export function kotEscPos(k: {
  restaurantName: string; orderNo: string | number; tableText: string; placedAt?: string | null;
  items: { name: string; qty: number; note?: string | null }[]; notes?: string | null;
  paper?: string | null; reprint?: boolean; cols?: PaperCols;
}): Uint8Array {
  const w: number = k.cols ?? colsForPaper(k.paper);
  const b = new Buf();
  b.align('center').line(`${k.restaurantName ? `${k.restaurantName} - ` : ''}KOT`);
  if (k.reprint) b.raw(BOLD_ON).line('REPRINT').raw(BOLD_OFF);
  b.raw(BOLD_ON).raw(SIZE_DOUBLE).line(`#${k.orderNo}`).raw(SIZE_TALL).lines(wrap(k.tableText, w)).raw(SIZE_NORMAL).raw(BOLD_OFF);
  b.line(billDateText(k.placedAt)).rule(w);
  b.align('left').raw(SIZE_TALL);
  for (const it of k.items) {
    b.raw(BOLD_ON).lines(wrap(`${it.qty} x ${it.name}`, w)).raw(BOLD_OFF);
    if (it.note) b.lines(wrap(`   ${it.note}`, w));
  }
  b.raw(SIZE_NORMAL).rule(w);
  if (k.notes) b.raw(BOLD_ON).lines(wrap(`Note: ${k.notes}`, w)).raw(BOLD_OFF);
  return b.done(true, false);
}

/** A short test page: name, width ruler, the two sizes. */
export function testPageEscPos(restaurantName: string, cols: PaperCols): Uint8Array {
  const b = new Buf();
  b.align('center').raw(BOLD_ON).raw(SIZE_DOUBLE).line('Menutha').raw(SIZE_NORMAL).raw(BOLD_OFF);
  b.lines(wrap(restaurantName || 'Test print', cols)).line(`${cols === 32 ? '58' : '80'} mm roll - ${cols} characters`);
  b.align('left').line('1234567890'.repeat(5).slice(0, cols)).rule(cols);
  b.lines(lr('Masala Dosa x2', money(180), cols)).lines(lr('TOTAL', money(189), cols));
  b.align('center').line('If this line is centred, printing works.');
  return b.done(true, false);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Bytes → base64, without Buffer/btoa (the same on the phone and the web). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b1 = bytes[i + 1]; const c = bytes[i + 2];
    const n = (a << 16) | ((b1 ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (b1 === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}
