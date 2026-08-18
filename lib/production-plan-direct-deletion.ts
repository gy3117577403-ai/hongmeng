import {
  DailyCrossTeamRequestStatus,
  DailyProcessTaskStatus,
  DailyShipmentItemStatus,
  DailyTaskAssignmentStatus,
  MaterialFollowUpStatus,
  WarehouseExceptionCaseStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

export const PRODUCTION_PLAN_DIRECT_DELETE_CONFIRMATION_CODE = '111';

export class ProductionPlanDirectDeletionError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

export function isProductionPlanDirectDeleteConfirmationValid(value: unknown): boolean {
  return String(value ?? '').trim() === PRODUCTION_PLAN_DIRECT_DELETE_CONFIRMATION_CODE;
}

export function normalizeProductionPlanDirectDeleteReason(value: unknown): string | null {
  const reason = String(value ?? '').trim().slice(0, 300);
  return reason || null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function shipmentRevisionHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function deleteProductionPlanOrderDirectly(
  tx: Prisma.TransactionClient,
  input: {
    planOrderId: string;
    actorId: string;
    actorLabel: string;
    reason?: string | null;
  },
): Promise<{
  planOrderId: string;
  deletedBatchCount: number;
  retiredWorkOrderCount: number;
  dismissedCarryoverCount: number;
  cancelledDailyTaskCount: number;
  cancelledShipmentItemCount: number;
  cancelledMaterialFollowUpCount: number;
}> {
  const order = await tx.productionPlanOrder.findUnique({
    where: { id: input.planOrderId },
    select: {
      id: true,
      sourceOrderNo: true,
      sourceLineNo: true,
      customerName: true,
      salesperson: true,
      productName: true,
      specification: true,
      drawingLibraryItemId: true,
      orderQuantity: true,
      orderDate: true,
      customerDueDate: true,
      priority: true,
      status: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      batches: {
        where: { deletedAt: null },
        orderBy: { batchNo: 'asc' },
        select: {
          id: true,
          batchNo: true,
          quantity: true,
          weekStartDate: true,
          weekEndDate: true,
          plannedCompletionDate: true,
          releaseState: true,
          workOrderId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!order || order.deletedAt) {
    throw new ProductionPlanDirectDeletionError('计划订单不存在或已经删除', 'PLAN_ORDER_NOT_FOUND', 404);
  }

  const now = new Date();
  const reason = normalizeProductionPlanDirectDeleteReason(input.reason);
  const batchIds = order.batches.map(batch => batch.id);
  const rootWorkOrderIds = order.batches
    .map(batch => batch.workOrderId)
    .filter((id): id is string => Boolean(id));
  const branchWorkOrderIds = rootWorkOrderIds.length
    ? (await tx.workOrder.findMany({
        where: {
          deletedAt: null,
          OR: [
            { parentWorkOrderId: { in: rootWorkOrderIds } },
            { rootWorkOrderId: { in: rootWorkOrderIds } },
          ],
        },
        select: { id: true },
      })).map(item => item.id)
    : [];
  const allWorkOrderIds = [...new Set([...rootWorkOrderIds, ...branchWorkOrderIds])];

  const workOrders = allWorkOrderIds.length
    ? await tx.workOrder.findMany({
        where: { id: { in: allWorkOrderIds } },
        select: {
          id: true,
          code: true,
          stage: true,
          status: true,
          progress: true,
          completedQty: true,
          startedAt: true,
          completedAt: true,
          planActive: true,
          deletedAt: true,
          parentWorkOrderId: true,
          rootWorkOrderId: true,
          materialTask: { select: { id: true, status: true } },
          processRoute: { select: { id: true, status: true } },
          _count: {
            select: {
              progressLogs: true,
              processCompletions: true,
              quantityMovements: true,
              dailyProcessTasks: true,
              dailyShipmentItems: true,
            },
          },
        },
      })
    : [];
  const materialTaskIds = workOrders
    .map(workOrder => workOrder.materialTask?.id)
    .filter((id): id is string => Boolean(id));

  const cancellableDailyTasks = allWorkOrderIds.length
    ? await tx.dailyProcessTask.findMany({
        where: {
          workOrderId: { in: allWorkOrderIds },
          status: { notIn: [DailyProcessTaskStatus.COMPLETED, DailyProcessTaskStatus.CANCELLED] },
        },
        select: { id: true, planId: true, status: true },
      })
    : [];
  const cancellableDailyTaskIds = cancellableDailyTasks.map(task => task.id);
  if (cancellableDailyTaskIds.length) {
    await tx.dailyCrossTeamRequest.updateMany({
      where: {
        taskId: { in: cancellableDailyTaskIds },
        status: { in: [DailyCrossTeamRequestStatus.PENDING, DailyCrossTeamRequestStatus.APPROVED] },
      },
      data: {
        status: DailyCrossTeamRequestStatus.CANCELLED,
        reviewedById: input.actorId,
        reviewedAt: now,
        reviewNote: reason || '关联计划订单已删除',
        version: { increment: 1 },
      },
    });
    await tx.dailyTaskAssignment.updateMany({
      where: {
        taskId: { in: cancellableDailyTaskIds },
        status: { notIn: [DailyTaskAssignmentStatus.COMPLETED, DailyTaskAssignmentStatus.CANCELLED] },
      },
      data: {
        status: DailyTaskAssignmentStatus.CANCELLED,
        cancelledAt: now,
        version: { increment: 1 },
      },
    });
    await tx.dailyProcessTask.updateMany({
      where: { id: { in: cancellableDailyTaskIds } },
      data: { status: DailyProcessTaskStatus.CANCELLED, version: { increment: 1 } },
    });
    await tx.dailyPlanRevision.createMany({
      data: cancellableDailyTasks.map(task => ({
        planId: task.planId,
        taskId: task.id,
        action: 'cancel_after_plan_order_delete',
        beforeData: jsonValue({ status: task.status }),
        afterData: jsonValue({ status: DailyProcessTaskStatus.CANCELLED }),
        reason,
        actorId: input.actorId,
      })),
    });
  }

  const cancellableShipmentItems = allWorkOrderIds.length
    ? await tx.dailyShipmentPlanItem.findMany({
        where: {
          workOrderId: { in: allWorkOrderIds },
          status: { in: [DailyShipmentItemStatus.PLANNED, DailyShipmentItemStatus.PARTIALLY_SHIPPED] },
        },
        select: { id: true, planId: true, status: true, version: true, _count: { select: { events: true } } },
      })
    : [];
  if (cancellableShipmentItems.length) {
    await tx.dailyShipmentPlanItem.updateMany({
      where: { id: { in: cancellableShipmentItems.map(item => item.id) } },
      data: {
        status: DailyShipmentItemStatus.CANCELLED,
        updatedById: input.actorId,
        version: { increment: 1 },
      },
    });
    await tx.dailyShipmentRevision.createMany({
      data: cancellableShipmentItems.map(item => {
        const revision = {
          orderId: order.id,
          itemId: item.id,
          fromStatus: item.status,
          toStatus: DailyShipmentItemStatus.CANCELLED,
          eventCount: item._count.events,
        };
        return {
          planId: item.planId,
          itemId: item.id,
          action: 'cancel_after_plan_order_delete',
          idempotencyKey: `plan-order-delete:${order.id}:${item.id}:${randomUUID()}`,
          payloadHash: shipmentRevisionHash(revision),
          beforeData: jsonValue({ status: item.status, version: item.version, eventCount: item._count.events }),
          afterData: jsonValue({ status: DailyShipmentItemStatus.CANCELLED, version: item.version + 1 }),
          reason,
          actorId: input.actorId,
        };
      }),
    });
  }

  const cancellableFollowUps = materialTaskIds.length
    ? await tx.materialFollowUpTask.findMany({
        where: {
          warehouseTaskId: { in: materialTaskIds },
          status: { notIn: [MaterialFollowUpStatus.RESOLVED, MaterialFollowUpStatus.CANCELLED] },
        },
        select: { id: true, status: true },
      })
    : [];
  if (cancellableFollowUps.length) {
    await tx.materialFollowUpTask.updateMany({
      where: { id: { in: cancellableFollowUps.map(item => item.id) } },
      data: {
        status: MaterialFollowUpStatus.CANCELLED,
        resolvedAt: now,
        resolvedById: input.actorId,
        version: { increment: 1 },
      },
    });
    await tx.materialFollowUpActivity.createMany({
      data: cancellableFollowUps.map(item => ({
        taskId: item.id,
        action: 'cancel_after_plan_order_delete',
        fromStatus: item.status,
        toStatus: MaterialFollowUpStatus.CANCELLED,
        content: reason || '关联计划订单已删除',
        actorId: input.actorId,
      })),
    });
  }

  if (materialTaskIds.length) {
    await tx.warehouseMaterialExceptionCase.updateMany({
      where: { warehouseTaskId: { in: materialTaskIds }, status: WarehouseExceptionCaseStatus.OPEN },
      data: {
        status: WarehouseExceptionCaseStatus.CANCELLED,
        resolvedAt: now,
        resolvedById: input.actorId,
        resolutionNote: reason || '关联计划订单已删除',
      },
    });
    await tx.warehouseMaterialActivity.createMany({
      data: workOrders.flatMap(workOrder => workOrder.materialTask ? [{
        taskId: workOrder.materialTask.id,
        action: 'archive_after_plan_order_delete',
        fromStatus: workOrder.materialTask.status,
        toStatus: workOrder.materialTask.status,
        content: reason || '关联计划订单已删除，仓库记录转为历史归档',
        detail: jsonValue({ planOrderId: order.id, workOrderId: workOrder.id }),
        actorId: input.actorId,
      }] : []),
    });
  }

  const dismissedCarryoverCount = batchIds.length
    ? (await tx.productionCarryover.updateMany({
        where: { productionPlanBatchId: { in: batchIds }, status: 'ACTIVE' },
        data: {
          status: 'DISMISSED',
          dismissedAt: now,
          reason: reason || '关联计划订单已删除',
        },
      })).count
    : 0;
  if (batchIds.length) {
    await tx.productionPlanBatch.updateMany({
      where: { id: { in: batchIds }, deletedAt: null },
      data: { deletedAt: now },
    });
  }
  if (allWorkOrderIds.length) {
    await tx.workOrder.updateMany({
      where: { id: { in: allWorkOrderIds }, deletedAt: null },
      data: {
        deletedAt: now,
        planActive: false,
        planClearedAt: now,
        planClearedBy: input.actorLabel,
      },
    });
  }
  await tx.productionPlanOrder.update({
    where: { id: order.id },
    data: { deletedAt: now, updatedById: input.actorId },
  });

  const preservation = {
    drawingLibraryItem: true,
    drawingAndSopFiles: true,
    productTimeProfiles: true,
    processAndReportingLedgers: true,
    warehouseAndShipmentAudit: true,
    operationAudit: true,
  };
  const beforeData = {
    order: {
      id: order.id,
      sourceOrderNo: order.sourceOrderNo,
      sourceLineNo: order.sourceLineNo,
      customerName: order.customerName,
      salesperson: order.salesperson,
      productName: order.productName,
      specification: order.specification,
      drawingLibraryItemId: order.drawingLibraryItemId,
      orderQuantity: order.orderQuantity,
      orderDate: order.orderDate.toISOString(),
      customerDueDate: order.customerDueDate.toISOString(),
      priority: order.priority,
      status: order.status,
      remark: order.remark,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    },
    batches: order.batches.map(batch => ({
      ...batch,
      weekStartDate: batch.weekStartDate.toISOString(),
      weekEndDate: batch.weekEndDate.toISOString(),
      plannedCompletionDate: batch.plannedCompletionDate.toISOString(),
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    })),
    workOrders: workOrders.map(workOrder => ({
      ...workOrder,
      startedAt: workOrder.startedAt?.toISOString() || null,
      completedAt: workOrder.completedAt?.toISOString() || null,
      deletedAt: workOrder.deletedAt?.toISOString() || null,
    })),
  };
  const impactData = {
    deletedBatchCount: batchIds.length,
    retiredWorkOrderCount: allWorkOrderIds.length,
    dismissedCarryoverCount,
    cancelledDailyTaskCount: cancellableDailyTasks.length,
    cancelledShipmentItemCount: cancellableShipmentItems.length,
    cancelledMaterialFollowUpCount: cancellableFollowUps.length,
    returnedToOrderPool: false,
    preservation,
  };
  await tx.productionPlanChange.create({
    data: {
      planOrderId: order.id,
      action: 'direct_delete_plan_order',
      beforeData: jsonValue(beforeData),
      afterData: jsonValue({ deletedAt: now.toISOString() }),
      impactData: jsonValue(impactData),
      reason,
      actorId: input.actorId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action: 'direct_delete_production_plan_order',
      targetType: 'production_plan_order',
      targetId: order.id,
      detail: jsonValue({
        confirmationCodeAccepted: true,
        reasonProvided: Boolean(reason),
        beforeData,
        impactData,
      }),
    },
  });

  return {
    planOrderId: order.id,
    deletedBatchCount: batchIds.length,
    retiredWorkOrderCount: allWorkOrderIds.length,
    dismissedCarryoverCount,
    cancelledDailyTaskCount: cancellableDailyTasks.length,
    cancelledShipmentItemCount: cancellableShipmentItems.length,
    cancelledMaterialFollowUpCount: cancellableFollowUps.length,
  };
}
