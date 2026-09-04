import { createHash } from 'node:crypto';
import {
  DailyShipmentAssociationType,
  DailyShipmentItemStatus,
  DailyShipmentPlanStatus,
  DailyShipmentPriority,
  Prisma,
  ShipmentEventType,
} from '@prisma/client';
import {
  assertRecordableShipment,
  assertScheduledQuantity,
  carryoverPlannedShipAt,
  completionPercentage,
  DailyShipmentDomainError,
  netShipmentQuantity,
  parsePlannedShipmentTime,
  parseShipmentDate,
  parseShipmentEventTime,
  positiveShipmentQuantity,
  shipmentItemStatus,
  shipmentNote,
  shipmentPriority,
  shipmentPriorityRank,
  shipmentProgressState,
  shipmentReservationQuantity,
  shipmentVersion,
  shiftShipmentDateKey,
  shipmentWeek,
} from '@/lib/daily-shipment-domain';
import { chinaDateKey } from '@/lib/china-date';
import {
  dailyShipmentCutoverApplies,
  dailyShipmentDisplayWindow,
  dailyShipmentWarningWindow,
  safeShipmentProcessName,
} from '@/lib/daily-shipment-policy';
import { prisma } from '@/lib/prisma';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { productionBatchWeekStartWindow } from '@/lib/production-week';
import {
  activeProductionCarryoverBatchWhere,
  isCurrentProductionCarryoverTarget,
  reconcileCurrentProductionCarryovers,
} from '@/lib/production-carryovers';
import { syncProductionBatchToDueShipmentPlan } from '@/lib/daily-shipment-sync';
import { serializeProductionControl } from '@/lib/production-control';

type TransactionClient = Prisma.TransactionClient;

export class DailyShipmentServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DailyShipmentServiceError';
  }
}

type MutationResult = { planId: string; replayed: boolean };

const actorSelect = { id: true, username: true, displayName: true } satisfies Prisma.UserSelect;

const routeStepSelect = {
  id: true,
  processName: true,
  processCode: true,
  status: true,
  position: true,
  sequenceGroup: true,
} satisfies Prisma.WorkOrderProcessStepSelect;

const workOrderSelect = {
  id: true,
  code: true,
  businessCode: true,
  customerName: true,
  productName: true,
  specification: true,
  stage: true,
  progress: true,
  processName: true,
  productionTargetQty: true,
  uncompletedQty: true,
  completedQty: true,
  lastProgressAt: true,
  operationalNote: true,
  productionControlVersion: true,
  processRoute: {
    select: {
      id: true,
      status: true,
      supplementObligations: {
        where: { status: 'ACTIVE' },
        select: { id: true },
        take: 1,
      },
      steps: { where: { retiredAt: null }, select: routeStepSelect, orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] },
    },
  },
} satisfies Prisma.WorkOrderSelect;

const batchInclude = {
  planOrder: true,
  workOrder: { select: workOrderSelect },
} satisfies Prisma.ProductionPlanBatchInclude;

