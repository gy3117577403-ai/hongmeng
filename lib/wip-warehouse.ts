import { randomUUID } from 'node:crypto';
import {
  Prisma,
  SemiFinishedPhysicalStatus,
  SemiFinishedScheduleStatus,
  WipRequirementStatus,
  WipWeekAllocationStatus,
  type PrismaClient,
} from '@prisma/client';
import { calculateTaskStandardMilliseconds } from '@/lib/daily-plan-domain';
import { prisma } from '@/lib/prisma';
import {
  chinaDate,
  chinaWeekRange,
  editableProductionPlanningWeek,
  parsePlanDate,
} from '@/lib/production-planning';
import type { ProductionEntityScope } from '@/lib/production-access-scope';
import {
  assertProductionScopeRead,
  assertProductionScopeWrite,
  assertProductionTeam,
} from '@/lib/production-access-scope';
import { lockProductionWorkOrder } from '@/lib/production-work-order-lock';

const OPEN_LOT_STATUSES: SemiFinishedScheduleStatus[] = [
  SemiFinishedScheduleStatus.UNSCHEDULED,
  SemiFinishedScheduleStatus.PARTIALLY_SCHEDULED,
  SemiFinishedScheduleStatus.SCHEDULED,
  SemiFinishedScheduleStatus.IN_PROGRESS,
];

const EFFECTIVE_ALLOCATION_STATUSES: WipWeekAllocationStatus[] = [
  WipWeekAllocationStatus.ACTIVE,
  WipWeekAllocationStatus.IN_PROGRESS,
  WipWeekAllocationStatus.COMPLETED,
];

type WipDb = Prisma.TransactionClient | PrismaClient;

export class WipWarehouseError extends Error {
  constructor(
    message: string,
    public readonly code = 'WIP_INVALID',
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'WipWarehouseError';
  }
}

function cleanText(value: unknown, max = 300): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new WipWarehouseError(`${label}必须是正整数`, 'WIP_QUANTITY_INVALID');
  }
  return number;
}

function requiredReason(value: unknown): string {
  const reason = cleanText(value, 300);
  if (reason.length < 2) {
    throw new WipWarehouseError('请填写至少 2 个字的转仓或排程原因', 'WIP_REASON_REQUIRED');
  }
  return reason;
}

function idempotencyKey(value: unknown, prefix: string): string {
  const key = cleanText(value, 120);
  return key || `${prefix}:${randomUUID()}`;
}

function bigintNumber(value: bigint): number {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maximum ? maximum : value);
}

function hours(value: bigint): number {
  return Math.round((bigintNumber(value) / 3_600_000) * 100) / 100;
}

function validTargetWeek(value: unknown, now = new Date()): { start: Date; end: Date; startKey: string; endKey: string } {
  const week = editableProductionPlanningWeek(value, now);
  if (!week) {
    throw new WipWarehouseError(
      '半成品只能排入本周或未来 11 周，不能倒排到已经结束的历史周',
      'WIP_TARGET_WEEK_INVALID',
    );
  }
  return { ...week, startKey: chinaDate(week.start), endKey: chinaDate(week.end) };
}

function timeSnapshot(step: {
  timeBasis: string | null;
  standardMillisecondsPerUnit: number | null;
  setupMilliseconds: number;
  unitsPerProduct: number;
}) {
  if (
    (step.timeBasis !== 'per_unit' && step.timeBasis !== 'per_batch')
    || !step.standardMillisecondsPerUnit
    || step.standardMillisecondsPerUnit <= 0
  ) return null;
  return {
    timeBasis: step.timeBasis,
    standardMillisecondsPerUnit: step.standardMillisecondsPerUnit,
    setupMilliseconds: Math.max(0, step.setupMilliseconds),
    unitsPerProduct: Math.max(1, step.unitsPerProduct),
  } as const;
}

function incrementalLabor(
  snapshot: NonNullable<ReturnType<typeof timeSnapshot>>,
  beforeQuantity: number,
  quantity: number,
): bigint {
  if (quantity <= 0) return 0n;
  const before = calculateTaskStandardMilliseconds(snapshot, Math.max(0, beforeQuantity));
  const after = calculateTaskStandardMilliseconds(snapshot, Math.max(0, beforeQuantity) + quantity);
  return after > before ? after - before : 0n;
}

const batchEntrySelect = Prisma.validator<Prisma.ProductionPlanBatchSelect>()({
  id: true,
  planOrderId: true,
  batchNo: true,
  quantity: true,
  releaseState: true,
  weekStartDate: true,
  weekEndDate: true,
  plannedCompletionDate: true,
  deletedAt: true,
  planOrder: {
    select: {
      sourceOrderNo: true,
      customerName: true,
      productName: true,
      specification: true,
    },
  },
  workOrder: {
    select: {
      id: true,
      code: true,
      businessCode: true,
      stage: true,
      completedAt: true,
      productionPausedAt: true,
      materialTask: {
        select: { status: true, exceptionType: true, exceptionNote: true },
      },
      processRoute: {
        select: {
          id: true,
          status: true,
          version: true,
          steps: {
            where: { retiredAt: null, status: { not: 'skipped' } },
            orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }],
            select: {
              id: true,
              processCode: true,
              processName: true,
              stageGroup: true,
              position: true,
              sequenceGroup: true,
              timeBasis: true,
              standardMillisecondsPerUnit: true,
              setupMilliseconds: true,
              unitsPerProduct: true,
              countsForEfficiency: true,
              processedQty: true,
              goodOutputQty: true,
              status: true,
            },
          },
        },
      },
    },
  },
  semiFinishedLots: {
    where: { scheduleStatus: { in: OPEN_LOT_STATUSES } },
    select: { id: true, quantity: true },
  },
});

type BatchEntryRecord = Prisma.ProductionPlanBatchGetPayload<{ select: typeof batchEntrySelect }>;

export type WipEntryPreview = {
  batchId: string;
  workOrderId: string;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  quantity: number;
  availableQuantity: number;
  kind: 'WAITING_PRODUCTION' | 'SEMI_FINISHED';
  completedSteps: Array<{ id: string; processName: string; position: number }>;
  remainingSteps: Array<{
    id: string;
    processName: string;
    position: number;
    remainingQty: number;
    remainingStandardMilliseconds: number;
    remainingHours: number;
  }>;
  remainingStandardMilliseconds: number;
  remainingHours: number;
  materialWarning: string | null;
};

