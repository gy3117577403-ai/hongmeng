import assert from 'node:assert/strict';
import test from 'node:test';
import { basisPoints } from '../lib/attendance';
import { employeeAttainmentScope } from '../lib/employee-attainment-access';
import { resolveAccessContext } from '../lib/department-access';
import { employeeAttainmentDetails, employeeAttainmentDetailExportRows } from '../lib/employee-attainment-details';
import type { EmployeeAttainmentRowDTO } from '../types';
import {
  aggregateDailyAttainment,
  shouldIncludeEmployeeInAttainmentReport,
} from '../lib/employee-attainment-daily';

const hour = 3_600_000;

test('supervisor and team leader reports follow shared workshop access despite legacy employee roles', () => {
  for (const profile of ['WORKSHOP_SUPERVISOR', 'WORKSHOP_TEAM_LEADER'] as const) {
    for (const laborRole of ['EMPLOYEE', 'TEAM_LEAD']) {
      const access = resolveAccessContext([{ profile, grantType: 'PRIMARY', departmentCode: 'PRODUCTION', scopeKey: 'TEAM:team-a' }]);
      assert.equal(employeeAttainmentScope({ laborRole, access }), 'PRODUCTION');
    }
  }
});

test('ordinary or expired roles cannot manufacture a workshop report scope from legacy laborRole', () => {
  const expired = resolveAccessContext([{
    profile: 'WORKSHOP_SUPERVISOR', grantType: 'PRIMARY', scopeKey: 'WORKSHOP:PRODUCTION',
    effectiveTo: '2026-08-01T00:00:00Z',
  }], { now: '2026-08-28T00:00:00Z' });
  assert.equal(employeeAttainmentScope({ laborRole: 'TEAM_LEAD', access: expired }), 'SELF');
  const access = { capabilities: ['PRODUCTION:READ'] as const, productionScope: 'TEAM' as const };
  assert.equal(employeeAttainmentScope({ laborRole: 'EMPLOYEE', access }), 'TEAM');
  const hr = resolveAccessContext([{ profile: 'DEPARTMENT_FULL', departmentCode: 'HR', grantType: 'PRIMARY', scopeKey: 'DEPARTMENT:HR' }]);
  assert.equal(employeeAttainmentScope({ laborRole: 'EMPLOYEE', access: hr }), 'PRODUCTION');
});

test('product/process detail preserves every claim and Shanghai work date in display and export', () => {
  const row = {
    employee: { employeeNo: '0010', name: '测试员工', team: '一组' },
    claimDetails: Array.from({ length: 8 }, (_, index) => ({
      id: `claim-${index}`, workDate: '2026-08-04', workOrderCode: 'PLN-PLAN-long-id',
      productName: '线束', specification: index === 7 ? null : `MODEL-${index}`,
      processCode: 'P01', processName: '全自动压接', quantity: 100, unitLabel: '套', standardLaborMilliseconds: hour,
    })),
    details: [{ id: 'exec-1', endedAt: '2026-08-03T17:00:00Z', workOrderCode: 'WO-2',
      productName: '电缆', specification: 'CABLE-X', processCode: 'P02', processName: '裁线', goodQty: 20,
      unitLabel: '件', standardLaborMilliseconds: 2 * hour }],
  } as EmployeeAttainmentRowDTO;
  const details = employeeAttainmentDetails(row);
  assert.equal(details.length, 9);
  assert.equal(details.at(-1)?.date, '2026-08-04');
  const exported = employeeAttainmentDetailExportRows([row]);
  assert.equal(exported.length, 9);
  assert.deepEqual(exported[7].slice(4, 8), ['型号未维护', '线束', 'P01', '全自动压接']);
  assert.equal(exported[8][12], 2);
});

test('weekly attainment only recognizes labor on dates with confirmed attendance', () => {
  const result = aggregateDailyAttainment([
    {
      attendanceMilliseconds: 8 * hour,
      exemptAbnormalMilliseconds: 0,
      standardLaborMilliseconds: 3.8 * hour,
      claimedStandardLaborMilliseconds: 3.8 * hour,
      actualLaborMilliseconds: 0,
      attendanceConfirmed: true,
    },
    {
      attendanceMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      standardLaborMilliseconds: 3.8 * hour,
      claimedStandardLaborMilliseconds: 3.8 * hour,
      actualLaborMilliseconds: 0,
      attendanceConfirmed: false,
    },
  ]);

  assert.equal(result.standardLaborMilliseconds, 3.8 * hour);
  assert.equal(result.claimedStandardLaborMilliseconds, 3.8 * hour);
  assert.equal(result.unmatchedStandardLaborMilliseconds, 3.8 * hour);
  assert.equal(result.attainmentCapacityMilliseconds, 7.6 * hour);
  assert.equal(result.attendanceMissingDays, 1);
  assert.equal(
    basisPoints(result.standardLaborMilliseconds, result.attainmentCapacityMilliseconds),
    5_000,
  );
});

