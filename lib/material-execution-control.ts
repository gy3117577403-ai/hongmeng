import { Prisma, PrismaClient } from '@prisma/client';

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
  const storedAllowed = Boolean(batch?.materialExecutionAllowed);
  return {
    // Compatibility view only. Since v1.34.81 material readiness no longer
    // participates in start/report authorization. Historical decisions are
    // retained for audit, but are deliberately never effective gates.
    required: false,
    effectiveAllowed: true,
    storedAllowed,
    stale: false,
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

export async function decideMaterialExecution(
  _tx: Prisma.TransactionClient,
  _input: {
    batchId: string;
    allowed: boolean;
    expectedTaskVersion: number | null;
    reason: unknown;
    actorId: string;
    actorName: string;
    now?: Date;
  },
): Promise<MaterialExecutionControlView> {
  throw new MaterialExecutionControlError(
    '缺料开工授权开关已取消：未配料、缺料、料不齐或料错均不影响正常开工和报工',
    'MATERIAL_EXECUTION_POLICY_RETIRED',
    410,
  );
}
