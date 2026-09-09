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

const day = (overrides: Partial<Parameters<typeof aggregateDailyAttainment>[0] extends Iterable<infer T> ? T : never> = {}) => ({
  attendanceMilliseconds: 8 * hour, exemptAbnormalMilliseconds: 0, standardLaborMilliseconds: 8 * hour,
  claimedStandardLaborMilliseconds: 8 * hour, actualLaborMilliseconds: 0, attendanceConfirmed: true, ...overrides,
});

test('completed credit survives missing attendance and blocks an incomplete period rate', () => {
  const result = aggregateDailyAttainment([day({ standardLaborMilliseconds: 3.8 * hour, claimedStandardLaborMilliseconds: 3.8 * hour }),
    day({ attendanceMilliseconds: 0, attendanceConfirmed: false, standardLaborMilliseconds: 3.8 * hour, claimedStandardLaborMilliseconds: 3.8 * hour })]);
  assert.equal(result.standardLaborMilliseconds, 7.6 * hour);
  assert.equal(result.claimedStandardLaborMilliseconds, 7.6 * hour);
  assert.equal(result.unmatchedStandardLaborMilliseconds, 0);
  assert.equal(result.attendanceMissingDays, 1);
  assert.equal(result.attainmentBasisPoints, null);
  assert.equal(result.attainmentDataComplete, false);
});

test('confirmed loss earns 95 percent credit without shrinking the attendance denominator', () => {
  const result = aggregateDailyAttainment([day({ standardLaborMilliseconds: 6.65 * hour, exemptAbnormalMilliseconds: hour })]);
  assert.equal(result.attainmentCapacityMilliseconds, 8 * hour);
  assert.equal(result.creditedAbnormalMilliseconds, .95 * hour);
  assert.equal(result.attainmentBasisPoints, 9500);
});

test('confirmed zero attendance keeps output and returns no rate, while real zero output is zero percent', () => {
  const result = aggregateDailyAttainment([day({ attendanceMilliseconds: 0, standardLaborMilliseconds: hour })]);
  assert.equal(result.standardLaborMilliseconds, hour);
  assert.equal(result.attainmentBasisPoints, null);
  assert.equal(result.attainmentIncompleteDays, 1);
  assert.equal(aggregateDailyAttainment([day({ standardLaborMilliseconds: 0, claimedStandardLaborMilliseconds: 0 })]).attainmentBasisPoints, 0);
});

test('historical personal factors including zero never reduce credit or actual attendance', () => {
  for (const factor of [0, 5000, 10000]) {
    const result = aggregateDailyAttainment([day({ attainmentFactorBasisPoints: factor, attainmentStream: 'batch', attainmentEligible: true })]);
    assert.equal(result.standardLaborMilliseconds, 8 * hour);
    assert.equal(result.attainmentCapacityMilliseconds, 8 * hour);
    assert.equal(result.attainmentBasisPoints, 10000);
  }
});

test('sample and excluded days retain visible facts without entering batch performance', () => {
  for (const stream of ['sample', 'excluded'] as const) {
    const result = aggregateDailyAttainment([day({ attainmentStream: stream })]);
    assert.equal(result.standardLaborMilliseconds, 8 * hour);
    assert.equal(result.attendanceMilliseconds, 8 * hour);
    assert.equal(result.attainmentCapacityMilliseconds, 0);
    assert.equal(result.attainmentNumeratorMilliseconds, 0);
    assert.equal(result.attainmentBasisPoints, null);
  }
});

