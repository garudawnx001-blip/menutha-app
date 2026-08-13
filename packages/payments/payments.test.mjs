import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpiUri, isValidVpa } from './index.js';

test('valid VPAs accepted, junk rejected', () => {
  assert.ok(isValidVpa('ashwamedha@okhdfcbank'));
  assert.ok(isValidVpa('shop.123@ybl'));
  assert.ok(!isValidVpa('no-at-sign'));
  assert.ok(!isValidVpa('@bank'));
  assert.ok(!isValidVpa(''));
});

test('builds a correct NPCI upi:// link', () => {
  const uri = buildUpiUri({ vpa: 'shop@ybl', payeeName: 'Test Kitchen', amount: 609, note: 'Order #12' });
  const u = new URL(uri);
  assert.equal(u.protocol, 'upi:');
  const q = u.searchParams;
  assert.equal(q.get('pa'), 'shop@ybl');
  assert.equal(q.get('pn'), 'Test Kitchen');
  assert.equal(q.get('am'), '609.00');
  assert.equal(q.get('tn'), 'Order #12');
  assert.equal(q.get('cu'), 'INR');
});

test('amount always has two decimals; specials are encoded', () => {
  const uri = buildUpiUri({ vpa: 'a@b1', payeeName: 'Chai & Co', amount: 99.5, note: 'Bill #7 — table 3' });
  assert.match(uri, /am=99\.50/);
  assert.ok(!uri.includes(' '), 'no raw spaces in the URI');
});

test('rejects invalid vpa or amount', () => {
  assert.throws(() => buildUpiUri({ vpa: 'bad', payeeName: 'x', amount: 10, note: '' }));
  assert.throws(() => buildUpiUri({ vpa: 'a@b1', payeeName: 'x', amount: 0, note: '' }));
  assert.throws(() => buildUpiUri({ vpa: 'a@b1', payeeName: 'x', amount: NaN, note: '' }));
});
