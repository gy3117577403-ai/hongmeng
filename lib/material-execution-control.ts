import { Prisma, PrismaClient } from '@prisma/client';
import { lockProductionWorkOrder } from '@/lib/production-work-order-lock';

export const MATERIAL_EXECUTION_ALLOW_ACTION = 'allow_material_risk_execution';
export const MATERIAL_EXECUTION_REVOKE_ACTION = 'revoke_material_risk_execution';

export type MaterialExecutionControlView = {
  required: boolean;
  effectiveAllowed: boolean;
  storedAllowed: boolean;
  stale: boolean;
  reason: string | null;
  decisionAt: string | null;
  decisionBy: { id: string; displayName: string } | null;
  taskId: string | null;
  taskStatus: string | null;
  taskVersion: number | null;
  authorizedTaskVersion: number | null;
};

export class MaterialExecutionControlError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

export const materialExecutionBatchSelect = Prisma.validator<Prisma.ProductionPlanBatchSelect>()({
  id: true,
  planOrderId: true,
  releaseState: true,
  workOrderId: true,
  deletedAt: true,
  materialExecutionAllowed: true,
  materialExecutionTaskVersion: true,
  materialExecutionDecisionAt: true,
  materialExecutionReason: true,
  materialExecutionDecisionBy: { select: { id: true, displayName: true } },
  workOrder: {
    select: {
      completedAt: true,
      materialTask: {
        select: { id: true, status: true, version: true },
      },
    },
  },
});

type MaterialExecutionBatchRecord = Prisma.ProductionPlanBatchGetPayload<{
  select: typeof materialExecutionBatchSelect;
}>;

type MaterialExecutionDb = Pick<Prisma.TransactionClient | PrismaClient, 'workOrder' | 'productionPlanBatch'>;

export function serializeMaterialExecutionControl(
  batch: MaterialExecutionBatchRecord | null,
): MaterialExecutionControlView {
  const task = batch?.workOrder?.materialTask || null;
  const managed = Boolean(batch && !batch.deletedAt && batch.releaseState !== 'draft' && !batch.workOrder?.completedAt);
  const required = managed && task?.status !== 'completed';
  const storedAllowed = Boolean(batch?.materialExecutionAllowed);
  const stale = Boolean(
    required
    && storedAllowed
    && (task?.version == null || batch?.materialExecutionTaskVersion !== task.version),
  );
  return {
    required,
    effectiveAllowed: !required || (storedAllowed && !stale),
    storedAllowed,
    stale,
    reason: batch?.materialExecutionReason || null,
    decisionAt: batch?.materialExecutionDecisionAt?.toISOString() || null,
    decisionBy: batch?.materialExecutionDecisionBy || null,
    taskId: task?.id || null,
    taskStatus: task?.status || null,
    taskVersion: task?.version ?? null,
    authorizedTaskVersion: batch?.materialExecutionTaskVersion ?? null,
  };
}

export async function loadMaterialExecutionControl(
  db: MaterialExecutionDb,
  workOrderId: string,
): Promise<MaterialExecutionControlView> {
  const identity = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, rootWorkOrderId: true },
  });
  if (!identity) {
    throw new MaterialExecutionControlError('工单不存在', 'WORK_ORDER_NOT_FOUND', 404);
  }
  const batch = await db.productionPlanBatch.findUnique({
    where: { workOrderId: identity.rootWorkOrderId || identity.id },
    select: materialExecutionBatchSelect,
  });
  return serializeMaterialExecutionControl(batch);
}

function cleanDecisionReason(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export async function decideMaterialExecution(
  tx: Prisma.TransactionClient,
  input: {
    batchId: string;
    allowed: boolean;
    expectedTaskVersion: number | null;
    reason: unknown;
    actorId: string;
    actorName: string;
    now?: Date;
  },
): Promise<MaterialExecutionControlView> {
  const existing = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    select: materialExecutionBatchSelect,
  });
  if (!existing || existing.deletedAt || !existing.workOrderId) {
    throw new MaterialExecutionControlError('排产批次不存在或尚未下达', 'PLAN_BATCH_NOT_EXECUTABLE', 404);
  }
  if (existing.releaseState === 'draft') {
    throw new MaterialExecutionControlError('仅已下达的批次可以设置缺料开工', 'PLAN_BATCH_NOT_EXECUTABLE');
  }

  const root = await lockProductionWorkOrder(tx, existing.workOrderId);
  if (root.id !== existing.workOrderId) {
    throw new MaterialExecutionControlError('排产批次未关联主工单，请刷新计划后重试', 'PLAN_BATCH_WORK_ORDER_MISMATCH');
  }
  if (root.completedAt) {
    throw new MaterialExecutionControlError('该工单已经完成，不能再设置缺料开工', 'PRODUCTION_ALREADY_COMPLETED');
  }
  const current = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    select: materialExecutionBatchSelect,
  });
  if (!current || current.deletedAt || current.workOrderId !== root.id) {
    throw new MaterialExecutionControlError('排产批次状态已变化，请刷新后重试', 'PLAN_BATCH_CHANGED');
  }
  const task = current.workOrder?.materialTask || null;
  if (input.allowed && !task) {
    throw new MaterialExecutionControlError('仓库配料任务尚未建立，不能授权缺料开工', 'MATERIAL_TASK_NOT_CREATED');
  }
  if (input.allowed && task?.status === 'completed') {
    throw new MaterialExecutionControlError('仓库已完成配料，无需开启缺料开工授权', 'MATERIAL_ALREADY_COMPLETED');
  }
  if (input.allowed && input.expectedTaskVersion !== task?.version) {
    throw new MaterialExecutionControlError('仓库物料状态已变化，请刷新后重新确认授权', 'MATERIAL_TASK_VERSION_CONFLICT');
  }
  const reason = cleanDecisionReason(input.reason);
  if (reason.length < 2) {
    throw new MaterialExecutionControlError('请填写至少 2 个字的授权或撤销原因', 'MATERIAL_EXECUTION_REASON_REQUIRED', 400);
  }

  const before = serializeMaterialExecutionControl(current);
  const now = input.now || new Date();
  await tx.productionPlanBatch.update({
    where: { id: current.id },
    data: {
      materialExecutionAllowed: input.allowed,
      materialExecutionTaskVersion: task?.version ?? null,
      materialExecutionDecisionAt: now,
      materialExecutionDecisionById: input.actorId,
      materialExecutionReason: reason,
    },
  });
  const updated = await tx.productionPlanBatch.findUnique({
    where: { id: current.id },
    select: materialExecutionBatchSelect,
  });
  const after = serializeMaterialExecutionControl(updated);
  const action = input.allowed ? MATERIAL_EXECUTION_ALLOW_ACTION : MATERIAL_EXECUTION_REVOKE_ACTION;
  await tx.productionPlanChange.create({
    data: {
      planOrderId: current.planOrderId,
      batchId: current.id,
      action,
      beforeData: before,
      afterData: after,
      impactData: {
        automaticStartAllowed: false,
        manualStartAllowed: after.effectiveAllowed,
        qrReportingAllowed: after.effectiveAllowed,
        materialRiskRetained: true,
      },
      reason,
      actorId: input.actorId,
    },
  });
  await tx.operationLog.create({
    data: {
      userId: input.actorId,
      action,
      targetType: 'production_plan_batch',
      targetId: current.id,
      detail: {
        workOrderId: root.id,
        actorName: input.actorName,
        reason,
        before,
        after,
      },
    },
  });
  return after;
}
