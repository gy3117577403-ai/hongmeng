import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Materializes which reported good actions support each completed good set.
 * The ledger is deterministic FIFO and only consumes actions that existed no
 * later than the consumer completion. It is safe to call repeatedly.
 */
export async function materializeProcessActionConsumptions(
  tx: Tx,
  stepId: string,
): Promise<void> {
  const completions = await tx.processCompletion.findMany({
    where: { stepId, voidedAt: null, reportQuantityBasis: 'action' },
    orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      reportedGoodUnitQty: true,
      goodQty: true,
      unitsPerProduct: true,
    },
  });
  if (!completions.length) return;

  const allocations = await tx.processActionConsumption.findMany({
    where: { stepId, voidedAt: null },
    select: { sourceCompletionId: true, consumerCompletionId: true, quantity: true },
  });
  const remainingBySource = new Map(completions.map(item => [item.id, item.reportedGoodUnitQty]));
  const allocatedByConsumer = new Map<string, number>();
  const pairKeys = new Set<string>();
  for (const allocation of allocations) {
    remainingBySource.set(
      allocation.sourceCompletionId,
      (remainingBySource.get(allocation.sourceCompletionId) || 0) - allocation.quantity,
    );
    allocatedByConsumer.set(
      allocation.consumerCompletionId,
      (allocatedByConsumer.get(allocation.consumerCompletionId) || 0) + allocation.quantity,
    );
    pairKeys.add(`${allocation.sourceCompletionId}:${allocation.consumerCompletionId}`);
  }

  for (let consumerIndex = 0; consumerIndex < completions.length; consumerIndex += 1) {
    const consumer = completions[consumerIndex];
    let required = consumer.goodQty * consumer.unitsPerProduct
      - (allocatedByConsumer.get(consumer.id) || 0);
    if (required <= 0) continue;
    for (let sourceIndex = 0; sourceIndex <= consumerIndex && required > 0; sourceIndex += 1) {
      const source = completions[sourceIndex];
      const available = remainingBySource.get(source.id) || 0;
      if (available <= 0) continue;
      const pairKey = `${source.id}:${consumer.id}`;
      if (pairKeys.has(pairKey)) continue;
      const quantity = Math.min(required, available);
      await tx.processActionConsumption.create({
        data: {
          stepId,
          sourceCompletionId: source.id,
          consumerCompletionId: consumer.id,
          quantity,
          idempotencyKey: `action-consume:${source.id}:${consumer.id}`.slice(0, 190),
        },
      });
      pairKeys.add(pairKey);
      remainingBySource.set(source.id, available - quantity);
      required -= quantity;
    }
    if (required > 0) {
      throw new Error('动作产出台账不足以支持已形成的整套良品');
    }
  }
}

export async function voidProcessActionConsumptionsForCompletion(
  tx: Tx,
  input: { completionId: string; userId: string; reason: string; now: Date },
): Promise<number> {
  const result = await tx.processActionConsumption.updateMany({
    where: {
      voidedAt: null,
      OR: [
        { sourceCompletionId: input.completionId },
        { consumerCompletionId: input.completionId },
      ],
    },
    data: {
      voidedAt: input.now,
      voidedById: input.userId,
      voidReason: input.reason || null,
    },
  });
  return result.count;
}
