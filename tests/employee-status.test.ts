import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EmployeeStatusChangeError,
  resolveEmployeeActiveStatus,
} from '../lib/employee-status';

test('employee active status remains unchanged when the request omits it', () => {
  assert.equal(resolveEmployeeActiveStatus({
    currentIsActive: true,
    requestedIsActive: undefined,
    confirmDisable: undefined,
  }), true);
});

test('employee reactivation does not require a disable confirmation', () => {
  assert.equal(resolveEmployeeActiveStatus({
    currentIsActive: false,
    requestedIsActive: true,
    confirmDisable: undefined,
  }), true);
});

test('employee deactivation requires an explicit confirmation', () => {
  assert.throws(
    () => resolveEmployeeActiveStatus({
      currentIsActive: true,
      requestedIsActive: false,
      confirmDisable: undefined,
    }),
    (error: unknown) => error instanceof EmployeeStatusChangeError
      && error.code === 'EMPLOYEE_DISABLE_CONFIRMATION_REQUIRED',
  );

  assert.equal(resolveEmployeeActiveStatus({
    currentIsActive: true,
    requestedIsActive: false,
    confirmDisable: true,
  }), false);
});
