/**
 * THE BILL AND THE QR CARD, AS ONE TEMPLATE FOR BOTH SURFACES.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  MIRRORED FILE. The byte-identical twin lives at
 *      menutha-app-deploy/apps/web/src/lib/billTemplate.ts
 *  If you change one, change the other, and DIFF THEM -- the two live in
 *  separate repositories, so no CI job can see both and nothing will catch a
 *  drift for you. (An earlier version of this note claimed a
 *  `npm run check:template` script did. It does not exist and never did.)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. His acceptance bar is that the bill and the table QR card
 * have "the IDENTICAL design on web app and mobile app -- same template, same
 * output, no divergence". They did not. There were FOUR renderings of the
 * bill between the two surfaces:
 *
 *   1. web  Billing.tsx        JSX, a narrow centred receipt with a logo
 *   2. app  invoice.ts         HTML, a wide A4 GST invoice with a table
 *   3. app  BillSettings       React Native views, the on-screen preview
 *   4. app  invoice.ts sample  a fourth arrangement again, for the sample
 *
 * They disagreed about the header, the item table, whether the logo appeared
 * at all, and where the totals sat. A diner handed a bill printed from the
 * counter PC and one printed from the phone was looking at two products.
 *
 * The fix is not "make them look similar", it is to have ONE renderer. Both
 * surfaces already print through HTML -- the web through the browser's print
 * dialog, the phone through expo-print, which takes an HTML string -- so a
 * plain function returning a document is genuinely shareable between them.
 * That is the whole trick, and it is why this file imports NOTHING: no React,
 * no react-native, no expo. Anything it touched would stop it being portable,
 * and portability is the entire point.
 *
 * PRINT CSS, NOT SCREEN CSS. Sizes are in points and pt is a real unit on
 * paper. @page size:auto means the sheet is whatever the printer says it is,
 * so one document covers A4, a 100x150 label and an 80mm roll -- the same
 * reasoning already proven on the QR cards.
 */

/* ── Layout spec ─────────────────────────────────────────────────────────── */

export type Align = 'left' | 'center' | 'right';

export type SectionKey =
  | 'name' | 'address' | 'ids' | 'meta' | 'items' | 'totals' | 'thanks' | 'terms' | 'footer';

/**
 * WHERE A BLOCK SITS ON THE PAGE, as opposed to where its text sits in its own
 * box. `align` was the only control and it could only ever centre a small
 * receipt in the middle of a big sheet; a real restaurant bill uses the whole
 * page, with the thank-you and the small print down at the foot.
 *
 * Three bands rather than free placement, deliberately. An owner arranging a
 * bill wants "put the terms at the bottom", not a coordinate system, and three
 * bands is the whole of what a printed bill has ever needed: what identifies
 * the restaurant, what was eaten, and what is said afterwards.
 */
export type Place = 'top' | 'middle' | 'bottom';

export type SectionStyle = { align: Align; size: number; place: Place };

export type BillLayout = {
  logo: { show: boolean; source: 'profile' | 'custom'; url: string | null };
  /**
   * STRETCH TO THE FOOT OF THE PAGE. On paper with a height -- A4, Letter, a
   * billing machine's sheet -- the document fills it: the middle band takes up
   * the slack so the bottom band lands on the bottom margin instead of the
   * bill trailing off a third of the way down a mostly-empty sheet.
   *
   * Ignored on a roll, and that is not a compromise: continuous stock has no
   * page height to fill, and stretching to a notional one would feed blank
   * paper out of a thermal printer after every bill.
   */
  fill: boolean;
  sections: Record<SectionKey, SectionStyle>;
};

/** The order the editor lists them in, and the order they appear on paper.
 *  Exported so neither surface has to keep its own copy of the list -- a
 *  second list is a second thing to forget to update. */
export const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'name',    label: 'Restaurant name', hint: 'The big line at the top' },
  { key: 'address', label: 'Address',         hint: 'Street, city, phone' },
  { key: 'ids',     label: 'GSTIN & FSSAI',   hint: 'Your licence numbers' },
  { key: 'meta',    label: 'Bill details',    hint: 'Bill number, date, table' },
  { key: 'items',   label: 'Items',           hint: 'The dishes and their prices' },
  { key: 'totals',  label: 'Totals & tax',    hint: 'Subtotal, GST, total' },
  { key: 'thanks',  label: 'Thank-you line',  hint: 'Your closing message' },
  { key: 'terms',   label: 'Terms',           hint: 'Small print at the foot' },
  { key: 'footer',  label: 'Footer',          hint: 'SAC and the Menutha line' },
];

