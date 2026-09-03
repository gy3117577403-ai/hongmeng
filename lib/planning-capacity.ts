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

async function loadPlanningCapacitySnapshot(range: PlanningDateRange) {
  const [batches, employees, attendance, overrides, sourceWipLots, targetWipAllocations] = await Promise.all([
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
        holds: { where: { status: 'ACTIVE', holdType: { not: 'MATERIAL' } }, select: { id: true } },
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
    prisma.semiFinishedLot.findMany({
      where: {
        scheduleStatus: { not: 'CANCELLED' },
        productionPlanBatch: {
          plannedCompletionDate: { gte: range.start, lt: range.endExclusive },
          deletedAt: null,
        },
      },
      select: {
        productionPlanBatch: { select: { plannedCompletionDate: true } },
        steps: { select: { remainingStandardMilliseconds: true } },
      },
    }),
    prisma.wipWeekAllocation.findMany({
      where: {
        targetWeekStartDate: { gte: range.start, lt: range.endExclusive },
        status: { not: 'CANCELLED' },
      },
      select: {
        targetWeekStartDate: true,
        status: true,
        plannedStandardMilliseconds: true,
        completedStandardMilliseconds: true,
      },
    }),
  ]);
  return { batches, employees, attendance, overrides, sourceWipLots, targetWipAllocations };
}

export type PlanningCapacitySnapshot = Awaited<ReturnType<typeof loadPlanningCapacitySnapshot>>;

function dateInPlanningRange(value: Date, range: PlanningDateRange): boolean {
  const timestamp = value.getTime();
  return timestamp >= range.start.getTime() && timestamp < range.endExclusive.getTime();
}

export function summarizePlanningCapacitySnapshot(
  range: PlanningDateRange,
  snapshot: PlanningCapacitySnapshot,
  options: { now?: Date } = {},
): PlanningCapacityMetric {
  const now = options.now || new Date();
  const batches = snapshot.batches.filter(batch => dateInPlanningRange(batch.plannedCompletionDate, range));
  const employees = snapshot.employees;
  const attendance = snapshot.attendance.filter(record => dateInPlanningRange(record.workDate, range));
  const overrides = snapshot.overrides.filter(item => dateInPlanningRange(item.workDate, range));
  const sourceWipLots = snapshot.sourceWipLots.filter(lot => (
    dateInPlanningRange(lot.productionPlanBatch.plannedCompletionDate, range)
  ));
  const targetWipAllocations = snapshot.targetWipAllocations.filter(allocation => (
    dateInPlanningRange(allocation.targetWeekStartDate, range)
  ));
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
  // Dynamic weekly plan: unfinished labor moved into the WIP warehouse leaves
  // the source plan; only an effective target-week allocation adds it back.
  for (const lot of sourceWipLots) {
    const moved = lot.steps.reduce((sum, step) => sum + step.remainingStandardMilliseconds, 0n);
    scheduled = scheduled > moved ? scheduled - moved : 0n;
    if (chinaDate(lot.productionPlanBatch.plannedCompletionDate) <= chinaDate(now)) {
      attendanceScopeScheduled = attendanceScopeScheduled > moved
        ? attendanceScopeScheduled - moved
        : 0n;
    }
  }
  for (const allocation of targetWipAllocations) {
    const planned = allocation.status === 'SUPERSEDED'
      ? allocation.completedStandardMilliseconds
      : allocation.plannedStandardMilliseconds;
    scheduled += planned;
    if (chinaDate(allocation.targetWeekStartDate) <= chinaDate(now)) attendanceScopeScheduled += planned;
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
    batchCount: batches.length + targetWipAllocations.filter(item => item.status !== 'SUPERSEDED').length,
    frozenBatchCount,
    employeeCount: employees.length,
    workdayCount,
    confirmedAttendanceRecordCount: attendance.length,
    capacitySource,
  };
}

/**
 * Load one enclosing date range once, then derive each requested range in
 * memory. This keeps month + production-week capacity reads at a fixed six
 * Prisma queries instead of repeating the same employee, attendance, calendar,
 * batch and WIP reads for every week.
 */
export async function loadPlanningCapacities(
  queryRange: PlanningDateRange,
  ranges: readonly PlanningDateRange[],
  options: { now?: Date } = {},
): Promise<PlanningCapacityMetric[]> {
  if (!ranges.length) return [];
  for (const range of ranges) {
    if (
      range.start.getTime() < queryRange.start.getTime()
      || range.endExclusive.getTime() > queryRange.endExclusive.getTime()
    ) {
      throw new Error('容量分段日期必须位于查询范围内');
    }
  }
  const snapshot = await loadPlanningCapacitySnapshot(queryRange);
  const now = options.now || new Date();
  return ranges.map(range => summarizePlanningCapacitySnapshot(range, snapshot, { now }));
}

export async function loadPlanningCapacity(
  range: PlanningDateRange,
  options: { now?: Date } = {},
): Promise<PlanningCapacityMetric> {
  const [capacity] = await loadPlanningCapacities(range, [range], options);
  return capacity;
}
