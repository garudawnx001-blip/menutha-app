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
import { updateRestaurant, fetchBillLayout } from '../../lib/portalApi';
import { BillChargeLines } from './BillChargeLines';
import { BillLayoutEditor } from './BillLayoutEditor';
import { PrinterIcon } from './Glyphs';
import { printBillHtml, openBillHtml } from '../../lib/printBill';
import QRCode from 'qrcode';
import { normaliseLayout, renderBillHtml, sampleBillData, billUpiUri } from '../../lib/billTemplate';

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

  /** Builds the sample from the SAVED layout plus the values being edited
   *  above, so the paper matches the page. */
  const printSample = async (toPrinter: boolean) => {
    const layout = normaliseLayout(await fetchBillLayout(restaurant.id).catch(() => null));
    // The saved layout decides the logo: the "Show the logo" switch lives in
    // Bill layout below, one control on both surfaces rather than a second
    // print-only copy of it.
    const sample = { ...r, ...form };
    /**
     * The sample printed without a scan-to-pay code, which was harmless while
     * the code was a fixed block nobody could change -- and is not, now that
     * the size is a setting. The one question a printed sample exists to
     * answer is "does this fit my paper", and the code is the largest thing on
     * the sheet.
     *
     * No VPA, or a code that will not draw, means a sample without the block
     * rather than a sample that fails to print.
     */
    const payUri = billUpiUri((sample as any).upi_vpa, (sample as any).name ?? '', sampleBillData(sample).total, 'SAMPLE');
    const qr = payUri
      ? (await QRCode.toDataURL(payUri, { margin: 1, width: 380, color: { dark: '#1C1A15', light: '#FFFFFF' } }).catch(() => '')) || null
      : null;
    const html = renderBillHtml(sampleBillData(sample, qr), layout);
    if (toPrinter) printBillHtml(html); else openBillHtml(html);
  };
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
      <Section title="Taxes and charges" hint="GST, VAT, service, packing -- anything on top of the dishes. These are collected, printed, and counted in reports.">
        <BillChargeLines restaurantId={restaurant.id} />
      </Section>

      {/* PRINT THE SAMPLE, with or without the logo.
          The same string the app hands expo-print, so what comes out of the
          counter PC and what comes out of the phone are one document. The
          logo switch overrides the saved layout FOR THIS PRINT only -- an
          owner checking how the bill looks bare should not have to change a
          setting and change it back. */}
      <Section title="Print a sample" hint="Exactly what a diner's bill will look like on paper. The logo follows the switch in Bill layout below.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-glass" onClick={() => printSample(true)}>
            <PrinterIcon size={15} />&nbsp;Print sample bill
          </button>
          <button className="btn btn-ghost" onClick={() => printSample(false)}>
            Open in a new tab
          </button>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
          The document is text, not an image, so it prints sharp on an 80&nbsp;mm thermal roll
          and on A4 alike — the printer decides the resolution.
        </p>
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
