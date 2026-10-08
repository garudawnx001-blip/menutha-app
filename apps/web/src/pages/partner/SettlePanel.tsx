/**
 * TAKE PAYMENT for a raised bill: one method in one tap, or a split — between
 * methods (cash + card), equally between people, or by what each person had.
 *
 * Same layout, same words and the same arithmetic (lib/splitPay.ts, mirrored)
 * as the app's SettlePanel. The server's settle_bill is the authority: parts
 * that do not add up to the bill exactly, in paise, are refused there too.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { settleBill, type SettleResult } from '../../lib/portalApi';
import {
  PAY_MODES, checkParts, equalShares, itemShares, tendersPayload, toPaise, rupees, changeFor,
  newRequestId, personLabel, type PayMode, type PayPart,
} from '../../lib/splitPay';

interface Props {
  billId: string;
  total: number;
  /** breakdown.items of the bill: name, qty, amount_p. For "Split by items". */
  items: { name: string; qty: number; amount_p: number }[];
  disabled?: boolean;
  onSettled: (r: SettleResult) => void;
  /** Optional replacement for the network call (the offline till). */
  settle?: (billId: string, tenders: unknown[], requestId: string) => Promise<SettleResult>;
}

type Tab = PayMode | 'split';

export function SettlePanel({ billId, total, items, disabled, onSettled, settle }: Props) {
  const totalP = toPaise(total);
  const [tab, setTab] = useState<Tab>('cash');
  const [handed, setHanded] = useState('');
  const [parts, setParts] = useState<PayPart[]>([]);
  const [people, setPeople] = useState(2);
  const [byItems, setByItems] = useState(false);
  const [owner, setOwner] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* One request id per attempt to pay THIS bill, kept until the server says
     paid. A retry after a dropped connection re-sends the same id and gets the
     first answer back, so a bill can never be charged twice. */
  const reqId = useRef(newRequestId('settle'));
  useEffect(() => {
    reqId.current = newRequestId('settle');
    setParts([]); setHanded(''); setError(''); setTab('cash'); setOwner(items.map(() => -1));
  }, [billId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handedP = toPaise(handed);
  const change = handedP > 0 ? changeFor(totalP, handedP) : 0;

  const check = useMemo(() => checkParts(totalP, parts), [totalP, parts]);

  const submit = async (tenders: PayPart[]) => {
    if (busy || disabled) return;
    const c = checkParts(totalP, tenders);
    if (!c.ok && totalP > 0) { setError(c.problem); return; }
    setBusy(true); setError('');
    try {
      const r = await (settle ?? settleBill)(billId, tendersPayload(tenders), reqId.current);
      onSettled(r);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      setError(/PGRST202|could not find the function/i.test(msg)
        ? 'Split payment needs the database update for Phase 2. Nothing was charged.'
        : (msg || 'Could not settle the bill. Nothing was charged.'));
    } finally { setBusy(false); }
  };

  const single = (mode: PayMode) => submit([{
    mode, amountP: totalP, tenderedP: mode === 'cash' && handedP > 0 ? handedP : null,
  }]);

  const splitEqually = (n: number) => {
    setPeople(n); setByItems(false);
    setParts(equalShares(totalP, n).map((a, i) => ({ mode: parts[i]?.mode ?? 'cash', amountP: a, payer: parts[i]?.payer })));
  };
  const splitByItems = (n: number, own: number[]) => {
    setPeople(n); setByItems(true);
    setParts(itemShares(totalP, items, own, n).map((a, i) => ({ mode: parts[i]?.mode ?? 'cash', amountP: a, payer: parts[i]?.payer })));
  };
  const setPart = (i: number, p: Partial<PayPart>) => setParts((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const addPart = () => setParts((xs) => [...xs, { mode: 'card', amountP: Math.max(0, totalP - xs.reduce((a, x) => a + x.amountP, 0)) }]);

  const cashChips = [totalP, Math.ceil(totalP / 10000) * 10000, Math.ceil(totalP / 50000) * 50000, 200000]
    .filter((v, i, a) => v >= totalP && a.indexOf(v) === i).slice(0, 4);

  return (
    <div className="settle-panel" style={{ marginTop: 12 }}>
      <p className="overline" style={{ marginBottom: 6 }}>Take payment · {rupees(totalP)}</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist">
        {PAY_MODES.filter((m) => m.id !== 'other').map((m) => (
          <button key={m.id} role="tab" aria-selected={tab === m.id}
            className={tab === m.id ? 'chip active' : 'chip'} onClick={() => setTab(m.id)}>{m.label}</button>
        ))}
        <button role="tab" aria-selected={tab === 'split'} className={tab === 'split' ? 'chip active' : 'chip'}
          onClick={() => { setTab('split'); if (!parts.length) splitEqually(2); }}>Split payment</button>
      </div>

      {tab === 'cash' && (
        <div style={{ marginTop: 10 }}>
          <div className="bill-row">
            <span>Handed over</span>
            <input className="code-input" style={{ width: 120, padding: '6px 10px', textAlign: 'right' }}
              inputMode="decimal" placeholder={String(total)} value={handed} onChange={(e) => setHanded(e.target.value)}
              aria-label="Cash handed over" />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
            {cashChips.map((p) => (
              <button key={p} className="chip" onClick={() => setHanded(String(p / 100))}>{rupees(p)}</button>
            ))}
          </div>
          {handedP > 0 && handedP < totalP && <p className="inline-error">Handed over is less than the bill.</p>}
          {change > 0 && <div className="bill-row total"><span>Change to return</span><span>{rupees(change)}</span></div>}
          <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 8 }}
            disabled={busy || disabled || (handedP > 0 && handedP < totalP)} onClick={() => single('cash')}>
            ₹ Cash received · {rupees(totalP)}
          </button>
        </div>
      )}
      {(tab === 'upi_qr' || tab === 'card') && (
        <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 10 }}
          disabled={busy || disabled} onClick={() => single(tab)}>
          {tab === 'upi_qr' ? 'UPI received' : 'Card received'} · {rupees(totalP)}
        </button>
      )}

      {tab === 'split' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: 13 }}>Split equally</span>
            {[2, 3, 4, 5, 6].map((k) => (
              <button key={k} className={!byItems && parts.length === k ? 'chip active' : 'chip'} onClick={() => splitEqually(k)}>{k}</button>
            ))}
            {items.length > 1 && (
              <button className={byItems ? 'chip active' : 'chip'}
                onClick={() => splitByItems(Math.max(2, people), owner.length === items.length ? owner : items.map(() => -1))}>
                Split by items
              </button>
            )}
          </div>

          {byItems && (
            <div className="glass" style={{ padding: '6px 12px', marginTop: 8 }}>
              <p className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                Who had what. Tax, service and charges are shared in the same proportion. “Shared” is split equally.
              </p>
              {items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="row-item">
                  <span style={{ minWidth: 0 }}>{it.qty}× {it.name} <span className="dim">{rupees(it.amount_p)}</span></span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[-1, ...Array.from({ length: people }, (_, k) => k)].map((k) => (
                      <button key={k} className={(owner[i] ?? -1) === k ? 'chip active' : 'chip'}
                        onClick={() => { const o = [...owner]; o[i] = k; setOwner(o); splitByItems(people, o); }}>
                        {k === -1 ? 'Shared' : personLabel(k, parts[k]?.payer)}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="chip" disabled={people <= 2} onClick={() => splitByItems(people - 1, owner.map((x) => (x >= people - 1 ? -1 : x)))}>− person</button>
                <button className="chip" disabled={people >= 10} onClick={() => splitByItems(people + 1, owner)}>+ person</button>
              </div>
            </div>
          )}

          {parts.map((p, i) => (
            <div key={i} className="glass" style={{ padding: '8px 12px', marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="code-input" style={{ flex: '1 1 110px', padding: '6px 10px' }}
                  placeholder={personLabel(i)} value={p.payer ?? ''} aria-label={`Who pays part ${i + 1}`}
                  onChange={(e) => setPart(i, { payer: e.target.value })} />
                {PAY_MODES.map((m) => (
                  <button key={m.id} className={p.mode === m.id ? 'chip active' : 'chip'}
                    onClick={() => setPart(i, { mode: m.id, tenderedP: m.id === 'cash' ? p.tenderedP : null })}>{m.label}</button>
                ))}
                <input className="code-input" style={{ width: 100, padding: '6px 10px', textAlign: 'right' }}
                  inputMode="decimal" value={p.amountP ? String(p.amountP / 100) : ''} aria-label={`Amount of part ${i + 1}`}
                  onChange={(e) => setPart(i, { amountP: toPaise(e.target.value) })} />
                <button className="chip" aria-label={`Remove part ${i + 1}`} disabled={parts.length <= 1}
                  onClick={() => setParts((xs) => xs.filter((_, k) => k !== i))}>✕</button>
              </div>
              {p.mode === 'cash' && (
                <div className="bill-row" style={{ marginTop: 4 }}>
                  <span className="dim">Handed over</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {p.tenderedP && p.tenderedP > p.amountP ? <span>Change {rupees(p.tenderedP - p.amountP)}</span> : null}
                    <input className="code-input" style={{ width: 100, padding: '6px 10px', textAlign: 'right' }}
                      inputMode="decimal" placeholder="exact" value={p.tenderedP ? String(p.tenderedP / 100) : ''}
                      aria-label={`Cash handed over for part ${i + 1}`}
                      onChange={(e) => setPart(i, { tenderedP: toPaise(e.target.value) || null })} />
                  </span>
                </div>
              )}
            </div>
          ))}
          <button className="chip" style={{ marginTop: 8 }} disabled={parts.length >= 20} onClick={addPart}>+ Add part</button>

          <div className="bill-row" style={{ marginTop: 8 }}>
            <span>{check.remainingP >= 0 ? 'Still to collect' : 'Too much by'}</span>
            <span style={{ fontWeight: 700 }}>{rupees(Math.abs(check.remainingP))}</span>
          </div>
          {check.changeP > 0 && <div className="bill-row"><span>Change to return</span><span>{rupees(check.changeP)}</span></div>}
          <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 8 }}
            disabled={busy || disabled || !check.ok} onClick={() => submit(parts)}
            title={check.ok ? '' : check.problem}>
            Settle bill · {rupees(totalP)}
          </button>
          {!check.ok && parts.length > 0 && <p className="dim" style={{ fontSize: 12, marginTop: 4 }}>{check.problem}</p>}
        </div>
      )}
      {error && <p className="inline-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
