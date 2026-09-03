import { Prisma, WipWeekAllocationStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  productionTeamScopeWhere,
  type ProductionEntityScope,
} from '@/lib/production-access-scope';
import { chinaDate } from '@/lib/production-planning';

const VISIBLE_WIP_ALLOCATION_STATUSES: WipWeekAllocationStatus[] = [
  WipWeekAllocationStatus.ACTIVE,
  WipWeekAllocationStatus.IN_PROGRESS,
  WipWeekAllocationStatus.COMPLETED,
];

/**
 * WIP week columns are persisted as date-only UTC midnight values, while the
 * production board resolves China-local week boundaries (16:00 UTC on the
 * preceding day). Canonicalize both inputs through their China calendar date
 * before applying an equality filter, otherwise a valid target-week task can
 * disappear from Production Execution while still showing in Planning.
 */
function canonicalWipWeekDate(value: Date): Date {
  return new Date(`${chinaDate(value)}T00:00:00.000Z`);
}

function safeBigintNumber(value: bigint): number {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

export type WipContinuationStep = {
  allocationStepId: string;
  lotStepId: string;
  stepId: string;
  processName: string;
  position: number;
  plannedQty: number;
  completedQty: number;
  remainingQty: number;
  plannedStandardMilliseconds: number;
  completedStandardMilliseconds: number;
  remainingStandardMilliseconds: number;
  status: string;
};

export type WipContinuationProjection = {
  stableId: string;
  allocationId: string;
  sourceAllocationId: string | null;
  lotId: string;
  lotNo: string;
  lotQuantity: number;
  productionPlanBatchId: string;
  workOrderId: string;
  workOrderCode: string;
  batchNo: number;
  customerName: string;
  productName: string;
  specification: string;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  crossWeek: boolean;
  quantity: number;
  completedQty: number;
  remainingQty: number;
  plannedStandardMilliseconds: number;
  completedStandardMilliseconds: number;
  remainingStandardMilliseconds: number;
  plannedHours: number;
  completedHours: number;
  remainingHours: number;
  status: string;
  reason: string;
  materialWarning: string | null;
  team: { id: string; code: string; name: string } | null;
  workers: Array<{
    assignmentId: string;
    employeeId: string;
    employeeNo: string;
    name: string;
    team: string | null;
    position: string | null;
  }>;
  scheduledBy: { id: string; displayName: string };
  scheduledAt: string;
  steps: WipContinuationStep[];
};

export type WipSourceLotProjection = {
  lotId: string;
  lotNo: string;
  lotQuantity: number;
  outstandingQuantity: number;
  scheduledOutstandingQuantity: number;
  productionPlanBatchId: string;
  workOrderId: string;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  scheduleStatus: string;
};

/**
 * Load WIP ownership independently from week allocations. A newly entered lot
 * has no allocation yet, but it already owns its source quantity and therefore
 * must restrict the native production row immediately.
 *
 * The caller supplies work orders that have already passed production access
 * filtering. Do not apply target-team scope here: source ownership is a durable
 * fact even when the eventual target team is outside the viewer's task scope.
 */
export async function loadWipSourceLots(input: {
  workOrderIds: string[];
  take?: number;
}): Promise<WipSourceLotProjection[]> {
  const workOrderIds = [...new Set(input.workOrderIds
    .map(value => String(value || '').trim())
    .filter(Boolean))];
  if (!workOrderIds.length) return [];
  const requestedTake = input.take === undefined
    ? null
    : Math.min(Math.max(input.take, 1), 50_000);
  const idChunks = Array.from({ length: Math.ceil(workOrderIds.length / 1000) }, (_, index) => (
    workOrderIds.slice(index * 1000, (index + 1) * 1000)
  ));
  const lots = (await Promise.all(idChunks.map(workOrderIdChunk => prisma.semiFinishedLot.findMany({
      where: {
        workOrderId: { in: workOrderIdChunk },
        scheduleStatus: { not: 'CANCELLED' },
        workOrder: { deletedAt: null },
        productionPlanBatch: { deletedAt: null, planOrder: { deletedAt: null } },
      },
      select: {
        id: true,
        lotNo: true,
        quantity: true,
        productionPlanBatchId: true,
        workOrderId: true,
        sourceWeekStartDate: true,
        sourceWeekEndDate: true,
        scheduleStatus: true,
        enteredAt: true,
        allocations: {
          where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
          select: { quantity: true, completedQty: true },
        },
        steps: {
          orderBy: { position: 'desc' },
          take: 1,
          select: {
            remainingQty: true,
            allocationSteps: {
              select: {
                credits: {
                  where: { status: 'ACTIVE' },
                  select: { quantity: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
      ...(requestedTake === null ? {} : { take: requestedTake }),
    })))).flat()
    .sort((first, second) => first.enteredAt.getTime() - second.enteredAt.getTime() || first.id.localeCompare(second.id))
    .slice(0, requestedTake ?? undefined);
  return lots.map(lot => {
    const terminalStep = lot.steps[0];
    const terminalCompletedQuantity = terminalStep?.allocationSteps.reduce((sum, allocationStep) => (
      sum + allocationStep.credits.reduce((creditSum, credit) => creditSum + credit.quantity, 0)
    ), 0) || 0;
    return {
      lotId: lot.id,
      lotNo: lot.lotNo,
      lotQuantity: lot.quantity,
      // Terminal active credits are the WIP quantities already reflected in
      // workOrder.completedQty. Superseded allocation history remains linked
      // through its allocation steps, so it is intentionally included here.
      outstandingQuantity: terminalStep
        ? Math.max(0, terminalStep.remainingQty - terminalCompletedQuantity)
        : lot.quantity,
      scheduledOutstandingQuantity: lot.allocations.reduce((sum, allocation) => (
        sum + Math.max(0, allocation.quantity - allocation.completedQty)
      ), 0),
      productionPlanBatchId: lot.productionPlanBatchId,
      workOrderId: lot.workOrderId,
      sourceWeekStartDate: chinaDate(lot.sourceWeekStartDate),
      sourceWeekEndDate: chinaDate(lot.sourceWeekEndDate),
      scheduleStatus: lot.scheduleStatus,
    };
  });
}

export async function loadWipContinuations(input: {
  targetWeekStartDate?: Date | null;
  sourceWeekStartDate?: Date | null;
  workOrderId?: string | null;
  workOrderIds?: string[] | null;
  keyword?: string | null;
  productionScope?: ProductionEntityScope;
  includeSupersededHistory?: boolean;
  take?: number;
}): Promise<WipContinuationProjection[]> {
  const keyword = String(input.keyword || '').trim().slice(0, 160);
  const targetWeekStartDate = input.targetWeekStartDate
    ? canonicalWipWeekDate(input.targetWeekStartDate)
    : null;
  const sourceWeekStartDate = input.sourceWeekStartDate
    ? canonicalWipWeekDate(input.sourceWeekStartDate)
    : null;
  const teamWhere = input.productionScope
    ? productionTeamScopeWhere(input.productionScope)
    : null;
  const workOrderIds = [...new Set([
    ...(input.workOrderId ? [input.workOrderId] : []),
    ...(input.workOrderIds || []),
  ].map(value => String(value || '').trim()).filter(Boolean))];
  const requestedTake = input.take === undefined
    ? null
    : Math.min(Math.max(input.take, 1), 50_000);
  const workOrderIdChunks = workOrderIds.length
    ? Array.from({ length: Math.ceil(workOrderIds.length / 1000) }, (_, index) => (
        workOrderIds.slice(index * 1000, (index + 1) * 1000)
      ))
    : [null];
  const records = (await Promise.all(workOrderIdChunks.map(workOrderIdChunk => prisma.wipWeekAllocation.findMany({
      where: {
        ...(input.includeSupersededHistory ? {
          OR: [
            { status: { in: VISIBLE_WIP_ALLOCATION_STATUSES } },
            {
              status: WipWeekAllocationStatus.SUPERSEDED,
              OR: [
                { completedQty: { gt: 0 } },
                { completedStandardMilliseconds: { gt: 0n } },
                {
                  steps: {
                    some: {
                      OR: [
                        { completedQty: { gt: 0 } },
                        { completedStandardMilliseconds: { gt: 0n } },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        } : { status: { in: VISIBLE_WIP_ALLOCATION_STATUSES } }),
        ...(targetWeekStartDate ? { targetWeekStartDate } : {}),
        ...(teamWhere ? { team: { is: teamWhere as Prisma.ProductionTeamWhereInput } } : {}),
        lot: {
          scheduleStatus: { not: 'CANCELLED' },
          ...(sourceWeekStartDate ? { sourceWeekStartDate } : {}),
          ...(workOrderIdChunk ? { workOrderId: { in: workOrderIdChunk } } : {}),
          workOrder: { deletedAt: null },
          productionPlanBatch: { deletedAt: null, planOrder: { deletedAt: null } },
          ...(keyword ? {
            OR: [
              { lotNo: { contains: keyword, mode: 'insensitive' } },
              { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
              { workOrder: { businessCode: { contains: keyword, mode: 'insensitive' } } },
              { productionPlanBatch: { planOrder: { customerName: { contains: keyword, mode: 'insensitive' } } } },
              { productionPlanBatch: { planOrder: { productName: { contains: keyword, mode: 'insensitive' } } } },
              { productionPlanBatch: { planOrder: { specification: { contains: keyword, mode: 'insensitive' } } } },
            ],
          } : {}),
        },
      },
      select: {
        id: true,
        sourceAllocationId: true,
        targetWeekStartDate: true,
        targetWeekEndDate: true,
        quantity: true,
        completedQty: true,
        plannedStandardMilliseconds: true,
        completedStandardMilliseconds: true,
        status: true,
        reason: true,
        scheduledAt: true,
        scheduledBy: { select: { id: true, displayName: true } },
        team: { select: { id: true, code: true, name: true } },
        workers: {
          where: { status: 'ACTIVE' },
          orderBy: [{ position: 'asc' }, { assignedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            employeeId: true,
            employee: {
              select: {
                employeeNo: true,
                name: true,
                team: true,
                position: true,
              },
            },
          },
        },
        lot: {
          select: {
            id: true,
            lotNo: true,
            quantity: true,
            productionPlanBatchId: true,
            workOrderId: true,
            sourceWeekStartDate: true,
            sourceWeekEndDate: true,
            materialStatusSnapshot: true,
            workOrder: { select: { code: true, businessCode: true } },
            productionPlanBatch: {
              select: {
                batchNo: true,
                planOrder: {
                  select: {
                    customerName: true,
                    productName: true,
                    specification: true,
                  },
                },
              },
            },
          },
        },
        steps: {
          orderBy: { lotStep: { position: 'asc' } },
          select: {
            id: true,
            lotStepId: true,
            plannedQty: true,
            completedQty: true,
            plannedStandardMilliseconds: true,
            completedStandardMilliseconds: true,
            status: true,
            lotStep: {
              select: {
                stepId: true,
                processName: true,
                position: true,
              },
            },
          },
        },
      },
      orderBy: [
        { targetWeekStartDate: 'asc' },
        { scheduledAt: 'asc' },
        { id: 'asc' },
      ],
      ...(requestedTake === null ? {} : { take: requestedTake }),
    })))).flat()
    .sort((first, second) => (
      first.targetWeekStartDate.getTime() - second.targetWeekStartDate.getTime()
      || first.scheduledAt.getTime() - second.scheduledAt.getTime()
      || first.id.localeCompare(second.id)
    ))
    .slice(0, requestedTake ?? undefined);

  return records.map(record => {
    const historical = record.status === WipWeekAllocationStatus.SUPERSEDED;
    const visibleSteps = historical
      ? record.steps.filter(step => (
          step.completedQty > 0
          || step.completedStandardMilliseconds > 0n
        ))
      : record.steps;
    const historicalQuantity = historical
      ? visibleSteps.reduce((maximum, step) => Math.max(maximum, step.completedQty), record.completedQty)
      : record.quantity;
    // A superseded allocation owns no unfinished work after rescheduling. Its
    // old target week exposes only immutable progress already reported there;
    // the replacement allocation is the sole owner of every remaining unit.
    const planned = historical
      ? record.completedStandardMilliseconds
      : record.plannedStandardMilliseconds;
    const completed = record.completedStandardMilliseconds;
    const remaining = historical ? 0n : planned > completed ? planned - completed : 0n;
    const sourceWeekStartDate = chinaDate(record.lot.sourceWeekStartDate);
    const targetWeekStartDate = chinaDate(record.targetWeekStartDate);
    return {
      stableId: `wip:${record.id}`,
      allocationId: record.id,
      sourceAllocationId: record.sourceAllocationId,
      lotId: record.lot.id,
      lotNo: record.lot.lotNo,
      lotQuantity: record.lot.quantity,
      productionPlanBatchId: record.lot.productionPlanBatchId,
      workOrderId: record.lot.workOrderId,
      workOrderCode: record.lot.workOrder.businessCode || record.lot.workOrder.code,
      batchNo: record.lot.productionPlanBatch.batchNo,
      customerName: record.lot.productionPlanBatch.planOrder.customerName,
      productName: record.lot.productionPlanBatch.planOrder.productName,
      specification: record.lot.productionPlanBatch.planOrder.specification,
      sourceWeekStartDate,
      sourceWeekEndDate: chinaDate(record.lot.sourceWeekEndDate),
      targetWeekStartDate,
      targetWeekEndDate: chinaDate(record.targetWeekEndDate),
      crossWeek: sourceWeekStartDate !== targetWeekStartDate,
      quantity: historical ? historicalQuantity : record.quantity,
      completedQty: historical ? historicalQuantity : record.completedQty,
      remainingQty: historical ? 0 : Math.max(0, record.quantity - record.completedQty),
      plannedStandardMilliseconds: safeBigintNumber(planned),
      completedStandardMilliseconds: safeBigintNumber(completed),
      remainingStandardMilliseconds: safeBigintNumber(remaining),
      plannedHours: Math.round((safeBigintNumber(planned) / 3_600_000) * 100) / 100,
      completedHours: Math.round((safeBigintNumber(completed) / 3_600_000) * 100) / 100,
      remainingHours: Math.round((safeBigintNumber(remaining) / 3_600_000) * 100) / 100,
      status: record.status,
      reason: record.reason,
      materialWarning: record.lot.materialStatusSnapshot,
      team: record.team,
      workers: historical ? [] : record.workers.map(worker => ({
        assignmentId: worker.id,
        employeeId: worker.employeeId,
        employeeNo: worker.employee.employeeNo,
        name: worker.employee.name,
        team: worker.employee.team,
        position: worker.employee.position,
      })),
      scheduledBy: record.scheduledBy,
      scheduledAt: record.scheduledAt.toISOString(),
      steps: visibleSteps.map(step => {
        const stepPlanned = historical
          ? step.completedStandardMilliseconds
          : step.plannedStandardMilliseconds;
        const stepRemaining = historical
          ? 0n
          : stepPlanned > step.completedStandardMilliseconds
          ? step.plannedStandardMilliseconds - step.completedStandardMilliseconds
          : 0n;
        return {
          allocationStepId: step.id,
          lotStepId: step.lotStepId,
          stepId: step.lotStep.stepId,
          processName: step.lotStep.processName,
          position: step.lotStep.position,
          plannedQty: historical ? step.completedQty : step.plannedQty,
          completedQty: step.completedQty,
          remainingQty: historical ? 0 : Math.max(0, step.plannedQty - step.completedQty),
          plannedStandardMilliseconds: safeBigintNumber(stepPlanned),
          completedStandardMilliseconds: safeBigintNumber(step.completedStandardMilliseconds),
          remainingStandardMilliseconds: safeBigintNumber(stepRemaining),
          status: historical ? 'COMPLETED' : step.status,
        };
      }),
    } satisfies WipContinuationProjection;
  });
}
