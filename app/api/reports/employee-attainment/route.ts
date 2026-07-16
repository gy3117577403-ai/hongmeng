import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  calculateAttainmentBasisPoints,
  employeeReportRange,
  serializeEmployee,
} from '@/lib/process-time';
import type {
  EmployeeAttainmentRowDTO,
  ProcessExecutionDTO,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const [executions, employees] = await Promise.all([
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
    ]);
    const groups = new Map<string, EmployeeAttainmentRowDTO>();
    for (const employee of employees) {
      groups.set(employee.id, {
        employee: serializeEmployee(employee),
        standardLaborMilliseconds: 0,
        actualLaborMilliseconds: 0,
        attainmentBasisPoints: 0,
        goodQty: 0,
        scrapQty: 0,
        reworkQty: 0,
        executionCount: 0,
        details: [],
      });
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
      const row = groups.get(execution.employeeId) || {
        employee: serializeEmployee(execution.employee),
        standardLaborMilliseconds: 0,
        actualLaborMilliseconds: 0,
        attainmentBasisPoints: 0,
        goodQty: 0,
        scrapQty: 0,
        reworkQty: 0,
        executionCount: 0,
        details: [],
      };
      if (execution.countsForEfficiency) {
        row.standardLaborMilliseconds += execution.standardLaborMilliseconds;
        row.actualLaborMilliseconds += execution.actualLaborMilliseconds;
      }
      row.goodQty += execution.goodQty;
      row.scrapQty += execution.scrapQty;
      row.reworkQty += execution.reworkQty;
      row.executionCount += 1;
      row.details.push(detail);
      row.attainmentBasisPoints = row.actualLaborMilliseconds > 0
        ? calculateAttainmentBasisPoints(row.standardLaborMilliseconds, row.actualLaborMilliseconds)
        : 0;
      groups.set(execution.employeeId, row);
    }
    const rows = [...groups.values()].sort((left, right) =>
      right.attainmentBasisPoints - left.attainmentBasisPoints
      || right.standardLaborMilliseconds - left.standardLaborMilliseconds
      || left.employee.employeeNo.localeCompare(right.employee.employeeNo, 'zh-CN'));
    const summary = rows.reduce((result, row) => ({
      employeeCount: result.employeeCount + 1,
      executionCount: result.executionCount + row.executionCount,
      standardLaborMilliseconds: result.standardLaborMilliseconds + row.standardLaborMilliseconds,
      actualLaborMilliseconds: result.actualLaborMilliseconds + row.actualLaborMilliseconds,
      attainmentBasisPoints: 0,
      goodQty: result.goodQty + row.goodQty,
      scrapQty: result.scrapQty + row.scrapQty,
      reworkQty: result.reworkQty + row.reworkQty,
    }), {
      employeeCount: 0,
      executionCount: 0,
      standardLaborMilliseconds: 0,
      actualLaborMilliseconds: 0,
      attainmentBasisPoints: 0,
      goodQty: 0,
      scrapQty: 0,
      reworkQty: 0,
    });
    summary.attainmentBasisPoints = summary.actualLaborMilliseconds > 0
      ? calculateAttainmentBasisPoints(summary.standardLaborMilliseconds, summary.actualLaborMilliseconds)
      : 0;
    return NextResponse.json({
      ok: true,
      report: {
        period,
        date,
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        summary,
        rows,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('employee attainment report failed', error);
    return NextResponse.json({ ok: false, error: '员工达成率报表加载失败' }, { status: 500 });
  }
}
