import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { deleteProductionPlanOrderDirectly } from '../lib/production-plan-direct-deletion';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackIntegrationFixture extends Error {}

test('direct deletion retires a completed historical plan while preserving its ledgers and product record', {
  skip: !runDatabaseIntegration,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const token = randomUUID();
      const actor = await tx.user.create({
        data: {
          username: `direct-delete-${token}`,
          passwordHash: 'integration-test-only',
          displayName: 'Direct delete integration',
        },
      });
      const drawing = await tx.drawingLibraryItem.create({
        data: {
          customerName: '宁波鸿泉',
          productName: '线束',
          specification: `WSQC-DIRECT-${token}`,
          libraryKey: `direct-delete-${token}`,
        },
      });
      const weekStartDate = new Date('2026-08-10T04:00:00.000Z');
      const weekEndDate = new Date('2026-08-16T04:00:00.000Z');
      const workOrder = await tx.workOrder.create({
        data: {
          code: `DIRECT-${token}`,
          customerName: '宁波鸿泉',
          productName: '线束',
          specification: drawing.specification,
          stage: 'completed',
          status: 'done',
          progress: 100,
          completedQty: '45',
          completedAt: weekEndDate,
          planType: 'managed_plan',
          planActive: true,
          weekStartDate,
          weekEndDate,
          drawingLibraryItemId: drawing.id,
        },
      });
      const order = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `DIRECT-${token}`,
          sourceLineNo: 1,
          customerName: '宁波鸿泉',
          productName: '线束',
          specification: drawing.specification,
          drawingLibraryItemId: drawing.id,
          orderQuantity: 45,
          orderDate: weekStartDate,
          customerDueDate: weekEndDate,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      const batch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: order.id,
          batchNo: 1,
          quantity: 45,
          weekStartDate,
          weekEndDate,
          plannedCompletionDate: weekEndDate,
          releaseState: 'active',
          workOrderId: workOrder.id,
          releasedAt: weekStartDate,
          releasedById: actor.id,
        },
      });
      await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: batch.id,
          workOrderId: workOrder.id,
          sourceWeekStartDate: weekStartDate,
          targetWeekStartDate: new Date('2026-08-17T04:00:00.000Z'),
          inclusionType: 'AUTO_PREVIOUS_WEEK',
          status: 'ACTIVE',
          includedById: actor.id,
        },
      });

      const result = await deleteProductionPlanOrderDirectly(tx, {
        planOrderId: order.id,
        actorId: actor.id,
        actorLabel: actor.displayName || actor.username,
        reason: null,
      });
      assert.deepEqual({
        deletedBatchCount: result.deletedBatchCount,
        retiredWorkOrderCount: result.retiredWorkOrderCount,
        dismissedCarryoverCount: result.dismissedCarryoverCount,
      }, {
        deletedBatchCount: 1,
        retiredWorkOrderCount: 1,
        dismissedCarryoverCount: 1,
      });

      const [deletedOrder, deletedBatch, retiredWorkOrder, carryover, change, log, retainedDrawing] = await Promise.all([
        tx.productionPlanOrder.findUniqueOrThrow({ where: { id: order.id } }),
        tx.productionPlanBatch.findUniqueOrThrow({ where: { id: batch.id } }),
        tx.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } }),
        tx.productionCarryover.findFirstOrThrow({ where: { productionPlanBatchId: batch.id } }),
        tx.productionPlanChange.findFirstOrThrow({ where: { planOrderId: order.id, action: 'direct_delete_plan_order' } }),
        tx.operationLog.findFirstOrThrow({ where: { targetId: order.id, action: 'direct_delete_production_plan_order' } }),
        tx.drawingLibraryItem.findUniqueOrThrow({ where: { id: drawing.id } }),
      ]);
      assert.ok(deletedOrder.deletedAt);
      assert.ok(deletedBatch.deletedAt);
      assert.ok(retiredWorkOrder.deletedAt);
      assert.equal(retiredWorkOrder.planActive, false);
      assert.equal(retiredWorkOrder.stage, 'completed');
      assert.equal(retiredWorkOrder.completedQty, '45');
      assert.equal(carryover.status, 'DISMISSED');
      assert.ok(carryover.dismissedAt);
      assert.equal(change.reason, null);
      assert.equal(log.targetType, 'production_plan_order');
      assert.equal(retainedDrawing.deletedAt, null);

      throw new RollbackIntegrationFixture();
    }, { timeout: 60_000 }),
    RollbackIntegrationFixture,
  );
});

