import { createHash } from 'node:crypto';
import {
  DailyShipmentItemStatus,
  DailyShipmentPlanStatus,
  Prisma,
  ShipmentEventType,
} from '@prisma/client';
import {
  assertRecordableShipment,
  assertScheduledQuantity,
  completionPercentage,
  DailyShipmentDomainError,
  netShipmentQuantity,
  parsePlannedShipmentTime,
  parseShipmentDate,
  parseShipmentEventTime,
  positiveShipmentQuantity,
  shipmentItemStatus,
  shipmentNote,
  shipmentProgressState,
  shipmentVersion,
  shipmentWeek,
} from '@/lib/daily-shipment-domain';
import { prisma } from '@/lib/prisma';
import { getProductionQuantitySummary } from '@/lib/production-quantity';
import { productionBatchWeekStartWindow } from '@/lib/production-week';
import {
  activeProductionCarryoverBatchWhere,
  isCurrentProductionCarryoverTarget,
  reconcileCurrentProductionCarryovers,
} from '@/lib/production-carryovers';

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
  productionPlanBatch: { include: { planOrder: true } },
  workOrder: { select: workOrderSelect },
  events: {
    include: { actor: { select: actorSelect } },
    orderBy: [{ shippedAt: 'asc' as const }, { createdAt: 'asc' as const }],
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
  if (step) return step.processName;
  if (workOrder.processRoute?.status === 'completed') return '全部工序完成';
  return workOrder.processName || '待生产反馈';
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
    customerDueDate: dateKey(item.productionPlanBatch.planOrder.customerDueDate),
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
      now,
    }),
    note: item.note,
    sortOrder: item.sortOrder,
    events: item.events.map(serializeEvent),
  };
}

export async function loadDailyShipmentWorkbench(input: { shipDate: unknown; actorUserId?: string }) {
  const parsedDate = parseShipmentDate(input.shipDate);
  const week = shipmentWeek(parsedDate.key);
  const batchWeek = productionBatchWeekStartWindow(parsedDate.key);
  const now = new Date();
  if (isCurrentProductionCarryoverTarget(week.startDate) && input.actorUserId) {
    await reconcileCurrentProductionCarryovers({ targetWeekStart: week.startDate, actorId: input.actorUserId });
  }

  const [plan, batches, weekPlans] = await Promise.all([
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
  ]);

  const batchIds = batches.map(batch => batch.id);
  const scheduledItems = batchIds.length
    ? await prisma.dailyShipmentPlanItem.findMany({
        where: {
          productionPlanBatchId: { in: batchIds },
          status: { not: DailyShipmentItemStatus.CANCELLED },
        },
        select: {
          productionPlanBatchId: true,
          plannedQuantity: true,
          plan: { select: { shipDate: true } },
          events: { select: { eventType: true, quantity: true } },
        },
      })
    : [];
  const scheduledByBatch = new Map<string, number>();
  const shippedByBatch = new Map<string, number>();
  const daysByBatch = new Map<string, string[]>();
  for (const item of scheduledItems) {
    scheduledByBatch.set(
      item.productionPlanBatchId,
      (scheduledByBatch.get(item.productionPlanBatchId) || 0) + item.plannedQuantity,
    );
    shippedByBatch.set(
      item.productionPlanBatchId,
      (shippedByBatch.get(item.productionPlanBatchId) || 0) + netShipmentQuantity(item.events),
    );
    const days = daysByBatch.get(item.productionPlanBatchId) || [];
    days.push(dateKey(item.plan.shipDate));
    daysByBatch.set(item.productionPlanBatchId, days);
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
      customerDueDate: dateKey(batch.planOrder.customerDueDate),
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
    };
  });

  const activeItems = plan?.items.filter(item => item.status !== DailyShipmentItemStatus.CANCELLED) || [];
  const serializedItems = activeItems.map(item => serializeItem(item, now));
  const plannedQuantity = serializedItems.reduce((total, item) => total + item.plannedQuantity, 0);
  const shippedQuantity = serializedItems.reduce((total, item) => total + item.shippedQuantity, 0);
  const readyQuantity = serializedItems.reduce((total, item) => {
    const completedAvailable = Math.max(
      0,
      item.completedQuantity - (shippedByBatch.get(item.batchId) || 0),
    );
    return total + Math.min(item.pendingQuantity, completedAvailable);
  }, 0);

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
    summary: {
      itemCount: serializedItems.length,
      plannedQuantity,
      readyQuantity,
      shippedQuantity,
      pendingQuantity: Math.max(0, plannedQuantity - shippedQuantity),
      riskItemCount: serializedItems.filter(item => ['OVERDUE', 'NOT_STARTED'].includes(item.progressState)).length,
    },
    candidates,
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
    if (plan && plan.status !== DailyShipmentPlanStatus.DRAFT) {
      throw new DailyShipmentServiceError('该日计划已确认，不能继续添加订单', 'SHIPMENT_PLAN_LOCKED', 409);
    }
    if (!plan) {
      plan = await tx.dailyShipmentPlan.create({
        data: { shipDate: parsedDate.value, createdById: actorId, updatedById: actorId },
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
    const batchMap = new Map(batches.map(batch => [batch.id, batch]));
    const existing = await tx.dailyShipmentPlanItem.findMany({
      where: { productionPlanBatchId: { in: batchIds } },
      select: { id: true, planId: true, productionPlanBatchId: true, plannedQuantity: true, status: true },
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
      const alreadyScheduledQuantity = existing
        .filter(item => (
          item.productionPlanBatchId === itemInput.productionPlanBatchId
          && item.status !== DailyShipmentItemStatus.CANCELLED
          && item.id !== sameDay?.id
        ))
        .reduce((total, item) => total + item.plannedQuantity, 0);
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
  note?: unknown;
}): Promise<MutationResult> {
  const actorId = requiredText(input.actorUserId, '操作人');
  const itemId = requiredText(input.itemId, '计划项');
  const version = shipmentVersion(input.itemVersion, '计划项版本');
  const quantity = positiveShipmentQuantity(input.plannedQuantity, '计划出货数量');
  const key = idempotencyKey(input.idempotencyKey);
  const payload = { itemId, version, quantity, plannedShipAt: input.plannedShipAt, note: shipmentNote(input.note) };
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
    const scheduled = await tx.dailyShipmentPlanItem.aggregate({
      where: {
        productionPlanBatchId: item.productionPlanBatchId,
        status: { not: DailyShipmentItemStatus.CANCELLED },
        id: { not: item.id },
      },
      _sum: { plannedQuantity: true },
    });
    assertScheduledQuantity({
      batchQuantity: item.productionPlanBatch.quantity,
      alreadyScheduledQuantity: scheduled._sum.plannedQuantity || 0,
      requestedQuantity: quantity,
    });
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        plannedQuantity: quantity,
        plannedShipAt,
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
      before: { plannedQuantity: item.plannedQuantity, plannedShipAt: item.plannedShipAt, note: item.note },
      after: { plannedQuantity: quantity, plannedShipAt, note: shipmentNote(input.note) },
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
      data: { status: DailyShipmentItemStatus.CANCELLED, version: { increment: 1 }, updatedById: actorId },
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
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: item.id, version },
      data: {
        status: shipmentItemStatus(item.plannedQuantity, nextShippedQuantity),
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
    const changed = await tx.dailyShipmentPlanItem.updateMany({
      where: { id: original.itemId, version },
      data: {
        status: shipmentItemStatus(original.item.plannedQuantity, nextShippedQuantity),
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
