import { prisma } from '@/lib/prisma';
import { STANDARD_DAY_MILLISECONDS } from '@/lib/attendance';
import { resolveAttendanceCalendarDay } from '@/lib/attendance-calendar';
import { isEmployeeEmployedOnDate, productionEmployeeWhere } from '@/lib/production-workforce';
import { chinaDate } from '@/lib/production-planning';
import { planningDateKeys, type PlanningDateRange } from '@/lib/planning-date-range';

export type PlanningCapacityMetric = {
  scheduledMilliseconds: string;
  attendanceScopeScheduledMilliseconds: string;
  frozenMilliseconds: string;
  executableMilliseconds: string;
  plannedCapacityMilliseconds: string;
  confirmedAttendanceMilliseconds: string;
  missingTimeBatchCount: number;
  batchCount: number;
  frozenBatchCount: number;
  employeeCount: number;
  workdayCount: number;
  confirmedAttendanceRecordCount: number;
  capacitySource: 'planned' | 'confirmed_attendance' | 'mixed';
};

export async function loadPlanningCapacity(
  range: PlanningDateRange,
  options: { now?: Date } = {},
): Promise<PlanningCapacityMetric> {
  const now = options.now || new Date();
  const [batches, employees, attendance, overrides] = await Promise.all([
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        plannedCompletionDate: { gte: range.start, lt: range.endExclusive },
        planOrder: { deletedAt: null },
      },
      select: {
        quantity: true,
        plannedCompletionDate: true,
        totalMillisecondsSnapshot: true,
        unitMillisecondsSnapshot: true,
        planOrder: { select: { planningUnitMilliseconds: true } },
        holds: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
    }),
    prisma.employee.findMany({
      where: productionEmployeeWhere(),
      select: { id: true, hireDate: true, resignedAt: true },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        workDate: { gte: range.start, lt: range.endExclusive },
        status: 'confirmed',
        employee: productionEmployeeWhere({ requireActive: false }),
      },
      select: { workDate: true, actualMilliseconds: true },
    }),
    prisma.attendanceCalendarDay.findMany({
      where: { workDate: { gte: range.start, lt: range.endExclusive } },
      select: { workDate: true, dayType: true, label: true, remark: true },
    }),
  ]);
  let scheduled = 0n;
  let attendanceScopeScheduled = 0n;
  let frozen = 0n;
  let missingTimeBatchCount = 0;
  let frozenBatchCount = 0;
  for (const batch of batches) {
    const total = batch.totalMillisecondsSnapshot
      ?? (batch.unitMillisecondsSnapshot || batch.planOrder.planningUnitMilliseconds
        ? BigInt((batch.unitMillisecondsSnapshot || batch.planOrder.planningUnitMilliseconds)!) * BigInt(batch.quantity)
        : null);
    if (total === null) {
      missingTimeBatchCount += 1;
      continue;
    }
    scheduled += total;
    if (chinaDate(batch.plannedCompletionDate) <= chinaDate(now)) attendanceScopeScheduled += total;
    if (batch.holds.length) {
      frozen += total;
      frozenBatchCount += 1;
    }
  }
  const overrideByDate = new Map(overrides.map(item => [chinaDate(item.workDate), item]));
  let plannedCapacity = 0n;
  let workdayCount = 0;
  const dateKeys = planningDateKeys(range);
  for (const dateKey of dateKeys) {
    const override = overrideByDate.get(dateKey);
    const day = resolveAttendanceCalendarDay(dateKey, override ? {
      dayType: override.dayType as 'default' | 'holiday' | 'temporary_workday',
      label: override.label,
      remark: override.remark,
    } : null);
    if (!day.isWorkday) continue;
    workdayCount += 1;
    const availableEmployees = employees.filter(employee => isEmployeeEmployedOnDate(employee, dateKey)).length;
    plannedCapacity += BigInt(availableEmployees * STANDARD_DAY_MILLISECONDS);
  }
  const confirmedAttendance = attendance.reduce((sum, record) => sum + BigInt(record.actualMilliseconds), 0n);
  const todayKey = chinaDate(now);
  const capacitySource = range.endDate < todayKey
    ? 'confirmed_attendance'
    : range.startDate > todayKey
      ? 'planned'
      : 'mixed';
  return {
    scheduledMilliseconds: scheduled.toString(),
    attendanceScopeScheduledMilliseconds: attendanceScopeScheduled.toString(),
    frozenMilliseconds: frozen.toString(),
    executableMilliseconds: (scheduled - frozen).toString(),
    plannedCapacityMilliseconds: plannedCapacity.toString(),
    confirmedAttendanceMilliseconds: confirmedAttendance.toString(),
    missingTimeBatchCount,
    batchCount: batches.length,
    frozenBatchCount,
    employeeCount: employees.length,
    workdayCount,
    confirmedAttendanceRecordCount: attendance.length,
    capacitySource,
  };
}
