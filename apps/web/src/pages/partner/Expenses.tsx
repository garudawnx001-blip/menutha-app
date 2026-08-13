/** Expenses & P&L (owner; managers see it only when the owner toggles
 *  visibility on). Expense log with receipt photos, monthly P&L card,
 *  Excel + print/PDF export. */
import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchExpenses, addExpense, deleteExpense, fetchPnl, uploadImage, type Expense,
} from '../../lib/portalApi';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Spinner } from '../../components';

const CATEGORIES = ['Groceries', 'Staff salary', 'Rent', 'Gas & fuel', 'Electricity', 'Maintenance', 'Marketing', 'Other'];

export function Expenses() {
  const { restaurant, role } = usePartner();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [pnl, setPnl] = useState<{ revenue: number; expenses: number; profit: number } | null>(null);
  const [draft, setDraft] = useState({ category: CATEGORIES[0], amount: '', note: '', spent_on: new Date().toISOString().slice(0, 10), receipt_url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  const isOwner = role === 'owner';

  const load = async () => {
    try {
      const [e, p] = await Promise.all([
        fetchExpenses(restaurant.id, month),
        fetchPnl(restaurant.id, month).catch(() => null),
      ]);
      setRows(e); setPnl(p); setError('');
    } catch (e: any) { setError(e?.message ?? 'Could not load expenses.'); setRows([]); }
  };
  useEffect(() => { load(); }, [restaurant.id, month]);

  const add = async () => {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Amount must be a positive number.'); return; }
    setBusy(true); setError('');
    try {
      await addExpense(restaurant.id, {
        category: draft.category, amount, note: draft.note || undefined,
        spent_on: draft.spent_on, receipt_url: draft.receipt_url || undefined,
      });
      setDraft({ ...draft, amount: '', note: '', receipt_url: '' });
      await load();
    } catch (e: any) { setError(e?.message ?? 'Could not save the expense.'); }
    finally { setBusy(false); }
  };

  const exportExcel = () => {
    const data = [
      ['Date', 'Category', 'Amount (INR)', 'Note'],
      ...(rows ?? []).map((r) => [r.spent_on, r.category, r.amount, r.note ?? '']),
      [],
      ['Month', month],
      ['Revenue', pnl?.revenue ?? ''],
      ['Expenses', pnl?.expenses ?? ''],
      ['Profit', pnl?.profit ?? ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, month);
    XLSX.writeFile(wb, `menutha-pnl-${month}.xlsx`);
  };

  useEffect(() => {
    if (printing) {
      const t = setTimeout(() => { window.print(); setPrinting(false); }, 300);
      return () => clearTimeout(t);
    }
  }, [printing]);

  if (rows === null) return <Spinner label="Loading expenses…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Expenses & P&L</p>
          <h1 className="display" style={{ fontSize: 26 }}>
            {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="code-input" type="month" style={{ padding: '8px 12px', width: 165 }}
            value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="chip" onClick={exportExcel}>⬇ Excel</button>
          <button className="chip" onClick={() => setPrinting(true)}>🖨 PDF</button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      {pnl && (
        <div className="menu-grid" style={{ marginBottom: 14 }}>
          <div className="glass" style={{ padding: 16 }}>
            <p className="overline">Revenue (collected)</p>
            <p className="display" style={{ fontSize: 24, color: 'var(--success)' }}>{inr(pnl.revenue)}</p>
          </div>
          <div className="glass" style={{ padding: 16 }}>
            <p className="overline">Expenses</p>
            <p className="display" style={{ fontSize: 24, color: 'var(--error)' }}>{inr(pnl.expenses)}</p>
          </div>
          <div className="glass-strong" style={{ padding: 16, borderColor: pnl.profit >= 0 ? 'var(--primary)' : 'rgba(197,64,47,0.5)' }}>
            <p className="overline">Profit</p>
            <p className="display" style={{ fontSize: 24 }}>{inr(pnl.profit)}</p>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="glass" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="code-input" style={{ width: 150, padding: '10px 12px' }} value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="code-input" style={{ width: 110 }} inputMode="decimal" placeholder="₹ amount"
            value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          <input className="code-input" type="date" style={{ width: 150 }} value={draft.spent_on}
            onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })} />
          <input className="code-input" style={{ flex: 1, minWidth: 140 }} placeholder="Note (optional)"
            value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <label className="chip" style={{ cursor: 'pointer' }}>
            {draft.receipt_url ? '🧾 ✓' : '🧾 Receipt'}
            <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { setDraft({ ...draft, receipt_url: await uploadImage('receipts', f) }); }
              catch { setError('Receipt upload failed.'); }
            }} />
          </label>
          <button className="btn btn-primary" style={{ padding: '11px 16px' }} disabled={busy} onClick={add}>
            {busy ? '…' : 'Add'}
          </button>
        </div>
      )}

      <div className="glass" style={{ padding: '4px 16px' }}>
        {rows.length === 0 && <p className="muted" style={{ padding: '16px 0' }}>No expenses logged this month.</p>}
        {rows.map((r) => (
          <div key={r.id} className="row-item">
            <span>
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{r.category}</span>
              <span className="dim" style={{ fontSize: 12.5 }}> · {new Date(r.spent_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              {r.note && <span className="muted" style={{ fontSize: 13 }}> — {r.note}</span>}
              {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}> 🧾</a>}
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>{inr(r.amount)}</strong>
              {isOwner && (
                <button className="chip" onClick={async () => { if (confirm('Delete this expense?')) { await deleteExpense(r.id); load(); } }}>✕</button>
              )}
            </span>
          </div>
        ))}
      </div>

      {printing && (
        <div className="printable" style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 13 }}>
          <h2 style={{ fontFamily: 'Georgia, serif' }}>{restaurant.name} — P&L {month}</h2>
          {pnl && (
            <p style={{ margin: '8px 0' }}>
              Revenue {inr(pnl.revenue)} · Expenses {inr(pnl.expenses)} · <strong>Profit {inr(pnl.profit)}</strong>
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: '3px 0' }}>{r.spent_on}</td>
                  <td>{r.category}</td>
                  <td>{r.note ?? ''}</td>
                  <td style={{ textAlign: 'right' }}>{inr(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
