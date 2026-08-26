/** "Your table so far" — everything already ordered at this table, shown while
 *  the diner is still browsing.
 *
 *  Before this, prior orders were only visible by leaving the menu and opening
 *  the table bill, so people at a shared table re-ordered dishes that were
 *  already on their way. Putting it on the menu itself is the fix: it is the
 *  screen they are actually looking at.
 *
 *  Collapsed to a one-line summary by default so it never competes with the
 *  menu, and expands to the full itemisation on tap. Polls in step with the
 *  bill so a companion's order shows up without a refresh. */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTableBill } from '../lib/api';
import type { Session } from '../lib/types';
import { inr } from '../lib/types';

interface Row { who: string; total: number; items: string; mine: boolean }

export function TableSoFar({ session }: { session: Session }) {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (session.table.is_parcel || session.demo) return;
    let alive = true;
    const load = () =>
      fetchTableBill(session)
        .then((b) => {
          if (!alive) return;
          const myPhone = (session.guest?.phone ?? '').trim();
          setRows(
            (b.orders ?? []).map((o) => ({
              who: o.diner_name || 'Guest',
              total: Number(o.total || 0),
              items: (o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', '),
              mine: !!myPhone && (o.diner_phone ?? '') === myPhone,
            })),
          );
          setTotal(Number(b.combined?.total ?? 0));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [session.table.id, session.guest?.phone]);

  if (!rows.length) return null;

  const dishes = rows.reduce((a, r) => a + r.items.split(', ').filter(Boolean).length, 0);

  return (
    <div className="table-so-far-strip glass">
      <button
        className="tsf-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ minWidth: 0 }}>
          <span className="overline" style={{ color: 'var(--primary)' }}>
            Already ordered at this table
          </span>
          <span className="tsf-sum">
            {dishes} dish{dishes === 1 ? '' : 'es'} · {inr(total)}
          </span>
        </span>
        <span className="tsf-toggle" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="tsf-body">
          {rows.map((r, i) => (
            <div key={i} className="tsf-row">
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>
                  {r.who}{r.mine ? ' (you)' : ''}
                </strong>
                <span className="tsf-items">{r.items}</span>
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>{inr(r.total)}</span>
            </div>
          ))}
          <button className="btn btn-ghost btn-block" style={{ marginTop: 10, padding: '9px 12px', fontSize: 13.5 }}
            onClick={() => nav('/bill')}>
            View the full bill
          </button>
        </div>
      )}
    </div>
  );
}
