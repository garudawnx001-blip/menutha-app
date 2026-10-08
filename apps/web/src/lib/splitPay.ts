/**
 * SPLIT PAYMENT — the arithmetic, shared by the app and the web portal.
 *
 * MIRRORED FILE. The identical copy lives at
 *   menutha-app-deploy/apps/web/src/lib/splitPay.ts
 * (Metro will not import from outside apps/mobile, the same reason
 * billTemplate.ts is mirrored). Change both or neither.
 *
 * Everything is integer paise. The server (settle_bill) is the authority: it
 * refuses parts that do not add up to the bill exactly, so this file only has
 * to make the screen agree with what the server will accept.
 *
 * Equal and by-item shares use the largest-remainder rule, so the shares
 * always add up to the bill to the paisa and nobody is short-changed by more
 * than one paisa.
 */

export type PayMode = 'cash' | 'upi_qr' | 'card' | 'other';

/** The methods staff can record at the counter, in button order. "UPI" is a
 *  method recorded at the counter only (no restaurant UPI link is generated). */
export const PAY_MODES: { id: PayMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi_qr', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'other', label: 'Other' },
];

/** One wording everywhere a stored method is shown (bill, reports, history). */
export function payModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'cash': return 'Cash';
    case 'upi_qr': return 'UPI';
    case 'card': return 'Card';
    case 'other': return 'Other';
    case 'gateway': return 'Online';
    case 'split': return 'Split';
    default: return mode ? String(mode) : '';
  }
}

export interface PayPart {
  mode: PayMode;
  /** What this part pays of the bill, in paise. */
  amountP: number;
  /** Cash only: what was handed over, in paise (null = exact). */
  tenderedP?: number | null;
  payer?: string;
}

export const toPaise = (rupees: number | string | null | undefined): number => {
  const v = typeof rupees === 'string' ? Number(rupees.replace(/[^\d.]/g, '')) : Number(rupees ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
};
export const fromPaise = (p: number): number => Math.round(p) / 100;
export const rupees = (p: number): string =>
  '₹' + (Math.round(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Distribute `totalP` over integer weights by largest remainder. Ties go to
 *  the earlier share. Zero weights get zero. All-zero weights → equal. */
export function allocate(totalP: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => Math.max(0, Math.round(x)));
  const W = w.reduce((a, b) => a + b, 0);
  if (W === 0) return allocate(totalP, w.map(() => 1));
  const exact = w.map((x) => (totalP * x) / W);
  const base = exact.map((x) => Math.floor(x));
  let left = totalP - base.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as [number, number])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k][1]] += 1;
  return base;
}

/** Split equally between `people`. 100.00 between 3 → 33.34, 33.33, 33.33. */
export function equalShares(totalP: number, people: number): number[] {
  const n = Math.max(1, Math.min(20, Math.floor(people)));
  return allocate(totalP, new Array(n).fill(1));
}

/**
 * Split by what each person had. `items` are the bill's own lines
 * (breakdown.items: amount_p); `owner[i]` is the person index (0-based) who
 * had line i, or -1 for "shared by everyone". Each person pays their lines'
 * proportion of the WHOLE bill (so tax, service, discount and charges are
 * shared in the same proportion), and the shares add up to the bill exactly.
 */
export function itemShares(totalP: number, items: { amount_p: number }[], owner: number[], people: number): number[] {
  const n = Math.max(1, Math.min(20, Math.floor(people)));
  const weight = new Array(n).fill(0);
  items.forEach((it, i) => {
    const a = Math.max(0, Math.round(Number(it.amount_p) || 0));
    const who = owner[i] ?? -1;
    if (who >= 0 && who < n) { weight[who] += a * n; }       // ×n keeps shared splits integral
    else { for (let k = 0; k < n; k++) weight[k] += a; }
  });
  return allocate(totalP, weight);
}

export interface PartsCheck {
  sumP: number;
  /** > 0 still to collect, < 0 too much. */
  remainingP: number;
  changeP: number;
  ok: boolean;
  /** Plain-language reason it cannot be settled yet, or '' when ok. */
  problem: string;
}

export function checkParts(totalP: number, parts: PayPart[]): PartsCheck {
  let sumP = 0; let changeP = 0; let problem = '';
  parts.forEach((p, i) => {
    const a = Math.round(p.amountP || 0);
    sumP += a;
    if (a <= 0 && !problem && totalP > 0) problem = `Part ${i + 1} needs an amount.`;
    if (p.tenderedP != null && p.tenderedP > 0) {
      if (p.mode !== 'cash' && !problem) problem = 'Only cash can be handed over with change.';
      else if (p.tenderedP < a && !problem) problem = `Part ${i + 1}: ${rupees(p.tenderedP)} handed over is less than ${rupees(a)}.`;
      else changeP += Math.max(0, p.tenderedP - a);
    }
  });
  const remainingP = totalP - sumP;
  if (!problem && parts.length === 0) problem = 'Add how the bill was paid.';
  if (!problem && parts.length > 20) problem = 'At most 20 parts.';
  if (!problem && remainingP > 0) problem = `${rupees(remainingP)} still to collect.`;
  if (!problem && remainingP < 0) problem = `${rupees(-remainingP)} too much — lower a part.`;
  return { sumP, remainingP, changeP, ok: problem === '', problem };
}

/** The body settle_bill takes. Rupees with two decimals. */
export function tendersPayload(parts: PayPart[]) {
  return parts.map((p) => ({
    mode: p.mode,
    amount: fromPaise(p.amountP),
    ...(p.mode === 'cash' && p.tenderedP != null && p.tenderedP > 0 ? { tendered: fromPaise(p.tenderedP) } : {}),
    ...(p.payer && p.payer.trim() ? { payer: p.payer.trim().slice(0, 40) } : {}),
  }));
}

/** Change for a single cash payment: what to hand back, never negative. */
export function changeFor(totalP: number, handedOverP: number): number {
  return Math.max(0, Math.round(handedOverP) - Math.round(totalP));
}

/** An idempotency key for one settle attempt (kept until it succeeds). */
export function newRequestId(prefix = 'op'): string {
  const r = (globalThis as any).crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${r}`;
}

/** "Person 1", "Person 2" … unless a name was typed. */
export const personLabel = (i: number, name?: string) => (name && name.trim()) || `Person ${i + 1}`;
