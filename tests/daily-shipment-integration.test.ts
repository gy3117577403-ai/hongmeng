import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { LaborAccessRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  addDailyShipmentItems,
  closeDailyShipmentPlan,
  DailyShipmentServiceError,
  loadDailyShipmentWorkbench,
  loadShipmentCarryoverOverview,
  loadShipmentHistoryOverview,
  loadShipmentWarningOverview,
  reconcileDailyShipmentCarryover,
  recordDailyShipment,
  releaseDailyShipmentReservation,
  reverseDailyShipment,
  transferDailyShipmentReservation,
} from '../lib/daily-shipment-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

function key(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function cleanup(prefix: string): Promise<void> {
  const plans = await prisma.dailyShipmentPlan.findMany({
    where: { createdBy: { username: { startsWith: prefix } } },
    select: { id: true },
  });
  const planIds = plans.map(item => item.id);
  const items = planIds.length
    ? await prisma.dailyShipmentPlanItem.findMany({ where: { planId: { in: planIds } }, select: { id: true } })
    : [];
  const itemIds = items.map(item => item.id);
  if (planIds.length) await prisma.dailyShipmentRevision.deleteMany({ where: { planId: { in: planIds } } });
  if (itemIds.length) await prisma.shipmentEvent.deleteMany({ where: { itemId: { in: itemIds } } });
  if (itemIds.length) await prisma.dailyShipmentPlanItem.deleteMany({ where: { id: { in: itemIds } } });
  if (planIds.length) await prisma.dailyShipmentPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.productionPlanBatch.deleteMany({ where: { planOrder: { sourceOrderNo: { startsWith: prefix } } } });
  await prisma.productionPlanOrder.deleteMany({ where: { sourceOrderNo: { startsWith: prefix } } });
  await prisma.workOrder.deleteMany({ where: { code: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
}

test('daily shipment stays on the exact due date, enforces completed goods, replays safely, and retains reversal evidence', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `ship-it-${randomUUID().slice(0, 8)}`;
  await cleanup(prefix);
  try {
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-user`,
        passwordHash: 'integration-test-only',
        displayName: 'Shipment Integration',
        laborRole: LaborAccessRole.ADMIN,
      },
    });
    const workOrder = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO`,
        customerName: 'Integration Customer',
        productName: 'Integration Product',
        specification: 'SPEC-IT',
        stage: 'production',
        progress: 83,
        status: 'processing',
        uncompletedQty: '12',
        productionTargetQty: 12,
        completedQty: '10',
        processName: 'Final assembly',
      },
    });
    const planOrder = await prisma.productionPlanOrder.create({
      data: {
        sourceOrderNo: `${prefix}-SO`,
        sourceLineNo: 1,
        customerName: 'Integration Customer',
        salesperson: 'Integration Sales',
        productName: 'Integration Product',
        specification: 'SPEC-IT',
        orderQuantity: 12,
        orderDate: new Date('2020-01-01T04:00:00.000Z'),
        customerDueDate: new Date('2020-01-07T04:00:00.000Z'),
        priority: 'normal',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    const batch = await prisma.productionPlanBatch.create({
      data: {
        planOrderId: planOrder.id,
        batchNo: 1,
        quantity: 12,
        weekStartDate: new Date('2020-01-06T04:00:00.000Z'),
        weekEndDate: new Date('2020-01-12T04:00:00.000Z'),
        plannedCompletionDate: new Date('2020-01-10T04:00:00.000Z'),
        releaseState: 'active',
        workOrderId: workOrder.id,
      },
    });

    const tuesdayKey = key(prefix);
    const tuesday = await addDailyShipmentItems({
      actorUserId: actor.id,
      shipDate: '2020-01-07',
      idempotencyKey: tuesdayKey,
      items: [{
        productionPlanBatchId: batch.id,
        plannedQuantity: 12,
        plannedShipAt: '2020-01-07T16:00',
      }],
    });
    const replay = await addDailyShipmentItems({
      actorUserId: actor.id,
      shipDate: '2020-01-07',
      idempotencyKey: tuesdayKey,
      items: [{
        productionPlanBatchId: batch.id,
        plannedQuantity: 12,
        plannedShipAt: '2020-01-07T16:00',
      }],
    });
    assert.equal(replay.planId, tuesday.planId);
    assert.equal(replay.replayed, true);

    const mondayWorkbench = await loadDailyShipmentWorkbench({ shipDate: '2020-01-06' });
    assert.equal(mondayWorkbench.summary.itemCount, 0);
    const warning = await loadShipmentWarningOverview({ anchorDate: '2020-01-06' });
    const warningItem = warning.groups.flatMap(group => group.items).find(item => item.batchId === batch.id);
    assert.equal(warningItem?.daysUntilDue, 1);
    assert.equal(warningItem?.associatedPlanDate, '2020-01-07');

    await assert.rejects(
      addDailyShipmentItems({
        actorUserId: actor.id,
        shipDate: '2020-01-06',
        idempotencyKey: key(prefix),
        items: [{
          productionPlanBatchId: batch.id,
          plannedQuantity: 1,
          plannedShipAt: '2020-01-06T16:00',
        }],
      }),
      (error: unknown) => error instanceof DailyShipmentServiceError && error.code === 'SHIPMENT_DUE_DATE_MISMATCH',
    );

    let tuesdayPlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: tuesday.planId } });
    assert.equal(tuesdayPlan.status, 'CONFIRMED');
    let tuesdayItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: tuesday.planId } });
    await assert.rejects(
      recordDailyShipment({
        actorUserId: actor.id,
        itemId: tuesdayItem.id,
        itemVersion: tuesdayItem.version,
        idempotencyKey: key(prefix),
        quantity: 11,
        shippedAt: '2020-01-07T09:00:00.000Z',
      }),
      (error: unknown) => error instanceof DailyShipmentServiceError && error.code === 'SHIPMENT_COMPLETED_QUANTITY_EXCEEDED',
    );
    tuesdayItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: tuesdayItem.id } });
    await recordDailyShipment({
      actorUserId: actor.id,
      itemId: tuesdayItem.id,
      itemVersion: tuesdayItem.version,
      idempotencyKey: key(prefix),
      quantity: 4,
      shippedAt: '2020-01-07T09:05:00.000Z',
    });
    tuesdayItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: tuesdayItem.id } });
    const original = await prisma.shipmentEvent.findFirstOrThrow({
      where: { itemId: tuesdayItem.id, eventType: 'SHIPMENT' },
    });
    await reverseDailyShipment({
      actorUserId: actor.id,
      eventId: original.id,
      itemVersion: tuesdayItem.version,
      idempotencyKey: key(prefix),
      quantity: 2,
      reversedAt: '2020-01-07T09:10:00.000Z',
      reason: 'Integration reversal evidence',
    });
    tuesdayItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: tuesdayItem.id } });
    await prisma.workOrder.update({
      where: { id: workOrder.id },
      data: { completedQty: '12', progress: 100, stage: 'completed' },
    });
    await recordDailyShipment({
      actorUserId: actor.id,
      itemId: tuesdayItem.id,
      itemVersion: tuesdayItem.version,
      idempotencyKey: key(prefix),
      quantity: 10,
      shippedAt: '2020-01-07T09:15:00.000Z',
    });
    tuesdayPlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: tuesday.planId } });
    await closeDailyShipmentPlan({
      actorUserId: actor.id,
      planId: tuesday.planId,
      planVersion: tuesdayPlan.version,
      idempotencyKey: key(prefix),
    });

    const closedWorkbench = await loadDailyShipmentWorkbench({ shipDate: '2020-01-07' });
    assert.equal(closedWorkbench.plan?.status, 'CLOSED');
    assert.equal(closedWorkbench.summary.plannedQuantity, 12);
    assert.equal(closedWorkbench.summary.shippedQuantity, 12);
    assert.equal(closedWorkbench.summary.readyQuantity, 0);
    assert.equal(closedWorkbench.plan?.items[0]?.events.length, 3);
    assert.deepEqual(closedWorkbench.week.days.map(day => day.itemCount), [0, 1, 0, 0, 0, 0, 0]);

    tuesdayItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: tuesdayItem.id } });
    const secondShipment = await prisma.shipmentEvent.findFirstOrThrow({
      where: { itemId: tuesdayItem.id, eventType: 'SHIPMENT', id: { not: original.id } },
    });
    await reverseDailyShipment({
      actorUserId: actor.id,
      eventId: secondShipment.id,
      itemVersion: tuesdayItem.version,
      idempotencyKey: key(prefix),
      quantity: 10,
      reversedAt: '2020-01-07T09:20:00.000Z',
      reason: 'Reverse the later shipment completely',
    });
    tuesdayItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: tuesdayItem.id } });
    await reverseDailyShipment({
      actorUserId: actor.id,
      eventId: original.id,
      itemVersion: tuesdayItem.version,
      idempotencyKey: key(prefix),
      quantity: 2,
      reversedAt: '2020-01-07T09:25:00.000Z',
      reason: 'Reverse the remaining original shipment',
    });

    const reopenedWorkbench = await loadDailyShipmentWorkbench({ shipDate: '2020-01-07' });
    assert.equal(reopenedWorkbench.plan?.status, 'CONFIRMED');
    assert.equal(reopenedWorkbench.summary.shippedQuantity, 0);
    assert.equal(reopenedWorkbench.summary.readyQuantity, 12);
    assert.equal(reopenedWorkbench.plan?.items[0]?.actualShipAt, null);
    assert.equal(reopenedWorkbench.plan?.items[0]?.events.length, 5);
    const history = await loadShipmentHistoryOverview({ from: '2020-01-07', to: '2020-01-07' });
    const ownHistory = history.events.filter(event => event.workOrderCode === `${prefix}-WO`);
    assert.equal(ownHistory.length, 5);
    assert.equal(ownHistory.reduce((sum, event) => sum + event.netQuantity, 0), 0);
  } finally {
    await cleanup(prefix);
  }
});