test('quality-confirmed exemptions are applied inside each attendance date', () => {
  const result = aggregateDailyAttainment([
    {
      attendanceMilliseconds: 8 * hour,
      exemptAbnormalMilliseconds: hour,
      standardLaborMilliseconds: 6.65 * hour,
      claimedStandardLaborMilliseconds: 6.65 * hour,
      actualLaborMilliseconds: 0,
      attendanceConfirmed: true,
    },
  ]);
  assert.equal(result.effectiveProductionMilliseconds, 7 * hour);
  assert.equal(result.attainmentCapacityMilliseconds, 6.65 * hour);
  assert.equal(result.unmatchedStandardLaborMilliseconds, 0);
});

test('zero-duration confirmed attendance does not match claimed labor', () => {
  const result = aggregateDailyAttainment([
    {
      attendanceMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      standardLaborMilliseconds: hour,
      claimedStandardLaborMilliseconds: hour,
      actualLaborMilliseconds: 0,
      attendanceConfirmed: true,
    },
  ]);

  assert.equal(result.standardLaborMilliseconds, 0);
  assert.equal(result.claimedStandardLaborMilliseconds, 0);
  assert.equal(result.unmatchedStandardLaborMilliseconds, hour);
  assert.equal(result.attendanceMissingDays, 1);
  assert.equal(result.attainmentCapacityMilliseconds, 0);
});

test('employees marked ineligible remain visible elsewhere but contribute nothing to attainment totals', () => {
  const result = aggregateDailyAttainment([{
    attendanceMilliseconds: 8 * hour,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 9 * hour,
    claimedStandardLaborMilliseconds: 9 * hour,
    actualLaborMilliseconds: 8 * hour,
    attendanceConfirmed: true,
    attainmentEligible: false,
  }]);

  assert.deepEqual(result, {
    standardLaborMilliseconds: 0,
    claimedStandardLaborMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0,
    effectiveProductionMilliseconds: 0,
    attainmentCapacityMilliseconds: 0,
    unexplainedMilliseconds: 0,
    attendanceMissingDays: 0,
  });
});

test('inactive employees remain in historical reports when the period has activity', () => {
  assert.equal(shouldIncludeEmployeeInAttainmentReport({
    isActive: false,
    hasPeriodActivity: true,
  }), true);
  assert.equal(shouldIncludeEmployeeInAttainmentReport({
    isActive: false,
    hasPeriodActivity: false,
  }), false);
  assert.equal(shouldIncludeEmployeeInAttainmentReport({
    isActive: true,
    hasPeriodActivity: false,
  }), true);
});

test('partial-day attendance and arbitrary capacity factors use actual eligible hours', () => {
  const result = aggregateDailyAttainment([{
    attendanceMilliseconds: 3 * hour,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 1.425 * hour,
    claimedStandardLaborMilliseconds: 1.425 * hour,
    actualLaborMilliseconds: 3 * hour,
    attendanceConfirmed: true,
    attainmentEligible: true,
    attainmentFactorBasisPoints: 5_000,
    attainmentStream: 'batch',
  }]);

  assert.equal(result.effectiveProductionMilliseconds, 3 * hour);
  assert.equal(result.attainmentCapacityMilliseconds, 1.425 * hour);
  assert.equal(basisPoints(result.standardLaborMilliseconds, result.attainmentCapacityMilliseconds), 10_000);
});

test('sample stream is kept out of batch attainment totals', () => {
  const result = aggregateDailyAttainment([{
    attendanceMilliseconds: 8 * hour,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 7.6 * hour,
    claimedStandardLaborMilliseconds: 7.6 * hour,
    actualLaborMilliseconds: 8 * hour,
    attendanceConfirmed: true,
    attainmentEligible: true,
    attainmentFactorBasisPoints: 10_000,
    attainmentStream: 'sample',
  }]);

  assert.equal(result.standardLaborMilliseconds, 0);
  assert.equal(result.attainmentCapacityMilliseconds, 0);
});
