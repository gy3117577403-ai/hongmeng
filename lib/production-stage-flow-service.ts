import { Prisma, type WorkOrder } from '@prisma/client';
import { sanitizeSnapshotValue, workOrderSnapshot } from '@/lib/change-snapshots';
import { prisma } from '@/lib/prisma';
import { startConfirmedProcessRouteAfterDrawing } from '@/lib/process-route-service';
import {
  compatibleStageForQuantities,
  parseExecutionVersion,
  parsePositiveProductionQuantity,
  resolveEffectiveFrontendTransferredQty,
} from '@/lib/production-stage-flow';
import { isActiveProductionWorkOrder, legacyStatusForStage, type WorkOrderStage } from '@/lib/work-orders';

export const PRODUCTION_STAGE_FLOW_ACTIONS = [
  'confirm_drawing_issued',
  'transfer_to_backend',
  'complete_from_backend',
] as const;

export type ProductionStageFlowAction = (typeof PRODUCTION_STAGE_FLOW_ACTIONS)[number];

export type ProductionStageFlowCommand = {
  workOrderId: string;
  action: ProductionStageFlowAction;
  quantity?: unknown;
  expectedVersion: unknown;
  userId: string;
  actor: string;
};

export class ProductionStageFlowServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'PRODUCTION_STAGE_FLOW_INVALID') {
    super(message);
    this.name = 'ProductionStageFlowServiceError';
    this.status = status;
    this.code = code;
  }
}

type QuantitySnapshot = {
  targetQty: number;
  frontendTransferredQty: number;
  completedQty: number;
  executionVersion: number;
  stage: WorkOrderStage;
};

type FlowFailureContext = {
  before: QuantitySnapshot | null;
};

function quantitySnapshot(input: QuantitySnapshot): QuantitySnapshot {
  return {
    targetQty: input.targetQty,
    frontendTransferredQty: input.frontendTransferredQty,
    completedQty: input.completedQty,
    executionVersion: input.executionVersion,
    stage: input.stage,
  };
}

function isProductionStageFlowAction(value: unknown): value is ProductionStageFlowAction {
  return PRODUCTION_STAGE_FLOW_ACTIONS.includes(value as ProductionStageFlowAction);
}

export function parseProductionStageFlowAction(value: unknown): ProductionStageFlowAction | null {
  return isProductionStageFlowAction(value) ? value : null;
}

function conflict(): ProductionStageFlowServiceError {
  return new ProductionStageFlowServiceError(
    '工单进度已被其他操作更新，请刷新后重试',
    409,
    'EXECUTION_VERSION_CONFLICT',
  );
}

function validateActiveWeeklyOrder(order: WorkOrder): void {
  if (!isActiveProductionWorkOrder(order)) {
    throw new ProductionStageFlowServiceError(
      '历史周和下周草稿为只读，请在当前启用周更新进度',
      409,
      'WORK_ORDER_READ_ONLY',
    );
  }
}

function resolveOrderFlow(order: WorkOrder) {
  const resolution = resolveEffectiveFrontendTransferredQty(order);
  if (!resolution.ok) {
    throw new ProductionStageFlowServiceError(
      `${resolution.error.message}（工单 ${order.id}，字段 ${resolution.error.field}）`,
      409,
      resolution.error.code,
    );
  }
  if (resolution.state.targetQty <= 0) {
    throw new ProductionStageFlowServiceError('目标数量必须大于 0 后才能流转', 409, 'TARGET_QUANTITY_REQUIRED');
  }
  return resolution.state;
}

function safeFailureReason(error: unknown): { code: string; reason: string; status: number } {
  if (error instanceof ProductionStageFlowServiceError) {
    return { code: error.code, reason: error.message.slice(0, 240), status: error.status };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return { code: 'EXECUTION_VERSION_CONFLICT', reason: '并发事务冲突', status: 409 };
  }
  return { code: 'PRODUCTION_STAGE_FLOW_FAILED', reason: '生产数量流转失败', status: 500 };
}

function safeLogScalar(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.slice(0, 64);
  return null;
}