test('daily shipment carries only pending quantity into the next day and keeps priority lineage', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `ship-roll-${randomUUID().slice(0, 8)}`;
  await cleanup(prefix);
  try {
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-user`,
        passwordHash: 'integration-test-only',
        displayName: 'Shipment Carryover',
        laborRole: LaborAccessRole.ADMIN,
      },
    });
    const workOrder = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO`,
        customerName: 'Carryover Customer',
        productName: 'Carryover Product',
        specification: 'SPEC-ROLL',
        stage: 'completed',
        progress: 100,
        status: 'processing',
        uncompletedQty: '20',
        productionTargetQty: 20,
        completedQty: '20',
        processName: 'Packaging',
      },
    });
    const planOrder = await prisma.productionPlanOrder.create({
      data: {
        sourceOrderNo: `${prefix}-SO`,
        sourceLineNo: 1,
        customerName: 'Carryover Customer',
        salesperson: 'Planner',
        productName: 'Carryover Product',
        specification: 'SPEC-ROLL',
        orderQuantity: 20,
        orderDate: new Date('2020-01-01T04:00:00.000Z'),
        customerDueDate: new Date('2020-01-06T04:00:00.000Z'),
        priority: 'urgent',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    const batch = await prisma.productionPlanBatch.create({
      data: {
        planOrderId: planOrder.id,
        batchNo: 1,
        quantity: 20,
        weekStartDate: new Date('2020-01-06T04:00:00.000Z'),
        weekEndDate: new Date('2020-01-12T04:00:00.000Z'),
        plannedCompletionDate: new Date('2020-01-10T04:00:00.000Z'),
        releaseState: 'active',
        workOrderId: workOrder.id,
      },
    });
    const monday = await addDailyShipmentItems({
      actorUserId: actor.id,
      shipDate: '2020-01-06',
      idempotencyKey: key(prefix),
      items: [{
        productionPlanBatchId: batch.id,
        plannedQuantity: 20,
        plannedShipAt: '2020-01-06T16:30',
        shipmentPriority: 'URGENT',
      }],
    });
    let sourcePlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: monday.planId } });
    assert.equal(sourcePlan.status, 'CONFIRMED');
    let sourceItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: sourcePlan.id } });
    await recordDailyShipment({
      actorUserId: actor.id,
      itemId: sourceItem.id,
      itemVersion: sourceItem.version,
      idempotencyKey: key(prefix),
      quantity: 7,
      shippedAt: '2020-01-06T08:10:00.000Z',
    });

    const carried = await reconcileDailyShipmentCarryover({
      targetShipDate: '2020-01-07',
      actorUserId: actor.id,
      strict: true,
    });
    assert.equal(carried.itemCount, 1);
    assert.equal(carried.quantity, 13);
    sourcePlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: sourcePlan.id } });
    sourceItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: sourcePlan.id } });
    assert.equal(sourcePlan.status, 'CLOSED_WITH_CARRYOVER');
    assert.equal(sourceItem.status, 'CARRIED_OVER');

    const targetItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({
      where: { planId: carried.targetPlanId! },
    });
    assert.equal(targetItem.plannedQuantity, 13);
    assert.equal(targetItem.shipmentPriority, 'URGENT');
    assert.equal(targetItem.carryoverSourceItemId, sourceItem.id);
    assert.equal(targetItem.carryoverDayCount, 1);
    assert.equal(targetItem.carryoverQuantity, 13);

    const targetWorkbench = await loadDailyShipmentWorkbench({ shipDate: '2020-01-07' });
    assert.equal(targetWorkbench.summary.carryover.itemCount, 1);
    assert.equal(targetWorkbench.summary.carryover.quantity, 13);
    assert.equal(targetWorkbench.summary.urgent.quantity, 13);
    assert.equal(targetWorkbench.candidates[0]?.scheduledQuantity, 20);
    const carryoverOverview = await loadShipmentCarryoverOverview({ asOfDate: '2020-01-07' });
    const carryoverItem = carryoverOverview.items.find(entry => entry.item.batchId === batch.id);
    assert.equal(carryoverItem?.item.pendingQuantity, 13);
    assert.equal(carryoverItem?.lineage.length, 2);

    const replay = await reconcileDailyShipmentCarryover({
      targetShipDate: '2020-01-07',
      actorUserId: actor.id,
    });
    assert.equal(replay.itemCount, 0);
    assert.equal(await prisma.dailyShipmentPlanItem.count({ where: { planId: carried.targetPlanId! } }), 1);
  } finally {
    await cleanup(prefix);
  }
});

