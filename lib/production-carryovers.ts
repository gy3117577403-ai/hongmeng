import type { Prisma } from '@prisma/client';
import { chinaDateKey } from '@/lib/china-date';
import { prisma } from '@/lib/prisma';
import { normalizeWorkOrderStage } from '@/lib/work-orders';
import { chinaWeekRange } from '@/lib/production-planning';
import { addDays, parseWeek } from '@/lib/weekly-work-orders';

export const PRODUCTION_CARRYOVER_ACTIVE = 'ACTIVE';
export const PRODUCTION_CARRYOVER_COMPLETED = 'COMPLETED';
export const PRODUCTION_CARRYOVER_AUTO = 'AUTO_PREVIOUS_WEEK';
export const PRODUCTION_CARRYOVER_MANUAL = 'MANUAL_OLDER_WEEK';

// Activating a new week archives every previous production-plan batch, even
// when its linked work order is unfinished. Archived batches therefore remain
// valid carryover sources; the ACTIVE carryover link controls current scope.
const CARRYOVER_BATCH_STATES = ['active', 'preparation', 'archived'];

export class ProductionCarryoverError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

function normalizedWeek(value: Date | string) {
  const parsed = value instanceof Date ? parseWeek(chinaDateKey(value)) : parseWeek(value);
  if (!parsed) throw new ProductionCarryoverError('生产周日期格式不正确', 'CARRYOVER_WEEK_INVALID');
  return parsed;
}

export function productionCarryoverDayWindow(value: Date | string) {
  const weekStart = normalizedWeek(value);
  return { gte: weekStart, lt: addDays(weekStart, 1) };
}

export function isCurrentProductionCarryoverTarget(value: Date | string, now = new Date()) {
  return chinaDateKey(normalizedWeek(value)) === chinaDateKey(chinaWeekRange(now).start);
}

export function activeProductionCarryoverBatchWhere(targetWeekStart: Date | string): Prisma.ProductionPlanBatchWhereInput {
  return {
    deletedAt: null,
    releaseState: { in: CARRYOVER_BATCH_STATES },
    planOrder: { deletedAt: null },
    carryovers: {
      some: {
        targetWeekStartDate: productionCarryoverDayWindow(targetWeekStart),
        status: PRODUCTION_CARRYOVER_ACTIVE,
      },
    },
  };
}

export function activeProductionCarryoverWorkOrderWhere(targetWeekStart: Date | string): Prisma.WorkOrderWhereInput {
  const batchWhere = activeProductionCarryoverBatchWhere(targetWeekStart);
  return {
    OR: [
      { productionPlanBatch: { is: batchWhere } },
      { parentWorkOrder: { is: { productionPlanBatch: { is: batchWhere } } } },
      { rootWorkOrder: { is: { productionPlanBatch: { is: batchWhere } } } },
    ],
  };
}

function incompleteWorkOrder(order: { stage: string; status: string; completedAt: Date | null; deletedAt: Date | null } | null) {
  if (!order || order.deletedAt || order.completedAt) return false;
  return normalizeWorkOrderStage(order.stage || order.status) !== 'completed';
}

type CarryoverTransaction = Prisma.TransactionClient;

type CandidateBatch = {
  id: string;
  workOrderId: string | null;
  weekStartDate: Date;
  workOrder: {
    id: string;
    stage: string;
    status: string;
    completedAt: Date | null;
    deletedAt: Date | null;
  } | null;
};

/**
 * Materialize the current week's default carryover set.
 *
 * The source is deliberately limited to the immediately previous week's
 * working set: native previous-week batches plus records explicitly carried
 * into that previous week. Older records never enter automatically unless a
 * planner first adopted them in the previous week.
 */
