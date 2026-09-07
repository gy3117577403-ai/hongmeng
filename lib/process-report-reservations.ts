import { Prisma } from '@prisma/client';

/** Pending reports reserve known units only; an ambiguous action is never guessed into a product. */
export async function pendingProcessReportReservations(
  tx: Prisma.TransactionClient,
  stepId: string,
  excludeSubmissionId?: string,
) {
  const rows = await tx.processReportSubmission.findMany({
    where: { stepId, status: 'PENDING', completionId: null,
      ...(excludeSubmissionId ? { id: { not: excludeSubmissionId } } : {}) },
    select: { id: true, sourceKind: true, sourceLotId: true, sourceAllocationId: true,
      reservedProductQty: true, reservedGoodUnits: true },
  });
  return {
    rows,
    hasUnmeasured: rows.some(row => row.reservedProductQty === 0 && row.reservedGoodUnits === 0),
    productQty: rows.reduce((sum, row) => sum + row.reservedProductQty, 0),
    goodUnits: rows.reduce((sum, row) => sum + row.reservedGoodUnits, 0),
  };
}
