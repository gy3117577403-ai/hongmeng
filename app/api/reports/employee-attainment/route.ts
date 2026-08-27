import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { employeeAttainmentScope } from '@/lib/employee-attainment-access';
import { abnormalTimeScopedEmployeeIds } from '@/lib/abnormal-time-access';
import {
  basisPoints,
  dateKeyFromDatabase,
  parseAttainmentStream,
  parseWorkDate,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
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
import { ReportDateRangeError, reportRangeDateKeys, reportRangeQuery } from '@/lib/report-date-range';
import {
  attendanceRecordScopeWhere,
  employeeHiredBeforeWhere,
  isEmployeeHiredOnDate,
  isProductionWorkforceEmployee,
  productionEmployeeWhere,
} from '@/lib/production-workforce';
import type {
  AttendanceType,
  AttainmentStream,
  EmployeeAttainmentDayDTO,
  EmployeeAttainmentRowDTO,
  ProcessExecutionDTO,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const factorBasisPoints = Math.max(0, Math.min(10_000, Math.round(
    day.attainmentFactorBasisPoints ?? (day.attainmentEligible === false ? 0 : 10_000),
  )));
  const attendance = attendanceDayMetrics({
    attendanceType: day.attendanceType,
    scheduledMilliseconds: day.scheduledOverrideMilliseconds ?? day.scheduledMilliseconds,
    plannedOvertimeMilliseconds: day.plannedOvertimeMilliseconds,
    plannedOvertimeConfirmed: day.scheduledOverrideMilliseconds !== null,
    actualOvertimeMilliseconds: day.actualOvertimeMilliseconds,
    leaveMilliseconds: day.leaveMilliseconds,
    actualAttendanceMilliseconds: day.attendanceStatus === 'confirmed'
      ? day.attendanceMilliseconds
      : 0,
    overtimeBasis: 'actual_confirmed',
  });
  let exclusionReason: EmployeeAttainmentDayDTO['exclusionReason'] = null;
  if (!day.attainmentEligible || day.attainmentStream !== 'batch' || factorBasisPoints <= 0) {
    exclusionReason = 'excluded_stream';
  } else if (day.attendanceStatus !== 'confirmed') {
    exclusionReason = 'missing_attendance';
  } else if (day.attendanceType === 'rest') {
    exclusionReason = 'rest';
  } else if (day.attendanceType === 'leave'
    || (attendance.netExpectedMilliseconds <= 0 && attendance.leaveDeductionMilliseconds > 0)) {
    exclusionReason = 'leave';
  } else if (day.attendanceType === 'absent') {
    exclusionReason = 'absent';
  } else if (attendance.actualAttendanceMilliseconds <= 0) {
    exclusionReason = 'zero_attendance';
  }
  const includedInAttainment = exclusionReason === null;
  const performance = laborPerformanceMetrics({
    attendanceMilliseconds: attendance.actualAttendanceMilliseconds,
    actualLaborMilliseconds: day.actualLaborMilliseconds,
    exemptAbnormalMilliseconds: day.exemptAbnormalMilliseconds,
    standardLaborMilliseconds: day.standardLaborMilliseconds,
    attainmentFactorBasisPoints: includedInAttainment ? factorBasisPoints : 0,
  });
  return {
    date,
    attendanceStatus: day.attendanceStatus,
    attendanceType: day.attendanceType,
    scheduledMilliseconds: attendance.scheduledMilliseconds,
    recognizedOvertimeMilliseconds: attendance.recognizedOvertimeMilliseconds,
    actualOvertimeMilliseconds: attendance.actualOvertimeMilliseconds,
    leaveDeductionMilliseconds: attendance.leaveDeductionMilliseconds,
    netExpectedMilliseconds: attendance.netExpectedMilliseconds,
    attendanceMilliseconds: attendance.actualAttendanceMilliseconds,
    extraAttendanceMilliseconds: attendance.extraAttendanceMilliseconds,
    actualLaborMilliseconds: Math.max(0, day.actualLaborMilliseconds),
    standardLaborMilliseconds: Math.max(0, day.standardLaborMilliseconds),
    claimedStandardLaborMilliseconds: Math.max(0, day.claimedStandardLaborMilliseconds),
    exemptAbnormalMilliseconds: Math.max(0, day.exemptAbnormalMilliseconds),
    unexplainedMilliseconds: performance.unexplainedMilliseconds,
    overlapMilliseconds: performance.overlapMilliseconds,
    attendanceBasisPoints: day.attendanceStatus === 'confirmed'
      ? attendance.attendanceBasisPoints
      : null,
    utilizationBasisPoints: day.attendanceStatus === 'confirmed'
      ? performance.utilizationBasisPoints
      : null,
    efficiencyBasisPoints: performance.efficiencyBasisPoints,
    targetAttainmentBasisPoints: includedInAttainment
      ? performance.targetAttainmentBasisPoints
      : null,
    attainmentCapacityMilliseconds: includedInAttainment
      ? performance.attainmentCapacityMilliseconds
      : 0,
    overtimeSource: attendance.overtimeSource,
    includedInAttainment,
    exclusionReason,
  };
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    const { period, date, start, end } = reportRangeQuery(req.nextUrl.searchParams);
    const requestedEmployeeId = String(req.nextUrl.searchParams.get('employeeId') || '').trim();
    let scopedEmployeeIds: string[] | null = null;
    const accessScope = employeeAttainmentScope(actor);
    if (accessScope === 'SELF') {
      const actorEmployee = actor.employee;
      if (!actorEmployee || !isProductionWorkforceEmployee(actorEmployee)) {
        return forbidden('账号未绑定生产部且已启用考勤的在职员工档案，无法查看生产达成率');
      }
      scopedEmployeeIds = [actorEmployee.id];
    } else if (accessScope === 'TEAM') {
      scopedEmployeeIds = await abnormalTimeScopedEmployeeIds(actor) ?? [];
    }
    if (
      requestedEmployeeId
      && scopedEmployeeIds
      && !scopedEmployeeIds.includes(requestedEmployeeId)
    ) {
      return forbidden('当前账号无权查看该员工的达成率');
    }
    const employeeIdConstraint = requestedEmployeeId
      || (scopedEmployeeIds ? { in: scopedEmployeeIds } : undefined);
    const startDate = parseWorkDate(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const endDate = parseWorkDate(end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const dateKeys = reportRangeDateKeys(start, end);
    const productionAttendanceWhere = {
      status: 'confirmed',
      workDate: { gte: startDate, lt: endDate },
      ...attendanceRecordScopeWhere('PRODUCTION'),
    };
    const productionAttendanceRangeWhere = {
      workDate: { gte: startDate, lt: endDate },
      ...attendanceRecordScopeWhere('PRODUCTION'),
    };
    const [executions, laborClaims, employees, attendanceRecords, capacityOverrides, abnormalAllocations] = await Promise.all([
      prisma.processExecution.findMany({
        where: {
          voidedAt: null,
          endedAt: { gte: start, lt: end },
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
          standardLaborMilliseconds: { gt: 0 },
          workDate: { gte: startDate, lt: endDate },
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
            productionEmployeeWhere(),
            { attendanceRecords: { some: productionAttendanceWhere } },
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
          attainmentEligibleSnapshot: true,
          attainmentFactorBasisPointsSnapshot: true,
          attainmentStreamSnapshot: true,
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
            workDate: { gte: startDate, lt: endDate },
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
          workDate: { gte: startDate, lt: endDate },
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
    ]);
    const productionEmployeeIds = new Set(employees.map(employee => employee.id));
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    if (requestedEmployeeId && !productionEmployeeIds.has(requestedEmployeeId)) {
      return NextResponse.json({
        ok: false,
        error: '该员工不在生产部考勤统计范围内',
      }, { status: 400 });
    }
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
        const configuration = employeeConfiguration.get(employeeIdValue);
        daily = emptyDailyAttainment(
          configuration?.eligible ?? true,
          configuration?.factor ?? (configuration?.eligible === false ? 0 : 10_000),
          configuration?.stream ?? (configuration?.eligible === false ? 'excluded' : 'batch'),
        );
        employeeDays.set(workDate, daily);
      }
      return daily;
    };
    for (const attendance of attendanceRecords) {
      if (!productionEmployeeIds.has(attendance.employeeId)) continue;
      const attendanceDateKey = dateKeyFromDatabase(attendance.workDate);
      if (!isEmployeeHiredOnDate(employeeById.get(attendance.employeeId), attendanceDateKey)) continue;
      const row = groups.get(attendance.employeeId);
      if (!row) continue;
      activityEmployeeIds.add(attendance.employeeId);
      const daily = dailyFor(attendance.employeeId, attendanceDateKey);
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
        ?? employeeConfiguration.get(attendance.employeeId)?.eligible
        ?? true;
      daily.attainmentFactorBasisPoints = attendance.attainmentFactorBasisPointsSnapshot
        ?? employeeConfiguration.get(attendance.employeeId)?.factor
        ?? (daily.attainmentEligible ? 10_000 : 0);
      daily.attainmentStream = parseAttainmentStream(
        attendance.attainmentStreamSnapshot,
        employeeConfiguration.get(attendance.employeeId)?.stream
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
      if (!isEmployeeHiredOnDate(employeeById.get(override.employeeId), overrideDateKey)) continue;
      const daily = dailyFor(override.employeeId, overrideDateKey);
      daily.scheduledOverrideMilliseconds = Math.max(0, override.regularMilliseconds);
      daily.plannedOvertimeMilliseconds = Math.max(0, override.overtimeMilliseconds);
    }
    for (const allocation of abnormalAllocations) {
      if (!productionEmployeeIds.has(allocation.employeeId)) continue;
      const allocationDateKey = dateKeyFromDatabase(allocation.workDate);
      if (!isEmployeeHiredOnDate(employeeById.get(allocation.employeeId), allocationDateKey)) continue;
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
      if (!isEmployeeHiredOnDate(employeeById.get(execution.employeeId), executionDateKey)) continue;
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
      if (!isEmployeeHiredOnDate(employeeById.get(claim.employeeId), claimDateKey)) continue;
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
    for (const row of groups.values()) {
      const days = dailyGroups.get(row.employee.id) || new Map<string, DailyAttainment>();
      const employedDateKeys = dateKeys.filter(dateKey => isEmployeeHiredOnDate(row.employee, dateKey));
      const dailyInputs = employedDateKeys.map(dateKey => {
        const existing = days.get(dateKey);
        if (existing) return existing;
        return emptyDailyAttainment(
          row.employee.attainmentEligible,
          row.employee.attainmentFactorBasisPoints,
          row.employee.attainmentStream,
        );
      });
      row.days = dailyInputs.map((day, index) => employeeDayDto(employedDateKeys[index], day));
      row.attainmentEligible = dailyInputs.some(day =>
        day.attainmentEligible
        && day.attainmentStream === 'batch'
        && (day.attainmentFactorBasisPoints ?? 10_000) > 0)
        || (dailyInputs.length === 0
          && row.employee.attainmentEligible
          && row.employee.attainmentStream === 'batch'
          && row.employee.attainmentFactorBasisPoints > 0);
      row.attainmentFactorBasisPoints = row.employee.attainmentFactorBasisPoints;
      row.attainmentStream = row.employee.attainmentStream;
      const dailySummary = aggregateDailyAttainment(dailyInputs);
      row.standardLaborMilliseconds = dailySummary.standardLaborMilliseconds;
      row.claimedStandardLaborMilliseconds = dailySummary.claimedStandardLaborMilliseconds;
      row.unmatchedStandardLaborMilliseconds = dailySummary.unmatchedStandardLaborMilliseconds;
      row.effectiveProductionMilliseconds = dailySummary.effectiveProductionMilliseconds;
      row.attainmentCapacityMilliseconds = dailySummary.attainmentCapacityMilliseconds;
      row.unexplainedMilliseconds = dailySummary.unexplainedMilliseconds;
      row.attendanceMissingDays = dailySummary.attendanceMissingDays;
      row.attendanceMissing = row.attendanceConfirmedDays === 0 || row.attendanceMissingDays > 0;
      row.attainmentBasisPoints = basisPoints(row.standardLaborMilliseconds, row.attainmentCapacityMilliseconds);
      row.processEfficiencyBasisPoints = basisPoints(
        row.standardLaborMilliseconds,
        row.actualLaborMilliseconds,
      ) || 0;
      row.rawAttendanceOutputBasisPoints = basisPoints(row.standardLaborMilliseconds, row.attendanceMilliseconds);
      row.coverageBasisPoints = basisPoints(
        Math.max(0, row.attendanceMilliseconds - row.unexplainedMilliseconds),
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
    const summary = rows.filter(row => row.attainmentEligible).reduce((result, row) => ({
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
    summary.attainmentBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.attainmentCapacityMilliseconds);
    summary.processEfficiencyBasisPoints = basisPoints(
      summary.standardLaborMilliseconds,
      summary.actualLaborMilliseconds,
    ) || 0;
    summary.rawAttendanceOutputBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.attendanceMilliseconds);
    summary.coverageBasisPoints = basisPoints(
      Math.min(summary.attendanceMilliseconds, summary.actualLaborMilliseconds + summary.exemptAbnormalMilliseconds),
      summary.attendanceMilliseconds,
    );
    return NextResponse.json({
      ok: true,
      report: {
        period,
        date,
        workforceScope: 'PRODUCTION',
        workforceLabel: '生产部',
        accessScope,
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        summary,
        rows,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('employee attainment report failed', error);
    return NextResponse.json({ ok: false, error: '员工达成率报表加载失败' }, { status: 500 });
  }
}
