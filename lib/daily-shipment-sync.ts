import {
  DailyShipmentAssociationType,
  DailyShipmentItemStatus,
  DailyShipmentPlanStatus,
  DailyShipmentPriority,
  Prisma,
} from '@prisma/client';
import { chinaDateKey } from '@/lib/china-date';
import { parseShipmentDate } from '@/lib/daily-shipment-domain';

type TransactionClient = Prisma.TransactionClient;

export type DailyShipmentSyncReason = 'release' | 'due_date_change' | 'repair';

export type DailyShipmentSyncResult = {
  batchId: string;
  dueDate: string | null;
  planId: string | null;
  itemId: string | null;
  pendingQuantity: number;
  changed: boolean;
  skippedReason: 'batch_missing' | 'not_released' | 'due_date_unconfirmed' | 'actor_missing' | 'fully_shipped' | null;
};

function associationKey(batchId: string): string {
  return `daily-shipment-open:${batchId}`;
}

function shipmentPriority(priority: string): DailyShipmentPriority {
  const normalized = priority.trim().toLowerCase();
  if (normalized === 'urgent' || normalized === 'insert') return DailyShipmentPriority.URGENT;
  if (normalized === 'priority' || normalized === 'high') return DailyShipmentPriority.PRIORITY;
  return DailyShipmentPriority.NORMAL;
}

function netShipmentQuantity(events: Array<{ eventType: string; quantity: number }>): number {
  return Math.max(0, events.reduce((sum, event) => (
    event.eventType === 'REVERSAL' ? sum - event.quantity : sum + event.quantity
  ), 0));
}

function plannedShipAt(date: string): Date {
  return new Date(`${date}T16:00:00+08:00`);
}

async function resolveActorId(tx: TransactionClient, actorId: string | null): Promise<string | null> {
  if (actorId) return actorId;
  const fallback = await tx.user.findFirst({
    where: { isActive: true, accountStatus: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { username: 'asc' }],
    select: { id: true },
  });
  return fallback?.id || null;
}

function snapshot(batch: {
  batchNo: number;
  quantity: number;
  weekStartDate: Date;
  weekEndDate: Date;
  workOrder: { code: string; businessCode: string | null } | null;
  planOrder: {
    sourceOrderNo: string;
    sourceLineNo: number;
    customerName: string;
    salesperson: string | null;
    productName: string;
    specification: string;
    customerDueDate: Date;
    deliveryVersion: number;
  };
}): Prisma.InputJsonValue {
  return {
    sourceOrderNo: batch.planOrder.sourceOrderNo,
    sourceLineNo: batch.planOrder.sourceLineNo,
    customerName: batch.planOrder.customerName,
    salesperson: batch.planOrder.salesperson,
    productName: batch.planOrder.productName,
    specification: batch.planOrder.specification,
    batchNo: batch.batchNo,
    batchQuantity: batch.quantity,
    weekStartDate: chinaDateKey(batch.weekStartDate),
    weekEndDate: chinaDateKey(batch.weekEndDate),
    workOrderCode: batch.workOrder?.businessCode || batch.workOrder?.code || '',
    customerDueDate: chinaDateKey(batch.planOrder.customerDueDate),
    deliveryVersion: batch.planOrder.deliveryVersion,
  };
}

/**
 * Keeps one current, sendable shipment item for a released production batch.
 * The customer due date is the sole initial plan date. Historic shipment events
 * stay on their original items; only the still-pending balance moves after a
 * due-date change.
 */