const itemInclude = {
  plan: { select: { shipDate: true } },
  productionPlanBatch: { include: { planOrder: true } },
  workOrder: { select: workOrderSelect },
  carryoverSourceItem: {
    select: {
      id: true,
      carryoverDayCount: true,
      plan: { select: { shipDate: true } },
    },
  },
  carryoverTargetItem: {
    select: {
      id: true,
      plan: { select: { shipDate: true } },
    },
  },
  events: {
    include: { actor: { select: actorSelect } },
    orderBy: [{ shippedAt: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  revisions: {
    where: { action: 'SET_ITEM_MARK' },
    include: { actor: { select: actorSelect } },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.DailyShipmentPlanItemInclude;

function errorStatus(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('EXCEEDED') || code.includes('LOCKED')) return 409;
  return 400;
}

function mapError(error: unknown): never {
  if (error instanceof DailyShipmentServiceError) throw error;
  if (error instanceof DailyShipmentDomainError) {
    throw new DailyShipmentServiceError(error.message, error.code, errorStatus(error.code));
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new DailyShipmentServiceError('该出货计划已存在或请求已处理', 'SHIPMENT_DUPLICATE', 409);
    }
    if (error.code === 'P2025') {
      throw new DailyShipmentServiceError('出货计划不存在或已被其他人修改', 'SHIPMENT_NOT_FOUND', 404);
    }
    if (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001')) {
      throw new DailyShipmentServiceError('出货计划正在被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
  }
  throw error;
}

async function serializable<T>(operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    return mapError(error);
  }
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function requiredText(value: unknown, label: string, max = 200): string {
  const normalized = String(value ?? '').trim().slice(0, max);
  if (!normalized) throw new DailyShipmentServiceError(`${label}不能为空`, 'SHIPMENT_REQUIRED');
  return normalized;
}

function idempotencyKey(value: unknown): string {
  const normalized = requiredText(value, '幂等键', 200);
  if (normalized.length < 8) {
    throw new DailyShipmentServiceError('幂等键长度不能少于 8 位', 'SHIPMENT_IDEMPOTENCY_INVALID');
  }
  return normalized;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function lock(tx: TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

async function readReplay(tx: TransactionClient, input: {
  idempotencyKey: string;
  payloadHash: string;
  actorId: string;
  action: string;
}): Promise<MutationResult | null> {
  await lock(tx, `daily-shipment-request:${input.idempotencyKey}`);
  const existing = await tx.dailyShipmentRevision.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { planId: true, payloadHash: true, actorId: true, action: true },
  });
  if (!existing) return null;
  if (
    existing.payloadHash !== input.payloadHash
    || existing.actorId !== input.actorId
    || existing.action !== input.action
  ) {
    throw new DailyShipmentServiceError(
      '该幂等键已用于不同的出货请求',
      'SHIPMENT_IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  return { planId: existing.planId, replayed: true };
}

async function writeRevision(tx: TransactionClient, input: {
  planId: string;
  itemId?: string | null;
  action: string;
  idempotencyKey: string;
  payloadHash: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  actorId: string;
}): Promise<void> {
  await tx.dailyShipmentRevision.create({
    data: {
      planId: input.planId,
      itemId: input.itemId ?? null,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      ...(input.before === undefined ? {} : { beforeData: jsonValue(input.before) }),
      ...(input.after === undefined ? {} : { afterData: jsonValue(input.after) }),
      reason: input.reason ?? null,
      actorId: input.actorId,
    },
  });
}

function completedGoodQuantity(workOrder: {
  uncompletedQty: string | null;
  productionTargetQty: number | null;
  completedQty: string | null;
  stage: string;
  processRoute?: { supplementObligations?: Array<{ id: string }> } | null;
}): number {
  // A late-added mandatory operation deliberately leaves completedQty intact
  // for audit. It must nevertheless block physical shipment until its
  // supplemental obligation has been reported in full.
  if (workOrder.processRoute?.supplementObligations?.length) return 0;
  const value = getProductionQuantitySummary(workOrder).completedQty;
  return Math.max(0, Math.floor(value ?? 0));
}

function currentProcess(workOrder: {
  processName: string | null;
  processRoute: { status: string; steps: Array<{ processName: string; status: string }> } | null;
}): string {
  const step = workOrder.processRoute?.steps.find(item => !['completed', 'skipped'].includes(item.status));
  if (step) return safeShipmentProcessName(step.processName);
  if (workOrder.processRoute?.status === 'completed') return '全部工序完成';
  return safeShipmentProcessName(workOrder.processName);
}

function workOrderProgress(workOrder: {
  uncompletedQty: string | null;
  productionTargetQty: number | null;
  completedQty: string | null;
  stage: string;
  progress: number;
}, batchQuantity: number): number {
  const quantity = completedGoodQuantity(workOrder);
  if (batchQuantity > 0) return completionPercentage(quantity, batchQuantity);
  return Math.max(0, workOrder.progress || 0);
}

function serializeEvent(event: {
  id: string;
  eventType: ShipmentEventType;
  quantity: number;
  shippedAt: Date;
  reversalOfEventId: string | null;
  reason: string | null;
  createdAt: Date;
  actor: { id: string; username: string; displayName: string | null };
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    quantity: event.quantity,
    shippedAt: event.shippedAt.toISOString(),
    reversalOfEventId: event.reversalOfEventId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
    actor: {
      id: event.actor.id,
      name: event.actor.displayName || event.actor.username,
    },
  };
}

function latestEffectiveShipmentAt(events: Array<{
  id: string;
  eventType: ShipmentEventType;
  quantity: number;
  shippedAt: Date;
  reversalOfEventId: string | null;
}>): Date | null {
  const reversedByEvent = new Map<string, number>();
  for (const event of events) {
    if (event.eventType !== ShipmentEventType.REVERSAL || !event.reversalOfEventId) continue;
    reversedByEvent.set(
      event.reversalOfEventId,
      (reversedByEvent.get(event.reversalOfEventId) || 0) + event.quantity,
    );
  }
  const latest = [...events].reverse().find(event => (
    event.eventType === ShipmentEventType.SHIPMENT
    && event.quantity > (reversedByEvent.get(event.id) || 0)
  ));
  return latest?.shippedAt || null;
}

function serializeItem(item: Prisma.DailyShipmentPlanItemGetPayload<{ include: typeof itemInclude }>, now: Date) {
  const shippedQuantity = netShipmentQuantity(item.events);
  const completedQuantity = completedGoodQuantity(item.workOrder);
  const actualShipAt = latestEffectiveShipmentAt(item.events);
  const productionFollowUp = serializeProductionControl(item.workOrder).note;
  const markerRevision = item.revisions[0] || null;
  return {
    id: item.id,
    version: item.version,
    status: item.status,
    batchId: item.productionPlanBatchId,
    batchNo: item.productionPlanBatch.batchNo,
    batchQuantity: item.productionPlanBatch.quantity,
    workOrderId: item.workOrderId,
    workOrderCode: item.workOrder.businessCode || item.workOrder.code,
    sourceOrderNo: item.productionPlanBatch.planOrder.sourceOrderNo,
    customerName: item.productionPlanBatch.planOrder.customerName,
    salesperson: item.productionPlanBatch.planOrder.salesperson,
    productName: item.productionPlanBatch.planOrder.productName,
    specification: item.productionPlanBatch.planOrder.specification,
    priority: item.productionPlanBatch.planOrder.priority,
    customerDueDate: item.productionPlanBatch.planOrder.customerDueDateConfirmed ? dateKey(item.productionPlanBatch.planOrder.customerDueDate) : '',
    plannedCompletionDate: dateKey(item.productionPlanBatch.plannedCompletionDate),
    plannedQuantity: item.plannedQuantity,
    shippedQuantity,
    pendingQuantity: Math.max(0, item.plannedQuantity - shippedQuantity),
    completedQuantity,
    productionProgress: workOrderProgress(item.workOrder, item.productionPlanBatch.quantity),
    productionStage: item.workOrder.stage,
    currentProcess: currentProcess(item.workOrder),
    lastProgressAt: item.workOrder.lastProgressAt?.toISOString() || null,
    plannedShipAt: item.plannedShipAt.toISOString(),
    actualShipAt: actualShipAt?.toISOString() || null,
    progressState: shipmentProgressState({
      plannedQuantity: item.plannedQuantity,
      shippedQuantity,
      completedQuantity,
      plannedShipAt: item.plannedShipAt,
      itemStatus: item.status,
      now,
    }),
    shipmentPriority: item.shipmentPriority,
    associationType: item.associationType,
    planShipDate: dateKey(item.plan.shipDate),
    dueDateSnapshot: item.dueDateSnapshot ? dateKey(item.dueDateSnapshot) : null,
    deliveryVersionSnapshot: item.deliveryVersionSnapshot,
    note: item.note,
    productionFollowUp: productionFollowUp ? {
      source: 'PRODUCTION_CONTROL' as const,
      version: item.workOrder.productionControlVersion,
      ...productionFollowUp,
    } : null,
    markerAudit: markerRevision ? {
      updatedAt: markerRevision.createdAt.toISOString(),
      actor: {
        id: markerRevision.actor.id,
        name: markerRevision.actor.displayName || markerRevision.actor.username,
      },
    } : null,
    sortOrder: item.sortOrder,
    isCarryover: Boolean(item.carryoverSourceItemId),
    carryoverSourceItemId: item.carryoverSourceItemId,
    carryoverSourceDate: item.carryoverSourceDate ? dateKey(item.carryoverSourceDate) : null,
    carryoverDayCount: item.carryoverDayCount,
    carryoverQuantity: item.carryoverQuantity,
    carriedOverToDate: item.carryoverTargetItem ? dateKey(item.carryoverTargetItem.plan.shipDate) : null,
    events: item.events.map(serializeEvent),
  };
}

type DailyShipmentCarryoverResult = {
  sourcePlanId: string | null;
  targetPlanId: string | null;
  targetDate: string;
  itemCount: number;
  quantity: number;
  autoClosed: boolean;
  blockedReason: string | null;
};

function moreUrgentPriority(
  first: DailyShipmentPriority,
  second: DailyShipmentPriority,
): DailyShipmentPriority {
  return shipmentPriorityRank(first) <= shipmentPriorityRank(second) ? first : second;
}

function isOpenShipmentPlanStatus(status: DailyShipmentPlanStatus): boolean {
  return status === DailyShipmentPlanStatus.DRAFT || status === DailyShipmentPlanStatus.CONFIRMED;
}

export async function reconcileDailyShipmentCarryover(input: {
  targetShipDate: unknown;
  actorUserId: string;
  sourcePlanId?: string;
  sourcePlanVersion?: number;
  strict?: boolean;
}): Promise<DailyShipmentCarryoverResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const targetDate = parseShipmentDate(input.targetShipDate);
  let sourceDateKey = shiftShipmentDateKey(targetDate.key, -1);
  if (input.sourcePlanId) {
    const sourceIdentity = await prisma.dailyShipmentPlan.findUnique({
      where: { id: input.sourcePlanId },
      select: { shipDate: true },
    });
    if (!sourceIdentity) {
      throw new DailyShipmentServiceError('出货计划不存在', 'SHIPMENT_PLAN_NOT_FOUND', 404);
    }
    sourceDateKey = dateKey(sourceIdentity.shipDate);
  }
  const sourceDate = parseShipmentDate(sourceDateKey);
  if (sourceDate.key >= targetDate.key) {
    throw new DailyShipmentServiceError('结转目标日期必须晚于原计划日期', 'SHIPMENT_CARRYOVER_DATE_INVALID');
  }
  const carryoverDayDelta = Math.max(
    1,
    Math.round((targetDate.value.getTime() - sourceDate.value.getTime()) / 86_400_000),
  );

  return serializable(async tx => {
    await lock(tx, `daily-shipment-plan:${sourceDate.key}`);
    await lock(tx, `daily-shipment-plan:${targetDate.key}`);
    const sourcePlan = await tx.dailyShipmentPlan.findFirst({
      where: input.sourcePlanId
        ? { id: input.sourcePlanId }
        : { shipDate: sourceDate.value },
      include: {
        items: {
          where: { status: { not: DailyShipmentItemStatus.CANCELLED } },
          include: {
            events: { select: { eventType: true, quantity: true } },
            carryoverTargetItem: { select: { id: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    const emptyResult: DailyShipmentCarryoverResult = {
      sourcePlanId: sourcePlan?.id || null,
      targetPlanId: null,
      targetDate: targetDate.key,
      itemCount: 0,
      quantity: 0,
      autoClosed: false,
      blockedReason: null,
    };
    if (!sourcePlan) return emptyResult;
    if (dateKey(sourcePlan.shipDate) !== sourceDate.key) {
      throw new DailyShipmentServiceError('原计划日期已变化，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    if (input.sourcePlanVersion !== undefined && sourcePlan.version !== input.sourcePlanVersion) {
      throw new DailyShipmentServiceError('计划已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    if (sourcePlan.status !== DailyShipmentPlanStatus.CONFIRMED) {
      if (input.strict && sourcePlan.status === DailyShipmentPlanStatus.DRAFT) {
        throw new DailyShipmentServiceError('草稿计划不是正式出货目标，确认后才能结转', 'SHIPMENT_PLAN_NOT_CONFIRMED', 409);
      }
      return emptyResult;
    }

    const pendingItems = sourcePlan.items.flatMap(item => {
      if (item.status === DailyShipmentItemStatus.CARRIED_OVER) return [];
      if (item.carryoverTargetItem) return [];
      const pendingQuantity = Math.max(0, item.plannedQuantity - netShipmentQuantity(item.events));
      return pendingQuantity > 0 ? [{ item, pendingQuantity }] : [];
    });
    if (pendingItems.length === 0) {
      await tx.dailyShipmentPlan.update({
        where: { id: sourcePlan.id },
        data: {
          status: DailyShipmentPlanStatus.CLOSED,
          closedAt: new Date(),
          closedById: actorId,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      await writeRevision(tx, {
        planId: sourcePlan.id,
        action: 'AUTO_CLOSE_PLAN',
        idempotencyKey: `daily-shipment-auto-close:${sourcePlan.id}`,
        payloadHash: stableHash({ sourcePlanId: sourcePlan.id, targetDate: targetDate.key }),
        before: { status: sourcePlan.status, version: sourcePlan.version },
        after: { status: DailyShipmentPlanStatus.CLOSED, targetDate: targetDate.key },
        actorId,
      });
      return { ...emptyResult, autoClosed: true };
    }

    let targetPlan = await tx.dailyShipmentPlan.findUnique({
      where: { shipDate: targetDate.value },
      include: {
        items: {
          include: { events: { select: { eventType: true, quantity: true } } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!targetPlan) {
      targetPlan = await tx.dailyShipmentPlan.create({
        data: {
          shipDate: targetDate.value,
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actorId,
          createdById: actorId,
          updatedById: actorId,
        },
        include: {
          items: { include: { events: { select: { eventType: true, quantity: true } } } },
        },
      });
    } else if (targetPlan.status !== DailyShipmentPlanStatus.CONFIRMED) {
      targetPlan = await tx.dailyShipmentPlan.update({
        where: { id: targetPlan.id },
        data: {
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: targetPlan.confirmedAt || new Date(),
          confirmedById: targetPlan.confirmedById || actorId,
          closedAt: null,
          closedById: null,
          updatedById: actorId,
          version: { increment: 1 },
        },
        include: {
          items: {
            include: { events: { select: { eventType: true, quantity: true } } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
    }

    const currentSortOrder = targetPlan.items.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1);
    const transfers: Array<{ sourceItemId: string; targetItemId: string; quantity: number }> = [];
    for (let index = 0; index < pendingItems.length; index += 1) {
      const { item: sourceItem, pendingQuantity } = pendingItems[index];
      await tx.dailyShipmentPlanItem.update({
        where: { id: sourceItem.id },
        data: { associationKey: null, updatedById: actorId },
      });
      const existing = targetPlan.items.find(item => item.productionPlanBatchId === sourceItem.productionPlanBatchId);
      const carriedShipAt = carryoverPlannedShipAt(sourceItem.plannedShipAt, targetDate.key);
      let targetItemId: string;
      if (existing) {
        const existingShipped = netShipmentQuantity(existing.events);
        const revived = existing.status === DailyShipmentItemStatus.CANCELLED;
        const nextPlannedQuantity = (revived ? 0 : existing.plannedQuantity) + pendingQuantity;
        const updated = await tx.dailyShipmentPlanItem.update({
          where: { id: existing.id },
          data: {
            plannedQuantity: nextPlannedQuantity,
            plannedShipAt: revived || carriedShipAt < existing.plannedShipAt ? carriedShipAt : existing.plannedShipAt,
            status: shipmentItemStatus(nextPlannedQuantity, existingShipped),
            shipmentPriority: moreUrgentPriority(existing.shipmentPriority, sourceItem.shipmentPriority),
            associationType: DailyShipmentAssociationType.CARRYOVER,
            associationKey: `daily-shipment-open:${sourceItem.productionPlanBatchId}`,
            dueDateSnapshot: sourceItem.dueDateSnapshot,
            deliveryVersionSnapshot: sourceItem.deliveryVersionSnapshot,
            ...(!existing.carryoverSourceItemId ? { carryoverSourceItemId: sourceItem.id } : {}),
            carryoverSourceDate: sourcePlan.shipDate,
            carryoverDayCount: Math.max(carryoverDayDelta, sourceItem.carryoverDayCount + carryoverDayDelta),
            carryoverQuantity: (revived ? 0 : existing.carryoverQuantity) + pendingQuantity,
            sourceSnapshot: jsonValue(sourceItem.sourceSnapshot),
            version: { increment: 1 },
            updatedById: actorId,
          },
        });
        targetItemId = updated.id;
      } else {
        const created = await tx.dailyShipmentPlanItem.create({
          data: {
            planId: targetPlan.id,
            productionPlanBatchId: sourceItem.productionPlanBatchId,
            workOrderId: sourceItem.workOrderId,
            plannedQuantity: pendingQuantity,
            plannedShipAt: carriedShipAt,
            status: DailyShipmentItemStatus.PLANNED,
            shipmentPriority: sourceItem.shipmentPriority,
            associationType: DailyShipmentAssociationType.CARRYOVER,
            associationKey: `daily-shipment-open:${sourceItem.productionPlanBatchId}`,
            dueDateSnapshot: sourceItem.dueDateSnapshot,
            deliveryVersionSnapshot: sourceItem.deliveryVersionSnapshot,
            sortOrder: currentSortOrder + index + 1,
            note: sourceItem.note,
            sourceSnapshot: jsonValue(sourceItem.sourceSnapshot),
            carryoverSourceItemId: sourceItem.id,
            carryoverSourceDate: sourcePlan.shipDate,
            carryoverDayCount: Math.max(carryoverDayDelta, sourceItem.carryoverDayCount + carryoverDayDelta),
            carryoverQuantity: pendingQuantity,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        targetItemId = created.id;
      }
      await tx.dailyShipmentPlanItem.update({
        where: { id: sourceItem.id },
        data: {
          status: DailyShipmentItemStatus.CARRIED_OVER,
          associationKey: null,
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      transfers.push({ sourceItemId: sourceItem.id, targetItemId, quantity: pendingQuantity });
    }

    await tx.dailyShipmentPlan.update({
      where: { id: sourcePlan.id },
      data: {
        status: DailyShipmentPlanStatus.CLOSED_WITH_CARRYOVER,
        closedAt: new Date(),
        closedById: actorId,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    await tx.dailyShipmentPlan.update({
      where: { id: targetPlan.id },
      data: { updatedById: actorId, version: { increment: 1 } },
    });
    const quantity = transfers.reduce((total, transfer) => total + transfer.quantity, 0);
    const revisionPayload = {
      sourcePlanId: sourcePlan.id,
      targetPlanId: targetPlan.id,
      sourceDate: sourceDate.key,
      targetDate: targetDate.key,
      transfers,
    };
    await writeRevision(tx, {
      planId: sourcePlan.id,
      action: 'AUTO_CARRYOVER_SOURCE',
      idempotencyKey: `daily-shipment-carryover-source:${sourcePlan.id}:${targetDate.key}`,
      payloadHash: stableHash(revisionPayload),
      before: { status: sourcePlan.status, version: sourcePlan.version },
      after: revisionPayload,
      actorId,
    });
    await writeRevision(tx, {
      planId: targetPlan.id,
      action: 'AUTO_CARRYOVER_TARGET',
      idempotencyKey: `daily-shipment-carryover-target:${sourcePlan.id}:${targetDate.key}`,
      payloadHash: stableHash(revisionPayload),
      after: revisionPayload,
      actorId,
    });
    return {
      sourcePlanId: sourcePlan.id,
      targetPlanId: targetPlan.id,
      targetDate: targetDate.key,
      itemCount: transfers.length,
      quantity,
      autoClosed: false,
      blockedReason: null,
    };
  });
}

export type DailyShipmentCarryoverMaintenanceResult = {
  targetDate: string;
  sourcePlanCount: number;
  movedItemCount: number;
  movedQuantity: number;
  autoClosedPlanCount: number;
  blocked: Array<{ planId: string; reason: string }>;
};

/**
 * Reconciles every still-open plan before the target day, oldest first. The
 * operation is safe to replay: each source item can have only one carryover
 * target and each source/target revision has a deterministic idempotency key.
 */
export async function reconcileAllDailyShipmentCarryovers(input: {
  targetShipDate: unknown;
  actorUserId?: string | null;
  limit?: number;
}): Promise<DailyShipmentCarryoverMaintenanceResult> {
  const targetDate = parseShipmentDate(input.targetShipDate);
  const actorId = input.actorUserId || (await prisma.user.findFirst({
    where: { isActive: true, accountStatus: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { username: 'asc' }],
    select: { id: true },
  }))?.id;
  if (!actorId) {
    throw new DailyShipmentServiceError('系统缺少可记录自动顺延的操作账号', 'SHIPMENT_ACTOR_MISSING', 409);
  }
  const sourcePlans = await prisma.dailyShipmentPlan.findMany({
    where: {
      shipDate: { lt: targetDate.value },
      status: DailyShipmentPlanStatus.CONFIRMED,
    },
    orderBy: [{ shipDate: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(500, input.limit ?? 200)),
    select: { id: true },
  });
  const result: DailyShipmentCarryoverMaintenanceResult = {
    targetDate: targetDate.key,
    sourcePlanCount: sourcePlans.length,
    movedItemCount: 0,
    movedQuantity: 0,
    autoClosedPlanCount: 0,
    blocked: [],
  };
  for (const sourcePlan of sourcePlans) {
    try {
      const reconciled = await reconcileDailyShipmentCarryover({
        targetShipDate: targetDate.key,
        actorUserId: actorId,
        sourcePlanId: sourcePlan.id,
      });
      result.movedItemCount += reconciled.itemCount;
      result.movedQuantity += reconciled.quantity;
      if (reconciled.autoClosed) result.autoClosedPlanCount += 1;
      if (reconciled.blockedReason) {
        result.blocked.push({ planId: sourcePlan.id, reason: reconciled.blockedReason });
      }
    } catch (error) {
      result.blocked.push({
        planId: sourcePlan.id,
        reason: error instanceof Error ? error.message : '未知顺延错误',
      });
    }
  }
  return result;
}

export type DailyShipmentRepairResult = {
  startDate: string;
  endDate: string;
  scannedCount: number;
  changedCount: number;
  unchangedCount: number;
  skippedCount: number;
  failed: Array<{ batchId: string; reason: string }>;
};

/**
 * Rebuilds missing due-date associations for the cutover window. This is safe
 * to replay because syncProductionBatchToDueShipmentPlan locks by batch and
 * uses the stable `daily-shipment-open:<batchId>` association key.
 */
export async function reconcileDailyShipmentCutoverWindow(input: {
  startDate: unknown;
  endDate: unknown;
  actorUserId?: string | null;
  pageSize?: number;
}): Promise<DailyShipmentRepairResult> {
  const requestedStart = parseShipmentDate(input.startDate);
  const end = parseShipmentDate(input.endDate);
  const policyWindow = dailyShipmentDisplayWindow(end.key);
  const startKey = policyWindow.cutoverApplied && requestedStart.key < policyWindow.startKey
    ? policyWindow.startKey
    : requestedStart.key;
  const start = parseShipmentDate(startKey);
  const result: DailyShipmentRepairResult = {
    startDate: start.key,
    endDate: end.key,
    scannedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    failed: [],
  };
  if (start.key > end.key) return result;

  const pageSize = Math.max(25, Math.min(500, input.pageSize ?? 200));
  let cursor: string | undefined;
  do {
    const batches = await prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        workOrderId: { not: null },
        releaseState: { in: ['active', 'preparation', 'archived'] },
        planOrder: {
          deletedAt: null,
          customerDueDateConfirmed: true,
          customerDueDate: { gte: start.value, lt: parseShipmentDate(shiftShipmentDateKey(end.key, 1)).value },
          status: { notIn: ['cancelled', 'paused'] },
        },
        workOrder: { is: { deletedAt: null } },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        quantity: true,
        planOrder: { select: { customerDueDate: true, deliveryVersion: true } },
        dailyShipmentItems: {
          select: {
            associationKey: true,
            status: true,
            deliveryVersionSnapshot: true,
            dueDateSnapshot: true,
            plan: { select: { shipDate: true } },
            events: { select: { eventType: true, quantity: true } },
          },
        },
      },
    });
    if (!batches.length) break;
    result.scannedCount += batches.length;
    for (const batch of batches) {
      const shippedQuantity = netShipmentQuantity(batch.dailyShipmentItems.flatMap(item => item.events));
      if (shippedQuantity >= batch.quantity) {
        result.skippedCount += 1;
        continue;
      }
      const dueDate = dateKey(batch.planOrder.customerDueDate);
      const healthy = batch.dailyShipmentItems.some(item => (
        item.associationKey === `daily-shipment-open:${batch.id}`
        && (item.status === DailyShipmentItemStatus.PLANNED || item.status === DailyShipmentItemStatus.PARTIALLY_SHIPPED)
        && item.deliveryVersionSnapshot === batch.planOrder.deliveryVersion
        && item.dueDateSnapshot !== null
        && dateKey(item.dueDateSnapshot) === dueDate
      ));
      if (healthy) {
        result.unchangedCount += 1;
        continue;
      }
      try {
        const synced = await prisma.$transaction(tx => syncProductionBatchToDueShipmentPlan(tx, {
          batchId: batch.id,
          actorId: input.actorUserId || null,
          reason: 'repair',
          allowArchived: true,
        }), {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
        if (synced.skippedReason) result.skippedCount += 1;
        else if (synced.changed) result.changedCount += 1;
        else result.unchangedCount += 1;
      } catch (error) {
        result.failed.push({
          batchId: batch.id,
          reason: error instanceof Error ? error.message : '未知关联修复错误',
        });
      }
    }
    cursor = batches[batches.length - 1]?.id;
    if (batches.length < pageSize) break;
  } while (cursor);
  return result;
}

export async function loadDailyShipmentWorkbench(input: { shipDate: unknown; actorUserId?: string }) {
  const parsedDate = parseShipmentDate(input.shipDate);
  const displayWindow = dailyShipmentDisplayWindow(parsedDate.key);
  const week = shipmentWeek(parsedDate.key);
  const batchWeek = productionBatchWeekStartWindow(parsedDate.key);
  const now = new Date();
  let repairSummary: DailyShipmentRepairResult | null = null;
  let carryoverReconciliation: DailyShipmentCarryoverResult | null = null;
  if (input.actorUserId && displayWindow.cutoverApplied) {
    repairSummary = await reconcileDailyShipmentCutoverWindow({
      startDate: displayWindow.startKey,
      endDate: displayWindow.endKey,
      actorUserId: input.actorUserId,
    });
  }
  if (input.actorUserId && parsedDate.key === chinaDateKey(now)) {
    const maintenance = await reconcileAllDailyShipmentCarryovers({
      targetShipDate: parsedDate.key,
      actorUserId: input.actorUserId,
    });
    carryoverReconciliation = {
      sourcePlanId: null,
      targetPlanId: null,
      targetDate: maintenance.targetDate,
      itemCount: maintenance.movedItemCount,
      quantity: maintenance.movedQuantity,
      autoClosed: maintenance.autoClosedPlanCount > 0,
      blockedReason: maintenance.blocked.length
        ? `${maintenance.blocked.length} 张历史出货计划顺延待重试`
        : null,
    };
  }
  if (isCurrentProductionCarryoverTarget(week.startDate) && input.actorUserId) {
    await reconcileCurrentProductionCarryovers({ targetWeekStart: week.startDate, actorId: input.actorUserId });
  }

  const [plan, batches, weekPlans, windowItems] = await Promise.all([
    prisma.dailyShipmentPlan.findUnique({
      where: { shipDate: parsedDate.value },
      include: {
        confirmedBy: { select: actorSelect },
        closedBy: { select: actorSelect },
        items: {
          include: itemInclude,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    }),
    prisma.productionPlanBatch.findMany({
      where: {
        deletedAt: null,
        workOrderId: { not: null },
        OR: [
          { releaseState: { in: ['active', 'preparation'] }, weekStartDate: { gte: batchWeek.gte, lt: batchWeek.lt } },
          activeProductionCarryoverBatchWhere(week.startDate),
        ],
        planOrder: { deletedAt: null },
        workOrder: { is: { deletedAt: null } },
      },
      include: batchInclude,
      orderBy: [{ plannedCompletionDate: 'asc' }, { batchNo: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.dailyShipmentPlan.findMany({
      where: { shipDate: { gte: week.startDate, lt: week.endExclusiveDate } },
      select: {
        shipDate: true,
        status: true,
        items: {
          where: { status: { not: DailyShipmentItemStatus.CANCELLED } },
          select: {
            plannedQuantity: true,
            events: { select: { eventType: true, quantity: true } },
          },
        },
      },
    }),
    prisma.dailyShipmentPlanItem.findMany({
      where: {
        status: { not: DailyShipmentItemStatus.CANCELLED },
        plan: { shipDate: { lte: parsedDate.value } },
        productionPlanBatch: {
          deletedAt: null,
          planOrder: {
            deletedAt: null,
            customerDueDateConfirmed: true,
            customerDueDate: { gte: displayWindow.startDate, lt: displayWindow.endExclusiveDate },
            status: { notIn: ['cancelled', 'paused'] },
          },
        },
        workOrder: { is: { deletedAt: null } },
      },
      include: itemInclude,
      orderBy: [{ plannedShipAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  const batchIds = batches.map(batch => batch.id);
  const scheduledItems = batchIds.length
    ? await prisma.dailyShipmentPlanItem.findMany({
        where: {
          productionPlanBatchId: { in: batchIds },
          status: { not: DailyShipmentItemStatus.CANCELLED },
        },
         select: {
           id: true,
           version: true,
           productionPlanBatchId: true,
           plannedQuantity: true,
           status: true,
           plan: { select: { id: true, version: true, shipDate: true, status: true } },
           events: { select: { eventType: true, quantity: true } },
        },
      })
    : [];
  const scheduledByBatch = new Map<string, number>();
  const shippedByBatch = new Map<string, number>();
  const daysByBatch = new Map<string, string[]>();
  const reservationsByBatch = new Map<string, Array<{
    itemId: string;
    itemVersion: number;
    planId: string;
    planVersion: number;
    shipDate: string;
    planStatus: DailyShipmentPlanStatus;
    itemStatus: DailyShipmentItemStatus;
    plannedQuantity: number;
    shippedQuantity: number;
    pendingQuantity: number;
    reservedQuantity: number;
    canRelease: boolean;
    canTransferToSelectedDate: boolean;
  }>>();
  for (const item of scheduledItems) {
    const reservedQuantity = shipmentReservationQuantity(item);
    const shippedQuantity = netShipmentQuantity(item.events);
    const shipDate = dateKey(item.plan.shipDate);
    scheduledByBatch.set(
      item.productionPlanBatchId,
      (scheduledByBatch.get(item.productionPlanBatchId) || 0) + reservedQuantity,
    );
    shippedByBatch.set(
      item.productionPlanBatchId,
      (shippedByBatch.get(item.productionPlanBatchId) || 0) + shippedQuantity,
    );
    if (reservedQuantity > 0 && item.status !== DailyShipmentItemStatus.CARRIED_OVER) {
      const days = daysByBatch.get(item.productionPlanBatchId) || [];
      days.push(shipDate);
      daysByBatch.set(item.productionPlanBatchId, days);
    }
    if (reservedQuantity > 0) {
      const reservations = reservationsByBatch.get(item.productionPlanBatchId) || [];
      reservations.push({
        itemId: item.id,
        itemVersion: item.version,
        planId: item.plan.id,
        planVersion: item.plan.version,
        shipDate,
        planStatus: item.plan.status,
        itemStatus: item.status,
        plannedQuantity: item.plannedQuantity,
        shippedQuantity,
        pendingQuantity: Math.max(0, item.plannedQuantity - shippedQuantity),
        reservedQuantity,
        canRelease: shippedQuantity === 0
          && item.status === DailyShipmentItemStatus.PLANNED
          && isOpenShipmentPlanStatus(item.plan.status),
        canTransferToSelectedDate: shipDate < parsedDate.key
          && item.status !== DailyShipmentItemStatus.CARRIED_OVER
          && Math.max(0, item.plannedQuantity - shippedQuantity) > 0
          && isOpenShipmentPlanStatus(item.plan.status),
      });
      reservationsByBatch.set(item.productionPlanBatchId, reservations);
    }
  }

  const candidates = batches.map(batch => {
    const workOrder = batch.workOrder!;
    const scheduledQuantity = scheduledByBatch.get(batch.id) || 0;
    const shippedQuantity = shippedByBatch.get(batch.id) || 0;
    const completedQuantity = completedGoodQuantity(workOrder);
    return {
      batchId: batch.id,
      batchNo: batch.batchNo,
      batchQuantity: batch.quantity,
      releaseState: batch.releaseState,
      workOrderId: workOrder.id,
      workOrderCode: workOrder.businessCode || workOrder.code,
      sourceOrderNo: batch.planOrder.sourceOrderNo,
      customerName: batch.planOrder.customerName,
      salesperson: batch.planOrder.salesperson,
      productName: batch.planOrder.productName,
      specification: batch.planOrder.specification,
      priority: batch.planOrder.priority,
      customerDueDate: batch.planOrder.customerDueDateConfirmed ? dateKey(batch.planOrder.customerDueDate) : '',
      plannedCompletionDate: dateKey(batch.plannedCompletionDate),
      scheduledQuantity,
      availableQuantity: Math.max(0, batch.quantity - scheduledQuantity),
      completedQuantity,
      shippedQuantity,
      productionProgress: workOrderProgress(workOrder, batch.quantity),
      productionStage: workOrder.stage,
      currentProcess: currentProcess(workOrder),
      lastProgressAt: workOrder.lastProgressAt?.toISOString() || null,
      scheduledDates: [...new Set(daysByBatch.get(batch.id) || [])].sort(),
      reservations: (reservationsByBatch.get(batch.id) || []).sort((first, second) => (
        first.shipDate.localeCompare(second.shipDate) || first.itemId.localeCompare(second.itemId)
      )),
      eligibleForSelectedDate: batch.planOrder.customerDueDateConfirmed
        && dateKey(batch.planOrder.customerDueDate) === parsedDate.key,
    };
  });

  const activeItems = plan?.items.filter(item => item.status !== DailyShipmentItemStatus.CANCELLED) || [];
  const serializedItems = activeItems.map(item => serializeItem(item, now)).sort((first, second) => {
    const firstCompletionRank = first.status === DailyShipmentItemStatus.SHIPPED
      ? 2
      : first.status === DailyShipmentItemStatus.CARRIED_OVER ? 1 : 0;
    const secondCompletionRank = second.status === DailyShipmentItemStatus.SHIPPED
      ? 2
      : second.status === DailyShipmentItemStatus.CARRIED_OVER ? 1 : 0;
    return firstCompletionRank - secondCompletionRank
      || shipmentPriorityRank(first.shipmentPriority) - shipmentPriorityRank(second.shipmentPriority)
      || Number(second.isCarryover) - Number(first.isCarryover)
      || first.plannedShipAt.localeCompare(second.plannedShipAt)
      || first.sortOrder - second.sortOrder;
  });
  const incomingCarryovers = serializedItems.filter(item => item.isCarryover);
  const carriedOutItems = serializedItems.filter(item => item.status === DailyShipmentItemStatus.CARRIED_OVER);
  const itemsByBatch = new Map<string, typeof windowItems>();
  for (const item of windowItems) {
    const grouped = itemsByBatch.get(item.productionPlanBatchId) || [];
    grouped.push(item);
    itemsByBatch.set(item.productionPlanBatchId, grouped);
  }
  const cutoverDisplayItems = [...itemsByBatch.values()].flatMap(items => {
    const canonical = items.find(item => (
      item.status === DailyShipmentItemStatus.PLANNED
      || item.status === DailyShipmentItemStatus.PARTIALLY_SHIPPED
    )) || items.find(item => item.status === DailyShipmentItemStatus.SHIPPED) || items[0];
    if (!canonical) return [];
    const allEvents = items.flatMap(item => item.events).sort((first, second) => (
      first.shippedAt.getTime() - second.shippedAt.getTime()
      || first.createdAt.getTime() - second.createdAt.getTime()
    ));
    const base = serializeItem(canonical, now);
    const totalQuantity = canonical.productionPlanBatch.quantity;
    const totalShipped = netShipmentQuantity(allEvents);
    const pending = Math.max(0, totalQuantity - totalShipped);
    const currentStatus = pending <= 0
      ? DailyShipmentItemStatus.SHIPPED
      : totalShipped > 0 ? DailyShipmentItemStatus.PARTIALLY_SHIPPED : canonical.status;
    const actualShipAt = latestEffectiveShipmentAt(allEvents);
    return [{
      ...base,
      status: currentStatus,
      plannedQuantity: totalQuantity,
      shippedQuantity: totalShipped,
      pendingQuantity: pending,
      actualShipAt: actualShipAt?.toISOString() || null,
      progressState: shipmentProgressState({
        plannedQuantity: totalQuantity,
        shippedQuantity: totalShipped,
        completedQuantity: base.completedQuantity,
        plannedShipAt: canonical.plannedShipAt,
        itemStatus: currentStatus,
        now,
      }),
      // Keep row actions bound to the canonical item's own revision/events.
      // Cross-day audit history remains available in the dedicated history view.
      events: base.events,
      isOperationalOnSelectedDate: dateKey(canonical.plan.shipDate) === parsedDate.key
        && currentStatus !== DailyShipmentItemStatus.SHIPPED
        && currentStatus !== DailyShipmentItemStatus.CARRIED_OVER,
    }];
  }).sort((first, second) => (
    first.customerDueDate.localeCompare(second.customerDueDate)
    || Number(first.status === DailyShipmentItemStatus.SHIPPED) - Number(second.status === DailyShipmentItemStatus.SHIPPED)
    || shipmentPriorityRank(first.shipmentPriority) - shipmentPriorityRank(second.shipmentPriority)
    || first.workOrderCode.localeCompare(second.workOrderCode)
  ));
  // The cutover is intentionally forward-only. Historical plans keep their
  // original per-day behavior so legacy carry-over evidence remains readable.
  const legacyDisplayItems = serializedItems.map(item => ({
      ...item,
      isOperationalOnSelectedDate: item.planShipDate === parsedDate.key
        && item.status !== DailyShipmentItemStatus.SHIPPED
        && item.status !== DailyShipmentItemStatus.CARRIED_OVER,
    }));
  // The collaboration list contains only a batch's remaining balance. Fully
  // shipped batches are deliberately split into the completion lane for the
  // actual China business date, so they cannot be carried into tomorrow again.
  const displayItems = (displayWindow.cutoverApplied ? cutoverDisplayItems : legacyDisplayItems)
    .filter(item => item.status !== DailyShipmentItemStatus.SHIPPED && item.pendingQuantity > 0);
  const shippedTodayItems = (displayWindow.cutoverApplied ? cutoverDisplayItems : legacyDisplayItems)
    .filter(item => (
      item.status === DailyShipmentItemStatus.SHIPPED
      && Boolean(item.actualShipAt)
      && chinaDateKey(new Date(item.actualShipAt!)) === parsedDate.key
    ));
  const displayedOperationalItems = displayItems.filter(item => (
    item.status !== DailyShipmentItemStatus.CARRIED_OVER
  ));
  const prioritySummary = (priority: DailyShipmentPriority) => {
    const items = displayedOperationalItems.filter(item => item.shipmentPriority === priority);
    return {
      itemCount: items.length,
      quantity: items.reduce((total, item) => total + item.pendingQuantity, 0),
    };
  };

  const dayMap = new Map(weekPlans.map(weekPlan => {
    const items = weekPlan.items;
    const planned = items.reduce((total, item) => total + item.plannedQuantity, 0);
    const shipped = items.reduce((total, item) => total + netShipmentQuantity(item.events), 0);
    return [dateKey(weekPlan.shipDate), {
      status: weekPlan.status,
      itemCount: items.length,
      plannedQuantity: planned,
      shippedQuantity: shipped,
    }];
  }));

  return {
    selectedDate: parsedDate.key,
    generatedAt: now.toISOString(),
    range: {
      cutoverDate: displayWindow.cutoverApplied ? displayWindow.startKey : null,
      startDate: displayWindow.startKey,
      endDate: displayWindow.endKey,
    },
    week: {
      startDate: week.startKey,
      endDate: week.endKey,
      days: week.dates.map(day => ({
        date: day,
        ...(dayMap.get(day) || {
          status: null,
          itemCount: 0,
          plannedQuantity: 0,
          shippedQuantity: 0,
        }),
      })),
    },
    plan: plan ? {
      id: plan.id,
      status: plan.status,
      version: plan.version,
      confirmedAt: plan.confirmedAt?.toISOString() || null,
      confirmedBy: plan.confirmedBy
        ? { id: plan.confirmedBy.id, name: plan.confirmedBy.displayName || plan.confirmedBy.username }
        : null,
      closedAt: plan.closedAt?.toISOString() || null,
      closedBy: plan.closedBy
        ? { id: plan.closedBy.id, name: plan.closedBy.displayName || plan.closedBy.username }
        : null,
      items: serializedItems,
    } : null,
    displayItems,
    shippedTodayItems,
    summary: {
      itemCount: displayItems.length,
      plannedQuantity: displayItems.reduce((total, item) => total + item.plannedQuantity, 0),
      readyQuantity: displayItems.reduce((total, item) => (
        total + Math.min(item.pendingQuantity, Math.max(0, item.completedQuantity - item.shippedQuantity))
      ), 0),
      shippedQuantity: shippedTodayItems.reduce((total, item) => total + item.shippedQuantity, 0),
      pendingQuantity: displayedOperationalItems.reduce((total, item) => total + item.pendingQuantity, 0),
      riskItemCount: displayedOperationalItems.filter(item => ['OVERDUE', 'NOT_STARTED'].includes(item.progressState)).length,
      urgent: prioritySummary(DailyShipmentPriority.URGENT),
      priority: prioritySummary(DailyShipmentPriority.PRIORITY),
      normal: prioritySummary(DailyShipmentPriority.NORMAL),
      completed: {
        itemCount: shippedTodayItems.length,
        quantity: shippedTodayItems.reduce((total, item) => total + item.shippedQuantity, 0),
      },
      carryover: {
        itemCount: incomingCarryovers.length,
        quantity: incomingCarryovers.reduce((total, item) => total + item.carryoverQuantity, 0),
        sourceDate: incomingCarryovers.map(item => item.carryoverSourceDate).filter(Boolean).sort()[0] || null,
        maxDayCount: incomingCarryovers.reduce((maximum, item) => Math.max(maximum, item.carryoverDayCount), 0),
      },
      carriedOut: {
        itemCount: carriedOutItems.length,
        quantity: carriedOutItems.reduce((total, item) => total + item.pendingQuantity, 0),
      },
    },
    carryoverReconciliation,
    repairSummary,
    candidates,
  };
}

export async function loadShipmentWarningOverview(input: { anchorDate: unknown; actorUserId?: string | null }) {
  const anchor = parseShipmentDate(input.anchorDate);
  const warningWindow = dailyShipmentWarningWindow(anchor.key);
  const rangeEndKey = warningWindow.endKey;
  const now = new Date();
  let repairSummary: DailyShipmentRepairResult | null = null;
  if (input.actorUserId && warningWindow.cutoverApplied) {
    repairSummary = await reconcileDailyShipmentCutoverWindow({
      startDate: warningWindow.startKey,
      endDate: warningWindow.endKey,
      actorUserId: input.actorUserId,
    });
  }
  const batches = await prisma.productionPlanBatch.findMany({
    where: {
      deletedAt: null,
      workOrderId: { not: null },
      releaseState: { in: ['active', 'preparation', 'archived'] },
      planOrder: {
        deletedAt: null,
        customerDueDateConfirmed: true,
        customerDueDate: { gte: warningWindow.startDate, lt: warningWindow.endExclusiveDate },
        status: { notIn: ['cancelled', 'paused'] },
      },
      workOrder: { is: { deletedAt: null } },
    },
    include: {
      planOrder: true,
      workOrder: { select: workOrderSelect },
      dailyShipmentItems: {
        include: {
          plan: { select: { shipDate: true } },
          events: { select: { eventType: true, quantity: true } },
        },
        orderBy: [{ plannedShipAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
    orderBy: [
      { planOrder: { customerDueDate: 'asc' } },
      { batchNo: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  const items = batches.flatMap(batch => {
    const shippedQuantity = netShipmentQuantity(batch.dailyShipmentItems.flatMap(item => item.events));
    const pendingQuantity = Math.max(0, batch.quantity - shippedQuantity);
    if (!batch.workOrder) return [];
    const dueDate = dateKey(batch.planOrder.customerDueDate);
    const daysUntilDue = Math.round(
      (parseShipmentDate(dueDate).value.getTime() - anchor.value.getTime()) / 86_400_000,
    );
    const warningLevel = daysUntilDue < 0
      ? 'OVERDUE'
      : daysUntilDue === 0
        ? 'TODAY'
        : `T${Math.min(3, daysUntilDue)}`;
    const openItem = batch.dailyShipmentItems.find(item => (
      item.status === DailyShipmentItemStatus.PLANNED
      || item.status === DailyShipmentItemStatus.PARTIALLY_SHIPPED
    )) || null;
    const latestItem = openItem || batch.dailyShipmentItems.find(item => item.status !== DailyShipmentItemStatus.CANCELLED) || null;
    const associatedPlanDate = latestItem ? dateKey(latestItem.plan.shipDate) : null;
    const expectedPlanDate = daysUntilDue < 0 ? anchor.key : dueDate;
    const completedQuantity = completedGoodQuantity(batch.workOrder);
    const productionState = completedQuantity >= batch.quantity
      ? 'COMPLETED'
      : completedQuantity > 0 ? 'IN_PRODUCTION' : 'NOT_STARTED';
    const shipmentState = pendingQuantity <= 0
      ? 'SHIPPED'
      : shippedQuantity > 0
        ? 'PARTIAL'
        : daysUntilDue < 0 ? 'OVERDUE' : openItem ? 'PENDING' : 'EXPECTED_NOT_PLANNED';
    const planningState = latestItem
      ? latestItem.status === DailyShipmentItemStatus.CARRIED_OVER || latestItem.associationType === DailyShipmentAssociationType.CARRYOVER
        ? 'CARRIED_OVER'
        : 'PLAN_CREATED'
      : 'EXPECTED_NOT_PLANNED';
    return [{
      batchId: batch.id,
      workOrderId: batch.workOrder.id,
      workOrderCode: batch.workOrder.businessCode || batch.workOrder.code,
      sourceOrderNo: batch.planOrder.sourceOrderNo,
      customerName: batch.planOrder.customerName,
      productName: batch.planOrder.productName,
      specification: batch.planOrder.specification,
      priority: batch.planOrder.priority,
      customerDueDate: dueDate,
      daysUntilDue,
      warningLevel,
      batchQuantity: batch.quantity,
      shippedQuantity,
      pendingQuantity,
      completedQuantity,
      productionProgress: workOrderProgress(batch.workOrder, batch.quantity),
      productionStage: batch.workOrder.stage,
      currentProcess: currentProcess(batch.workOrder),
      productionState,
      shipmentState,
      planningState,
      associationType: latestItem?.associationType || null,
      associatedPlanDate,
      associationHealthy: pendingQuantity <= 0
        ? Boolean(latestItem)
        : associatedPlanDate === expectedPlanDate,
    }];
  });
  const groupMeta = [
    { level: 'OVERDUE', label: '已逾期' },
    { level: 'TODAY', label: '今日到期' },
    { level: 'T1', label: '明日到期' },
    { level: 'T2', label: '距交期 2 天' },
    { level: 'T3', label: '距交期 3 天' },
  ] as const;
  const groups = groupMeta.map(meta => {
    const grouped = items.filter(item => item.warningLevel === meta.level);
    return {
      ...meta,
      itemCount: grouped.length,
      pendingQuantity: grouped.reduce((sum, item) => sum + item.pendingQuantity, 0),
      items: grouped,
    };
  });
  const count = (level: typeof groupMeta[number]['level']) => items.filter(item => item.warningLevel === level).length;
  return {
    anchorDate: anchor.key,
    cutoverDate: warningWindow.cutoverApplied ? warningWindow.startKey : null,
    rangeStartDate: warningWindow.startKey,
    rangeEndDate: rangeEndKey,
    generatedAt: now.toISOString(),
    summary: {
      itemCount: items.length,
      pendingQuantity: items.reduce((sum, item) => sum + item.pendingQuantity, 0),
      completedCount: items.filter(item => item.shipmentState === 'SHIPPED').length,
      incompleteCount: items.filter(item => item.shipmentState !== 'SHIPPED').length,
      expectedNotPlannedCount: items.filter(item => item.planningState === 'EXPECTED_NOT_PLANNED').length,
      overdueCount: count('OVERDUE'),
      todayCount: count('TODAY'),
      tomorrowCount: count('T1'),
      twoDaysCount: count('T2'),
      threeDaysCount: count('T3'),
      productionRiskCount: items.filter(item => (
        item.pendingQuantity > 0 && Math.max(0, item.completedQuantity - item.shippedQuantity) < item.pendingQuantity
      )).length,
      readyCount: items.filter(item => (
        item.pendingQuantity <= 0 || Math.max(0, item.completedQuantity - item.shippedQuantity) >= item.pendingQuantity
      )).length,
      associationIssueCount: items.filter(item => !item.associationHealthy).length,
    },
    groups,
    repairSummary,
  };
}

export async function loadShipmentCarryoverOverview(input: { asOfDate: unknown }) {
  const asOf = parseShipmentDate(input.asOfDate);
  const now = new Date();
  const activeItems = await prisma.dailyShipmentPlanItem.findMany({
    where: {
      associationType: DailyShipmentAssociationType.CARRYOVER,
      status: { in: [DailyShipmentItemStatus.PLANNED, DailyShipmentItemStatus.PARTIALLY_SHIPPED] },
      plan: { shipDate: { lte: asOf.value } },
    },
    include: itemInclude,
    orderBy: [{ carryoverDayCount: 'desc' }, { plannedShipAt: 'asc' }, { createdAt: 'asc' }],
    take: 1000,
  });
  const batchIds = [...new Set(activeItems.map(item => item.productionPlanBatchId))];
  const historyItems = batchIds.length ? await prisma.dailyShipmentPlanItem.findMany({
    where: { productionPlanBatchId: { in: batchIds } },
    select: {
      id: true,
      productionPlanBatchId: true,
      plannedQuantity: true,
      status: true,
      plan: { select: { shipDate: true } },
      events: { select: { eventType: true, quantity: true } },
    },
    orderBy: [{ plannedShipAt: 'asc' }, { createdAt: 'asc' }],
  }) : [];
  const items = activeItems.map(item => ({
    item: serializeItem(item, now),
    originalDueDate: item.dueDateSnapshot
      ? dateKey(item.dueDateSnapshot)
      : dateKey(item.productionPlanBatch.planOrder.customerDueDate),
    currentPlanDate: dateKey(item.plan.shipDate),
    lineage: historyItems
      .filter(history => history.productionPlanBatchId === item.productionPlanBatchId)
      .map(history => {
        const shippedQuantity = netShipmentQuantity(history.events);
        return {
          date: dateKey(history.plan.shipDate),
          plannedQuantity: history.plannedQuantity,
          shippedQuantity,
          pendingQuantity: Math.max(0, history.plannedQuantity - shippedQuantity),
          status: history.status,
        };
      }),
  }));
  return {
    asOfDate: asOf.key,
    generatedAt: now.toISOString(),
    summary: {
      itemCount: items.length,
      pendingQuantity: items.reduce((sum, entry) => sum + entry.item.pendingQuantity, 0),
      oneDayCount: items.filter(entry => entry.item.carryoverDayCount === 1).length,
      twoDayCount: items.filter(entry => entry.item.carryoverDayCount === 2).length,
      threePlusDayCount: items.filter(entry => entry.item.carryoverDayCount >= 3).length,
      readyCount: items.filter(entry => entry.item.completedQuantity >= entry.item.pendingQuantity).length,
      productionRiskCount: items.filter(entry => entry.item.completedQuantity < entry.item.pendingQuantity).length,
      maxDayCount: items.reduce((maximum, entry) => Math.max(maximum, entry.item.carryoverDayCount), 0),
    },
    items,
  };
}

export async function loadShipmentHistoryOverview(input: { from: unknown; to: unknown }) {
  const from = parseShipmentDate(input.from);
  const to = parseShipmentDate(input.to);
  if (from.key > to.key) {
    throw new DailyShipmentServiceError('出货历史的开始日期不能晚于结束日期', 'SHIPMENT_HISTORY_RANGE_INVALID');
  }
  const toExclusive = parseShipmentDate(shiftShipmentDateKey(to.key, 1));
  const events = await prisma.shipmentEvent.findMany({
    where: {
      shippedAt: {
        gte: new Date(`${from.key}T00:00:00+08:00`),
        lt: new Date(`${toExclusive.key}T00:00:00+08:00`),
      },
    },
    include: {
      actor: { select: actorSelect },
      item: {
        include: {
          plan: { select: { shipDate: true } },
          productionPlanBatch: { include: { planOrder: true } },
          workOrder: { select: { id: true, code: true, businessCode: true } },
        },
      },
    },
    orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 2000,
  });
  const serialized = events.map(event => ({
    id: event.id,
    eventType: event.eventType,
    quantity: event.quantity,
    netQuantity: event.eventType === ShipmentEventType.REVERSAL ? -event.quantity : event.quantity,
    shippedAt: event.shippedAt.toISOString(),
    reason: event.reason,
    actor: { id: event.actor.id, name: event.actor.displayName || event.actor.username },
    itemId: event.itemId,
    workOrderCode: event.item.workOrder.businessCode || event.item.workOrder.code,
    sourceOrderNo: event.item.productionPlanBatch.planOrder.sourceOrderNo,
    customerName: event.item.productionPlanBatch.planOrder.customerName,
    productName: event.item.productionPlanBatch.planOrder.productName,
    specification: event.item.productionPlanBatch.planOrder.specification,
    planShipDate: dateKey(event.item.plan.shipDate),
    customerDueDate: event.item.dueDateSnapshot
      ? dateKey(event.item.dueDateSnapshot)
      : dateKey(event.item.productionPlanBatch.planOrder.customerDueDate),
  }));
  const shipments = serialized.filter(event => event.eventType === ShipmentEventType.SHIPMENT);
  const reversals = serialized.filter(event => event.eventType === ShipmentEventType.REVERSAL);
  const shippedQuantity = shipments.reduce((sum, event) => sum + event.quantity, 0);
  const reversedQuantity = reversals.reduce((sum, event) => sum + event.quantity, 0);
  return {
    from: from.key,
    to: to.key,
    generatedAt: new Date().toISOString(),
    summary: {
      eventCount: serialized.length,
      shipmentCount: shipments.length,
      shippedQuantity,
      reversalCount: reversals.length,
      reversedQuantity,
      netQuantity: Math.max(0, shippedQuantity - reversedQuantity),
    },
    events: serialized,
  };
}

export async function addDailyShipmentItems(input: {
  actorUserId: string;
  shipDate: unknown;
  idempotencyKey: unknown;
  items: Array<{
    productionPlanBatchId: unknown;
    plannedQuantity: unknown;
    plannedShipAt: unknown;
    shipmentPriority?: unknown;
    note?: unknown;
  }>;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const parsedDate = parseShipmentDate(input.shipDate);
  const selectedWeek = shipmentWeek(parsedDate.key);
  if (isCurrentProductionCarryoverTarget(selectedWeek.startDate)) {
    await reconcileCurrentProductionCarryovers({ targetWeekStart: selectedWeek.startDate, actorId });
  }
  const key = idempotencyKey(input.idempotencyKey);
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DailyShipmentServiceError('请至少选择一个本周订单', 'SHIPMENT_ITEMS_REQUIRED');
  }
  const normalizedItems = input.items.map(item => ({
    productionPlanBatchId: requiredText(item.productionPlanBatchId, '生产批次'),
    plannedQuantity: positiveShipmentQuantity(item.plannedQuantity, '计划出货数量'),
    plannedShipAt: parsePlannedShipmentTime(item.plannedShipAt, parsedDate.key),
    shipmentPriority: shipmentPriority(item.shipmentPriority ?? 'NORMAL'),
    note: shipmentNote(item.note),
  }));
  const batchIds = normalizedItems.map(item => item.productionPlanBatchId);
  if (new Set(batchIds).size !== batchIds.length) {
    throw new DailyShipmentServiceError('同一批次不能重复添加', 'SHIPMENT_BATCH_DUPLICATE');
  }
  const payload = {
    shipDate: parsedDate.key,
    items: normalizedItems.map(item => ({ ...item, plannedShipAt: item.plannedShipAt.toISOString() })),
  };
  const payloadHash = stableHash(payload);
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'ADD_ITEMS' });
    if (replay) return replay;
    for (const batchId of [...batchIds].sort()) await lock(tx, `daily-shipment-batch:${batchId}`);
    await lock(tx, `daily-shipment-plan:${parsedDate.key}`);

    let plan = await tx.dailyShipmentPlan.findUnique({ where: { shipDate: parsedDate.value } });
    if (plan && !isOpenShipmentPlanStatus(plan.status)) {
      throw new DailyShipmentServiceError('该日出货计划已关闭，不能继续补单', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (!plan) {
      plan = await tx.dailyShipmentPlan.create({
        data: {
          shipDate: parsedDate.value,
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actorId,
          createdById: actorId,
          updatedById: actorId,
        },
      });
    } else if (plan.status === DailyShipmentPlanStatus.DRAFT) {
      plan = await tx.dailyShipmentPlan.update({
        where: { id: plan.id },
        data: {
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: plan.confirmedAt || new Date(),
          confirmedById: plan.confirmedById || actorId,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
    }

    const batchWindow = productionBatchWeekStartWindow(parsedDate.key);
    const batches = await tx.productionPlanBatch.findMany({
      where: {
        id: { in: batchIds },
        deletedAt: null,
        workOrderId: { not: null },
        OR: [
          { releaseState: { in: ['active', 'preparation'] }, weekStartDate: { gte: batchWindow.gte, lt: batchWindow.lt } },
          activeProductionCarryoverBatchWhere(selectedWeek.startDate),
        ],
        planOrder: { deletedAt: null },
        workOrder: { is: { deletedAt: null } },
      },
      include: batchInclude,
    });
    if (batches.length !== batchIds.length) {
      throw new DailyShipmentServiceError(
        '所选订单不属于当前周、尚未下达生产或已失效，请刷新订单列表',
        'SHIPMENT_BATCH_NOT_FOUND',
        404,
      );
    }
    for (const batch of batches) {
      if (!batch.planOrder.customerDueDateConfirmed) {
        throw new DailyShipmentServiceError(
          `${batch.planOrder.sourceOrderNo} 尚未确认客户交期，不能加入日出货计划`,
          'SHIPMENT_DUE_DATE_UNCONFIRMED',
          409,
        );
      }
      const dueDate = dateKey(batch.planOrder.customerDueDate);
      if (dueDate !== parsedDate.key) {
        throw new DailyShipmentServiceError(
          `${batch.planOrder.sourceOrderNo} 的客户交期为 ${dueDate}，只能归入该日出货计划`,
          'SHIPMENT_DUE_DATE_MISMATCH',
          409,
        );
      }
    }
    const batchMap = new Map(batches.map(batch => [batch.id, batch]));
    const existing = await tx.dailyShipmentPlanItem.findMany({
      where: { productionPlanBatchId: { in: batchIds } },
      select: {
        id: true,
        planId: true,
        productionPlanBatchId: true,
        plannedQuantity: true,
        status: true,
        events: { select: { eventType: true, quantity: true } },
      },
    });
    const currentSortOrder = await tx.dailyShipmentPlanItem.aggregate({
      where: { planId: plan.id },
      _max: { sortOrder: true },
    });
    const sortOrderBase = (currentSortOrder._max.sortOrder ?? -1) + 1;
    const createdIds: string[] = [];
    for (let index = 0; index < normalizedItems.length; index += 1) {
      const itemInput = normalizedItems[index];
      const batch = batchMap.get(itemInput.productionPlanBatchId)!;
      const sameDay = existing.find(item => (
        item.planId === plan!.id && item.productionPlanBatchId === itemInput.productionPlanBatchId
      ));
      if (sameDay && sameDay.status !== DailyShipmentItemStatus.CANCELLED) {
        throw new DailyShipmentServiceError(
          `${batch.planOrder.sourceOrderNo} 已在当天计划中`,
          'SHIPMENT_ITEM_DUPLICATE',
          409,
        );
      }
      const otherOpenItem = existing.find(item => (
        item.planId !== plan!.id
        && item.productionPlanBatchId === itemInput.productionPlanBatchId
        && item.status !== DailyShipmentItemStatus.CANCELLED
        && item.status !== DailyShipmentItemStatus.CARRIED_OVER
        && shipmentReservationQuantity(item) > 0
      ));
      if (otherOpenItem) {
        throw new DailyShipmentServiceError(
          `${batch.planOrder.sourceOrderNo} 已有有效出货安排，请先刷新或通过交期变更同步`,
          'SHIPMENT_BATCH_ALREADY_SCHEDULED',
          409,
        );
      }
      const alreadyScheduledQuantity = existing
        .filter(item => (
          item.productionPlanBatchId === itemInput.productionPlanBatchId
          && item.status !== DailyShipmentItemStatus.CANCELLED
          && item.id !== sameDay?.id
        ))
        .reduce((total, item) => total + shipmentReservationQuantity(item), 0);
      assertScheduledQuantity({
        batchQuantity: batch.quantity,
        alreadyScheduledQuantity,
        requestedQuantity: itemInput.plannedQuantity,
      });
      const sourceSnapshot = {
        sourceOrderNo: batch.planOrder.sourceOrderNo,
        sourceLineNo: batch.planOrder.sourceLineNo,
        customerName: batch.planOrder.customerName,
        salesperson: batch.planOrder.salesperson,
        productName: batch.planOrder.productName,
        specification: batch.planOrder.specification,
        batchNo: batch.batchNo,
        batchQuantity: batch.quantity,
        weekStartDate: dateKey(batch.weekStartDate),
        weekEndDate: dateKey(batch.weekEndDate),
        workOrderCode: batch.workOrder!.businessCode || batch.workOrder!.code,
      };
      if (sameDay) {
        const revived = await tx.dailyShipmentPlanItem.update({
          where: { id: sameDay.id },
          data: {
            workOrderId: batch.workOrderId!,
            plannedQuantity: itemInput.plannedQuantity,
            plannedShipAt: itemInput.plannedShipAt,
            note: itemInput.note,
            status: DailyShipmentItemStatus.PLANNED,
            shipmentPriority: itemInput.shipmentPriority,
            associationType: DailyShipmentAssociationType.MANUAL,
            associationKey: `daily-shipment-open:${batch.id}`,
            dueDateSnapshot: parsedDate.value,
            deliveryVersionSnapshot: batch.planOrder.deliveryVersion,
            sortOrder: sortOrderBase + index,
            sourceSnapshot: jsonValue(sourceSnapshot),
            version: { increment: 1 },
            updatedById: actorId,
          },
        });
        createdIds.push(revived.id);
      } else {
        const created = await tx.dailyShipmentPlanItem.create({
          data: {
            planId: plan.id,
            productionPlanBatchId: batch.id,
            workOrderId: batch.workOrderId!,
            plannedQuantity: itemInput.plannedQuantity,
            plannedShipAt: itemInput.plannedShipAt,
            shipmentPriority: itemInput.shipmentPriority,
            associationType: DailyShipmentAssociationType.MANUAL,
            associationKey: `daily-shipment-open:${batch.id}`,
            dueDateSnapshot: parsedDate.value,
            deliveryVersionSnapshot: batch.planOrder.deliveryVersion,
            note: itemInput.note,
            sortOrder: sortOrderBase + index,
            sourceSnapshot: jsonValue(sourceSnapshot),
            createdById: actorId,
            updatedById: actorId,
          },
        });
        createdIds.push(created.id);
      }
    }
    await tx.dailyShipmentPlan.update({
      where: { id: plan.id },
      data: { version: { increment: 1 }, updatedById: actorId },
    });
    await writeRevision(tx, {
      planId: plan.id,
      action: 'ADD_ITEMS',
      idempotencyKey: key,
      payloadHash,
      after: { itemIds: createdIds, shipDate: parsedDate.key },
      actorId,
    });
    return { planId: plan.id, replayed: false };
  });
}

async function loadMutableItem(tx: TransactionClient, itemId: string) {
  const item = await tx.dailyShipmentPlanItem.findUnique({
    where: { id: itemId },
    include: {
      plan: true,
      productionPlanBatch: { include: { planOrder: true } },
      workOrder: { select: workOrderSelect },
      events: { select: { id: true, eventType: true, quantity: true, reversalOfEventId: true } },
    },
  });
  if (!item) throw new DailyShipmentServiceError('出货计划项不存在', 'SHIPMENT_ITEM_NOT_FOUND', 404);
  return item;
}

export async function updateDailyShipmentItem(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
  plannedQuantity: unknown;
  plannedShipAt: unknown;
  shipmentPriority?: unknown;
  note?: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '计划项');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const quantity = positiveShipmentQuantity(input.plannedQuantity, '计划出货数量');
  const requestedPriority = input.shipmentPriority === undefined
    ? null
    : shipmentPriority(input.shipmentPriority);
  const key = idempotencyKey(input.idempotencyKey);
  const payload = {
    itemId,
    version,
    quantity,
    plannedShipAt: input.plannedShipAt,
    shipmentPriority: requestedPriority,
    note: shipmentNote(input.note),
  };
  const payloadHash = stableHash(payload);
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'UPDATE_ITEM' });
    if (replay) return replay;
    const item = await loadMutableItem(tx, itemId);
    await lock(tx, `daily-shipment-batch:${item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(item.plan.shipDate)}`);
    if (item.plan.status !== DailyShipmentPlanStatus.DRAFT) {
      throw new DailyShipmentServiceError('该日计划已确认，不能修改订单', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    const plannedShipAt = parsePlannedShipmentTime(input.plannedShipAt, dateKey(item.plan.shipDate));
    const scheduledItems = await tx.dailyShipmentPlanItem.findMany({
      where: {
        productionPlanBatchId: item.productionPlanBatchId,
        status: { not: DailyShipmentItemStatus.CANCELLED },
        id: { not: item.id },
      },
      select: {
        status: true,
        plannedQuantity: true,
        events: { select: { eventType: true, quantity: true } },
      },
    });
    assertScheduledQuantity({
      batchQuantity: item.productionPlanBatch.quantity,
      alreadyScheduledQuantity: scheduledItems.reduce(
        (total, scheduledItem) => total + shipmentReservationQuantity(scheduledItem),
        0,
      ),
      requestedQuantity: quantity,
    });
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        plannedQuantity: quantity,
        plannedShipAt,
        shipmentPriority: requestedPriority ?? item.shipmentPriority,
        note: shipmentNote(input.note),
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('计划项已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    await tx.dailyShipmentPlan.update({
      where: { id: item.planId },
      data: { version: { increment: 1 }, updatedById: actorId },
    });
    await writeRevision(tx, {
      planId: item.planId,
      itemId: item.id,
      action: 'UPDATE_ITEM',
      idempotencyKey: key,
      payloadHash,
      before: {
        plannedQuantity: item.plannedQuantity,
        plannedShipAt: item.plannedShipAt,
        shipmentPriority: item.shipmentPriority,
        note: item.note,
      },
      after: {
        plannedQuantity: quantity,
        plannedShipAt,
        shipmentPriority: requestedPriority ?? item.shipmentPriority,
        note: shipmentNote(input.note),
      },
      actorId,
    });
    return { planId: item.planId, replayed: false };
  });
}

/**
 * Updates only the collaboration marker. Unlike structural plan editing, this
 * remains available after confirmation because it does not alter quantities,
 * dates, shipment evidence, or production state.
 */
export async function setDailyShipmentItemMark(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
  shipmentPriority: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '计划项');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const requestedPriority = shipmentPriority(input.shipmentPriority);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ itemId, version, shipmentPriority: requestedPriority });
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'SET_ITEM_MARK' });
    if (replay) return replay;
    const item = await loadMutableItem(tx, itemId);
    await lock(tx, `daily-shipment-batch:${item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(item.plan.shipDate)}`);
    if (item.plan.status !== DailyShipmentPlanStatus.DRAFT && item.plan.status !== DailyShipmentPlanStatus.CONFIRMED) {
      throw new DailyShipmentServiceError('已关闭的出货计划不能修改协同标注', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (item.status !== DailyShipmentItemStatus.PLANNED && item.status !== DailyShipmentItemStatus.PARTIALLY_SHIPPED) {
      throw new DailyShipmentServiceError('已结束的订单不能修改协同标注', 'SHIPMENT_ITEM_LOCKED', 409);
    }
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        shipmentPriority: requestedPriority,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('标注已被其他人更新，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    await tx.dailyShipmentPlan.update({
      where: { id: item.planId },
      data: { version: { increment: 1 }, updatedById: actorId },
    });
    await writeRevision(tx, {
      planId: item.planId,
      itemId: item.id,
      action: 'SET_ITEM_MARK',
      idempotencyKey: key,
      payloadHash,
      before: { shipmentPriority: item.shipmentPriority },
      after: { shipmentPriority: requestedPriority },
      actorId,
    });
    return { planId: item.planId, replayed: false };
  });
}

export async function cancelDailyShipmentItem(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
  reason: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '计划项');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const reason = requiredText(input.reason, '取消原因', 500);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ itemId, version, reason });
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'CANCEL_ITEM' });
    if (replay) return replay;
    const item = await loadMutableItem(tx, itemId);
    await lock(tx, `daily-shipment-batch:${item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(item.plan.shipDate)}`);
    if (item.plan.status !== DailyShipmentPlanStatus.DRAFT) {
      throw new DailyShipmentServiceError('该日计划已确认，不能取消订单', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (netShipmentQuantity(item.events) > 0) {
      throw new DailyShipmentServiceError('已有实发记录的计划项不能取消', 'SHIPMENT_ITEM_HAS_EVENTS', 409);
    }
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        status: DailyShipmentItemStatus.CANCELLED,
        associationKey: null,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('计划项已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    await tx.dailyShipmentPlan.update({
      where: { id: item.planId },
      data: { version: { increment: 1 }, updatedById: actorId },
    });
    await writeRevision(tx, {
      planId: item.planId,
      itemId: item.id,
      action: 'CANCEL_ITEM',
      idempotencyKey: key,
      payloadHash,
      before: { status: item.status },
      after: { status: DailyShipmentItemStatus.CANCELLED },
      reason,
      actorId,
    });
    return { planId: item.planId, replayed: false };
  });
}

async function settleReservationSourcePlan(
  tx: TransactionClient,
  planId: string,
  actorId: string,
): Promise<DailyShipmentPlanStatus | null> {
  const plan = await tx.dailyShipmentPlan.findUnique({
    where: { id: planId },
    include: { items: { select: { status: true } } },
  });
  if (!plan) throw new DailyShipmentServiceError('原出货计划不存在', 'SHIPMENT_PLAN_NOT_FOUND', 404);
  const operational = plan.items.filter(item => (
    item.status === DailyShipmentItemStatus.PLANNED
    || item.status === DailyShipmentItemStatus.PARTIALLY_SHIPPED
  ));
  if (operational.length > 0) {
    await tx.dailyShipmentPlan.update({
      where: { id: plan.id },
      data: { updatedById: actorId, version: { increment: 1 } },
    });
    return null;
  }

  const retained = plan.items.filter(item => item.status !== DailyShipmentItemStatus.CANCELLED);
  let nextStatus: DailyShipmentPlanStatus | null = null;
  if (retained.length === 0) nextStatus = DailyShipmentPlanStatus.CANCELLED;
  else if (retained.some(item => item.status === DailyShipmentItemStatus.CARRIED_OVER)) {
    nextStatus = DailyShipmentPlanStatus.CLOSED_WITH_CARRYOVER;
  } else if (retained.every(item => item.status === DailyShipmentItemStatus.SHIPPED)) {
    nextStatus = DailyShipmentPlanStatus.CLOSED;
  }
  if (!nextStatus) {
    await tx.dailyShipmentPlan.update({
      where: { id: plan.id },
      data: { updatedById: actorId, version: { increment: 1 } },
    });
    return null;
  }
  await tx.dailyShipmentPlan.update({
    where: { id: plan.id },
    data: {
      status: nextStatus,
      closedAt: new Date(),
      closedById: actorId,
      updatedById: actorId,
      version: { increment: 1 },
    },
  });
  return nextStatus;
}

export async function releaseDailyShipmentReservation(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '占用计划项');
  const version = shipmentVersion(input.itemVersion, '占用计划项版本');
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ itemId, version });
  return serializable(async tx => {
    const replay = await readReplay(tx, {
      idempotencyKey: key,
      payloadHash,
      actorId,
      action: 'RELEASE_RESERVATION',
    });
    if (replay) return replay;
    const item = await loadMutableItem(tx, itemId);
    await lock(tx, `daily-shipment-batch:${item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(item.plan.shipDate)}`);
    if (!isOpenShipmentPlanStatus(item.plan.status)) {
      throw new DailyShipmentServiceError('原计划已关闭，不能直接释放占用', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (item.status !== DailyShipmentItemStatus.PLANNED || netShipmentQuantity(item.events) > 0) {
      throw new DailyShipmentServiceError(
        '该占用已有实发或已进入结转链，请使用“结转到当前日”保留历史流水',
        'SHIPMENT_RESERVATION_HAS_EVENTS',
        409,
      );
    }
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version, status: DailyShipmentItemStatus.PLANNED },
      data: {
        status: DailyShipmentItemStatus.CANCELLED,
        associationKey: null,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('占用计划已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    const settledStatus = await settleReservationSourcePlan(tx, item.planId, actorId);
    await writeRevision(tx, {
      planId: item.planId,
      itemId: item.id,
      action: 'RELEASE_RESERVATION',
      idempotencyKey: key,
      payloadHash,
      before: {
        status: item.status,
        planStatus: item.plan.status,
        reservedQuantity: item.plannedQuantity,
      },
      after: {
        status: DailyShipmentItemStatus.CANCELLED,
        planStatus: settledStatus ?? item.plan.status,
        releasedQuantity: item.plannedQuantity,
      },
      reason: '手动释放历史出货计划占用',
      actorId,
    });
    return { planId: item.planId, replayed: false };
  });
}

export async function transferDailyShipmentReservation(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  targetShipDate: unknown;
  idempotencyKey: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '占用计划项');
  const version = shipmentVersion(input.itemVersion, '占用计划项版本');
  const targetDate = parseShipmentDate(input.targetShipDate);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ itemId, version, targetShipDate: targetDate.key });
  return serializable(async tx => {
    const replay = await readReplay(tx, {
      idempotencyKey: key,
      payloadHash,
      actorId,
      action: 'TRANSFER_RESERVATION',
    });
    if (replay) return replay;
    const sourceItem = await loadMutableItem(tx, itemId);
    const sourceDateKey = dateKey(sourceItem.plan.shipDate);
    if (sourceDateKey >= targetDate.key) {
      throw new DailyShipmentServiceError('只能把较早日期的占用结转到当前选择日', 'SHIPMENT_CARRYOVER_DATE_INVALID');
    }
    await lock(tx, `daily-shipment-batch:${sourceItem.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${sourceDateKey}`);
    await lock(tx, `daily-shipment-plan:${targetDate.key}`);
    if (!isOpenShipmentPlanStatus(sourceItem.plan.status)) {
      throw new DailyShipmentServiceError('原计划已关闭，不能再次结转', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (
      sourceItem.status === DailyShipmentItemStatus.CANCELLED
      || sourceItem.status === DailyShipmentItemStatus.CARRIED_OVER
      || sourceItem.status === DailyShipmentItemStatus.SHIPPED
    ) {
      throw new DailyShipmentServiceError('该占用已经释放、出货或结转，请刷新后重试', 'SHIPMENT_RESERVATION_LOCKED', 409);
    }
    const sourceShippedQuantity = netShipmentQuantity(sourceItem.events);
    const pendingQuantity = Math.max(0, sourceItem.plannedQuantity - sourceShippedQuantity);
    if (pendingQuantity <= 0) {
      throw new DailyShipmentServiceError('该计划项没有可结转数量', 'SHIPMENT_CARRYOVER_EMPTY', 409);
    }

    let targetPlan = await tx.dailyShipmentPlan.findUnique({ where: { shipDate: targetDate.value } });
    if (!targetPlan) {
      targetPlan = await tx.dailyShipmentPlan.create({
        data: {
          shipDate: targetDate.value,
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actorId,
          createdById: actorId,
          updatedById: actorId,
        },
      });
    } else if (targetPlan.status !== DailyShipmentPlanStatus.CONFIRMED) {
      targetPlan = await tx.dailyShipmentPlan.update({
        where: { id: targetPlan.id },
        data: {
          status: DailyShipmentPlanStatus.CONFIRMED,
          confirmedAt: targetPlan.confirmedAt || new Date(),
          confirmedById: targetPlan.confirmedById || actorId,
          closedAt: null,
          closedById: null,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
    }
    const existingTarget = await tx.dailyShipmentPlanItem.findUnique({
      where: {
        planId_productionPlanBatchId: {
          planId: targetPlan.id,
          productionPlanBatchId: sourceItem.productionPlanBatchId,
        },
      },
      include: { events: { select: { eventType: true, quantity: true } } },
    });
    if (existingTarget?.status === DailyShipmentItemStatus.CARRIED_OVER) {
      throw new DailyShipmentServiceError('当前日的同批订单已继续结转，不能合并到旧链路', 'SHIPMENT_CARRYOVER_CONFLICT', 409);
    }

    const otherReservations = await tx.dailyShipmentPlanItem.findMany({
      where: {
        productionPlanBatchId: sourceItem.productionPlanBatchId,
        id: { notIn: [sourceItem.id, ...(existingTarget ? [existingTarget.id] : [])] },
        status: { not: DailyShipmentItemStatus.CANCELLED },
      },
      select: {
        status: true,
        plannedQuantity: true,
        events: { select: { eventType: true, quantity: true } },
      },
    });
    const revivedTarget = existingTarget?.status === DailyShipmentItemStatus.CANCELLED;
    const existingTargetShipped = existingTarget && !revivedTarget
      ? netShipmentQuantity(existingTarget.events)
      : 0;
    const nextTargetQuantity = (existingTarget && !revivedTarget ? existingTarget.plannedQuantity : 0) + pendingQuantity;
    assertScheduledQuantity({
      batchQuantity: sourceItem.productionPlanBatch.quantity,
      alreadyScheduledQuantity: otherReservations.reduce(
        (total, item) => total + shipmentReservationQuantity(item),
        sourceShippedQuantity,
      ),
      requestedQuantity: nextTargetQuantity,
    });

    const dayDelta = Math.max(
      1,
      Math.round((targetDate.value.getTime() - sourceItem.plan.shipDate.getTime()) / 86_400_000),
    );
    const targetShipAt = carryoverPlannedShipAt(sourceItem.plannedShipAt, targetDate.key);
    await tx.dailyShipmentPlanItem.update({
      where: { id: sourceItem.id },
      data: { associationKey: null, updatedById: actorId },
    });
    let targetItemId: string;
    if (existingTarget) {
      const updatedTarget = await tx.dailyShipmentPlanItem.update({
        where: { id: existingTarget.id },
        data: {
          plannedQuantity: nextTargetQuantity,
          plannedShipAt: revivedTarget || targetShipAt < existingTarget.plannedShipAt
            ? targetShipAt
            : existingTarget.plannedShipAt,
          status: shipmentItemStatus(nextTargetQuantity, existingTargetShipped),
          shipmentPriority: moreUrgentPriority(existingTarget.shipmentPriority, sourceItem.shipmentPriority),
          associationType: DailyShipmentAssociationType.CARRYOVER,
          associationKey: `daily-shipment-open:${sourceItem.productionPlanBatchId}`,
          dueDateSnapshot: sourceItem.dueDateSnapshot,
          deliveryVersionSnapshot: sourceItem.deliveryVersionSnapshot,
          ...(!existingTarget.carryoverSourceItemId ? { carryoverSourceItemId: sourceItem.id } : {}),
          carryoverSourceDate: existingTarget.carryoverSourceDate && existingTarget.carryoverSourceDate < sourceItem.plan.shipDate
            ? existingTarget.carryoverSourceDate
            : sourceItem.plan.shipDate,
          carryoverDayCount: Math.max(existingTarget.carryoverDayCount, sourceItem.carryoverDayCount + dayDelta),
          carryoverQuantity: (revivedTarget ? 0 : existingTarget.carryoverQuantity) + pendingQuantity,
          sourceSnapshot: jsonValue(sourceItem.sourceSnapshot),
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      targetItemId = updatedTarget.id;
    } else {
      const currentSort = await tx.dailyShipmentPlanItem.aggregate({
        where: { planId: targetPlan.id },
        _max: { sortOrder: true },
      });
      const createdTarget = await tx.dailyShipmentPlanItem.create({
        data: {
          planId: targetPlan.id,
          productionPlanBatchId: sourceItem.productionPlanBatchId,
          workOrderId: sourceItem.workOrderId,
          plannedQuantity: pendingQuantity,
          plannedShipAt: targetShipAt,
          status: DailyShipmentItemStatus.PLANNED,
          shipmentPriority: sourceItem.shipmentPriority,
          associationType: DailyShipmentAssociationType.CARRYOVER,
          associationKey: `daily-shipment-open:${sourceItem.productionPlanBatchId}`,
          dueDateSnapshot: sourceItem.dueDateSnapshot,
          deliveryVersionSnapshot: sourceItem.deliveryVersionSnapshot,
          sortOrder: (currentSort._max.sortOrder ?? -1) + 1,
          note: sourceItem.note,
          sourceSnapshot: jsonValue(sourceItem.sourceSnapshot),
          carryoverSourceItemId: sourceItem.id,
          carryoverSourceDate: sourceItem.plan.shipDate,
          carryoverDayCount: sourceItem.carryoverDayCount + dayDelta,
          carryoverQuantity: pendingQuantity,
          createdById: actorId,
          updatedById: actorId,
        },
      });
      targetItemId = createdTarget.id;
    }

    const sourceNextStatus = sourceItem.plan.status === DailyShipmentPlanStatus.DRAFT
      ? DailyShipmentItemStatus.CANCELLED
      : DailyShipmentItemStatus.CARRIED_OVER;
    const sourceChanged = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: sourceItem.id, version },
      data: {
        status: sourceNextStatus,
        associationKey: null,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (sourceChanged.count !== 1) {
      throw new DailyShipmentServiceError('占用计划已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    const settledStatus = await settleReservationSourcePlan(tx, sourceItem.planId, actorId);
    await tx.dailyShipmentPlan.update({
      where: { id: targetPlan.id },
      data: { updatedById: actorId, version: { increment: 1 } },
    });
    const revisionPayload = {
      sourcePlanId: sourceItem.planId,
      sourceItemId: sourceItem.id,
      sourceDate: sourceDateKey,
      targetPlanId: targetPlan.id,
      targetItemId,
      targetDate: targetDate.key,
      quantity: pendingQuantity,
      sourceStatus: sourceNextStatus,
    };
    await writeRevision(tx, {
      planId: sourceItem.planId,
      itemId: sourceItem.id,
      action: 'TRANSFER_RESERVATION_SOURCE',
      idempotencyKey: `${key}:source`,
      payloadHash,
      before: {
        status: sourceItem.status,
        planStatus: sourceItem.plan.status,
        plannedQuantity: sourceItem.plannedQuantity,
        shippedQuantity: sourceShippedQuantity,
      },
      after: { ...revisionPayload, planStatus: settledStatus ?? sourceItem.plan.status },
      reason: `手动结转到 ${targetDate.key}`,
      actorId,
    });
    await writeRevision(tx, {
      planId: targetPlan.id,
      itemId: targetItemId,
      action: 'TRANSFER_RESERVATION',
      idempotencyKey: key,
      payloadHash,
      after: revisionPayload,
      reason: `接收 ${sourceDateKey} 历史占用`,
      actorId,
    });
    return { planId: targetPlan.id, replayed: false };
  });
}

async function changePlanState(input: {
  actorUserId: string;
  planId: unknown;
  planVersion: unknown;
  idempotencyKey: unknown;
  action: 'CONFIRM_PLAN' | 'CLOSE_PLAN';
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const planId = requiredText(input.planId, '出货计划');
  const version = shipmentVersion(input.planVersion, '计划版本');
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ planId, version, action: input.action });
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: input.action });
    if (replay) return replay;
    const plan = await tx.dailyShipmentPlan.findUnique({
      where: { id: planId },
      include: {
        items: {
          where: { status: { not: DailyShipmentItemStatus.CANCELLED } },
          include: { events: { select: { eventType: true, quantity: true } } },
        },
      },
    });
    if (!plan) throw new DailyShipmentServiceError('出货计划不存在', 'SHIPMENT_PLAN_NOT_FOUND', 404);
    await lock(tx, `daily-shipment-plan:${dateKey(plan.shipDate)}`);
    if (input.action === 'CONFIRM_PLAN') {
      if (plan.status !== DailyShipmentPlanStatus.DRAFT) {
        throw new DailyShipmentServiceError('只有草稿计划可以确认', 'SHIPMENT_PLAN_LOCKED', 409);
      }
      if (plan.items.length === 0) {
        throw new DailyShipmentServiceError('空计划不能确认', 'SHIPMENT_PLAN_EMPTY');
      }
    } else {
      if (plan.status !== DailyShipmentPlanStatus.CONFIRMED) {
        throw new DailyShipmentServiceError('只有已确认计划可以关闭', 'SHIPMENT_PLAN_LOCKED', 409);
      }
      if (plan.items.length === 0 || plan.items.some(item => netShipmentQuantity(item.events) < item.plannedQuantity)) {
        throw new DailyShipmentServiceError('仍有订单未完成出货，不能关闭计划', 'SHIPMENT_PLAN_UNFINISHED', 409);
      }
    }
    const nextStatus = input.action === 'CONFIRM_PLAN'
      ? DailyShipmentPlanStatus.CONFIRMED
      : DailyShipmentPlanStatus.CLOSED;
    const changed = await tx.dailyShipmentPlan.updateMany({
      where: { id: plan.id, version },
      data: {
        status: nextStatus,
        version: { increment: 1 },
        updatedById: actorId,
        ...(input.action === 'CONFIRM_PLAN'
          ? { confirmedAt: new Date(), confirmedById: actorId }
          : { closedAt: new Date(), closedById: actorId }),
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('计划已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    await writeRevision(tx, {
      planId: plan.id,
      action: input.action,
      idempotencyKey: key,
      payloadHash,
      before: { status: plan.status, version: plan.version },
      after: { status: nextStatus, version: version + 1 },
      actorId,
    });
    return { planId: plan.id, replayed: false };
  });
}

export function confirmDailyShipmentPlan(input: Omit<Parameters<typeof changePlanState>[0], 'action'>) {
  return changePlanState({ ...input, action: 'CONFIRM_PLAN' });
}

export function closeDailyShipmentPlan(input: Omit<Parameters<typeof changePlanState>[0], 'action'>) {
  return changePlanState({ ...input, action: 'CLOSE_PLAN' });
}

export async function rollOverDailyShipmentPlan(input: {
  actorUserId: string;
  planId: unknown;
  planVersion: unknown;
}): Promise<MutationResult> {
  const planId = requiredText(input.planId, '出货计划');
  const planVersion = shipmentVersion(input.planVersion, '计划版本');
  const sourcePlan = await prisma.dailyShipmentPlan.findUnique({
    where: { id: planId },
    select: { shipDate: true },
  });
  if (!sourcePlan) {
    throw new DailyShipmentServiceError('出货计划不存在', 'SHIPMENT_PLAN_NOT_FOUND', 404);
  }
  const result = await reconcileDailyShipmentCarryover({
    targetShipDate: shiftShipmentDateKey(dateKey(sourcePlan.shipDate), 1),
    actorUserId: input.actorUserId,
    sourcePlanId: planId,
    sourcePlanVersion: planVersion,
    strict: true,
  });
  return { planId: result.targetPlanId || planId, replayed: false };
}

export async function recordDailyShipment(input: {
  actorUserId: string;
  itemId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
  quantity: unknown;
  shippedAt?: unknown;
  note?: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '计划项');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const quantity = positiveShipmentQuantity(input.quantity, '实际出货数量');
  const shippedAt = parseShipmentEventTime(input.shippedAt);
  const note = shipmentNote(input.note);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ itemId, version, quantity, shippedAt: shippedAt.toISOString(), note });
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'RECORD_SHIPMENT' });
    if (replay) return replay;
    const item = await loadMutableItem(tx, itemId);
    await lock(tx, `daily-shipment-batch:${item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(item.plan.shipDate)}`);
    if (item.plan.status !== DailyShipmentPlanStatus.CONFIRMED) {
      throw new DailyShipmentServiceError('计划确认后才能登记实发', 'SHIPMENT_PLAN_NOT_CONFIRMED', 409);
    }
    if (item.status === DailyShipmentItemStatus.CANCELLED) {
      throw new DailyShipmentServiceError('已取消的计划项不能登记实发', 'SHIPMENT_ITEM_CANCELLED', 409);
    }
    const batchEvents = await tx.shipmentEvent.findMany({
      where: { item: { productionPlanBatchId: item.productionPlanBatchId } },
      select: { eventType: true, quantity: true },
    });
    const itemShippedQuantity = netShipmentQuantity(item.events);
    const batchShippedQuantity = netShipmentQuantity(batchEvents);
    const batchCompletedQuantity = completedGoodQuantity(item.workOrder);
    assertRecordableShipment({
      plannedQuantity: item.plannedQuantity,
      itemShippedQuantity,
      batchCompletedQuantity,
      batchShippedQuantity,
      requestedQuantity: quantity,
    });
    const event = await tx.shipmentEvent.create({
      data: {
        itemId: item.id,
        eventType: ShipmentEventType.SHIPMENT,
        quantity,
        shippedAt,
        reason: note,
        idempotencyKey: key,
        actorId,
      },
    });
    const nextShippedQuantity = itemShippedQuantity + quantity;
    const nextStatus = shipmentItemStatus(item.plannedQuantity, nextShippedQuantity);
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        status: nextStatus,
        ...(nextStatus === DailyShipmentItemStatus.SHIPPED ? { associationKey: null } : {}),
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('计划项已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    const nextBatchShippedQuantity = batchShippedQuantity + quantity;
    if (nextBatchShippedQuantity >= item.productionPlanBatch.quantity) {
      const shipmentDateKey = chinaDateKey(shippedAt);
      const staleFutureItems = await tx.dailyShipmentPlanItem.findMany({
        where: {
          productionPlanBatchId: item.productionPlanBatchId,
          id: { not: item.id },
          status: { in: [DailyShipmentItemStatus.PLANNED, DailyShipmentItemStatus.PARTIALLY_SHIPPED] },
          plan: { shipDate: { gt: parseShipmentDate(shipmentDateKey).value } },
        },
        include: {
          plan: { select: { id: true, shipDate: true } },
          events: { select: { eventType: true, quantity: true } },
        },
      });
      const touchedPlanIds = new Set<string>();
      for (const staleItem of staleFutureItems) {
        // Never rewrite an item that owns physical shipment evidence. Those
        // records remain visible in history and can only be changed by reversal.
        if (netShipmentQuantity(staleItem.events) > 0) continue;
        await tx.dailyShipmentPlanItem.update({
          where: { id: staleItem.id },
          data: {
            status: DailyShipmentItemStatus.CANCELLED,
            associationKey: null,
            version: { increment: 1 },
            updatedById: actorId,
          },
        });
        touchedPlanIds.add(staleItem.planId);
        await writeRevision(tx, {
          planId: staleItem.planId,
          itemId: staleItem.id,
          action: 'AUTO_CANCEL_AFTER_FULL_SHIPMENT',
          idempotencyKey: `${key}:fully-shipped:${staleItem.id}`,
          payloadHash: stableHash({ itemId: staleItem.id, shipmentDateKey, nextBatchShippedQuantity }),
          before: { status: staleItem.status, planShipDate: dateKey(staleItem.plan.shipDate) },
          after: { status: DailyShipmentItemStatus.CANCELLED, completedOn: shipmentDateKey },
          actorId,
        });
      }
      if (touchedPlanIds.size) {
        await tx.dailyShipmentPlan.updateMany({
          where: { id: { in: [...touchedPlanIds] } },
          data: { version: { increment: 1 }, updatedById: actorId },
        });
      }
    }
    await tx.dailyShipmentPlan.update({
      where: { id: item.planId },
      data: { version: { increment: 1 }, updatedById: actorId },
    });
    await writeRevision(tx, {
      planId: item.planId,
      itemId: item.id,
      action: 'RECORD_SHIPMENT',
      idempotencyKey: key,
      payloadHash,
      before: { shippedQuantity: itemShippedQuantity, status: item.status },
      after: { shippedQuantity: nextShippedQuantity, eventId: event.id },
      actorId,
    });
    return { planId: item.planId, replayed: false };
  });
}

export async function reverseDailyShipment(input: {
  actorUserId: string;
  eventId: unknown;
  itemVersion: unknown;
  idempotencyKey: unknown;
  quantity: unknown;
  reversedAt?: unknown;
  reason: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const eventId = requiredText(input.eventId, '实发记录');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const quantity = positiveShipmentQuantity(input.quantity, '撤销数量');
  const reversedAt = parseShipmentEventTime(input.reversedAt);
  const reason = requiredText(input.reason, '撤销原因', 500);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = stableHash({ eventId, version, quantity, reversedAt: reversedAt.toISOString(), reason });
  return serializable(async tx => {
    const replay = await readReplay(tx, { idempotencyKey: key, payloadHash, actorId, action: 'REVERSE_SHIPMENT' });
    if (replay) return replay;
    const original = await tx.shipmentEvent.findUnique({
      where: { id: eventId },
      include: {
        reversals: { select: { quantity: true } },
        item: { include: { plan: true, events: { select: { eventType: true, quantity: true } } } },
      },
    });
    if (!original || original.eventType !== ShipmentEventType.SHIPMENT) {
      throw new DailyShipmentServiceError('原实发记录不存在', 'SHIPMENT_EVENT_NOT_FOUND', 404);
    }
    if (
      original.item.status === DailyShipmentItemStatus.CARRIED_OVER
      || original.item.plan.status === DailyShipmentPlanStatus.CLOSED_WITH_CARRYOVER
    ) {
      throw new DailyShipmentServiceError(
        '该记录的未出数量已结转到次日计划，不能直接撤销',
        'SHIPMENT_CARRYOVER_REVERSAL_LOCKED',
        409,
      );
    }
    await lock(tx, `daily-shipment-batch:${original.item.productionPlanBatchId}`);
    await lock(tx, `daily-shipment-plan:${dateKey(original.item.plan.shipDate)}`);
    const alreadyReversed = original.reversals.reduce((total, event) => total + event.quantity, 0);
    if (alreadyReversed + quantity > original.quantity) {
      throw new DailyShipmentServiceError('撤销数量超过原实发记录的可撤数量', 'SHIPMENT_REVERSAL_EXCEEDED', 409);
    }
    const currentShippedQuantity = netShipmentQuantity(original.item.events);
    const event = await tx.shipmentEvent.create({
      data: {
        itemId: original.itemId,
        eventType: ShipmentEventType.REVERSAL,
        quantity,
        shippedAt: reversedAt,
        reversalOfEventId: original.id,
        reason,
        idempotencyKey: key,
        actorId,
      },
    });
    const nextShippedQuantity = Math.max(0, currentShippedQuantity - quantity);
    const nextStatus = shipmentItemStatus(original.item.plannedQuantity, nextShippedQuantity);
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: original.itemId, version },
      data: {
        status: nextStatus,
        ...(nextStatus === DailyShipmentItemStatus.SHIPPED
          ? { associationKey: null }
          : { associationKey: `daily-shipment-open:${original.item.productionPlanBatchId}` }),
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw new DailyShipmentServiceError('计划项已被其他人修改，请刷新后重试', 'SHIPMENT_CONCURRENCY_CONFLICT', 409);
    }
    await tx.dailyShipmentPlan.update({
      where: { id: original.item.planId },
      data: {
        status: DailyShipmentPlanStatus.CONFIRMED,
        closedAt: null,
        closedById: null,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    await writeRevision(tx, {
      planId: original.item.planId,
      itemId: original.itemId,
      action: 'REVERSE_SHIPMENT',
      idempotencyKey: key,
      payloadHash,
      before: { shippedQuantity: currentShippedQuantity, planStatus: original.item.plan.status },
      after: { shippedQuantity: nextShippedQuantity, reversalEventId: event.id, planStatus: 'CONFIRMED' },
      reason,
      actorId,
    });
    return { planId: original.item.planId, replayed: false };
  });
}
