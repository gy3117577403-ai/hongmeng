import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeAttainmentPolicy, policyForWorkDate, attendanceWritePolicy } from '../lib/employee-attainment-policy';
import { employeeHoursDayMetrics, aggregateEmployeeHours } from '../lib/employee-hours-metrics';

const sample = employeeAttainmentPolicy({ department: '生产部', team: '样品组', attainmentStream: 'sample' });
const batch = { ...sample, team: '装配', attainmentStream: 'batch' as const };
const changes = [
  { effectiveDate: '2026-08-01', revision: 1, beforePolicy: sample, afterPolicy: batch },
  { effectiveDate: '2026-09-01', revision: 2, beforePolicy: batch, afterPolicy: sample },
];
test('effective policy preserves pre-transfer sample dates and resolves historical backfills after a later transfer', () => {
  assert.equal(policyForWorkDate(sample, changes, '2026-07-31').policy.attainmentStream, 'sample');
  assert.equal(policyForWorkDate(sample, changes, '2026-08-01').policy.attainmentStream, 'batch');
  assert.equal(policyForWorkDate(sample, changes, '2026-08-31').policy.team, '装配');
  assert.equal(policyForWorkDate(sample, changes, '2026-09-01').policy.attainmentStream, 'sample');
  const corrected = [...changes, { effectiveDate: '2026-09-01', revision: 3, beforePolicy: sample, afterPolicy: batch }];
  assert.equal(policyForWorkDate(sample, corrected, '2026-09-01').policy.attainmentStream, 'batch');
});
test('temporary day policy requires a reason and can explicitly return to the dated personnel policy', () => {
  assert.throws(() => attendanceWritePolicy({ attainmentPolicyOverride: true, attainmentStream: 'sample' }, batch), /原因/);
  const override = attendanceWritePolicy({ attainmentPolicyOverride: true, attainmentPolicyReason: '临时协助样品', attainmentStream: 'sample' }, batch);
  assert.equal(override.attainmentPolicyOverride, true);
  assert.equal(override.attainmentStreamSnapshot, 'sample');
  const reset = attendanceWritePolicy({ attainmentPolicyOverride: false, attainmentStream: 'sample' }, batch, override);
  assert.equal(reset.attainmentPolicyOverride, false);
  assert.equal(reset.attainmentStreamSnapshot, 'batch');
  assert.equal(reset.attainmentPolicyReason, null);
});
test('the supplied employee hours yield 78.30 percent only on eligible dates; periods sum eligible targets', () => {
  const h = 3600000;
  const input = { attendanceMilliseconds: 10.5 * h, standardLaborMilliseconds: 7.31 * h, exemptAbnormalMilliseconds: .5 * h,
    actualOvertimeMilliseconds: 2.5 * h, attendanceConfirmed: true, attainmentEligible: true };
  const excluded = { ...input, attainmentStream: 'sample' };
  const included = { ...input, attainmentStream: 'batch' };
  assert.equal(employeeHoursDayMetrics(excluded).attainmentBasisPoints, null);
  assert.equal(employeeHoursDayMetrics(included).attainmentBasisPoints, 7830);
  const mixed = aggregateEmployeeHours([excluded, included]);
  assert.equal(mixed.attainmentBasisPoints, 7830);
  assert.equal(mixed.attendanceMilliseconds, 21 * h);
  assert.equal(mixed.attainmentCapacityMilliseconds, 10.5 * h * .95);
});
