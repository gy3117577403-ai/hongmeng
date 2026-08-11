import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  activateProcessRouteChange,
  createProcessRouteChangeProposal,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';
import { loadFieldReportTicket } from '../lib/work-order-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'route change inserts a second occurrence of an existing process without collapsing current, QR, profile or future routes',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RC-DUP-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
      },
    });
    const workOrderIds: string[] = [];
    const routeIds: string[] = [];
    const definitionIds: string[] = [];
    let drawingItemId = '';
    let changeId = '';
    let changeRequestId = '';
    let publicCode = '';
    try {
      const [stripping, packing] = await Promise.all([
        prisma.processDefinition.create({
          data: { code: `${prefix}-STRIP`, name: '剥皮', stageGroup: 'frontend', sortOrder: 1 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-PACK`, name: '包装', stageGroup: 'finish', sortOrder: 2 },
        }),
      ]);
      definitionIds.push(stripping.id, packing.id);
      const item = await prisma.drawingLibraryItem.create({
        data: {
          customerName: 'integration-test',
          productName: 'duplicate occurrence product',
          specification: `${prefix}-PRODUCT`,
          libraryKey: `${prefix}-LIBRARY`,
        },
      });
      drawingItemId = item.id;
      const sourceProfile = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 1,
          status: 'published',
          publishedAt: new Date(),
          createdById: actor.id,
          updatedById: actor.id,
          publishedById: actor.id,
          entries: {
            create: [
              {
                processDefinitionId: stripping.id,
                occurrenceKey: `${prefix}:strip:original`,
                position: 1,
                sequenceGroup: 1,
                timeBasis: 'per_unit',
                unitMilliseconds: 1_000,
                occurrences: 1,
                unitLabel: '件',
              },
              {
                processDefinitionId: packing.id,
                occurrenceKey: `${prefix}:pack`,
                position: 2,
                sequenceGroup: 2,
                timeBasis: 'per_unit',
                unitMilliseconds: 2_000,
                occurrences: 1,
                unitLabel: '件',
              },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      const startedAt = new Date('2026-08-11T05:00:00.000Z');

      async function createOrder(input: {
        suffix: string;
        stage: string;
        status: string;
        routeStatus: string;
        routeSource: string;
        startedAt: Date | null;
        firstStepStatus: string;
      }) {
        const order = await prisma.workOrder.create({
          data: {
            code: `${prefix}-${input.suffix}`,
            customerName: 'integration-test',
            productName: 'duplicate occurrence product',
            specification: item.specification,
            stage: input.stage,
            status: input.status,
            planType: 'managed_plan',
            productionTargetQty: 10,
            uncompletedQty: '10',
            completedQty: '0',
            frontendTransferredQty: 0,
            drawingLibraryItemId: item.id,
            startedAt: input.startedAt,
            processRoute: {
              create: {
                templateName: `${item.specification} 产品工时`,
                templateVersion: sourceProfile.version,
                status: input.routeStatus,
                version: 0,
                routeSource: input.routeSource,
                productTimeProfileId: sourceProfile.id,
                productTimeProfileVersion: sourceProfile.version,
                startedAt: input.startedAt,
                confirmedAt: input.routeStatus === 'draft' ? null : startedAt,
                confirmedById: input.routeStatus === 'draft' ? null : actor.id,
                steps: {
                  create: [
                    {
                      processDefinitionId: stripping.id,
                      processCode: stripping.code,
                      processName: stripping.name,
                      stageGroup: stripping.stageGroup,
                      position: 1,
                      sequenceGroup: 1,
                      productTimeProfileId: sourceProfile.id,
                      productTimeEntryId: sourceProfile.entries[0].id,
                      productTimeProfileVersion: sourceProfile.version,
                      standardSource: 'product_profile',
                      timeBasis: 'per_unit',
                      unitLabel: '件',
                      standardMillisecondsPerUnit: 1_000,
                      inputQty: input.firstStepStatus === 'current' ? 10 : 0,
                      status: input.firstStepStatus,
                      startedAt: input.firstStepStatus === 'current' ? startedAt : null,
                    },
                    {
                      processDefinitionId: packing.id,
                      processCode: packing.code,
                      processName: packing.name,
                      stageGroup: packing.stageGroup,
                      position: 2,
                      sequenceGroup: 2,
                      productTimeProfileId: sourceProfile.id,
                      productTimeEntryId: sourceProfile.entries[1].id,
                      productTimeProfileVersion: sourceProfile.version,
                      standardSource: 'product_profile',
                      timeBasis: 'per_unit',
                      unitLabel: '件',
                      standardMillisecondsPerUnit: 2_000,
                      status: 'pending',
                    },
                  ],
                },
              },
            },
          },
          include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
        });
        assert.ok(order.processRoute);
        workOrderIds.push(order.id);
        routeIds.push(order.processRoute.id);
        return order;
      }

      const currentOrder = await createOrder({
        suffix: 'CURRENT',
        stage: 'frontend',
        status: 'processing',
        routeStatus: 'in_progress',
        routeSource: 'product_time_profile',
        startedAt,
        firstStepStatus: 'current',
      });
      const futureDraftOrder = await createOrder({
        suffix: 'FUTURE-DRAFT',
        stage: 'not_issued',
        status: 'pending',
        routeStatus: 'draft',
        routeSource: 'product_time_profile',
        startedAt: null,
        firstStepStatus: 'pending',
      });
      const futureFactFreeOrder = await createOrder({
        suffix: 'FUTURE-FACT-FREE',
        stage: 'frontend',
        status: 'processing',
        routeStatus: 'in_progress',
        routeSource: 'product_time_profile',
        startedAt,
        firstStepStatus: 'current',
      });
      const currentRoute = currentOrder.processRoute!;
      const targetPackingStep = currentRoute.steps[1];
      publicCode = `${prefix.replace(/[^A-Za-z0-9_-]/g, '')}-PUBLIC-CODE`.slice(0, 80);
      await prisma.workOrderQrTicket.create({
        data: { workOrderId: currentOrder.id, publicCode, createdById: actor.id },
      });
      const beforeTicket = await loadFieldReportTicket(publicCode, { recordScan: false });
      assert.equal(beforeTicket.route?.steps.filter(step => step.processName === '剥皮').length, 1);

      const proposal = await createProcessRouteChangeProposal({
        routeId: currentRoute.id,
        title: '在包装前增加第二次剥皮',
        reason: '产品需要在不同位置执行两次剥皮',
        scope: 'CURRENT_WORK_ORDER_AND_FUTURE_PRODUCT',
        expectedRouteVersion: currentRoute.version,
        expectedVersion: currentRoute.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
        idempotencyKey: `${prefix}-create`,
        diffs: [{
          kind: 'INSERT_STEP',
          processDefinitionId: stripping.id,
          targetStepId: targetPackingStep.id,
          afterData: {
            processName: stripping.name,
            standardMillisecondsPerUnit: 9_000,
            requiredQty: 10,
            unitLabel: '件',
          },
        }],
      });
      changeId = proposal.id;
      const storedChange = await prisma.processRouteChange.findUniqueOrThrow({
        where: { id: proposal.id },
        select: { changeRequestId: true },
      });
      changeRequestId = storedChange.changeRequestId;
      const submitted = await submitProcessRouteChange({
        changeId: proposal.id,
        expectedVersion: proposal.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
        idempotencyKey: `${prefix}-submit`,
      });
      const reviewed = await reviewProcessRouteChange({
        changeId: proposal.id,
        decision: 'approve',
        expectedVersion: submitted.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
        idempotencyKey: `${prefix}-approve`,
      });
      const activated = await activateProcessRouteChange({
        changeId: proposal.id,
        expectedVersion: reviewed.version,
        expectedRouteVersion: currentRoute.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
        idempotencyKey: `${prefix}-activate`,
      });
      assert.equal(activated.status, 'ACTIVE');

      const publishedProfile = await prisma.productTimeProfile.findFirstOrThrow({
        where: { drawingLibraryItemId: item.id, status: 'published' },
        orderBy: { version: 'desc' },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      const profileStrippingEntries = publishedProfile.entries.filter(entry => entry.processDefinitionId === stripping.id);
      assert.equal(profileStrippingEntries.length, 2);
      assert.equal(new Set(profileStrippingEntries.map(entry => entry.id)).size, 2);
      assert.equal(new Set(profileStrippingEntries.map(entry => entry.occurrenceKey)).size, 2);
      assert.deepEqual(profileStrippingEntries.map(entry => entry.unitMilliseconds), [1_000, 9_000]);

      async function assertRouteOccurrences(routeId: string) {
        const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { id: routeId },
          include: {
            steps: {
              orderBy: { position: 'asc' },
              include: { productTimeEntry: true },
            },
          },
        });
        const strippingSteps = route.steps.filter(step => step.processDefinitionId === stripping.id);
        assert.equal(strippingSteps.length, 2);
        assert.equal(new Set(strippingSteps.map(step => step.id)).size, 2);
        assert.equal(new Set(strippingSteps.map(step => step.productTimeEntryId)).size, 2);
        assert.deepEqual(strippingSteps.map(step => step.standardMillisecondsPerUnit), [1_000, 9_000]);
        assert.deepEqual(
          strippingSteps.map(step => step.productTimeEntry?.occurrenceKey),
          profileStrippingEntries.map(entry => entry.occurrenceKey),
        );
        return route;
      }

      const [currentAfter, draftAfter, factFreeAfter] = await Promise.all([
        assertRouteOccurrences(currentRoute.id),
        assertRouteOccurrences(futureDraftOrder.processRoute!.id),
        assertRouteOccurrences(futureFactFreeOrder.processRoute!.id),
      ]);
      assert.equal(currentAfter.productTimeProfileId, publishedProfile.id);
      assert.equal(draftAfter.productTimeProfileId, publishedProfile.id);
      assert.equal(factFreeAfter.productTimeProfileId, publishedProfile.id);

      const afterTicket = await loadFieldReportTicket(publicCode, { recordScan: false });
      assert.equal(afterTicket.publicCode, beforeTicket.publicCode);
      const qrStrippingSteps = afterTicket.route?.steps.filter(step => step.processName === '剥皮') || [];
      assert.equal(qrStrippingSteps.length, 2);
      assert.deepEqual(qrStrippingSteps.map(step => step.standardMillisecondsPerUnit), [1_000, 9_000]);
      assert.equal(qrStrippingSteps.filter(step => step.changeTag === 'ADDED').length, 1);
    } finally {
      if (publicCode) await prisma.workOrderQrTicket.deleteMany({ where: { publicCode } });
      if (routeIds.length) await prisma.processRouteActivity.deleteMany({ where: { routeId: { in: routeIds } } });
      if (changeId) {
        await prisma.processSupplementObligation.deleteMany({ where: { changeId } });
        await prisma.processRouteChangeDiff.deleteMany({ where: { changeId } });
        await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId } });
        await prisma.processRouteChangeEvent.deleteMany({ where: { changeId } });
        await prisma.processRouteChange.deleteMany({ where: { id: changeId } });
      }
      if (changeRequestId) await prisma.changeRequest.deleteMany({ where: { id: changeRequestId } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: { in: routeIds } } });
      await prisma.workOrderProcessRoute.deleteMany({ where: { id: { in: routeIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      if (drawingItemId) await prisma.productTimeProfile.deleteMany({ where: { drawingLibraryItemId: drawingItemId } });
      if (drawingItemId) await prisma.drawingLibraryItem.deleteMany({ where: { id: drawingItemId } });
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
