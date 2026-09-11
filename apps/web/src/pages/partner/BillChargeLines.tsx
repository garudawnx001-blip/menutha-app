/**
 * THE TAX AND CHARGE LINES ON THE BILL — the ones that are actually collected.
 *
 * ── WHAT THIS REPLACES, AND WHY ──────────────────────────────────────────
 *
 * There was already a "Custom charges" editor here, writing rows to
 * restaurant_charge. Those rows were read by order_charges(), which is a
 * DISPLAY HELPER and nothing else: reprice_order never called it, the bill
 * template never drew it, and no total ever included it. An owner who added
 * "Packing ₹20" got a row in a list and nothing anywhere else — not on the
 * total, not on the printed bill, not in reports. The feature was inert end to
 * end.
 *
 * This writes restaurant.bill_charges instead, which reprice_order walks when
 * pricing an order, so a line added here is a line the diner is charged and
 * the bill prints. That is the whole difference and it is the only reason to
 * replace rather than extend.
 *
 * ── ORDER IS THE ARITHMETIC ──────────────────────────────────────────────
 *
 * A line taken "on the running total" is computed on the subtotal plus every
 * line above it — which is how GST sits on top of a service charge in India.
 * So moving a line up or down changes the money, deliberately: the owner is
 * expressing the order of operations, not just a display preference. The
 * editor says so rather than hiding it.
 *
 * ── THE LEGACY PROMPT ────────────────────────────────────────────────────
 *
 * Existing restaurant_charge rows are shown, never imported silently. They
 * have never been charged, so adopting one is a PRICE CHANGE — the diner
 * starts paying something they did not pay yesterday. That is the owner's
 * decision to make with their eyes open, not a migration's to make for them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { updateRestaurant } from '../../lib/portalApi';
import { inr } from '../../lib/types';

export type ChargeKind = 'percent' | 'flat';
export type ChargeBase = 'food' | 'gross';

export interface ChargeLine {
  id: string;
  label: string;
  kind: ChargeKind;
  value: number;
  base: ChargeBase;
  enabled: boolean;
}

/**
 * The list an owner picks from instead of typing. Not a restriction — the
 * custom row below it takes any name — but most restaurants want one of these
 * six and should not have to know that "SGST" is spelt in capitals or that GST
 * is charged on the service charge rather than the food.
 */
const PRESETS: { key: string; label: string; kind: ChargeKind; value: number; base: ChargeBase; hint: string }[] = [
  { key: 'sgst',    label: 'SGST',           kind: 'percent', value: 2.5, base: 'gross', hint: 'State GST, on the subtotal plus other charges' },
  { key: 'cgst',    label: 'CGST',           kind: 'percent', value: 2.5, base: 'gross', hint: 'Central GST, on the subtotal plus other charges' },
  { key: 'vat',     label: 'VAT',            kind: 'percent', value: 5,   base: 'food',  hint: 'On the food subtotal' },
  { key: 'service', label: 'Service charge', kind: 'percent', value: 5,   base: 'food',  hint: 'On the food subtotal, before tax' },
  { key: 'packing', label: 'Packing',        kind: 'flat',    value: 20,  base: 'food',  hint: 'A flat amount per bill' },
  { key: 'delivery', label: 'Delivery',      kind: 'flat',    value: 30,  base: 'food',  hint: 'A flat amount per bill' },
];

const uid = () => Math.random().toString(36).slice(2, 9);

/** A worked example, so "on the running total" is a number rather than a
 *  sentence. ₹1,000 of food is round enough to do in your head. */
const SAMPLE_FOOD = 1000;

function preview(lines: ChargeLine[]): { rows: { label: string; amount: number }[]; total: number } {
  let running = SAMPLE_FOOD;
  const rows: { label: string; amount: number }[] = [];
  for (const l of lines) {
    if (!l.enabled) continue;
    const amount = l.kind === 'flat'
      ? l.value
      : Math.round((l.base === 'gross' ? running : SAMPLE_FOOD) * l.value) / 100;
    running += amount;
    rows.push({ label: l.label || 'Charge', amount });
  }
  return { rows, total: running };
}

