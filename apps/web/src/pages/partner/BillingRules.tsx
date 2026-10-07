/**
 * BILLING RULES (2026-10-11) — the per-restaurant switches the one server
 * calculation (bill_compute) reads. Same controls, same order and same words
 * as the phone's Bill settings → "Billing rules".
 *
 * Every default reproduces how bills were made before these existed, so a
 * restaurant that never opens this keeps billing exactly as it did. The
 * database validates what is saved (GSTIN check digit, FSSAI 14 digits,
 * known roles, only the owner changes who may cancel or discount).
 */
import React, { useEffect, useState } from 'react';
import { usePartner } from './PartnerShell';
import { updateRestaurant, fetchCategoryGst, setCategoryGst } from '../../lib/portalApi';

type Mode = '' | 'regular' | 'composition' | 'unregistered';
const ROLES = ['manager', 'waiter', 'kitchen'] as const;

function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="row-item" style={{ cursor: disabled ? 'default' : 'pointer', alignItems: 'flex-start', gap: 12 }}>
      <span style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        {hint && <span className="dim" style={{ display: 'block', fontSize: 12 }}>{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} style={{ width: 20, height: 20, flex: '0 0 auto' }}
        onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function BillingRules() {
  const { restaurant, reload, role } = usePartner();
  const r = restaurant as any;
  const isOwner = role === 'owner';
  const [f, setF] = useState(() => ({
    gst_mode: (r.gst_mode ?? '') as Mode,
    gstin: r.gstin ?? '',
    prices_include_gst: r.prices_include_gst === true,
    service_charge_auto: r.service_charge_auto === true,
    tax_service_charge: r.tax_service_charge !== false,
    tax_packing: r.tax_packing !== false,
    tax_ac_charge: r.tax_ac_charge !== false,
    tax_extra_lines: r.tax_extra_lines !== false,
    round_off_bills: r.round_off_bills === true,
    bill_header: r.bill_header ?? '',
    bill_paper: (r.bill_paper ?? '') as string,
    bill_cancel_roles: (Array.isArray(r.bill_cancel_roles) ? r.bill_cancel_roles : ['owner', 'manager']) as string[],
    bill_discount_roles: (Array.isArray(r.bill_discount_roles) ? r.bill_discount_roles : ['owner', 'manager']) as string[],
  }));
  const [cats, setCats] = useState<{ id: string; name: string; gst: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategoryGst(restaurant.id)
      .then((rows) => setCats(rows.map((c) => ({ id: c.id, name: c.name, gst: c.gst_rate == null ? '' : String(c.gst_rate) }))))
      .catch(() => setCats([]));
  }, [restaurant.id]);

  const put = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const flipRole = (k: 'bill_cancel_roles' | 'bill_discount_roles', role: string, on: boolean) =>
    put(k, Array.from(new Set(['owner', ...f[k].filter((x) => x !== role), ...(on ? [role] : [])])));
  const noTax = f.gst_mode === 'composition' || f.gst_mode === 'unregistered';

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const patch: Record<string, unknown> = {
        gst_mode: f.gst_mode || null,
        gstin: f.gstin.trim().toUpperCase() || null,
        prices_include_gst: f.prices_include_gst,
        service_charge_auto: f.service_charge_auto,
        tax_service_charge: f.tax_service_charge,
        tax_packing: f.tax_packing,
        tax_ac_charge: f.tax_ac_charge,
        tax_extra_lines: f.tax_extra_lines,
        round_off_bills: f.round_off_bills,
        bill_header: f.bill_header.trim() || null,
        bill_paper: f.bill_paper || null,
      };
      if (isOwner) {
        patch.bill_cancel_roles = f.bill_cancel_roles;
        patch.bill_discount_roles = f.bill_discount_roles;
      }
      await updateRestaurant(restaurant.id, patch as any);
      for (const c of cats ?? []) {
        const v = c.gst.trim();
        await setCategoryGst(c.id, v === '' ? null : Math.min(28, Math.max(0, Number(v) || 0)));
      }
      await reload();
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 2500);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the billing rules.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <label className="field-label" htmlFor="br-mode">GST registration</label>
      <select id="br-mode" className="code-input" value={f.gst_mode}
        onChange={(e) => put('gst_mode', e.target.value as Mode)}>
        <option value="">As set up today (Tax invoice with a GSTIN, else Bill of supply)</option>
        <option value="regular">Regular GST — Tax invoice (needs GSTIN)</option>
        <option value="composition">Composition scheme — Bill of supply, no GST</option>
        <option value="unregistered">Not registered — Bill of supply, no GST</option>
      </select>
      <label className="field-label" htmlFor="br-gstin">GSTIN</label>
      <input id="br-gstin" className="code-input" placeholder="15 characters, e.g. 29ABCDE1234F1Z5" maxLength={15}
        value={f.gstin} onChange={(e) => put('gstin', e.target.value.toUpperCase())} />
      {f.gst_mode === 'regular' && f.gstin.trim().length !== 15 && (
        <p className="field-error">Regular GST needs your 15-character GSTIN.</p>
      )}

      <div style={{ marginTop: 12 }}>
        <Toggle label="Menu prices include GST" disabled={noTax}
          hint="On: ₹105 on the menu is ₹100 + ₹5 GST and the guest pays ₹105. Off: GST is added on top (as today)."
          checked={f.prices_include_gst && !noTax} onChange={(v) => put('prices_include_gst', v)} />
        <Toggle label="Add the service charge automatically"
          hint="Off by default (consumer rules, CCPA 2022): staff add it only when the guest agrees, it prints as “voluntary”, and anyone can remove it in one tap."
          checked={f.service_charge_auto} onChange={(v) => put('service_charge_auto', v)} />
        <Toggle label="Round the total to the rupee" hint="A separate “Round off” line; the tax is never changed."
          checked={f.round_off_bills} onChange={(v) => put('round_off_bills', v)} />
      </div>

      <p className="overline" style={{ margin: '16px 0 4px' }}>Charged GST on</p>
      <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
        As set up today, all of these are inside the GST base. Ask your CA before turning any off.
      </p>
      <Toggle label="Service charge" checked={f.tax_service_charge} disabled={noTax} onChange={(v) => put('tax_service_charge', v)} />
      <Toggle label="Packing / parcel charges" checked={f.tax_packing} disabled={noTax} onChange={(v) => put('tax_packing', v)} />
      <Toggle label="AC charge" checked={f.tax_ac_charge} disabled={noTax} onChange={(v) => put('tax_ac_charge', v)} />
      <Toggle label="Other charges (corkage, cake cutting, your own lines)" checked={f.tax_extra_lines} disabled={noTax} onChange={(v) => put('tax_extra_lines', v)} />

      {cats && cats.length > 0 && !noTax && (
        <>
          <p className="overline" style={{ margin: '16px 0 4px' }}>GST rate by category</p>
          <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
            Blank = the restaurant rate above. A dish can have its own rate in Menu (edit the dish).
          </p>
          {cats.map((c, i) => (
            <div key={c.id} className="row-item">
              <span>{c.name}</span>
              <input className="code-input" style={{ width: 90, textAlign: 'right' }} inputMode="decimal" placeholder="—"
                aria-label={`GST % for ${c.name}`} value={c.gst}
                onChange={(e) => setCats((xs) => xs!.map((x, j) => (j === i ? { ...x, gst: e.target.value } : x)))} />
            </div>
          ))}
        </>
      )}

      <p className="overline" style={{ margin: '16px 0 4px' }}>The printed bill</p>
      <label className="field-label" htmlFor="br-header">Line under the name (header)</label>
      <input id="br-header" className="code-input" placeholder="Pure vegetarian · Since 1998" value={f.bill_header}
        onChange={(e) => put('bill_header', e.target.value)} />
      <label className="field-label" htmlFor="br-paper">Paper</label>
      <select id="br-paper" className="code-input" value={f.bill_paper} onChange={(e) => put('bill_paper', e.target.value)}>
        <option value="">Fit whatever the printer has (recommended)</option>
        <option value="80">80 mm roll</option>
        <option value="58">58 mm roll</option>
        <option value="a4">A4 sheet</option>
      </select>

      <p className="overline" style={{ margin: '16px 0 4px' }}>Who may…</p>
      <p className="dim" style={{ fontSize: 12, margin: '0 0 6px' }}>
        The owner always may. {isOwner ? '' : 'Only the owner can change these.'}
      </p>
      {(['bill_cancel_roles', 'bill_discount_roles'] as const).map((k) => (
        <div key={k} className="row-item" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{k === 'bill_cancel_roles' ? 'Cancel bills / write off' : 'Give discounts'}</strong>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ROLES.map((ro) => (
              <label key={ro} className={`chip${f[k].includes(ro) ? ' active' : ''}`} style={{ cursor: isOwner ? 'pointer' : 'default' }}>
                <input type="checkbox" style={{ display: 'none' }} disabled={!isOwner}
                  checked={f[k].includes(ro)} onChange={(e) => flipRole(k, ro, e.target.checked)} />
                {ro[0].toUpperCase() + ro.slice(1)}
              </label>
            ))}
          </span>
        </div>
      ))}

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}
      <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 16 }} disabled={busy} onClick={save}>
        {msg || 'Save billing rules'}
      </button>
    </div>
  );
}
