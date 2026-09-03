/**
 * Buffets: the owner's side, which has never existed.
 *
 * The `buffet` table, its two kinds and its per-person price have been in the
 * schema since the beginning, and the diner app can already select one. What
 * was missing is the half where an owner CREATES one -- so the feature has been
 * unusable end to end rather than absent.
 *
 * THE TWO KINDS ARE DIFFERENT PRODUCTS, not a price toggle:
 *
 *   COMPLIMENTARY  for in-hotel guests. No price, ever. The guest sees what is
 *                  available and orders from it; nothing reaches a bill.
 *   PAID           open to anyone. A per-person amount is charged first, and
 *                  then the same availability list applies.
 *
 * Which is why price is FORCED to zero on a complimentary buffet rather than
 * merely hidden: a stale price left behind after switching kind is how an
 * in-hotel guest gets charged for the breakfast their room already covers.
 *
 * ITEMS ARE MENU IDS, not copied names, so a price or spelling fix on a dish
 * flows through, and a dish removed from the menu cannot linger on a buffet as
 * a stale string.
 */
import React, { useEffect, useState } from 'react';
import {
  fetchBuffets, saveBuffet, deleteBuffet, fetchMenuAdmin,
  type Buffet, type BuffetKind, type PortalDish,
} from '../../lib/portalApi';
import { usePartner } from './PartnerShell';
import { inr } from '../../lib/types';
import { Spinner } from '../../components';

const blankDraft = { name: '', kind: 'complimentary' as BuffetKind, price: '', items: [] as string[] };

export function Buffets() {
  const { restaurant } = usePartner();
  const [rows, setRows] = useState<Buffet[]>([]);
  const [dishes, setDishes] = useState<PortalDish[]>([]);
  const [draft, setDraft] = useState(blankDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [b, m] = await Promise.all([
        fetchBuffets(restaurant.id),
        fetchMenuAdmin(restaurant.id),
      ]);
      setRows(b);
      setDishes(m.items);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load buffets.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [restaurant.id]);

  const startEdit = (b: Buffet) => {
    setEditing(b.id);
    setDraft({ name: b.name, kind: b.kind, price: String(b.price ?? ''), items: b.items ?? [] });
  };

  const cancel = () => { setEditing(null); setDraft(blankDraft); };

  const submit = async () => {
    if (!draft.name.trim()) { setError('Give the buffet a name, diners see it.'); return; }
    if (draft.kind === 'paid' && !(Number(draft.price) > 0)) {
      setError('A paid buffet needs a per-person price.');
      return;
    }
    setBusy(true); setError('');
    try {
      await saveBuffet(restaurant.id, {
        id: editing ?? undefined,
        name: draft.name,
        kind: draft.kind,
        price: Number(draft.price) || 0,
        items: draft.items,
      });
      cancel();
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = (id: string) =>
    setDraft((d) => ({
      ...d,
      items: d.items.includes(id) ? d.items.filter((x) => x !== id) : [...d.items, id],
    }));

  const setActive = async (b: Buffet, on: boolean) => {
    setBusy(true);
    try { await saveBuffet(restaurant.id, { ...b, is_active: on }); await load(); }
    finally { setBusy(false); }
  };

  const remove = async (b: Buffet) => {
    if (!confirm(`Delete "${b.name}"?`)) return;
    setBusy(true);
    try { await deleteBuffet(b.id); await load(); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      <p className="overline" style={{ marginTop: 12 }}>Buffets</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>Buffet service</h1>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        A complimentary buffet is for in-hotel guests and never reaches a bill.
        A paid buffet charges a per-person amount, then shows the same list.
      </p>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      {rows.map((b) => (
        <div key={b.id} className="row-item" style={{ alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, opacity: b.is_active ? 1 : 0.5 }}>
            <b>{b.name}</b>{' '}
            <span className="dim">
              {b.kind === 'paid' ? `${inr(b.price)} per person` : 'Complimentary'}
              {' · '}{(b.items ?? []).length} dishes
              {!b.is_active && ' · off'}
            </span>
          </span>
          <button className="chip" disabled={busy} onClick={() => startEdit(b)}>Edit</button>
          <button className="chip" disabled={busy} onClick={() => setActive(b, !b.is_active)}>
            {b.is_active ? 'Turn off' : 'Turn on'}
          </button>
          <button className="chip" disabled={busy} onClick={() => remove(b)}>Delete</button>
        </div>
      ))}

      <div className="glass" style={{ padding: 16, marginTop: 14 }}>
        <p className="overline" style={{ marginBottom: 8 }}>
          {editing ? 'Edit buffet' : 'New buffet'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input className="code-input" placeholder="Breakfast buffet" style={{ flex: '2 1 180px' }}
            value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className="code-input" style={{ flex: '1 1 150px' }}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as BuffetKind })}>
            <option value="complimentary">Complimentary</option>
            <option value="paid">Paid, per person</option>
          </select>
          {/* Only a paid buffet has a price. Hidden rather than disabled on a
              complimentary one, because a greyed-out price box still invites
              the question of what it would do. */}
          {draft.kind === 'paid' && (
            <input className="code-input" inputMode="decimal" placeholder="Per person"
              style={{ flex: '0 0 130px' }}
              value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          )}
        </div>

        <p className="overline" style={{ marginBottom: 6 }}>
          What is available ({draft.items.length} selected)
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {dishes.map((d) => (
            <button
              key={d.id}
              className={draft.items.includes(d.id) ? 'chip active' : 'chip'}
              onClick={() => toggleItem(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {editing ? 'Save buffet' : 'Create buffet'}
          </button>
          {editing && <button className="chip" disabled={busy} onClick={cancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
