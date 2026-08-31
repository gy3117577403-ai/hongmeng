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

/** Material state is a risk signal, not a generic hard hold. */
export async function overrideLegacyMaterialProductionHolds(
  tx: Prisma.TransactionClient,
  input: { actorId?: string | null; now?: Date; batchId?: string; workOrderId?: string } = {},
): Promise<number> {
  const result = await tx.productionPlanBatchHold.updateMany({
    where: {
      status: ACTIVE_HOLD_STATUS,
      holdType: MATERIAL_HOLD_TYPE,
      sourceType: 'WAREHOUSE_MATERIAL_TASK',
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
    },
    data: {
      status: 'OVERRIDDEN',
      resolvedAt: input.now || new Date(),
      resolvedById: input.actorId || null,
      overrideReason: 'MATERIAL_HARD_HOLD_POLICY_DISABLED',
      version: { increment: 1 },
    },
  });
  return result.count;
}

/**
 * Warehouse transitions still call this compatibility hook. It only retires
 * legacy material holds and never creates/reactivates a production hard hold.
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
  await overrideLegacyMaterialProductionHolds(tx, {
    batchId: batch.id,
    workOrderId: input.workOrderId,
    actorId: input.actorId,
    now: input.now,
  });
}
