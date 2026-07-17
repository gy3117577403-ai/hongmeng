import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { basisPoints, parseWorkDate } from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { employeeReportRange, serializeEmployee } from '@/lib/process-time';
import type { EmployeeAttainmentRowDTO, ProcessExecutionDTO } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emptyRow(employee: Parameters<typeof serializeEmployee>[0]): EmployeeAttainmentRowDTO {
  return {
    employee: serializeEmployee(employee),
    standardLaborMilliseconds: 0,
    actualLaborMilliseconds: 0,
    attendanceMilliseconds: 0,
    exemptAbnormalMilliseconds: 0,
    effectiveProductionMilliseconds: 0,
    unexplainedMilliseconds: 0,
    attendanceConfirmedDays: 0,
    attendanceMissing: true,
    attainmentBasisPoints: null,
    processEfficiencyBasisPoints: 0,
    rawAttendanceOutputBasisPoints: null,
    coverageBasisPoints: null,
    goodQty: 0,
    scrapQty: 0,
    reworkQty: 0,
    executionCount: 0,
    details: [],
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const period = req.nextUrl.searchParams.get('period') === 'month'
      ? 'month' as const
      : req.nextUrl.searchParams.get('period') === 'week'
        ? 'week' as const
        : 'today' as const;
    const { date, start, end } = employeeReportRange(period, req.nextUrl.searchParams.get('date'));
    const employeeId = String(req.nextUrl.searchParams.get('employeeId') || '').trim();
    const startDate = parseWorkDate(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const endDate = parseWorkDate(end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const [executions, employees, attendanceRecords, abnormalAllocations] = await Promise.all([
      prisma.processExecution.findMany({
        where: {
          voidedAt: null,
          endedAt: { gte: start, lt: end },
          ...(employeeId ? { employeeId } : {}),
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
        take: 5000,
      }),
      prisma.employee.findMany({
        where: {
          isActive: true,
          ...(employeeId ? { id: employeeId } : {}),
        },
        orderBy: [{ employeeNo: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: {
          status: 'confirmed',
          workDate: { gte: startDate, lt: endDate },
          ...(employeeId ? { employeeId } : {}),
        },
        select: { employeeId: true, actualMilliseconds: true },
      }),
      prisma.abnormalTimeAllocation.findMany({
        where: {
          workDate: { gte: startDate, lt: endDate },
          ...(employeeId ? { employeeId } : {}),
          event: { deletedAt: null, employeeExempt: true, qualityStatus: 'confirmed' },
        },
        select: { employeeId: true, durationMilliseconds: true },
      }),
    ]);
    const groups = new Map<string, EmployeeAttainmentRowDTO>();
    for (const employee of employees) groups.set(employee.id, emptyRow(employee));
    for (const attendance of attendanceRecords) {
      const row = groups.get(attendance.employeeId);
      if (!row) continue;
      row.attendanceMilliseconds += attendance.actualMilliseconds;
      row.attendanceConfirmedDays += 1;
      row.attendanceMissing = false;
    }
    for (const allocation of abnormalAllocations) {
      const row = groups.get(allocation.employeeId);
      if (row) row.exemptAbnormalMilliseconds += allocation.durationMilliseconds;
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
        remark: execution.remark,
        createdAt: execution.createdAt.toISOString(),
      };
      const row = groups.get(execution.employeeId) || emptyRow(execution.employee);
      if (execution.countsForEfficiency) {
        row.standardLaborMilliseconds += execution.standardLaborMilliseconds;
        row.actualLaborMilliseconds += execution.actualLaborMilliseconds;
      }
      row.goodQty += execution.goodQty;
      row.scrapQty += execution.scrapQty;
      row.reworkQty += execution.reworkQty;
      row.executionCount += 1;
      row.details.push(detail);
      groups.set(execution.employeeId, row);
    }
    for (const row of groups.values()) {
      row.effectiveProductionMilliseconds = Math.max(0, row.attendanceMilliseconds - row.exemptAbnormalMilliseconds);
      row.unexplainedMilliseconds = Math.max(0,
        row.attendanceMilliseconds - row.actualLaborMilliseconds - row.exemptAbnormalMilliseconds);
      row.attainmentBasisPoints = basisPoints(row.standardLaborMilliseconds, row.effectiveProductionMilliseconds);
      row.processEfficiencyBasisPoints = basisPoints(row.standardLaborMilliseconds, row.actualLaborMilliseconds) || 0;
      row.rawAttendanceOutputBasisPoints = basisPoints(row.standardLaborMilliseconds, row.attendanceMilliseconds);
      row.coverageBasisPoints = basisPoints(
        Math.min(row.attendanceMilliseconds, row.actualLaborMilliseconds + row.exemptAbnormalMilliseconds),
        row.attendanceMilliseconds,
      );
    }
    const rows = [...groups.values()].sort((left, right) =>
      (right.attainmentBasisPoints ?? -1) - (left.attainmentBasisPoints ?? -1)
      || right.standardLaborMilliseconds - left.standardLaborMilliseconds
      || left.employee.employeeNo.localeCompare(right.employee.employeeNo, 'zh-CN'));
    const summary = rows.reduce((result, row) => ({
      employeeCount: result.employeeCount + 1,
      executionCount: result.executionCount + row.executionCount,
      standardLaborMilliseconds: result.standardLaborMilliseconds + row.standardLaborMilliseconds,
      actualLaborMilliseconds: result.actualLaborMilliseconds + row.actualLaborMilliseconds,
      attendanceMilliseconds: result.attendanceMilliseconds + row.attendanceMilliseconds,
      exemptAbnormalMilliseconds: result.exemptAbnormalMilliseconds + row.exemptAbnormalMilliseconds,
      effectiveProductionMilliseconds: result.effectiveProductionMilliseconds + row.effectiveProductionMilliseconds,
      unexplainedMilliseconds: result.unexplainedMilliseconds + row.unexplainedMilliseconds,
      attendanceConfirmedDays: result.attendanceConfirmedDays + row.attendanceConfirmedDays,
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
      standardLaborMilliseconds: 0,
      actualLaborMilliseconds: 0,
      attendanceMilliseconds: 0,
      exemptAbnormalMilliseconds: 0,
      effectiveProductionMilliseconds: 0,
      unexplainedMilliseconds: 0,
      attendanceConfirmedDays: 0,
      attendanceMissingCount: 0,
      attainmentBasisPoints: null as number | null,
      processEfficiencyBasisPoints: 0,
      rawAttendanceOutputBasisPoints: null as number | null,
      coverageBasisPoints: null as number | null,
      goodQty: 0,
      scrapQty: 0,
      reworkQty: 0,
    });
    summary.attainmentBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.effectiveProductionMilliseconds);
    summary.processEfficiencyBasisPoints = basisPoints(summary.standardLaborMilliseconds, summary.actualLaborMilliseconds) || 0;
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