export async function reconcileProductionCarryovers(
  tx: CarryoverTransaction,
  input: { targetWeekStart: Date | string; actorId?: string | null },
) {
  const targetWeekStart = normalizedWeek(input.targetWeekStart);
  const previousWeekStart = addDays(targetWeekStart, -7);
  const targetWindow = productionCarryoverDayWindow(targetWeekStart);
  const previousWindow = productionCarryoverDayWindow(previousWeekStart);

  const [nativePreviousBatches, previousCarryovers, currentCarryovers] = await Promise.all([
    tx.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        releaseState: { in: CARRYOVER_BATCH_STATES },
        weekStartDate: previousWindow,
        workOrderId: { not: null },
        planOrder: { deletedAt: null },
        workOrder: { is: { deletedAt: null } },
      },
      select: {
        id: true,
        workOrderId: true,
        weekStartDate: true,
        workOrder: { select: { id: true, stage: true, status: true, completedAt: true, deletedAt: true } },
      },
    }),
    tx.productionCarryover.findMany({
      where: {
        targetWeekStartDate: previousWindow,
        status: PRODUCTION_CARRYOVER_ACTIVE,
        productionPlanBatch: {
          deletedAt: null,
          releaseState: { in: CARRYOVER_BATCH_STATES },
          planOrder: { deletedAt: null },
        },
        workOrder: { deletedAt: null },
      },
      select: {
        productionPlanBatch: {
          select: {
            id: true,
            workOrderId: true,
            weekStartDate: true,
            workOrder: { select: { id: true, stage: true, status: true, completedAt: true, deletedAt: true } },
          },
        },
      },
    }),
    tx.productionCarryover.findMany({
      where: { targetWeekStartDate: targetWindow },
      select: {
        id: true,
        productionPlanBatchId: true,
        status: true,
        workOrder: { select: { stage: true, status: true, completedAt: true, deletedAt: true } },
        productionPlanBatch: { select: { deletedAt: true, planOrder: { select: { deletedAt: true } } } },
      },
    }),
  ]);

  const candidates = new Map<string, CandidateBatch>();
  for (const batch of nativePreviousBatches) candidates.set(batch.id, batch);
  for (const item of previousCarryovers) candidates.set(item.productionPlanBatch.id, item.productionPlanBatch);

  const existingByBatch = new Map(currentCarryovers.map(item => [item.productionPlanBatchId, item]));
  const completedIds: string[] = [];
  for (const item of currentCarryovers) {
    const invalid = !incompleteWorkOrder(item.workOrder)
      || Boolean(item.productionPlanBatch.deletedAt || item.productionPlanBatch.planOrder.deletedAt);
    if (item.status === PRODUCTION_CARRYOVER_ACTIVE && invalid) {
      completedIds.push(item.id);
    }
  }
  const completedCount = completedIds.length
    ? (await tx.productionCarryover.updateMany({
        where: { id: { in: completedIds }, status: PRODUCTION_CARRYOVER_ACTIVE },
        data: { status: PRODUCTION_CARRYOVER_COMPLETED, completedAt: new Date() },
      })).count
    : 0;

  const creates: Prisma.ProductionCarryoverCreateManyInput[] = [];
  let reactivatedCount = 0;
  for (const batch of candidates.values()) {
    if (!batch.workOrderId || !incompleteWorkOrder(batch.workOrder)) continue;
    const existing = existingByBatch.get(batch.id);
    if (existing?.status === 'DISMISSED') continue;
    if (existing?.status === PRODUCTION_CARRYOVER_ACTIVE) continue;
    if (existing) {
      await tx.productionCarryover.update({
        where: { id: existing.id },
        data: {
          sourceWeekStartDate: previousWeekStart,
          inclusionType: PRODUCTION_CARRYOVER_AUTO,
          status: PRODUCTION_CARRYOVER_ACTIVE,
          completedAt: null,
          dismissedAt: null,
        },
      });
      reactivatedCount += 1;
      continue;
    }
    creates.push({
      productionPlanBatchId: batch.id,
      workOrderId: batch.workOrderId,
      sourceWeekStartDate: previousWeekStart,
      targetWeekStartDate: targetWeekStart,
      inclusionType: PRODUCTION_CARRYOVER_AUTO,
      includedById: input.actorId || null,
      reason: '上周实际处理范围内未完成，系统自动承接',
    });
  }
  const createdCount = creates.length
    ? (await tx.productionCarryover.createMany({ data: creates, skipDuplicates: true })).count
    : 0;

  return { targetWeekStart, previousWeekStart, candidateCount: candidates.size, createdCount, reactivatedCount, completedCount };
}

export async function reconcileCurrentProductionCarryovers(input: { targetWeekStart: Date | string; actorId?: string | null }) {
  return prisma.$transaction(tx => reconcileProductionCarryovers(tx, input));
}

export type ProductionCarryoverMetadata = {
  id: string;
  sourceWeekStartDate: string;
  targetWeekStartDate: string;
  originalWeekStartDate: string;
  inclusionType: string;
  weeksOld: number;
};

