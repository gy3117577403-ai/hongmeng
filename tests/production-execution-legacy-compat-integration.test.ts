import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { productionWeekWhere, type ProductionWeek } from '../lib/production-execution';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackIntegrationFixture extends Error {}

test('legacy production execution follows live linked batches without mutating production facts', {
  skip: !runDatabaseIntegration,
  timeout: 60_000,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const token = `EXEC-LEGACY-${randomUUID().slice(0, 8)}`;
      const currentStart = new Date('2026-08-30T16:00:00.000Z');
      const currentEnd = new Date('2026-09-05T16:00:00.000Z');
      const nextStart = new Date('2026-09-06T16:00:00.000Z');
      const nextEnd = new Date('2026-09-12T16:00:00.000Z');
      const historyStart = new Date('2026-08-23T16:00:00.000Z');
      const historyEnd = new Date('2026-08-29T16:00:00.000Z');
      const carryoverStart = new Date('2026-08-16T16:00:00.000Z');
      const carryoverEnd = new Date('2026-08-22T16:00:00.000Z');

      const weeks = {
        current: { scope: 'current', weekStart: currentStart, weekEnd: currentEnd },
        carryover: { scope: 'carryover', weekStart: currentStart, weekEnd: currentEnd },
        next: { scope: 'next', weekStart: nextStart, weekEnd: nextEnd },
        history: { scope: 'history', weekStart: historyStart, weekEnd: historyEnd },
      } satisfies Record<string, ProductionWeek>;

      const createWorkOrder = async (label: string, data: Partial<Prisma.WorkOrderUncheckedCreateInput> = {}) => (
        tx.workOrder.create({
          data: {
            code: `${token}-${label}`,
            customerName: '历史兼容测试客户',
            productName: '历史兼容测试产品',
            specification: `${token}-${label}`,
            stage: 'frontend',
            status: 'processing',
            progress: 10,
            plannedAt: currentEnd,
            weekEndDate: currentEnd,
            uncompletedQty: '10',
            productionTargetQty: 10,
            completedQty: '2',
            planType: null,
            weekStartDate: null,
            ...data,
          },
        })
      );

      let sourceLineNo = 0;
      const linkBatch = async (input: {
        label: string;
        workOrderId: string;
        weekStartDate: Date;
        weekEndDate: Date;
        releaseState: 'active' | 'preparation' | 'archived';
        batchDeletedAt?: Date | null;
        planDeletedAt?: Date | null;
      }) => {
        sourceLineNo += 1;
        const plan = await tx.productionPlanOrder.create({
          data: {
            sourceOrderNo: token,
            sourceLineNo,
            customerName: '历史兼容测试客户',
            productName: '历史兼容测试产品',
            specification: `${token}-${input.label}`,
            orderQuantity: 10,
            orderDate: input.weekStartDate,
            customerDueDate: input.weekEndDate,
            deletedAt: input.planDeletedAt || null,
          },
        });
        return tx.productionPlanBatch.create({
          data: {
            planOrderId: plan.id,
            batchNo: 1,
            quantity: 10,
            weekStartDate: input.weekStartDate,
            weekEndDate: input.weekEndDate,
            plannedCompletionDate: input.weekEndDate,
            releaseState: input.releaseState,
            workOrderId: input.workOrderId,
            deletedAt: input.batchDeletedAt || null,
          },
        });
      };

      const processing = await createWorkOrder('CURRENT-PROCESSING');
      await linkBatch({
        label: 'CURRENT-PROCESSING',
        workOrderId: processing.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
      });

      const completed = await createWorkOrder('CURRENT-COMPLETED', {
        stage: 'completed',
        status: 'done',
        progress: 100,
        completedQty: '10',
        uncompletedQty: '0',
        completedAt: currentEnd,
      });
      await linkBatch({
        label: 'CURRENT-COMPLETED',
        workOrderId: completed.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
      });

      const preparation = await createWorkOrder('NEXT-PREPARATION', {
        plannedAt: nextEnd,
        weekEndDate: nextEnd,
        planActive: true,
      });
      await linkBatch({
        label: 'NEXT-PREPARATION',
        workOrderId: preparation.id,
        weekStartDate: nextStart,
        weekEndDate: nextEnd,
        releaseState: 'preparation',
      });

      const historical = await createWorkOrder('HISTORY-COMPLETED', {
        stage: 'completed',
        status: 'done',
        progress: 100,
        completedQty: '10',
        uncompletedQty: '0',
        plannedAt: historyEnd,
        weekEndDate: historyEnd,
        completedAt: historyEnd,
        planClearedAt: currentStart,
      });
      await linkBatch({
        label: 'HISTORY-COMPLETED',
        workOrderId: historical.id,
        weekStartDate: historyStart,
        weekEndDate: historyEnd,
        releaseState: 'archived',
      });

      const legacyCarryover = await createWorkOrder('CARRYOVER-PROCESSING', {
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });
      await linkBatch({
        label: 'CARRYOVER-PROCESSING',
        workOrderId: legacyCarryover.id,
        weekStartDate: carryoverStart,
        weekEndDate: carryoverEnd,
        releaseState: 'archived',
      });

      const completedCarryover = await createWorkOrder('CARRYOVER-COMPLETED', {
        stage: 'completed',
        status: 'done',
        progress: 100,
        completedQty: '10',
        uncompletedQty: '0',
        completedAt: carryoverEnd,
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });
      await linkBatch({
        label: 'CARRYOVER-COMPLETED',
        workOrderId: completedCarryover.id,
        weekStartDate: carryoverStart,
        weekEndDate: carryoverEnd,
        releaseState: 'preparation',
      });

      const carryoverRoot = await createWorkOrder('CARRYOVER-BRANCH-ROOT', {
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });
      await linkBatch({
        label: 'CARRYOVER-BRANCH-ROOT',
        workOrderId: carryoverRoot.id,
        weekStartDate: carryoverStart,
        weekEndDate: carryoverEnd,
        releaseState: 'active',
      });
      const carryoverRoute = await tx.workOrderProcessRoute.create({
        data: {
          workOrderId: carryoverRoot.id,
          templateName: `${token}-carryover-branch-route`,
          templateVersion: 1,
          status: 'in_progress',
          steps: {
            create: {
              processCode: `${token}-carryover-origin`,
              processName: '跨周分支起点',
              stageGroup: 'frontend',
              position: 1,
              sequenceGroup: 1,
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: '套',
              standardMillisecondsPerUnit: 1_000,
              inputQty: 10,
              status: 'current',
            },
          },
        },
        include: { steps: true },
      });
      const carryoverCompletion = await tx.processCompletion.create({
        data: {
          workOrderId: carryoverRoot.id,
          routeId: carryoverRoute.id,
          stepId: carryoverRoute.steps[0].id,
          workDate: carryoverStart,
          processedQty: 1,
          goodQty: 1,
          defectQty: 0,
          reportedUnitQty: 1,
          reportedGoodUnitQty: 1,
          reportedDefectUnitQty: 0,
          routeVersion: 0,
          idempotencyKey: `${token}-carryover-origin`,
          standardSource: 'integration_test',
          timeBasis: 'per_unit',
          unitLabel: '套',
          standardMillisecondsPerUnit: 1_000,
        },
      });
      await createWorkOrder('CARRYOVER-BRANCH-CHILD', {
        parentWorkOrderId: carryoverRoot.id,
        rootWorkOrderId: carryoverRoot.id,
        branchType: 'REWORK',
        branchStatus: 'IN_PROGRESS',
        originCompletionId: carryoverCompletion.id,
        originStepId: carryoverRoute.steps[0].id,
        branchSequence: 1,
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });

      const deletedCarryoverBatch = await createWorkOrder('CARRYOVER-DELETED-BATCH', {
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });
      await linkBatch({
        label: 'CARRYOVER-DELETED-BATCH',
        workOrderId: deletedCarryoverBatch.id,
        weekStartDate: carryoverStart,
        weekEndDate: carryoverEnd,
        releaseState: 'active',
        batchDeletedAt: currentStart,
      });

      const deletedCarryoverPlan = await createWorkOrder('CARRYOVER-DELETED-PLAN', {
        plannedAt: carryoverEnd,
        weekEndDate: carryoverEnd,
      });
      await linkBatch({
        label: 'CARRYOVER-DELETED-PLAN',
        workOrderId: deletedCarryoverPlan.id,
        weekStartDate: carryoverStart,
        weekEndDate: carryoverEnd,
        releaseState: 'active',
        planDeletedAt: currentStart,
      });

      const branchRoot = await createWorkOrder('BRANCH-ROOT');
      await linkBatch({
        label: 'BRANCH-ROOT',
        workOrderId: branchRoot.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
      });
      const branchRoute = await tx.workOrderProcessRoute.create({
        data: {
          workOrderId: branchRoot.id,
          templateName: `${token}-branch-route`,
          templateVersion: 1,
          status: 'in_progress',
          steps: {
            create: {
              processCode: `${token}-branch-origin`,
              processName: '历史分支起点',
              stageGroup: 'frontend',
              position: 1,
              sequenceGroup: 1,
              standardSource: 'integration_test',
              timeBasis: 'per_unit',
              unitLabel: '套',
              standardMillisecondsPerUnit: 1_000,
              inputQty: 10,
              status: 'current',
            },
          },
        },
        include: { steps: true },
      });
      const originCompletion = await tx.processCompletion.create({
        data: {
          workOrderId: branchRoot.id,
          routeId: branchRoute.id,
          stepId: branchRoute.steps[0].id,
          workDate: currentStart,
          processedQty: 1,
          goodQty: 1,
          defectQty: 0,
          reportedUnitQty: 1,
          reportedGoodUnitQty: 1,
          reportedDefectUnitQty: 0,
          routeVersion: 0,
          idempotencyKey: `${token}-branch-origin`,
          standardSource: 'integration_test',
          timeBasis: 'per_unit',
          unitLabel: '套',
          standardMillisecondsPerUnit: 1_000,
        },
      });
      const branch = await createWorkOrder('BRANCH-CHILD', {
        parentWorkOrderId: branchRoot.id,
        rootWorkOrderId: branchRoot.id,
        branchType: 'REWORK',
        branchStatus: 'IN_PROGRESS',
        originCompletionId: originCompletion.id,
        originStepId: branchRoute.steps[0].id,
        branchSequence: 1,
      });

      const deletedWorkOrder = await createWorkOrder('DELETED-WORK-ORDER', { deletedAt: currentStart });
      await linkBatch({
        label: 'DELETED-WORK-ORDER',
        workOrderId: deletedWorkOrder.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
      });

      const deletedBatchOrder = await createWorkOrder('DELETED-BATCH');
      await linkBatch({
        label: 'DELETED-BATCH',
        workOrderId: deletedBatchOrder.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
        batchDeletedAt: currentStart,
      });

      const deletedPlanOrder = await createWorkOrder('DELETED-PLAN');
      await linkBatch({
        label: 'DELETED-PLAN',
        workOrderId: deletedPlanOrder.id,
        weekStartDate: currentStart,
        weekEndDate: currentEnd,
        releaseState: 'active',
        planDeletedAt: currentStart,
      });

      const unlinked = await createWorkOrder('UNLINKED-DATE-ONLY', {
        plannedAt: currentEnd,
        weekEndDate: currentEnd,
      });

      const selectedCodes = async (week: ProductionWeek) => (
        (await tx.workOrder.findMany({
          where: productionWeekWhere(week),
          select: { code: true },
          orderBy: { code: 'asc' },
        })).map(order => order.code)
      );

      assert.deepEqual(await selectedCodes(weeks.current), [
        `${token}-BRANCH-CHILD`,
        `${token}-BRANCH-ROOT`,
        `${token}-CURRENT-COMPLETED`,
        `${token}-CURRENT-PROCESSING`,
      ]);
      assert.deepEqual(await selectedCodes(weeks.next), [`${token}-NEXT-PREPARATION`]);
      assert.deepEqual(await selectedCodes(weeks.history), [`${token}-HISTORY-COMPLETED`]);
      assert.deepEqual(await selectedCodes(weeks.carryover), [
        `${token}-CARRYOVER-BRANCH-CHILD`,
        `${token}-CARRYOVER-BRANCH-ROOT`,
        `${token}-CARRYOVER-PROCESSING`,
      ]);

      const unchanged = await tx.workOrder.findUniqueOrThrow({ where: { id: processing.id } });
      assert.equal(unchanged.planType, null);
      assert.equal(unchanged.weekStartDate, null);
      assert.equal(unchanged.uncompletedQty, '10');
      assert.equal(unchanged.completedQty, '2');
      assert.equal(await tx.workOrder.count({ where: { id: unlinked.id, ...productionWeekWhere(weeks.current) } }), 0);
      assert.equal(await tx.workOrder.count({ where: { id: unlinked.id, ...productionWeekWhere(weeks.carryover) } }), 0);

      throw new RollbackIntegrationFixture();
    }),
    error => error instanceof RollbackIntegrationFixture,
  );
});
