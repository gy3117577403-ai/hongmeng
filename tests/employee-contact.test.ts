import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EmployeeContactError,
  maskEmployeeMobile,
  normalizeEmployeeMobile,
} from '../lib/employee-contact';

test('employee mobile numbers normalize to a stable international format', () => {
  assert.equal(normalizeEmployeeMobile('138 0013 8000'), '+8613800138000');
  assert.equal(normalizeEmployeeMobile('86-138-0013-8000'), '+8613800138000');
  assert.equal(normalizeEmployeeMobile('0086 (138) 0013-8000'), '+8613800138000');
  assert.equal(normalizeEmployeeMobile('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizeEmployeeMobile(''), null);
});

test('invalid employee mobile numbers are rejected before persistence', () => {
  assert.throws(
    () => normalizeEmployeeMobile('12345'),
    (error: unknown) => error instanceof EmployeeContactError && /格式不正确/.test(error.message),
  );
});

test('employee mobile masking does not expose the complete number', () => {
  assert.equal(maskEmployeeMobile('+8613800138000'), '+86 ****8000');
  assert.equal(maskEmployeeMobile(null), '未填写');
});
