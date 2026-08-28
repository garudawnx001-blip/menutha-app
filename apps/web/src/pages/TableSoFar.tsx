/** "Already ordered" — this diner's own orders at this table.
 *
 *  Exists to stop the SAME person ordering the same dish twice, which needs
 *  their own history and nothing else. It used to list every diner at the
 *  table by name and total; that is now neither shown nor fetched.
 *
 *  Collapsed to a one-line summary by default so it never competes with the
 *  menu, and expands on tap. Polls in step with the bill. */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyBill, fetchMyOpenOrders, cancelMyOrder, type OpenOrder } from '../lib/api';
import type { Session } from '../lib/types';
import { inr } from '../lib/types';
import { useT } from '../lib/i18n';
import { SendingIn } from '../components';

interface Row { total: number; items: string }

export function TableSoFar({ session }: { session: Session }) {
  const nav = useNavigate();
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);

  // Orders of mine that have not reached the kitchen yet. These are the only
  // ones a diner may still pull back, so they get their own block above the
  // table summary rather than being buried in it.
  const [mine, setMine] = useState<OpenOrder[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    if (session.table.is_parcel || session.demo) return;
    let alive = true;
    const load = () => fetchMyOpenOrders(session).then((o) => alive && setMine(o)).catch(() => {});
    load();
    const id = setInterval(load, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [session.table.id, session.guest?.phone]);

  const editable = mine.filter((o) => o.editable);

  const cancel = async (id: string) => {
    setCancelling(id);
    try { await cancelMyOrder(id); setMine((prev) => prev.filter((o) => o.id !== id)); }
    catch { /* window closed — the next poll will show it as sent */ }
    finally { setCancelling(null); }
  };

  useEffect(() => {
    if (session.table.is_parcel || session.demo) return;
    let alive = true;
    const load = () =>
      fetchMyBill(session)
        .then((b) => {
          if (!alive) return;
          // MY orders only. This strip exists to stop the same person ordering
          // the same dish twice, which needs their own history and nothing
          // else - it used to list every diner at the table by name.
          setRows(
            (b.orders ?? []).map((o) => ({
              total: Number(o.total || 0),
              items: (o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', '),
            })),
          );
          setTotal(Number(b.mine?.total ?? 0));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [session.table.id, session.guest?.phone]);

  if (!rows.length && !editable.length) return null;

  const dishes = rows.reduce((a, r) => a + r.items.split(', ').filter(Boolean).length, 0);

  return (
    <div className="table-so-far-strip glass">
      {editable.length > 0 && (
        <div className="tsf-pending">
          {editable.map((o) => (
            <div key={o.id} className="tsf-pending-row">
              <span style={{ minWidth: 0 }}>
                <span className="overline" style={{ color: 'var(--accent)' }}>
                  <SendingIn
                    until={o.released_at}
                    label={t('menu.sendingIn')}
                    sentLabel={t('menu.withKitchen')}
                  />
                </span>
                <span className="tsf-items">
                  {(o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', ')}
                </span>
              </span>
              <button
                className="chip"
                disabled={cancelling === o.id}
                onClick={() => cancel(o.id)}
              >
                {cancelling === o.id ? '…' : t('menu.cancelOrder')}
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="tsf-head"
        aria-expanded={open}
        hidden={!rows.length}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ minWidth: 0 }}>
          <span className="overline" style={{ color: 'var(--primary)' }}>
            {t('bill.alreadyOrdered')}
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
              {/* No name on the row any more — every row here is this diner's
                  own, so labelling whose it is was only ever meaningful when
                  the strip listed the whole table. */}
              <span style={{ minWidth: 0 }}>
                <span className="tsf-items">{r.items}</span>
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' }}>{inr(r.total)}</span>
            </div>
          ))}
          <button className="btn btn-ghost btn-block" style={{ marginTop: 10, padding: '9px 12px', fontSize: 13.5 }}
            onClick={() => nav('/bill')}>
            {t('bill.viewFull')}
          </button>
        </div>
      )}
    </div>
  );
}
