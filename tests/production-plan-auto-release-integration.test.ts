import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { productionWeekWhere } from '../lib/production-execution';
import { reconcileAutomaticallyReleasedProductionPlanBatches } from '../lib/production-planning';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackIntegrationFixture extends Error {}

test(
  'current and next week plan batches become visible production work orders and roll over safely',
  {
    skip: !runDatabaseIntegration,
  },
  async () => {
    await assert.rejects(
      prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.create({
            data: {
              username: 'plan-auto-release-integration',
              passwordHash: 'integration-test-only',
              displayName: 'Plan auto release integration',
            },
          });
          const currentStart = new Date('2026-08-03T04:00:00.000Z');
          const currentEnd = new Date('2026-08-09T04:00:00.000Z');
          const nextStart = new Date('2026-08-10T04:00:00.000Z');
          const nextEnd = new Date('2026-08-16T04:00:00.000Z');
          const orderDate = new Date('2026-08-01T04:00:00.000Z');
          const customerDueDate = new Date('2026-08-20T04:00:00.000Z');
          const processDefinition = await tx.processDefinition.create({
            data: {
              code: `plan-auto-cut-${actor.id}`,
              name: '自动裁线',
              stageGroup: 'frontend',
            },
          });
          const currentDrawing = await tx.drawingLibraryItem.create({
            data: {
              customerName: 'Integration customer',
              productName: 'Current week product',
              specification: 'AUTO-CURRENT-SPEC',
              libraryKey: `plan-auto-current-${actor.id}`,
            },
          });
          const nextDrawing = await tx.drawingLibraryItem.create({
            data: {
              customerName: 'Integration customer',
              productName: 'Next week product',
              specification: 'AUTO-NEXT-SPEC',
              libraryKey: `plan-auto-next-${actor.id}`,
            },
          });
          const [drawingCategory, sopCategory] = await Promise.all([
            tx.resourceCategory.upsert({
              where: { code: 'drawing' },
              update: {},
              create: { code: 'drawing', name: '图纸', sortOrder: 10 },
            }),
            tx.resourceCategory.upsert({
              where: { code: 'sop' },
              update: {},
              create: { code: 'sop', name: 'SOP', sortOrder: 20 },
            }),
          ]);
          await tx.drawingLibraryFile.createMany({
            data: [currentDrawing, nextDrawing].flatMap(item => ([
              {
                libraryItemId: item.id,
                categoryId: drawingCategory.id,
                originalName: `${item.specification}-drawing.pdf`,
                mimeType: 'application/pdf',
                size: 128,
                version: 'V1',
                objectKey: `integration/${actor.id}/${item.id}/drawing.pdf`,
              },
              {
                libraryItemId: item.id,
                categoryId: sopCategory.id,
                originalName: `${item.specification}-sop.pdf`,
                mimeType: 'application/pdf',
                size: 128,
                version: 'V1',
                objectKey: `integration/${actor.id}/${item.id}/sop.pdf`,
              },
            ])),
          });
          await tx.sopDocument.create({
            data: {
              drawingLibraryItemId: currentDrawing.id,
              title: 'Current week validating SOP',
              sopStage: 'validating',
              drawingStatus: 'available',
              remark: '集成测试：验证中状态只提示，不阻断进入生产执行',
              createdById: actor.id,
              updatedById: actor.id,
            },
          });
          await tx.productTimeProfile.create({
            data: {
              drawingLibraryItemId: currentDrawing.id,
              version: 1,
              status: 'published',
              publishedAt: currentStart,
              createdById: actor.id,
              updatedById: actor.id,
              publishedById: actor.id,
              entries: {
                create: {
                  processDefinitionId: processDefinition.id,
                  position: 1,
                  sequenceGroup: 1,
                  timeBasis: 'per_unit',
                  unitMilliseconds: 12_000,
                  setupMilliseconds: 0,
                  unitLabel: '件',
                },
              },
            },
          });

          const currentOrder = await tx.productionPlanOrder.create({
            data: {
              sourceOrderNo: 'AUTO-CURRENT',
              sourceLineNo: 1,
              customerName: 'Integration customer',
              productName: 'Current week product',
              specification: 'AUTO-CURRENT-SPEC',
              drawingLibraryItemId: currentDrawing.id,
              orderQuantity: 10,
              orderDate,
              customerDueDate,
              createdById: actor.id,
              updatedById: actor.id,
              batches: {
                create: {
                  batchNo: 1,
                  quantity: 10,
                  weekStartDate: currentStart,
                  weekEndDate: currentEnd,
                  plannedCompletionDate: currentEnd,
                },
              },
            },
          });
          const nextOrder = await tx.productionPlanOrder.create({
            data: {
              sourceOrderNo: 'AUTO-NEXT',
              sourceLineNo: 1,
              customerName: 'Integration customer',
              productName: 'Next week product',
              specification: 'AUTO-NEXT-SPEC',
              drawingLibraryItemId: nextDrawing.id,
              orderQuantity: 12,
              orderDate,
              customerDueDate,
              createdById: actor.id,
              updatedById: actor.id,
              batches: {
                create: {
                  batchNo: 1,
                  quantity: 12,
                  weekStartDate: nextStart,
                  weekEndDate: nextEnd,
                  plannedCompletionDate: nextEnd,
                },
              },
            },
          });

          const first =
            await reconcileAutomaticallyReleasedProductionPlanBatches(tx, {
              actorId: actor.id,
              now: currentStart,
            });
          assert.deepEqual(
            { active: first.active, preparation: first.preparation, started: first.started },
            { active: 1, preparation: 1, started: 1 },
          );
          assert.equal(first.warningCount, 1);

          const [currentBatch, nextBatch] = await Promise.all([
            tx.productionPlanBatch.findFirstOrThrow({
              where: { planOrderId: currentOrder.id },
              include: {
                holds: true,
                workOrder: {
                  include: { materialTask: true, processRoute: { include: { steps: true } } },
                },
              },
            }),
            tx.productionPlanBatch.findFirstOrThrow({
              where: { planOrderId: nextOrder.id },
              include: {
                holds: true,
                workOrder: {
                  include: { materialTask: true, processRoute: { include: { steps: true } } },
                },
              },
            }),
          ]);
          assert.equal(currentBatch.releaseState, 'active');
          assert.equal(currentBatch.workOrder?.planActive, true);
          assert.equal(currentBatch.workOrder?.stage, 'frontend');
          assert.ok(currentBatch.workOrder?.startedAt);
          assert.equal(currentBatch.workOrder?.processRoute?.status, 'in_progress');
          assert.equal(currentBatch.holds.length, 0, 'pending material is a risk, not an automatic hard hold');
          assert.equal(nextBatch.releaseState, 'preparation');
          assert.equal(nextBatch.workOrder?.planActive, false);
          assert.equal(currentBatch.workOrder?.materialTask?.status, 'pending');
          assert.ok(nextBatch.workOrder);
          assert.equal(nextBatch.workOrder.startedAt, null);
          assert.equal(nextBatch.workOrder.materialTask?.status, 'pending');
          assert.equal(nextBatch.holds.length, 0, 'preparation material is not frozen');
          assert.equal(nextBatch.workOrder.processRoute?.status, 'draft');
          assert.equal(nextBatch.workOrder.processRoute?.routeSource, 'product_time_pending');

          const [visibleCurrent, visibleNext] = await Promise.all([
            tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'current',
                weekStart: currentStart,
                weekEnd: currentEnd,
              }),
            }),
            tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'next',
                weekStart: nextStart,
                weekEnd: nextEnd,
              }),
            }),
          ]);
          assert.equal(visibleCurrent, 1);
          assert.equal(visibleNext, 1);

          await tx.productTimeProfile.create({
            data: {
              drawingLibraryItemId: nextDrawing.id,
              version: 1,
              status: 'published',
              publishedAt: currentStart,
              createdById: actor.id,
              updatedById: actor.id,
              publishedById: actor.id,
              entries: {
                create: {
                  processDefinitionId: processDefinition.id,
                  position: 1,
                  sequenceGroup: 1,
                  timeBasis: 'per_unit',
                  unitMilliseconds: 15_000,
                  setupMilliseconds: 0,
                  unitLabel: '件',
                },
              },
            },
          });
          const materialTasks = await tx.warehouseMaterialTask.findMany({
            where: { workOrderId: { in: [currentBatch.workOrderId!, nextBatch.workOrderId!] } },
          });
          for (const task of materialTasks) {
            await tx.warehouseMaterialTask.update({
              where: { id: task.id },
              data: {
                status: 'exception',
                exceptionType: 'wrong_material',
                exceptionNote: '集成测试：料错仅提示',
                updatedById: actor.id,
              },
            });
          }
          const backfill = await reconcileAutomaticallyReleasedProductionPlanBatches(tx, {
            actorId: actor.id,
            now: currentStart,
          });
          assert.deepEqual(
            { active: backfill.active, preparation: backfill.preparation, started: backfill.started },
            { active: 0, preparation: 0, started: 1 },
          );
          const startedNext = await tx.productionPlanBatch.findFirstOrThrow({
            where: { planOrderId: nextOrder.id },
            include: { workOrder: { include: { processRoute: { include: { steps: true } } } } },
          });
          assert.equal(startedNext.workOrder?.stage, 'frontend');
          assert.ok(startedNext.workOrder?.startedAt);
          assert.equal(startedNext.workOrder?.processRoute?.status, 'in_progress');
          assert.equal(startedNext.workOrder?.processRoute?.steps[0]?.status, 'current');

          const rollover =
            await reconcileAutomaticallyReleasedProductionPlanBatches(tx, {
              actorId: actor.id,
              now: nextStart,
            });
          assert.deepEqual(
            { active: rollover.active, preparation: rollover.preparation, started: rollover.started },
            { active: 1, preparation: 0, started: 0 },
          );
          const rolledOver = await tx.productionPlanBatch.findFirstOrThrow({
            where: { planOrderId: nextOrder.id },
            include: { workOrder: true },
          });
          assert.equal(rolledOver.releaseState, 'active');
          assert.equal(rolledOver.workOrder?.planActive, true);
          assert.ok(rolledOver.workOrder?.startedAt);
          assert.equal(
            await tx.workOrder.count({
              where: productionWeekWhere({
                scope: 'current',
                weekStart: nextStart,
                weekEnd: nextEnd,
              }),
            }),
            1,
          );
          throw new RollbackIntegrationFixture();
        },
        { timeout: 60_000 },
      ),
      (error) => error instanceof RollbackIntegrationFixture,
    );
  },
);
