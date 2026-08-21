import assert from 'node:assert/strict';
import test from 'node:test';
import { basisPoints } from '../lib/attendance';
import {
  aggregateDailyAttainment,
  shouldIncludeEmployeeInAttainmentReport,
} from '../lib/employee-attainment-daily';

const hour = 3_600_000;

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
