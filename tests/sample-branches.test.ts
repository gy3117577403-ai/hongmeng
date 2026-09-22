import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleWeek, sampleDay, sampleCompletionQuantity, sampleMaterialLines, sampleTaskType } from '../lib/sample-plan-domain';

test('sample week belongs to Monday independently of due date and year rollover', () => {
  assert.equal(sampleWeek('2026-09-27'), '2026-09-21');
  assert.equal(sampleWeek('2027-01-01'), '2026-12-28');
  assert.equal(sampleWeek(''), null);
  for (const invalid of ['2026-02-30', 'not-a-day']) assert.throws(() => sampleDay(invalid));
  assert.equal(sampleTaskType(undefined), 'NEW'); assert.equal(sampleTaskType('REPEAT'), 'REPEAT'); assert.throws(() => sampleTaskType('other'));
});
test('partial sample completions cannot create fractional, negative or excess stock', () => {
  assert.equal(sampleCompletionQuantity('3', 5, 2), 3);
  for (const quantity of [0,-1,3.5,4,Infinity]) assert.throws(() => sampleCompletionQuantity(quantity, 5, 2));
  assert.throws(() => sampleCompletionQuantity(1, null, 0));
});
test('sample material demand distinguishes purchased and customer material with bounded quantities', () => {
  const row = { id: 'line', model: 'CN-01', quantity: 2.5, prepared: 1.25, unit: '米', supplySource: 'CUSTOMER' };
  assert.equal(sampleMaterialLines([row])[0].prepared, 1.25);
  assert.throws(() => sampleMaterialLines([row, row]));
  assert.throws(() => sampleMaterialLines([{ ...row, prepared: 3 }]));
  assert.throws(() => sampleMaterialLines([{ ...row, supplySource: 'INVALID' }]));
  assert.throws(() => sampleMaterialLines([{ ...row, model: '' }]));
});
