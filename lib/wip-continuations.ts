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
  scheduledBy: { id: string; displayName: string };
  scheduledAt: string;
  steps: WipContinuationStep[];
};

export async function loadWipContinuations(input: {
  targetWeekStartDate?: Date | null;
  sourceWeekStartDate?: Date | null;
  workOrderId?: string | null;
  keyword?: string | null;
  productionScope?: ProductionEntityScope;
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
  const records = await prisma.wipWeekAllocation.findMany({
    where: {
      status: { in: VISIBLE_WIP_ALLOCATION_STATUSES },
      ...(targetWeekStartDate ? { targetWeekStartDate } : {}),
      ...(input.workOrderId ? { lot: { workOrderId: input.workOrderId } } : {}),
      ...(teamWhere ? { team: { is: teamWhere as Prisma.ProductionTeamWhereInput } } : {}),
      lot: {
        scheduleStatus: { not: 'CANCELLED' },
        ...(sourceWeekStartDate ? { sourceWeekStartDate } : {}),
        workOrder: { deletedAt: null },
        productionPlanBatch: { deletedAt: null, planOrder: { deletedAt: null } },
        ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
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
      lot: {
        select: {
          id: true,
          lotNo: true,
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
    take: Math.min(Math.max(input.take || 5000, 1), 5000),
  });

  return records.map(record => {
    const planned = record.plannedStandardMilliseconds;
    const completed = record.completedStandardMilliseconds;
    const remaining = planned > completed ? planned - completed : 0n;
    const sourceWeekStartDate = chinaDate(record.lot.sourceWeekStartDate);
    const targetWeekStartDate = chinaDate(record.targetWeekStartDate);
    return {
      stableId: `wip:${record.id}`,
      allocationId: record.id,
      sourceAllocationId: record.sourceAllocationId,
      lotId: record.lot.id,
      lotNo: record.lot.lotNo,
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
      quantity: record.quantity,
      completedQty: record.completedQty,
      remainingQty: Math.max(0, record.quantity - record.completedQty),
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
      scheduledBy: record.scheduledBy,
      scheduledAt: record.scheduledAt.toISOString(),
      steps: record.steps.map(step => {
        const stepRemaining = step.plannedStandardMilliseconds > step.completedStandardMilliseconds
          ? step.plannedStandardMilliseconds - step.completedStandardMilliseconds
          : 0n;
        return {
          allocationStepId: step.id,
          lotStepId: step.lotStepId,
          stepId: step.lotStep.stepId,
          processName: step.lotStep.processName,
          position: step.lotStep.position,
          plannedQty: step.plannedQty,
          completedQty: step.completedQty,
          remainingQty: Math.max(0, step.plannedQty - step.completedQty),
          plannedStandardMilliseconds: safeBigintNumber(step.plannedStandardMilliseconds),
          completedStandardMilliseconds: safeBigintNumber(step.completedStandardMilliseconds),
          remainingStandardMilliseconds: safeBigintNumber(stepRemaining),
          status: step.status,
        };
      }),
    } satisfies WipContinuationProjection;
  });
}
