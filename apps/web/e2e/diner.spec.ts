/**
 * The diner on the web, end to end, against a fake Supabase:
 *   - the landing page for someone with no QR
 *   - a scan becomes a visit pass; the menu opens with no name/phone gate
 *   - name and number are asked at the first order; a bad number is refused;
 *     the order goes up with the pass (never a table id) and the number in
 *     one shape
 *   - an ended visit is said plainly
 *   - the online bill from WhatsApp, with print / save as PDF
 *   - no page scrolls sideways at 360, 768 or 1280 px
 */
import { test, expect } from '@playwright/test';
import { fakeSupabase, noHorizontalOverflow, visitPayload, PUBLIC_BILL, VISIT } from './fixtures';

test('a person with no QR gets a clear landing page, with no restaurant login on it', async ({ page }) => {
  await fakeSupabase(page);
  await page.goto('/table');
  await expect(page.getByRole('heading', { name: /scan the qr on your table/i })).toBeVisible();
  await expect(page.locator('a[href^="/partner"]')).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('scan → menu with no gate → name and number at the first order → sent with the pass', async ({ page }) => {
  const calls = await fakeSupabase(page, {
    visit_start: () => visitPayload,
    visit_get: () => visitPayload,
    visit_menu_prices: () => ({}),
    visit_open_orders: () => [],
    visit_my_bill: () => ({ table_id: visitPayload.table.id, orders: [], mine: { total: 0, order_count: 0 } }),
    visit_session_bill: () => ({ table_id: visitPayload.table.id, lines: [], totals: { total: 0, order_count: 0 } }),
    visit_identify: (b) => (/^[6-9]\d{9}$/.test(String(b.p_phone).replace(/\D/g, '').slice(-10))
      ? { name: b.p_name, phone: b.p_phone } : { __error: 'BAD_PHONE', hint: 'Enter a 10-digit Indian mobile number.' }),
    diner_place_order: () => ({ id: '44444444-4444-4444-8444-444444444444', total: 94.5, needs_confirm: true }),
  });
  await page.goto('/scan/qr_testtable');
  await expect(page).toHaveURL(/\/menu$/);
  // The menu is open at once -- no name/phone sheet in the way.
  await expect(page.getByText('Masala Dosa').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.rpc.visit_start?.[0]).toEqual({ p_token: 'qr_testtable' });

  // The dish can appear twice (featured strip and its section); either places it.
  await page.getByRole('button', { name: /add masala dosa/i }).first().click();
  const gate = page.getByRole('dialog');
  await expect(gate).toBeVisible();
  await gate.getByPlaceholder(/aarav/i).fill('Asha');
  await gate.getByPlaceholder(/10-digit/i).fill('12345');
  await expect(gate.getByRole('button', { name: /place order/i })).toBeDisabled();
  await gate.getByPlaceholder(/10-digit/i).fill('+91 98765 43210');
  await gate.getByRole('button', { name: /place order/i }).click();

  await expect(page.getByText(/waiting for the restaurant to confirm/i)).toBeVisible();
  const sent = calls.rpc.diner_place_order?.[0];
  expect(sent.p_visit).toBe(VISIT);
  expect(sent.p_phone).toBe('9876543210');
  expect(JSON.stringify(sent)).not.toContain(visitPayload.table.id);
  // No call ever asks for another diner's bill.
  expect(calls.rpc.get_table_bill).toBeUndefined();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('a finished visit says so instead of failing silently', async ({ page }) => {
  await fakeSupabase(page, {
    visit_start: () => visitPayload,
    visit_get: () => ({ __error: 'VISIT_EXPIRED', hint: 'Scan the QR code on your table again.' }),
    visit_menu_prices: () => ({}),
    visit_open_orders: () => [],
  });
  await page.goto('/scan/qr_testtable');
  await expect(page.getByText(/this visit has ended/i)).toBeVisible({ timeout: 15_000 });
});

test('an unknown QR gets a plain message and a retry', async ({ page }) => {
  await fakeSupabase(page, { visit_start: () => ({ __error: 'QR_NOT_FOUND', hint: 'This QR code is not recognised.' }) });
  await page.goto('/scan/qr_nope');
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
});

test('the online bill from WhatsApp shows the same invoice and can be printed', async ({ page }) => {
  await fakeSupabase(page, { public_bill: () => PUBLIC_BILL });
  await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.goto('/b/55555555-5555-4555-8555-555555555555');
  await expect(page.getByText(/26-27\/0041/).first()).toBeVisible();
  await expect(page.getByText(/189/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /print or save as pdf/i })).toBeVisible();
  // View-only: no pay button or UPI link of any kind.
  await expect(page.getByText(/pay now|upi:\/\//i)).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('the restaurant login page opens and fits the screen', async ({ page }) => {
  await fakeSupabase(page);
  await page.goto('/partner');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^log in$/i }).first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
