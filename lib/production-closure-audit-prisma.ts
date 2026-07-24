import type { Prisma, PrismaClient } from '@prisma/client';
import type { ProductionClosureAuditSnapshot } from './production-closure-audit';
import { getProductionQuantitySummary } from './production-quantity';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function loadProductionClosureAuditSnapshot(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<ProductionClosureAuditSnapshot> {
  const [orders, completions, movements, pools] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        processRoute: { isNot: null },
      },
      select: {
        id: true,
        code: true,
        uncompletedQty: true,
        productionTargetQty: true,
        completedQty: true,
        frontendTransferredQty: true,
        stage: true,
        status: true,
        parentWorkOrderId: true,
        rootWorkOrderId: true,
        branchType: true,
        branchStatus: true,
        originCompletionId: true,
        originStepId: true,
        rejoinStepId: true,
        branchSequence: true,
        completedAt: true,
        processRoute: {
          select: {
            id: true,
            workOrderId: true,
            status: true,
            completedAt: true,
            steps: {
              select: {
                id: true,
                routeId: true,
                processName: true,
                position: true,
                sequenceGroup: true,
                status: true,
                inputQty: true,
                processedQty: true,
                goodOutputQty: true,
                defectOutputQty: true,
                releasedGoodQty: true,
                timeBasis: true,
              },
              orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.processCompletion.findMany({
      where: {
        workOrder: {
          deletedAt: null,
          processRoute: { isNot: null },
        },
      },
      select: {
        id: true,
        workOrderId: true,
        routeId: true,
        stepId: true,
        workDate: true,
        processedQty: true,
        goodQty: true,
        defectQty: true,
        defectDisposition: true,
        routeVersion: true,
        timeBasis: true,
        voidedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.processQuantityMovement.findMany({
      where: {
        completion: {
          workOrder: {
            deletedAt: null,
            processRoute: { isNot: null },
          },
        },
      },
      select: {
        id: true,
        completionId: true,
        workOrderId: true,
        sourceStepId: true,
        targetStepId: true,
        branchWorkOrderId: true,
        type: true,
        quantity: true,
        sourceSequenceGroup: true,
        targetSequenceGroup: true,
        voidedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.processLaborPool.findMany({
      where: {
        workOrder: {
          deletedAt: null,
          processRoute: { isNot: null },
        },
      },
      select: {
        id: true,
        completionId: true,
        workOrderId: true,
        stepId: true,
        workDate: true,
        eligibleQty: true,
        claimedQty: true,
        remainingQty: true,
        status: true,
        standardMillisecondsPerUnit: true,
        setupMilliseconds: true,
        unitsPerProduct: true,
        totalStandardLaborMilliseconds: true,
        claimedStandardLaborMilliseconds: true,
        remainingStandardLaborMilliseconds: true,
        standardSource: true,
        claims: {
          select: {
            id: true,
            poolId: true,
            employeeId: true,
            quantity: true,
            standardLaborMilliseconds: true,
            workDate: true,
            status: true,
            voidedAt: true,
            reversalOfId: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    workOrders: orders.map(order => {
      const quantity = getProductionQuantitySummary(order);
      return {
        id: order.id,
        code: order.code,
        targetQty: quantity.targetQty,
        completedQty: quantity.completedQty,
        frontendTransferredQty: order.frontendTransferredQty,
        stage: order.stage,
        status: order.status,
        parentWorkOrderId: order.parentWorkOrderId,
        rootWorkOrderId: order.rootWorkOrderId,
        branchType: order.branchType,
        branchStatus: order.branchStatus,
        originCompletionId: order.originCompletionId,
        originStepId: order.originStepId,
        rejoinStepId: order.rejoinStepId,
        branchSequence: order.branchSequence,
        completedAt: iso(order.completedAt),
        route: order.processRoute ? {
          id: order.processRoute.id,
          workOrderId: order.processRoute.workOrderId,
          status: order.processRoute.status,
          completedAt: iso(order.processRoute.completedAt),
          steps: order.processRoute.steps.map(step => ({ ...step })),
        } : null,
      };
    }),
    completions: completions.map(completion => ({
      ...completion,
      workDate: completion.workDate.toISOString(),
      defectDisposition: completion.defectDisposition,
      voidedAt: iso(completion.voidedAt),
    })),
    movements: movements.map(movement => ({
      ...movement,
      voidedAt: iso(movement.voidedAt),
    })),
    laborPools: pools.map(pool => ({
      ...pool,
      workDate: pool.workDate.toISOString(),
      claims: pool.claims.map(claim => ({
        ...claim,
        workDate: claim.workDate.toISOString(),
        voidedAt: iso(claim.voidedAt),
      })),
    })),
  };
}
