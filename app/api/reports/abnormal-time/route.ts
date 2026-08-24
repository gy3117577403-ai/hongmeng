import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { forbidden, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import {
  abnormalCategoryLabel,
  parseAbnormalCategory,
  parseWorkDate,
  serializeAbnormalTimeEvent,
} from '@/lib/attendance';
import { prisma } from '@/lib/prisma';
import { ReportDateRangeError, reportRangeQuery } from '@/lib/report-date-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
  reportedByEmployee: true,
} satisfies Prisma.AbnormalTimeEventInclude;

export async function GET(req: NextRequest) {
  try {
    const actor = await requireUser();
    const range = reportRangeQuery(req.nextUrl.searchParams);
    const { period } = range;
    const start = parseWorkDate(range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const end = parseWorkDate(range.end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    let scopedEmployeeIds: string[] | null = null;
    const canReadGlobalReport = hasCapability(actor.access, 'BUSINESS', 'READ')
      || hasCapability(actor.access, 'PLANNING', 'READ')
      || hasCapability(actor.access, 'MAJOR_APPROVAL', 'READ')
      || actor.laborRole === 'ADMIN';
    if (!canReadGlobalReport && actor.laborRole === 'EMPLOYEE') {
      if (!actor.employee?.isActive) return forbidden('账号未绑定在职员工档案，无法查看异常工时');
      scopedEmployeeIds = [actor.employee.id];
    } else if (!canReadGlobalReport && actor.laborRole === 'TEAM_LEAD') {
      const team = actor.employee?.isActive ? String(actor.employee.team || '').trim() : '';
      if (!team) return forbidden('班组长账号未绑定有效班组，无法查看异常工时');
      scopedEmployeeIds = (await prisma.employee.findMany({
        where: { isActive: true, team },
        select: { id: true },
      })).map(employee => employee.id);
    }
    const events = await prisma.abnormalTimeEvent.findMany({
      where: {
        deletedAt: null,
        workDate: { gte: start, lt: end },
        ...(scopedEmployeeIds
          ? { allocations: { some: { employeeId: { in: scopedEmployeeIds } } } }
          : {}),
      },
      include: {
        ...include,
        allocations: {
          ...include.allocations,
          ...(scopedEmployeeIds
            ? { where: { employeeId: { in: scopedEmployeeIds } } }
            : {}),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      take: 2000,
    });
    const serialized = events.map(serializeAbnormalTimeEvent);
    const categoryMap = new Map<string, {
      category: ReturnType<typeof parseAbnormalCategory>;
      categoryLabel: string;
      eventCount: number;
      incidentMilliseconds: number;
      affectedPersonMilliseconds: number;
      approvedPersonMilliseconds: number;
    }>();
    for (const event of serialized) {
      const row = categoryMap.get(event.category) || {
        category: event.category,
        categoryLabel: abnormalCategoryLabel(event.category),
        eventCount: 0,
        incidentMilliseconds: 0,
        affectedPersonMilliseconds: 0,
        approvedPersonMilliseconds: 0,
      };
      row.eventCount += 1;
      row.incidentMilliseconds += event.durationMilliseconds;
      row.affectedPersonMilliseconds += event.affectedPersonMilliseconds;
      row.approvedPersonMilliseconds += event.approvedPersonMilliseconds;
      categoryMap.set(event.category, row);
    }
    return NextResponse.json({
      ok: true,
      report: {
        period,
        date: range.date,
        rangeStart: range.start.toISOString(),
        rangeEnd: range.end.toISOString(),
        summary: {
          eventCount: serialized.length,
          pendingCount: serialized.filter(item => item.qualityStatus === 'pending').length,
          confirmedCount: serialized.filter(item => item.qualityStatus === 'confirmed').length,
          rejectedCount: serialized.filter(item => item.qualityStatus === 'rejected').length,
          openCount: serialized.filter(item => item.resolutionStatus === 'open').length,
          incidentMilliseconds: serialized.reduce((sum, item) => sum + item.durationMilliseconds, 0),
          affectedPersonMilliseconds: serialized.reduce((sum, item) => sum + item.affectedPersonMilliseconds, 0),
          approvedPersonMilliseconds: serialized.reduce((sum, item) => sum + item.approvedPersonMilliseconds, 0),
          confirmedExemptPersonMilliseconds: serialized
            .filter(item => item.qualityStatus === 'confirmed' && item.employeeExempt)
            .reduce((sum, item) => sum + item.approvedPersonMilliseconds, 0),
        },
        categories: [...categoryMap.values()].sort((left, right) =>
          right.affectedPersonMilliseconds - left.affectedPersonMilliseconds),
        events: serialized,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ReportDateRangeError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    console.error('abnormal time report failed', error);
    return NextResponse.json({ ok: false, error: '异常工时汇总加载失败' }, { status: 500 });
  }
}
