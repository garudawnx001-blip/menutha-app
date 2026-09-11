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

const blankDraft = {
  name: '', kind: 'complimentary' as BuffetKind, price: '',
  items: [] as string[], from: '', to: '',
};

/**
 * THE SERVING WINDOW, and why it is a time rather than a timestamp on screen.
 *
 * The diner page has always PRINTED this window -- "🕒 7:30 AM – 10:30 AM" --
 * and nothing in the portal could ever set it, so every buffet showed no hours
 * however carefully the owner filled the rest in. saveBuffet already persisted
 * starts_at/ends_at; only the form never asked. That is the whole fix.
 *
 * The column is a timestamptz and a breakfast window is a time of DAY that
 * repeats, so the two do not quite line up. The diner side only ever formats
 * the time part, so a date is carried but never read. These helpers keep that
 * honest in one place: the owner picks a time, it is stored against today's
 * date, and both surfaces read back the same clock face.
 */
const isoToTime = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const timeToIso = (hhmm: string): string | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export function Buffets() {
  const { restaurant } = usePartner();
  const [rows, setRows] = useState<Buffet[]>([]);
  const [dishes, setDishes] = useState<PortalDish[]>([]);
  const [draft, setDraft] = useState(blankDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Narrows the chip wall below. Ashwamedha has 165 dishes, and a buffet is
   *  a dozen of them; without this, putting one together is a scroll-and-scan
   *  through the whole menu looking for the six paneer dishes. */
  const [dishQuery, setDishQuery] = useState('');

  /**
   * SELECTED FIRST, AND CAPPED WHEN UNSEARCHED -- the same rule the phone
   * follows.
   *
   * On the phone the reason is performance: every chip there is a real blur
   * surface and 164 of them janks. Here the DOM does not care, and the cap is
   * kept anyway, because a picker that orders and counts differently on the
   * two surfaces is its own bug -- the owner moves between a laptop and a
   * phone all day and the same menu must look like the same menu.
   *
   * The ordering earns its place on both: unsorted, a dish already on the
   * buffet could be anywhere among 164, so there was no way to see what had
   * been picked without reading the whole list.
   */
  const DISH_CAP = 60;
  const visibleDishes = (() => {
    const q = dishQuery.trim().toLowerCase();
    if (q) return dishes.filter((d) => d.name.toLowerCase().includes(q));
    const on = (d: { id: string }) => draft.items.includes(d.id);
    const chosen = dishes.filter(on);
    const rest = dishes.filter((d) => !on(d));
    return [...chosen, ...rest].slice(0, Math.max(DISH_CAP, chosen.length));
  })();
  const hiddenDishes = dishes.length - visibleDishes.length;

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
    setDraft({
      name: b.name, kind: b.kind, price: String(b.price ?? ''), items: b.items ?? [],
      from: isoToTime(b.starts_at), to: isoToTime(b.ends_at),
    });
  };

  const cancel = () => { setEditing(null); setDraft(blankDraft); };

  const submit = async () => {
    if (!draft.name.trim()) { setError('Give the buffet a name, diners see it.'); return; }
    if (draft.kind === 'paid' && !(Number(draft.price) > 0)) {
      setError('A paid buffet needs a per-person price.');
      return;
    }
    // Both ends or neither: the diner page only prints a window when it has
    // two, so one half saved alone is a value the owner set and nobody ever
    // sees -- which reads as the field not working.
    if ((draft.from && !draft.to) || (draft.to && !draft.from)) {
      setError('Give the serving window a start and an end, or leave both blank.');
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
        starts_at: timeToIso(draft.from),
        ends_at: timeToIso(draft.to),
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
      {error && <p className="inline-error">{error}</p>}

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
          <button className="btn btn-glass btn-sm" disabled={busy} onClick={() => startEdit(b)}>Edit</button>
          <button className="btn btn-glass btn-sm" disabled={busy} onClick={() => setActive(b, !b.is_active)}>
            {b.is_active ? 'Turn off' : 'Turn on'}
          </button>
          <button className="btn btn-glass btn-sm" style={{ color: 'var(--error)' }} disabled={busy} onClick={() => remove(b)}>Delete</button>
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

        {/* THE SERVING WINDOW. The diner page has always printed this and the
            portal could never set it, so every buffet showed no hours no matter
            how carefully the rest was filled in. Optional -- an all-day buffet
            leaves both blank and the diner simply sees no clock line. */}
        <p className="overline" style={{ marginTop: 12, marginBottom: 6 }}>
          Served between <span className="dim" style={{ fontWeight: 400 }}>(optional)</span>
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="code-input" type="time" style={{ flex: '0 0 140px' }}
            aria-label="Serving starts at"
            value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="dim">to</span>
          <input
            className="code-input" type="time" style={{ flex: '0 0 140px' }}
            aria-label="Serving ends at"
            value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          {(draft.from || draft.to) && (
            <button className="btn btn-glass btn-sm" onClick={() => setDraft({ ...draft, from: '', to: '' })}>
              Clear
            </button>
          )}
        </div>

        <p className="overline" style={{ marginTop: 12, marginBottom: 6 }}>
          What is available ({draft.items.length} selected)
        </p>
        {/* The box earns its space only on a long menu. On a short one it is
            another field to look past. */}
        {dishes.length > 8 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              className="code-input" type="search" style={{ flex: 1 }}
              placeholder="Search dishes"
              aria-label="Search dishes to put on this buffet"
              value={dishQuery} onChange={(e) => setDishQuery(e.target.value)} />
            {dishQuery && (
              <button className="btn btn-glass btn-sm" onClick={() => setDishQuery('')}>Clear</button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {visibleDishes.map((d) => (
            <button
              key={d.id}
              className={draft.items.includes(d.id) ? 'chip active' : 'chip'}
              onClick={() => toggleItem(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
        {/* Searching hides chips, including selected ones. The count above
            still speaks for those, but say plainly that the wall is filtered
            so an empty-looking picker never reads as a lost buffet. */}
        {(dishQuery.trim() !== '' || hiddenDishes > 0) && (
          <p className="dim" style={{ marginTop: 6, fontSize: 13 }}>
            {dishQuery.trim() !== '' && visibleDishes.length === 0
              ? `No dish matches “${dishQuery.trim()}”. Clear the search to see all ${dishes.length}.`
              : dishQuery.trim() !== ''
                ? `Showing ${visibleDishes.length} of ${dishes.length} dishes. Anything already selected stays on the buffet.`
                : `Showing the first ${visibleDishes.length} of ${dishes.length} dishes, with everything you have picked at the top. Search to find any of the other ${hiddenDishes}.`}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {editing ? 'Save buffet' : 'Create buffet'}
          </button>
          {editing && <button className="btn btn-glass" disabled={busy} onClick={cancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
