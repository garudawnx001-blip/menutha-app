/**
 * TAX AND DAY-END DOCUMENTS (2026-10-11), shared byte-for-byte by the portal
 * (apps/web/src/lib/taxReports.ts) and the phone (apps/mobile/src/lib/
 * taxReports.ts). Pure functions: the numbers come from the server
 * (day_end_report, staff_actions_report, gst_report); this only lays them out
 * as a CSV and as printable pages, so both surfaces emit the same files.
 *
 * The GSTR-1 CSV is working data for the owner or their CA to key in / upload
 * on the GST portal. It is not a filing and files nothing.
 */

const money = (n: unknown) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const inr = (n: unknown) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One CSV cell. Quoted, and a leading = + - @ is neutralised so a dish or a
 *  reason typed as a formula cannot run when the file is opened in Excel. */
function cell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
const row = (...xs: unknown[]) => xs.map(cell).join(',');

export type GstReport = {
  from: string; to: string; sac: string;
  invoices: { invoice_no: string; date: string; status: string; doc_title: string;
              taxable: number; sgst: number; cgst: number; total: number; paid_mode?: string | null }[];
  by_rate: { rate: number; taxable: number; sgst: number; cgst: number; invoices: number }[];
  totals: { taxable: number; sgst: number; cgst: number; total: number };
  documents: { from_no: string | null; to_no: string | null; issued: number; cancelled: number };
  credit_notes: { cn_no: string; date: string; against: string | null; amount: number;
                  taxable: number; sgst: number; cgst: number; reason: string }[];
  /** Money received in the period, by method (2026-10-12a). */
  collected_by_mode?: Record<string, number>;
};

/** GSTR-1 working file: B2CS by rate, HSN/SAC summary, documents issued,
 *  credit notes, then the invoice register. One CSV, sections headed. */
export function gstCsv(r: GstReport, restaurantName: string, gstin?: string | null): string {
  const out: string[] = [];
  out.push(row('Restaurant', restaurantName), row('GSTIN', gstin || 'not registered'),
    row('Period', `${r.from} to ${r.to}`), row('Note', 'Working data for GSTR-1. Not a filing.'), '');
  out.push(row('B2CS (sales to consumers) by rate'),
    row('Type', 'Place of supply', 'Rate %', 'Taxable value', 'CGST', 'SGST', 'Invoices'));
  for (const b of r.by_rate) {
    out.push(row('OE', 'Own state', b.rate, money(b.taxable), money(b.cgst), money(b.sgst), b.invoices));
  }
  out.push('', row('HSN / SAC summary (Table 12)'),
    row('SAC', 'Description', 'UQC', 'Total value', 'Taxable value', 'CGST', 'SGST'),
    row(r.sac, 'Restaurant service', 'OTH', money(r.totals.total), money(r.totals.taxable),
      money(r.totals.cgst), money(r.totals.sgst)));
  out.push('', row('Documents issued (Table 13)'),
    row('Nature of document', 'Sr. no. from', 'Sr. no. to', 'Total number', 'Cancelled'),
    row('Invoices for outward supply', r.documents.from_no ?? '', r.documents.to_no ?? '',
      r.documents.issued, r.documents.cancelled));
  out.push('', row('Credit notes (unregistered customers)'),
    row('Credit note', 'Date', 'Against invoice', 'Value', 'Taxable', 'CGST', 'SGST', 'Reason'));
  for (const c of r.credit_notes) {
    out.push(row(c.cn_no, c.date, c.against ?? '', money(c.amount), money(c.taxable), money(c.cgst), money(c.sgst), c.reason));
  }
  out.push('', row('Invoice register'),
    row('Invoice', 'Date', 'Document', 'Status', 'Taxable', 'CGST', 'SGST', 'Total', 'Paid by'));
  for (const i of r.invoices) {
    out.push(row(i.invoice_no, i.date, i.doc_title, i.status === 'void' ? 'cancelled' : i.status,
      money(i.taxable), money(i.cgst), money(i.sgst), money(i.total), i.status === 'paid' ? (MODE[i.paid_mode ?? ''] ?? i.paid_mode ?? '') : ''));
  }
  if (r.collected_by_mode && Object.keys(r.collected_by_mode).length) {
    out.push('', row('Money received by method (not part of GSTR-1)'), row('Method', 'Amount'));
    for (const [k, v] of Object.entries(r.collected_by_mode)) out.push(row(MODE[k] ?? k, money(v)));
  }
  return out.join('\r\n') + '\r\n';
}

