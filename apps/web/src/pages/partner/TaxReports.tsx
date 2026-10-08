/**
 * TAX, DAY-END AND STAFF ACTIONS (2026-10-11) — under Reports, same blocks in
 * the same order as the phone's Reports → "Day-end and GST". Every number is
 * from the server; the documents are lib/taxReports.ts, shared with the app.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { printBillHtml } from '../../lib/printBill';
import { inr } from '../../lib/types';
import { payModeLabel } from '../../lib/splitPay';
import {
  dayEndHtml, staffActionsHtml, gstSummaryHtml, gstCsv, gstCsvName,
  type DayEnd, type StaffRow, type GstReport,
} from '../../lib/taxReports';

/** Today in India, yyyy-mm-dd, whatever this computer's clock zone is. */
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const monthStart = (d: string) => d.slice(0, 8) + '01';

function download(name: string, text: string) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

type PaidBill = { id: string; invoice_no: string | null; bill_no: number; total: number; credited: number };

export function TaxReports({ restaurantId, restaurantName, gstin }: { restaurantId: string; restaurantName: string; gstin?: string | null }) {
  const [day, setDay] = useState(istToday());
  const [from, setFrom] = useState(monthStart(istToday()));
  const [to, setTo] = useState(istToday());
  const [dayEnd, setDayEnd] = useState<DayEnd | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [gst, setGst] = useState<GstReport | null>(null);
  const [bills, setBills] = useState<PaidBill[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadDay = async () => {
    setBusy('day'); setError('');
    try {
      const [d, s] = await Promise.all([
        supabase.rpc('day_end_report', { p_restaurant_id: restaurantId, p_day: day }),
        supabase.rpc('staff_actions_report', { p_restaurant_id: restaurantId, p_day: day }),
      ]);
      if (d.error) throw d.error;
      if (s.error) throw s.error;
      setDayEnd(d.data as DayEnd); setStaff((s.data ?? []) as StaffRow[]);
      // Paid bills of the day, for credit notes.
      const startIso = new Date(`${day}T00:00:00+05:30`).toISOString();
      const endIso = new Date(`${day}T23:59:59.999+05:30`).toISOString();
      const [{ data: bs }, { data: cns }] = await Promise.all([
        supabase.from('bill').select('id, invoice_no, bill_no, total').eq('restaurant_id', restaurantId)
          .eq('status', 'paid').gte('paid_at', startIso).lte('paid_at', endIso).order('paid_at'),
        supabase.from('credit_note').select('bill_id, amount').eq('restaurant_id', restaurantId),
      ]);
      const credited = new Map<string, number>();
      for (const c of (cns ?? []) as any[]) credited.set(c.bill_id, (credited.get(c.bill_id) ?? 0) + Number(c.amount));
      setBills(((bs ?? []) as any[]).map((b) => ({ ...b, total: Number(b.total), credited: credited.get(b.id) ?? 0 })));
    } catch (e: any) {
      setError(/PGRST202|could not find the function/i.test(String(e?.message)) ? 'These reports arrive with the next database update.' : (e?.message ?? 'Could not load the day.'));
    } finally { setBusy(''); }
  };
  useEffect(() => { loadDay(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [restaurantId, day]);

  const loadGst = async () => {
    setBusy('gst'); setError('');
    try {
      const { data, error: e } = await supabase.rpc('gst_report', { p_restaurant_id: restaurantId, p_from: from, p_to: to });
      if (e) throw e;
      setGst(data as GstReport);
      return data as GstReport;
    } catch (e: any) { setError(e?.message ?? 'Could not load the GST report.'); return null; }
    finally { setBusy(''); }
  };

  const creditNote = async (b: PaidBill) => {
    const left = Math.round((b.total - b.credited) * 100) / 100;
    const amt = window.prompt(`Credit note against ${b.invoice_no ?? '#' + b.bill_no}. Amount (up to ${inr(left)}):`, String(left));
    if (amt == null) return;
    const reason = window.prompt('Reason (printed on the record):', 'Refund to guest');
    if (!reason) return;
    const mode = (window.prompt('Refunded how? cash / upi_qr / card / none', 'cash') ?? 'none').trim();
    setBusy('cn'); setError('');
    try {
      const { data, error: e } = await supabase.rpc('issue_credit_note', {
        p_bill_id: b.id, p_amount: Number(amt), p_reason: reason, p_refund_mode: mode, p_note: null,
      });
      if (e) throw e;
      window.alert(`Recorded ${(data as any)?.cn_no}. This is a record only — no money was moved by Menutha.`);
      await loadDay();
    } catch (e: any) { setError(e?.message ?? 'Could not record the credit note.'); }
    finally { setBusy(''); }
  };

  const row = (k: string, v: React.ReactNode, strong = false) => (
    <div className="bill-row" style={strong ? { fontWeight: 800 } : undefined}><span>{k}</span><span>{v}</span></div>
  );

  return (
    <div className="glass" style={{ padding: 18, marginTop: 18 }}>
      <p className="overline" style={{ marginBottom: 4 }}>Day-end and GST</p>
      <p className="dim" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
        Revenue here is money actually collected. Unpaid, cancelled and written-off bills are shown separately and never counted as sales.
      </p>
      {error && <p className="inline-error" role="alert">{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <label className="field-label" htmlFor="tx-day">Day</label>
          <input id="tx-day" type="date" className="code-input" value={day} max={istToday()} onChange={(e) => setDay(e.target.value || istToday())} />
        </div>
        <button className="btn btn-glass" disabled={!dayEnd} onClick={() => dayEnd && printBillHtml(dayEndHtml(dayEnd, restaurantName))}>Print day-end</button>
        <button className="btn btn-ghost" disabled={!staff} onClick={() => staff && printBillHtml(staffActionsHtml(staff, day, restaurantName))}>Print staff actions</button>
      </div>

      {busy === 'day' && <p className="dim" style={{ marginTop: 10 }}>Loading the day…</p>}
      {dayEnd && (
        <div style={{ marginTop: 12 }}>
          {row('Bills raised', `${dayEnd.bills_raised}${dayEnd.first_invoice ? ` (${dayEnd.first_invoice} – ${dayEnd.last_invoice})` : ''}`)}
          {row('Paid', dayEnd.bills_paid)}
          {row('Still unpaid', `${dayEnd.bills_unpaid} · ${inr(Number(dayEnd.unpaid_value))}`)}
          {row('Cancelled', `${dayEnd.bills_cancelled} · ${inr(Number(dayEnd.cancelled_value))}`)}
          {row('Discounts given', inr(Number(dayEnd.discount_total)))}
          {Object.entries(dayEnd.collected_by_mode ?? {}).map(([k, v]) => (
            <React.Fragment key={k}>{row(payModeLabel(k), inr(Number(v)))}</React.Fragment>
          ))}
          {row('Collected', inr(Number(dayEnd.collected)), true)}
          {row('Credit notes', `${dayEnd.credit_notes} · − ${inr(Number(dayEnd.credit_note_total))}`)}
          {row('Net collected', inr(Number(dayEnd.net_collected)), true)}
          {dayEnd.split_bills != null && row('Bills paid by split payment', String(dayEnd.split_bills))}
          {dayEnd.change_given != null && Number(dayEnd.change_given) > 0 && row('Change given back', inr(Number(dayEnd.change_given)))}
          {dayEnd.cash_in_drawer != null && row('Cash in drawer', inr(Number(dayEnd.cash_in_drawer)), true)}
          {row('Tax on paid bills', `CGST ${inr(Number(dayEnd.cgst))} · SGST ${inr(Number(dayEnd.sgst))}`)}
          {row('Written off (not revenue)', `${dayEnd.written_off_orders} · ${inr(Number(dayEnd.written_off_value))}`)}
        </div>
      )}

      {staff && (
        <>
          <p className="overline" style={{ margin: '16px 0 6px' }}>Cancellations, discounts and reprints by staff</p>
          {staff.length === 0 ? <p className="dim" style={{ fontSize: 13 }}>None on this day.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="report-table" style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Staff</th><th>Cancels</th><th>Discounts</th><th>Reprints</th><th>Credit notes</th></tr></thead>
                <tbody>{staff.map((s) => (
                  <tr key={s.actor ?? s.name}>
                    <td>{s.name}{s.role ? <span className="dim"> · {s.role}</span> : null}</td>
                    <td style={{ textAlign: 'center' }}>{s.cancels}{Number(s.cancel_value) ? ` (${inr(Number(s.cancel_value))})` : ''}</td>
                    <td style={{ textAlign: 'center' }}>{s.discounts}{Number(s.discount_value) ? ` (${inr(Number(s.discount_value))})` : ''}</td>
                    <td style={{ textAlign: 'center' }}>{s.reprints}</td>
                    <td style={{ textAlign: 'center' }}>{s.credit_notes}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {bills && bills.length > 0 && (
        <>
          <p className="overline" style={{ margin: '16px 0 6px' }}>Refund or credit a paid bill</p>
          <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>Records a credit note (CN/…) against the bill. No money is moved by Menutha.</p>
          {bills.map((b) => (
            <div key={b.id} className="row-item">
              <span>{b.invoice_no ?? `#${b.bill_no}`} · {inr(b.total)}{b.credited ? <span className="dim"> · credited {inr(b.credited)}</span> : null}</span>
              <button className="chip" disabled={busy === 'cn' || b.credited >= b.total} onClick={() => creditNote(b)}>Credit note</button>
            </div>
          ))}
        </>
      )}

      <p className="overline" style={{ margin: '20px 0 6px' }}>GST report (GSTR-1 working data)</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label className="field-label" htmlFor="tx-from">From</label>
          <input id="tx-from" type="date" className="code-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="tx-to">To</label>
          <input id="tx-to" type="date" className="code-input" value={to} max={istToday()} onChange={(e) => setTo(e.target.value)} /></div>
        <button className={`btn btn-glass${busy === 'gst' ? ' is-busy' : ''}`} onClick={loadGst}>Show</button>
        <button className="btn btn-glass" onClick={async () => { const r = gst && gst.from === from && gst.to === to ? gst : await loadGst(); if (r) download(gstCsvName(restaurantName, r), gstCsv(r, restaurantName, gstin)); }}>
          Download CSV
        </button>
        <button className="btn btn-ghost" disabled={!gst} onClick={() => gst && printBillHtml(gstSummaryHtml(gst, restaurantName))}>Print summary</button>
      </div>
      {gst && (
        <div style={{ marginTop: 10 }}>
          {gst.by_rate.map((b) => <React.Fragment key={b.rate}>{row(`${b.rate}% on ${inr(Number(b.taxable))}`, `CGST ${inr(Number(b.cgst))} · SGST ${inr(Number(b.sgst))}`)}</React.Fragment>)}
          {row('Invoice value', inr(Number(gst.totals.total)), true)}
          {row('Invoices issued / cancelled', `${gst.documents.issued} / ${gst.documents.cancelled}`)}
          {row('Credit notes', String(gst.credit_notes.length))}
        </div>
      )}
    </div>
  );
}
