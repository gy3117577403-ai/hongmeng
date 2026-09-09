import {
  basisPoints,
  dateKeyFromDatabase,
  parseAttainmentStream,
  parseWorkDate,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { employeePolicyChanges } from '@/lib/employee-attainment-policy-service';
import { policyForWorkDate } from '@/lib/employee-attainment-policy';
import {
  aggregateDailyAttainment,
  shouldIncludeEmployeeInAttainmentReport,
  type DailyAttainmentInput,
} from '@/lib/employee-attainment-daily';
import {
  attendanceDayMetrics,
  laborPerformanceMetrics,
} from '@/lib/report-labor-metrics';
import { safeLaborMilliseconds } from '@/lib/process-labor-service';
import { serializeEmployee } from '@/lib/process-time';
import { reportRangeDateKeys } from '@/lib/report-date-range';
import { resolveAttendanceCalendarDay, type AttendanceCalendarDayType } from '@/lib/attendance-calendar';
import { employeeHoursDayMetrics, aggregateEmployeeHours, EMPLOYEE_HOURS_METRIC_VERSION } from '@/lib/employee-hours-metrics';
import type { Prisma } from '@prisma/client';
import type { ReportCenterPeriodDTO } from '@/types';
import {
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  isEmployeeEmployedOnDate,
  productionEmployeeWhere,
} from '@/lib/production-workforce';
import type {
  AttendanceType,
  AttainmentStream,
  EmployeeAttainmentDayDTO,
  EmployeeAttainmentRowDTO,
  ProcessExecutionDTO,
} from '@/types';


function emptyRow(employee: Parameters<typeof serializeEmployee>[0]): EmployeeAttainmentRowDTO {
  return {
    employee: serializeEmployee(employee),
    attainmentEligible: employee.attainmentEligible,
    attainmentFactorBasisPoints: employee.attainmentFactorBasisPoints,
    attainmentStream: parseAttainmentStream(employee.attainmentStream),
    standardLaborMilliseconds: 0,
    legacyExecutionStandardLaborMilliseconds: 0,
    claimedStandardLaborMilliseconds: 0,
    unmatchedStandardLaborMilliseconds: 0,
    actualLaborMilliseconds: 0,
    attendanceMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    effectiveProductionMilliseconds: 0,
    attainmentCapacityMilliseconds: 0,
    unexplainedMilliseconds: 0,
    attendanceConfirmedDays: 0,
    attendanceMissingDays: 0,
    attendanceMissing: true,
    attainmentBasisPoints: null,
    processEfficiencyBasisPoints: 0,
    rawAttendanceOutputBasisPoints: null,
    coverageBasisPoints: null,
    goodQty: 0,
    scrapQty: 0,
    reworkQty: 0,
    executionCount: 0,
    claimCount: 0,
    claimQuantity: 0,
    days: [],
    details: [],
    claimDetails: [],
  };
}

type DailyAttainment = DailyAttainmentInput & {
  attainmentPolicyOverride?: boolean;
  attainmentPolicyReason?: string | null;
  attainmentPolicyEffectiveDate?: string | null;
  attendanceStatus: 'missing' | 'draft' | 'confirmed';
  attendanceType: AttendanceType | null;
  scheduledMilliseconds: number;
  scheduledOverrideMilliseconds: number | null;
  plannedOvertimeMilliseconds: number;
  actualOvertimeMilliseconds: number;
  leaveMilliseconds: number;
};

function emptyDailyAttainment(
  attainmentEligible = true,
  attainmentFactorBasisPoints = attainmentEligible ? 10_000 : 0,
  attainmentStream: AttainmentStream = attainmentEligible ? 'batch' : 'excluded',
): DailyAttainment {
  return {
    attendanceMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 0,
    claimedStandardLaborMilliseconds: 0,
    actualLaborMilliseconds: 0,
    attendanceConfirmed: false,
    excludedFromAttainmentBase: false,
    attainmentEligible,
    attainmentFactorBasisPoints,
    attainmentStream,
    attendanceStatus: 'missing',
    attendanceType: null,
    scheduledMilliseconds: 0,
    scheduledOverrideMilliseconds: null,
    plannedOvertimeMilliseconds: 0,
    actualOvertimeMilliseconds: 0,
    leaveMilliseconds: 0,
  };
}

function shanghaiDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function employeeDayDto(date: string, day: DailyAttainment): EmployeeAttainmentDayDTO {
  const hours = employeeHoursDayMetrics(day);
  const attendance = attendanceDayMetrics({
    attendanceType: day.attendanceType,
    scheduledMilliseconds: day.isFuture ? 0 : day.scheduledOverrideMilliseconds ?? day.scheduledMilliseconds,
    plannedOvertimeMilliseconds: day.isFuture ? 0 : day.plannedOvertimeMilliseconds,
    actualOvertimeMilliseconds: hours.recognizedOvertimeMilliseconds,
    leaveMilliseconds: day.isFuture ? 0 : day.leaveMilliseconds,
    actualAttendanceMilliseconds: hours.attendanceMilliseconds,
    overtimeBasis: 'actual_confirmed',
  });
  const exclusionReason: EmployeeAttainmentDayDTO['exclusionReason'] = day.isFuture ? 'future'
    : day.attainmentEligible === false || day.attainmentStream !== 'batch' ? 'excluded_stream'
    : !hours.attainmentDataComplete ? 'missing_attendance'
    : hours.attendanceMilliseconds <= 0 ? 'zero_attendance' : null;
  const includedInAttainment = exclusionReason === null;
  const performance = laborPerformanceMetrics({ ...hours, attainmentFactorBasisPoints: 10_000 });
  return {
    ...hours,
    teamSnapshot: day.teamSnapshot,
    date,
    attendanceRequired: day.attendanceRequired,
    attainmentEligible: day.attainmentEligible,
    attainmentStream: day.attainmentStream,
    attainmentPolicyOverride: day.attainmentPolicyOverride,
    attainmentPolicyReason: day.attainmentPolicyReason,
    attainmentPolicyEffectiveDate: day.attainmentPolicyEffectiveDate,
    attainmentFactorBasisPoints: day.attainmentFactorBasisPoints,
    isFuture: day.isFuture,
    attendanceStatus: day.attendanceStatus,
    attendanceType: day.attendanceType,
    scheduledMilliseconds: attendance.scheduledMilliseconds,
    plannedOvertimeMilliseconds: day.isFuture ? 0 : day.plannedOvertimeMilliseconds,
    recognizedOvertimeMilliseconds: hours.recognizedOvertimeMilliseconds,
    actualOvertimeMilliseconds: hours.actualOvertimeMilliseconds,
    leaveDeductionMilliseconds: attendance.leaveDeductionMilliseconds,
    netExpectedMilliseconds: attendance.netExpectedMilliseconds,
    attendanceMilliseconds: hours.attendanceMilliseconds,
    extraAttendanceMilliseconds: attendance.extraAttendanceMilliseconds,
    actualLaborMilliseconds: hours.actualLaborMilliseconds,
    standardLaborMilliseconds: hours.standardLaborMilliseconds,
    claimedStandardLaborMilliseconds: hours.claimedStandardLaborMilliseconds,
    exemptAbnormalMilliseconds: hours.exemptAbnormalMilliseconds,
    unexplainedMilliseconds: performance.unexplainedMilliseconds,
    overlapMilliseconds: performance.overlapMilliseconds,
    attendanceBasisPoints: day.attendanceStatus === 'confirmed'
      ? attendance.attendanceBasisPoints
      : null,
    utilizationBasisPoints: day.attendanceStatus === 'confirmed'
      ? performance.utilizationBasisPoints
      : null,
    efficiencyBasisPoints: performance.efficiencyBasisPoints,
    targetAttainmentBasisPoints: hours.attainmentBasisPoints,
    attainmentCapacityMilliseconds: hours.attainmentCapacityMilliseconds,
    overtimeSource: attendance.overtimeSource,
    includedInAttainment,
    exclusionReason,
  };
}

export async function loadEmployeeHoursReport(input: {
  period: ReportCenterPeriodDTO; date: string; start: Date; end: Date;
  employeeIdConstraint?: string | Prisma.StringFilter; now?: Date;
}) {
  const { period, date, start, end, employeeIdConstraint } = input;
  const now = input.now || new Date();
  const currentDateKey = shanghaiDateKey(now);
  const startDate = parseWorkDate(shanghaiDateKey(start)).value;
  const endDate = parseWorkDate(shanghaiDateKey(end)).value;
  const tomorrow = new Date(parseWorkDate(currentDateKey).value.getTime() + 86_400_000);
  const factDateEnd = new Date(Math.min(endDate.getTime(), tomorrow.getTime()));
  const factEnd = new Date(Math.min(end.getTime(), now.getTime() + 1));
  const dateKeys = reportRangeDateKeys(start, end);
    const productionAttendanceRangeWhere = {
      workDate: { gte: startDate, lt: factDateEnd },
      ...attendanceRecordScopeWhere('PRODUCTION'),
    };
    const otherWorkFacts = await prisma.otherWorkTimeRequest.findMany({
      where: { status: 'APPROVED', voidedAt: null, workDate: { gte: startDate, lt: factDateEnd },
        ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}) },
      select: { employeeId: true, workDate: true, approvedMinutes: true, attainmentEligibleSnapshot: true, attainmentStreamSnapshot: true, teamSnapshot: true },
    });
    const [executions, laborClaims, employees, attendanceRecords, capacityOverrides, abnormalAllocations, calendarOverrides, rosterRecords] = await Promise.all([
      prisma.processExecution.findMany({
        where: {
          voidedAt: null,
          endedAt: { gte: start, lt: factEnd },
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
        },
        include: {
          employee: true,
          step: {
            include: {
              route: {
                include: {
                  workOrder: {
                    select: {
                      id: true,
                      code: true,
                      customerName: true,
                      specification: true,
                      productName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ endedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.processLaborClaim.findMany({
        where: {
          status: 'ACTIVE',
          voidedAt: null,
          pool: { status: { not: 'VOIDED' }, completion: { voidedAt: null } },
          standardLaborMilliseconds: { gt: 0 },
          workDate: { gte: startDate, lt: factDateEnd },
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
        },
        include: {
          employee: true,
          pool: {
            include: {
              workOrder: {
                select: {
                  id: true,
                  code: true,
                  customerName: true,
                  specification: true,
                  productName: true,
                },
              },
              step: {
                select: {
                  processCode: true,
                  processName: true,
                  unitLabel: true,
                },
              },
              completion: {
                select: {
                  unitLabel: true,
                  reportQuantityBasis: true,
                  reportUnitLabel: true,
                  completedAt: true,
                  workStartedAt: true,
                  workEndedAt: true,
                  participants: { select: { employeeId: true } },
                },
              },
            },
          },
        },
        orderBy: [{ workDate: 'desc' }, { claimedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.employee.findMany({
        where: {
          AND: [employeeHiredBeforeWhere(endDate)],
          ...(employeeIdConstraint ? { id: employeeIdConstraint } : {}),
          OR: [
            productionEmployeeWhere({ requireActive: false, requireAttendance: false }),
            { laborClaims: { some: { status: 'ACTIVE', workDate: { gte: startDate, lt: factDateEnd } } } },
            { executions: { some: { voidedAt: null, endedAt: { gte: start, lt: factEnd } } } },
            { attendanceRecords: { some: productionAttendanceRangeWhere } },
            { id: { in: otherWorkFacts.map(item => item.employeeId) } },
          ],
        },
        orderBy: [{ employeeNo: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: {
          ...productionAttendanceRangeWhere,
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
        },
        select: {
          employeeId: true,
          departmentSnapshot: true,
          teamSnapshot: true,
          attainmentEligibleSnapshot: true,
          attainmentFactorBasisPointsSnapshot: true,
          attainmentStreamSnapshot: true,
          attainmentPolicyOverride: true,
          attainmentPolicyReason: true,
          workDate: true,
          status: true,
          attendanceType: true,
          plannedMilliseconds: true,
          actualMilliseconds: true,
          overtimeMilliseconds: true,
          leaveMilliseconds: true,
        },
      }),
      prisma.dailyCapacityOverride.findMany({
        where: {
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
          plan: {
            workDate: { gte: startDate, lt: factDateEnd },
            status: { in: ['CONFIRMED', 'IN_PROGRESS', 'ARCHIVED'] },
          },
        },
        orderBy: { updatedAt: 'asc' },
        select: {
          employeeId: true,
          regularMilliseconds: true,
          overtimeMilliseconds: true,
          plan: { select: { workDate: true } },
        },
      }),
      prisma.abnormalTimeAllocation.findMany({
        where: {
          workDate: { gte: startDate, lt: factDateEnd },
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
          event: { deletedAt: null, employeeExempt: true, qualityStatus: 'confirmed' },
        },
        select: {
          employeeId: true,
          workDate: true,
          durationMilliseconds: true,
          event: { select: { approvedDurationMilliseconds: true } },
        },
      }),
      prisma.attendanceCalendarDay.findMany({
        where: { workDate: { gte: startDate, lt: endDate } },
        select: { workDate: true, dayType: true, label: true, remark: true },
      }),
      // A SELF/TEAM projection must use the same opened production dates as the full report.
      // Only date keys are read here; no out-of-scope personal attendance is exposed.
      prisma.attendanceRecord.findMany({
        where: productionAttendanceRangeWhere,
        distinct: ['workDate'],
        select: { workDate: true },
      }),
    ]);
    const productionEmployeeIds = new Set(employees.map(employee => employee.id));
    const policyHistory = await employeePolicyChanges(prisma, employees.map(employee => employee.id));
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    const groups = new Map<string, EmployeeAttainmentRowDTO>();
    for (const employee of employees) groups.set(employee.id, emptyRow(employee));
    const employeeConfiguration = new Map(employees.map(employee => [employee.id, {
      eligible: employee.attainmentEligible,
      factor: employee.attainmentFactorBasisPoints,
      stream: parseAttainmentStream(employee.attainmentStream),
    }]));
    const dailyGroups = new Map<string, Map<string, DailyAttainment>>();
    const activityEmployeeIds = new Set<string>();
    const dailyFor = (employeeIdValue: string, workDate: string) => {
      let employeeDays = dailyGroups.get(employeeIdValue);
      if (!employeeDays) {
        employeeDays = new Map();
        dailyGroups.set(employeeIdValue, employeeDays);
      }
      let daily = employeeDays.get(workDate);
      if (!daily) {
        const historical = policyForWorkDate(employeeById.get(employeeIdValue) || {}, policyHistory.get(employeeIdValue) || [], workDate);
        const configuration = historical.hasHistory ? { eligible: historical.policy.attainmentEligible, factor: historical.policy.attainmentFactorBasisPoints, stream: historical.policy.attainmentStream } : employeeConfiguration.get(employeeIdValue);
        daily = emptyDailyAttainment(
          configuration?.eligible ?? true,
          configuration?.factor ?? (configuration?.eligible === false ? 0 : 10_000),
          configuration?.stream ?? (configuration?.eligible === false ? 'excluded' : 'batch'),
        );
        employeeDays.set(workDate, daily);
      }
      return daily;
    };
    for (const other of otherWorkFacts) {
      if (!productionEmployeeIds.has(other.employeeId)) continue;
      const daily = dailyFor(other.employeeId, dateKeyFromDatabase(other.workDate));
      activityEmployeeIds.add(other.employeeId);
      daily.otherWorkMilliseconds = (daily.otherWorkMilliseconds || 0) + (other.approvedMinutes || 0) * 60_000;
      daily.otherWorkCount = (daily.otherWorkCount || 0) + 1;
      daily.attainmentEligible = other.attainmentEligibleSnapshot;
      daily.attainmentStream = parseAttainmentStream(other.attainmentStreamSnapshot);
      daily.teamSnapshot = other.teamSnapshot;
    }
    for (const attendance of attendanceRecords) {
      if (!productionEmployeeIds.has(attendance.employeeId)) continue;
      const attendanceDateKey = dateKeyFromDatabase(attendance.workDate);
      if (!isEmployeeEmployedOnDate(employeeById.get(attendance.employeeId), attendanceDateKey)) continue;
      const row = groups.get(attendance.employeeId);
      if (!row) continue;
      activityEmployeeIds.add(attendance.employeeId);
      const daily = dailyFor(attendance.employeeId, attendanceDateKey);
      daily.teamSnapshot = attendance.teamSnapshot || daily.teamSnapshot;
      daily.attainmentPolicyOverride = attendance.attainmentPolicyOverride;
      daily.attainmentPolicyReason = attendance.attainmentPolicyReason;
      daily.attendanceStatus = attendance.status === 'confirmed' ? 'confirmed' : 'draft';
      daily.attendanceType = ['partial_leave', 'leave', 'absent', 'rest'].includes(attendance.attendanceType)
        ? attendance.attendanceType as AttendanceType
        : 'normal';
      daily.excludedFromAttainmentBase = attendance.status === 'confirmed'
        && ['leave', 'absent', 'rest'].includes(attendance.attendanceType);
      daily.scheduledMilliseconds = Math.max(0, attendance.plannedMilliseconds);
      daily.actualOvertimeMilliseconds = Math.max(0, attendance.overtimeMilliseconds);
      daily.leaveMilliseconds = Math.max(0, attendance.leaveMilliseconds);
      daily.attainmentEligible = attendance.attainmentEligibleSnapshot
        ?? daily.attainmentEligible
        ?? true;
      daily.attainmentFactorBasisPoints = attendance.attainmentFactorBasisPointsSnapshot
        ?? employeeConfiguration.get(attendance.employeeId)?.factor
        ?? (daily.attainmentEligible ? 10_000 : 0);
      daily.attainmentStream = parseAttainmentStream(
        attendance.attainmentStreamSnapshot,
        daily.attainmentStream
          ?? (daily.attainmentEligible ? 'batch' : 'excluded'),
      );
      daily.attendanceConfirmed = attendance.status === 'confirmed';
      if (attendance.status !== 'confirmed') continue;
      daily.attendanceMilliseconds += Math.max(0, attendance.actualMilliseconds);
      row.attendanceMilliseconds += Math.max(0, attendance.actualMilliseconds);
      row.attendanceConfirmedDays += 1;
    }
    // The latest confirmed capacity override is authoritative for a person/day.
    // It changes the denominator only; actual attendance already includes overtime.
    for (const override of capacityOverrides) {
      if (!productionEmployeeIds.has(override.employeeId)) continue;
      const overrideDateKey = dateKeyFromDatabase(override.plan.workDate);
      if (!isEmployeeEmployedOnDate(employeeById.get(override.employeeId), overrideDateKey)) continue;
      const daily = dailyFor(override.employeeId, overrideDateKey);
      daily.scheduledOverrideMilliseconds = Math.max(0, override.regularMilliseconds);
      daily.plannedOvertimeMilliseconds = Math.max(0, override.overtimeMilliseconds);
    }
    for (const allocation of abnormalAllocations) {
      if (!productionEmployeeIds.has(allocation.employeeId)) continue;
      const allocationDateKey = dateKeyFromDatabase(allocation.workDate);
      if (!isEmployeeEmployedOnDate(employeeById.get(allocation.employeeId), allocationDateKey)) continue;
      const row = groups.get(allocation.employeeId);
      if (row) {
        const approvedDuration = allocation.event.approvedDurationMilliseconds
          ?? allocation.durationMilliseconds;
        activityEmployeeIds.add(allocation.employeeId);
        dailyFor(
          allocation.employeeId,
          allocationDateKey,
        ).exemptAbnormalMilliseconds += approvedDuration;
        row.exemptAbnormalMilliseconds += approvedDuration;
      }
    }
    for (const execution of executions) {
      if (!productionEmployeeIds.has(execution.employeeId)) continue;
      const executionDateKey = shanghaiDateKey(execution.endedAt);
      if (!isEmployeeEmployedOnDate(employeeById.get(execution.employeeId), executionDateKey)) continue;
      const workOrder = execution.step.route.workOrder;
      const detail: ProcessExecutionDTO = {
        id: execution.id,
        stepId: execution.stepId,
        employee: serializeEmployee(execution.employee),
        workOrderId: workOrder.id,
        workOrderCode: workOrder.code,
        customerName: workOrder.customerName,
        specification: workOrder.specification,
        productName: workOrder.productName,
        processCode: execution.step.processCode,
        processName: execution.step.processName,
        startedAt: execution.startedAt.toISOString(),
        endedAt: execution.endedAt.toISOString(),
        breakMilliseconds: execution.breakMilliseconds,
        goodQty: execution.goodQty,
        scrapQty: execution.scrapQty,
        reworkQty: execution.reworkQty,
        timeBasis: execution.timeBasis === 'per_batch' ? 'per_batch' : 'per_unit',
        unitLabel: execution.unitLabel,
        standardMillisecondsPerUnit: execution.standardMillisecondsPerUnit,
        setupMilliseconds: execution.setupMilliseconds,
        unitsPerProduct: execution.unitsPerProduct,
        standardLaborMilliseconds: execution.standardLaborMilliseconds,
        actualLaborMilliseconds: execution.actualLaborMilliseconds,
        attainmentBasisPoints: execution.attainmentBasisPoints,
        countsForEfficiency: execution.countsForEfficiency,
        source: execution.source,
        standardSource: execution.standardSource,
        productTimeProfileVersion: execution.productTimeProfileVersion,
        remark: execution.remark,
        createdAt: execution.createdAt.toISOString(),
      };
      const row = groups.get(execution.employeeId) || emptyRow(execution.employee);
      activityEmployeeIds.add(execution.employeeId);
      if (execution.countsForEfficiency) {
        row.legacyExecutionStandardLaborMilliseconds += execution.standardLaborMilliseconds;
        row.actualLaborMilliseconds += execution.actualLaborMilliseconds;
        const daily = dailyFor(execution.employeeId, executionDateKey);
        daily.standardLaborMilliseconds += execution.standardLaborMilliseconds;
        daily.actualLaborMilliseconds += execution.actualLaborMilliseconds;
      }
      row.goodQty += execution.goodQty;
      row.scrapQty += execution.scrapQty;
      row.reworkQty += execution.reworkQty;
      row.executionCount += 1;
      row.details.push(detail);
      groups.set(execution.employeeId, row);
    }
    const claimActualEvidence = new Set<string>();
    for (const claim of laborClaims) {
      if (!productionEmployeeIds.has(claim.employeeId)) continue;
      const claimDateKey = dateKeyFromDatabase(claim.workDate);
      if (!isEmployeeEmployedOnDate(employeeById.get(claim.employeeId), claimDateKey)) continue;
      const standardLaborMilliseconds = safeLaborMilliseconds(claim.standardLaborMilliseconds);
      const row = groups.get(claim.employeeId) || emptyRow(claim.employee);
      activityEmployeeIds.add(claim.employeeId);
      const claimDaily = dailyFor(claim.employeeId, claimDateKey);
      if (claim.pool.countsForEfficiency) {
        claimDaily.standardLaborMilliseconds += standardLaborMilliseconds;
        claimDaily.claimedStandardLaborMilliseconds += standardLaborMilliseconds;
        const completion = claim.pool.completion;
        const evidenceKey = `${claim.poolId}:${claim.employeeId}`;
        if (
          completion.workStartedAt
          && completion.workEndedAt
          && completion.participants.some(participant => participant.employeeId === claim.employeeId)
          && !claimActualEvidence.has(evidenceKey)
        ) {
          const actualLaborMilliseconds = Math.max(
            0,
            completion.workEndedAt.getTime() - completion.workStartedAt.getTime(),
          );
          claimDaily.actualLaborMilliseconds += actualLaborMilliseconds;
          row.actualLaborMilliseconds += actualLaborMilliseconds;
          claimActualEvidence.add(evidenceKey);
        }
      }
      row.claimCount += 1;
      row.claimQuantity += claim.quantity;
      row.claimDetails.push({
        countsForEfficiency: claim.pool.countsForEfficiency,
        id: claim.id,
        poolId: claim.poolId,
        employee: serializeEmployee(claim.employee),
        workOrderId: claim.pool.workOrder.id,
        workOrderCode: claim.pool.workOrder.code,
        customerName: claim.pool.workOrder.customerName,
        specification: claim.pool.workOrder.specification,
        productName: claim.pool.workOrder.productName,
        processCode: claim.pool.step.processCode,
        processName: claim.pool.step.processName,
        workDate: claim.workDate.toISOString().slice(0, 10),
        quantity: claim.quantity,
        unitLabel: claim.pool.completion.reportQuantityBasis === 'action'
          ? claim.pool.completion.reportUnitLabel
          : claim.pool.completion.unitLabel || claim.pool.step.unitLabel || '件',
        standardLaborMilliseconds,
        claimedAt: claim.claimedAt.toISOString(),
        reportedAt: claim.pool.completion.completedAt.toISOString(),
        attendanceMatched: claimDaily.attendanceConfirmed,
        standardSource: claim.pool.standardSource,
        productTimeProfileVersion: claim.pool.productTimeProfileVersion,
        corrected: claim.pool.standardSource === 'supervisor_correction',
      });
      groups.set(claim.employeeId, row);
    }
    const calendarByDate = new Map(calendarOverrides.map(item => [dateKeyFromDatabase(item.workDate), item]));
    const rosterDates = new Set(rosterRecords.map(record => dateKeyFromDatabase(record.workDate)));
    for (const row of groups.values()) {
      const days = dailyGroups.get(row.employee.id) || new Map<string, DailyAttainment>();
      const employedDateKeys = dateKeys.filter(dateKey => isEmployeeEmployedOnDate(row.employee, dateKey));
      const dailyInputs = employedDateKeys.map(dateKey => {
        const existing = days.get(dateKey);
        const historical = policyForWorkDate(row.employee, policyHistory.get(row.employee.id) || [], dateKey);
        const day = existing || emptyDailyAttainment(historical.policy.attainmentEligible, historical.policy.attainmentFactorBasisPoints, historical.policy.attainmentStream);
        if (historical.effectiveDate && !day.attainmentPolicyOverride) {
          day.attainmentEligible = historical.policy.attainmentEligible;
          day.attainmentStream = historical.policy.attainmentStream;
          day.attainmentFactorBasisPoints = historical.policy.attainmentFactorBasisPoints;
          day.teamSnapshot = historical.policy.team || day.teamSnapshot;
          day.attainmentPolicyEffectiveDate = historical.effectiveDate;
        }
        day.teamSnapshot ||= row.employee.team || row.employee.position || '未分组';
        const override = calendarByDate.get(dateKey);
        const calendar = resolveAttendanceCalendarDay(dateKey, override ? { ...override, dayType: override.dayType as AttendanceCalendarDayType } : null);
        day.isFuture = dateKey > currentDateKey;
        day.attendanceRequired = !day.isFuture && (
          day.attendanceStatus !== 'missing' || day.scheduledOverrideMilliseconds !== null
          || (calendar.isWorkday && calendar.effectiveDayType !== 'temporary_workday' && rosterDates.has(dateKey) && row.employee.isActive && row.employee.attendanceEnabled)
        );
        return day;
      });
      row.days = dailyInputs.map((day, index) => employeeDayDto(employedDateKeys[index], day));
      row.attainmentEligible = dailyInputs.some(day =>
        day.attainmentEligible
        && day.attainmentStream === 'batch'
        && !day.isFuture)
        || (dailyInputs.length === 0
          && row.employee.attainmentEligible
          && row.employee.attainmentStream === 'batch'
          );
      row.attainmentFactorBasisPoints = row.employee.attainmentFactorBasisPoints;
      // Period presentation must agree with historical daily eligibility even after a personnel change.
      row.attainmentStream = row.attainmentEligible ? 'batch' : dailyInputs.find(day => !day.isFuture)?.attainmentStream ?? row.employee.attainmentStream;
      const dailySummary = aggregateDailyAttainment(dailyInputs);
      Object.assign(row, dailySummary);
      row.attendanceConfirmedDays = dailyInputs.filter(day => day.attendanceConfirmed && !day.isFuture).length;
      row.standardLaborMilliseconds = dailySummary.standardLaborMilliseconds;
      row.claimedStandardLaborMilliseconds = dailySummary.claimedStandardLaborMilliseconds;
      row.unmatchedStandardLaborMilliseconds = dailySummary.unmatchedStandardLaborMilliseconds;
      row.effectiveProductionMilliseconds = dailySummary.effectiveProductionMilliseconds;
      row.attainmentCapacityMilliseconds = dailySummary.attainmentCapacityMilliseconds;
      row.unexplainedMilliseconds = dailySummary.unexplainedMilliseconds;
      row.attendanceMissingDays = dailySummary.attendanceMissingDays;
      row.attendanceMissing = row.attendanceConfirmedDays === 0 || row.attendanceMissingDays > 0;
      row.attainmentBasisPoints = dailySummary.attainmentBasisPoints;
      row.processEfficiencyBasisPoints = basisPoints(
        row.standardLaborMilliseconds,
        row.actualLaborMilliseconds,
      );
      row.rawAttendanceOutputBasisPoints = basisPoints(row.standardLaborMilliseconds, row.attendanceMilliseconds);
      row.coverageBasisPoints = basisPoints(
        Math.min(row.attendanceMilliseconds, row.actualLaborMilliseconds + row.exemptAbnormalMilliseconds + (row.otherWorkMilliseconds || 0)),
        row.attendanceMilliseconds,
      );
    }
    const rows = [...groups.values()]
      .filter(row => shouldIncludeEmployeeInAttainmentReport({
        isActive: row.employee.isActive,
        hasPeriodActivity: activityEmployeeIds.has(row.employee.id),
      }))
      .sort((left, right) =>
      (right.attainmentBasisPoints ?? -1) - (left.attainmentBasisPoints ?? -1)
      || right.standardLaborMilliseconds - left.standardLaborMilliseconds
      || left.employee.employeeNo.localeCompare(right.employee.employeeNo, 'zh-CN'));
    const summaryBase = rows.reduce((result, row) => ({
      employeeCount: result.employeeCount + 1,
      executionCount: result.executionCount + row.executionCount,
      claimCount: result.claimCount + row.claimCount,
      claimQuantity: result.claimQuantity + row.claimQuantity,
      standardLaborMilliseconds: result.standardLaborMilliseconds + row.standardLaborMilliseconds,
      legacyExecutionStandardLaborMilliseconds: result.legacyExecutionStandardLaborMilliseconds
        + row.legacyExecutionStandardLaborMilliseconds,
      claimedStandardLaborMilliseconds: result.claimedStandardLaborMilliseconds
        + row.claimedStandardLaborMilliseconds,
      unmatchedStandardLaborMilliseconds: result.unmatchedStandardLaborMilliseconds
        + row.unmatchedStandardLaborMilliseconds,
      actualLaborMilliseconds: result.actualLaborMilliseconds + row.actualLaborMilliseconds,
      attendanceMilliseconds: result.attendanceMilliseconds + row.attendanceMilliseconds,
      exemptAbnormalMilliseconds: result.exemptAbnormalMilliseconds + row.exemptAbnormalMilliseconds,
      effectiveProductionMilliseconds: result.effectiveProductionMilliseconds + row.effectiveProductionMilliseconds,
      attainmentCapacityMilliseconds: result.attainmentCapacityMilliseconds + row.attainmentCapacityMilliseconds,
      unexplainedMilliseconds: result.unexplainedMilliseconds + row.unexplainedMilliseconds,
      attendanceConfirmedDays: result.attendanceConfirmedDays + row.attendanceConfirmedDays,
      attendanceMissingDays: result.attendanceMissingDays + row.attendanceMissingDays,
      attendanceMissingCount: result.attendanceMissingCount + (row.attendanceMissing ? 1 : 0),
      attainmentBasisPoints: null as number | null,
      processEfficiencyBasisPoints: 0,
      rawAttendanceOutputBasisPoints: null as number | null,
      coverageBasisPoints: null as number | null,
      goodQty: result.goodQty + row.goodQty,
      scrapQty: result.scrapQty + row.scrapQty,
      reworkQty: result.reworkQty + row.reworkQty,
    }), {
      employeeCount: 0,
      executionCount: 0,
      claimCount: 0,
      claimQuantity: 0,
      standardLaborMilliseconds: 0,
      legacyExecutionStandardLaborMilliseconds: 0,
      claimedStandardLaborMilliseconds: 0,
      unmatchedStandardLaborMilliseconds: 0,
      actualLaborMilliseconds: 0,
      attendanceMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      effectiveProductionMilliseconds: 0,
      attainmentCapacityMilliseconds: 0,
      unexplainedMilliseconds: 0,
      attendanceConfirmedDays: 0,
      attendanceMissingDays: 0,
      attendanceMissingCount: 0,
      attainmentBasisPoints: null as number | null,
      processEfficiencyBasisPoints: 0,
      rawAttendanceOutputBasisPoints: null as number | null,
      coverageBasisPoints: null as number | null,
      goodQty: 0,
      scrapQty: 0,
      reworkQty: 0,
    });
    const combined = aggregateEmployeeHours(rows.flatMap(row => row.days.map(day => ({
      ...day, attendanceConfirmed: day.attendanceStatus === 'confirmed',
    }))));
    const summary = { ...summaryBase, ...combined, processEfficiencyBasisPoints: null as number | null };
    summary.attainmentBasisPoints = combined.attainmentBasisPoints;
    summary.processEfficiencyBasisPoints = basisPoints(
      summary.standardLaborMilliseconds,
      summary.actualLaborMilliseconds,
    );
    summary.rawAttendanceOutputBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.attendanceMilliseconds);
    summary.coverageBasisPoints = basisPoints(
      Math.min(summary.attendanceMilliseconds, summary.actualLaborMilliseconds + summary.exemptAbnormalMilliseconds + summary.otherWorkMilliseconds),
      summary.attendanceMilliseconds,
    );

  return { employees, attendanceRecords, capacityOverrides, calendarOverrides, report: {
    metricVersion: EMPLOYEE_HOURS_METRIC_VERSION,
    period, date, workforceScope: 'PRODUCTION' as const, workforceLabel: '生产部',
    rangeStart: start.toISOString(), rangeEnd: end.toISOString(), generatedAt: now.toISOString(),
    summary, rows,
  } };
}
