/**
 * PHASE 3: AREAS, SERVICE MODE AND DELIVERY (Bill settings).
 *
 * One place for the charges that depend on WHERE or HOW a guest is served:
 *   - Service: table service (optional voluntary service charge) or
 *     self-service (counter ordering, token number on the KOT and bill, never
 *     a service charge). Per restaurant, and per area.
 *   - Areas (AC hall, Non-AC, Rooftop, Garden...): an extra charge (% of food,
 *     ₹ per bill or ₹ per person) printed with the area's own label, and an
 *     optional price list of its own.
 *   - Delivery charge, once per delivery bill, with its own GST switch.
 * Every number is applied by the server's one bill calculation; this screen
 * only stores settings. The app has the same screen with the same words.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePartner } from './PartnerShell';

type Area = {
  id: string; name: string; service_mode: 'table' | 'self' | null; charge_kind: 'none' | 'percent' | 'per_bill' | 'per_person';
  charge_value: number; charge_label: string | null; use_price_list: boolean; is_active: boolean; sort_order: number;
};
type Tbl = { id: string; label: string; area_id: string | null; is_parcel: boolean };
type Dish = { id: string; name: string; price: number };

export const CHARGE_KIND_LABEL: Record<Area['charge_kind'], string> = {
  none: 'No extra charge',
  percent: '% of the food',
  per_bill: '₹ per bill',
  per_person: '₹ per person',
};

export function AreasSettings() {
  const { restaurant, reload } = usePartner();
  const rid = restaurant.id;
  const r: any = restaurant;
  const [areas, setAreas] = useState<Area[]>([]);
  const [tables, setTables] = useState<Tbl[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [prices, setPrices] = useState<Record<string, Record<string, string>>>({});
  const [openPrices, setOpenPrices] = useState<string | null>(null);
  const [mode, setMode] = useState<'table' | 'self'>(r.service_mode === 'self' ? 'self' : 'table');
  const [delivery, setDelivery] = useState(String(r.delivery_charge ?? 0));
  const [taxDelivery, setTaxDelivery] = useState(r.tax_delivery !== false);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [missing, setMissing] = useState(false);

  const load = async () => {
    const a = await supabase.from('dining_area').select('*').eq('restaurant_id', rid).order('sort_order').order('name');
    if (a.error) { setMissing(true); return; }
    setAreas((a.data ?? []) as Area[]);
    const t = await supabase.from('dining_table').select('id, label, area_id, is_parcel').eq('restaurant_id', rid)
      .eq('is_active', true).order('label');
    setTables(((t.data ?? []) as Tbl[]).filter((x) => !x.is_parcel));
    const d = await supabase.from('menu_item').select('id, name, price').eq('restaurant_id', rid).order('name');
    setDishes(((d.data ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, price: Number(x.price) })));
    const ids = (a.data ?? []).map((x: any) => x.id);
    if (ids.length) {
      const p = await supabase.from('menu_item_area_price').select('area_id, menu_item_id, price').in('area_id', ids);
      const m: Record<string, Record<string, string>> = {};
      for (const row of (p.data ?? []) as any[]) (m[row.area_id] ??= {})[row.menu_item_id] = String(row.price);
      setPrices(m);
    }
  };
  useEffect(() => { load(); }, [rid]);

  const flash = (s: string) => { setMsg(s); window.setTimeout(() => setMsg(''), 2200); };
  const run = async (p: PromiseLike<{ error: any }>, ok = 'Saved ✓') => {
    setErr('');
    const { error } = await p;
    if (error) { setErr(error.message); return false; }
    flash(ok); return true;
  };

  const saveRestaurant = async () => {
    const dc = Math.max(0, Math.min(100000, Number(delivery) || 0));
    if (await run(supabase.from('restaurant').update({ service_mode: mode, delivery_charge: dc, tax_delivery: taxDelivery }).eq('id', rid))) {
      setDelivery(String(dc)); reload?.();
    }
  };
  const addArea = async () => {
    const name = newName.trim();
    if (!name) { setErr('Give the area a name, e.g. AC hall.'); return; }
    if (await run(supabase.from('dining_area').insert({ restaurant_id: rid, name, sort_order: areas.length }), 'Area added ✓')) {
      setNewName(''); load();
    }
  };
  const patchArea = (id: string, p: Partial<Area>) => setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const saveArea = async (a: Area) => {
    const v = Math.max(0, Number(a.charge_value) || 0);
    if (a.charge_kind === 'percent' && v > 100) { setErr('A percentage cannot be more than 100.'); return; }
    await run(supabase.from('dining_area').update({
      name: a.name.trim(), service_mode: a.service_mode, charge_kind: a.charge_kind, charge_value: v,
      charge_label: a.charge_label?.trim() || null, use_price_list: a.use_price_list, is_active: a.is_active,
    }).eq('id', a.id));
  };
  const removeArea = async (a: Area) => {
    if (!window.confirm(`Remove the area “${a.name}”? Its tables keep working with no area.`)) return;
    if (await run(supabase.from('dining_area').delete().eq('id', a.id), 'Removed ✓')) load();
  };
  const setTableArea = async (tableId: string, areaId: string) => {
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, area_id: areaId || null } : t)));
    await run(supabase.from('dining_table').update({ area_id: areaId || null }).eq('id', tableId));
  };
  const savePrice = async (areaId: string, dishId: string, value: string) => {
    const v = value.trim();
    if (v === '') {
      await run(supabase.from('menu_item_area_price').delete().eq('area_id', areaId).eq('menu_item_id', dishId), 'Uses the menu price ✓');
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) { setErr('Enter a price in rupees, or leave it empty.'); return; }
    await run(supabase.from('menu_item_area_price').upsert({ area_id: areaId, menu_item_id: dishId, price: n }));
  };

  const byArea = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tables) if (t.area_id) m[t.area_id] = (m[t.area_id] ?? 0) + 1;
    return m;
  }, [tables]);

  if (missing) {
    return <p className="dim" style={{ fontSize: 13 }}>Areas arrive with the next server update.</p>;
  }

  return (
    <div>
      {err && <p className="field-error" role="alert">{err}</p>}
      {msg && <p className="dim" role="status" style={{ color: 'var(--primary)' }}>{msg}</p>}

      <h3 style={{ fontWeight: 700, margin: '4px 0 8px' }}>How guests are served</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label="Service">
        {(['table', 'self'] as const).map((m) => (
          <button key={m} className={`chip${mode === m ? ' chip-on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === 'table' ? 'Table service' : 'Self-service (token)'}
          </button>
        ))}
      </div>
      <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        Table service: the voluntary service charge stays off unless the guest agrees, and is removed in one tap.
        Self-service: guests order at the counter, each order gets a token number on the KOT and the bill, and
        there is never a service charge. An area below can use a different service.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 12 }}>
        <div style={{ flex: '1 1 160px' }}>
          <label className="field-label" htmlFor="ar-delivery">Delivery charge per delivery bill (₹)</label>
          <input id="ar-delivery" className="code-input" inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </div>
        <label className="row-item" style={{ flex: '1 1 200px', cursor: 'pointer', gap: 10 }}>
          <span><strong style={{ fontSize: 14 }}>GST on delivery charge</strong></span>
          <input type="checkbox" checked={taxDelivery} onChange={(e) => setTaxDelivery(e.target.checked)} style={{ width: 20, height: 20 }} />
        </label>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={saveRestaurant}>Save service and delivery</button>

      <h3 style={{ fontWeight: 700, margin: '20px 0 8px' }}>Areas</h3>
      <p className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        AC hall, Non-AC, Rooftop, Garden… Give an area an extra charge or its own prices, then choose the area of
        each table below. The charge prints on the bill with the area’s name.
      </p>
      {areas.map((a) => (
        <div key={a.id} className="glass" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ flex: '2 1 160px' }}>
              <label className="field-label">Area name</label>
              <input className="code-input" value={a.name} maxLength={40} onChange={(e) => patchArea(a.id, { name: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Service</label>
              <select className="code-input" value={a.service_mode ?? ''} onChange={(e) => patchArea(a.id, { service_mode: (e.target.value || null) as Area['service_mode'] })}>
                <option value="">Same as restaurant</option>
                <option value="table">Table service</option>
                <option value="self">Self-service (token)</option>
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Extra charge</label>
              <select className="code-input" value={a.charge_kind} onChange={(e) => patchArea(a.id, { charge_kind: e.target.value as Area['charge_kind'] })}>
                {Object.entries(CHARGE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {a.charge_kind !== 'none' && (
              <>
                <div style={{ flex: '1 1 90px' }}>
                  <label className="field-label">{a.charge_kind === 'percent' ? '%' : '₹'}</label>
                  <input className="code-input" inputMode="decimal" value={String(a.charge_value)} onChange={(e) => patchArea(a.id, { charge_value: e.target.value as any })} />
                </div>
                <div style={{ flex: '2 1 160px' }}>
                  <label className="field-label">Printed as</label>
                  <input className="code-input" placeholder={`${a.name} charge`} value={a.charge_label ?? ''} maxLength={40}
                    onChange={(e) => patchArea(a.id, { charge_label: e.target.value })} />
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={a.use_price_list} onChange={(e) => patchArea(a.id, { use_price_list: e.target.checked })} />
              Own price list
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={a.is_active} onChange={(e) => patchArea(a.id, { is_active: e.target.checked })} />
              In use
            </label>
            <span className="dim" style={{ fontSize: 12 }}>{byArea[a.id] ?? 0} table(s)</span>
            <span style={{ flex: 1 }} />
            {a.use_price_list && (
              <button className="chip" onClick={() => setOpenPrices(openPrices === a.id ? null : a.id)}>
                {openPrices === a.id ? 'Hide prices' : 'Set prices'}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => saveArea(a)}>Save area</button>
            <button className="chip" onClick={() => removeArea(a)}>Remove</button>
          </div>
          {a.use_price_list && openPrices === a.id && (
            <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto' }}>
              <p className="dim" style={{ fontSize: 12 }}>Leave a price empty to use the normal menu price. Saved when you leave the box.</p>
              {dishes.map((d) => (
                <div key={d.id} className="row-item" style={{ gap: 10 }}>
                  <span style={{ flex: 1 }}>{d.name} <span className="dim">· menu ₹{d.price}</span></span>
                  <input className="code-input" style={{ maxWidth: 110 }} inputMode="decimal" placeholder={String(d.price)}
                    aria-label={`${a.name} price for ${d.name}`}
                    value={prices[a.id]?.[d.id] ?? ''}
                    onChange={(e) => setPrices((p) => ({ ...p, [a.id]: { ...(p[a.id] ?? {}), [d.id]: e.target.value } }))}
                    onBlur={(e) => savePrice(a.id, d.id, e.target.value)} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="code-input" placeholder="New area, e.g. AC hall" value={newName} maxLength={40}
          onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addArea()} />
        <button className="btn btn-glass" onClick={addArea}>Add area</button>
      </div>

      {areas.length > 0 && tables.length > 0 && (
        <>
          <h3 style={{ fontWeight: 700, margin: '20px 0 8px' }}>Which area is each table in?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {tables.map((t) => (
              <label key={t.id} className="row-item" style={{ gap: 8 }}>
                <span style={{ flex: 1 }}>{t.label}</span>
                <select className="code-input" style={{ maxWidth: 140 }} value={t.area_id ?? ''} onChange={(e) => setTableArea(t.id, e.target.value)}>
                  <option value="">No area</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
