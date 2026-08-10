import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMutateAbnormalTimeEvent,
  canMutateDailyShipment,
  DAILY_SHIPMENT_MUTATION_ACTIONS,
  dailyShipmentRequiredAction,
} from '../lib/critical-operation-access';
import {
  resolveAccessContext,
  type AccessGrant,
} from '../lib/department-access';
import { canRunGetReconciliation } from '../lib/get-reconciliation-access';

function accessFor(grant: AccessGrant) {
  return resolveAccessContext([grant], { now: '2026-08-10T08:00:00.000Z' });
}

function departmentAccess(departmentCode: 'HR' | 'QUALITY' | 'PLANNING') {
  return accessFor({
    profile: 'DEPARTMENT_FULL',
    grantType: 'PRIMARY',
    departmentCode,
    scopeKey: `DEPARTMENT:${departmentCode}`,
  });
}

test('production read access cannot mutate abnormal-time records', () => {
  const production = accessFor({
    profile: 'WORKSHOP_SUPERVISOR',
    grantType: 'PRIMARY',
    departmentCode: 'PRODUCTION',
    scopeKey: 'WORKSHOP:w1',
  });

  assert.equal(canMutateAbnormalTimeEvent(production, 'CREATE'), false);
  assert.equal(canMutateAbnormalTimeEvent(production, 'UPDATE'), false);
  assert.equal(canMutateAbnormalTimeEvent(production, 'DELETE'), false);
});

test('HR and Quality maintain base abnormal-time events', () => {
  const hr = departmentAccess('HR');
  const quality = departmentAccess('QUALITY');

  for (const operation of ['CREATE', 'UPDATE', 'DELETE'] as const) {
    assert.equal(canMutateAbnormalTimeEvent(hr, operation), true);
    assert.equal(canMutateAbnormalTimeEvent(quality, operation), true);
  }
});

test('daily shipment actions map to explicit Planning mutation capabilities', () => {
  assert.equal(dailyShipmentRequiredAction('ADD_ITEMS'), 'CREATE');
  assert.equal(dailyShipmentRequiredAction('UPDATE_ITEM'), 'UPDATE');
  assert.equal(dailyShipmentRequiredAction('CANCEL_ITEM'), 'UPDATE');
  assert.equal(dailyShipmentRequiredAction('CONFIRM_PLAN'), 'EXECUTE_WORKFLOW');
  assert.equal(dailyShipmentRequiredAction('CLOSE_PLAN'), 'EXECUTE_WORKFLOW');
  assert.equal(dailyShipmentRequiredAction('RECORD_SHIPMENT'), 'EXECUTE_WORKFLOW');
  assert.equal(dailyShipmentRequiredAction('REVERSE_SHIPMENT'), 'EXECUTE_WORKFLOW');
  assert.equal(dailyShipmentRequiredAction('UNKNOWN'), null);
});

test('Planning and admin may mutate shipments; GM and Production remain read-only', () => {
  const planning = departmentAccess('PLANNING');
  const admin = accessFor({
    profile: 'ADMIN_GLOBAL',
    grantType: 'PRIMARY',
    scopeKey: 'GLOBAL',
  });
  const gm = accessFor({
    profile: 'GM_OFFICE_READER_APPROVER',
    grantType: 'PRIMARY',
    departmentCode: 'GM_OFFICE',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });
  const production = accessFor({
    profile: 'WORKSHOP_SUPERVISOR',
    grantType: 'PRIMARY',
    departmentCode: 'PRODUCTION',
    scopeKey: 'WORKSHOP:w1',
  });

  for (const action of DAILY_SHIPMENT_MUTATION_ACTIONS) {
    assert.equal(canMutateDailyShipment(planning, action), true);
    assert.equal(canMutateDailyShipment(admin, action), true);
    assert.equal(canMutateDailyShipment(gm, action), false);
    assert.equal(canMutateDailyShipment(production, action), false);
  }
});

test('GM shipment GET cannot trigger carryover reconciliation writes', () => {
  const planning = departmentAccess('PLANNING');
  const gm = accessFor({
    profile: 'GM_OFFICE_READER_APPROVER',
    grantType: 'PRIMARY',
    departmentCode: 'GM_OFFICE',
    scopeKey: 'DEPARTMENT:GM_OFFICE',
  });

  assert.equal(canRunGetReconciliation(planning, ['PLANNING']), true);
  assert.equal(canRunGetReconciliation(gm, ['PLANNING']), false);
});