async function logFailedFlow(
  input: ProductionStageFlowCommand,
  error: unknown,
  context: FlowFailureContext = { before: null },
): Promise<void> {
  const failure = safeFailureReason(error);
  try {
    await prisma.operationLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        targetType: 'work_order',
        targetId: input.workOrderId,
        detail: {
          status: 'failed',
          code: failure.code,
          reason: failure.reason,
          quantity: safeLogScalar(input.quantity),
          expectedVersion: safeLogScalar(input.expectedVersion),
          before: context.before,
          after: null,
        },
      },
    });
  } catch {
    console.warn('production stage flow failure log could not be written', {
      action: input.action,
      workOrderId: input.workOrderId,
      code: failure.code,
    });
  }
}

function normalizedFlowError(error: unknown): ProductionStageFlowServiceError {
  if (error instanceof ProductionStageFlowServiceError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return conflict();
  return new ProductionStageFlowServiceError('生产数量流转失败', 500, 'PRODUCTION_STAGE_FLOW_FAILED');
}

export async function applyProductionStageFlow(input: ProductionStageFlowCommand): Promise<WorkOrder> {
  const failureContext: FlowFailureContext = { before: null };
  const expectedVersion = parseExecutionVersion(input.expectedVersion);
  if (!expectedVersion.ok) {
    const error = new ProductionStageFlowServiceError('生产进度版本不正确，请刷新后重试', 400, 'INVALID_EXECUTION_VERSION');
    await logFailedFlow(input, error);
    throw error;
  }

  const parsedQuantity = input.action === 'confirm_drawing_issued'
    ? null
    : parsePositiveProductionQuantity(input.quantity);
  if (parsedQuantity && !parsedQuantity.ok) {
    const error = new ProductionStageFlowServiceError('本次数量必须是正整数', 400, 'INVALID_FLOW_QUANTITY');
    await logFailedFlow(input, error);
    throw error;
  }

  try {
    return await prisma.$transaction(async tx => {
      const old = await tx.workOrder.findFirst({ where: { id: input.workOrderId, deletedAt: null } });
      if (!old) throw new ProductionStageFlowServiceError('工单不存在', 404, 'WORK_ORDER_NOT_FOUND');
      validateActiveWeeklyOrder(old);
      const processRoute = await tx.workOrderProcessRoute.findUnique({
        where: { workOrderId: old.id },
        select: { id: true, status: true },
      });
      if (!processRoute || processRoute.status === 'draft') {
        throw new ProductionStageFlowServiceError(
          '请先维护并发布当前产品的工序与工时',
          409,
          processRoute ? 'PROCESS_ROUTE_NOT_CONFIRMED' : 'PROCESS_ROUTE_REQUIRED',
        );
      }
      if (input.action !== 'confirm_drawing_issued') {
        throw new ProductionStageFlowServiceError(
          '该工单已启用完整工艺路线，请按当前工序推进',
          409,
          'USE_PROCESS_ROUTE',
        );
      }

      const state = resolveOrderFlow(old);
      failureContext.before = quantitySnapshot({
        targetQty: state.targetQty,
        frontendTransferredQty: state.frontendTransferredQty,
        completedQty: state.completedQty,
        executionVersion: state.executionVersion,
        stage: state.overallStage,
      });
      if (state.executionVersion !== expectedVersion.value) throw conflict();

      const now = new Date();
      const quantity = parsedQuantity?.ok ? parsedQuantity.value : 0;
      let transferred = state.frontendTransferredQty;
      let completed = state.completedQty;
      let nextStage: WorkOrderStage;
      let progressRemark: string;
      const updateData: Prisma.WorkOrderUpdateManyMutationInput = {
        executionVersion: { increment: 1 },
        lastProgressAt: now,
      };

      if (input.action === 'confirm_drawing_issued') {
        if (state.overallStage !== 'not_issued' || transferred !== 0 || completed !== 0) {
          throw new ProductionStageFlowServiceError('当前工单不处于待下发图纸状态', 409, 'DRAWING_CONFIRMATION_NOT_ALLOWED');
        }
        nextStage = 'frontend';
        progressRemark = '确认图纸已下发并进入前端';
        updateData.frontendTransferredQty = 0;
        updateData.drawingStatus = '已发';
        updateData.drawingIssuedAt = old.drawingIssuedAt || now;
        updateData.startedAt = old.startedAt || now;
      } else if (input.action === 'transfer_to_backend') {
        if (state.overallStage === 'not_issued') {
          throw new ProductionStageFlowServiceError('请先确认图纸已下发并进入前端', 409, 'DRAWING_NOT_ISSUED');
        }
        if (quantity > state.frontendRemainingQty) {
          throw new ProductionStageFlowServiceError(
            `本次进入后端数量不能超过前端剩余 ${state.frontendRemainingQty}`,
            400,
            'TRANSFER_QUANTITY_EXCEEDS_REMAINING',
          );
        }
        transferred += quantity;
        nextStage = compatibleStageForQuantities({
          targetQty: state.targetQty,
          frontendTransferredQty: transferred,
          completedQty: completed,
        });
        progressRemark = `前端转后端 ${quantity}`;
        updateData.frontendTransferredQty = transferred;
        updateData.startedAt = old.startedAt || now;
      } else {
        if (quantity > state.backendRemainingQty) {
          throw new ProductionStageFlowServiceError(
            `本次完成数量不能超过后端剩余 ${state.backendRemainingQty}`,
            400,
            'COMPLETION_QUANTITY_EXCEEDS_REMAINING',
          );
        }
        completed += quantity;
        nextStage = compatibleStageForQuantities({
          targetQty: state.targetQty,
          frontendTransferredQty: transferred,
          completedQty: completed,
        });
        progressRemark = `后端完成 ${quantity}`;
        updateData.frontendTransferredQty = transferred;
        updateData.completedQty = String(completed);
        updateData.startedAt = old.startedAt || now;
        updateData.completedAt = completed === state.targetQty ? old.completedAt || now : null;
      }

      updateData.stage = nextStage;
      updateData.status = legacyStatusForStage(nextStage);
      updateData.latestProgressRemark = progressRemark;

      const update = await tx.workOrder.updateMany({
        where: {
          id: old.id,
          deletedAt: null,
          executionVersion: expectedVersion.value,
        },
        data: updateData,
      });
      if (update.count !== 1) throw conflict();

      if (input.action === 'confirm_drawing_issued') {
        await startConfirmedProcessRouteAfterDrawing(tx, {
          workOrderId: old.id,
          userId: input.userId,
          actor: input.actor,
          now,
        });
      }
      const changed = await tx.workOrder.findUniqueOrThrow({ where: { id: old.id } });
      const beforeQuantity = quantitySnapshot({
        targetQty: state.targetQty,
        frontendTransferredQty: state.frontendTransferredQty,
        completedQty: state.completedQty,
        executionVersion: state.executionVersion,
        stage: state.overallStage,
      });
      const afterQuantity = quantitySnapshot({
        targetQty: state.targetQty,
        frontendTransferredQty: transferred,
        completedQty: completed,
        executionVersion: expectedVersion.value + 1,
        stage: nextStage,
      });

      await tx.workOrderProgressLog.create({
        data: {
          workOrderId: old.id,
          previousStage: state.overallStage,
          stage: nextStage,
          completedQty: changed.completedQty,
          productionOwner: changed.productionOwner,
          workstation: changed.workstation,
          remark: progressRemark,
          createdBy: input.actor,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          targetType: 'work_order',
          targetId: old.id,
          detail: {
            status: 'success',
            quantity,
            before: beforeQuantity,
            after: afterQuantity,
          },
        },
      });
      await tx.dataChangeSnapshot.create({
        data: {
          entityType: 'work_order',
          entityId: old.id,
          action: input.action,
          beforeJson: sanitizeSnapshotValue(workOrderSnapshot(old)),
          afterJson: sanitizeSnapshotValue(workOrderSnapshot(changed)),
          changedBy: input.actor,
        },
      });
      return changed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const normalized = normalizedFlowError(error);
    await logFailedFlow(input, normalized, failureContext);
    throw normalized;
  }
}
