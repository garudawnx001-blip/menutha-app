/**
 * BILL SETTINGS — its own section, exactly as the phone has it.
 *
 * These controls used to live buried inside Restaurant profile, three
 * scrolls down a form about addresses and opening hours. The phone has had
 * them as their own screen since they were built, and an owner who is told
 * "change it in Bill settings" on one surface should not have to hunt for it
 * inside another page on the other. Same content, same order, same behaviour
 * as apps/mobile/src/screens/manager/BillSettingsScreen.
 *
 * THE ORDER IS THE PHONE'S ORDER: tax rates, then the charges the owner
 * invents, then the layout of the printed sheet, then the sample. It reads
 * down the page the way a bill reads down the paper.
 *
 * Each block saves itself. Taxes have a Save because they are a form; charges
 * and the layout commit as they are edited, which is why they are not inside
 * that Save -- adding a charge and then wondering whether Save was still
 * required is the confusion this separation avoids.
 */
import React, { useState } from 'react';
import { usePartner } from './PartnerShell';
import { updateRestaurant } from '../../lib/portalApi';
import { BillCharges } from './BillCharges';
import { BillLayoutEditor } from './BillLayoutEditor';

/** A labelled block, matching the phone's Section. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="glass" style={{ padding: 18, marginBottom: 16 }}>
      <p className="overline" style={{ marginBottom: hint ? 4 : 12 }}>{title}</p>
      {hint && <p className="dim" style={{ fontSize: 12.5, margin: '0 0 12px' }}>{hint}</p>}
      {children}
    </div>
  );
}

export function BillSettings() {
  const { restaurant, reload } = usePartner();
  const r = restaurant as any;

  /**
   * Percentages are held as STRINGS while they are being typed and settled on
   * save -- the rule every bounded number field in this product follows. A
   * half-typed "2." is not 0, and coercing it under the caret is what makes a
   * field feel broken.
   */
  const [form, setForm] = useState({
    sgst_pct: String(r.sgst_pct ?? 2.5),
    cgst_pct: String(r.cgst_pct ?? 2.5),
    service_charge_pct: String(r.service_charge_pct ?? 0),
    service_charge_ac_pct: r.service_charge_ac_pct == null ? '' : String(r.service_charge_ac_pct),
    fssai_no: r.fssai_no ?? '',
    bill_thanks: r.bill_thanks ?? '',
    bill_terms: r.bill_terms ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const gstTotal = (Number(form.sgst_pct) || 0) + (Number(form.cgst_pct) || 0);

  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    // Clamped once, and written BACK, so the owner sees the number that was
    // actually stored rather than the one they typed. Same rule as Settings.
    const clamped = {
      sgst_pct: Math.min(14, Math.max(0, Number(form.sgst_pct) || 0)),
      cgst_pct: Math.min(14, Math.max(0, Number(form.cgst_pct) || 0)),
      service_charge_pct: Math.min(25, Math.max(0, Number(form.service_charge_pct) || 0)),
    };
    const acRaw = form.service_charge_ac_pct.trim();
    // Blank means "same as non-AC", which is a different answer from zero.
    const acPct = acRaw === '' ? null : Math.min(25, Math.max(0, Number(acRaw) || 0));
    try {
      await updateRestaurant(restaurant.id, {
        ...clamped,
        fssai_no: form.fssai_no.trim().toUpperCase() || null,
        bill_thanks: form.bill_thanks.trim() || null,
        bill_terms: form.bill_terms.trim() || null,
      });
      // The AC rate is tolerated separately: its column may not exist yet, and
      // losing the tax rates because of that would be the wrong way round.
      try {
        await updateRestaurant(restaurant.id, { service_charge_ac_pct: acPct } as any);
      } catch (e: any) {
        if (!(e?.code === 'PGRST204' || e?.code === '42703' || /service_charge_ac_pct/.test(e?.message ?? ''))) throw e;
      }
      setForm((f) => ({
        ...f,
        sgst_pct: String(clamped.sgst_pct),
        cgst_pct: String(clamped.cgst_pct),
        service_charge_pct: String(clamped.service_charge_pct),
        service_charge_ac_pct: acPct == null ? '' : String(acPct),
      }));
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the bill settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 900 }}>
      <div className="section-head">
        <p className="overline">Money</p>
        <h1 className="display section-title">Bill settings</h1>
        <p className="dim section-sub">
          Taxes, charges and how the printed bill is laid out. Every bill from this
          portal and from the app uses what is set here.
        </p>
      </div>

      <Section
        title="Taxes"
        hint={`Indian GST convention — SGST and CGST are charged as equal halves and print as separate lines on every bill. Current total: ${gstTotal}%.`}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="field-label" htmlFor="bs-sgst">SGST %</label>
            <input id="bs-sgst" className="code-input" inputMode="decimal" value={form.sgst_pct} onChange={set('sgst_pct')} />
          </div>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="field-label" htmlFor="bs-cgst">CGST %</label>
            <input id="bs-cgst" className="code-input" inputMode="decimal" value={form.cgst_pct} onChange={set('cgst_pct')} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="field-label" htmlFor="bs-svc">Service % (non-AC)</label>
            <input id="bs-svc" className="code-input" inputMode="decimal" value={form.service_charge_pct} onChange={set('service_charge_pct')} />
          </div>
          <div style={{ flex: '1 1 120px', minWidth: 0 }}>
            <label className="field-label" htmlFor="bs-svc-ac">Service % (AC)</label>
            <input id="bs-svc-ac" className="code-input" inputMode="decimal" placeholder="same as non-AC"
              value={form.service_charge_ac_pct} onChange={set('service_charge_ac_pct')} />
          </div>
        </div>
      </Section>

      <Section title="On the bill" hint="Printed at the foot of every bill.">
        <label className="field-label" htmlFor="bs-fssai">FSSAI licence number</label>
        <input id="bs-fssai" className="code-input" placeholder="e.g. 21221003001234" value={form.fssai_no} onChange={set('fssai_no')} />
        <label className="field-label" htmlFor="bs-thanks">Thank-you line</label>
        <input id="bs-thanks" className="code-input" placeholder="Thank you — please visit again!" value={form.bill_thanks} onChange={set('bill_thanks')} />
        <label className="field-label" htmlFor="bs-terms">Terms / small print</label>
        <input id="bs-terms" className="code-input" placeholder="No refunds on served items. Taxes as applicable." value={form.bill_terms} onChange={set('bill_terms')} />
        {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}
        <button className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} style={{ marginTop: 16 }} disabled={busy} onClick={save}>
          {saved ? 'Saved ✓' : 'Save bill settings'}
        </button>
      </Section>

      {/* Charges save themselves as they are added, so they sit outside the
          Save above -- see the note at the top. */}
      <Section title="Custom charges" hint="Anything you charge beyond the dishes. Percentages are taken on the food subtotal, before tax.">
        <BillCharges restaurantId={restaurant.id} acPricing={r.ac_pricing === true} />
      </Section>

      <Section title="Bill layout">
        {/* The live form values are merged over the saved row so the preview
            shows the thank-you line being typed above, not the one last
            saved -- otherwise it tells the truth about only half this page. */}
        <BillLayoutEditor
          restaurantId={restaurant.id}
          restaurant={{ ...r, ...form }}
        />
      </Section>
    </div>
  );
}
