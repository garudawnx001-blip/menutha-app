/**
 * Custom bill charges: the owner's own list.
 *
 * "Please give all the options" is not satisfiable with a fixed set of fields.
 * Restaurants charge for packing, delivery, festival surcharges, corkage,
 * cutlery -- and the next one has not been thought of yet. As rows he adds
 * them himself; as columns each one would be a migration and a deploy.
 *
 * THE AMOUNT IS NOT COMPUTED HERE. `order_charges(order_id)` decides what
 * applies to a given order and what it comes to, server-side, and both this
 * portal and the app read that. If each surface did its own arithmetic they
 * would eventually disagree, and a bill that differs between the laptop and
 * the phone destroys trust in every number on it.
 */
import React, { useEffect, useState } from 'react';
import {
  fetchCharges, saveCharge, deleteCharge,
  type RestaurantCharge, type ChargeKind, type ChargeScope,
} from '../../lib/portalApi';

/**
 * #R REMOVED THE AC SCOPES. A charge scoped to "AC tables" printed on the bill
 * under the OWNER'S OWN LABEL, so an owner typing "AC charge" put exactly that
 * in front of a diner — and the rule is that the customer never sees the word
 * AC on a bill. AC now selects which SERVICE CHARGE RATE applies (Settings has
 * two), and that prints as the ordinary "Service charge" line.
 *
 * There were no AC-scoped rows on any restaurant in production, so nothing an
 * owner made is being taken away. The migration deactivates any that appear
 * later and narrows the CHECK constraint, so the database refuses them too —
 * this list is the courtesy, the constraint is the guarantee.
 */
const SCOPES: { key: ChargeScope; label: string }[] = [
  { key: 'all', label: 'Every order' },
  { key: 'dine_in', label: 'Dine-in only' },
  { key: 'parcel', label: 'Takeaway only' },
];

const blank = { label: '', kind: 'flat' as ChargeKind, value: '', applies_to: 'all' as ChargeScope };

/** acPricing is no longer read here: it used to gate the AC scopes, and #R
 *  removed those. Kept in the signature because Settings passes it, and a
 *  churned prop is a diff nobody asked for. */
export function BillCharges({ restaurantId }: { restaurantId: string; acPricing?: boolean }) {
  const [rows, setRows] = useState<RestaurantCharge[]>([]);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => fetchCharges(restaurantId).then(setRows).catch((e) => setError(e?.message ?? 'Could not load charges.'));
  useEffect(() => { load(); }, [restaurantId]);

  const add = async () => {
    if (!draft.label.trim()) { setError('Give the charge a name — it prints on the bill.'); return; }
    setBusy(true); setError('');
    try {
      await saveCharge(restaurantId, {
        label: draft.label, kind: draft.kind,
        value: Number(draft.value) || 0, applies_to: draft.applies_to,
        sort_order: rows.length,
      });
      setDraft(blank);
      await load();
    } catch (e: any) { setError(e?.message ?? 'Could not save.'); }
    finally { setBusy(false); }
  };

  const toggle = async (c: RestaurantCharge) => {
    // Deactivating rather than deleting is the default action, because a
    // charge that stops applying should not vanish from a bill printed last
    // week. Delete stays available for one typed by mistake.
    setBusy(true);
    try { await saveCharge(restaurantId, { ...c, is_active: !c.is_active }); await load(); }
    finally { setBusy(false); }
  };

  const remove = async (c: RestaurantCharge) => {
    if (!confirm(`Delete "${c.label}"? Bills already printed are unaffected.`)) return;
    setBusy(true);
    try { await deleteCharge(c.id); await load(); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Anything you charge for beyond the dishes. Percentages are taken on the
        food subtotal, before tax.
      </p>

      {rows.map((c) => (
        <div key={c.id} className="row-item" style={{ alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, opacity: c.is_active ? 1 : 0.5 }}>
            <b>{c.label}</b>{' '}
            <span className="dim">
              {c.kind === 'flat' ? `₹${c.value}` : `${c.value}%`}
              {c.applies_to !== 'all' && ` · ${SCOPES.find((s) => s.key === c.applies_to)?.label}`}
              {!c.is_active && ' · paused'}
            </span>
          </span>
          <button className="chip" disabled={busy} onClick={() => toggle(c)}>
            {c.is_active ? 'Pause' : 'Resume'}
          </button>
          <button className="chip" disabled={busy} onClick={() => remove(c)}>Delete</button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <input className="code-input" placeholder="Packing charge" style={{ flex: '2 1 160px' }}
          value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <select className="code-input" style={{ flex: '0 0 108px' }}
          value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ChargeKind })}>
          <option value="flat">₹ flat</option>
          <option value="percent">% of food</option>
        </select>
        <input className="code-input" inputMode="decimal" placeholder="0" style={{ flex: '0 0 88px' }}
          value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
        <select className="code-input" style={{ flex: '1 1 140px' }}
          value={draft.applies_to} onChange={(e) => setDraft({ ...draft, applies_to: e.target.value as ChargeScope })}>
          {SCOPES
            // AC scopes are meaningless until AC pricing is on, and offering
            // them anyway is how someone creates a charge that silently never
            // applies and then reports it as a bug.
            .map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button className="chip" disabled={busy} onClick={add}>Add charge</button>
      </div>

      {error && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