export function BillChargeLines({ restaurantId }: { restaurantId: string }) {
  const [lines, setLines] = useState<ChargeLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [presetKey, setPresetKey] = useState('');

  useEffect(() => {
    (async () => {
      /**
       * THE LEGACY `restaurant_charge` READ IS GONE, and removing it is the
       * fix for a real double charge.
       *
       * It offered to adopt charges saved in an older screen. Adopting one
       * wrote a plain bill_charges line -- no scope, because bill_charges
       * lines have none -- so a "Parcel Charges ₹10" adopted from that list
       * then applied to EVERY bill.
       *
       * Which double-charged parcels and, worse, put a packing fee on dine-in.
       * Parcel already has a working home: restaurant.parcel_charge, applied
       * by create_order ONLY when the table is_parcel. Two paths to one fee
       * is one path too many, and the old screen's own warning ("adding this
       * would charge it twice") was a sign the design was wrong rather than
       * something to word more carefully.
       *
       * One place parcel is set now: Restaurant profile -> parcel charge.
       */
      const { data: r } = await supabase
        .from('restaurant').select('bill_charges').eq('id', restaurantId).maybeSingle();
      const raw = Array.isArray((r as any)?.bill_charges) ? (r as any).bill_charges : [];
      setLines(raw.map((l: any) => ({
        id: String(l.id ?? uid()),
        label: String(l.label ?? ''),
        kind: l.kind === 'flat' ? 'flat' : 'percent',
        value: Number(l.value) || 0,
        base: l.base === 'gross' ? 'gross' : 'food',
        enabled: l.enabled !== false,
      })));
      setLoaded(true);
    })().catch((e: any) => { setError(e?.message ?? 'Could not load your charges.'); setLoaded(true); });
  }, [restaurantId]);

  const p = useMemo(() => preview(lines), [lines]);

  const edit = (id: string, patch: Partial<ChargeLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const move = (i: number, by: number) =>
    setLines((ls) => {
      const j = i + by;
      if (j < 0 || j >= ls.length) return ls;
      const next = ls.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addPreset = () => {
    const preset = PRESETS.find((x) => x.key === presetKey);
    if (!preset) return;
    setLines((ls) => [...ls, {
      id: uid(), label: preset.label, kind: preset.kind,
      value: preset.value, base: preset.base, enabled: true,
    }]);
    setPresetKey('');
  };

  const addCustom = () =>
    setLines((ls) => [...ls, { id: uid(), label: '', kind: 'percent', value: 0, base: 'food', enabled: true }]);

  const save = async () => {
    for (const l of lines) {
      if (!l.label.trim()) { setError('Every line needs a name — it prints on the bill.'); return; }
    }
    setBusy(true); setError(''); setNote('');
    try {
      await updateRestaurant(restaurantId, {
        bill_charges: lines.map(({ id, label, kind, value, base, enabled }) => ({
          id, label: label.trim(), kind, value: Number(value) || 0, base, enabled,
        })),
      });
      setNote('Saved. New orders are priced with these lines from now on.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.');
    } finally { setBusy(false); }
  };

  if (!loaded) return <p className="dim" style={{ fontSize: 13 }}>Loading your charges…</p>;

  return (
    <div>
      <p className="dim" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Everything charged on top of the dishes. These print on the bill in this order,
        and a line set to <b>on the running total</b> is worked out on the subtotal plus
        every line above it — which is how GST sits on top of a service charge. Moving a
        line changes the total.
      </p>

      {/* THE "old charge / Add it" PANEL LIVED HERE, and its removal is the
          fix for the client's double-charged parcel.

          It listed charges from an older screen and offered to adopt them.
          Adopting wrote a plain bill_charges line, which has no scope -- so
          a "Parcel Charges ₹10" taken on from that list applied to EVERY
          bill: twice on a parcel (once from restaurant.parcel_charge at
          order time, once here) and, worse, once on every dine-in table
          that never asked for packing.

          The panel even warned that adopting a packing fee "would charge it
          twice". A warning that has to be read to avoid a billing error is
          a design fault, not a documentation one.

          Parcel has one home now: Restaurant profile -> parcel charge,
          applied by create_order only when the table is_parcel. This screen
          is for taxes and service charges. */}

      {lines.length === 0 && (
        <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
          No charges yet — the bill shows dishes and the total only. Add GST, VAT or
          anything else you charge below.
        </p>
      )}

      {lines.map((l, i) => (
        <div key={l.id} className="glass" style={{ padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="code-input" style={{ flex: '2 1 140px' }}
              placeholder="Name on the bill" value={l.label}
              onChange={(e) => edit(l.id, { label: e.target.value })}
            />
            <select className="code-input" style={{ flex: '0 1 110px' }} value={l.kind}
              onChange={(e) => edit(l.id, { kind: e.target.value as ChargeKind })}>
              <option value="percent">Percent</option>
              <option value="flat">Flat ₹</option>
            </select>
            <input
              className="code-input" style={{ flex: '0 1 90px', textAlign: 'right' }}
              inputMode="decimal" value={String(l.value)}
              onChange={(e) => edit(l.id, { value: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
            />
            {l.kind === 'percent' && (
              <select className="code-input" style={{ flex: '1 1 150px' }} value={l.base}
                onChange={(e) => edit(l.id, { base: e.target.value as ChargeBase })}>
                <option value="food">of the food subtotal</option>
                <option value="gross">of the running total</option>
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={l.enabled}
                onChange={(e) => edit(l.id, { enabled: e.target.checked })} />
              On the bill
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn btn-glass btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${l.label || 'line'} up`}>↑</button>
            <button className="btn btn-glass btn-sm" disabled={i === lines.length - 1} onClick={() => move(i, +1)} aria-label={`Move ${l.label || 'line'} down`}>↓</button>
            <button className="btn btn-glass btn-sm" style={{ color: 'var(--error)' }} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>Remove</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <select className="code-input" style={{ flex: '1 1 200px' }} value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}>
          <option value="">Add a common charge…</option>
          {PRESETS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label} — {x.kind === 'percent' ? `${x.value}%` : inr(x.value)} · {x.hint}
            </option>
          ))}
        </select>
        <button className="btn btn-glass btn-sm" disabled={!presetKey} onClick={addPreset}>Add</button>
        <button className="btn btn-glass btn-sm" onClick={addCustom}>＋ Add your own</button>
      </div>

      {/* THE PREVIEW IS THE EXPLANATION. "on the running total" is abstract
          until you watch a number change; a worked ₹1,000 bill makes the order
          of operations visible without anybody reading a sentence about it. */}
      <div className="glass" style={{ padding: 12, marginTop: 14 }}>
        <p className="overline" style={{ marginBottom: 6 }}>On a ₹1,000 bill</p>
        <div className="bill-row"><span>Food</span><span>{inr(SAMPLE_FOOD)}</span></div>
        {p.rows.map((r, i) => (
          <div key={i} className="bill-row"><span>{r.label}</span><span>{inr(r.amount)}</span></div>
        ))}
        <div className="bill-row" style={{ fontWeight: 700, borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
          <span>Total</span><span>{inr(p.total)}</span>
        </div>
      </div>

      {error && <p className="inline-error" style={{ marginTop: 10 }}>{error}</p>}
      {note && <p className="dim" style={{ fontSize: 13, marginTop: 10 }}>{note}</p>}

      <button className={`btn btn-primary${busy ? ' is-busy' : ''}`} style={{ marginTop: 12 }}
        disabled={busy} onClick={save}>
        Save charges
      </button>
    </div>
  );
}
