import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  previewProductTimeDeployment,
  publishProductTimeDeployment,
} from '../lib/product-time-deployment-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'deployment does not conflict with its own quantity-version increment when inserting before input',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-DEPLOY-VERSION-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} publisher`,
      },
    });
    const [firstDefinition, insertedDefinition] = await Promise.all([
      prisma.processDefinition.create({
        data: { code: `${prefix}-A`, name: '原首道工序', stageGroup: 'frontend', sortOrder: 1 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-NEW`, name: '新增首道工序', stageGroup: 'frontend', sortOrder: 2 },
      }),
    ]);
    const item = await prisma.drawingLibraryItem.create({
      data: {
        customerName: 'integration-test',
        specification: prefix,
        productName: 'deployment version test',
        libraryKey: `${prefix}-LIBRARY`,
      },
    });
    const published = await prisma.productTimeProfile.create({
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
            processDefinitionId: firstDefinition.id,
            occurrenceKey: 'first-existing',
            position: 1,
            sequenceGroup: 1,
            timeBasis: 'per_unit',
            unitMilliseconds: 1_000,
            unitLabel: '套',
          },
        },
      },
      include: { entries: true },
    });
    const draft = await prisma.productTimeProfile.create({
      data: {
        drawingLibraryItemId: item.id,
        version: 2,
        revision: 0,
        status: 'draft',
        createdById: actor.id,
        updatedById: actor.id,
        entries: {
          create: [
            {
              processDefinitionId: insertedDefinition.id,
              occurrenceKey: 'inserted-first',
              position: 1,
              sequenceGroup: 1,
              timeBasis: 'per_unit',
              unitMilliseconds: 500,
              unitLabel: '套',
            },
            {
              processDefinitionId: firstDefinition.id,
              occurrenceKey: 'first-existing',
              position: 2,
              sequenceGroup: 2,
              timeBasis: 'per_unit',
              unitMilliseconds: 1_000,
              unitLabel: '套',
            },
          ],
        },
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        productName: item.productName || 'product',
        specification: item.specification,
        stage: 'not_issued',
        status: 'pending',
        productionTargetQty: 10,
        uncompletedQty: '10',
        completedQty: '0',
        planType: 'managed_plan',
        drawingLibraryItemId: item.id,
        processRoute: {
          create: {
            templateName: `${prefix} product route`,
            templateVersion: 1,
            status: 'confirmed',
            version: 0,
            routeSource: 'product_time_profile',
            productTimeProfileId: published.id,
            productTimeProfileVersion: 1,
            confirmedAt: new Date(),
            confirmedById: actor.id,
            steps: {
              create: {
                processDefinitionId: firstDefinition.id,
                processCode: firstDefinition.code,
                processName: firstDefinition.name,
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                productTimeProfileId: published.id,
                productTimeEntryId: published.entries[0].id,
                productTimeProfileVersion: 1,
                standardSource: 'product_profile',
                timeBasis: 'per_unit',
                unitLabel: '套',
                standardMillisecondsPerUnit: 1_000,
                inputQty: 10,
                status: 'pending',
              },
            },
          },
        },
      },
      include: { processRoute: { include: { steps: true } } },
    });
    assert.ok(order.processRoute);
    const originalStepId = order.processRoute.steps[0].id;

    try {
      const preview = await previewProductTimeDeployment(item.id);
      assert.equal(preview.canPublish, true);
      const result = await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
        previewToken: preview.previewToken,
      });
      assert.equal(result.deployment.status, 'active');
      assert.equal(
        result.deployment.routes.find(route => route.workOrderId === order.id)?.status,
        'succeeded',
      );

      const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: order.processRoute.id },
        include: {
          steps: {
            where: { retiredAt: null },
            orderBy: { position: 'asc' },
            include: { productTimeEntry: { select: { occurrenceKey: true } } },
          },
        },
      });
      assert.deepEqual(route.steps.map(step => step.productTimeEntry?.occurrenceKey), [
        'inserted-first',
        'first-existing',
      ]);
      assert.deepEqual(route.steps.map(step => step.inputQty), [10, 0]);
      assert.equal(route.steps[0].status, 'pending');
      assert.equal(route.steps[1].id, originalStepId);
      assert.equal(route.steps[1].status, 'pending');
    } finally {
      await prisma.productTimeDeployment.deleteMany({
        where: { drawingLibraryItemId: item.id },
      });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({
        where: { id: { in: [firstDefinition.id, insertedDefinition.id] } },
      });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
