import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
  ForbiddenError,
  forbidden,
  requireUser,
  unauthorized,
  UnauthorizedError,
} from '@/lib/auth';
import {
  abnormalCategoryLabel,
  attendanceRange,
  isAbnormalTimeCategory,
  parseAbnormalCategory,
  parseEmployeeIds,
  parseEventDateTimes,
  parseOptionalPositiveInteger,
  parseWorkDate,
  serializeAbnormalTimeEvent,
} from '@/lib/attendance';
import {
  abnormalTimeScopeLabel,
  abnormalTimeScopedEmployeeIds,
  canReviewAbnormalTime,
} from '@/lib/abnormal-time-access';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { productionEmployeeWhere } from '@/lib/production-workforce';
import { canMutateAbnormalTimeEvent } from '@/lib/critical-operation-access';

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
    const user = await requireUser();
    const period = req.nextUrl.searchParams.get('period') === 'month'
      ? 'month' as const
      : req.nextUrl.searchParams.get('period') === 'week'
        ? 'week' as const
        : 'today' as const;
    const range = attendanceRange(period, req.nextUrl.searchParams.get('date'));
    const start = parseWorkDate(range.start.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const end = parseWorkDate(range.end.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })).value;
    const qualityStatus = cleanProcessText(req.nextUrl.searchParams.get('qualityStatus'), 20);
    const employeeId = cleanProcessText(req.nextUrl.searchParams.get('employeeId'), 80);
    const category = cleanProcessText(req.nextUrl.searchParams.get('category'), 40);
    const scopedEmployeeIds = await abnormalTimeScopedEmployeeIds(user);
    if (employeeId && scopedEmployeeIds !== null && !scopedEmployeeIds.includes(employeeId)) {
      return forbidden('当前账号不能查看该员工的异常工时');
    }
    const events = await prisma.abnormalTimeEvent.findMany({
      where: {
        deletedAt: null,
        workDate: { gte: start, lt: end },
        ...(isAbnormalTimeCategory(category) ? { category } : {}),
        ...(qualityStatus === 'pending' || qualityStatus === 'confirmed' || qualityStatus === 'rejected'
          ? { qualityStatus }
          : {}),
        ...(employeeId
          ? { allocations: { some: { employeeId } } }
          : scopedEmployeeIds === null
            ? {}
            : { allocations: { some: { employeeId: { in: scopedEmployeeIds } } } }),
      },
      include: {
        ...include,
        allocations: {
          ...include.allocations,
          ...(scopedEmployeeIds === null
            ? {}
            : { where: { employeeId: { in: scopedEmployeeIds } } }),
        },
      },
      orderBy: [{ startedAt: 'desc' }, { sequence: 'desc' }],
      take: 2000,
    });
    const serialized = events.map(serializeAbnormalTimeEvent);
    const categoryMap = new Map<string, {
      category: typeof serialized[number]['category'];
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
      period,
      date: range.date,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      events: serialized,
      categories: [...categoryMap.values()].sort((left, right) =>
        right.affectedPersonMilliseconds - left.affectedPersonMilliseconds),
      permissions: {
        canReview: canReviewAbnormalTime(user),
        scopeLabel: abnormalTimeScopeLabel(user),
      },
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
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('abnormal time event list failed', error);
    return NextResponse.json({ ok: false, error: '异常工时加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!canMutateAbnormalTimeEvent(user.access, 'CREATE')) throw new ForbiddenError();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const title = cleanProcessText(body.title, 160);
    if (!title) return NextResponse.json({ ok: false, error: '请填写异常标题' }, { status: 400 });
    const times = parseEventDateTimes({
      workDate: body.workDate,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
    });
    const employeeIds = parseEmployeeIds(body.employeeIds);
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds }, ...productionEmployeeWhere() },
      select: { id: true },
    });
    if (employees.length !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '异常工时仅可选择生产部且已启用考勤的在职员工' }, { status: 400 });
    }
    const expectedResolvedRaw = cleanProcessText(body.expectedResolvedAt, 80);
    const expectedResolvedAt = expectedResolvedRaw ? new Date(expectedResolvedRaw) : null;
    if (expectedResolvedAt && Number.isNaN(expectedResolvedAt.getTime())) {
      return NextResponse.json({ ok: false, error: '预计恢复时间无效' }, { status: 400 });
    }
    const workOrderId = cleanProcessText(body.workOrderId, 80) || null;
    const processStepId = cleanProcessText(body.processStepId, 80) || null;
    const event = await prisma.abnormalTimeEvent.create({
      data: {
        workDate: times.workDate,
        category: parseAbnormalCategory(body.category),
        subcategory: cleanProcessText(body.subcategory, 100) || null,
        title,
        reason: cleanProcessText(body.reason, 1000) || null,
        startedAt: times.startedAt,
        endedAt: times.endedAt,
        durationMilliseconds: times.durationMilliseconds,
        affectedQuantity: parseOptionalPositiveInteger(body.affectedQuantity, '受影响数量'),
        employeeExempt: body.employeeExempt === true,
        responsibilityDepartment: cleanProcessText(body.responsibilityDepartment, 100) || null,
        responsibilityObject: cleanProcessText(body.responsibilityObject, 160) || null,
        expectedResolvedAt,
        workOrderId,
        processStepId,
        source: 'BACKOFFICE',
        createdById: user.id,
        updatedById: user.id,
        allocations: {
          create: employeeIds.map(employeeId => ({
            employeeId,
            workDate: times.workDate,
            durationMilliseconds: times.durationMilliseconds,
          })),
        },
      },
      include,
    });
    await logOp({
      userId: user.id,
      action: 'create_abnormal_time_event',
      targetType: 'abnormal_time_event',
      targetId: event.id,
      detail: {
        sequence: event.sequence,
        category: event.category,
        employeeCount: employeeIds.length,
        employeeExempt: event.employeeExempt,
      },
    });
    return NextResponse.json({ ok: true, event: serializeAbnormalTimeEvent(event) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅人事部、质量部或管理员可以新增异常工时');
    const message = error instanceof Error ? error.message : '异常工时保存失败';
    console.error('create abnormal time event failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
