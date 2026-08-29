import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  ProcessStepExecutionMode,
  ProcessSupplementFulfillmentMode,
  ProcessSupplementObligationStatus,
  ProductTimeDeploymentRouteStatus,
  ProductTimeDeploymentStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

function applyRebaselineMigrationAgain(): void {
  execFileSync(process.execPath, [
    resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'db',
    'execute',
    '--file',
    resolve(
      process.cwd(),
      'prisma',
      'migrations',
      '202608290002_full_workorder_supplement_rebaseline',
      'migration.sql',
    ),
    '--schema',
    resolve(process.cwd(), 'prisma', 'schema.prisma'),
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });
}

test(
  'legacy system-covered insertions are rebaselined to the full open-work-order target without fabricated facts',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-FULL-SUPPLEMENT-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} user`,
      },
    });
    const definition = await prisma.processDefinition.create({
      data: {
        code: `${prefix}-PROCESS`,
        name: '历史新增补充工序',
        stageGroup: 'backend',
      },
    });
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        productName: 'full supplement rebaseline',
        specification: `${prefix}-PRODUCT`,
        libraryKey: `${prefix}-LIBRARY`,
      },
    });
    const profile = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 1,
        revision: 0,
        status: 'published',
        publishedAt: new Date(),
        createdById: actor.id,
        updatedById: actor.id,
        publishedById: actor.id,
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER-610`,
        productName: item.productName || 'product',
        specification: item.specification,
        stage: 'backend',
        status: 'processing',
        progress: 60,
        productionTargetQty: 50,
        uncompletedQty: '50',
        completedQty: '0',
        planType: 'managed_plan',
        drawingLibraryItemId: item.id,
        startedAt: new Date(),
        processRoute: {
          create: {
            templateName: `${prefix} route`,
            templateVersion: 1,
            status: 'in_progress',
            version: 7,
            routeSource: 'product_time_profile',
            productTimeProfileId: profile.id,
            productTimeProfileVersion: profile.version,
            startedAt: new Date(),
            confirmedAt: new Date(),
            confirmedById: actor.id,
            steps: {
              create: {
                processDefinitionId: definition.id,
                processCode: definition.code,
                processName: definition.name,
                stageGroup: definition.stageGroup,
                position: 4,
                sequenceGroup: 4,
                productTimeProfileId: profile.id,
                productTimeProfileVersion: profile.version,
                standardSource: 'product_time_deployment',
                timeBasis: 'per_unit',
                unitLabel: '套',
                standardMillisecondsPerUnit: 1_000,
                executionMode: ProcessStepExecutionMode.SUPPLEMENTAL_OBLIGATION,
                changeSource: 'NEW',
                inputQty: 0,
                processedQty: 0,
                goodOutputQty: 0,
                defectOutputQty: 0,
                releasedGoodQty: 0,
                quantityVersion: 3,
                status: 'completed',
                completedAt: new Date(),
                remark: '系统历史承接 50，不生成员工报工或工时',
              },
            },
          },
        },
      },
      include: { processRoute: { include: { steps: true } } },
    });
    assert.ok(order.processRoute);
    const route = order.processRoute;
    const step = route.steps[0];
    const deployment = await prisma.productTimeDeployment.create({
      data: {
        drawingLibraryItemId: item.id,
        profileId: profile.id,
        profileVersion: profile.version,
        expectedRevision: profile.revision,
        previewToken: `${prefix}-PREVIEW`,
        idempotencyKey: `${prefix}-DEPLOYMENT`,
        status: ProductTimeDeploymentStatus.ACTIVE,
        impact: {},
        diffs: [],
        conflicts: [],
        actorId: actor.id,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const deploymentRoute = await prisma.productTimeDeploymentRoute.create({
      data: {
        deploymentId: deployment.id,
        workOrderId: order.id,
        routeId: route.id,
        workOrderState: 'in_progress',
        status: ProductTimeDeploymentRouteStatus.SUCCEEDED,
        routeVersionBefore: 6,
        routeVersionAfter: 7,
        result: {},
      },
    });
    const obligation = await prisma.processSupplementObligation.create({
      data: {
        deploymentRouteId: deploymentRoute.id,
        occurrenceKey: 'legacy-insert',
        workOrderId: order.id,
        routeId: route.id,
        displayStepId: step.id,
        processDefinitionId: definition.id,
        source: 'NEW',
        processCode: definition.code,
        processName: definition.name,
        stageGroup: definition.stageGroup,
        displayPosition: step.position,
        intendedSequenceGroup: step.sequenceGroup,
        requiredQty: 50,
        systemCoveredQty: 50,
        status: ProcessSupplementObligationStatus.FULFILLED,
        fulfillmentMode: ProcessSupplementFulfillmentMode.SYSTEM_COVERED,
        releasePolicy: 'NONE',
        timeBasis: 'per_unit',
        unitLabel: '套',
        standardMillisecondsPerUnit: 1_000,
        unitsPerProduct: 1,
        fulfilledAt: new Date(),
      },
    });
    await prisma.processSupplementCoverage.create({
      data: {
        obligationId: obligation.id,
        deploymentRouteId: deploymentRoute.id,
        workOrderId: order.id,
        routeId: route.id,
        displayStepId: step.id,
        policy: 'AUTO_BY_PROGRESS',
        fulfillmentMode: ProcessSupplementFulfillmentMode.SYSTEM_COVERED,
        routeTargetQty: 50,
        systemCoveredQty: 50,
        actualRequiredQty: 0,
        evidence: { source: 'integration_legacy_fixture' },
        actorId: actor.id,
      },
    });

    try {
      applyRebaselineMigrationAgain();

      const [rebaselined, rebaselinedStep, rebaselinedRoute] = await Promise.all([
        prisma.processSupplementObligation.findUniqueOrThrow({
          where: { id: obligation.id },
          include: { coverage: true },
        }),
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: step.id } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } }),
      ]);
      assert.equal(rebaselined.requiredQty, 50);
      assert.equal(rebaselined.systemCoveredQty, 0);
      assert.equal(rebaselined.fulfillmentMode, ProcessSupplementFulfillmentMode.ACTUAL);
      assert.equal(rebaselined.status, ProcessSupplementObligationStatus.ACTIVE);
      assert.equal(rebaselined.reportedQty, 0);
      assert.equal(rebaselined.version, 1);
      assert.equal(rebaselined.coverage?.policy, 'FULL_WORK_ORDER_REQUIRED');
      assert.equal(rebaselined.coverage?.systemCoveredQty, 0);
      assert.equal(rebaselined.coverage?.actualRequiredQty, 50);
      assert.equal(rebaselinedStep.status, 'current');
      assert.equal(rebaselinedStep.inputQty, 0);
      assert.equal(rebaselinedStep.processedQty, 0);
      assert.equal(rebaselinedStep.releasedGoodQty, 0);
      assert.equal(rebaselinedStep.quantityVersion, 4);
      assert.equal(rebaselinedRoute.version, 8);
      assert.equal(await prisma.processCompletion.count({ where: { workOrderId: order.id } }), 0);
      assert.equal(await prisma.processQuantityMovement.count({ where: { workOrderId: order.id } }), 0);
      assert.equal(await prisma.processLaborPool.count({ where: { workOrderId: order.id } }), 0);
      assert.equal(await prisma.processRouteActivity.count({
        where: { routeId: route.id, action: 'rebaseline_supplement_full_workorder' },
      }), 1);
      assert.equal(await prisma.operationLog.count({
        where: {
          targetId: obligation.id,
          action: 'rebaseline_supplement_full_workorder',
        },
      }), 1);

      applyRebaselineMigrationAgain();
      const replay = await prisma.processSupplementObligation.findUniqueOrThrow({
        where: { id: obligation.id },
        include: { route: true },
      });
      assert.equal(replay.version, 1, 'replay must not mutate an already rebaselined obligation');
      assert.equal(replay.route.version, 8, 'replay must not increment the route version');
      assert.equal(await prisma.processRouteActivity.count({
        where: { routeId: route.id, action: 'rebaseline_supplement_full_workorder' },
      }), 1, 'replay must not duplicate the audit activity');
    } finally {
      await prisma.operationLog.deleteMany({ where: { targetId: obligation.id } });
      await prisma.processRouteActivity.deleteMany({ where: { routeId: route.id } });
      await prisma.processSupplementCoverage.deleteMany({ where: { obligationId: obligation.id } });
      await prisma.processSupplementObligation.deleteMany({ where: { id: obligation.id } });
      await prisma.productTimeDeploymentRoute.deleteMany({ where: { id: deploymentRoute.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: route.id } });
      await prisma.workOrderProcessRoute.deleteMany({ where: { id: route.id } });
      await prisma.workOrder.deleteMany({ where: { id: order.id } });
      await prisma.productTimeDeployment.deleteMany({ where: { id: deployment.id } });
      await prisma.productTimeProfile.deleteMany({ where: { id: profile.id } });
      await prisma.drawingLibraryItem.deleteMany({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({ where: { id: definition.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