export const gstCsvName = (restaurantName: string, r: Pick<GstReport, 'from' | 'to'>) =>
  `GSTR1-${restaurantName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'restaurant'}-${r.from}_to_${r.to}.csv`;

export type DayEnd = {
  day: string; bills_raised: number; first_invoice: string | null; last_invoice: string | null;
  bills_paid: number; bills_unpaid: number; unpaid_value: number;
  bills_cancelled: number; cancelled_value: number; discount_total: number;
  taxable: number; sgst: number; cgst: number;
  collected: number; collected_by_mode: Record<string, number>;
  credit_notes: number; credit_note_total: number; net_collected: number;
  /** 2026-10-12a: split payment. Absent on a database without it. */
  split_bills?: number; cash_handed_over?: number; change_given?: number; cash_in_drawer?: number;
  parts_by_mode?: Record<string, { count: number; amount: number }>;
  refunds_by_mode?: Record<string, number>;
  written_off_orders: number; written_off_value: number; written_off_by_reason: Record<string, number>;
};
export type StaffRow = {
  actor: string | null; name: string; role: string | null;
  cancels: number; cancel_value: number; discounts: number; discount_value: number;
  reprints: number; credit_notes: number; credit_value: number; service_removed: number;
};

/** Same words as lib/splitPay.ts payModeLabel. */
const MODE: Record<string, string> = { cash: 'Cash', upi_qr: 'UPI', card: 'Card', other: 'Other', gateway: 'Online', split: 'Split' };

