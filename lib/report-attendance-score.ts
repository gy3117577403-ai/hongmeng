export type AttendancePublicationState =
  | 'future'
  | 'in_progress'
  | 'incomplete'
  | 'finalized'
  | 'no_roster';

export type AttendanceDayPublicationInput = {
  date: string;
  requiredRecords: number;
  confirmedRecords: number;
  draftRecords: number;
  missingRecords: number;
  plannedPeople: number;
  attendancePeople: number;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
};

export type AttendanceDayPublication = {
  resolvedRecords: number;
  dataCoverageBasisPoints: number | null;
  publicationState: AttendancePublicationState;
  isFinalized: boolean;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
  hoursBasisPoints: number | null;
};

export type AttendancePeriodDayInput = AttendanceDayPublicationInput
  & AttendanceDayPublication
  & {
    actualOvertimeMilliseconds: number;
    leaveDeductionMilliseconds: number;
    extraAttendanceMilliseconds: number;
  };

export type AttendancePeriodSummary = {
  requiredRecords: number;
  resolvedRecords: number;
  draftRecords: number;
  missingRecords: number;
  dataCoverageBasisPoints: number | null;
  finalizedDays: number;
  incompleteDays: number;
  inProgressDays: number;
  lastFinalizedDate: string | null;
  netExpectedMilliseconds: number;
  attendanceMilliseconds: number;
  shortfallMilliseconds: number;
  extraAttendanceMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveDeductionMilliseconds: number;
  attendanceRawBasisPoints: number | null;
  attendanceBasisPoints: number | null;
};

function basisPoints(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.max(0, Math.round(numerator / denominator * 10_000));
}

export function finalizeAttendanceDay(
  input: AttendanceDayPublicationInput,
  todayDateKey: string,
): AttendanceDayPublication {
  const requiredRecords = Math.max(0, input.requiredRecords);
  const resolvedRecords = Math.min(requiredRecords, Math.max(0, input.confirmedRecords));
  const raw = basisPoints(input.attendanceMilliseconds, input.netExpectedMilliseconds);
  const complete = requiredRecords > 0
    && resolvedRecords === requiredRecords
    && input.draftRecords === 0
    && input.missingRecords === 0;

  let publicationState: AttendancePublicationState;
  if (input.date > todayDateKey) publicationState = 'future';
  else if (input.date === todayDateKey) publicationState = 'in_progress';
  else if (requiredRecords === 0) publicationState = 'no_roster';
  else if (complete) publicationState = 'finalized';
  else publicationState = 'incomplete';

  const isFinalized = publicationState === 'finalized';
  return {
    resolvedRecords,
    dataCoverageBasisPoints: basisPoints(resolvedRecords, requiredRecords),
    publicationState,
    isFinalized,
    attendanceRawBasisPoints: raw,
    attendanceBasisPoints: isFinalized
      ? basisPoints(input.attendancePeople, input.plannedPeople)
      : null,
    hoursBasisPoints: isFinalized && raw !== null ? Math.min(10_000, raw) : null,
  };
}

export function summarizeFinalizedAttendance(
  days: AttendancePeriodDayInput[],
): AttendancePeriodSummary {
  const relevantDays = days.filter(day => day.publicationState !== 'future' && day.publicationState !== 'no_roster');
  const finalized = days.filter(day => day.isFinalized);
  const requiredRecords = relevantDays.reduce((sum, day) => sum + day.requiredRecords, 0);
  const resolvedRecords = relevantDays.reduce((sum, day) => sum + day.resolvedRecords, 0);
  const draftRecords = relevantDays.reduce((sum, day) => sum + day.draftRecords, 0);
  const missingRecords = relevantDays.reduce((sum, day) => sum + day.missingRecords, 0);
  const netExpectedMilliseconds = finalized.reduce((sum, day) => sum + day.netExpectedMilliseconds, 0);
  const attendanceMilliseconds = finalized.reduce((sum, day) => sum + day.attendanceMilliseconds, 0);
  const attendanceRawBasisPoints = basisPoints(attendanceMilliseconds, netExpectedMilliseconds);

  return {
    requiredRecords,
    resolvedRecords,
    draftRecords,
    missingRecords,
    dataCoverageBasisPoints: basisPoints(resolvedRecords, requiredRecords),
    finalizedDays: finalized.length,
    incompleteDays: days.filter(day => day.publicationState === 'incomplete').length,
    inProgressDays: days.filter(day => day.publicationState === 'in_progress').length,
    lastFinalizedDate: finalized.length ? finalized[finalized.length - 1].date : null,
    netExpectedMilliseconds,
    attendanceMilliseconds,
    shortfallMilliseconds: Math.max(0, netExpectedMilliseconds - attendanceMilliseconds),
    extraAttendanceMilliseconds: finalized.reduce((sum, day) => sum + day.extraAttendanceMilliseconds, 0),
    actualOvertimeMilliseconds: finalized.reduce((sum, day) => sum + day.actualOvertimeMilliseconds, 0),
    leaveDeductionMilliseconds: finalized.reduce((sum, day) => sum + day.leaveDeductionMilliseconds, 0),
    attendanceRawBasisPoints,
    attendanceBasisPoints: attendanceRawBasisPoints === null ? null : Math.min(10_000, attendanceRawBasisPoints),
  };
}
