import { NextRequest, NextResponse } from 'next/server';
import { MaterialFollowUpStatus, Prisma, WarehouseExceptionCaseStatus } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { isTrackedWarehouseException } from '@/lib/material-follow-up';
import { synchronizeMaterialProductionHold } from '@/lib/production-plan-holds';
import {
  prepareWarehouseTaskTransition,
  procurementOwnedExpectedArrival,
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
    const now = new Date();
    const transition = prepareWarehouseTaskTransition({
      status: current.status as WarehouseMaterialStatus,
      exceptionType: current.exceptionType as WarehouseExceptionType | null,
      exceptionNote: current.exceptionNote,
      expectedAt: current.expectedAt,
      completedAt: current.completedAt,
    }, body, now);
    if (!transition.ok) {
      return NextResponse.json({ ok: false, error: transition.error }, { status: transition.statusCode });
    }

    const task = await prisma.$transaction(async tx => {
      let exceptionCase = await tx.warehouseMaterialExceptionCase.findFirst({
        where: { warehouseTaskId: current.id, status: WarehouseExceptionCaseStatus.OPEN },
        orderBy: { sequence: 'desc' },
        include: { followUpTask: true },
      });
      const synchronizedExpectedAt = transition.action === 'report_exception' || transition.action === 'update_exception'
        ? procurementOwnedExpectedArrival({
            currentExpectedAt: current.expectedAt,
            eventExpectedArrivalAt: exceptionCase?.expectedArrivalAt,
            followUpExpectedAt: exceptionCase?.followUpTask?.expectedAt,
          })
        : transition.next.expectedAt;
      const synchronizedNext = {
        ...transition.next,
        expectedAt: synchronizedExpectedAt,
      };
      const update = await tx.warehouseMaterialTask.updateMany({
        where: { id: current.id, version: requestedVersion },
        data: {
          ...synchronizedNext,
          completedById: synchronizedNext.status === 'completed' ? user.id : null,
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) throw new Error('WAREHOUSE_TASK_VERSION_CONFLICT');
      if (transition.action === 'report_exception' || transition.action === 'update_exception') {
        if (!isTrackedWarehouseException(synchronizedNext.exceptionType)) {
          throw new Error('WAREHOUSE_EXCEPTION_TYPE_NOT_TRACKED');
        }
        if (!exceptionCase) {
          const [sequence, workOrder] = await Promise.all([
            tx.warehouseMaterialExceptionCase.aggregate({
              where: { warehouseTaskId: current.id },
              _max: { sequence: true },
            }),
            tx.workOrder.findUniqueOrThrow({
              where: { id: current.workOrderId },
              select: { weekStartDate: true, weekEndDate: true },
            }),
          ]);
          exceptionCase = await tx.warehouseMaterialExceptionCase.create({
            data: {
              warehouseTaskId: current.id,
              sequence: (sequence._max.sequence || 0) + 1,
              exceptionType: synchronizedNext.exceptionType!,
              exceptionNote: synchronizedNext.exceptionNote!,
              weekStartDate: workOrder.weekStartDate,
              weekEndDate: workOrder.weekEndDate,
              reportedAt: now,
              reportedById: user.id,
              expectedArrivalAt: synchronizedExpectedAt,
            },
            include: { followUpTask: true },
          });
        } else {
          exceptionCase = await tx.warehouseMaterialExceptionCase.update({
            where: { id: exceptionCase.id },
            data: {
              exceptionType: synchronizedNext.exceptionType!,
              exceptionNote: synchronizedNext.exceptionNote!,
              expectedArrivalAt: exceptionCase.followUpTask?.expectedAt
                ?? exceptionCase.expectedArrivalAt
                ?? synchronizedExpectedAt,
            },
            include: { followUpTask: true },
          });
        }
        const existingFollowUp = exceptionCase.followUpTask;
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
                latestProgress: existingFollowUp.ownerId
                  ? existingFollowUp.latestProgress
                  : synchronizedNext.exceptionNote,
                expectedAt: existingFollowUp.expectedAt ?? synchronizedExpectedAt,
                resolvedAt: null,
                resolvedById: null,
                version: { increment: 1 },
              },
            })
          : await tx.materialFollowUpTask.create({
              data: {
                warehouseTaskId: current.id,
                warehouseExceptionId: exceptionCase.id,
                status: MaterialFollowUpStatus.PENDING,
                latestProgress: synchronizedNext.exceptionNote,
                expectedAt: synchronizedExpectedAt,
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
      } else if (transition.action === 'resolve') {
        if (!exceptionCase) {
          const [sequence, workOrder] = await Promise.all([
            tx.warehouseMaterialExceptionCase.aggregate({
              where: { warehouseTaskId: current.id },
              _max: { sequence: true },
            }),
            tx.workOrder.findUniqueOrThrow({
              where: { id: current.workOrderId },
              select: { weekStartDate: true, weekEndDate: true },
            }),
          ]);
          exceptionCase = await tx.warehouseMaterialExceptionCase.create({
            data: {
              warehouseTaskId: current.id,
              sequence: (sequence._max.sequence || 0) + 1,
              exceptionType: current.exceptionType || 'other',
              exceptionNote: current.exceptionNote || '历史仓库异常',
              weekStartDate: workOrder.weekStartDate,
              weekEndDate: workOrder.weekEndDate,
              reportedAt: current.updatedAt,
              reportedById: current.updatedById,
              expectedArrivalAt: current.expectedAt,
            },
            include: { followUpTask: true },
          });
        }
        const resolvedCase = await tx.warehouseMaterialExceptionCase.update({
          where: { id: exceptionCase.id },
          data: {
            status: WarehouseExceptionCaseStatus.RESOLVED,
            resolvedAt: now,
            resolvedById: user.id,
            resolutionNote: transition.content,
          },
          include: { followUpTask: true },
        });
        const existingFollowUp = resolvedCase.followUpTask;
        const followUp = existingFollowUp
          ? await tx.materialFollowUpTask.update({
            where: { id: existingFollowUp.id },
            data: {
              status: MaterialFollowUpStatus.RESOLVED,
              latestProgress: transition.content,
              resolvedAt: now,
              resolvedById: user.id,
              lastFollowedAt: now,
              version: { increment: 1 },
            },
          })
          : await tx.materialFollowUpTask.create({
            data: {
              warehouseTaskId: current.id,
              warehouseExceptionId: resolvedCase.id,
              status: MaterialFollowUpStatus.RESOLVED,
              latestProgress: transition.content,
              expectedAt: resolvedCase.expectedArrivalAt,
              lastFollowedAt: now,
              resolvedAt: now,
              createdById: resolvedCase.reportedById,
              resolvedById: user.id,
            },
          });
        await tx.materialFollowUpActivity.create({
          data: {
            taskId: followUp.id,
            action: 'warehouse_confirmed_resolved',
            fromStatus: existingFollowUp?.status || null,
            toStatus: MaterialFollowUpStatus.RESOLVED,
            content: transition.content,
            actorId: user.id,
          },
        });
      }
      await tx.warehouseMaterialActivity.create({
        data: {
          taskId: current.id,
          action: transition.action,
          fromStatus: current.status,
          toStatus: synchronizedNext.status,
          content: transition.content,
          actorId: user.id,
          detail: {
            exceptionCaseId: exceptionCase?.id || null,
            exceptionType: transition.action === 'resolve' ? current.exceptionType : synchronizedNext.exceptionType,
            expectedAt: synchronizedNext.expectedAt?.toISOString() || null,
            resolvedAt: transition.action === 'resolve' ? now.toISOString() : null,
          },
        },
      });
      await tx.workOrder.update({
        where: { id: current.workOrderId },
        data: { materialStatus: warehouseLegacyMaterialStatus(synchronizedNext) },
      });
      await synchronizeMaterialProductionHold(tx, {
        workOrderId: current.workOrderId,
        warehouseTaskId: current.id,
        status: synchronizedNext.status,
        exceptionType: synchronizedNext.exceptionType,
        exceptionNote: synchronizedNext.exceptionNote,
        expectedAt: synchronizedNext.expectedAt,
        actorId: user.id,
        now,
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