async function entryPreviewWithDb(
  db: WipDb,
  batchIdInput: unknown,
  quantityInput: unknown,
): Promise<{ batch: BatchEntryRecord; preview: WipEntryPreview; stepData: Array<Record<string, unknown>> }> {
  const batchId = cleanText(batchIdInput, 80);
  if (!batchId) throw new WipWarehouseError('请选择需要转入半成品仓的产品批次', 'WIP_BATCH_REQUIRED');
  const batch = await db.productionPlanBatch.findUnique({ where: { id: batchId }, select: batchEntrySelect });
  if (!batch || batch.deletedAt || !batch.workOrder || !batch.workOrder.processRoute) {
    throw new WipWarehouseError('批次尚未下达或工艺路线不存在，不能转入半成品仓', 'WIP_BATCH_NOT_READY', 404);
  }
  if (batch.workOrder.completedAt || batch.workOrder.processRoute.status === 'completed') {
    throw new WipWarehouseError('该产品已经全部完工，不能重复转入半成品仓', 'WIP_BATCH_COMPLETED', 409);
  }
  if (!['confirmed', 'in_progress'].includes(batch.workOrder.processRoute.status)) {
    throw new WipWarehouseError('工艺路线尚未确认，无法固定剩余工序和工时快照', 'WIP_ROUTE_NOT_CONFIRMED', 409);
  }
  const occupiedQuantity = batch.semiFinishedLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const finalGoodQuantity = batch.workOrder.processRoute.steps.length
    ? batch.workOrder.processRoute.steps[batch.workOrder.processRoute.steps.length - 1].goodOutputQty
    : 0;
  // Open WIP lots and final-good output are disjoint states. Subtract both so
  // an already-finished slice cannot be entered again as a new WIP lot.
  const availableQuantity = Math.max(0, batch.quantity - occupiedQuantity - finalGoodQuantity);
  const quantity = positiveInteger(quantityInput, '转仓数量');
  if (quantity > availableQuantity) {
    throw new WipWarehouseError(
      `转仓数量不能超过当前可转数量 ${availableQuantity}`,
      'WIP_QUANTITY_EXCEEDS_AVAILABLE',
      409,
    );
  }

  const completedSteps: WipEntryPreview['completedSteps'] = [];
  const remainingSteps: WipEntryPreview['remainingSteps'] = [];
  const stepData: Array<Record<string, unknown>> = [];
  let totalRemaining = 0n;
  for (const step of batch.workOrder.processRoute.steps) {
    // Existing open lots consume the first deterministic slice. This prevents
    // the same reported quantity from being used as the checkpoint for two lots.
    const completedWithinLot = Math.min(quantity, Math.max(0, step.goodOutputQty - occupiedQuantity));
    const remainingQty = Math.max(0, quantity - completedWithinLot);
    if (remainingQty === 0) {
      completedSteps.push({ id: step.id, processName: step.processName, position: step.position });
      continue;
    }
    const snapshot = timeSnapshot(step);
    if (!snapshot) {
      throw new WipWarehouseError(
        `工序“${step.processName}”缺少已发布标准工时，不能生成可审计的跨周工时`,
        'WIP_STEP_STANDARD_MISSING',
        409,
      );
    }
    const remainingStandardMilliseconds = incrementalLabor(snapshot, step.processedQty, remainingQty);
    totalRemaining += remainingStandardMilliseconds;
    remainingSteps.push({
      id: step.id,
      processName: step.processName,
      position: step.position,
      remainingQty,
      remainingStandardMilliseconds: bigintNumber(remainingStandardMilliseconds),
      remainingHours: hours(remainingStandardMilliseconds),
    });
    stepData.push({
      stepId: step.id,
      routeVersion: batch.workOrder.processRoute.version,
      processCode: step.processCode,
      processName: step.processName,
      stageGroup: step.stageGroup,
      position: step.position,
      sequenceGroup: step.sequenceGroup,
      timeBasis: snapshot.timeBasis,
      standardMillisecondsPerUnit: snapshot.standardMillisecondsPerUnit,
      setupMilliseconds: snapshot.setupMilliseconds,
      unitsPerProduct: snapshot.unitsPerProduct,
      countsForEfficiency: step.countsForEfficiency,
      plannedQty: quantity,
      processedQtyAtEntry: step.processedQty,
      goodOutputQtyAtEntry: step.goodOutputQty,
      remainingQty,
      remainingStandardMilliseconds,
      status: WipRequirementStatus.UNSCHEDULED,
    });
  }
  if (!remainingSteps.length) {
    throw new WipWarehouseError('所选数量的全部工序均已完成，无需进入半成品仓', 'WIP_NOTHING_REMAINING', 409);
  }
  const material = batch.workOrder.materialTask;
  const materialWarning = !material || material.status === 'completed'
    ? null
    : material.status === 'exception'
      ? `物料异常：${material.exceptionType || material.exceptionNote || '待仓库处理'}`
      : '待配料/配料未完成（仅提示，不影响开工与报工）';
  return {
    batch,
    stepData,
    preview: {
      batchId: batch.id,
      workOrderId: batch.workOrder.id,
      sourceWeekStartDate: chinaDate(batch.weekStartDate),
      sourceWeekEndDate: chinaDate(batch.weekEndDate),
      quantity,
      availableQuantity,
      kind: completedSteps.length ? 'SEMI_FINISHED' : 'WAITING_PRODUCTION',
      completedSteps,
      remainingSteps,
      remainingStandardMilliseconds: bigintNumber(totalRemaining),
      remainingHours: hours(totalRemaining),
      materialWarning,
    },
  };
}

export async function previewWipEntry(input: {
  batchId: unknown;
  quantity: unknown;
  productionScope: ProductionEntityScope;
}): Promise<WipEntryPreview> {
  assertProductionScopeWrite(input.productionScope);
  return (await entryPreviewWithDb(prisma, input.batchId, input.quantity)).preview;
}

function lotNumber(now: Date): string {
  return `WIP-${chinaDate(now).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export async function enterWipWarehouse(input: {
  batchId: unknown;
  quantity: unknown;
  reasonCode?: unknown;
  reason: unknown;
  locationCode?: unknown;
  containerCode?: unknown;
  actorId: string;
  actorName: string;
  idempotencyKey?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeWrite(input.productionScope);
  const reason = requiredReason(input.reason);
  const requestKey = idempotencyKey(input.idempotencyKey, 'wip-enter');
  return prisma.$transaction(async tx => {
    const replay = await tx.wipEvent.findUnique({
      where: { idempotencyKey: requestKey },
      select: { lot: { select: { id: true, lotNo: true } } },
    });
    if (replay) return replay.lot;
    const initial = await entryPreviewWithDb(tx, input.batchId, input.quantity);
    await lockProductionWorkOrder(tx, initial.batch.workOrder!.id);
    const { batch, preview, stepData } = await entryPreviewWithDb(tx, input.batchId, input.quantity);
    const now = new Date();
    const containerCode = cleanText(input.containerCode, 80) || null;
    const locationCode = cleanText(input.locationCode, 80) || null;
    const reasonCode = cleanText(input.reasonCode, 40) || 'PRODUCTION_INTERRUPTED';
    const lot = await tx.semiFinishedLot.create({
      data: {
        lotNo: lotNumber(now),
        kind: preview.kind,
        productionPlanBatchId: batch.id,
        workOrderId: batch.workOrder!.id,
        routeId: batch.workOrder!.processRoute!.id,
        routeVersion: batch.workOrder!.processRoute!.version,
        sourceWeekStartDate: batch.weekStartDate,
        sourceWeekEndDate: batch.weekEndDate,
        quantity: preview.quantity,
        completedStepIds: preview.completedSteps.map(step => step.id),
        lastCompletedPosition: preview.completedSteps.length
          ? Math.max(...preview.completedSteps.map(step => step.position))
          : null,
        nextStepIds: preview.remainingSteps
          .filter(step => step.position === Math.min(...preview.remainingSteps.map(item => item.position)))
          .map(step => step.id),
        locationCode,
        containerCode,
        materialStatusSnapshot: preview.materialWarning,
        physicalStatus: locationCode || containerCode
          ? SemiFinishedPhysicalStatus.STORED
          : SemiFinishedPhysicalStatus.VIRTUAL,
        reasonCode,
        reason,
        enteredById: input.actorId,
        steps: { create: stepData as Prisma.SemiFinishedLotStepCreateWithoutLotInput[] },
      },
      select: { id: true, lotNo: true },
    });
    await tx.wipInventoryMovement.create({
      data: {
        lotId: lot.id,
        movementType: 'ENTER',
        quantity: preview.quantity,
        toLocation: locationCode,
        reason,
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:movement`,
      },
    });
    await tx.wipEvent.create({
      data: {
        lotId: lot.id,
        eventType: 'ENTER_WAREHOUSE',
        reason,
        afterData: {
          sourceWeekStartDate: preview.sourceWeekStartDate,
          quantity: preview.quantity,
          completedStepIds: preview.completedSteps.map(step => step.id),
          remainingSteps: preview.remainingSteps,
          materialWarning: preview.materialWarning,
        },
        actorId: input.actorId,
        idempotencyKey: requestKey,
      },
    });
    await tx.productionPlanChange.create({
      data: {
        planOrderId: batch.planOrderId,
        batchId: batch.id,
        action: 'enter_semi_finished_warehouse',
        beforeData: { sourceWeekStartDate: preview.sourceWeekStartDate, sourceQuantity: batch.quantity },
        afterData: { lotId: lot.id, lotNo: lot.lotNo, quantity: preview.quantity },
        impactData: {
          completedFactsPreserved: true,
          sourceWeekRemainingLaborRemoved: preview.remainingStandardMilliseconds,
          unscheduledLaborExcludedFromWeeklyPlan: true,
          materialStateDoesNotBlock: true,
        },
        reason,
        actorId: input.actorId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'enter_semi_finished_warehouse',
        targetType: 'semi_finished_lot',
        targetId: lot.id,
        detail: { lotNo: lot.lotNo, batchId: batch.id, actorName: input.actorName, preview },
      },
    });
    return lot;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 8_000,
    timeout: 25_000,
  });
}

function effectiveAllocationQuantity(allocation: {
  status: WipWeekAllocationStatus;
  quantity: number;
  completedQty: number;
}): number {
  if (EFFECTIVE_ALLOCATION_STATUSES.includes(allocation.status)) return allocation.quantity;
  if (allocation.status === WipWeekAllocationStatus.SUPERSEDED) return allocation.completedQty;
  return 0;
}

