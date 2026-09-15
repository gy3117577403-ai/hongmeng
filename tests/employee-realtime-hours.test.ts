import test from 'node:test';
import assert from 'node:assert/strict';
import { activeOtherWorkRecords, distributeReportedLabor, pendingMatchingLabor, submittedWorkMilliseconds } from '../lib/employee-realtime-hours';
import { aggregateEmployeeHours, employeeHoursDayMetrics } from '../lib/employee-hours-metrics';
import { employeeAttainmentDetails } from '../lib/employee-attainment-details';

const h = 3_600_000;
test('reported, pending, abnormal and other hours share one numerator without adding matching subsets twice', () => {
  const result = employeeHoursDayMetrics({ attendanceMilliseconds: 8 * h, attendanceConfirmed: true,
    standardLaborMilliseconds: 7 * h, exemptAbnormalMilliseconds: .5 * h, otherWorkMilliseconds: .5 * h,
    pendingMatchingMilliseconds: h, pendingReviewMilliseconds: h });
  assert.equal(result.attainmentNumeratorMilliseconds, 8 * h);
  assert.equal(result.attainmentCapacityMilliseconds, 7.6 * h);
  assert.equal(result.attainmentBasisPoints, 10526);
  assert.equal(result.pendingMatchingMilliseconds, h);
});
test('partial predecessor coverage changes the subset, never earned report labor', () => {
  assert.equal(pendingMatchingLabor(2 * h, 100, 0), 2 * h);
  assert.equal(pendingMatchingLabor(2 * h, 100, 40), 1.2 * h);
  assert.equal(pendingMatchingLabor(2 * h, 100, 100), 0);
});
test('multiple participants conserve standard report hours and stable remainders', () => {
  assert.deepEqual(distributeReportedLabor(10, ['b', 'a', 'a', 'c']), [
    { employeeId: 'a', milliseconds: 4 }, { employeeId: 'b', milliseconds: 3 }, { employeeId: 'c', milliseconds: 3 },
  ]);
});
test('standard time is preferred; only explicit elapsed work can replace missing standard', () => {
  assert.deepEqual(submittedWorkMilliseconds({ quantity: 10, timeBasis: 'per_unit', standardMillisecondsPerUnit: 60000,
    unitsPerProduct: 2, workStartedAt: '2026-09-16T08:00:00+08:00', workEndedAt: '2026-09-16T10:00:00+08:00' }),
  { milliseconds: 1_200_000, basis: 'standard' });
  assert.deepEqual(submittedWorkMilliseconds({ quantity: 10, workStartedAt: '2026-09-16T08:00:00+08:00', workEndedAt: '2026-09-16T10:00:00+08:00' }),
  { milliseconds: 2 * h, basis: 'reported_duration' });
  assert.deepEqual(submittedWorkMilliseconds({ quantity: 10 }), { milliseconds: 0, basis: 'missing' });
});
test('pending batch work is proportional to the frozen batch target, not a full batch for every submission', () => {
  assert.deepEqual(submittedWorkMilliseconds({ quantity: 20, targetQuantity: 100, timeBasis: 'per_batch',
    standardMillisecondsPerUnit: h, setupMilliseconds: h }), { milliseconds: .4 * h, basis: 'standard' });
});
test('correction submission replaces its original once; rejected correction restores original', () => {
  const original = { id: 'a', status: 'APPROVED' };
  assert.deepEqual(activeOtherWorkRecords([original, { id: 'b', correctionOfId: 'a', status: 'PENDING' }]).map(row => row.id), ['b']);
  assert.deepEqual(activeOtherWorkRecords([original, { id: 'b', correctionOfId: 'a', status: 'REJECTED' }]).map(row => row.id), ['a']);
  assert.deepEqual(activeOtherWorkRecords([{ id: 'a', status: 'WITHDRAWN' }]), []);
});
test('missing attendance preserves labor and only gives a forecast when every missing day has an explicit target', () => {
  const day = { attendanceMilliseconds: 0, attendanceConfirmed: false, standardLaborMilliseconds: 2 * h,
    exemptAbnormalMilliseconds: 0, scheduledTargetMilliseconds: 8 * h };
  assert.equal(employeeHoursDayMetrics(day).attainmentBasisPoints, null);
  assert.equal(aggregateEmployeeHours([day]).estimatedAttainmentBasisPoints, 2632);
  assert.equal(aggregateEmployeeHours([day, { ...day, scheduledTargetMilliseconds: 0 }]).estimatedAttainmentBasisPoints, null);
});
test('live detail includes reported work independently of historical efficiency-analysis flags', () => {
  const result = employeeAttainmentDetails({ details: [], claimDetails: [], workRecords: [{ id: 'c', sourceId: 'c', source: 'completion',
    employeeId: 'e', workDate: '2026-09-16', type: 'production', title: '后工序', milliseconds: h,
    pendingMatchingMilliseconds: h, pendingReviewMilliseconds: 0, reportedDurationMilliseconds: 0,
    missingTime: false, state: 'pending_match', recordedAt: '2026-09-16T00:00:00Z' }] });
  assert.equal(result[0].standardLaborMilliseconds, h);
  assert.equal(result[0].date, '2026-09-16');
});
