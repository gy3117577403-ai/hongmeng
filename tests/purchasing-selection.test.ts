import test from 'node:test';
import assert from 'node:assert/strict';
import { pcSelectPage, pcReceiptState, pcFundingGroups, pcFundingIssue } from '../lib/purchasing-selection';

test('cross-page selection adds and removes only the current page, preserving off-page IDs', () => {
  const first = Array.from({ length: 12 }, (_, i) => `first-${i}`), second = Array.from({ length: 12 }, (_, i) => `second-${i}`);
  const both = pcSelectPage(pcSelectPage([], first, true), second, true);
  assert.equal(both.length, 24);
  assert.deepEqual(pcSelectPage(both, second, false), first);
  assert.deepEqual(pcSelectPage(both, first, true), both);
  assert.deepEqual(pcSelectPage(both, ['first-0'], false), both.slice(1));
});
test('selection never truncates an oversized batch or mutates the prior selection', () => {
  const selected = Array.from({ length: 100 }, (_, i) => `${i}`);
  assert.throws(() => pcSelectPage(selected, ['overflow'], true), /最多选择 100/);
  assert.equal(selected.length, 100);
});
test('receipt status uses historical receipts and cancelled outstanding quantity, independently of payment and current inventory', () => {
  const base = { status: 'ORDERED', quantity: 5, receivedQty: 0, cancelledQty: 0, returnedQty: 0 };
  assert.equal(pcReceiptState(base).state, 'UNRECEIVED');
  assert.equal(pcReceiptState({ ...base, receivedQty: 3 }).state, 'PARTIAL');
  assert.equal(pcReceiptState({ ...base, receivedQty: 3 }).pending, 2);
  assert.equal(pcReceiptState({ ...base, receivedQty: 3, cancelledQty: 2 }).state, 'RECEIVED');
  assert.equal(pcReceiptState({ ...base, cancelledQty: 5 }).state, 'CANCELLED');
  assert.equal(pcReceiptState({ ...base, status: 'APPROVED' }).state, 'NOT_ORDERED');
  assert.equal(pcReceiptState({ ...base, status: 'VOID' }).state, 'CANCELLED');
  assert.deepEqual(pcReceiptState({ ...base, receivedQty: 5, returnedQty: 5 }), { state: 'RECEIVED', label: '已入库', expected: 5, pending: 0, returned: 5 });
});
const line = { id: 'a', status: 'ORDERED', payableCents: 200, reservedCents: 0, refundedCents: 0, settlement: 'ADVANCE', payee: '甲', payeeUserId: 'u', bank: '银行', account: 'A', supplierId: 's1', currency: 'CNY', cycle: '', request: { source: 'NORMAL', applicantId: 'u', submitterId: 'u' }, returns: [], amountCorrections: [] };
test('reimbursement groups preserve payee account, source, currency and monthly period boundaries', () => {
  assert.equal(pcFundingGroups([line, { ...line, id: 'b', supplierId: 's2' }]).length, 1);
  for (const changed of [{ account: 'B' }, { payeeUserId: 'other' }, { currency: 'USD' }, { request: { ...line.request, source: 'FIXTURE' } }])
    assert.equal(pcFundingGroups([line, { ...line, id: 'b', ...changed }]).length, 2);
  assert.equal(pcFundingGroups([{ ...line, settlement: 'MONTHLY' }, { ...line, id: 'b', settlement: 'MONTHLY' }]).length, 2);
});
test('unavailable reimbursement records explain outstanding refunds, ownership and correction review', () => {
  assert.equal(pcFundingIssue(line, 'u', []), '');
  assert.match(pcFundingIssue(line, 'stranger', []), /申请人/);
  assert.equal(pcFundingIssue(line, 'buyer', ['buyer']), '');
  assert.match(pcFundingIssue({ ...line, reservedCents: 200 }, 'u', []), /无可申请余额/);
  assert.match(pcFundingIssue({ ...line, amountCorrections: [{ status: 'PENDING' }] }, 'u', []), /复核/);
  assert.match(pcFundingIssue({ ...line, returns: [{ refundDueCents: 1, companyReceivedCents: 0 }] }, 'u', []), /退款/);
});
