import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DailyProcessTaskStatus, DailyProductionPlanStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withdrawProcessCompletion } from '../lib/process-completion-withdrawal-service';
import { syncDraftRoutesFromPublishedProductTime } from '../lib/process-routing';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'published product time upgrades fact-free routes and preserves completed history on active routes',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-PT-SYNC-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
      },
    });
    let drawingItemId = '';
    let oldProfileId = '';
    let newProfileId = '';
    let orderId = '';
    let routeId = '';
    let progressedOrderId = '';
    let progressedRouteId = '';
    let progressedCompletionId = '';
    let teamId = '';
    let employeeId = '';
    let dailyPlanId = '';
    let dailyTaskId = '';
    let dailyAssignmentId = '';
    const definitionIds: string[] = [];
    try {
      const [automatic, wrapping] = await Promise.all([
        prisma.processDefinition.create({
          data: { code: `${prefix}-AUTO`, name: '全自动', stageGroup: 'frontend', sortOrder: 1 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-WRAP`, name: '包胶布', stageGroup: 'backend', sortOrder: 2 },
        }),
      ]);
      definitionIds.push(automatic.id, wrapping.id);
      const item = await prisma.drawingLibraryItem.create({
        data: {
          customerName: 'integration-test',
          productName: 'active sync product',
          specification: `${prefix}-PRODUCT`,
          libraryKey: `${prefix}-LIBRARY`,
        },
      });
      drawingItemId = item.id;
      const oldProfile = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 1,
          status: 'archived',
          createdById: actor.id,
          updatedById: actor.id,
          entries: {
            create: [
              {
                processDefinitionId: automatic.id,
                position: 1,
                sequenceGroup: 1,
                timeBasis: 'per_unit',
                unitMilliseconds: 3_000,
                occurrences: 1,
                unitLabel: '套',
              },
              {
                processDefinitionId: wrapping.id,
                position: 2,
                sequenceGroup: 2,
                timeBasis: 'per_unit',
                unitMilliseconds: 30_000,
                occurrences: 1,
                unitLabel: '套',
              },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      oldProfileId = oldProfile.id;
      const newProfile = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 2,
          status: 'published',
          publishedAt: new Date(),
          createdById: actor.id,
          updatedById: actor.id,
          publishedById: actor.id,
          entries: {
            create: [
              {
                processDefinitionId: automatic.id,
                position: 1,
                sequenceGroup: 1,
                timeBasis: 'per_unit',
                unitMilliseconds: 6_000,
                occurrences: 1,
                unitLabel: '套',
              },
              {
                processDefinitionId: wrapping.id,
                position: 2,
                sequenceGroup: 2,
                timeBasis: 'per_unit',
                unitMilliseconds: 45_000,
                occurrences: 1,
                unitLabel: '套',
              },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      newProfileId = newProfile.id;
      const startedAt = new Date('2026-08-03T00:00:00.000Z');
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          customerName: 'integration-test',
          productName: 'active sync product',
          specification: item.specification,
          stage: 'frontend',
          status: 'processing',
          uncompletedQty: '4000',
          productionTargetQty: 4_000,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          drawingLibraryItemId: item.id,
          startedAt,
          processRoute: {
            create: {
              templateName: `${item.specification} 产品工时`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              startedAt,
              confirmedAt: startedAt,
              confirmedById: actor.id,
              routeSource: 'product_time_profile',
              productTimeProfileId: oldProfile.id,
              productTimeProfileVersion: 1,
              steps: {
                create: [
                  {
                    processDefinitionId: automatic.id,
                    processCode: automatic.code,
                    processName: automatic.name,
                    stageGroup: automatic.stageGroup,
                    position: 1,
                    sequenceGroup: 1,
                    productTimeProfileId: oldProfile.id,
                    productTimeEntryId: oldProfile.entries[0].id,
                    productTimeProfileVersion: 1,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '套',
                    standardMillisecondsPerUnit: 3_000,
                    inputQty: 4_000,
                    status: 'current',
                    startedAt,
                  },
                  {
                    processDefinitionId: wrapping.id,
                    processCode: wrapping.code,
                    processName: wrapping.name,
                    stageGroup: wrapping.stageGroup,
                    position: 2,
                    sequenceGroup: 2,
                    productTimeProfileId: oldProfile.id,
                    productTimeEntryId: oldProfile.entries[1].id,
                    productTimeProfileVersion: 1,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '套',
                    standardMillisecondsPerUnit: 30_000,
                    inputQty: 0,
                    status: 'pending',
                  },
                ],
              },
            },
          },
        },
        include: { processRoute: true },
      });
      orderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;

      const progressedOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER-PROGRESSED`,
          customerName: 'integration-test',
          productName: 'active sync product with history',
          specification: item.specification,
          stage: 'frontend',
          status: 'processing',
          uncompletedQty: '3000',
          productionTargetQty: 4_000,
          completedQty: '1000',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          drawingLibraryItemId: item.id,
          startedAt,
          processRoute: {
            create: {
              templateName: `${item.specification} 产品工时`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              startedAt,
              confirmedAt: startedAt,
              confirmedById: actor.id,
              routeSource: 'product_time_profile',
              productTimeProfileId: oldProfile.id,
              productTimeProfileVersion: 1,
              steps: {
                create: [
                  {
                    processDefinitionId: automatic.id,
                    processCode: automatic.code,
                    processName: automatic.name,
                    stageGroup: automatic.stageGroup,
                    position: 1,
                    sequenceGroup: 1,
                    productTimeProfileId: oldProfile.id,
                    productTimeEntryId: oldProfile.entries[0].id,
                    productTimeProfileVersion: 1,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '套',
                    standardMillisecondsPerUnit: 3_000,
                    inputQty: 4_000,
                    processedQty: 1_000,
                    goodOutputQty: 1_000,
                    status: 'completed',
                    startedAt,
                    completedAt: new Date('2026-08-03T01:00:00.000Z'),
                    completedById: actor.id,
                  },
                  {
                    processDefinitionId: wrapping.id,
                    processCode: wrapping.code,
                    processName: wrapping.name,
                    stageGroup: wrapping.stageGroup,
                    position: 2,
                    sequenceGroup: 2,
                    productTimeProfileId: oldProfile.id,
                    productTimeEntryId: oldProfile.entries[1].id,
                    productTimeProfileVersion: 1,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '套',
                    standardMillisecondsPerUnit: 30_000,
                    inputQty: 1_000,
                    status: 'current',
                    startedAt: new Date('2026-08-03T01:00:00.000Z'),
                  },
                ],
              },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      progressedOrderId = progressedOrder.id;
      assert.ok(progressedOrder.processRoute);
      progressedRouteId = progressedOrder.processRoute.id;
      const historicalCompletion = await prisma.processCompletion.create({
        data: {
          workOrderId: progressedOrder.id,
          routeId: progressedRouteId,
          stepId: progressedOrder.processRoute.steps[0].id,
          workDate: new Date('2026-08-03T00:00:00.000Z'),
          completedAt: new Date('2026-08-03T01:00:00.000Z'),
          processedQty: 1_000,
          goodQty: 1_000,
          defectQty: 0,
          reportedUnitQty: 1_000,
          reportedGoodUnitQty: 1_000,
          reportedDefectUnitQty: 0,
          reportQuantityBasis: 'product',
          reportUnitLabel: '套',
          routeVersion: 0,
          idempotencyKey: `${prefix}-HISTORICAL-COMPLETION`,
          productTimeProfileId: oldProfile.id,
          productTimeEntryId: oldProfile.entries[0].id,
          productTimeProfileVersion: 1,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '套',
          standardMillisecondsPerUnit: 3_000,
          createdById: actor.id,
        },
      });
      progressedCompletionId = historicalCompletion.id;
      const team = await prisma.productionTeam.create({
        data: { code: `${prefix}-TEAM`, name: `${prefix} Team` },
      });
      teamId = team.id;
      const employee = await prisma.employee.create({
        data: { employeeNo: `${prefix}-EMPLOYEE`, name: `${prefix} employee`, department: '生产部', team: team.name },
      });
      employeeId = employee.id;
      const dailyPlan = await prisma.dailyProductionPlan.create({
        data: {
          workDate: new Date('2026-08-03T00:00:00.000Z'),
          shiftCode: 'DAY',
          teamId: team.id,
          status: DailyProductionPlanStatus.CONFIRMED,
          confirmedAt: startedAt,
          confirmedById: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      dailyPlanId = dailyPlan.id;
      const dailyTask = await prisma.dailyProcessTask.create({
        data: {
          planId: dailyPlan.id,
          workDate: dailyPlan.workDate,
          shiftCode: dailyPlan.shiftCode,
          workOrderId: progressedOrder.id,
          routeId: progressedRouteId,
          stepId: progressedOrder.processRoute.steps[0].id,
          routeVersion: 0,
          processCode: automatic.code,
          processName: automatic.name,
          stageGroup: automatic.stageGroup,
          position: 1,
          sequenceGroup: 1,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '套',
          standardMillisecondsPerUnit: 3_000,
          setupMilliseconds: 0,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          productTimeProfileId: oldProfile.id,
          productTimeProfileVersion: 1,
          plannedQty: 1_000,
          availableQty: 0,
          status: DailyProcessTaskStatus.COMPLETED,
        },
      });
      dailyTaskId = dailyTask.id;
      const dailyAssignment = await prisma.dailyTaskAssignment.create({
        data: {
          taskId: dailyTask.id,
          employeeId: employee.id,
          assignedTeamId: team.id,
          quantity: 1_000,
          plannedStandardMilliseconds: 3_000_000n,
          idempotencyKey: `${prefix}-ASSIGNMENT`,
          assignedById: actor.id,
        },
      });
      dailyAssignmentId = dailyAssignment.id;

      const result = await prisma.$transaction(
        tx => syncDraftRoutesFromPublishedProductTime(tx, {
          profileId: newProfile.id,
          actorId: actor.id,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      assert.equal(result.activeUpdated, 2);
      assert.equal(result.partiallyUpdated, 1);
      assert.equal(result.reviewRequired, 0);

      const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: routeId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(route.productTimeProfileId, newProfile.id);
      assert.equal(route.productTimeProfileVersion, 2);
      assert.equal(route.version, 1);
      assert.equal(route.status, 'in_progress');
      assert.equal(route.steps.length, 2);
      assert.equal(route.steps[0].processName, '全自动');
      assert.equal(route.steps[0].standardMillisecondsPerUnit, 6_000);
      assert.equal(route.steps[0].productTimeEntryId, newProfile.entries[0].id);
      assert.equal(route.steps[0].inputQty, 4_000);
      assert.equal(route.steps[0].status, 'current');
      assert.equal(route.steps[1].standardMillisecondsPerUnit, 45_000);
      assert.equal(route.steps[1].productTimeEntryId, newProfile.entries[1].id);
      assert.equal(route.steps[1].status, 'pending');

      const progressedRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: progressedRouteId },
        include: {
          steps: { orderBy: { position: 'asc' } },
          completions: true,
        },
      });
      assert.equal(progressedRoute.productTimeProfileId, newProfile.id);
      assert.equal(progressedRoute.productTimeProfileVersion, 2);
      assert.equal(progressedRoute.version, 1);
      assert.equal(progressedRoute.steps[0].status, 'completed');
      assert.equal(progressedRoute.steps[0].standardMillisecondsPerUnit, 3_000);
      assert.equal(progressedRoute.steps[0].productTimeProfileVersion, 1);
      assert.equal(progressedRoute.steps[1].status, 'current');
      assert.equal(progressedRoute.steps[1].standardMillisecondsPerUnit, 45_000);
      assert.equal(progressedRoute.steps[1].productTimeProfileVersion, 2);
      assert.equal(progressedRoute.completions[0].standardMillisecondsPerUnit, 3_000);
      assert.equal(progressedRoute.completions[0].productTimeProfileVersion, 1);

      const withdrawn = await withdrawProcessCompletion({
        routeId: progressedRouteId,
        completionId: historicalCompletion.id,
        expectedRouteVersion: progressedRoute.version,
        category: 'REPORTING_ERROR',
        idempotencyKey: `${prefix}-WITHDRAW-COMPLETION`,
        userId: actor.id,
        actor: actor.displayName,
      });
      assert.equal(withdrawn.status, 'WITHDRAWN');
      assert.equal(withdrawn.routeVersion, 3);

      const reopenedRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: progressedRouteId },
        include: {
          steps: { orderBy: { position: 'asc' } },
          completions: true,
        },
      });
      assert.equal(reopenedRoute.version, 3);
      assert.equal(reopenedRoute.productTimeProfileId, newProfile.id);
      assert.equal(reopenedRoute.productTimeProfileVersion, 2);
      assert.equal(reopenedRoute.steps[0].status, 'current');
      assert.equal(reopenedRoute.steps[0].standardMillisecondsPerUnit, 6_000);
      assert.equal(reopenedRoute.steps[0].productTimeEntryId, newProfile.entries[0].id);
      assert.equal(reopenedRoute.steps[0].productTimeProfileVersion, 2);
      assert.equal(reopenedRoute.steps[1].status, 'pending');
      assert.equal(reopenedRoute.steps[1].standardMillisecondsPerUnit, 45_000);
      assert.ok(reopenedRoute.completions[0].voidedAt);
      assert.equal(reopenedRoute.completions[0].standardMillisecondsPerUnit, 3_000);
      assert.equal(reopenedRoute.completions[0].productTimeProfileVersion, 1);
      const [synchronizedTask, synchronizedAssignment] = await Promise.all([
        prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: dailyTask.id } }),
        prisma.dailyTaskAssignment.findUniqueOrThrow({ where: { id: dailyAssignment.id } }),
      ]);
      assert.equal(synchronizedTask.status, DailyProcessTaskStatus.READY);
      assert.equal(synchronizedTask.routeVersion, 3);
      assert.equal(synchronizedTask.standardMillisecondsPerUnit, 6_000);
      assert.equal(synchronizedTask.productTimeProfileId, newProfile.id);
      assert.equal(synchronizedTask.productTimeProfileVersion, 2);
      assert.equal(synchronizedAssignment.plannedStandardMilliseconds, 6_000_000n);

      const replay = await prisma.$transaction(
        tx => syncDraftRoutesFromPublishedProductTime(tx, {
          profileId: newProfile.id,
          actorId: actor.id,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      assert.equal(replay.activeUpdated, 0);
      const replayedRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: progressedRouteId },
        select: { version: true },
      });
      assert.equal(replayedRoute.version, 3);
    } finally {
      const routeIds = [routeId, progressedRouteId].filter(Boolean);
      const orderIds = [orderId, progressedOrderId].filter(Boolean);
      if (dailyTaskId) {
        await prisma.dailyPlanRevision.deleteMany({ where: { taskId: dailyTaskId } });
      }
      if (dailyAssignmentId) {
        await prisma.dailyTaskAssignment.deleteMany({ where: { id: dailyAssignmentId } });
      }
      if (dailyTaskId) await prisma.dailyProcessTask.deleteMany({ where: { id: dailyTaskId } });
      if (dailyPlanId) {
        await prisma.dailyPlanRevision.deleteMany({ where: { planId: dailyPlanId } });
        await prisma.dailyProductionPlan.deleteMany({ where: { id: dailyPlanId } });
      }
      if (progressedCompletionId) {
        await prisma.processCompletion.deleteMany({ where: { id: progressedCompletionId } });
      }
      if (routeIds.length) await prisma.processRouteActivity.deleteMany({ where: { routeId: { in: routeIds } } });
      if (orderIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: orderIds } } });
      if (routeIds.length) await prisma.operationLog.deleteMany({ where: { targetId: { in: routeIds } } });
      if (oldProfileId || newProfileId) {
        await prisma.productTimeProfile.deleteMany({
          where: { id: { in: [oldProfileId, newProfileId].filter(Boolean) } },
        });
      }
      if (drawingItemId) await prisma.drawingLibraryItem.deleteMany({ where: { id: drawingItemId } });
      if (definitionIds.length) await prisma.processDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
      if (teamId) await prisma.productionTeam.deleteMany({ where: { id: teamId } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
