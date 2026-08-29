import type { Prisma } from '@prisma/client';

export const MATERIAL_HOLD_TYPE = 'MATERIAL';
export const ACTIVE_HOLD_STATUS = 'ACTIVE';

export type MaterialHoldInput = {
  workOrderId: string;
  warehouseTaskId: string;
  status: string;
  exceptionType?: string | null;
  exceptionNote?: string | null;
  expectedAt?: Date | null;
  actorId?: string | null;
  now?: Date;
};

const reasonLabels: Record<string, string> = {
  pending: '待配料',
  shortage: '缺料',
  insufficient_quantity: '数量不足',
  wrong_material: '错料',
  quality_issue: '来料质量异常',
  other: '物料异常',
};

export function materialHoldReasonCode(status: string, exceptionType?: string | null): string {
  if (status === 'exception') return String(exceptionType || 'other').toLowerCase();
  return status === 'completed' ? 'completed' : 'pending';
}

export function materialHoldReason(status: string, exceptionType?: string | null, note?: string | null): string {
  const code = materialHoldReasonCode(status, exceptionType);
  const label = reasonLabels[code] || '物料未齐套';
  const detail = String(note || '').trim();
  return detail ? `${label}：${detail}` : label;
}

/**
 * Synchronize the current material execution hold in the same transaction as
 * the warehouse transition. A completed task resolves only the MATERIAL hold;
 * manual, quality and equipment controls remain independent.
 */
export async function synchronizeMaterialProductionHold(
  tx: Prisma.TransactionClient,
  input: MaterialHoldInput,
): Promise<void> {
  const batch = await tx.productionPlanBatch.findUnique({
    where: { workOrderId: input.workOrderId },
    select: { id: true, releaseState: true, deletedAt: true },
  });
  if (!batch || batch.deletedAt || batch.releaseState === 'draft' || batch.releaseState === 'archived') return;
  const now = input.now || new Date();
  const dedupeKey = `material:${batch.id}`;
  if (input.status === 'completed') {
    await tx.productionPlanBatchHold.updateMany({
      where: { dedupeKey, status: ACTIVE_HOLD_STATUS },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        resolvedById: input.actorId || null,
        overrideReason: null,
        version: { increment: 1 },
      },
    });
    return;
  }
  const reasonCode = materialHoldReasonCode(input.status, input.exceptionType);
  await tx.productionPlanBatchHold.upsert({
    where: { dedupeKey },
    create: {
      batchId: batch.id,
      workOrderId: input.workOrderId,
      dedupeKey,
      holdType: MATERIAL_HOLD_TYPE,
      reasonCode,
      sourceType: 'WAREHOUSE_MATERIAL_TASK',
      sourceId: input.warehouseTaskId,
      status: ACTIVE_HOLD_STATUS,
      reason: materialHoldReason(input.status, input.exceptionType, input.exceptionNote),
      expectedResolveAt: input.expectedAt || null,
      frozenAt: now,
      frozenById: input.actorId || null,
    },
    update: {
      workOrderId: input.workOrderId,
      reasonCode,
      sourceType: 'WAREHOUSE_MATERIAL_TASK',
      sourceId: input.warehouseTaskId,
      status: ACTIVE_HOLD_STATUS,
      reason: materialHoldReason(input.status, input.exceptionType, input.exceptionNote),
      expectedResolveAt: input.expectedAt || null,
      frozenAt: now,
      frozenById: input.actorId || null,
      resolvedAt: null,
      resolvedById: null,
      overrideReason: null,
      version: { increment: 1 },
    },
  });
}
