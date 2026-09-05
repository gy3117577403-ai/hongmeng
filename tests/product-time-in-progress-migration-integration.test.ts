import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  ProcessMovementType,
  ProcessStepExecutionMode,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  previewProductTimeDeployment,
  publishProductTimeDeployment,
} from '../lib/product-time-deployment-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'in-progress product-time migration retires deleted reporting, carries open quantity, and permits factful moves',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-PT-IN-PROGRESS-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} user`,
      },
    });
    const employee = await prisma.employee.create({
      data: { employeeNo: `${prefix}-EMP`, name: `${prefix} employee`, department: '生产部' },
    });
    const workOrderIds: string[] = [];
    const definitionIds: string[] = [];
    const profileIds: string[] = [];
    let itemId = '';

    try {
      const [definitionA, definitionB, definitionC, definitionD] = await Promise.all([
        prisma.processDefinition.create({
          data: { code: `${prefix}-A`, name: '裁线', stageGroup: 'frontend', sortOrder: 1 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-B`, name: '剥皮', stageGroup: 'frontend', sortOrder: 2 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-C`, name: '穿号码管', stageGroup: 'frontend', sortOrder: 3 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-D`, name: '套热缩管', stageGroup: 'frontend', sortOrder: 4 },
        }),
      ]);
      definitionIds.push(definitionA.id, definitionB.id, definitionC.id, definitionD.id);
      const item = await prisma.drawingLibraryItem.create({
        data: {
          customerName: 'integration-test',
          productName: 'in-progress route migration',
          specification: `${prefix}-PRODUCT`,
          libraryKey: `${prefix}-LIBRARY`,
        },
      });
      itemId = item.id;
      const v1 = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 1,
          revision: 0,
          status: 'published',
          publishedAt: new Date('2026-08-20T00:00:00.000Z'),
          createdById: actor.id,
          updatedById: actor.id,
          publishedById: actor.id,
          entries: {
            create: [
              { processDefinitionId: definitionA.id, occurrenceKey: 'a', position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
              { processDefinitionId: definitionB.id, occurrenceKey: 'b', position: 2, sequenceGroup: 2, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
              { processDefinitionId: definitionC.id, occurrenceKey: 'c', position: 3, sequenceGroup: 3, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      profileIds.push(v1.id);
      const v2 = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 2,
          revision: 0,
          status: 'draft',
          createdById: actor.id,
          updatedById: actor.id,
          entries: {
            create: [
              { processDefinitionId: definitionA.id, occurrenceKey: 'a', position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
              { processDefinitionId: definitionC.id, occurrenceKey: 'c', position: 2, sequenceGroup: 2, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      profileIds.push(v2.id);
      const now = new Date('2026-08-20T04:00:00.000Z');
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          productName: item.productName || 'product',
          specification: item.specification,
          stage: 'frontend',
          status: 'processing',
          progress: 40,
          productionTargetQty: 10,
          uncompletedQty: '10',
          completedQty: '0',
          planType: 'managed_plan',
          drawingLibraryItemId: item.id,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${item.specification} 产品工时`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              routeSource: 'product_time_profile',
              productTimeProfileId: v1.id,
              productTimeProfileVersion: 1,
              startedAt: now,
              confirmedAt: new Date('2026-08-20T00:00:00.000Z'),
              confirmedById: actor.id,
              steps: {
                create: v1.entries.map((entry, index) => ({
                  processDefinitionId: entry.processDefinitionId,
                  processCode: [definitionA.code, definitionB.code, definitionC.code][index],
                  processName: [definitionA.name, definitionB.name, definitionC.name][index],
                  stageGroup: 'frontend',
                  position: entry.position,
                  sequenceGroup: entry.sequenceGroup,
                  productTimeProfileId: v1.id,
                  productTimeEntryId: entry.id,
                  productTimeProfileVersion: 1,
                  standardSource: 'product_profile',
                  timeBasis: 'per_unit',
                  unitLabel: '件',
                  standardMillisecondsPerUnit: 1_000,
                  inputQty: index === 0 || index === 1 ? 10 : 4,
                  processedQty: index === 0 ? 10 : index === 1 ? 4 : 0,
                  goodOutputQty: index === 0 ? 10 : index === 1 ? 4 : 0,
                  releasedGoodQty: index === 0 ? 10 : index === 1 ? 4 : 0,
                  status: index === 0 ? 'completed' : 'current',
                  startedAt: now,
                  completedAt: index === 0 ? now : null,
                  completedById: index === 0 ? actor.id : null,
                })),
              },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      workOrderIds.push(order.id);
      assert.ok(order.processRoute);
      const [stepA, stepB, stepC] = order.processRoute.steps;
      const workDate = new Date('2026-08-20T00:00:00.000Z');
      const completionA = await prisma.processCompletion.create({
        data: {
          workOrderId: order.id,
          routeId: order.processRoute.id,
          stepId: stepA.id,
          workDate,
          completedAt: now,
          processedQty: 10,
          goodQty: 10,
          defectQty: 0,
          reportedUnitQty: 10,
          reportedGoodUnitQty: 10,
          routeVersion: 0,
          idempotencyKey: `${prefix}-COMPLETION-A`,
          productTimeProfileId: v1.id,
          productTimeEntryId: v1.entries[0].id,
          productTimeProfileVersion: 1,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          principalEmployeeId: employee.id,
          participants: { create: { employeeId: employee.id, position: 0 } },
        },
      });
      const completionB = await prisma.processCompletion.create({
        data: {
          workOrderId: order.id,
          routeId: order.processRoute.id,
          stepId: stepB.id,
          workDate,
          completedAt: now,
          processedQty: 4,
          goodQty: 4,
          defectQty: 0,
          reportedUnitQty: 4,
          reportedGoodUnitQty: 4,
          routeVersion: 0,
          idempotencyKey: `${prefix}-COMPLETION-B`,
          productTimeProfileId: v1.id,
          productTimeEntryId: v1.entries[1].id,
          productTimeProfileVersion: 1,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          principalEmployeeId: employee.id,
          participants: { create: { employeeId: employee.id, position: 0 } },
        },
      });
      const pool = await prisma.processLaborPool.create({
        data: {
          completionId: completionB.id,
          workOrderId: order.id,
          stepId: stepB.id,
          workDate,
          eligibleQty: 4,
          claimedQty: 4,
          remainingQty: 0,
          status: ProcessLaborPoolStatus.EXHAUSTED,
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          totalStandardLaborMilliseconds: 4_000n,
          claimedStandardLaborMilliseconds: 4_000n,
          remainingStandardLaborMilliseconds: 0n,
          standardSource: 'product_profile',
          productTimeProfileVersion: 1,
        },
      });
      const originalAllocation = await prisma.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: employee.id,
          quantity: 4,
          standardLaborMilliseconds: 4_000n,
          workDate,
          status: ProcessLaborClaimStatus.ACTIVE,
          source: 'completion_auto',
          idempotencyKey: `${prefix}-EFFICIENCY`,
          claimedById: actor.id,
        },
      });
      await prisma.processQuantityMovement.createMany({
        data: [
          {
            completionId: completionA.id,
            workOrderId: order.id,
            sourceStepId: stepA.id,
            targetStepId: stepB.id,
            type: ProcessMovementType.GOOD_TRANSFER,
            quantity: 10,
            sourceSequenceGroup: 1,
            targetSequenceGroup: 2,
            idempotencyKey: `${prefix}-MOVE-A-B`,
          },
          {
            completionId: completionB.id,
            workOrderId: order.id,
            sourceStepId: stepB.id,
            targetStepId: stepC.id,
            type: ProcessMovementType.GOOD_TRANSFER,
            quantity: 4,
            sourceSequenceGroup: 2,
            targetSequenceGroup: 3,
            idempotencyKey: `${prefix}-MOVE-B-C`,
          },
        ],
      });

      const previewV2 = await previewProductTimeDeployment(item.id);
      assert.equal(previewV2.canPublish, true);
      assert.equal(previewV2.conflicts.some(conflict => conflict.code === 'DELETE_ACTIVE_QUANTITY_FACTS'), false);
      const previewRoute = previewV2.routes.find(route => route.workOrderId === order.id);
      assert.equal(previewRoute?.state, 'in_progress');
      assert.equal(previewRoute?.status, 'pending');
      assert.equal(previewRoute?.retiredProcesses, 1);
      assert.equal(previewRoute?.historicalReports, 1);
      assert.equal(previewRoute?.affectedEmployees, 1);

      await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: v2.revision,
        previewToken: previewV2.previewToken,
      });

      const migrated = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: order.processRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(migrated.productTimeProfileId, v2.id);
      assert.equal(migrated.productTimeProfileVersion, 2);
      assert.deepEqual(
        migrated.steps.filter(step => !step.retiredAt).map(step => step.processName),
        ['裁线', '穿号码管'],
      );
      const retiredB = migrated.steps.find(step => step.id === stepB.id);
      assert.ok(retiredB?.retiredAt);
      assert.equal(migrated.steps.find(step => step.id === stepC.id)?.inputQty, 10);
      const migratedMovements = await prisma.processQuantityMovement.findMany({
        where: { workOrderId: order.id },
        orderBy: { createdAt: 'asc' },
      });
      const originalIntoB = migratedMovements.find(movement => (
        movement.type === ProcessMovementType.GOOD_TRANSFER
        && movement.sourceStepId === stepA.id
        && movement.targetStepId === stepB.id
      ));
      assert.ok(originalIntoB);
      assert.equal(
        migratedMovements
          .filter(movement => movement.type === ProcessMovementType.REVERSAL && movement.reversalOfId === originalIntoB.id)
          .reduce((sum, movement) => sum + movement.quantity, 0),
        6,
      );
      assert.equal(
        migratedMovements
          .filter(movement => (
            movement.type === ProcessMovementType.GOOD_TRANSFER
            && movement.sourceStepId === stepA.id
            && movement.targetStepId === stepC.id
          ))
          .reduce((sum, movement) => sum + movement.quantity, 0),
        6,
      );
      const retiredCompletion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completionB.id } });
      assert.equal(retiredCompletion.countsForEfficiency, false);
      assert.equal(retiredCompletion.productTimeProfileId, v2.id);
      assert.equal(retiredCompletion.productTimeEntryId, null);
      assert.equal(retiredCompletion.productTimeProfileVersion, 2);
      assert.equal(retiredCompletion.routeVersion, 1);
      const retiredPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { id: pool.id } });
      assert.equal(retiredPool.status, ProcessLaborPoolStatus.VOIDED);
      assert.equal(retiredPool.countsForEfficiency, false);
      assert.equal(retiredPool.eligibleQty, 4);
      assert.equal(retiredPool.totalStandardLaborMilliseconds, 4_000n);
      const allocationRows = await prisma.processLaborClaim.findMany({
        where: { poolId: pool.id },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(allocationRows.find(row => row.id === originalAllocation.id)?.status, ProcessLaborClaimStatus.VOIDED);
      assert.equal(
        allocationRows.find(row => row.status === ProcessLaborClaimStatus.REVERSAL)?.standardLaborMilliseconds,
        -4_000n,
      );
      const bypassActivity = await prisma.processRouteActivity.findFirstOrThrow({
        where: { routeId: order.processRoute.id, action: 'product_time_deleted_step_quantity_bypassed' },
      });
      assert.match(bypassActivity.content ?? '', /6 件在途数量已承接/);

      const v3 = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 3,
          revision: 0,
          status: 'draft',
          createdById: actor.id,
          updatedById: actor.id,
          entries: {
            create: [
              { processDefinitionId: definitionC.id, occurrenceKey: 'c', position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
              { processDefinitionId: definitionD.id, occurrenceKey: 'd', position: 2, sequenceGroup: 2, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
              { processDefinitionId: definitionA.id, occurrenceKey: 'a', position: 3, sequenceGroup: 3, timeBasis: 'per_unit', unitMilliseconds: 1_000, occurrences: 1, unitLabel: '件' },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      profileIds.push(v3.id);
      const previewV3 = await previewProductTimeDeployment(item.id);
      assert.equal(previewV3.canPublish, true);
      assert.equal(previewV3.conflicts.some(conflict => conflict.code === 'MOVE_CROSSES_QUANTITY_FACTS'), false);
      assert.equal(previewV3.routes.find(route => route.workOrderId === order.id)?.movedProcesses, 2);
      assert.equal(previewV3.routes.find(route => route.workOrderId === order.id)?.insertedProcesses, 1);
      assert.equal(previewV3.routes.find(route => route.workOrderId === order.id)?.systemCoveredQty, 0);
      assert.equal(previewV3.routes.find(route => route.workOrderId === order.id)?.actualRequiredQty, 10);
      await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: v3.revision,
        previewToken: previewV3.previewToken,
      });
      const moved = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: order.processRoute.id },
        include: {
          steps: {
            where: { retiredAt: null },
            orderBy: { position: 'asc' },
            include: { supplementObligation: { include: { coverage: true } } },
          },
        },
      });
      assert.deepEqual(moved.steps.map(step => step.processName), ['穿号码管', '套热缩管', '裁线']);
      const insertedStep = moved.steps.find(step => step.processName === '套热缩管');
      assert.ok(insertedStep, 'a factful in-progress route must contain the newly published process');
      assert.equal(insertedStep.productTimeProfileId, v3.id);
      assert.equal(insertedStep.productTimeEntryId, v3.entries[1].id);
      assert.equal(insertedStep.productTimeProfileVersion, 3);
      assert.equal(insertedStep.executionMode, ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION);
      assert.ok(insertedStep.supplementObligation);
      assert.equal(insertedStep.supplementObligation.requiredQty, 10);
      assert.equal(insertedStep.supplementObligation.systemCoveredQty, 0);
      assert.equal(insertedStep.supplementObligation.fulfillmentMode, 'ACTUAL');
      assert.equal(insertedStep.supplementObligation.status, 'ACTIVE');
      assert.equal(insertedStep.supplementObligation.coverage?.policy, 'FULL_WORK_ORDER_REQUIRED');
      assert.equal(insertedStep.supplementObligation.coverage?.actualRequiredQty, 10);
      const movedCompletion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completionA.id } });
      assert.equal(movedCompletion.productTimeProfileId, v3.id);
      assert.equal(movedCompletion.productTimeProfileVersion, 3);
      assert.ok(movedCompletion.routeVersion > completionA.routeVersion && movedCompletion.routeVersion <= moved.version,
        'the report references its published route revision, including any subsequent coverage reconciliation');

      const terminalOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-TERMINAL-ORDER`,
          customerName: 'integration-test',
          productName: 'terminal delete migration',
          specification: item.specification,
          stage: 'backend',
          status: 'processing',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          planType: 'managed_plan',
          drawingLibraryItemId: item.id,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} terminal route`,
              templateVersion: 3,
              status: 'in_progress',
              version: 0,
              startedAt: now,
              confirmedAt: now,
              confirmedById: actor.id,
              routeSource: 'product_time_profile',
              productTimeProfileId: v3.id,
              productTimeProfileVersion: 3,
              steps: {
                create: [
                  {
                    processDefinitionId: definitionC.id,
                    processCode: definitionC.code,
                    processName: definitionC.name,
                    stageGroup: definitionC.stageGroup,
                    position: 1,
                    sequenceGroup: 1,
                    productTimeProfileId: v3.id,
                    productTimeEntryId: v3.entries[0].id,
                    productTimeProfileVersion: 3,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '件',
                    standardMillisecondsPerUnit: 1_000,
                    inputQty: 10,
                    processedQty: 10,
                    goodOutputQty: 10,
                    releasedGoodQty: 10,
                    status: 'completed',
                    startedAt: now,
                    completedAt: now,
                    completedById: actor.id,
                  },
                  {
                    processDefinitionId: definitionA.id,
                    processCode: definitionA.code,
                    processName: definitionA.name,
                    stageGroup: definitionA.stageGroup,
                    position: 2,
                    sequenceGroup: 2,
                    productTimeProfileId: v3.id,
                    productTimeEntryId: v3.entries[2].id,
                    productTimeProfileVersion: 3,
                    standardSource: 'product_profile',
                    timeBasis: 'per_unit',
                    unitLabel: '件',
                    standardMillisecondsPerUnit: 1_000,
                    inputQty: 10,
                    status: 'current',
                    startedAt: now,
                  },
                ],
              },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      assert.ok(terminalOrder.processRoute);
      workOrderIds.push(terminalOrder.id);
      const terminalSource = terminalOrder.processRoute.steps[0];
      const terminalRetired = terminalOrder.processRoute.steps[1];
      const terminalCompletion = await prisma.processCompletion.create({
        data: {
          workOrderId: terminalOrder.id,
          routeId: terminalOrder.processRoute.id,
          stepId: terminalSource.id,
          workDate,
          completedAt: now,
          processedQty: 10,
          goodQty: 10,
          defectQty: 0,
          reportedUnitQty: 10,
          reportedGoodUnitQty: 10,
          routeVersion: 0,
          idempotencyKey: `${prefix}-TERMINAL-COMPLETION`,
          productTimeProfileId: v3.id,
          productTimeEntryId: v3.entries[0].id,
          productTimeProfileVersion: 3,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          principalEmployeeId: employee.id,
          participants: { create: { employeeId: employee.id, position: 0 } },
        },
      });
      const terminalIncoming = await prisma.processQuantityMovement.create({
        data: {
          completionId: terminalCompletion.id,
          workOrderId: terminalOrder.id,
          sourceStepId: terminalSource.id,
          targetStepId: terminalRetired.id,
          type: ProcessMovementType.GOOD_TRANSFER,
          quantity: 10,
          sourceSequenceGroup: 1,
          targetSequenceGroup: 2,
          idempotencyKey: `${prefix}-TERMINAL-INCOMING`,
        },
      });

      const v4 = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 4,
          revision: 0,
          status: 'draft',
          createdById: actor.id,
          updatedById: actor.id,
          entries: {
            create: {
              processDefinitionId: definitionC.id,
              occurrenceKey: 'c',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 1_000,
              occurrences: 1,
              unitLabel: '件',
            },
          },
        },
      });
      profileIds.push(v4.id);
      const previewV4 = await previewProductTimeDeployment(item.id);
      assert.equal(previewV4.canPublish, true);
      await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: v4.revision,
        previewToken: previewV4.previewToken,
      });
      const completedTerminal = await prisma.workOrder.findUniqueOrThrow({
        where: { id: terminalOrder.id },
        include: { processRoute: { include: { steps: true } } },
      });
      assert.equal(completedTerminal.completedQty, '10');
      assert.equal(completedTerminal.stage, 'completed');
      assert.equal(completedTerminal.status, 'done');
      assert.ok(completedTerminal.completedAt);
      assert.equal(completedTerminal.processRoute?.status, 'completed');
      assert.ok(completedTerminal.processRoute?.steps.find(step => step.id === terminalRetired.id)?.retiredAt);
      const terminalMovements = await prisma.processQuantityMovement.findMany({
        where: { workOrderId: terminalOrder.id },
      });
      assert.equal(
        terminalMovements
          .filter(movement => movement.type === ProcessMovementType.REVERSAL && movement.reversalOfId === terminalIncoming.id)
          .reduce((sum, movement) => sum + movement.quantity, 0),
        10,
      );
      assert.equal(
        terminalMovements
          .filter(movement => movement.type === ProcessMovementType.FINISHED_GOOD)
          .reduce((sum, movement) => sum + movement.quantity, 0),
        10,
      );
    } finally {
      if (workOrderIds.length) {
        const routes = await prisma.workOrderProcessRoute.findMany({
          where: { workOrderId: { in: workOrderIds } },
          select: { id: true, steps: { select: { id: true } } },
        });
        const routeIds = routes.map(route => route.id);
        const stepIds = routes.flatMap(route => route.steps.map(step => step.id));
        const completions = await prisma.processCompletion.findMany({
          where: { workOrderId: { in: workOrderIds } },
          select: { id: true },
        });
        const completionIds = completions.map(completion => completion.id);
        const pools = await prisma.processLaborPool.findMany({
          where: { workOrderId: { in: workOrderIds } },
          select: { id: true },
        });
        await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: pools.map(pool => pool.id) } } });
        await prisma.processLaborPool.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
        await prisma.processExecution.deleteMany({ where: { stepId: { in: stepIds } } });
        await prisma.processCompletionParticipant.deleteMany({ where: { completionId: { in: completionIds } } });
        await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
        await prisma.processCompletion.deleteMany({ where: { id: { in: completionIds } } });
        await prisma.processSupplementCoverage.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
        await prisma.processSupplementObligation.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
        await prisma.productTimeDeploymentRoute.deleteMany({ where: { routeId: { in: routeIds } } });
        await prisma.workOrderProcessStep.deleteMany({ where: { routeId: { in: routeIds } } });
        await prisma.workOrderProcessRoute.deleteMany({ where: { id: { in: routeIds } } });
        await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      }
      if (profileIds.length) {
        await prisma.productTimeDeployment.deleteMany({ where: { profileId: { in: profileIds } } });
        await prisma.productTimeProfile.deleteMany({ where: { id: { in: profileIds } } });
      }
      if (itemId) await prisma.drawingLibraryItem.deleteMany({ where: { id: itemId } });
      if (definitionIds.length) await prisma.processDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
