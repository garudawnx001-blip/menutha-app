/** Diner-payment helpers (MODULE 3) — pure, framework-free, unit-tested.
 *  The platform NEVER touches diner money: UPI QRs point at the restaurant's
 *  own VPA; gateway checkout runs on the restaurant's own account. */

const VPA_RE = /^[a-z0-9][a-z0-9._-]{0,255}@[a-z][a-z0-9]{1,63}$/i;

/** @param {string} vpa */
export function isValidVpa(vpa) {
  return typeof vpa === 'string' && VPA_RE.test(vpa.trim());
}

/**
 * Build a NPCI UPI deep link: upi://pay?pa=…&pn=…&am=…&tn=…&cu=INR
 * Amount is fixed to 2 decimals (server-priced total); note ties the payment
 * to the order for reconciliation.
 * @param {{ vpa: string, payeeName: string, amount: number, note: string }} p
 */
export function buildUpiUri({ vpa, payeeName, amount, note }) {
  if (!isValidVpa(vpa)) throw new Error('invalid VPA');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('invalid amount');
  const params = new URLSearchParams({
    pa: vpa.trim(),
    pn: (payeeName || 'Restaurant').slice(0, 60),
    am: amt.toFixed(2),
    tn: (note || '').slice(0, 60),
    cu: 'INR',
  });
  return 'upi://pay?' + params.toString();
}
