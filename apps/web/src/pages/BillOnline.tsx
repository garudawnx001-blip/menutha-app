/**
 * THE BILL ONLINE (2026-10-11) — what the "Share on WhatsApp" link opens.
 *
 * /b/<token>: the token is a random 128-bit id stored on the bill, so the link
 * is the key -- nobody can walk from one bill to another. The page shows the
 * very document the counter printed (same template, same invoice number, same
 * numbers, from public_bill on the server), a UPI pay button when the
 * restaurant has set a UPI id and the bill is unpaid, and print / save as PDF.
 * No login, no tracking, nothing paid.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { renderBillHtml, billDataFromPublic, upiPayLink, billLabel, inr } from '../lib/billTemplate';
import { printBillHtml } from '../lib/printBill';

export function BillOnline() {
  const { token } = useParams();
  const [pb, setPb] = useState<any | null | undefined>(undefined);

  useEffect(() => {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) { setPb(null); return; }
    supabase.rpc('public_bill', { p_token: token })
      .then(({ data, error }) => setPb(error ? null : (data ?? null)), () => setPb(null));
  }, [token]);

  const html = useMemo(() => (pb ? renderBillHtml(billDataFromPublic(pb), pb.restaurant?.bill_layout) : ''), [pb]);

  if (pb === undefined) return <div className="page-pad" style={{ padding: 24 }}><p className="muted">Opening the bill…</p></div>;
  if (pb === null) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
        <h1 className="display" style={{ fontSize: 22 }}>Bill not found</h1>
        <p className="muted">This link is not valid any more. Ask the restaurant to share it again.</p>
      </div>
    );
  }

  const name = pb.restaurant?.name ?? 'Restaurant';
  const upi = pb.status === 'unpaid' ? upiPayLink(pb.restaurant?.upi_vpa, name, Number(pb.total), billLabel(pb)) : '';
  const status = pb.status === 'paid' ? 'Paid' : pb.status === 'void' ? 'Cancelled' : 'Unpaid';

  return (
    <div style={{ padding: '16px 12px 40px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p className="overline" style={{ margin: 0 }}>{name}</p>
          <strong style={{ fontSize: 18 }}>{billLabel(pb)} · {inr(Number(pb.total))}</strong>
        </div>
        <span className={`chip${pb.status === 'paid' ? ' active' : ''}`} aria-label={`Bill status: ${status}`}>{status}</span>
      </div>
      {upi && (
        <a className="btn btn-primary btn-block" href={upi} style={{ marginBottom: 10, textAlign: 'center' }}>
          Pay {inr(Number(pb.total))} by UPI
        </a>
      )}
      {upi && (
        <p className="dim" style={{ fontSize: 12, margin: '0 0 10px' }}>
          Opens your UPI app with the amount filled in. The restaurant confirms the payment at the counter.
        </p>
      )}
      <iframe title="Bill" srcDoc={html} style={{ width: '100%', minHeight: 640, border: '1px solid var(--border, #ddd)', borderRadius: 12, background: '#fff' }} />
      <button className="btn btn-glass btn-block" style={{ marginTop: 10 }} onClick={() => printBillHtml(html)}>
        Print or save as PDF
      </button>
    </div>
  );
}
