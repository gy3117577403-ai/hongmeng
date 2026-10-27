import test from 'node:test';
import assert from 'node:assert/strict';
import { pcReimbursementScope } from '../lib/purchasing-reimbursement';

const line = (id: string, payeeUserId: string | null = 'person-a') => ({ id, name: id, settlement: 'ADVANCE', payeeUserId, currency: 'CNY', request: { source: 'NORMAL' } });
test('reimbursement identity accepts missing historical identities without guessing from names or accounts', () => {
  assert.deepEqual(pcReimbursementScope([line('a'), line('b', null)]), { payeeUserId: 'person-a', legacyIds: ['b'] });
  assert.deepEqual(pcReimbursementScope([line('b', null)]), { payeeUserId: '', legacyIds: ['b'] });
});
test('one reimbursement never mixes known people, settlement types, sources or currencies', () => {
  assert.throws(() => pcReimbursementScope([]), /至少一项/);
  assert.throws(() => pcReimbursementScope([line('a'), line('b', 'person-b')]), /不同实际垫付人/);
  assert.throws(() => pcReimbursementScope([{ ...line('a'), settlement: 'CORPORATE' }]), /不是个人垫付/);
  assert.throws(() => pcReimbursementScope([line('a'), { ...line('b'), currency: 'USD' }]), /不同币种/);
  assert.throws(() => pcReimbursementScope([line('a'), { ...line('b'), request: { source: 'FIXTURE' } }]), /分别申请/);
});
test('earlier valid partial reimbursements preserve the confirmed person for legacy purchases', () => {
  const prior = { active: true, fund: { settlement: 'ADVANCE', status: 'PENDING', paidCents: 0, payeeUserId: 'person-b' } };
  assert.equal(pcReimbursementScope([{ ...line('old', null), allocations: [prior] }]).payeeUserId, 'person-b');
  assert.throws(() => pcReimbursementScope([line('a'), { ...line('old', null), allocations: [prior] }]), /不同实际垫付人/);
  assert.equal(pcReimbursementScope([{ ...line('old', null), allocations: [{ ...prior, active: false, fund: { ...prior.fund, status: 'CLOSED', paidCents: 100 } }] }]).payeeUserId, 'person-b');
  assert.equal(pcReimbursementScope([{ ...line('old', null), allocations: [{ ...prior, active: false, fund: { ...prior.fund, status: 'WITHDRAWN' } }] }]).payeeUserId, '');
});
