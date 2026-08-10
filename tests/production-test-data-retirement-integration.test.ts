import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  previewProductionTestDataRetirementInTransaction,
  retireProductionTestDataInTransaction,
} from '../lib/production-test-data-retirement';
import { addDays, parseWeek } from '../lib/weekly-work-orders';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackRetirementFixture extends Error {}

test('test-week retirement hides operational orders while retaining drawings and stored file metadata', {
  skip: !runDatabaseIntegration,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const suffix = randomUUID();
      const actor = await tx.user.create({
        data: {
          username: `retire-${suffix}`,
          passwordHash: 'integration-test-only',
          displayName: '测试数据退役验证',
        },
      });
      const category = await tx.resourceCategory.create({
        data: { code: `retire-drawing-${suffix}`, name: '测试图纸' },
      });
      const drawingItem = await tx.drawingLibraryItem.create({
        data: {
          customerName: '测试客户',
          productName: '测试产品',
          specification: `RETIRE-${suffix}`,
          libraryKey: `retire-${suffix}`,
        },
      });
      const weekStart = parseWeek('2026-07-20')!;
      const workOrder = await tx.workOrder.create({
        data: {
          code: `RETIRE-WO-${suffix}`,
          customerName: '测试客户',
          productName: '测试产品',
          specification: `RETIRE-${suffix}`,
          stage: 'frontend',
          status: 'processing',
          planType: 'weekly_plan',
          planActive: true,
          weekStartDate: weekStart,
          weekEndDate: addDays(weekStart, 6),
          drawingLibraryItemId: drawingItem.id,
        },
      });
      const sourceFile = await tx.resourceFile.create({
        data: {
          workOrderId: workOrder.id,
          categoryId: category.id,
          originalName: 'source.pdf',
          mimeType: 'application/pdf',
          fileType: 'pdf',
          fileSize: 128,
          objectKey: `integration/${suffix}/source.pdf`,
          uploadedById: actor.id,
        },
      });
      const libraryFile = await tx.drawingLibraryFile.create({
        data: {
          libraryItemId: drawingItem.id,
          categoryId: category.id,
          originalName: 'drawing.pdf',
          mimeType: 'application/pdf',
          size: 128,
          objectKey: `integration/${suffix}/drawing.pdf`,
          sourceResourceFileId: sourceFile.id,
          uploadedById: actor.id,
        },
      });
      const planOrder = await tx.productionPlanOrder.create({
        data: {
          sourceOrderNo: `RETIRE-${suffix}`,
          sourceLineNo: 1,
          customerName: '测试客户',
          productName: '测试产品',
          specification: `RETIRE-${suffix}`,
          drawingLibraryItemId: drawingItem.id,
          orderQuantity: 10,
          orderDate: weekStart,
          customerDueDate: addDays(weekStart, 10),
        },
      });
      const batch = await tx.productionPlanBatch.create({
        data: {
          planOrderId: planOrder.id,
          batchNo: 1,
          quantity: 10,
          weekStartDate: weekStart,
          weekEndDate: addDays(weekStart, 6),
          plannedCompletionDate: addDays(weekStart, 5),
          releaseState: 'archived',
          workOrderId: workOrder.id,
        },
      });

      const preview = await previewProductionTestDataRetirementInTransaction(tx);
      assert.equal(preview.items.some(item => item.batchId === batch.id), true);
      const result = await retireProductionTestDataInTransaction(tx, {
        actorId: actor.id,
        fingerprint: preview.fingerprint,
      });
      assert.ok(result.retiredBatchCount >= 1);
      assert.ok((await tx.productionPlanBatch.findUniqueOrThrow({ where: { id: batch.id } })).deletedAt);
      assert.ok((await tx.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).deletedAt);
      assert.ok((await tx.productionPlanOrder.findUniqueOrThrow({ where: { id: planOrder.id } })).deletedAt);
      assert.equal((await tx.drawingLibraryItem.findUniqueOrThrow({ where: { id: drawingItem.id } })).deletedAt, null);
      assert.equal((await tx.drawingLibraryFile.findUniqueOrThrow({ where: { id: libraryFile.id } })).deletedAt, null);
      assert.equal((await tx.resourceFile.findUniqueOrThrow({ where: { id: sourceFile.id } })).deletedAt, null);

      throw new RollbackRetirementFixture();
    }, { timeout: 60_000 }),
    RollbackRetirementFixture,
  );
});