function dateKey(value: Date) {
  return chinaDateKey(value);
}

export async function loadProductionCarryoverMetadata(targetWeekStart: Date | string, workOrderIds: string[]) {
  if (!workOrderIds.length) return new Map<string, ProductionCarryoverMetadata>();
  const target = normalizedWeek(targetWeekStart);
  const workOrders = await prisma.workOrder.findMany({
    where: { id: { in: workOrderIds } },
    select: { id: true, parentWorkOrderId: true, rootWorkOrderId: true },
  });
  const rootIdByOrder = new Map(workOrders.map(order => [order.id, order.rootWorkOrderId || order.parentWorkOrderId || order.id]));
  const rootIds = [...new Set(rootIdByOrder.values())];
  const links = await prisma.productionCarryover.findMany({
    where: {
      workOrderId: { in: rootIds },
      targetWeekStartDate: productionCarryoverDayWindow(target),
      status: PRODUCTION_CARRYOVER_ACTIVE,
    },
    select: {
      id: true,
      workOrderId: true,
      sourceWeekStartDate: true,
      targetWeekStartDate: true,
      inclusionType: true,
      productionPlanBatch: { select: { weekStartDate: true } },
    },
  });
  const linkByRoot = new Map(links.map(link => [link.workOrderId, link]));
  const result = new Map<string, ProductionCarryoverMetadata>();
  for (const [workOrderId, rootId] of rootIdByOrder) {
    const link = linkByRoot.get(rootId);
    if (!link) continue;
    const elapsed = Math.max(0, target.getTime() - normalizedWeek(link.productionPlanBatch.weekStartDate).getTime());
    result.set(workOrderId, {
      id: link.id,
      sourceWeekStartDate: dateKey(link.sourceWeekStartDate),
      targetWeekStartDate: dateKey(link.targetWeekStartDate),
      originalWeekStartDate: dateKey(link.productionPlanBatch.weekStartDate),
      inclusionType: link.inclusionType,
      weeksOld: Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000)),
    });
  }
  return result;
}

