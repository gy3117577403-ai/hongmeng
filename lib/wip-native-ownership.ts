import {
  SemiFinishedScheduleStatus,
  WipRequirementStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';

type WipOwnershipClient = Prisma.TransactionClient | typeof prisma;

export type WipOwnedProcessPair = {
  workOrderId: string;
  productionPlanBatchId: string;
  stepId: string;
};

export function wipOwnershipKey(workOrderId: string, productionPlanBatchId: string, stepId: string): string {
  return `${workOrderId}:${productionPlanBatchId}:${stepId}`;
}

export function outstandingWipQuantity(input: {
  remainingQty: number;
  creditedQuantities: readonly number[];
}): number {
  const remainingQty = Math.max(0, Math.trunc(input.remainingQty || 0));
  const creditedQty = input.creditedQuantities.reduce(
    (sum, quantity) => sum + Math.max(0, Math.trunc(quantity || 0)),
    0,
  );
  return Math.max(0, remainingQty - creditedQty);
}

/**
 * Native execution may only consume the unfinished quantity that is not still
 * owned by a non-cancelled semi-finished lot. WIP reports update the canonical
 * process step too, so completed WIP must not be subtracted a second time.
 */
export function nativeExecutableQuantity(input: {
  batchQuantity: number;
  processedQuantity: number;
  outstandingWipQuantity: number;
}): number {
  return Math.max(
    0,
    Math.trunc(input.batchQuantity || 0)
      - Math.max(0, Math.trunc(input.processedQuantity || 0))
      - Math.max(0, Math.trunc(input.outstandingWipQuantity || 0)),
  );
}

/**
 * Returns the already-completed checkpoint quantity that still belongs to the
 * native order. Finished output and unfinished WIP are separate ownership
 * pools and must never be reused as the progress of a newly created WIP lot.
 */
export function nativeCheckpointCompletedQuantity(input: {
  stepGoodOutputQuantity: number;
  finalGoodOutputQuantity: number;
  outstandingWipQuantity: number;
}): number {
  return Math.max(
    0,
    Math.trunc(input.stepGoodOutputQuantity || 0)
      - Math.max(0, Math.trunc(input.finalGoodOutputQuantity || 0))
      - Math.max(0, Math.trunc(input.outstandingWipQuantity || 0)),
  );
}

/**
 * Returns per-process WIP ownership. Source ownership is intentionally not
 * filtered by the target allocation team: a target team visibility boundary
 * cannot make the same quantity executable again on the original order.
 */
export async function loadOutstandingWipByProcess(
  client: WipOwnershipClient,
  pairs: readonly WipOwnedProcessPair[],
): Promise<Map<string, number>> {
  const normalizedPairs = [...new Map(pairs.map(pair => {
    const workOrderId = String(pair.workOrderId || '').trim();
    const productionPlanBatchId = String(pair.productionPlanBatchId || '').trim();
    const stepId = String(pair.stepId || '').trim();
    return [
      wipOwnershipKey(workOrderId, productionPlanBatchId, stepId),
      { workOrderId, productionPlanBatchId, stepId },
    ] as const;
  })).values()].filter(pair => pair.workOrderId && pair.productionPlanBatchId && pair.stepId);
  if (!normalizedPairs.length) return new Map();

  const requestedKeys = new Set(normalizedPairs.map(pair => (
    wipOwnershipKey(pair.workOrderId, pair.productionPlanBatchId, pair.stepId)
  )));
  const workOrderIds = [...new Set(normalizedPairs.map(pair => pair.workOrderId))];
  const productionPlanBatchIds = [...new Set(normalizedPairs.map(pair => pair.productionPlanBatchId))];
  const stepIds = [...new Set(normalizedPairs.map(pair => pair.stepId))];
  const workOrderChunks = Array.from(
    { length: Math.ceil(workOrderIds.length / 500) },
    (_, index) => workOrderIds.slice(index * 500, (index + 1) * 500),
  );
  const rows = (await Promise.all(workOrderChunks.map(workOrderIdChunk => (
    client.semiFinishedLotStep.findMany({
      where: {
        stepId: { in: stepIds },
        status: { not: WipRequirementStatus.CANCELLED },
        lot: {
          workOrderId: { in: workOrderIdChunk },
          productionPlanBatchId: { in: productionPlanBatchIds },
          scheduleStatus: { not: SemiFinishedScheduleStatus.CANCELLED },
        },
      },
      select: {
        stepId: true,
        remainingQty: true,
        lot: { select: { workOrderId: true, productionPlanBatchId: true } },
        allocationSteps: {
          select: {
            credits: {
              where: { status: 'ACTIVE' },
              select: { quantity: true },
            },
          },
        },
      },
    })
  )))).flat();

  const result = new Map<string, number>();
  for (const row of rows) {
    const key = wipOwnershipKey(row.lot.workOrderId, row.lot.productionPlanBatchId, row.stepId);
    if (!requestedKeys.has(key)) continue;
    const quantity = outstandingWipQuantity({
      remainingQty: row.remainingQty,
      creditedQuantities: row.allocationSteps.flatMap(allocationStep => (
        allocationStep.credits.map(credit => credit.quantity)
      )),
    });
    result.set(key, (result.get(key) || 0) + quantity);
  }
  return result;
}
