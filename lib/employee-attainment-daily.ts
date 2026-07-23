import { attainmentCapacityMilliseconds } from '@/lib/attendance';

export type DailyAttainmentInput = {
  attendanceMilliseconds: number;
  exemptAbnormalMilliseconds: number;
  standardLaborMilliseconds: number;
  claimedStandardLaborMilliseconds: number;
  actualLaborMilliseconds: number;
  attendanceConfirmed: boolean;
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
    if (day.attendanceConfirmed && day.attendanceMilliseconds > 0) {
      const effective = Math.max(
        0,
        day.attendanceMilliseconds - day.exemptAbnormalMilliseconds,
      );
      standardLaborMilliseconds += day.standardLaborMilliseconds;
      claimedStandardLaborMilliseconds += day.claimedStandardLaborMilliseconds;
      effectiveProductionMilliseconds += effective;
      attainmentCapacityTotalMilliseconds += attainmentCapacityMilliseconds(effective);
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