test('direct deletion still dismisses carryover when its batch was already soft deleted', {
  skip: !runDatabaseIntegration,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const token = randomUUID();
      const actor = await tx.user.create({
        data: {
          username: `direct-delete-edge-${token}`,
          passwordHash: 'integration-test-only',
          displayName: 'Direct delete edge integration',
        },
      });
      const weekStartDate = new Date('2026-08-10T04:00:00.000Z');
      const weekEndDate = new Date('2026-08-16T04:00:00.000Z');
      const workOrder = await tx.workOrder.create({
        data: {
          code: `DIRECT-EDGE-${token}`,
          customerName: '宁波鸿泉',
          productName: '线束',
          specification: `WSQC-DIRECT-EDGE-${token}`,
          stage: 'frontend',
          status: 'processing',
          progress: 0,
          planType: 'managed_plan',
          planActive: true,
          weekStartDate,
          weekEndDate,
        },
      });
      const order = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `DIRECT-EDGE-${token}`,
          sourceLineNo: 1,
          customerName: '宁波鸿泉',
          productName: '线束',
          specification: workOrder.specification!,
          orderQuantity: 50,
          orderDate: weekStartDate,
          customerDueDate: weekEndDate,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      const batch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: order.id,
          batchNo: 1,
          quantity: 50,
          weekStartDate,
          weekEndDate,
          plannedCompletionDate: weekEndDate,
          releaseState: 'archived',
          workOrderId: workOrder.id,
          releasedAt: weekStartDate,
          releasedById: actor.id,
          deletedAt: new Date('2026-08-18T02:00:00.000Z'),
        },
      });
      const carryover = await tx.productionCarryover.create({
        data: {
          productionPlanBatchId: batch.id,
          workOrderId: workOrder.id,
          sourceWeekStartDate: weekStartDate,
          targetWeekStartDate: new Date('2026-08-17T04:00:00.000Z'),
          inclusionType: 'AUTO_PREVIOUS_WEEK',
          status: 'ACTIVE',
          includedById: actor.id,
        },
      });

      const result = await deleteProductionPlanOrderDirectly(tx, {
        planOrderId: order.id,
        actorId: actor.id,
        actorLabel: actor.displayName || actor.username,
      });
      assert.deepEqual({
        deletedBatchCount: result.deletedBatchCount,
        retiredWorkOrderCount: result.retiredWorkOrderCount,
        dismissedCarryoverCount: result.dismissedCarryoverCount,
      }, {
        deletedBatchCount: 0,
        retiredWorkOrderCount: 1,
        dismissedCarryoverCount: 1,
      });

      const [deletedOrder, retiredWorkOrder, dismissedCarryover] = await Promise.all([
        tx.productionPlanOrder.findUniqueOrThrow({ where: { id: order.id } }),
        tx.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } }),
        tx.productionCarryover.findUniqueOrThrow({ where: { id: carryover.id } }),
      ]);
      assert.ok(deletedOrder.deletedAt);
      assert.ok(retiredWorkOrder.deletedAt);
      assert.equal(retiredWorkOrder.planActive, false);
      assert.equal(dismissedCarryover.status, 'DISMISSED');
      assert.ok(dismissedCarryover.dismissedAt);

      throw new RollbackIntegrationFixture();
    }, { timeout: 60_000 }),
    RollbackIntegrationFixture,
  );
});
