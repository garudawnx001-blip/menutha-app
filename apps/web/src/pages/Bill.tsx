/** The diner's own bill: what they ordered, and what it comes to.
 *
 *  Shows only what THIS person ordered. Scoping is done in the database
 *  (my_table_bill), not here: filtering a whole-table payload in the client
 *  would still have put every other diner's name, phone and total onto a
 *  stranger's device, and would still have shown a previous party's uncleared
 *  food to whoever scanned the table next.
 *
 *  NO PAYMENT ON THIS PAGE, and that is the point of it.
 *
 *  It used to carry a UPI QR, the restaurant's UPI ID as a copyable chip, and
 *  a one-tap intent button. Menutha does not take diner payments -- the
 *  restaurant collects at the counter, which is the whole "zero commission,
 *  diners always pay you directly" model -- so all of that existed to hand the
 *  diner the owner's own VPA. On the pilot restaurant that VPA is the owner's
 *  personal one, on a family member's number, and this page is reachable by
 *  anyone who scans a table. A bill is not the place to publish it.
 *
 *  So the page is what a bill is: names, items, quantities, the total. The
 *  restaurant's own billing and settlement are untouched -- the counter still
 *  prints, still settles, still shows its own QR on the PRINTED bill if the
 *  owner has configured one there. Polls every 6s. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// fetchTableBill IS USED AND WAS NEVER IMPORTED. The seating check below
// called it by name with nothing bound, so the effect threw a
// ReferenceError the moment it ran -- on the bill page of every diner who
// had ordered, which is every diner who opens it. tsc had been reporting
// this for as long as the exemption had been hiding it.
//
// The whole-table read is the right one here: this decides whether the
// SEATING is over, and a settled table ends it for everybody at it.
// fetchSessionBill answers a different question -- what this one person
// owes -- and is used below for exactly that.
import { fetchSessionBill, fetchTableBill, type SessionBill } from '../lib/api';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';
import { useT } from '../lib/i18n';
import { startPoll, type Poll } from '../lib/poll';

function TotalsBlock({ b, sgstPct, cgstPct }: {
  b: { subtotal: number; packing_charge: number; service_charge?: number; sgst_amount?: number; cgst_amount?: number; gst_amount: number; total: number };
  sgstPct?: number | null; cgstPct?: number | null;
}) {
  const t = useT();
  const hasSplit = b.sgst_amount != null || b.cgst_amount != null;
  return (
    <>
      <div className="bill-row"><span>{t('bill.subtotal')}</span><span>{inr(b.subtotal)}</span></div>
      {Number(b.packing_charge) > 0 && (
        <div className="bill-row"><span>{t('bill.packing')}</span><span>{inr(b.packing_charge)}</span></div>
      )}
      {Number(b.service_charge ?? 0) > 0 && (
        <div className="bill-row"><span>{t('bill.service')}</span><span>{inr(b.service_charge!)}</span></div>
      )}
      {hasSplit ? (
        <>
          <div className="bill-row"><span>SGST{sgstPct != null ? ` (${sgstPct}%)` : ''}</span><span>{inr(b.sgst_amount ?? 0)}</span></div>
          <div className="bill-row"><span>CGST{cgstPct != null ? ` (${cgstPct}%)` : ''}</span><span>{inr(b.cgst_amount ?? 0)}</span></div>
        </>
      ) : (
        <div className="bill-row"><span>GST</span><span>{inr(b.gst_amount)}</span></div>
      )}
      <div className="bill-row total"><span>{t('bill.total')}</span><span>{inr(b.total)}</span></div>
    </>
  );
}

export function Bill() {
  const nav = useNavigate();
  const { session, endSeating } = useStore();
  const t = useT();
  const [bill, setBill] = useState<SessionBill | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<Poll>();

  /**
   * SETTLED WHILE THEY WERE LOOKING AT THE BILL.
   *
   * Menu.tsx has polled for this since #Q and ends the seating correctly --
   * but only while the diner is ON the menu. The bill is precisely where
   * somebody sits at the end of a meal, watching for the total, which makes it
   * the likeliest screen to be open at the moment the counter marks it paid.
   * They stayed logged in and could keep ordering on a settled table.
   *
   * Same rule as the menu's, deliberately: guarded on orderedAt so a fresh
   * scan is never logged out, and a failed poll never ends a seating -- if the
   * network is down the safe answer is to leave them where they are.
   */
  useEffect(() => {
    if (!session?.orderedAt || session.demo || !session.table?.id) return;
    let alive = true;
    const check = () =>
      fetchTableBill(session)
        .then((b) => {
          if (!alive) return;
          const stillOpen =
            (b.per_person ?? []).length > 0 || Number(b.combined?.total ?? 0) > 0;
          if (!stillOpen) endSeating();
        })
        .catch(() => {});
    check();
    const t = startPoll(check, 8000);
    return () => { alive = false; t.stop(); };
    // endSeating omitted for the same reason as on the menu: the store object
    // is memoised on [session, cart], so listing it would rebuild this
    // interval on every cart keystroke.
  }, [session?.table?.id, session?.orderedAt]);

  useEffect(() => {
    if (!session) {
      // /table, not / --  is the marketing landing on the deployed site.
      // /table, not '/'. On the deployed site the site root is the MARKETING
      // landing, not this app — so sending a session-less diner there and
      // rewriting their URL to it means one reload puts them on a page with a
      // restaurant LOGIN and SIGNUP on it. #O: a diner must never see that.
      nav('/table', { replace: true });
      return;
    }
    let alive = true;
    const load = () =>
      fetchSessionBill(session)
        .then((b) => alive && (setBill(b), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    timer.current = startPoll(load, 6000);
    return () => {
      alive = false;
      timer.current?.stop();
    };
  }, [session?.table.id]);

  // A Spinner, not null: the redirect runs in an effect, after this render,
  // so null paints a blank white frame on the way to the gate.
  if (!session) return <Spinner label="…" />;
  if (!bill && !failed) return <Spinner label={t('bill.loading')} />;

  if (failed && !bill) {
    return (
      <div className="page center-fill fade-in">
        <Wordmark size={22} />
        <h1 className="display" style={{ fontSize: 26 }}>{t('bill.loadFail')}</h1>
        <p className="muted" style={{ maxWidth: 380 }}>
          {t('bill.connError')}
        </p>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>{t('common.retry')}</button>
      </div>
    );
  }

  const b = bill!;
  const empty = !b.lines.length;

  return (
    <div className="page fade-in">
      <div className="topbar">
        <button className="chip" onClick={() => nav('/menu')}>← {t('cart.back')}</button>
        <Wordmark size={20} />
      </div>

      <p className="overline" style={{ marginTop: 12 }}>
        {session.restaurant.name}{session.table.is_parcel ? '' : ` · ${session.table.label}`}
      </p>
      <h1 className="display" style={{ fontSize: 30, marginTop: 4 }}>{t('bill.title')}</h1>

      {empty ? (
        <div className="center-fill">
          <p className="muted">{t('bill.none')}</p>
          <button className="btn btn-primary" onClick={() => nav('/menu')}>{t('cart.browse')}</button>
        </div>
      ) : (
        <>
          {/* THE TABLE'S page, for this seating.
              Diners sharing a table see each other's dishes - that is what a
              shared bill is. What is deliberately absent: phone numbers, a
              per-person breakdown, and any split machinery. Those live in the
              restaurant's own views. A previous party's food cannot appear
              here at all: the session boundary moves when the table is settled
              or cleared, so a new seating starts from an empty page even while
              an older bill is still open in the back office. */}
          <p className="muted" style={{ fontSize: 13.5, margin: '16px 0 8px' }}>
            {b.totals.order_count} order{b.totals.order_count === 1 ? '' : 's'} · {t('bill.thisTable')}
          </p>

          <div className="glass" style={{ padding: 16, marginTop: 12 }}>
            <p className="overline" style={{ marginBottom: 10 }}>{t('bill.whatYouOrdered')}</p>
            {b.lines.map((it, i) => (
              <div key={i} className="bill-row" style={{ fontSize: 14 }}>
                <span style={{ minWidth: 0 }}>
                  {it.who ? <strong style={{ fontWeight: 600 }}>{it.who}</strong> : null}
                  {it.who ? ' — ' : ''}{it.qty > 1 ? `${it.qty} × ` : ''}{it.name}
                </span>
                <span>{inr(it.amount)}</span>
              </div>
            ))}
          </div>

          <div className="glass" style={{ padding: 16, marginTop: 16, borderColor: 'var(--primary)' }}>
            <p className="overline" style={{ marginBottom: 10 }}>{t('bill.tableTotal')}</p>
            <TotalsBlock b={b.totals} sgstPct={b.sgst_pct} cgstPct={b.cgst_pct} />
          </div>


          {/* One line, because there is one truth: you pay at the counter.
              This used to branch on whether a UPI QR had rendered, which is
              gone -- and "pay at the counter" was already the correct half. */}
          <p className="dim" style={{ fontSize: 12, textAlign: 'center', marginTop: 14 }}>
            {t('bill.payAtCounter')} {t('bill.updatesLive')}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('/menu')}>{t('bill.orderMore')}</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.print()}>{t('bill.save')}</button>
          </div>
        </>
      )}

    </div>
  );
}