async function recomputeLotScheduleStatus(tx: Prisma.TransactionClient, lotId: string): Promise<void> {
  const lot = await tx.semiFinishedLot.findUnique({
    where: { id: lotId },
    select: {
      quantity: true,
      scheduleStatus: true,
      physicalStatus: true,
      locationCode: true,
      containerCode: true,
      allocations: { select: { status: true, quantity: true, completedQty: true } },
    },
  });
  if (!lot || lot.scheduleStatus === SemiFinishedScheduleStatus.CANCELLED) return;
  const covered = lot.allocations.reduce((sum, allocation) => sum + effectiveAllocationQuantity(allocation), 0);
  const hasProgress = lot.allocations.some(allocation => (
    allocation.status === WipWeekAllocationStatus.IN_PROGRESS
    || allocation.completedQty > 0
  ));
  const completed = covered >= lot.quantity && lot.allocations.some(allocation => (
    allocation.status === WipWeekAllocationStatus.COMPLETED
  )) && lot.allocations
    .filter(allocation => effectiveAllocationQuantity(allocation) > 0)
    .every(allocation => allocation.status === WipWeekAllocationStatus.COMPLETED
      || allocation.status === WipWeekAllocationStatus.SUPERSEDED);
  const scheduleStatus = completed
    ? SemiFinishedScheduleStatus.COMPLETED
    : hasProgress
      ? SemiFinishedScheduleStatus.IN_PROGRESS
      : covered <= 0
        ? SemiFinishedScheduleStatus.UNSCHEDULED
        : covered < lot.quantity
          ? SemiFinishedScheduleStatus.PARTIALLY_SCHEDULED
          : SemiFinishedScheduleStatus.SCHEDULED;
  await tx.semiFinishedLot.update({
    where: { id: lotId },
    data: {
      scheduleStatus,
      physicalStatus: completed
        ? SemiFinishedPhysicalStatus.COMPLETED
        : lot.physicalStatus === SemiFinishedPhysicalStatus.COMPLETED
          ? hasProgress
            ? SemiFinishedPhysicalStatus.ISSUED
            : lot.locationCode || lot.containerCode
              ? SemiFinishedPhysicalStatus.STORED
              : SemiFinishedPhysicalStatus.VIRTUAL
          : lot.physicalStatus,
      closedAt: completed ? new Date() : null,
      version: { increment: 1 },
    },
  });
}

function proportionalMilliseconds(total: bigint, numerator: number, denominator: number): bigint {
  if (total <= 0n || numerator <= 0 || denominator <= 0) return 0n;
  return total * BigInt(numerator) / BigInt(denominator);
}