test('week and month divide summed credited output by summed attendance instead of averaging daily rates', () => {
  const days = [day({ attendanceMilliseconds: 10 * hour, actualOvertimeMilliseconds: 2 * hour, standardLaborMilliseconds: 8 * hour, exemptAbnormalMilliseconds: hour }),
    day({ attendanceMilliseconds: 5 * hour, standardLaborMilliseconds: 6 * hour })];
  const result = aggregateDailyAttainment(days);
  assert.equal(result.attendanceMilliseconds, 15 * hour);
  assert.equal(result.regularAttendanceMilliseconds, 13 * hour);
  assert.equal(result.recognizedOvertimeMilliseconds, 2 * hour);
  assert.equal(result.attainmentBasisPoints, 9967);
  assert.equal(aggregateDailyAttainment([days[0]]).attainmentBasisPoints, 8950);
  assert.equal(aggregateDailyAttainment([days[1]]).attainmentBasisPoints, 12000);
});

test('future facts cannot enter actual hours and empty days without a roster do not manufacture missing attendance', () => {
  const result = aggregateDailyAttainment([day(), day({ isFuture: true, attendanceRequired: true, attendanceConfirmed: false }),
    day({ attendanceConfirmed: false, attendanceMilliseconds: 0, standardLaborMilliseconds: 0, claimedStandardLaborMilliseconds: 0 })]);
  assert.equal(result.standardLaborMilliseconds, 8 * hour);
  assert.equal(result.attainmentBasisPoints, 10000);
  assert.equal(result.attainmentIncompleteDays, 0);
});

test('a real unresolved attendance roster blocks a period even before a worker reports output', () => {
  const result = aggregateDailyAttainment([day(), day({ attendanceRequired: true, attendanceConfirmed: false,
    attendanceMilliseconds: 0, standardLaborMilliseconds: 0, claimedStandardLaborMilliseconds: 0 })]);
  assert.equal(result.attainmentBasisPoints, null);
  assert.equal(result.attainmentIncompleteDays, 1);
});

test('inactive employees remain in historical reports when the period has activity', () => {
  assert.equal(shouldIncludeEmployeeInAttainmentReport({ isActive: false, hasPeriodActivity: true }), true);
  assert.equal(shouldIncludeEmployeeInAttainmentReport({ isActive: false, hasPeriodActivity: false }), false);
});

test('overtime inconsistent with total attendance remains visible and blocks performance instead of adding hours twice', () => {
  const result = aggregateDailyAttainment([day({ attendanceMilliseconds: 2 * hour, actualOvertimeMilliseconds: 3 * hour })]);
  assert.equal(result.attendanceMilliseconds, 2 * hour);
  assert.equal(result.regularAttendanceMilliseconds, 0);
  assert.equal(result.recognizedOvertimeMilliseconds, 2 * hour);
  assert.equal(result.actualOvertimeMilliseconds, 3 * hour);
  assert.equal(result.attainmentDataComplete, false);
  assert.equal(result.attainmentBasisPoints, null);
});

test('non-performance records retain their source hours while contributing zero to reconcilable completed hours', () => {
  const row = { employee: { employeeNo: 'record', name: '记录员工', team: '班组' }, claimDetails: [
    { id: 'excluded-claim', workDate: '2026-09-06', quantity: 1, standardLaborMilliseconds: 2 * hour, countsForEfficiency: false },
    { id: 'included-claim', workDate: '2026-09-06', quantity: 1, standardLaborMilliseconds: 3 * hour, countsForEfficiency: true },
  ], details: [{ id: 'excluded-execution', endedAt: '2026-09-06T12:00:00+08:00', goodQty: 1, standardLaborMilliseconds: hour, countsForEfficiency: false }] } as EmployeeAttainmentRowDTO;
  const details = employeeAttainmentDetails(row);
  assert.equal(details.reduce((sum, item) => sum + item.standardLaborMilliseconds, 0), 3 * hour);
  assert.equal(details.reduce((sum, item) => sum + item.recordedLaborMilliseconds, 0), 6 * hour);
  const exported = employeeAttainmentDetailExportRows([row]);
  assert.deepEqual(exported[0].slice(12), [0, 2, '仅记录，不计达成']);
  assert.deepEqual(exported[1].slice(12), [3, 3, '计入完成工时']);
});