const olderCandidateSelect = {
  id: true,
  quantity: true,
  weekStartDate: true,
  weekEndDate: true,
  plannedCompletionDate: true,
  workOrder: {
    select: {
      id: true,
      code: true,
      businessCode: true,
      customerName: true,
      productName: true,
      specification: true,
      stage: true,
      status: true,
      completedAt: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ProductionPlanBatchSelect;

export async function listOlderProductionCarryoverCandidates(input: {
  targetWeekStart: Date | string;
  keyword?: string;
  limit?: number;
}) {
  const targetWeekStart = normalizedWeek(input.targetWeekStart);
  const previousWeekStart = addDays(targetWeekStart, -7);
  const keyword = String(input.keyword || '').trim().slice(0, 100);
  const batches = await prisma.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      releaseState: { in: CARRYOVER_BATCH_STATES },
      weekStartDate: { lt: previousWeekStart },
      workOrderId: { not: null },
      planOrder: { deletedAt: null },
      workOrder: {
        is: {
          deletedAt: null,
          ...(keyword ? {
            OR: [
              { code: { contains: keyword, mode: 'insensitive' } },
              { businessCode: { contains: keyword, mode: 'insensitive' } },
              { customerName: { contains: keyword, mode: 'insensitive' } },
              { productName: { contains: keyword, mode: 'insensitive' } },
              { specification: { contains: keyword, mode: 'insensitive' } },
            ],
          } : {}),
        },
      },
      NOT: activeProductionCarryoverBatchWhere(targetWeekStart),
    },
    select: olderCandidateSelect,
    orderBy: [{ weekStartDate: 'desc' }, { plannedCompletionDate: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(input.limit || 500, 1), 2000),
  });
  const eligible = batches.filter(batch => incompleteWorkOrder(batch.workOrder));
  return {
    targetWeekStartDate: dateKey(targetWeekStart),
    previousWeekStartDate: dateKey(previousWeekStart),
    total: eligible.length,
    items: eligible.map(batch => ({
      batchId: batch.id,
      workOrderId: batch.workOrder!.id,
      code: batch.workOrder!.code,
      businessCode: batch.workOrder!.businessCode,
      customerName: batch.workOrder!.customerName,
      productName: batch.workOrder!.productName,
      specification: batch.workOrder!.specification,
      quantity: batch.quantity,
      originalWeekStartDate: dateKey(batch.weekStartDate),
      originalWeekEndDate: dateKey(batch.weekEndDate),
      plannedCompletionDate: dateKey(batch.plannedCompletionDate),
      weeksOld: Math.max(2, Math.floor((targetWeekStart.getTime() - normalizedWeek(batch.weekStartDate).getTime()) / (7 * 24 * 60 * 60 * 1000))),
    })),
  };
}

export async function includeOlderProductionCarryovers(input: {
  targetWeekStart: Date | string;
  batchIds: string[];
  actorId: string;
  reason?: string;
}) {
  const targetWeekStart = normalizedWeek(input.targetWeekStart);
  const previousWeekStart = addDays(targetWeekStart, -7);
  const batchIds = [...new Set((input.batchIds || []).map(value => String(value).trim()).filter(Boolean))];
  if (!batchIds.length) throw new ProductionCarryoverError('请至少选择一个更早遗留订单', 'CARRYOVER_BATCH_REQUIRED');
  if (batchIds.length > 100) throw new ProductionCarryoverError('单次最多加入 100 个遗留订单', 'CARRYOVER_BATCH_LIMIT');
  const reason = String(input.reason || '').trim().slice(0, 300) || '计划员手动加入更早遗留';

  return prisma.$transaction(async tx => {
    const batches = await tx.productionPlanBatch.findMany({
      where: {
        id: { in: batchIds },
        deletedAt: null,
        releaseState: { in: CARRYOVER_BATCH_STATES },
        weekStartDate: { lt: previousWeekStart },
        workOrderId: { not: null },
        planOrder: { deletedAt: null },
        workOrder: { is: { deletedAt: null } },
      },
      select: olderCandidateSelect,
    });
    const eligible = batches.filter(batch => incompleteWorkOrder(batch.workOrder));
    if (eligible.length !== batchIds.length) {
      throw new ProductionCarryoverError('部分订单已完成、失效或不属于更早遗留，请刷新后重试', 'CARRYOVER_BATCH_INELIGIBLE', 409);
    }
    for (const batch of eligible) {
      await tx.productionCarryover.upsert({
        where: {
          productionPlanBatchId_targetWeekStartDate: {
            productionPlanBatchId: batch.id,
            targetWeekStartDate: targetWeekStart,
          },
        },
        create: {
          productionPlanBatchId: batch.id,
          workOrderId: batch.workOrder!.id,
          sourceWeekStartDate: batch.weekStartDate,
          targetWeekStartDate: targetWeekStart,
          inclusionType: PRODUCTION_CARRYOVER_MANUAL,
          reason,
          includedById: input.actorId,
        },
        update: {
          sourceWeekStartDate: batch.weekStartDate,
          inclusionType: PRODUCTION_CARRYOVER_MANUAL,
          status: PRODUCTION_CARRYOVER_ACTIVE,
          reason,
          includedById: input.actorId,
          completedAt: null,
          dismissedAt: null,
        },
      });
    }
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'include_older_production_carryovers',
        targetType: 'production_week',
        targetId: dateKey(targetWeekStart),
        detail: { batchIds, count: eligible.length, reason, preservation: 'reuse_original_work_order_and_files' },
      },
    });
    return { targetWeekStartDate: dateKey(targetWeekStart), includedCount: eligible.length };
  });
}

export async function loadProductionCarryoverCounts(targetWeekStart: Date | string) {
  const target = normalizedWeek(targetWeekStart);
  const previous = addDays(target, -7);
  const [active, older] = await Promise.all([
    prisma.productionCarryover.count({
      where: { targetWeekStartDate: productionCarryoverDayWindow(target), status: PRODUCTION_CARRYOVER_ACTIVE },
    }),
    prisma.productionPlanBatch.count({
      where: {
        deletedAt: null,
        releaseState: { in: CARRYOVER_BATCH_STATES },
        weekStartDate: { lt: previous },
        workOrderId: { not: null },
        planOrder: { deletedAt: null },
        workOrder: {
          is: {
            deletedAt: null,
            completedAt: null,
            NOT: { OR: [{ stage: 'completed' }, { status: 'completed' }] },
          },
        },
        NOT: activeProductionCarryoverBatchWhere(target),
      },
    }),
  ]);
  return { active, older };
}