export async function syncProductionBatchToDueShipmentPlan(
  tx: TransactionClient,
  input: {
    batchId: string;
    actorId: string | null;
    reason: DailyShipmentSyncReason;
    now?: Date;
  },
): Promise<DailyShipmentSyncResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-shipment-batch:${input.batchId}`}))`;
  const batch = await tx.productionPlanBatch.findUnique({
    where: { id: input.batchId },
    include: {
      planOrder: true,
      workOrder: { select: { id: true, code: true, businessCode: true, deletedAt: true } },
    },
  });
  const empty = (skippedReason: DailyShipmentSyncResult['skippedReason']): DailyShipmentSyncResult => ({
    batchId: input.batchId,
    dueDate: batch?.planOrder.customerDueDateConfirmed ? chinaDateKey(batch.planOrder.customerDueDate) : null,
    planId: null,
    itemId: null,
    pendingQuantity: 0,
    changed: false,
    skippedReason,
  });
  if (!batch || batch.deletedAt || batch.planOrder.deletedAt || !batch.workOrderId || batch.workOrder?.deletedAt) {
    return empty('batch_missing');
  }
  if (
    !['active', 'preparation'].includes(batch.releaseState)
    || batch.planOrder.status === 'paused'
    || batch.planOrder.status === 'cancelled'
  ) return empty('not_released');
  if (!batch.planOrder.customerDueDateConfirmed) return empty('due_date_unconfirmed');
  const actorId = await resolveActorId(tx, input.actorId);
  if (!actorId) return empty('actor_missing');

  const dueDate = chinaDateKey(batch.planOrder.customerDueDate);
  const parsedDueDate = parseShipmentDate(dueDate);
  const openKey = associationKey(batch.id);
  const now = input.now || new Date();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-shipment-plan:${dueDate}`}))`;

  const items = await tx.dailyShipmentPlanItem.findMany({
    where: { productionPlanBatchId: batch.id },
    include: {
      plan: { select: { id: true, shipDate: true, status: true } },
      events: { select: { eventType: true, quantity: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const shippedByItem = new Map(items.map(item => [item.id, netShipmentQuantity(item.events)]));
  const totalShipped = items.reduce((sum, item) => sum + (shippedByItem.get(item.id) || 0), 0);
  const pendingQuantity = Math.max(0, batch.quantity - totalShipped);
  // The schema has one item per plan and batch. Reuse a cancelled or formerly
  // carried item when a due date returns to a date that already has history.
  const currentTarget = items.find(item => chinaDateKey(item.plan.shipDate) === dueDate) || null;

  if (pendingQuantity <= 0) {
    await tx.dailyShipmentPlanItem.updateMany({
      where: { productionPlanBatchId: batch.id, associationKey: openKey },
      data: { associationKey: null, updatedById: actorId },
    });
    return { ...empty('fully_shipped'), dueDate, pendingQuantity: 0 };
  }

  let changed = false;
  for (const item of items) {
    if (item.id === currentTarget?.id) continue;
    if (item.status === DailyShipmentItemStatus.CANCELLED || item.status === DailyShipmentItemStatus.CARRIED_OVER) {
      if (item.associationKey) {
        await tx.dailyShipmentPlanItem.update({
          where: { id: item.id },
          data: { associationKey: null, updatedById: actorId },
        });
        changed = true;
      }
      continue;
    }
    const shipped = shippedByItem.get(item.id) || 0;
    await tx.dailyShipmentPlanItem.update({
      where: { id: item.id },
      data: {
        associationKey: null,
        plannedQuantity: Math.max(1, shipped || item.plannedQuantity),
        status: shipped > 0 ? DailyShipmentItemStatus.SHIPPED : DailyShipmentItemStatus.CANCELLED,
        version: { increment: 1 },
        updatedById: actorId,
      },
    });
    changed = true;
  }

  let plan = await tx.dailyShipmentPlan.findUnique({ where: { shipDate: parsedDueDate.value } });
  if (!plan) {
    plan = await tx.dailyShipmentPlan.create({
      data: {
        shipDate: parsedDueDate.value,
        status: DailyShipmentPlanStatus.CONFIRMED,
        confirmedAt: now,
        confirmedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    changed = true;
  } else if (plan.status !== DailyShipmentPlanStatus.CONFIRMED) {
    plan = await tx.dailyShipmentPlan.update({
      where: { id: plan.id },
      data: {
        status: DailyShipmentPlanStatus.CONFIRMED,
        confirmedAt: plan.confirmedAt || now,
        confirmedById: plan.confirmedById || actorId,
        closedAt: null,
        closedById: null,
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    changed = true;
  }

  const targetShipped = currentTarget ? (shippedByItem.get(currentTarget.id) || 0) : 0;
  const nextPlannedQuantity = targetShipped + pendingQuantity;
  const associationType = input.reason === 'due_date_change'
    ? DailyShipmentAssociationType.DUE_DATE_CHANGE
    : DailyShipmentAssociationType.AUTO_DUE_DATE;
  let itemId: string;
  if (currentTarget) {
    const needsUpdate = currentTarget.planId !== plan.id
      || currentTarget.plannedQuantity !== nextPlannedQuantity
      || currentTarget.associationKey !== openKey
      || currentTarget.deliveryVersionSnapshot !== batch.planOrder.deliveryVersion
      || currentTarget.associationType !== associationType;
    if (needsUpdate) {
      await tx.dailyShipmentPlanItem.update({
        where: { id: currentTarget.id },
        data: {
          plannedQuantity: nextPlannedQuantity,
          plannedShipAt: plannedShipAt(dueDate),
          status: targetShipped > 0 ? DailyShipmentItemStatus.PARTIALLY_SHIPPED : DailyShipmentItemStatus.PLANNED,
          shipmentPriority: shipmentPriority(batch.planOrder.priority),
          associationType,
          associationKey: openKey,
          dueDateSnapshot: parsedDueDate.value,
          deliveryVersionSnapshot: batch.planOrder.deliveryVersion,
          sourceSnapshot: snapshot(batch),
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      changed = true;
    }
    itemId = currentTarget.id;
  } else {
    const sort = await tx.dailyShipmentPlanItem.aggregate({
      where: { planId: plan.id },
      _max: { sortOrder: true },
    });
    const created = await tx.dailyShipmentPlanItem.create({
      data: {
        planId: plan.id,
        productionPlanBatchId: batch.id,
        workOrderId: batch.workOrderId,
        plannedQuantity: pendingQuantity,
        plannedShipAt: plannedShipAt(dueDate),
        status: DailyShipmentItemStatus.PLANNED,
        shipmentPriority: shipmentPriority(batch.planOrder.priority),
        associationType,
        associationKey: openKey,
        dueDateSnapshot: parsedDueDate.value,
        deliveryVersionSnapshot: batch.planOrder.deliveryVersion,
        sortOrder: (sort._max.sortOrder ?? -1) + 1,
        sourceSnapshot: snapshot(batch),
        createdById: actorId,
        updatedById: actorId,
      },
    });
    itemId = created.id;
    changed = true;
  }

  if (changed) {
    await tx.dailyShipmentPlan.update({
      where: { id: plan.id },
      data: { updatedById: actorId, version: { increment: 1 } },
    });
    const revisionKey = `daily-shipment-sync:${input.reason}:${batch.id}:${batch.planOrder.deliveryVersion}:${dueDate}`;
    await tx.dailyShipmentRevision.upsert({
      where: { idempotencyKey: revisionKey },
      create: {
        planId: plan.id,
        itemId,
        action: input.reason === 'due_date_change' ? 'SYNC_DUE_DATE_CHANGE' : 'AUTO_LINK_DUE_DATE',
        idempotencyKey: revisionKey,
        payloadHash: revisionKey,
        afterData: {
          batchId: batch.id,
          dueDate,
          deliveryVersion: batch.planOrder.deliveryVersion,
          pendingQuantity,
          associationType,
        },
        actorId,
      },
      update: {},
    });
  }

  return {
    batchId: batch.id,
    dueDate,
    planId: plan.id,
    itemId,
    pendingQuantity,
    changed,
    skippedReason: null,
  };
}

export function assertShipmentDateMatchesConfirmedDueDate(input: {
  requestedShipDate: string;
  customerDueDate: Date;
  customerDueDateConfirmed: boolean;
  sourceOrderNo: string;
}): void {
  if (!input.customerDueDateConfirmed) {
    throw new Error(`SHIPMENT_DUE_DATE_UNCONFIRMED:${input.sourceOrderNo}`);
  }
  const dueDate = chinaDateKey(input.customerDueDate);
  if (dueDate !== input.requestedShipDate) {
    throw new Error(`SHIPMENT_DUE_DATE_MISMATCH:${input.sourceOrderNo}:${dueDate}`);
  }
}
