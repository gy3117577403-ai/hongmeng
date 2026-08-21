import { attainmentCapacityMilliseconds } from '@/lib/attendance';
import type { AttainmentStream } from '@/types';

export type DailyAttainmentInput = {
  attendanceMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  standardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attendanceConfirmed: boolean;
  /** Undefined is treated as eligible for backward-compatible historical inputs. */
  attainmentEligible?: boolean;
  /** Daily immutable snapshot. Undefined keeps the historical all-or-nothing behavior. */
  attainmentFactorBasisPoints?: number;
  attainmentStream?: AttainmentStream;
};

export function aggregateDailyAttainment(days: Iterable<DailyAttainmentInput>) {
  let standardLaborMilliseconds = 0;
  let claimedStandardLaborMilliseconds = 0;
  let unmatchedStandardLaborMilliseconds = 0;
  let effectiveProductionMilliseconds = 0;
  let attainmentCapacityTotalMilliseconds = 0;
  let unexplainedMilliseconds = 0;
  let attendanceMissingDays = 0;

  for (const day of days) {
    const stream = day.attainmentStream
      ?? (day.attainmentEligible === false ? 'excluded' : 'batch');
    const factorBasisPoints = Math.max(
      0,
      Math.min(10_000, Math.round(day.attainmentFactorBasisPoints
        ?? (day.attainmentEligible === false ? 0 : 10_000))),
    );
    if (stream !== 'batch' || factorBasisPoints <= 0) continue;
    if (day.attendanceConfirmed && day.attendanceMilliseconds > 0) {
      const effective = Math.max(
        0,
        day.attendanceMilliseconds - day.exemptAbnormalMilliseconds,
      );
      standardLaborMilliseconds += day.standardLaborMilliseconds;
      claimedStandardLaborMilliseconds += day.claimedStandardLaborMilliseconds;
      effectiveProductionMilliseconds += effective;
      attainmentCapacityTotalMilliseconds += Math.round(
        attainmentCapacityMilliseconds(effective) * factorBasisPoints / 10_000,
      );
      unexplainedMilliseconds += Math.max(
        0,
        day.attendanceMilliseconds
          - day.actualLaborMilliseconds
          - day.exemptAbnormalMilliseconds,
      );
    } else if (day.standardLaborMilliseconds > 0) {
      unmatchedStandardLaborMilliseconds += day.standardLaborMilliseconds;
      attendanceMissingDays += 1;
    }
  }

  return {
    standardLaborMilliseconds,
    claimedStandardLaborMilliseconds,
    unmatchedStandardLaborMilliseconds,
    effectiveProductionMilliseconds,
    attainmentCapacityMilliseconds: attainmentCapacityTotalMilliseconds,
    unexplainedMilliseconds,
    attendanceMissingDays,
  };
}

export function shouldIncludeEmployeeInAttainmentReport(input: {
  isActive: boolean;
  hasPeriodActivity: boolean;
}): boolean {
  return input.isActive || input.hasPeriodActivity;
}
