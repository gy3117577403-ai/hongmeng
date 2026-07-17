import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  parseAbnormalCategory,
  parseEmployeeIds,
  parseEventDateTimes,
  serializeAbnormalTimeEvent,
} from '@/lib/attendance';
import { cleanProcessText } from '@/lib/process-time';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const include = {
  allocations: { include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' as const } } },
  qualityConfirmedBy: { select: { id: true, username: true, displayName: true } },
  resolvedBy: { select: { id: true, username: true, displayName: true } },
  workOrder: { select: { id: true, code: true, customerName: true, specification: true, productName: true } },
  processStep: { select: { id: true, processCode: true, processName: true } },
} satisfies Prisma.AbnormalTimeEventInclude;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const existing = await prisma.abnormalTimeEvent.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { allocations: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: '异常工时记录不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const times = parseEventDateTimes({
      workDate: body.workDate === undefined ? existing.workDate.toISOString().slice(0, 10) : body.workDate,
      startedAt: body.startedAt === undefined ? existing.startedAt.toISOString() : body.startedAt,
      endedAt: body.endedAt === undefined ? existing.endedAt.toISOString() : body.endedAt,
    });
    const employeeIds = body.employeeIds === undefined
      ? existing.allocations.map(item => item.employeeId)
      : parseEmployeeIds(body.employeeIds);
    const title = body.title === undefined ? existing.title : cleanProcessText(body.title, 160);
    if (!title) return NextResponse.json({ ok: false, error: '请填写异常标题' }, { status: 400 });
    const employees = await prisma.employee.count({ where: { id: { in: employeeIds }, isActive: true } });
    if (employees !== employeeIds.length) {
      return NextResponse.json({ ok: false, error: '部分员工不存在或已停用，请重新选择' }, { status: 400 });
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
          workDate: times.workDate,
          category: body.category === undefined ? existing.category : parseAbnormalCategory(body.category),
          title,
          reason: body.reason === undefined ? existing.reason : cleanProcessText(body.reason, 1000) || null,
          startedAt: times.startedAt,
          endedAt: times.endedAt,
          durationMilliseconds: times.durationMilliseconds,
          employeeExempt: body.employeeExempt === undefined ? existing.employeeExempt : body.employeeExempt === true,
          responsibilityDepartment: body.responsibilityDepartment === undefined
            ? existing.responsibilityDepartment
            : cleanProcessText(body.responsibilityDepartment, 100) || null,
          expectedResolvedAt,
          workOrderId: body.workOrderId === undefined ? existing.workOrderId : cleanProcessText(body.workOrderId, 80) || null,
          processStepId: body.processStepId === undefined ? existing.processStepId : cleanProcessText(body.processStepId, 80) || null,
          qualityStatus: 'pending',
          qualityNote: null,
          qualityConfirmedById: null,
          qualityConfirmedAt: null,
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
    const message = error instanceof Error ? error.message : '异常工时更新失败';
    console.error('update abnormal time event failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
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
    console.error('delete abnormal time event failed', error);
    return NextResponse.json({ ok: false, error: '删除异常工时失败' }, { status: 500 });
  }
}
