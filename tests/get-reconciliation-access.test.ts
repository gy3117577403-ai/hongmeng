import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAccessContext,
  type AccessGrant,
} from '../lib/department-access';
import { canRunGetReconciliation } from '../lib/get-reconciliation-access';

function accessFor(grant: AccessGrant) {
  return resolveAccessContext([grant], { now: new Date('2026-08-10T00:00:00.000Z') });
}

test('GM global read access cannot trigger GET reconciliation writes', () => {
  const access = accessFor({
    profile: 'GM_OFFICE_READER_APPROVER',
    grantType: 'PRIMARY',
    departmentCode: 'GM_OFFICE',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });

  assert.equal(canRunGetReconciliation(access, ['PROCUREMENT']), false);
  assert.equal(canRunGetReconciliation(access, ['WAREHOUSE']), false);
  assert.equal(canRunGetReconciliation(access, ['PROCESS']), false);
});

test('department operator can reconcile only its owning module', () => {
  const access = accessFor({
    profile: 'DEPARTMENT_FULL',
    grantType: 'PRIMARY',
    departmentCode: 'WAREHOUSE',
    scopeKey: 'DEPARTMENT:WAREHOUSE',
  });

  assert.equal(canRunGetReconciliation(access, ['WAREHOUSE']), true);
  assert.equal(canRunGetReconciliation(access, ['PROCUREMENT']), false);
});

test('admin can retain legacy reconciliation behavior in every module', () => {
  const access = accessFor({
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
  });

  assert.equal(canRunGetReconciliation(access, ['PROCUREMENT']), true);
  assert.equal(canRunGetReconciliation(access, ['WAREHOUSE', 'PROCESS']), true);
});

test('an empty owning-module list fails closed', () => {
  const access = accessFor({
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
  });

  assert.equal(canRunGetReconciliation(access, []), false);
});
