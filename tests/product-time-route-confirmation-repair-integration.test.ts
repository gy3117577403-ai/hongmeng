import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  applyPublishedProductTimeToWorkOrder,
  reconcileDraftProductTimeRoutes,
} from '../lib/process-routing';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'draft product-time routes are confirmed by both direct apply and background reconciliation',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-PT-ROUTE-REPAIR-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} user`,
      },
    });
    const definition = await prisma.processDefinition.create({
      data: { code: `${prefix}-CUT`, name: '裁线', stageGroup: 'frontend', sortOrder: 1 },
    });
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        productName: 'route confirmation repair',
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
        entries: {
          create: {
            processDefinitionId: definition.id,
            occurrenceKey: 'cut-1',
            position: 1,
            sequenceGroup: 1,
            timeBasis: 'per_unit',
            unitMilliseconds: 1_000,
            unitLabel: '件',
          },
        },
      },
      include: { entries: true },
    });
    const workOrderIds: string[] = [];

    async function createBrokenRoute(suffix: string) {
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-${suffix}`,
          productName: item.productName || 'product',
          specification: item.specification,
          stage: 'not_issued',
          status: 'pending',
          planType: 'managed_plan',
          productionTargetQty: 10,
          uncompletedQty: '10',
          completedQty: '0',
          drawingLibraryItemId: item.id,
          processRoute: {
            create: {
              templateName: `${item.specification} 产品工时`,
              templateVersion: profile.version,
              routeSource: 'product_time_profile',
              productTimeProfileId: profile.id,
              productTimeProfileVersion: profile.version,
              status: 'draft',
              steps: {
                create: {
                  processDefinitionId: definition.id,
                  processCode: definition.code,
                  processName: definition.name,
                  stageGroup: definition.stageGroup,
                  position: 1,
                  sequenceGroup: 1,
                  productTimeProfileId: profile.id,
                  productTimeEntryId: profile.entries[0].id,
                  productTimeProfileVersion: profile.version,
                  standardSource: 'product_profile',
                  timeBasis: 'per_unit',
                  unitLabel: '件',
                  standardMillisecondsPerUnit: 1_000,
                  inputQty: 0,
                  status: 'pending',
                },
              },
            },
          },
        },
        include: { processRoute: true },
      });
      workOrderIds.push(order.id);
      assert.ok(order.processRoute);
      return order;
    }

    try {
      const directOrder = await createBrokenRoute('DIRECT');
      const direct = await prisma.$transaction(tx => applyPublishedProductTimeToWorkOrder(tx, {
        workOrderId: directOrder.id,
        actorId: actor.id,
      }));
      assert.equal(direct.action, 'updated');
      const directRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: directOrder.processRoute!.id },
        include: { steps: true },
      });
      assert.equal(directRoute.status, 'confirmed');
      assert.ok(directRoute.confirmedAt);
      assert.equal(directRoute.confirmedById, actor.id);
      assert.equal(directRoute.steps[0]?.inputQty, 10);

      const replay = await prisma.$transaction(tx => applyPublishedProductTimeToWorkOrder(tx, {
        workOrderId: directOrder.id,
        actorId: actor.id,
      }));
      assert.equal(replay.action, 'already_applied');

      const backgroundOrder = await createBrokenRoute('BACKGROUND');
      const reconciliation = await prisma.$transaction(tx => reconcileDraftProductTimeRoutes(tx, {
        workOrderWhere: { id: backgroundOrder.id },
        actorId: actor.id,
        limit: 10,
      }));
      assert.equal(reconciliation.scanned, 1);
      assert.equal(reconciliation.applied, 1);
      assert.equal(reconciliation.updated, 1);
      assert.equal(reconciliation.hasMore, false);
      const backgroundRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: backgroundOrder.processRoute!.id },
        include: { steps: true },
      });
      assert.equal(backgroundRoute.status, 'confirmed');
      assert.ok(backgroundRoute.confirmedAt);
      assert.equal(backgroundRoute.confirmedById, actor.id);
      assert.equal(backgroundRoute.steps[0]?.inputQty, 10);
    } finally {
      const routes = await prisma.workOrderProcessRoute.findMany({
        where: { workOrderId: { in: workOrderIds } },
        select: { id: true },
      });
      const routeIds = routes.map(route => route.id);
      await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: { in: routeIds } } });
      await prisma.workOrderProcessRoute.deleteMany({ where: { id: { in: routeIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      await prisma.productTimeProfile.deleteMany({ where: { id: profile.id } });
      await prisma.drawingLibraryItem.deleteMany({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({ where: { id: definition.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
