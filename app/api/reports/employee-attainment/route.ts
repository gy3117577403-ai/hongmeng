import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  basisPoints,
  dateKeyFromDatabase,
  parseWorkDate,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import {
  aggregateDailyAttainment,
  shouldIncludeEmployeeInAttainmentReport,
  type DailyAttainmentInput,
} from '@/lib/employee-attainment-daily';
import { safeLaborMilliseconds } from '@/lib/process-labor-service';
import { employeeReportRange, serializeEmployee } from '@/lib/process-time';
import type { EmployeeAttainmentRowDTO, ProcessExecutionDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emptyRow(employee: Parameters<typeof serializeEmployee>[0]): EmployeeAttainmentRowDTO {
  return {
    employee: serializeEmployee(employee),
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
    details: [],
    claimDetails: [],
  };
}

type DailyAttainment = DailyAttainmentInput;

function emptyDailyAttainment(): DailyAttainment {
  return {
    attendanceMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    standardLaborMilliseconds: 0,
    claimedStandardLaborMilliseconds: 0,
    actualLaborMilliseconds: 0,
    attendanceConfirmed: false,
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

export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    const period = req.nextUrl.searchParams.get('period') === 'month'
      ? 'month' as const
      : req.nextUrl.searchParams.get('period') === 'week'
        ? 'week' as const
        : 'today' as const;
    const { date, start, end } = employeeReportRange(period, req.nextUrl.searchParams.get('date'));
    const requestedEmployeeId = String(req.nextUrl.searchParams.get('employeeId') || '').trim();
    let scopedEmployeeIds: string[] | null = null;
    if (actor.laborRole === 'EMPLOYEE') {
      if (!actor.employee?.isActive) return forbidden('账号未绑定在职员工档案，无法查看达成率');
      scopedEmployeeIds = [actor.employee.id];
    } else if (actor.laborRole === 'TEAM_LEAD') {
      const team = actor.employee?.isActive ? String(actor.employee.team || '').trim() : '';
      if (!team) return forbidden('班组长账号未绑定有效班组，无法查看达成率');
      scopedEmployeeIds = (await prisma.employee.findMany({
        where: { isActive: true, team },
        select: { id: true },
      })).map(employee => employee.id);
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
    const [executions, laborClaims, employees, attendanceRecords, abnormalAllocations] = await Promise.all([
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
          quantity: { gt: 0 },
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
                },
              },
            },
          },
        },
        orderBy: [{ workDate: 'desc' }, { claimedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.employee.findMany({
        where: {
          ...(employeeIdConstraint ? { id: employeeIdConstraint } : {}),
        },
        orderBy: [{ employeeNo: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: {
          status: 'confirmed',
          workDate: { gte: startDate, lt: endDate },
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
        },
        select: { employeeId: true, workDate: true, actualMilliseconds: true },
      }),
      prisma.abnormalTimeAllocation.findMany({
        where: {
          workDate: { gte: startDate, lt: endDate },
          ...(employeeIdConstraint ? { employeeId: employeeIdConstraint } : {}),
          event: { deletedAt: null, employeeExempt: true, qualityStatus: 'confirmed' },
        },
        select: { employeeId: true, workDate: true, durationMilliseconds: true },
      }),
    ]);
    const groups = new Map<string, EmployeeAttainmentRowDTO>();
    for (const employee of employees) groups.set(employee.id, emptyRow(employee));
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
        daily = emptyDailyAttainment();
        employeeDays.set(workDate, daily);
      }
      return daily;
    };
    for (const attendance of attendanceRecords) {
      const row = groups.get(attendance.employeeId);
      if (!row) continue;
      activityEmployeeIds.add(attendance.employeeId);
      const daily = dailyFor(attendance.employeeId, dateKeyFromDatabase(attendance.workDate));
      daily.attendanceMilliseconds += attendance.actualMilliseconds;
      row.attendanceMilliseconds += attendance.actualMilliseconds;
      if (attendance.actualMilliseconds > 0) {
        daily.attendanceConfirmed = true;
        row.attendanceConfirmedDays += 1;
      }
    }
    for (const allocation of abnormalAllocations) {
      const row = groups.get(allocation.employeeId);
      if (row) {
        activityEmployeeIds.add(allocation.employeeId);
        dailyFor(
          allocation.employeeId,
          dateKeyFromDatabase(allocation.workDate),
        ).exemptAbnormalMilliseconds += allocation.durationMilliseconds;
        row.exemptAbnormalMilliseconds += allocation.durationMilliseconds;
      }
    }
    for (const execution of executions) {
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
        const daily = dailyFor(execution.employeeId, shanghaiDateKey(execution.endedAt));
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
    for (const claim of laborClaims) {
      const standardLaborMilliseconds = safeLaborMilliseconds(claim.standardLaborMilliseconds);
      const row = groups.get(claim.employeeId) || emptyRow(claim.employee);
      activityEmployeeIds.add(claim.employeeId);
      const claimDaily = dailyFor(claim.employeeId, dateKeyFromDatabase(claim.workDate));
      if (claim.pool.countsForEfficiency) {
        claimDaily.standardLaborMilliseconds += standardLaborMilliseconds;
        claimDaily.claimedStandardLaborMilliseconds += standardLaborMilliseconds;
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
        unitLabel: claim.pool.completion.unitLabel || claim.pool.step.unitLabel || '件',
        standardLaborMilliseconds,
        claimedAt: claim.claimedAt.toISOString(),
        attendanceMatched: claimDaily.attendanceConfirmed,
        standardSource: claim.pool.standardSource,
        productTimeProfileVersion: claim.pool.productTimeProfileVersion,
      });
      groups.set(claim.employeeId, row);
    }
    for (const row of groups.values()) {
      const days = dailyGroups.get(row.employee.id) || new Map<string, DailyAttainment>();
      const dailySummary = aggregateDailyAttainment(days.values());
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
        row.legacyExecutionStandardLaborMilliseconds,
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
    const summary = rows.reduce((result, row) => ({
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
      summary.legacyExecutionStandardLaborMilliseconds,
      summary.actualLaborMilliseconds,
    ) || 0;
    summary.rawAttendanceOutputBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.attendanceMilliseconds);
    summary.coverageBasisPoints = basisPoints(
      Math.min(summary.attendanceMilliseconds, summary.actualLaborMilliseconds + summary.exemptAbnormalMilliseconds),
      summary.attendanceMilliseconds,
    );
    return NextResponse.json({
      ok: true,
      report: { period, date, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), summary, rows },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('employee attainment report failed', error);
    return NextResponse.json({ ok: false, error: '员工达成率报表加载失败' }, { status: 500 });
  }
}