/** A narrow page that prints on an 80mm roll and on A4 alike. */
function page(title: string, restaurantName: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: auto; margin: 6mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1C1A15; margin: 0; }
  .sheet { max-width: 120mm; margin: 0 auto; font-size: 11pt; }
  h1 { font-size: 14pt; margin: 0; text-align: center; } h2 { font-size: 11pt; margin: 4mm 0 1mm; }
  .sub { text-align: center; color: #4A453B; font-size: 9.5pt; margin: 1mm 0 3mm; }
  .r { display: flex; justify-content: space-between; gap: 4mm; padding: .7mm 0; }
  .t { border-top: 1px solid #1C1A15; font-weight: 800; margin-top: 1mm; padding-top: 1mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { text-align: left; padding: 1mm .5mm; border-bottom: 1px solid #E5DED0; }
  td.n, th.n { text-align: right; }
</style></head><body><div class="sheet">
<h1>${esc(restaurantName)}</h1><div class="sub">${esc(title)}</div>${body}
<div class="sub">Printed ${esc(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST · Menutha</div>
</div></body></html>`;
}
const line = (k: string, v: string, cls = '') => `<div class="r ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;

export function dayEndHtml(d: DayEnd, restaurantName: string): string {
  const modes = Object.entries(d.collected_by_mode ?? {})
    .map(([k, v]) => line(MODE[k] ?? k, inr(v))).join('');
  const wo = Object.entries(d.written_off_by_reason ?? {})
    .map(([k, v]) => line(`  ${k.replace('_', ' ')}`, inr(v))).join('');
  return page(`Day-end report · ${d.day}`, restaurantName, `
<h2>Bills</h2>
${line('Raised', `${d.bills_raised}${d.first_invoice ? ` (${d.first_invoice} – ${d.last_invoice})` : ''}`)}
${line('Paid', String(d.bills_paid))}
${line('Still unpaid', `${d.bills_unpaid} · ${inr(d.unpaid_value)}`)}
${line('Cancelled', `${d.bills_cancelled} · ${inr(d.cancelled_value)}`)}
${line('Discounts given', inr(d.discount_total))}
<h2>Money collected</h2>
${modes || line('Nothing collected', inr(0))}
${line('Collected', inr(d.collected), 't')}
${line('Credit notes / refunds', `${d.credit_notes} · − ${inr(d.credit_note_total)}`)}
${line('Net collected', inr(d.net_collected), 't')}
${d.split_bills != null ? line('Bills paid by split payment', String(d.split_bills)) : ''}
${d.cash_handed_over != null ? line('Cash handed over', inr(d.cash_handed_over)) : ''}
${d.change_given != null ? line('Change given back', inr(d.change_given)) : ''}
${d.cash_in_drawer != null ? line('Cash in drawer (cash in − cash refunds)', inr(d.cash_in_drawer), 't') : ''}
<h2>Tax on paid bills</h2>
${line('Taxable value', inr(d.taxable))}${line('CGST', inr(d.cgst))}${line('SGST', inr(d.sgst))}
<h2>Written off (not revenue)</h2>
${line('Orders', `${d.written_off_orders} · ${inr(d.written_off_value)}`)}${wo}`);
}

export function staffActionsHtml(rows: StaffRow[], day: string, restaurantName: string): string {
  const body = rows.length === 0
    ? '<p class="sub">No cancellations, discounts, reprints or credit notes today.</p>'
    : `<table><thead><tr><th>Staff</th><th class="n">Cancels</th><th class="n">Discounts</th><th class="n">Reprints</th><th class="n">Credit notes</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.name)}${r.role ? ` <small>(${esc(r.role)})</small>` : ''}</td>
        <td class="n">${r.cancels}${Number(r.cancel_value) ? `<br><small>${inr(r.cancel_value)}</small>` : ''}</td>
        <td class="n">${r.discounts}${Number(r.discount_value) ? `<br><small>${inr(r.discount_value)}</small>` : ''}</td>
        <td class="n">${r.reprints}</td>
        <td class="n">${r.credit_notes}${Number(r.credit_value) ? `<br><small>${inr(r.credit_value)}</small>` : ''}</td></tr>`).join('')
    }</tbody></table>`;
  return page(`Cancellations, discounts and reprints · ${day}`, restaurantName, body);
}

export function gstSummaryHtml(r: GstReport, restaurantName: string): string {
  return page(`GST summary · ${r.from} to ${r.to}`, restaurantName, `
<table><thead><tr><th>Rate</th><th class="n">Taxable</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>${
  r.by_rate.map((b) => `<tr><td>${esc(b.rate)}%</td><td class="n">${inr(b.taxable)}</td><td class="n">${inr(b.cgst)}</td><td class="n">${inr(b.sgst)}</td></tr>`).join('')
}</tbody></table>
${line('Taxable value', inr(r.totals.taxable), 't')}${line('CGST', inr(r.totals.cgst))}${line('SGST', inr(r.totals.sgst))}
${line('Invoice value', inr(r.totals.total), 't')}
<h2>Documents</h2>
${line('Invoices issued', String(r.documents.issued))}${line('Cancelled', String(r.documents.cancelled))}
${r.documents.from_no ? line('Numbers', `${r.documents.from_no} – ${r.documents.to_no}`) : ''}
<h2>Credit notes</h2>
${r.credit_notes.length ? r.credit_notes.map((c) => line(`${c.cn_no} (${c.against ?? ''})`, `− ${inr(c.amount)}`)).join('') : line('None', '')}
${r.collected_by_mode && Object.keys(r.collected_by_mode).length ? `<h2>Money received by method</h2>${
  Object.entries(r.collected_by_mode).map(([k, v]) => line(MODE[k] ?? k, inr(v))).join('')}` : ''}
<p class="sub">SAC ${esc(r.sac)} · working summary for GSTR-1 / GSTR-3B. Not a filing.</p>`);
}