/** THE HOUSE LAYOUT. A restaurant that never opens the editor gets this, and
 *  it is deliberately the arrangement the printed bill already had -- a
 *  centred head over left-aligned items with the totals to the right -- so
 *  turning the feature on changes nothing until somebody changes something. */
export const DEFAULT_LAYOUT: BillLayout = {
  logo: { show: true, source: 'profile', url: null },
  // ON by default, because "cover the page like a real restaurant bill" is what
  // a bill is expected to look like, not an option somebody has to discover.
  fill: true,
  sections: {
    name:    { align: 'center', size: 20, place: 'top' },
    address: { align: 'center', size: 12, place: 'top' },
    ids:     { align: 'center', size: 11, place: 'top' },
    meta:    { align: 'left',   size: 12, place: 'top' },
    items:   { align: 'left',   size: 13, place: 'top' },
    totals:  { align: 'right',  size: 13, place: 'top' },
    // The closing lines go to the FOOT of the page, which is where a printed
    // restaurant bill has always put them and what makes the sheet read as
    // full rather than abandoned halfway down.
    thanks:  { align: 'center', size: 13, place: 'bottom' },
    terms:   { align: 'left',   size: 11, place: 'bottom' },
    footer:  { align: 'center', size: 10, place: 'bottom' },
  },
};

export const MIN_SIZE = 8;
export const MAX_SIZE = 28;

const ALIGNS: Align[] = ['left', 'center', 'right'];
export const PLACES: Place[] = ['top', 'middle', 'bottom'];

/**
 * EVERY READ GOES THROUGH HERE. bill_layout is jsonb, which means the database
 * cannot constrain it: a hand-edited row, a half-written document from an older
 * app, or simply null because the migration has not been run yet all arrive at
 * the same function. So this fills every missing field from the defaults and
 * throws away anything outside the allowed set, and the renderer below can then
 * assume a complete, valid spec rather than guarding every property.
 *
 * Never throws. A bill that prints in the house layout is recoverable; a bill
 * that fails to print because a JSON key was misspelt is not, and it fails at
 * the till with a diner waiting.
 */
export function normaliseLayout(raw: any): BillLayout {
  const d = DEFAULT_LAYOUT;
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawLogo = src.logo && typeof src.logo === 'object' ? src.logo : {};
  const rawSecs = src.sections && typeof src.sections === 'object' ? src.sections : {};

  const sections = {} as Record<SectionKey, SectionStyle>;
  for (const { key } of SECTIONS) {
    const s = rawSecs[key] && typeof rawSecs[key] === 'object' ? rawSecs[key] : {};
    const align: Align = ALIGNS.indexOf(s.align) >= 0 ? s.align : d.sections[key].align;
    const n = Number(s.size);
    const size = Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n))) : d.sections[key].size;
    const place: Place = PLACES.indexOf(s.place) >= 0 ? s.place : d.sections[key].place;
    sections[key] = { align, size, place };
  }

  return {
    logo: {
      show: typeof rawLogo.show === 'boolean' ? rawLogo.show : d.logo.show,
      source: rawLogo.source === 'custom' ? 'custom' : 'profile',
      url: typeof rawLogo.url === 'string' && rawLogo.url ? rawLogo.url : null,
    },
    fill: typeof src.fill === 'boolean' ? src.fill : d.fill,
    sections,
  };
}

/** Which image the bill should actually use, given the layout and the
 *  restaurant's own logo. Returns null when the logo is off or when the chosen
 *  source has nothing in it -- the renderer then prints no image rather than a
 *  broken one, which is the difference between a plain bill and a bill with a
 *  torn box on it. */
export function billLogoUrl(layout: BillLayout, profileLogoUrl: string | null | undefined): string | null {
  if (!layout.logo.show) return null;
  if (layout.logo.source === 'custom') return layout.logo.url || null;
  return profileLogoUrl || null;
}

/* ── Data the template renders ───────────────────────────────────────────── */

export type BillItem = { name: string; qty: number; unit_price: number; note?: string | null };