test('historical reservations expose their source and can be released or transferred across skipped days', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `ship-res-${randomUUID().slice(0, 8)}`;
  await cleanup(prefix);
  try {
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-user`,
        passwordHash: 'integration-test-only',
        displayName: 'Shipment Reservation',
        laborRole: LaborAccessRole.ADMIN,
      },
    });
    const workOrder = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO`,
        customerName: 'Reservation Customer',
        productName: 'Reservation Product',
        specification: 'SPEC-RES',
        stage: 'completed',
        progress: 100,
        status: 'processing',
        uncompletedQty: '20',
        productionTargetQty: 20,
        completedQty: '20',
        processName: 'Packaging',
      },
    });
    const planOrder = await prisma.productionPlanOrder.create({
      data: {
        sourceOrderNo: `${prefix}-SO`,
        sourceLineNo: 1,
        customerName: 'Reservation Customer',
        salesperson: 'Planner',
        productName: 'Reservation Product',
        specification: 'SPEC-RES',
        orderQuantity: 20,
        orderDate: new Date('2020-01-01T04:00:00.000Z'),
        customerDueDate: new Date('2020-01-06T04:00:00.000Z'),
        priority: 'urgent',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    const batch = await prisma.productionPlanBatch.create({
      data: {
        planOrderId: planOrder.id,
        batchNo: 1,
        quantity: 20,
        weekStartDate: new Date('2020-01-06T04:00:00.000Z'),
        weekEndDate: new Date('2020-01-12T04:00:00.000Z'),
        plannedCompletionDate: new Date('2020-01-10T04:00:00.000Z'),
        releaseState: 'active',
        workOrderId: workOrder.id,
      },
    });

    const draftResult = await addDailyShipmentItems({
      actorUserId: actor.id,
      shipDate: '2020-01-06',
      idempotencyKey: key(prefix),
      items: [{
        productionPlanBatchId: batch.id,
        plannedQuantity: 20,
        plannedShipAt: '2020-01-06T16:00',
        shipmentPriority: 'PRIORITY',
      }],
    });
    const draftItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: draftResult.planId } });
    const occupied = await loadDailyShipmentWorkbench({ shipDate: '2020-01-09' });
    assert.equal(occupied.candidates[0]?.availableQuantity, 0);
    assert.equal(occupied.candidates[0]?.reservations[0]?.shipDate, '2020-01-06');
    assert.equal(occupied.candidates[0]?.reservations[0]?.canRelease, true);
    assert.equal(occupied.candidates[0]?.reservations[0]?.canTransferToSelectedDate, true);

    await releaseDailyShipmentReservation({
      actorUserId: actor.id,
      itemId: draftItem.id,
      itemVersion: draftItem.version,
      idempotencyKey: key(prefix),
    });
    const released = await loadDailyShipmentWorkbench({ shipDate: '2020-01-09' });
    assert.equal(released.candidates[0]?.availableQuantity, 20);
    assert.equal(released.candidates[0]?.reservations.length, 0);

    await prisma.productionPlanOrder.update({
      where: { id: planOrder.id },
      data: {
        customerDueDate: new Date('2020-01-07T04:00:00.000Z'),
        deliveryVersion: { increment: 1 },
      },
    });

    const confirmedResult = await addDailyShipmentItems({
      actorUserId: actor.id,
      shipDate: '2020-01-07',
      idempotencyKey: key(prefix),
      items: [{
        productionPlanBatchId: batch.id,
        plannedQuantity: 20,
        plannedShipAt: '2020-01-07T15:30',
        shipmentPriority: 'URGENT',
      }],
    });
    let confirmedPlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: confirmedResult.planId } });
    assert.equal(confirmedPlan.status, 'CONFIRMED');
    let confirmedItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: confirmedPlan.id } });
    await recordDailyShipment({
      actorUserId: actor.id,
      itemId: confirmedItem.id,
      itemVersion: confirmedItem.version,
      idempotencyKey: key(prefix),
      quantity: 5,
      shippedAt: '2020-01-07T08:30:00.000Z',
    });
    confirmedItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: confirmedItem.id } });
    const transferred = await transferDailyShipmentReservation({
      actorUserId: actor.id,
      itemId: confirmedItem.id,
      itemVersion: confirmedItem.version,
      targetShipDate: '2020-01-10',
      idempotencyKey: key(prefix),
    });

    confirmedPlan = await prisma.dailyShipmentPlan.findUniqueOrThrow({ where: { id: confirmedPlan.id } });
    confirmedItem = await prisma.dailyShipmentPlanItem.findUniqueOrThrow({ where: { id: confirmedItem.id } });
    const targetItem = await prisma.dailyShipmentPlanItem.findFirstOrThrow({ where: { planId: transferred.planId } });
    assert.equal(confirmedPlan.status, 'CLOSED_WITH_CARRYOVER');
    assert.equal(confirmedItem.status, 'CARRIED_OVER');
    assert.equal(targetItem.plannedQuantity, 15);
    assert.equal(targetItem.carryoverQuantity, 15);
    assert.equal(targetItem.carryoverDayCount, 3);
    assert.equal(targetItem.shipmentPriority, 'URGENT');

    const targetWorkbench = await loadDailyShipmentWorkbench({ shipDate: '2020-01-10' });
    assert.equal(targetWorkbench.candidates[0]?.scheduledQuantity, 20);
    assert.equal(targetWorkbench.candidates[0]?.reservations.length, 2);
    assert.equal(targetWorkbench.plan?.items[0]?.isCarryover, true);
    assert.equal(await prisma.dailyShipmentRevision.count({
      where: {
        plan: { createdById: actor.id },
        action: { in: ['RELEASE_RESERVATION', 'TRANSFER_RESERVATION_SOURCE', 'TRANSFER_RESERVATION'] },
      },
    }), 3);
  } finally {
    await cleanup(prefix);
  }
});
