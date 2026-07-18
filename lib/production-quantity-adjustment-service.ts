import { Prisma, type WorkOrder } from '@prisma/client';
import { sanitizeSnapshotValue, workOrderSnapshot } from '@/lib/change-snapshots';
import { prisma } from '@/lib/prisma';
import { prepareProductionQuantityAdjustment } from '@/lib/production-quantity-adjustment';
import { parsedImportedProductionTarget } from '@/lib/production-quantity';
import { parseExecutionVersion, resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';
import { isActiveProductionWorkOrder, legacyStatusForStage, normalizeWorkOrderStage } from '@/lib/work-orders';

export type ProductionQuantityAdjustmentCommand = {
  workOrderId: string;
  targetQty: unknown;
  frontendTransferredQty: unknown;
  completedQty: unknown;
  expectedVersion: unknown;
  reason: unknown;
  confirmReopen?: unknown;
  userId: string;
  actor: string;
};

export class ProductionQuantityAdjustmentServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PRODUCTION_QUANTITY_ADJUSTMENT_INVALID') {
    super(message);
    this.name = 'ProductionQuantityAdjustmentServiceError';
    this.status = status;
    this.code = code;
  }
}

function conflict(): ProductionQuantityAdjustmentServiceError {
  return new ProductionQuantityAdjustmentServiceError(
    '工单进度已被其他操作更新，请刷新后重试',
    409,
    'EXECUTION_VERSION_CONFLICT',
  );
}

function validateActiveWeeklyOrder(order: WorkOrder): void {
  if (!isActiveProductionWorkOrder(order)) {
    throw new ProductionQuantityAdjustmentServiceError(
      '历史周和下周草稿为只读，请在当前启用周校正数量',
      409,
      'WORK_ORDER_READ_ONLY',
    );
  }
}

function normalizedError(error: unknown): ProductionQuantityAdjustmentServiceError {
  if (error instanceof ProductionQuantityAdjustmentServiceError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return conflict();
  return new ProductionQuantityAdjustmentServiceError('生产数量校正失败', 500, 'PRODUCTION_QUANTITY_ADJUSTMENT_FAILED');
}

function quantityState(order: WorkOrder) {
  const flow = resolveEffectiveFrontendTransferredQty(order);
  if (!flow.ok) return null;
  return {
    targetQty: flow.state.targetQty,
    frontendTransferredQty: flow.state.frontendTransferredQty,
    completedQty: flow.state.completedQty,
    stage: flow.state.overallStage,
    executionVersion: flow.state.executionVersion,
  };
}

export async function adjustProductionQuantities(input: ProductionQuantityAdjustmentCommand): Promise<WorkOrder> {
  const expectedVersion = parseExecutionVersion(input.expectedVersion);
  if (!expectedVersion.ok) {
    throw new ProductionQuantityAdjustmentServiceError('生产进度版本不正确，请刷新后重试', 400, 'INVALID_EXECUTION_VERSION');
  }

  try {
    return await prisma.$transaction(async tx => {
      const old = await tx.workOrder.findFirst({ where: { id: input.workOrderId, deletedAt: null } });
      if (!old) throw new ProductionQuantityAdjustmentServiceError('工单不存在', 404, 'WORK_ORDER_NOT_FOUND');
      validateActiveWeeklyOrder(old);
      if (old.executionVersion !== expectedVersion.value) throw conflict();
      const processRoute = await tx.workOrderProcessRoute.findUnique({
        where: { workOrderId: old.id },
        select: { status: true },
      });

      const prepared = prepareProductionQuantityAdjustment({
        targetQty: input.targetQty,
        frontendTransferredQty: input.frontendTransferredQty,
        completedQty: input.completedQty,
        currentStage: old.stage || old.status,
      });
      if (!prepared.ok) {
        throw new ProductionQuantityAdjustmentServiceError(prepared.message, 400, prepared.code);
      }

      const beforeQuantity = quantityState(old);
      const reasonInput = String(input.reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 240);
      const hasExistingQuantity = beforeQuantity !== null
        || old.productionTargetQty !== null
        || old.frontendTransferredQty !== null
        || parsedImportedProductionTarget(old.uncompletedQty) !== null
        || String(old.completedQty ?? '').trim().length > 0;
      if (hasExistingQuantity && reasonInput.length < 2) {
        throw new ProductionQuantityAdjustmentServiceError('校正已有数量时必须填写调整原因', 400, 'ADJUSTMENT_REASON_REQUIRED');
      }
      if (prepared.value.reopensCompletedOrder && input.confirmReopen !== true) {
        throw new ProductionQuantityAdjustmentServiceError(
          '总目标或完成数量变化后工单将重新进入生产，请确认后再保存',
          409,
          'REOPEN_CONFIRMATION_REQUIRED',
        );
      }
      if (processRoute?.status === 'completed' && prepared.value.reopensCompletedOrder) {
        throw new ProductionQuantityAdjustmentServiceError(
          '完整工艺路线已经完成，不能仅通过数量校正重新打开，请先处理工艺路线状态',
          409,
          'PROCESS_ROUTE_REOPEN_REQUIRED',
        );
      }

      const reason = reasonInput || '补充缺失生产数量';
      const importedTargetQty = parsedImportedProductionTarget(old.uncompletedQty);
      const targetOverride = importedTargetQty === prepared.value.targetQty ? null : prepared.value.targetQty;
      const now = new Date();
      const routeStage = processRoute ? normalizeWorkOrderStage(old.stage || old.status) : null;
      const nextStage = routeStage || prepared.value.nextStage;
      const update = await tx.workOrder.updateMany({
        where: { id: old.id, deletedAt: null, executionVersion: expectedVersion.value },
        data: {
          productionTargetQty: targetOverride,
          frontendTransferredQty: prepared.value.frontendTransferredQty,
          completedQty: String(prepared.value.completedQty),
          stage: nextStage,
          status: legacyStatusForStage(nextStage),
          executionVersion: { increment: 1 },
          startedAt: nextStage === 'frontend' || nextStage === 'backend' ? old.startedAt || now : old.startedAt,
          completedAt: nextStage === 'completed' ? old.completedAt || now : null,
          lastProgressAt: now,
          latestProgressRemark: `数量校正：${reason}`,
        },
      });
      if (update.count !== 1) throw conflict();

      const changed = await tx.workOrder.findUniqueOrThrow({ where: { id: old.id } });
      const afterQuantity = quantityState(changed);
      await tx.workOrderProgressLog.create({
        data: {
          workOrderId: old.id,
          previousStage: old.stage,
          stage: changed.stage,
          completedQty: changed.completedQty,
          productionOwner: changed.productionOwner,
          workstation: changed.workstation,
          remark: `数量校正：${reason}`,
          createdBy: input.actor,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: input.userId,
          action: 'correct_work_order_quantities',
          targetType: 'work_order',
          targetId: old.id,
          detail: {
            status: 'success',
            reason,
            importedTargetQty,
            targetSource: targetOverride === null ? 'weekly_plan' : 'manual_override',
            before: beforeQuantity,
            after: afterQuantity,
          },
        },
      });
      await tx.dataChangeSnapshot.create({
        data: {
          entityType: 'work_order',
          entityId: old.id,
          action: 'correct_work_order_quantities',
          beforeJson: sanitizeSnapshotValue(workOrderSnapshot(old)),
          afterJson: sanitizeSnapshotValue(workOrderSnapshot(changed)),
          changedBy: input.actor,
        },
      });
      return changed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    throw normalizedError(error);
  }
}
