import { NextRequest, NextResponse } from 'next/server';
import { MaterialFollowUpStatus, Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { isTrackedWarehouseException } from '@/lib/material-follow-up';
import {
  prepareWarehouseTaskTransition,
  serializeWarehouseMaterialTask,
  warehouseLegacyMaterialStatus,
  warehouseMaterialTaskDetailInclude,
  type WarehouseTaskTransitionInput,
} from '@/lib/warehouse-material';
import type { WarehouseExceptionType, WarehouseMaterialStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const task = await prisma.warehouseMaterialTask.findUnique({
      where: { id: params.id },
      include: warehouseMaterialTaskDetailInclude,
    });
    if (!task) return NextResponse.json({ ok: false, error: '配料任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('warehouse material task detail failed', error);
    return NextResponse.json({ ok: false, error: '配料任务详情加载失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as WarehouseTaskTransitionInput & { version?: unknown };
    const current = await prisma.warehouseMaterialTask.findUnique({ where: { id: params.id } });
    if (!current) return NextResponse.json({ ok: false, error: '配料任务不存在' }, { status: 404 });

    const requestedVersion = Number(body.version);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 0) {
      return NextResponse.json({ ok: false, error: '缺少有效的任务版本，请刷新后重试' }, { status: 400 });
    }
    const transition = prepareWarehouseTaskTransition({
      status: current.status as WarehouseMaterialStatus,
      exceptionType: current.exceptionType as WarehouseExceptionType | null,
      exceptionNote: current.exceptionNote,
      expectedAt: current.expectedAt,
      completedAt: current.completedAt,
    }, body);
    if (!transition.ok) {
      return NextResponse.json({ ok: false, error: transition.error }, { status: transition.statusCode });
    }

    const task = await prisma.$transaction(async tx => {
      const update = await tx.warehouseMaterialTask.updateMany({
        where: { id: current.id, version: requestedVersion },
        data: {
          ...transition.next,
          completedById: transition.next.status === 'completed' ? user.id : null,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) throw new Error('WAREHOUSE_TASK_VERSION_CONFLICT');
      await tx.warehouseMaterialActivity.create({
        data: {
          taskId: current.id,
          action: transition.action,
          fromStatus: current.status,
          toStatus: transition.next.status,
          content: transition.content,
          actorId: user.id,
          detail: {
            exceptionType: transition.next.exceptionType,
            expectedAt: transition.next.expectedAt?.toISOString() || null,
          },
        },
      });
      const existingFollowUp = await tx.materialFollowUpTask.findUnique({
        where: { warehouseTaskId: current.id },
      });
      const tracksShortage = isTrackedWarehouseException(transition.next.exceptionType);
      if ((transition.action === 'report_exception' || transition.action === 'update_exception') && tracksShortage) {
        const nextFollowUpStatus = existingFollowUp
          && existingFollowUp.status !== MaterialFollowUpStatus.RESOLVED
          && existingFollowUp.status !== MaterialFollowUpStatus.CANCELLED
          ? existingFollowUp.status
          : MaterialFollowUpStatus.PENDING;
        const followUp = existingFollowUp
          ? await tx.materialFollowUpTask.update({
              where: { id: existingFollowUp.id },
              data: {
                status: nextFollowUpStatus,
                latestProgress: transition.next.exceptionNote,
                expectedAt: transition.next.expectedAt,
                resolvedAt: null,
                resolvedById: null,
                version: { increment: 1 },
              },
            })
          : await tx.materialFollowUpTask.create({
              data: {
                warehouseTaskId: current.id,
                status: MaterialFollowUpStatus.PENDING,
                latestProgress: transition.next.exceptionNote,
                expectedAt: transition.next.expectedAt,
                createdById: user.id,
              },
            });
        await tx.materialFollowUpActivity.create({
          data: {
            taskId: followUp.id,
            action: existingFollowUp ? 'warehouse_feedback_updated' : 'warehouse_feedback_created',
            fromStatus: existingFollowUp?.status || null,
            toStatus: followUp.status,
            content: transition.content,
            actorId: user.id,
          },
        });
      } else if (existingFollowUp && (
        transition.action === 'resolve'
        || ((transition.action === 'report_exception' || transition.action === 'update_exception') && !tracksShortage)
      )) {
        const nextStatus = transition.action === 'resolve'
          ? MaterialFollowUpStatus.RESOLVED
          : MaterialFollowUpStatus.CANCELLED;
        if (existingFollowUp.status !== MaterialFollowUpStatus.RESOLVED
          && existingFollowUp.status !== MaterialFollowUpStatus.CANCELLED) {
          const followUp = await tx.materialFollowUpTask.update({
            where: { id: existingFollowUp.id },
            data: {
              status: nextStatus,
              latestProgress: transition.content,
              resolvedAt: new Date(),
              resolvedById: user.id,
              lastFollowedAt: new Date(),
              version: { increment: 1 },
            },
          });
          await tx.materialFollowUpActivity.create({
            data: {
              taskId: followUp.id,
              action: transition.action === 'resolve' ? 'warehouse_confirmed_resolved' : 'warehouse_feedback_changed',
              fromStatus: existingFollowUp.status,
              toStatus: nextStatus,
              content: transition.content,
              actorId: user.id,
            },
          });
        }
      }
      await tx.workOrder.update({
        where: { id: current.workOrderId },
        data: { materialStatus: warehouseLegacyMaterialStatus(transition.next) },
      });
      return tx.warehouseMaterialTask.findUniqueOrThrow({
        where: { id: current.id },
        include: warehouseMaterialTaskDetailInclude,
      });
    });

    await logOp({
      userId: user.id,
      action: `warehouse_material_${transition.action}`,
      targetType: 'warehouse_material_task',
      targetId: task.id,
      detail: {
        workOrderId: task.workOrderId,
        fromStatus: current.status,
        toStatus: transition.next.status,
        exceptionType: transition.next.exceptionType,
      },
    });
    return NextResponse.json({ ok: true, task: serializeWarehouseMaterialTask(task) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && error.message === 'WAREHOUSE_TASK_VERSION_CONFLICT') {
      return NextResponse.json({ ok: false, error: '任务已被其他账号更新，请刷新后重试' }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ ok: false, error: '关联工单不存在或已被删除' }, { status: 404 });
    }
    console.error('warehouse material task update failed', error);
    return NextResponse.json({ ok: false, error: '配料任务更新失败' }, { status: 500 });
  }
}
