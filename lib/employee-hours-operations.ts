import { basisPoints } from '@/lib/attendance';
import type { EmployeeAttainmentRowDTO, ReportOperationsEmployeeDayDTO, ReportOperationsEmployeeRowDTO } from '@/types';

/** Operations and employee reports consume identical daily facts; the calendar is only a roster/publication concern. */
export function employeeHoursOperationsRows(rows: EmployeeAttainmentRowDTO[], dateKeys: string[]): ReportOperationsEmployeeRowDTO[] {
  return rows.map(row => {
    const byDate = new Map(row.days.map(day => [day.date, day]));
    const days: ReportOperationsEmployeeDayDTO[] = dateKeys.map(date => {
      const day = byDate.get(date);
      return {
        date, status: day ? day.attendanceStatus : 'not_employed',
        attendanceRequired: day?.attendanceRequired ?? false,
        attendanceType: day?.attendanceType ?? null,
        plannedMilliseconds: day?.scheduledMilliseconds ?? 0,
        scheduledMilliseconds: day?.scheduledMilliseconds ?? 0,
        plannedOvertimeMilliseconds: day?.plannedOvertimeMilliseconds ?? 0,
        attendanceDataIssue: day?.attendanceDataIssue ?? null,
        recognizedOvertimeMilliseconds: day?.recognizedOvertimeMilliseconds ?? 0,
        actualOvertimeMilliseconds: day?.actualOvertimeMilliseconds ?? 0,
        regularAttendanceMilliseconds: day?.regularAttendanceMilliseconds ?? 0,
        leaveDeductionMilliseconds: day?.leaveDeductionMilliseconds ?? 0,
        netExpectedMilliseconds: day?.netExpectedMilliseconds ?? 0,
        attendanceMilliseconds: day?.attendanceMilliseconds ?? 0,
        extraAttendanceMilliseconds: day?.extraAttendanceMilliseconds ?? 0,
        leaveMilliseconds: day?.leaveDeductionMilliseconds ?? 0,
        actualLaborMilliseconds: day?.actualLaborMilliseconds ?? 0,
        standardLaborMilliseconds: day?.standardLaborMilliseconds ?? 0,
        unmatchedStandardLaborMilliseconds: 0,
        exemptAbnormalMilliseconds: day?.exemptAbnormalMilliseconds ?? 0,
        creditedAbnormalMilliseconds: day?.creditedAbnormalMilliseconds ?? 0,
        overlapMilliseconds: day?.overlapMilliseconds ?? 0,
        unexplainedMilliseconds: day?.unexplainedMilliseconds ?? 0,
        attainmentCapacityMilliseconds: day?.attainmentCapacityMilliseconds ?? 0,
        attainmentNumeratorMilliseconds: day?.attainmentNumeratorMilliseconds ?? 0,
        attainmentIncompleteDays: day?.attainmentIncompleteDays ?? 0,
        attainmentDataComplete: day?.attainmentDataComplete ?? true,
        attendanceRawBasisPoints: day ? basisPoints(day.attendanceMilliseconds, day.netExpectedMilliseconds) : null,
        attendanceBasisPoints: day?.attendanceBasisPoints ?? null,
        utilizationBasisPoints: day?.utilizationBasisPoints ?? null,
        efficiencyBasisPoints: day?.efficiencyBasisPoints ?? null,
        attainmentBasisPoints: day?.targetAttainmentBasisPoints ?? null,
        overtimeSource: day?.overtimeSource ?? 'none',
        attainmentEligible: day?.attainmentEligible ?? false,
        attainmentFactorBasisPoints: day?.attainmentFactorBasisPoints ?? 0,
        attainmentStream: day?.attainmentStream ?? 'excluded',
      };
    });
    const sum = (key: keyof ReportOperationsEmployeeDayDTO) => days.reduce((total, day) => total + (typeof day[key] === 'number' ? day[key] as number : 0), 0);
    const netExpectedMilliseconds = sum('netExpectedMilliseconds');
    const attendanceRawBasisPoints = basisPoints(row.attendanceMilliseconds, netExpectedMilliseconds);
    return {
      ...row,
      team: String(row.employee.team || row.employee.position || '未分组').trim() || '未分组',
      position: String(row.employee.position || '岗位未设置'),
      plannedMilliseconds: sum('plannedMilliseconds'), scheduledMilliseconds: sum('scheduledMilliseconds'),
      plannedOvertimeMilliseconds: sum('plannedOvertimeMilliseconds'),
      recognizedOvertimeMilliseconds: sum('recognizedOvertimeMilliseconds'),
      actualOvertimeMilliseconds: sum('actualOvertimeMilliseconds'),
      leaveDeductionMilliseconds: sum('leaveDeductionMilliseconds'), netExpectedMilliseconds,
      extraAttendanceMilliseconds: sum('extraAttendanceMilliseconds'), leaveMilliseconds: sum('leaveMilliseconds'),
      overlapMilliseconds: sum('overlapMilliseconds'),
      attendanceRawBasisPoints,
      attendanceBasisPoints: attendanceRawBasisPoints === null ? null : Math.min(10_000, attendanceRawBasisPoints),
      utilizationBasisPoints: row.coverageBasisPoints,
      efficiencyBasisPoints: basisPoints(row.standardLaborMilliseconds, row.actualLaborMilliseconds),
      confirmedDays: days.filter(day => day.attendanceRequired && day.status === 'confirmed').length,
      draftDays: days.filter(day => day.attendanceRequired && day.status === 'draft').length,
      missingDays: days.filter(day => day.attendanceRequired && day.status === 'missing').length,
      days,
    };
  });
}