export async function scheduleWipLot(input: {
  lotId: unknown;
  quantity: unknown;
  targetWeekStartDate: unknown;
  teamId?: unknown;
  reason: unknown;
  actorId: string;
  actorName: string;
  idempotencyKey?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeWrite(input.productionScope);
  const lotId = cleanText(input.lotId, 80);
  const quantity = positiveInteger(input.quantity, '排程数量');
  const targetWeek = validTargetWeek(input.targetWeekStartDate);
  const reason = requiredReason(input.reason);
  const requestKey = idempotencyKey(input.idempotencyKey, 'wip-schedule');
  return prisma.$transaction(async tx => {
    const replay = await tx.wipWeekAllocation.findUnique({ where: { idempotencyKey: requestKey } });
    if (replay) return replay;
    const lot = await tx.semiFinishedLot.findUnique({
      where: { id: lotId },
      include: {
        steps: { orderBy: { position: 'asc' } },
        allocations: {
          include: { steps: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!lot || lot.scheduleStatus === SemiFinishedScheduleStatus.CANCELLED) {
      throw new WipWarehouseError('半成品批次不存在或已取消', 'WIP_LOT_NOT_FOUND', 404);
    }
    await lockProductionWorkOrder(tx, lot.workOrderId);
    const coveredQuantity = lot.allocations.reduce((sum, allocation) => (
      sum + effectiveAllocationQuantity(allocation)
    ), 0);
    const availableQuantity = Math.max(0, lot.quantity - coveredQuantity);
    if (quantity > availableQuantity) {
      throw new WipWarehouseError(`本次最多还能排 ${availableQuantity} 件`, 'WIP_SCHEDULE_EXCEEDS_AVAILABLE', 409);
    }
    const teamId = cleanText(input.teamId, 80) || null;
    if (teamId) {
      const team = await tx.productionTeam.findFirst({
        where: { id: teamId, isActive: true },
        select: { id: true, code: true, name: true, legacyTeamName: true },
      });
      if (!team) throw new WipWarehouseError('所选生产班组不存在或已停用', 'WIP_TEAM_INVALID', 409);
      assertProductionTeam(input.productionScope, team);
    }
    const stepCreates: Prisma.WipWeekAllocationStepCreateWithoutAllocationInput[] = [];
    let totalMilliseconds = 0n;
    for (const step of lot.steps) {
      const skippedQuantity = Math.max(0, lot.quantity - step.remainingQty);
      const coveredBefore = Math.max(0, coveredQuantity - skippedQuantity);
      const coveredAfter = Math.max(0, Math.min(step.remainingQty, coveredQuantity + quantity - skippedQuantity));
      const plannedQty = Math.max(0, coveredAfter - Math.min(step.remainingQty, coveredBefore));
      if (plannedQty <= 0) continue;
      const beforeMs = proportionalMilliseconds(
        step.remainingStandardMilliseconds,
        Math.min(step.remainingQty, coveredBefore),
        step.remainingQty,
      );
      const afterMs = proportionalMilliseconds(
        step.remainingStandardMilliseconds,
        coveredAfter,
        step.remainingQty,
      );
      const plannedStandardMilliseconds = afterMs > beforeMs ? afterMs - beforeMs : 0n;
      totalMilliseconds += plannedStandardMilliseconds;
      stepCreates.push({
        lotStep: { connect: { id: step.id } },
        plannedQty,
        plannedStandardMilliseconds,
        status: WipRequirementStatus.SCHEDULED,
      });
    }
    if (!stepCreates.length) {
      throw new WipWarehouseError('该数量没有可排的剩余工序', 'WIP_NO_STEPS_TO_SCHEDULE', 409);
    }
    const allocation = await tx.wipWeekAllocation.create({
      data: {
        lotId: lot.id,
        targetWeekStartDate: targetWeek.start,
        targetWeekEndDate: targetWeek.end,
        teamId,
        quantity,
        plannedStandardMilliseconds: totalMilliseconds,
        reason,
        scheduledById: input.actorId,
        idempotencyKey: requestKey,
        steps: { create: stepCreates },
      },
      include: { steps: true },
    });
    await tx.wipInventoryMovement.create({
      data: {
        lotId: lot.id,
        movementType: 'SCHEDULE',
        quantity,
        fromLocation: lot.locationCode,
        reason,
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:movement`,
      },
    });
    await tx.wipEvent.create({
      data: {
        lotId: lot.id,
        allocationId: allocation.id,
        eventType: 'SCHEDULE_WEEK',
        reason,
        afterData: {
          targetWeekStartDate: targetWeek.startKey,
          targetWeekEndDate: targetWeek.endKey,
          quantity,
          plannedStandardMilliseconds: bigintNumber(totalMilliseconds),
          teamId,
        },
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:event`,
      },
    });
    await recomputeLotScheduleStatus(tx, lot.id);
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'schedule_semi_finished_lot',
        targetType: 'wip_week_allocation',
        targetId: allocation.id,
        detail: { lotId: lot.id, lotNo: lot.lotNo, actorName: input.actorName, targetWeek, quantity, reason },
      },
    });
    return allocation;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 8_000,
    timeout: 25_000,
  });
}

export async function rescheduleWipAllocation(input: {
  allocationId: unknown;
  targetWeekStartDate: unknown;
  teamId?: unknown;
  reason: unknown;
  actorId: string;
  actorName: string;
  idempotencyKey?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeWrite(input.productionScope);
  const allocationId = cleanText(input.allocationId, 80);
  const targetWeek = validTargetWeek(input.targetWeekStartDate);
  const reason = requiredReason(input.reason);
  const requestKey = idempotencyKey(input.idempotencyKey, 'wip-reschedule');
  return prisma.$transaction(async tx => {
    const replay = await tx.wipWeekAllocation.findUnique({ where: { idempotencyKey: requestKey } });
    if (replay) {
      const requestedTeamId = cleanText(input.teamId, 80) || replay.teamId;
      if (
        replay.sourceAllocationId !== allocationId
        || chinaDate(replay.targetWeekStartDate) !== targetWeek.startKey
        || replay.teamId !== requestedTeamId
        || replay.reason !== reason
      ) {
        throw new WipWarehouseError(
          '该请求编号已用于另一组改排参数，请刷新当前安排后重试',
          'WIP_IDEMPOTENCY_CONFLICT',
          409,
        );
      }
      return replay;
    }
    const sourceBeforeLock = await tx.wipWeekAllocation.findUnique({
      where: { id: allocationId },
      select: { lot: { select: { workOrderId: true } } },
    });
    if (!sourceBeforeLock) {
      throw new WipWarehouseError('原排程不存在或已经完成/改排，不能再次改排', 'WIP_ALLOCATION_NOT_EDITABLE', 409);
    }
    await lockProductionWorkOrder(tx, sourceBeforeLock.lot.workOrderId);
    // The work-order advisory lock serializes every WIP mutation for this
    // product. Re-read after acquiring it so a second click cannot continue
    // from the stale ACTIVE snapshot it observed before waiting.
    const source = await tx.wipWeekAllocation.findUnique({
      where: { id: allocationId },
      include: {
        lot: true,
        team: { select: { id: true, code: true, name: true, legacyTeamName: true } },
        steps: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (
      !source
      || (source.status !== WipWeekAllocationStatus.ACTIVE
        && source.status !== WipWeekAllocationStatus.IN_PROGRESS)
    ) {
      throw new WipWarehouseError('原排程不存在或已经完成/改排，不能再次改排', 'WIP_ALLOCATION_NOT_EDITABLE', 409);
    }
    if (chinaDate(source.targetWeekStartDate) === targetWeek.startKey) {
      throw new WipWarehouseError('目标周与原排程周相同，无需改排', 'WIP_RESCHEDULE_SAME_WEEK', 409);
    }
    const remainingQuantity = Math.max(0, source.quantity - source.completedQty);
    if (remainingQuantity <= 0) {
      throw new WipWarehouseError('原排程已经全部完成，没有可改排数量', 'WIP_RESCHEDULE_NOTHING_REMAINING', 409);
    }
    const teamId = cleanText(input.teamId, 80) || source.teamId;
    if (teamId) {
      const team = await tx.productionTeam.findFirst({
        where: { id: teamId, isActive: true },
        select: { id: true, code: true, name: true, legacyTeamName: true },
      });
      if (!team) throw new WipWarehouseError('所选生产班组不存在或已停用', 'WIP_TEAM_INVALID', 409);
      assertProductionTeam(input.productionScope, team);
    } else if (source.team) {
      assertProductionTeam(input.productionScope, source.team);
    }
    const stepCreates = source.steps
      .map(step => ({
        lotStep: { connect: { id: step.lotStepId } },
        plannedQty: Math.max(0, step.plannedQty - step.completedQty),
        plannedStandardMilliseconds: step.plannedStandardMilliseconds - step.completedStandardMilliseconds,
        status: WipRequirementStatus.SCHEDULED,
      }))
      .filter(step => step.plannedQty > 0);
    const remainingMilliseconds = stepCreates.reduce((sum, step) => sum + step.plannedStandardMilliseconds, 0n);
    const sourceUpdate = await tx.wipWeekAllocation.updateMany({
      where: {
        id: source.id,
        version: source.version,
        status: { in: [WipWeekAllocationStatus.ACTIVE, WipWeekAllocationStatus.IN_PROGRESS] },
      },
      data: { status: WipWeekAllocationStatus.SUPERSEDED, supersededAt: new Date(), version: { increment: 1 } },
    });
    if (sourceUpdate.count !== 1) {
      throw new WipWarehouseError('原排程已被其他操作改排，请刷新后查看最新安排', 'WIP_ALLOCATION_CHANGED', 409);
    }
    const target = await tx.wipWeekAllocation.create({
      data: {
        lotId: source.lotId,
        sourceAllocationId: source.id,
        targetWeekStartDate: targetWeek.start,
        targetWeekEndDate: targetWeek.end,
        teamId,
        quantity: remainingQuantity,
        plannedStandardMilliseconds: remainingMilliseconds,
        reason,
        scheduledById: input.actorId,
        idempotencyKey: requestKey,
        steps: { create: stepCreates },
      },
    });
    await tx.wipInventoryMovement.create({
      data: {
        lotId: source.lotId,
        movementType: 'RESCHEDULE',
        quantity: remainingQuantity,
        fromLocation: source.lot.locationCode,
        reason,
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:movement`,
      },
    });
    await tx.wipEvent.create({
      data: {
        lotId: source.lotId,
        allocationId: target.id,
        eventType: 'RESCHEDULE_WEEK',
        reason,
        beforeData: {
          allocationId: source.id,
          targetWeekStartDate: chinaDate(source.targetWeekStartDate),
          completedQty: source.completedQty,
          completedStandardMilliseconds: bigintNumber(source.completedStandardMilliseconds),
        },
        afterData: {
          allocationId: target.id,
          targetWeekStartDate: targetWeek.startKey,
          quantity: remainingQuantity,
          plannedStandardMilliseconds: bigintNumber(remainingMilliseconds),
        },
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:event`,
      },
    });
    await recomputeLotScheduleStatus(tx, source.lotId);
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'reschedule_semi_finished_lot',
        targetType: 'wip_week_allocation',
        targetId: target.id,
        detail: {
          sourceAllocationId: source.id,
          lotId: source.lotId,
          actorName: input.actorName,
          remainingQuantity,
          targetWeekStartDate: targetWeek.startKey,
          reason,
        },
      },
    });
    return target;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 8_000,
    timeout: 25_000,
  });
}

export type WipUnschedulePreview = {
  action: 'UNSCHEDULE_ALLOCATION';
  allocationId: string;
  allocationVersion: number;
  lotId: string;
  lotNo: string;
  workOrderId: string;
  workOrderCode: string;
  targetWeekStartDate: string;
  targetWeekEndDate: string;
  quantity: number;
  plannedStandardMilliseconds: number;
  plannedHours: number;
  resultScheduleStatus: 'UNSCHEDULED' | 'PARTIALLY_SCHEDULED';
  preservesProductionFacts: true;
};

async function unschedulePreviewWithDb(db: WipDb, allocationIdInput: unknown): Promise<WipUnschedulePreview> {
  const allocationId = cleanText(allocationIdInput, 80);
  if (!allocationId) throw new WipWarehouseError('请选择需要撤销的半成品周安排', 'WIP_ALLOCATION_REQUIRED');
  const allocation = await db.wipWeekAllocation.findUnique({
    where: { id: allocationId },
    include: {
      lot: {
        include: {
          workOrder: { select: { id: true, code: true, businessCode: true } },
          allocations: { select: { id: true, status: true, quantity: true, completedQty: true } },
        },
      },
      steps: {
        include: { credits: { where: { status: 'ACTIVE' }, select: { id: true } } },
      },
    },
  });
  if (!allocation || (allocation.status !== WipWeekAllocationStatus.ACTIVE && allocation.status !== WipWeekAllocationStatus.IN_PROGRESS)) {
    throw new WipWarehouseError('该周安排不存在，或已经完成、改排、取消', 'WIP_ALLOCATION_NOT_EDITABLE', 409);
  }
  const hasProgress = allocation.completedQty > 0
    || allocation.completedStandardMilliseconds > 0n
    || allocation.steps.some(step => (
      step.completedQty > 0
      || step.completedStandardMilliseconds > 0n
      || step.credits.length > 0
    ));
  if (hasProgress) {
    throw new WipWarehouseError(
      '该安排已经产生半成品报工或完成工时，不能直接撤销；可使用“改排剩余未完成部分”保留既有事实',
      'WIP_UNSCHEDULE_HAS_PROGRESS',
      409,
    );
  }
  const coveredAfter = allocation.lot.allocations.reduce((sum, item) => (
    item.id === allocation.id ? sum : sum + effectiveAllocationQuantity(item)
  ), 0);
  return {
    action: 'UNSCHEDULE_ALLOCATION',
    allocationId: allocation.id,
    allocationVersion: allocation.version,
    lotId: allocation.lot.id,
    lotNo: allocation.lot.lotNo,
    workOrderId: allocation.lot.workOrder.id,
    workOrderCode: allocation.lot.workOrder.businessCode || allocation.lot.workOrder.code,
    targetWeekStartDate: chinaDate(allocation.targetWeekStartDate),
    targetWeekEndDate: chinaDate(allocation.targetWeekEndDate),
    quantity: allocation.quantity,
    plannedStandardMilliseconds: bigintNumber(allocation.plannedStandardMilliseconds),
    plannedHours: hours(allocation.plannedStandardMilliseconds),
    resultScheduleStatus: coveredAfter > 0 ? 'PARTIALLY_SCHEDULED' : 'UNSCHEDULED',
    preservesProductionFacts: true,
  };
}

export async function previewWipAllocationUnschedule(input: {
  allocationId: unknown;
  productionScope: ProductionEntityScope;
}): Promise<WipUnschedulePreview> {
  assertProductionScopeWrite(input.productionScope);
  return unschedulePreviewWithDb(prisma, input.allocationId);
}

export async function unscheduleWipAllocation(input: {
  allocationId: unknown;
  expectedVersion: unknown;
  reason: unknown;
  actorId: string;
  actorName: string;
  idempotencyKey?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeWrite(input.productionScope);
  const allocationId = cleanText(input.allocationId, 80);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new WipWarehouseError('周安排版本无效，请刷新后重试', 'WIP_ALLOCATION_VERSION_INVALID', 409);
  }
  const reason = requiredReason(input.reason);
  const requestKey = idempotencyKey(input.idempotencyKey, 'wip-unschedule');
  return prisma.$transaction(async tx => {
    const replay = await tx.wipEvent.findUnique({
      where: { idempotencyKey: requestKey },
      select: { allocation: true },
    });
    if (replay?.allocation) return replay.allocation;
    const beforeLock = await tx.wipWeekAllocation.findUnique({
      where: { id: allocationId },
      select: { lot: { select: { workOrderId: true } } },
    });
    if (!beforeLock) throw new WipWarehouseError('周安排不存在', 'WIP_ALLOCATION_NOT_EDITABLE', 409);
    await lockProductionWorkOrder(tx, beforeLock.lot.workOrderId);
    const preview = await unschedulePreviewWithDb(tx, allocationId);
    if (preview.allocationVersion !== expectedVersion) {
      throw new WipWarehouseError('周安排已被其他操作修改，请刷新后重试', 'WIP_ALLOCATION_CHANGED', 409);
    }
    const allocation = await tx.wipWeekAllocation.findUnique({
      where: { id: allocationId },
      include: {
        lot: {
          include: {
            productionPlanBatch: { select: { id: true, planOrderId: true } },
          },
        },
      },
    });
    if (!allocation) throw new WipWarehouseError('周安排不存在', 'WIP_ALLOCATION_NOT_EDITABLE', 409);
    const changed = await tx.wipWeekAllocation.updateMany({
      where: {
        id: allocation.id,
        version: expectedVersion,
        status: { in: [WipWeekAllocationStatus.ACTIVE, WipWeekAllocationStatus.IN_PROGRESS] },
      },
      data: {
        status: WipWeekAllocationStatus.CANCELLED,
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new WipWarehouseError('周安排已被其他操作修改，请刷新后重试', 'WIP_ALLOCATION_CHANGED', 409);
    }
    await tx.wipWeekAllocationStep.updateMany({
      where: { allocationId: allocation.id },
      data: { status: WipRequirementStatus.CANCELLED },
    });
    await tx.wipInventoryMovement.create({
      data: {
        lotId: allocation.lotId,
        movementType: 'CANCEL',
        quantity: allocation.quantity,
        fromLocation: allocation.lot.locationCode,
        reason,
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:movement`,
      },
    });
    await tx.wipEvent.create({
      data: {
        lotId: allocation.lotId,
        allocationId: allocation.id,
        eventType: 'UNSCHEDULE_WEEK',
        reason,
        beforeData: {
          targetWeekStartDate: preview.targetWeekStartDate,
          targetWeekEndDate: preview.targetWeekEndDate,
          quantity: preview.quantity,
          plannedStandardMilliseconds: preview.plannedStandardMilliseconds,
        },
        afterData: { scheduleStatus: preview.resultScheduleStatus, returnedToWipPool: true },
        actorId: input.actorId,
        idempotencyKey: requestKey,
      },
    });
    await recomputeLotScheduleStatus(tx, allocation.lotId);
    await tx.productionPlanChange.create({
      data: {
        planOrderId: allocation.lot.productionPlanBatch.planOrderId,
        batchId: allocation.lot.productionPlanBatch.id,
        action: 'unschedule_semi_finished_allocation',
        beforeData: {
          allocationId: allocation.id,
          targetWeekStartDate: preview.targetWeekStartDate,
          quantity: preview.quantity,
        },
        afterData: { returnedToWipPool: true, scheduleStatus: preview.resultScheduleStatus },
        impactData: { completedFactsPreserved: true, originalOrderPreserved: true },
        reason,
        actorId: input.actorId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'unschedule_semi_finished_allocation',
        targetType: 'wip_week_allocation',
        targetId: allocation.id,
        detail: { actorName: input.actorName, lotId: allocation.lotId, preview, reason },
      },
    });
    return tx.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 8_000,
    timeout: 25_000,
  });
}

export type WipReturnToOrderPreview = {
  action: 'RETURN_TO_SOURCE_ORDER';
  lotId: string;
  lotVersion: number;
  lotNo: string;
  workOrderId: string;
  workOrderCode: string;
  productionPlanBatchId: string;
  sourceWeekStartDate: string;
  sourceWeekEndDate: string;
  quantity: number;
  activeAllocationCount: number;
  physicalStatus: SemiFinishedPhysicalStatus;
  locationCode: string | null;
  containerCode: string | null;
  requiresPhysicalReturnConfirmation: boolean;
  preservesProductionFacts: true;
  result: 'ORIGINAL_ORDER_RESTORED';
};

async function returnToOrderPreviewWithDb(db: WipDb, lotIdInput: unknown): Promise<WipReturnToOrderPreview> {
  const lotId = cleanText(lotIdInput, 80);
  if (!lotId) throw new WipWarehouseError('请选择需要回归原订单的半成品批次', 'WIP_LOT_REQUIRED');
  const lot = await db.semiFinishedLot.findUnique({
    where: { id: lotId },
    include: {
      productionPlanBatch: { select: { id: true, deletedAt: true, planOrderId: true } },
      workOrder: {
        select: {
          id: true,
          code: true,
          businessCode: true,
          completedAt: true,
          processRoute: { select: { status: true } },
        },
      },
      allocations: {
        include: {
          steps: { include: { credits: { where: { status: 'ACTIVE' }, select: { id: true } } } },
        },
      },
    },
  });
  if (!lot || lot.scheduleStatus === SemiFinishedScheduleStatus.CANCELLED) {
    throw new WipWarehouseError('半成品批次不存在或已经回归原订单', 'WIP_LOT_NOT_FOUND', 404);
  }
  if (lot.productionPlanBatch.deletedAt || lot.workOrder.completedAt || lot.workOrder.processRoute?.status === 'completed') {
    throw new WipWarehouseError('原订单已删除或已经完工，不能回归；请先核对原订单状态', 'WIP_SOURCE_ORDER_NOT_OPEN', 409);
  }
  if (!lot.workOrder.processRoute || !['confirmed', 'in_progress'].includes(lot.workOrder.processRoute.status)) {
    throw new WipWarehouseError('原订单工艺路线当前不可执行，不能回归', 'WIP_SOURCE_ROUTE_NOT_EXECUTABLE', 409);
  }
  const hasProgress = lot.allocations.some(allocation => (
    allocation.completedQty > 0
    || allocation.completedStandardMilliseconds > 0n
    || allocation.status === WipWeekAllocationStatus.COMPLETED
    || allocation.steps.some(step => (
      step.completedQty > 0
      || step.completedStandardMilliseconds > 0n
      || step.credits.length > 0
    ))
  ));
  if (hasProgress) {
    throw new WipWarehouseError(
      '该半成品批次已经产生续作报工、完成数量或员工工时，不能整批回归原订单；请保留批次并改排剩余部分',
      'WIP_RETURN_HAS_PROGRESS',
      409,
    );
  }
  if (lot.physicalStatus === SemiFinishedPhysicalStatus.COMPLETED) {
    throw new WipWarehouseError('该半成品批次已经完成，不能回归原订单', 'WIP_RETURN_COMPLETED', 409);
  }
  const activeAllocationCount = lot.allocations.filter(allocation => (
    allocation.status !== WipWeekAllocationStatus.CANCELLED
  )).length;
  return {
    action: 'RETURN_TO_SOURCE_ORDER',
    lotId: lot.id,
    lotVersion: lot.version,
    lotNo: lot.lotNo,
    workOrderId: lot.workOrder.id,
    workOrderCode: lot.workOrder.businessCode || lot.workOrder.code,
    productionPlanBatchId: lot.productionPlanBatch.id,
    sourceWeekStartDate: chinaDate(lot.sourceWeekStartDate),
    sourceWeekEndDate: chinaDate(lot.sourceWeekEndDate),
    quantity: lot.quantity,
    activeAllocationCount,
    physicalStatus: lot.physicalStatus,
    locationCode: lot.locationCode,
    containerCode: lot.containerCode,
    requiresPhysicalReturnConfirmation: lot.physicalStatus === SemiFinishedPhysicalStatus.STORED
      || lot.physicalStatus === SemiFinishedPhysicalStatus.ISSUED,
    preservesProductionFacts: true,
    result: 'ORIGINAL_ORDER_RESTORED',
  };
}

export async function previewWipReturnToOrder(input: {
  lotId: unknown;
  productionScope: ProductionEntityScope;
}): Promise<WipReturnToOrderPreview> {
  assertProductionScopeWrite(input.productionScope);
  return returnToOrderPreviewWithDb(prisma, input.lotId);
}

export async function returnWipLotToOrder(input: {
  lotId: unknown;
  expectedVersion: unknown;
  physicalReturnConfirmed?: unknown;
  reason: unknown;
  actorId: string;
  actorName: string;
  idempotencyKey?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeWrite(input.productionScope);
  const lotId = cleanText(input.lotId, 80);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new WipWarehouseError('半成品批次版本无效，请刷新后重试', 'WIP_LOT_VERSION_INVALID', 409);
  }
  const reason = requiredReason(input.reason);
  const requestKey = idempotencyKey(input.idempotencyKey, 'wip-return-order');
  return prisma.$transaction(async tx => {
    const replay = await tx.wipEvent.findUnique({
      where: { idempotencyKey: requestKey },
      select: { lot: { select: { id: true, lotNo: true, scheduleStatus: true } } },
    });
    if (replay) return replay.lot;
    const beforeLock = await tx.semiFinishedLot.findUnique({
      where: { id: lotId },
      select: { workOrderId: true },
    });
    if (!beforeLock) throw new WipWarehouseError('半成品批次不存在', 'WIP_LOT_NOT_FOUND', 404);
    await lockProductionWorkOrder(tx, beforeLock.workOrderId);
    const preview = await returnToOrderPreviewWithDb(tx, lotId);
    if (preview.lotVersion !== expectedVersion) {
      throw new WipWarehouseError('半成品批次已被其他操作修改，请刷新后重试', 'WIP_LOT_CHANGED', 409);
    }
    if (preview.requiresPhysicalReturnConfirmation && input.physicalReturnConfirmed !== true) {
      throw new WipWarehouseError('该批次存在实物库位或已发料，请先确认实物已退回原订单流转位置', 'WIP_PHYSICAL_RETURN_REQUIRED', 409);
    }
    const lot = await tx.semiFinishedLot.findUnique({
      where: { id: lotId },
      include: { productionPlanBatch: { select: { id: true, planOrderId: true } } },
    });
    if (!lot) throw new WipWarehouseError('半成品批次不存在', 'WIP_LOT_NOT_FOUND', 404);
    const now = new Date();
    await tx.wipWeekAllocation.updateMany({
      where: { lotId: lot.id, status: { not: WipWeekAllocationStatus.CANCELLED } },
      data: { status: WipWeekAllocationStatus.CANCELLED, cancelledAt: now, version: { increment: 1 } },
    });
    await tx.wipWeekAllocationStep.updateMany({
      where: { allocation: { lotId: lot.id }, status: { not: WipRequirementStatus.CANCELLED } },
      data: { status: WipRequirementStatus.CANCELLED },
    });
    await tx.semiFinishedLotStep.updateMany({
      where: { lotId: lot.id },
      data: { status: WipRequirementStatus.CANCELLED },
    });
    const changed = await tx.semiFinishedLot.updateMany({
      where: { id: lot.id, version: expectedVersion, scheduleStatus: { not: SemiFinishedScheduleStatus.CANCELLED } },
      data: {
        scheduleStatus: SemiFinishedScheduleStatus.CANCELLED,
        physicalStatus: SemiFinishedPhysicalStatus.CANCELLED,
        closedAt: now,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new WipWarehouseError('半成品批次已被其他操作修改，请刷新后重试', 'WIP_LOT_CHANGED', 409);
    }
    await tx.wipInventoryMovement.create({
      data: {
        lotId: lot.id,
        movementType: 'CANCEL',
        quantity: lot.quantity,
        fromLocation: lot.locationCode,
        reason,
        actorId: input.actorId,
        idempotencyKey: `${requestKey}:movement`,
      },
    });
    await tx.wipEvent.create({
      data: {
        lotId: lot.id,
        eventType: 'RETURN_TO_SOURCE_ORDER',
        reason,
        beforeData: {
          scheduleStatus: lot.scheduleStatus,
          physicalStatus: lot.physicalStatus,
          activeAllocationCount: preview.activeAllocationCount,
          quantity: lot.quantity,
        },
        afterData: { scheduleStatus: 'CANCELLED', physicalStatus: 'CANCELLED', originalOrderRestored: true },
        actorId: input.actorId,
        idempotencyKey: requestKey,
      },
    });
    await tx.productionPlanChange.create({
      data: {
        planOrderId: lot.productionPlanBatch.planOrderId,
        batchId: lot.productionPlanBatch.id,
        action: 'return_semi_finished_to_source_order',
        beforeData: { lotId: lot.id, lotNo: lot.lotNo, quantity: lot.quantity },
        afterData: { originalOrderRestored: true, sourceWeekStartDate: preview.sourceWeekStartDate },
        impactData: {
          completedFactsPreserved: true,
          routeFactsPreserved: true,
          reportingFactsPreserved: true,
          laborFactsPreserved: true,
          physicalReturnConfirmed: Boolean(input.physicalReturnConfirmed),
        },
        reason,
        actorId: input.actorId,
      },
    });
    await tx.operationLog.create({
      data: {
        userId: input.actorId,
        action: 'return_semi_finished_to_source_order',
        targetType: 'semi_finished_lot',
        targetId: lot.id,
        detail: { actorName: input.actorName, preview, reason },
      },
    });
    return { id: lot.id, lotNo: lot.lotNo, scheduleStatus: SemiFinishedScheduleStatus.CANCELLED };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 8_000,
    timeout: 25_000,
  });
}

const listLotInclude = Prisma.validator<Prisma.SemiFinishedLotInclude>()({
  enteredBy: { select: { id: true, displayName: true } },
  workOrder: { select: { code: true, businessCode: true, stage: true } },
  productionPlanBatch: {
    select: {
      batchNo: true,
      planOrder: { select: { customerName: true, productName: true, specification: true } },
    },
  },
  steps: { orderBy: { position: 'asc' } },
  allocations: {
    include: {
      team: { select: { id: true, name: true } },
      scheduledBy: { select: { id: true, displayName: true } },
      steps: {
        include: {
          lotStep: { select: { stepId: true, processName: true, position: true } },
        },
        orderBy: { lotStep: { position: 'asc' } },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
});

function serializeAllocation(allocation: Prisma.WipWeekAllocationGetPayload<{
  include: {
    team: { select: { id: true; name: true } };
    scheduledBy: { select: { id: true; displayName: true } };
    steps: { include: { lotStep: { select: { stepId: true; processName: true; position: true } } } };
  };
}>) {
  return {
    id: allocation.id,
    sourceAllocationId: allocation.sourceAllocationId,
    targetWeekStartDate: chinaDate(allocation.targetWeekStartDate),
    targetWeekEndDate: chinaDate(allocation.targetWeekEndDate),
    team: allocation.team,
    quantity: allocation.quantity,
    plannedStandardMilliseconds: bigintNumber(allocation.plannedStandardMilliseconds),
    plannedHours: hours(allocation.plannedStandardMilliseconds),
    completedQty: allocation.completedQty,
    completedStandardMilliseconds: bigintNumber(allocation.completedStandardMilliseconds),
    completedHours: hours(allocation.completedStandardMilliseconds),
    status: allocation.status,
    reason: allocation.reason,
    version: allocation.version,
    scheduledBy: allocation.scheduledBy,
    scheduledAt: allocation.scheduledAt.toISOString(),
    supersededAt: allocation.supersededAt?.toISOString() || null,
    steps: allocation.steps.map(step => ({
      id: step.id,
      lotStepId: step.lotStepId,
      stepId: step.lotStep.stepId,
      processName: step.lotStep.processName,
      position: step.lotStep.position,
      plannedQty: step.plannedQty,
      completedQty: step.completedQty,
      remainingQty: Math.max(0, step.plannedQty - step.completedQty),
      plannedHours: hours(step.plannedStandardMilliseconds),
      completedHours: hours(step.completedStandardMilliseconds),
      remainingHours: hours(step.plannedStandardMilliseconds > step.completedStandardMilliseconds
        ? step.plannedStandardMilliseconds - step.completedStandardMilliseconds
        : 0n),
      status: step.status,
    })),
  };
}

function serializeLot(lot: Prisma.SemiFinishedLotGetPayload<{ include: typeof listLotInclude }>) {
  const coveredQuantity = lot.allocations.reduce((sum, allocation) => sum + effectiveAllocationQuantity(allocation), 0);
  // The lot-step values are immutable entry snapshots. Actual outstanding
  // labor is the snapshot minus every still-effective completion, including
  // work preserved on a superseded source allocation.
  const completedLabor = lot.allocations
    .filter(allocation => allocation.status !== WipWeekAllocationStatus.CANCELLED)
    .reduce((sum, allocation) => sum + allocation.completedStandardMilliseconds, 0n);
  const entryLabor = lot.steps.reduce((sum, step) => sum + step.remainingStandardMilliseconds, 0n);
  const remainingLabor = entryLabor > completedLabor ? entryLabor - completedLabor : 0n;
  return {
    id: lot.id,
    version: lot.version,
    lotNo: lot.lotNo,
    kind: lot.kind,
    productionPlanBatchId: lot.productionPlanBatchId,
    workOrderId: lot.workOrderId,
    workOrderCode: lot.workOrder.businessCode || lot.workOrder.code,
    customerName: lot.productionPlanBatch.planOrder.customerName,
    productName: lot.productionPlanBatch.planOrder.productName,
    specification: lot.productionPlanBatch.planOrder.specification,
    batchNo: lot.productionPlanBatch.batchNo,
    sourceWeekStartDate: chinaDate(lot.sourceWeekStartDate),
    sourceWeekEndDate: chinaDate(lot.sourceWeekEndDate),
    quantity: lot.quantity,
    scheduledQuantity: coveredQuantity,
    unscheduledQuantity: Math.max(0, lot.quantity - coveredQuantity),
    completedStepIds: Array.isArray(lot.completedStepIds) ? lot.completedStepIds : [],
    locationCode: lot.locationCode,
    containerCode: lot.containerCode,
    materialStatusSnapshot: lot.materialStatusSnapshot,
    physicalStatus: lot.physicalStatus,
    scheduleStatus: lot.scheduleStatus,
    reasonCode: lot.reasonCode,
    reason: lot.reason,
    remainingHours: hours(remainingLabor),
    enteredAt: lot.enteredAt.toISOString(),
    enteredBy: lot.enteredBy,
    steps: lot.steps.map(step => {
      const completedQty = lot.allocations.reduce((sum, allocation) => {
        if (allocation.status === WipWeekAllocationStatus.CANCELLED) return sum;
        const allocationStep = allocation.steps.find(item => item.lotStepId === step.id);
        return sum + (allocationStep?.completedQty || 0);
      }, 0);
      const completedMilliseconds = lot.allocations.reduce((sum, allocation) => {
        if (allocation.status === WipWeekAllocationStatus.CANCELLED) return sum;
        const allocationStep = allocation.steps.find(item => item.lotStepId === step.id);
        return sum + (allocationStep?.completedStandardMilliseconds || 0n);
      }, 0n);
      const remainingMilliseconds = step.remainingStandardMilliseconds > completedMilliseconds
        ? step.remainingStandardMilliseconds - completedMilliseconds
        : 0n;
      return {
        id: step.id,
        stepId: step.stepId,
        processName: step.processName,
        position: step.position,
        remainingQty: Math.max(0, step.remainingQty - completedQty),
        remainingHours: hours(remainingMilliseconds),
        status: step.status,
      };
    }),
    allocations: lot.allocations.map(serializeAllocation),
  };
}

export async function listWipWarehouse(input: {
  keyword?: unknown;
  batchId?: unknown;
  productionScope: ProductionEntityScope;
}) {
  assertProductionScopeRead(input.productionScope);
  const keyword = cleanText(input.keyword, 80);
  const selectedBatchId = cleanText(input.batchId, 80);
  const [lots, candidates, teams] = await Promise.all([
    prisma.semiFinishedLot.findMany({
      where: {
        // Returning a lot to its source order is a soft-close: keep the lot,
        // allocations and WIP events for audit, but do not surface that closed
        // branch in the active warehouse workbench.
        scheduleStatus: { not: SemiFinishedScheduleStatus.CANCELLED },
        ...(keyword ? {
          OR: [
            { lotNo: { contains: keyword, mode: 'insensitive' } },
            { containerCode: { contains: keyword, mode: 'insensitive' } },
            { productionPlanBatch: { planOrder: { specification: { contains: keyword, mode: 'insensitive' } } } },
            { productionPlanBatch: { planOrder: { productName: { contains: keyword, mode: 'insensitive' } } } },
            { workOrder: { code: { contains: keyword, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      include: listLotInclude,
      orderBy: [{ scheduleStatus: 'asc' }, { enteredAt: 'desc' }],
      take: 500,
    }),
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        workOrderId: { not: null },
        workOrder: { is: { completedAt: null, processRoute: { isNot: null } } },
        ...(selectedBatchId ? { id: selectedBatchId } : {}),
        ...(keyword && !selectedBatchId ? {
          OR: [
            { planOrder: { specification: { contains: keyword, mode: 'insensitive' } } },
            { planOrder: { productName: { contains: keyword, mode: 'insensitive' } } },
            { planOrder: { customerName: { contains: keyword, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      select: batchEntrySelect,
      orderBy: [{ weekStartDate: 'desc' }, { batchNo: 'asc' }],
      take: selectedBatchId ? 1 : 200,
    }),
    prisma.productionTeam.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const candidateRows = candidates.map(batch => {
    const occupied = batch.semiFinishedLots.reduce((sum, lot) => sum + lot.quantity, 0);
    const finalGood = batch.workOrder?.processRoute?.steps.at(-1)?.goodOutputQty || 0;
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      workOrderId: batch.workOrder!.id,
      workOrderCode: batch.workOrder!.businessCode || batch.workOrder!.code,
      customerName: batch.planOrder.customerName,
      productName: batch.planOrder.productName,
      specification: batch.planOrder.specification,
      quantity: batch.quantity,
      availableQuantity: Math.max(0, batch.quantity - occupied - finalGood),
      weekStartDate: chinaDate(batch.weekStartDate),
      weekEndDate: chinaDate(batch.weekEndDate),
      routeStatus: batch.workOrder!.processRoute!.status,
      completedProcessCount: batch.workOrder!.processRoute!.steps.filter(step => step.goodOutputQty > 0).length,
      processCount: batch.workOrder!.processRoute!.steps.length,
      materialStatus: batch.workOrder!.materialTask?.status || 'not_created',
      materialExceptionType: batch.workOrder!.materialTask?.exceptionType || null,
      productionPaused: Boolean(batch.workOrder!.productionPausedAt),
    };
  }).filter(candidate => candidate.availableQuantity > 0);

  const serializedLots = lots.map(serializeLot);
  const currentWeek = chinaWeekRange(new Date());
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(currentWeek.start);
    start.setUTCDate(start.getUTCDate() + index * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { startDate: chinaDate(start), endDate: chinaDate(end), label: index === 0 ? '本周' : index === 1 ? '下周' : `第 ${index + 1} 周` };
  });
  const weekPlan = new Map<string, { quantity: number; hours: number; lotCount: Set<string> }>();
  for (const lot of serializedLots) {
    for (const allocation of lot.allocations) {
      if (!['ACTIVE', 'IN_PROGRESS', 'COMPLETED'].includes(allocation.status)) continue;
      const current = weekPlan.get(allocation.targetWeekStartDate) || { quantity: 0, hours: 0, lotCount: new Set<string>() };
      current.quantity += allocation.quantity;
      current.hours += allocation.plannedHours;
      current.lotCount.add(lot.id);
      weekPlan.set(allocation.targetWeekStartDate, current);
    }
  }
  const totalQuantity = serializedLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const unscheduledQuantity = serializedLots.reduce((sum, lot) => sum + lot.unscheduledQuantity, 0);
  return {
    permissions: { canWrite: input.productionScope.canWrite },
    summary: {
      lotCount: serializedLots.filter(lot => lot.scheduleStatus !== 'COMPLETED' && lot.scheduleStatus !== 'CANCELLED').length,
      totalQuantity,
      unscheduledQuantity,
      scheduledQuantity: Math.max(0, totalQuantity - unscheduledQuantity),
      totalRemainingHours: Math.round(serializedLots.reduce((sum, lot) => sum + lot.remainingHours, 0) * 100) / 100,
    },
    weeks: weeks.map(week => ({
      ...week,
      plannedQuantity: weekPlan.get(week.startDate)?.quantity || 0,
      plannedHours: Math.round((weekPlan.get(week.startDate)?.hours || 0) * 100) / 100,
      lotCount: weekPlan.get(week.startDate)?.lotCount.size || 0,
    })),
    teams,
    candidates: candidateRows,
    lots: serializedLots,
  };
}

export type WipWeekLaborMetrics = {
  weekStartDate: string;
  weekEndDate: string;
  nativePlannedMilliseconds: number;
  movedOutMilliseconds: number;
  scheduledInMilliseconds: number;
  effectivePlannedMilliseconds: number;
  completedMilliseconds: number;
  percentage: number | null;
  missingStandardStepCount: number;
  unscheduledWipQuantity: number;
};

export type WipWeekAttainmentInput = {
  nativePlanned: bigint;
  movedOut: bigint;
  scheduledIn: bigint;
  nativeCompleted: bigint;
  reclassifiedFromNative: bigint;
  targetWipCompleted: bigint;
};

export type WipWeekAttainment = {
  effectivePlanned: bigint;
  completed: bigint;
  percentage: number | null;
};

export function calculateWipCompletedMilliseconds(input: {
  nativeCompleted: bigint;
  reclassifiedFromNative: bigint;
  targetWipCompleted: bigint;
}): bigint {
  const nativeRemainder = input.nativeCompleted > input.reclassifiedFromNative
    ? input.nativeCompleted - input.reclassifiedFromNative
    : 0n;
  return nativeRemainder + input.targetWipCompleted;
}

/**
 * Keeps weekly attainment tied to real standard-labor facts when unfinished
 * work is moved through the semi-finished warehouse.
 *
 * - the source week keeps completed labor, but removes the frozen remaining
 *   labor snapshot from its denominator;
 * - an unscheduled lot belongs to no target-week denominator;
 * - a scheduled target adds only its allocation snapshot;
 * - WIP credits are reclassified, not counted a second time.
 */
export function calculateWipWeekAttainment(input: WipWeekAttainmentInput): WipWeekAttainment {
  const nativeRemainder = input.nativePlanned > input.movedOut
    ? input.nativePlanned - input.movedOut
    : 0n;
  const effectivePlanned = nativeRemainder + input.scheduledIn;
  const completed = calculateWipCompletedMilliseconds({
    nativeCompleted: input.nativeCompleted,
    reclassifiedFromNative: input.reclassifiedFromNative,
    targetWipCompleted: input.targetWipCompleted,
  });
  if (effectivePlanned <= 0n) return { effectivePlanned, completed, percentage: null };
  const cappedCompleted = completed > effectivePlanned ? effectivePlanned : completed;
  return {
    effectivePlanned,
    completed,
    percentage: Number((cappedCompleted * 1_000n) / effectivePlanned) / 10,
  };
}

export async function loadWipWeekLaborMetrics(weekStartInput: string | Date): Promise<WipWeekLaborMetrics> {
  const parsed = parsePlanDate(weekStartInput);
  if (!parsed) throw new WipWarehouseError('生产周日期无效', 'WIP_WEEK_INVALID');
  const week = chinaWeekRange(parsed);
  const selectedWeekKey = chinaDate(week.start);
  // A carryover is a real execution scope for its target week. Reuse the
  // original batch and work order facts, but attribute that week's planned and
  // reported labor to the carryover target instead of locking them forever to
  // the batch's first planned week.
  const batches = await prisma.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      workOrderId: { not: null },
      OR: [
        { weekStartDate: week.start },
        {
          carryovers: {
            some: {
              targetWeekStartDate: week.start,
              status: { not: 'DISMISSED' },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      quantity: true,
      weekStartDate: true,
      workOrderId: true,
      carryovers: {
        where: { status: { not: 'DISMISSED' } },
        select: { targetWeekStartDate: true },
      },
      workOrder: { select: { processRoute: { select: { steps: {
        where: { retiredAt: null, status: { not: 'skipped' } },
        select: {
          timeBasis: true,
          standardMillisecondsPerUnit: true,
          setupMilliseconds: true,
          unitsPerProduct: true,
        },
      } } } } },
    },
  });
  const effectiveBatchIds = batches.map(batch => batch.id);
  const effectiveWorkOrderIds = batches
    .map(batch => batch.workOrderId)
    .filter((id): id is string => Boolean(id));
  const [
    sourceLots,
    allocations,
    nativePools,
    sourceWipCredits,
    targetCredits,
    unscheduledLots,
    priorNativePools,
  ] = await Promise.all([
    effectiveBatchIds.length ? prisma.semiFinishedLot.findMany({
      where: {
        productionPlanBatchId: { in: effectiveBatchIds },
        scheduleStatus: { not: SemiFinishedScheduleStatus.CANCELLED },
      },
      select: {
        productionPlanBatchId: true,
        sourceWeekStartDate: true,
        enteredAt: true,
        steps: {
          select: {
            remainingStandardMilliseconds: true,
            allocationSteps: {
              select: {
                credits: {
                  where: { status: 'ACTIVE' },
                  select: { workDate: true, standardMilliseconds: true },
                },
              },
            },
          },
        },
      },
    }) : Promise.resolve([]),
    prisma.wipWeekAllocation.findMany({
      where: { targetWeekStartDate: week.start, status: { not: WipWeekAllocationStatus.CANCELLED } },
      select: {
        status: true,
        plannedStandardMilliseconds: true,
        completedStandardMilliseconds: true,
      },
    }),
    effectiveWorkOrderIds.length ? prisma.processLaborPool.aggregate({
      where: {
        workOrderId: { in: effectiveWorkOrderIds },
        workDate: { gte: week.start, lte: week.end },
        completion: { is: { voidedAt: null } },
      },
      _sum: { totalStandardLaborMilliseconds: true },
    }) : Promise.resolve({ _sum: { totalStandardLaborMilliseconds: null } }),
    effectiveWorkOrderIds.length ? prisma.processWipCredit.aggregate({
      where: {
        status: 'ACTIVE',
        workDate: { gte: week.start, lte: week.end },
        completion: { voidedAt: null, workOrderId: { in: effectiveWorkOrderIds } },
      },
      _sum: { standardMilliseconds: true },
    }) : Promise.resolve({ _sum: { standardMilliseconds: null } }),
    prisma.processWipCredit.aggregate({
      where: {
        status: 'ACTIVE',
        allocationStep: { allocation: { targetWeekStartDate: week.start } },
      },
      _sum: { standardMilliseconds: true },
    }),
    prisma.semiFinishedLot.findMany({
      where: { scheduleStatus: { in: [SemiFinishedScheduleStatus.UNSCHEDULED, SemiFinishedScheduleStatus.PARTIALLY_SCHEDULED] } },
      select: {
        quantity: true,
        allocations: { select: { status: true, quantity: true, completedQty: true } },
      },
    }),
    effectiveWorkOrderIds.length ? prisma.processLaborPool.groupBy({
      by: ['workOrderId'],
      where: {
        workOrderId: { in: effectiveWorkOrderIds },
        workDate: { lt: week.start },
        completion: { is: { voidedAt: null } },
      },
      _sum: { totalStandardLaborMilliseconds: true },
    }) : Promise.resolve([]),
  ]);
  const completedBeforeByWorkOrder = new Map(priorNativePools.map(pool => [
    pool.workOrderId,
    pool._sum.totalStandardLaborMilliseconds || 0n,
  ]));
  let nativePlanned = 0n;
  let missingStandardStepCount = 0;
  for (const batch of batches) {
    let batchPlanned = 0n;
    for (const step of batch.workOrder?.processRoute?.steps || []) {
      const snapshot = timeSnapshot(step);
      if (!snapshot) {
        missingStandardStepCount += 1;
        continue;
      }
      batchPlanned += calculateTaskStandardMilliseconds(snapshot, batch.quantity);
    }
    const isCarryoverExecution = chinaDate(batch.weekStartDate) !== selectedWeekKey;
    const completedBefore = isCarryoverExecution && batch.workOrderId
      ? completedBeforeByWorkOrder.get(batch.workOrderId) || 0n
      : 0n;
    nativePlanned += batchPlanned > completedBefore ? batchPlanned - completedBefore : 0n;
  }
  const batchById = new Map(batches.map(batch => [batch.id, batch] as const));
  const movedOut = sourceLots.reduce((sum, lot) => {
    const batch = batchById.get(lot.productionPlanBatchId);
    if (!batch) return sum;
    const enteredWeekKey = chinaDate(chinaWeekRange(lot.enteredAt).start);
    const enteredThroughCarryover = batch.carryovers.some(carryover => (
      chinaDate(carryover.targetWeekStartDate) === enteredWeekKey
    ));
    const effectiveSourceWeekKey = enteredThroughCarryover
      ? enteredWeekKey
      : chinaDate(lot.sourceWeekStartDate);
    // WIP ownership starts no earlier than the real warehouse-entry week and
    // continues through later carryover weeks. This prevents a target week
    // from counting both the inherited native remainder and the same WIP
    // continuation, while keeping weeks before the transfer immutable.
    const ownershipStartWeekKey = effectiveSourceWeekKey > enteredWeekKey
      ? effectiveSourceWeekKey
      : enteredWeekKey;
    if (ownershipStartWeekKey > selectedWeekKey) return sum;
    return sum + lot.steps.reduce((stepSum, step) => {
      // Native planned labor already subtracts labor completed before this
      // week. Exclude only the WIP standard labor that was still owned by the
      // lot at the start of the selected week; current-week credits remain in
      // both the target plan and target completion numerator exactly once.
      const creditedBeforeWeek = step.allocationSteps.reduce((allocationSum, allocationStep) => (
        allocationSum + allocationStep.credits.reduce((creditSum, credit) => (
          chinaDate(credit.workDate) < selectedWeekKey
            ? creditSum + credit.standardMilliseconds
            : creditSum
        ), 0n)
      ), 0n);
      const outstandingAtWeekStart = step.remainingStandardMilliseconds > creditedBeforeWeek
        ? step.remainingStandardMilliseconds - creditedBeforeWeek
        : 0n;
      return stepSum + outstandingAtWeekStart;
    }, 0n);
  }, 0n);
  const scheduledIn = allocations.reduce((sum, allocation) => (
    sum + (allocation.status === WipWeekAllocationStatus.SUPERSEDED
      ? allocation.completedStandardMilliseconds
      : allocation.plannedStandardMilliseconds)
  ), 0n);
  const nativeCompleted = nativePools._sum.totalStandardLaborMilliseconds || 0n;
  const reclassifiedFromNative = sourceWipCredits._sum.standardMilliseconds || 0n;
  const attainment = calculateWipWeekAttainment({
    nativePlanned,
    movedOut,
    scheduledIn,
    nativeCompleted,
    reclassifiedFromNative,
    targetWipCompleted: targetCredits._sum.standardMilliseconds || 0n,
  });
  const unscheduledWipQuantity = unscheduledLots.reduce((sum, lot) => {
    const covered = lot.allocations.reduce((value, allocation) => value + effectiveAllocationQuantity(allocation), 0);
    return sum + Math.max(0, lot.quantity - covered);
  }, 0);
  return {
    weekStartDate: chinaDate(week.start),
    weekEndDate: chinaDate(week.end),
    nativePlannedMilliseconds: bigintNumber(nativePlanned),
    movedOutMilliseconds: bigintNumber(movedOut),
    scheduledInMilliseconds: bigintNumber(scheduledIn),
    effectivePlannedMilliseconds: bigintNumber(attainment.effectivePlanned),
    completedMilliseconds: bigintNumber(attainment.completed),
    percentage: attainment.percentage,
    missingStandardStepCount,
    unscheduledWipQuantity,
  };
}

export function weekForWorkDate(workDate: Date): { start: Date; end: Date; startKey: string } {
  const week = chinaWeekRange(workDate);
  return { ...week, startKey: chinaDate(week.start) };
}

export async function refreshWipLotStatus(tx: Prisma.TransactionClient, lotId: string): Promise<void> {
  await recomputeLotScheduleStatus(tx, lotId);
}