export type BillData = {
  restaurant: {
    name: string; address: string; city: string; phone: string;
    gstin: string; fssai: string; thanks: string; terms: string;
    logoUrl: string | null;
  };
  billNo: string;
  dateText: string;
  tableText: string;
  customer: { name: string; phone: string };
  items: BillItem[];
  subtotal: number;
  discount: number;
  packing: number;
  service: number;
  sgstPct: number; cgstPct: number;
  sgst: number; cgst: number;
  total: number;
  /** A data: URI for the scan-to-pay QR, or null. Passed in rather than
   *  generated here: the two surfaces have different QR libraries and this
   *  file is deliberately dependency-free. */
  payQrDataUri: string | null;
  upiVpa: string | null;
  /**
   * SERVICE CHARGE WAIVED ON THIS BILL. Diners ask, and in India a service
   * charge is not a tax -- it is discretionary, and the till has always been
   * able to drop it. What it must never do is disappear silently: a bill that
   * simply omits the line looks, to a customer who asked for it to go, like
   * the request was ignored. So a waived charge PRINTS, as "Waived", and the
   * gesture is on the paper.
   *
   * The money is not computed here. `service` and the tax figures arrive
   * already correct from whoever built this data -- the server reprices the
   * orders -- because a template that recalculated tax would be a second
   * opinion about what somebody owes.
   */
  serviceWaived?: boolean;
};

/* ── Rendering ───────────────────────────────────────────────────────────── */

/** Rupees, Indian digit grouping, always two decimals. One definition, so the
 *  two surfaces cannot round a bill differently. */
