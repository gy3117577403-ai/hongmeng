import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEmployeeNumber } from '../lib/employee-number';

test('employee number uses at least four digits', () => {
  assert.equal(formatEmployeeNumber(1), '0001');
  assert.equal(formatEmployeeNumber(32), '0032');
  assert.equal(formatEmployeeNumber(33), '0033');
});

test('employee number expands after 9999 without recycling', () => {
  assert.equal(formatEmployeeNumber(9999), '9999');
  assert.equal(formatEmployeeNumber(10000), '10000');
});

test('employee number rejects invalid sequence values', () => {
  assert.throws(() => formatEmployeeNumber(0), /正整数/);
  assert.throws(() => formatEmployeeNumber(1.5), /正整数/);
  assert.throws(() => formatEmployeeNumber(Number.NaN), /正整数/);
});
