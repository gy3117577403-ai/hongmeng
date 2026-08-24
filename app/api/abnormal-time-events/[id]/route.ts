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
  parseAbnormalCategory,
  parseEmployeeIds,
  parseAbnormalTimeDuration,
  parseOptionalPositiveInteger,
  serializeAbnormalTimeEvent,
} from '@/lib/attendance';
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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!canMutateAbnormalTimeEvent(user.access, 'UPDATE')) throw new ForbiddenError();
    const existing = await prisma.abnormalTimeEvent.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { allocations: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '异常工时记录不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const duration = parseAbnormalTimeDuration({
      workDate: body.workDate === undefined ? existing.workDate.toISOString().slice(0, 10) : body.workDate,
      durationMinutes: body.durationMinutes === undefined
        ? existing.durationMilliseconds / 60_000
        : body.durationMinutes,
    });
    const employeeIds = body.employeeIds === undefined
      ? existing.allocations.map(item => item.employeeId)
      : parseEmployeeIds(body.employeeIds);
    const title = body.title === undefined ? existing.title : cleanProcessText(body.title, 160);
    if (!title) return NextResponse.json({ ok: false, error: '请填写异常标题' }, { status: 400 });
    const employees = await prisma.employee.count({
      where: { id: { in: employeeIds }, ...productionEmployeeWhere() },
    });
    if (employees !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '异常工时仅可选择生产部且已启用考勤的在职员工' }, { status: 400 });
    }
    const expectedResolvedRaw = body.expectedResolvedAt === undefined
      ? existing.expectedResolvedAt?.toISOString() || ''
      : cleanProcessText(body.expectedResolvedAt, 80);
    const expectedResolvedAt = expectedResolvedRaw ? new Date(expectedResolvedRaw) : null;
    if (expectedResolvedAt && Number.isNaN(expectedResolvedAt.getTime())) {
      return NextResponse.json({ ok: false, error: '预计恢复时间无效' }, { status: 400 });
    }
    const event = await prisma.$transaction(async tx => {
      await tx.abnormalTimeAllocation.deleteMany({ where: { eventId: existing.id } });
      return tx.abnormalTimeEvent.update({
        where: { id: existing.id },
        data: {
          workDate: duration.workDate,
          category: body.category === undefined ? existing.category : parseAbnormalCategory(body.category),
          subcategory: body.subcategory === undefined ? existing.subcategory : cleanProcessText(body.subcategory, 100) || null,
          title,
          reason: body.reason === undefined ? existing.reason : cleanProcessText(body.reason, 1000) || null,
          startedAt: null,
          endedAt: null,
          durationMilliseconds: duration.durationMilliseconds,
          approvedDurationMilliseconds: null,
          affectedQuantity: body.affectedQuantity === undefined
            ? existing.affectedQuantity
            : parseOptionalPositiveInteger(body.affectedQuantity, '受影响数量'),
          employeeExempt: true,
          responsibilityDepartment: body.responsibilityDepartment === undefined
            ? existing.responsibilityDepartment
            : cleanProcessText(body.responsibilityDepartment, 100) || null,
          responsibilityObject: body.responsibilityObject === undefined
            ? existing.responsibilityObject
            : cleanProcessText(body.responsibilityObject, 160) || null,
          expectedResolvedAt,
          workOrderId: body.workOrderId === undefined ? existing.workOrderId : cleanProcessText(body.workOrderId, 80) || null,
          processStepId: body.processStepId === undefined ? existing.processStepId : cleanProcessText(body.processStepId, 80) || null,
          qualityStatus: 'pending',
          qualityNote: null,
          qualityConfirmedById: null,
          qualityConfirmedAt: null,
          version: { increment: 1 },
          updatedById: user.id,
          allocations: {
            create: employeeIds.map(employeeId => ({
              employeeId,
              workDate: duration.workDate,
              durationMilliseconds: duration.durationMilliseconds,
            })),
          },
        },
        include,
      });
    });
    await logOp({
      userId: user.id,
      action: 'update_abnormal_time_event',
      targetType: 'abnormal_time_event',
      targetId: event.id,
      detail: { sequence: event.sequence, qualityReset: existing.qualityStatus !== 'pending' },
    });
    return NextResponse.json({ ok: true, event: serializeAbnormalTimeEvent(event) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅人事部、质量部或管理员可以修改异常工时');
    const message = error instanceof Error ? error.message : '异常工时更新失败';
    console.error('update abnormal time event failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!canMutateAbnormalTimeEvent(user.access, 'DELETE')) throw new ForbiddenError();
    const existing = await prisma.abnormalTimeEvent.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return NextResponse.json({ ok: false, error: '异常工时记录不存在' }, { status: 404 });
    await prisma.abnormalTimeEvent.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    await logOp({
      userId: user.id,
      action: 'delete_abnormal_time_event',
      targetType: 'abnormal_time_event',
      targetId: existing.id,
      detail: { sequence: existing.sequence },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ForbiddenError) return forbidden('仅人事部、质量部或管理员可以删除异常工时');
    console.error('delete abnormal time event failed', error);
    return NextResponse.json({ ok: false, error: '删除异常工时失败' }, { status: 500 });
  }
}