export function inr(n: number): string {
  return '₹' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** Everything interpolated into the document is restaurant-entered text --
 *  a name, an address, a thank-you line, a dish. A stray `<` in any of them
 *  would silently eat the rest of the bill, and an owner who pastes markup
 *  into their terms box should get their markup printed, not executed. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const sec = (l: BillLayout, k: SectionKey) =>
  `text-align:${l.sections[k].align};font-size:${l.sections[k].size}pt`;

export const SAC = '996331';

/**
 * The bill. One document, printed by the browser on the counter PC and by
 * expo-print on the phone, from the same string.
 *
 * Widths are in millimetres against `@page size:auto`, so the same document
 * lays out on A4 and on an 80mm roll. The item table collapses to two columns
 * under 80mm because five columns of a GST table on a thermal roll is four
 * characters per column.
 */
export function renderBillHtml(d: BillData, layoutRaw: any): string {
  const l = normaliseLayout(layoutRaw);
  const logo = billLogoUrl(l, d.restaurant.logoUrl);

  const rows = d.items.map((it) => `
    <tr>
      <td class="i-name">${esc(it.name)}${it.note ? `<div class="i-note">${esc(it.note)}</div>` : ''}</td>
      <td class="i-qty">${esc(it.qty)}</td>
      <td class="i-rate">${inr(it.unit_price)}</td>
      <td class="i-amt">${inr(it.unit_price * it.qty)}</td>
    </tr>`).join('');

  const serviceRow = d.serviceWaived
    ? `<div class="row"><span>Service charge</span><span>Waived</span></div>`
    : d.service > 0
      ? `<div class="row"><span>Service charge</span><span>${inr(d.service)}</span></div>`
      : '';

  const idLines = [
    d.restaurant.gstin ? `GSTIN: ${esc(d.restaurant.gstin)}` : '',
    d.restaurant.fssai ? `FSSAI: ${esc(d.restaurant.fssai)}` : '',
  ].filter(Boolean).join('<br>');

  const addrLines = [
    [d.restaurant.address, d.restaurant.city].filter(Boolean).map(esc).join(', '),
    d.restaurant.phone ? `Ph: ${esc(d.restaurant.phone)}` : '',
  ].filter(Boolean).join('<br>');

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  /* size:auto -- the sheet is whatever paper the printer actually has. Asking
     the owner to declare it first, in our words, before the print dialog asks
     in the platform's, is a question we have no business asking; answering it
     wrong prints a ruined sheet. Same reasoning as the QR cards. */
  @page { size: auto; margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; color: #1C1A15; background: #fff;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { width: 100%; max-width: 190mm; margin: 0 auto; }
  .logo { display: block; max-height: 22mm; max-width: 60%; object-fit: contain; margin: 0 auto 3mm; }
  .name    { ${sec(l, 'name')}; font-weight: 800; margin: 0 0 1mm; line-height: 1.15; }
  .address { ${sec(l, 'address')}; color: #4A453B; margin: 0 0 1mm; line-height: 1.45; }
  .ids     { ${sec(l, 'ids')}; color: #4A453B; margin: 0 0 2mm; line-height: 1.45; }
  .rule    { border: 0; border-top: 1px solid #D8D0C0; margin: 3mm 0; }
  .meta    { ${sec(l, 'meta')}; color: #4A453B; margin: 0 0 2mm; line-height: 1.5; }
  .meta b  { color: #1C1A15; }
  table.items { width: 100%; border-collapse: collapse; ${sec(l, 'items')}; }
  table.items th {
    text-align: left; font-size: 0.82em; text-transform: uppercase; letter-spacing: .04em;
    color: #6B6557; border-bottom: 1px solid #D8D0C0; padding: 1.6mm 1mm;
  }
  table.items td { padding: 1.6mm 1mm; border-bottom: 1px solid #EFE8DA; vertical-align: top; }
  .i-note { font-size: 0.8em; color: #8A8475; }
  .i-qty  { text-align: center; white-space: nowrap; }
  .i-rate, .i-amt { text-align: right; white-space: nowrap; }
  .totals { ${sec(l, 'totals')}; margin: 3mm 0 0; margin-left: auto; width: 72mm; max-width: 100%; }
  .totals .row { display: flex; justify-content: space-between; gap: 6mm; padding: 0.9mm 0; }
  /* THE TAX TOTAL, said once as a number of its own. SGST and CGST are halves
     of one tax and a customer checking a bill against what they were told
     should not have to add them up; an auditor reading it should not have to
     either. */
  .totals .taxtotal { border-top: 1px dotted #D8D0C0; margin-top: 0.8mm; padding-top: 1.2mm; font-weight: 700; }
  .totals .grand {
    font-weight: 800; font-size: 1.22em; border-top: 1.5px solid #1C1A15;
    margin-top: 1.4mm; padding-top: 1.6mm;
  }
  .pay { display: flex; gap: 4mm; align-items: center; margin-top: 4mm; }
  .pay img { width: 28mm; height: 28mm; border: 1px solid #D8D0C0; border-radius: 2mm; }
  .pay div { font-size: 10pt; line-height: 1.5; }
  .thanks { ${sec(l, 'thanks')}; font-weight: 700; margin: 4mm 0 0; }
  .terms  { ${sec(l, 'terms')}; color: #4A453B; white-space: pre-wrap; margin: 3mm 0 0;
            border-top: 1px solid #EFE8DA; padding-top: 2mm; }
  .footer { ${sec(l, 'footer')}; color: #8A8475; margin: 4mm 0 0; }

  /* FILL THE SHEET. The bill is a column the height of the page: what
     identifies the restaurant and what was eaten at the top, the closing lines
     at the foot, and a middle band that takes up whatever slack is left. That
     band is the whole mechanism -- without it a short bill is a small block
     stranded a third of the way down an otherwise blank page, which is what a
     billing machine's output is never allowed to look like.

     100vh in paged media is the page area inside the @page margin, so this
     fills A4, Letter and a billing machine's own sheet without being told
     which it got. Content taller than one page simply paginates and the
     bottom band lands after it, which is correct: a three-page bill's footer
     belongs on page three. */
  .sheet.fill { min-height: 100vh; display: flex; flex-direction: column; }
  .sheet.fill .band-mid { flex: 1 1 auto; }

  /* A THERMAL ROLL IS NOT A SMALL A4. Under 80mm the rate and quantity columns

     have about four characters each, so they fold into the item cell and the
     totals block stops floating to the side and takes the full width. */
  @media print and (max-width: 80mm) {
    .sheet { max-width: 100%; }
    .i-rate { display: none; }
    .totals { width: 100%; }
    .pay img { width: 22mm; height: 22mm; }
    /* No page to fill. Roll stock is continuous, so stretching to a notional
       page height would feed blank paper after every bill. */
    .sheet.fill { min-height: 0; display: block; }
  }
</style></head><body>${(() => {
  /**
   * EACH SECTION BUILT ONCE, THEN PUT WHERE THE OWNER ASKED FOR IT.
   *
   * The markup used to be one flat list in a fixed order, so "where does this
   * block sit" had no answer other than "wherever it was written". Building a
   * map first means placement is a lookup rather than a rewrite, and the order
   * WITHIN a band stays the order in SECTIONS -- an owner moving the terms to
   * the foot does not also reshuffle everything around them.
   */
  const html: Record<SectionKey, string> = {
    name:    `<div class="name">${esc(d.restaurant.name)}</div>`,
    address: addrLines ? `<div class="address">${addrLines}</div>` : '',
    ids:     idLines ? `<div class="ids">${idLines}</div>` : '',
    meta:    `<hr class="rule">
  <div class="meta">
    <b>TAX INVOICE — ${esc(d.billNo)}</b><br>
    ${esc(d.dateText)} · ${esc(d.tableText)}${
      d.customer.name && d.customer.name !== 'Guest'
        ? `<br>Bill to: ${esc(d.customer.name)}${d.customer.phone ? ` · ${esc(d.customer.phone)}` : ''}`
        : ''
    }
  </div>`,
    items:   `<table class="items">
    <thead><tr><th>Item</th><th class="i-qty">Qty</th><th class="i-rate">Rate</th><th class="i-amt">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`,
    totals:  `<div class="totals">
    <div class="row"><span>Subtotal</span><span>${inr(d.subtotal)}</span></div>
    ${d.discount > 0 ? `<div class="row"><span>Discount</span><span>− ${inr(d.discount)}</span></div>` : ''}
    ${d.packing > 0 ? `<div class="row"><span>Packing charge</span><span>${inr(d.packing)}</span></div>` : ''}
    ${serviceRow}
    <!-- The RATE on the label describes the money beside it. A bill that says
         2.5% while charging 9% is worse than one showing no rate at all. -->
    <div class="row"><span>SGST @ ${esc(d.sgstPct)}%</span><span>${inr(d.sgst)}</span></div>
    <div class="row"><span>CGST @ ${esc(d.cgstPct)}%</span><span>${inr(d.cgst)}</span></div>
    <div class="row taxtotal"><span>Total tax</span><span>${inr(d.sgst + d.cgst)}</span></div>
    <div class="row grand"><span>Total</span><span>${inr(d.total)}</span></div>
  </div>
  ${d.payQrDataUri ? `<div class="pay">
    <img src="${esc(d.payQrDataUri)}" alt="">
    <div><b>Scan to pay ${inr(d.total)}</b><br>Any UPI app · pays ${esc(d.restaurant.name)} directly${
      d.upiVpa ? `<br><span style="color:#6B6557">${esc(d.upiVpa)}</span>` : ''
    }</div>
  </div>` : ''}`,
    thanks:  d.restaurant.thanks ? `<div class="thanks">${esc(d.restaurant.thanks)}</div>` : '',
    terms:   d.restaurant.terms ? `<div class="terms">${esc(d.restaurant.terms)}</div>` : '',
    footer:  `<div class="footer">SAC ${SAC} · computer-generated GST invoice · powered by Menutha</div>`,
  };

  const band = (p: Place) => SECTIONS
    .filter((s) => l.sections[s.key].place === p)
    .map((s) => html[s.key])
    .filter(Boolean)
    .join('\n  ');

  // The logo is not a section -- it has its own switch -- and it belongs above
  // whatever the owner put first, so it rides at the head of the top band.
  const top = [logo ? `<img class="logo" src="${esc(logo)}" alt="">` : '', band('top')]
    .filter(Boolean).join('\n  ');

  return `<div class="sheet${l.fill ? ' fill' : ''}">
  <div class="band-top">${top}</div>
  <div class="band-mid">${band('middle')}</div>
  <div class="band-bot">${band('bottom')}</div>
</div>`;
})()}</body></html>`;
}



/**
 * The upi://pay deep link for a bill total. Shared, because the QR on the
 * printed bill has to encode the same thing on both surfaces -- a diner
 * scanning a bill from the counter PC and one scanning a bill from the phone
 * must be paying the same VPA the same amount with the same note, and two
 * builders is two chances for one of them to drift.
 *
 * Returns '' with no VPA, and the renderer then prints no QR block at all
 * rather than a QR that resolves to nothing.
 */
export function billUpiUri(
  vpa: string | null | undefined, restaurantName: string, amount: number, billNo: string | number,
): string {
  if (!vpa || !vpa.trim()) return '';
  const q = [
    ['pa', vpa.trim()],
    ['pn', (restaurantName || 'Restaurant').slice(0, 60)],
    ['am', Number(amount).toFixed(2)],
    ['tn', `Bill #${billNo}`],
    ['cu', 'INR'],
  ].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return 'upi://pay?' + q;
}

/**
 * An <svg> string as an inline image source. `qrcode`'s toString gives markup,
 * both surfaces have that package, and an SVG has no resolution -- the printer
 * rasterises it at whatever DPI it actually has, where a raster PNG scaled onto
 * a 40mm label at 203dpi visibly blurs. The client saw exactly that blur once.
 *
 * Percent-encoded rather than base64: btoa is not present in React Native, and
 * the print engine on both surfaces is a WebView that reads this form happily.
 */
export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}


/**
 * THE SAMPLE BILL, defined once.
 *
 * Both surfaces preview with this, so the thing he looks at while dragging an
 * alignment control on the phone is the same bill he looks at on the laptop.
 * A preview built from its own invented order on each surface would agree
 * right up until one of them was edited, which is the day it matters.
 *
 * It says SAMPLE in the bill number on purpose: a page that looks exactly
 * like a tax invoice and is not one has no business being indistinguishable
 * from the real thing.
 */
export function sampleBillData(r: {
  name?: string | null; address?: string | null; city?: string | null; phone?: string | null;
  gstin?: string | null; fssai_no?: string | null; bill_thanks?: string | null;
  bill_terms?: string | null; logo_url?: string | null; upi_vpa?: string | null;
  sgst_pct?: number | string | null; cgst_pct?: number | string | null;
  service_charge_pct?: number | string | null;
}): BillData {
  const items: BillItem[] = [
    { name: 'Paneer Butter Masala', qty: 2, unit_price: 220 },
    { name: 'Butter Naan', qty: 4, unit_price: 30 },
    { name: 'Masala Chai', qty: 2, unit_price: 40 },
  ];
  const subtotal = items.reduce((a, i) => a + i.qty * i.unit_price, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const svcPct = Number(r.service_charge_pct ?? 0) || 0;
  const sgstPct = Number(r.sgst_pct ?? 2.5) || 0;
  const cgstPct = Number(r.cgst_pct ?? 2.5) || 0;
  const service = r2((subtotal * svcPct) / 100);
  const taxable = subtotal + service;
  const sgst = r2((taxable * sgstPct) / 100);
  const cgst = r2((taxable * cgstPct) / 100);

  return {
    restaurant: {
      name: r.name || 'Your restaurant',
      address: r.address || '',
      city: r.city || '',
      phone: r.phone || '',
      gstin: r.gstin || '',
      fssai: r.fssai_no || '',
      thanks: r.bill_thanks || '',
      terms: r.bill_terms || '',
      logoUrl: r.logo_url || null,
    },
    billNo: 'SAMPLE — not a tax invoice',
    dateText: new Date().toLocaleString('en-IN'),
    tableText: 'Table 4',
    customer: { name: 'Guest', phone: '' },
    items,
    subtotal,
    discount: 0,
    packing: 0,
    service,
    sgstPct, cgstPct, sgst, cgst,
    total: r2(taxable + sgst + cgst),
    payQrDataUri: null,
    upiVpa: r.upi_vpa || null,
  };
}

/* ── The QR card ─────────────────────────────────────────────────────────── */

export type QrCardData = {
  restaurantName: string;
  tableLabel: string;
  /** The QR itself, as an <svg> string. Both surfaces can produce one -- the
   *  portal from `qrcode`, the phone from the same package -- and an SVG has no
   *  resolution, so the printer rasterises it at whatever DPI it actually has.
   *  A raster PNG scaled onto a 40mm label at 203dpi visibly blurs, and the
   *  client saw exactly that. */
  qrSvg: string;
  accent: string;
};

/** A deterministic accent per table, from a curated in-brand palette. Practical,
 *  not decorative: a printed stack of table tents is otherwise identical apart
 *  from a small label and staff have to read every one to sort them. The same
 *  label always yields the same colour, so a reprint matches the card already
 *  on the table -- and it yields the same colour on both surfaces, which it did
 *  not when each had its own list. */
const CARD_ACCENTS = ['#D97757', '#1B5E3F', '#C9A04E', '#9B4B3F', '#3E6B63', '#8A5A83'];

export function accentFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return CARD_ACCENTS[h % CARD_ACCENTS.length];
}

/** One or many cards, one sheet. Same document from the portal's print button
 *  and the phone's, so a QR card printed at the counter and one printed from
 *  the phone are the same card. */
export function renderQrSheetHtml(cards: QrCardData[]): string {
  const card = (c: QrCardData) => `
    <div class="card" style="--accent:${esc(c.accent)}">
      <div class="eyebrow">Scan · Order · Relax</div>
      <div class="house">${esc(c.restaurantName)}</div>
      <div class="table">${esc(c.tableLabel)}</div>
      <div class="well">${c.qrSvg}</div>
      <div class="cta">Point your camera here</div>
      <div class="steps">The menu opens straight away — browse, order,<br>and pay from your phone. No app to install.</div>
      <div class="foot">Powered by Menutha</div>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: auto; margin: 6mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1C1A15;
         font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* CENTRED, because a sheet of one card is the common case and it looked
     broken. Packing from the start is right when a dozen cards fill the page,
     but an owner printing ONE table's QR -- or, far more often, screenshotting
     it to send on WhatsApp, which is exactly how this reached us -- got an 88mm
     card pinned to the top-left corner of a page of white. Centring costs the
     multi-card layout nothing: a full row still fills edge to edge, and only a
     short last row moves. align-content keeps the rows stacked at the top
     rather than floating in the middle of a tall page.
     NO BACKTICKS IN HERE. This whole document is a template literal, and the
     first draft of this comment quoted two CSS keywords in backticks, which
     closed the string and took the file out with three TS1005s. */
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm;
           justify-content: center; align-content: flex-start; }
  /* ONE CARD SITS IN THE MIDDLE OF THE PAGE, both ways.
     Centring horizontally was already here and it was only half the job: a
     single card was centred across the width and pinned to the TOP, so an
     owner printing one table's QR got a card floating at the top of a page of
     white, which is what was reported. 100vh inside a print context resolves
     to the PAGE BOX -- whatever paper the dialog chose -- so this centres on
     A4, on Letter and on a 100x150 label without knowing which it is.
     Only when there is ONE card. A dozen cards must stack from the top or the
     page breaks land in the middle of a card, and a short last row floating
     mid-page is worse than a tidy grid. */
  .sheet.one { min-height: 100vh; align-content: center; align-items: center; }
  /* ONE CARD IS A FULL-PAGE POSTER, not a small code marooned in white paper.
     A table tent is read from across a table by someone holding a phone at
     arm's length, so the code wants every millimetre the paper can give it.

     THE SQUARE IS min(width, height), and that one expression is what makes
     this ratio-agnostic. In paged media vw and vh resolve to the PAGE AREA --
     the paper inside the @page margin -- so on A4 portrait the height is the
     binding constraint and on anything landscape the width is, without this
     template being told which paper it landed on. 68vh rather than 100vh
     leaves the house name above and the caption below their own room; the
     type scales with it so the card reads as one designed page rather than a
     small card blown up.

     THE RESERVE IS MEASURED, NOT CHOSEN. Everything that is not the code --
     eyebrow, name, table pill, caption, footer and the fixed mm margins
     between them -- comes to about 105mm at these type sizes with the name on
     two lines. Subtracting it from the page height before taking the square
     is what makes this safe on paper of any shape: a flat percentage of the
     height cannot work, because the text block does not shrink when the page
     does. Rendered at A4 landscape a flat 60vh overflowed by 63px and would
     have thrown the footer onto a second sheet -- a wasted page every time
     somebody prints a table tent.

     With the subtraction, A4 portrait comes out WIDTH-limited at about 174mm,
     which is the largest square the margins allow, and A4 landscape comes out
     height-limited at about 93mm and still fits. Neither case has to know
     which paper it landed on.

     Measured at US Letter: everything that is not the code comes to 99.4mm
     with the name on two lines. The reserve is 112mm, which buys a third line
     of a long restaurant name and still leaves the footer on the page.

     The SCREEN value is 12mm larger because the screen preview -- the share
     sheet, and the in-app look before anyone prints -- pays the body padding
     that  pays for on paper. Without the difference Letter overflowed by
     27px in the preview while printing perfectly, which is the kind of
     disagreement that makes an owner stop trusting the preview. */
  .sheet.one .card {
    flex: 0 0 100%; width: 100%; min-height: 100vh; padding: 6mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .sheet.one          { --qr-reserve: 112mm; }
  .sheet.one .well    { width: min(88vw, calc(100vh - var(--qr-reserve)));
                        height: min(88vw, calc(100vh - var(--qr-reserve))); }
  .sheet.one .eyebrow { font-size: 11pt; }
  .sheet.one .house   { font-size: 24pt; margin-top: 2mm; }
  .sheet.one .table   { font-size: 19pt; padding: 2mm 9mm; margin: 3mm 0 5mm; }
  .sheet.one .cta     { font-size: 15pt; margin-top: 5mm; }
  .sheet.one .steps   { font-size: 11pt; margin-top: 3mm; }
  .sheet.one .foot    { font-size: 9pt; margin-top: 5mm; }


  /* On SCREEN -- the share/preview path -- give the page a little air and stop
     it being a card marooned in a white field. Print is untouched: @page owns
     the paper margin and this block does not apply to it. */
  @media screen { body { padding: 6mm; } }
  /* That padding is charged on top of a 100vh card, so the SCREEN preview --
     the share sheet and the in-app preview, which is what most people look at
     before they ever print -- scrolled by exactly the padding and looked like
     it would spill onto a second page. Print is unaffected either way (the
     @page margin is already outside the 100vh page area), but a preview that
     disagrees with the paper is a preview nobody can trust. Measured: 1168px
     of document in an 1123px viewport, which is the 12mm to the pixel. */
  @media screen {
    .sheet.one, .sheet.one .card { min-height: calc(100vh - 12mm); }
    .sheet.one { --qr-reserve: 124mm; }
  }
  .card {
    flex: 0 0 88mm; max-width: 100%; padding: 7mm 6mm; text-align: center;
    border: 1.5px solid var(--accent); border-radius: 4mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .eyebrow { font-size: 8pt; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .house   { font-size: 15pt; font-weight: 800; margin-top: 1.5mm; }
  .table   { display: inline-block; margin: 2mm 0 3mm; padding: 1mm 4mm; border-radius: 999px;
             background: var(--accent); color: #fff; font-weight: 800; font-size: 12pt; }
  .well    { display: block; margin: 0 auto; width: 46mm; height: 46mm; }
  .well svg { width: 100%; height: 100%; display: block; }
  .cta     { font-size: 10pt; font-weight: 700; margin-top: 3mm; }
  .steps   { font-size: 8.5pt; color: #6B6557; margin-top: 1.5mm; line-height: 1.5; }
  .foot    { font-size: 7.5pt; color: #8A8475; margin-top: 3mm; }

  /* On a label roll one card fills the sheet and the prose goes: at 40mm the
     only things that survive legibly are the code and the table number. */
  @media print and (max-width: 80mm) {
    .sheet { gap: 0; }
    /* Not on a roll. Roll paper is billed by the millimetre, so neither the
       centring nor the full-page sizing applies: a "page" the printer treats
       as continuous would feed blank stock before and after the card, and a
       68vh square on an unbounded page is not a number worth computing. Every
       .sheet.one rule above is undone here -- they are more specific than the
       plain ones in this block, so they have to be named to be beaten. */
    .sheet.one { min-height: 0; align-content: flex-start; }
    .sheet.one .card { min-height: 0; padding: 2mm; display: block; }
    .sheet.one .well { width: 40mm; height: 40mm; }
    .sheet.one .house { font-size: 15pt; margin-top: 1.5mm; }
    .sheet.one .table { font-size: 12pt; padding: 1mm 4mm; margin: 2mm 0 3mm; }
    .sheet.one .cta   { font-size: 10pt; margin-top: 3mm; }
    .card { flex: 0 0 100%; border: none; padding: 2mm; }
    .eyebrow, .steps, .foot { display: none; }
    .well { width: 40mm; height: 40mm; }
  }
</style></head><body><div class="sheet${cards.length === 1 ? ' one' : ''}">${cards.map(card).join('')}</div></body></html>`;
}
