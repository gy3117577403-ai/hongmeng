import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  ProcessLaborClaimStatus,
  ProcessLaborPoolStatus,
  WorkOrderQrPrintMaterial,
  WorkOrderQrPrintStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  previewProductTimeDeployment,
  publishProductTimeDeployment,
} from '../lib/product-time-deployment-service';
import { loadFieldReportTicket } from '../lib/work-order-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'full product-time deployment updates active routes while freezing completed history',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-PT-DEPLOY-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
    const definitionIds: string[] = [];
    const workOrderIds: string[] = [];
    let itemId = '';
    let oldProfileId = '';
    let draftProfileId = '';
    let followupProfileId = '';
    let oldClaimId = '';
    let completedRouteId = '';
    let factFreeRouteId = '';
    let completedTicketCode = '';
    let firstAId = '';
    let secondAId = '';

    try {
      const [definitionA, definitionB, definitionC] = await Promise.all([
        prisma.processDefinition.create({
          data: { code: `${prefix}-A`, name: '裁线', stageGroup: 'frontend', sortOrder: 1 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-B`, name: '剥皮', stageGroup: 'frontend', sortOrder: 2 },
        }),
        prisma.processDefinition.create({
          data: { code: `${prefix}-C`, name: '穿号码管', stageGroup: 'frontend', sortOrder: 3 },
        }),
      ]);
      definitionIds.push(definitionA.id, definitionB.id, definitionC.id);
      const item = await prisma.drawingLibraryItem.create({
        data: {
          customerName: 'integration-test',
          productName: 'full product-time deployment',
          specification: `${prefix}-PRODUCT`,
          libraryKey: `${prefix}-LIBRARY`,
        },
      });
      itemId = item.id;
      const oldProfile = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 1,
          revision: 0,
          status: 'published',
          publishedAt: new Date('2026-08-10T00:00:00.000Z'),
          createdById: actor.id,
          updatedById: actor.id,
          publishedById: actor.id,
          entries: {
            create: [
              {
                processDefinitionId: definitionA.id,
                occurrenceKey: 'a-first',
                position: 1,
                sequenceGroup: 1,
                timeBasis: 'per_unit',
                unitMilliseconds: 1_000,
                occurrences: 1,
                unitLabel: '件',
              },
              {
                processDefinitionId: definitionB.id,
                occurrenceKey: 'b-only',
                position: 2,
                sequenceGroup: 2,
                timeBasis: 'per_unit',
                unitMilliseconds: 1_000,
                occurrences: 1,
                unitLabel: '件',
              },
              {
                processDefinitionId: definitionA.id,
                occurrenceKey: 'a-second',
                position: 3,
                sequenceGroup: 3,
                timeBasis: 'per_unit',
                unitMilliseconds: 3_000,
                occurrences: 1,
                unitLabel: '件',
              },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      oldProfileId = oldProfile.id;
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
                processDefinitionId: definitionA.id,
                occurrenceKey: 'a-first',
                position: 1,
                sequenceGroup: 1,
                timeBasis: 'per_unit',
                unitMilliseconds: 1_000,
                occurrences: 1,
                unitLabel: '件',
              },
              {
                processDefinitionId: definitionC.id,
                occurrenceKey: 'c-inserted',
                position: 2,
                sequenceGroup: 2,
                timeBasis: 'per_unit',
                unitMilliseconds: 1_500,
                occurrences: 1,
                unitLabel: '件',
              },
              {
                processDefinitionId: definitionB.id,
                occurrenceKey: 'b-only',
                position: 3,
                sequenceGroup: 3,
                timeBasis: 'per_unit',
                unitMilliseconds: 2_000,
                occurrences: 1,
                setupMilliseconds: 500,
                unitLabel: '件',
              },
              {
                processDefinitionId: definitionA.id,
                occurrenceKey: 'a-second',
                position: 4,
                sequenceGroup: 4,
                timeBasis: 'per_unit',
                unitMilliseconds: 3_000,
                occurrences: 1,
                unitLabel: '件',
              },
            ],
          },
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
      draftProfileId = draft.id;

      const createSteps = (completed: boolean) => oldProfile.entries.map((entry, index) => ({
        processDefinitionId: entry.processDefinitionId,
        processCode: index === 1 ? definitionB.code : definitionA.code,
        processName: index === 1 ? definitionB.name : definitionA.name,
        stageGroup: 'frontend',
        position: entry.position,
        sequenceGroup: entry.sequenceGroup,
        productTimeProfileId: oldProfile.id,
        productTimeEntryId: entry.id,
        productTimeProfileVersion: 1,
        standardSource: 'product_profile',
        timeBasis: 'per_unit',
        unitLabel: '件',
        standardMillisecondsPerUnit: entry.unitMilliseconds,
        inputQty: completed || index === 0 ? 10 : 0,
        processedQty: completed ? 10 : 0,
        goodOutputQty: completed ? 10 : 0,
        releasedGoodQty: completed ? 10 : 0,
        status: completed ? 'completed' : 'pending',
        completedAt: completed ? new Date('2026-08-10T04:00:00.000Z') : null,
      }));

      const factFreeOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-FACT-FREE`,
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
              templateName: `${item.specification} 产品工时`,
              templateVersion: 1,
              status: 'confirmed',
              version: 0,
              routeSource: 'product_time_profile',
              productTimeProfileId: oldProfile.id,
              productTimeProfileVersion: 1,
              confirmedAt: new Date('2026-08-10T00:00:00.000Z'),
              confirmedById: actor.id,
              steps: { create: createSteps(false) },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      workOrderIds.push(factFreeOrder.id);
      assert.ok(factFreeOrder.processRoute);
      factFreeRouteId = factFreeOrder.processRoute.id;
      firstAId = factFreeOrder.processRoute.steps[0].id;
      secondAId = factFreeOrder.processRoute.steps[2].id;

      const completedAt = new Date('2026-08-10T05:00:00.000Z');
      completedTicketCode = `${prefix}-QR`;
      const completedOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-COMPLETED`,
          productName: item.productName || 'product',
          specification: item.specification,
          stage: 'completed',
          status: 'done',
          progress: 100,
          productionTargetQty: 10,
          uncompletedQty: '10',
          completedQty: '10',
          planType: 'managed_plan',
          drawingLibraryItemId: item.id,
          startedAt: new Date('2026-08-10T01:00:00.000Z'),
          completedAt,
          qrTicket: { create: { publicCode: completedTicketCode, createdById: actor.id } },
          processRoute: {
            create: {
              templateName: `${item.specification} 产品工时`,
              templateVersion: 1,
              status: 'completed',
              version: 0,
              routeSource: 'product_time_profile',
              productTimeProfileId: oldProfile.id,
              productTimeProfileVersion: 1,
              startedAt: new Date('2026-08-10T01:00:00.000Z'),
              completedAt,
              confirmedAt: new Date('2026-08-10T00:00:00.000Z'),
              confirmedById: actor.id,
              steps: { create: createSteps(true) },
            },
          },
        },
        include: {
          qrTicket: true,
          processRoute: { include: { steps: { orderBy: { position: 'asc' } } } },
        },
      });
      workOrderIds.push(completedOrder.id);
      assert.ok(completedOrder.processRoute && completedOrder.qrTicket);
      completedRouteId = completedOrder.processRoute.id;
      const completedBStep = completedOrder.processRoute.steps[1];
      const workDate = new Date('2026-08-10T00:00:00.000Z');
      const completion = await prisma.processCompletion.create({
        data: {
          workOrderId: completedOrder.id,
          routeId: completedRouteId,
          stepId: completedBStep.id,
          workDate,
          completedAt,
          processedQty: 10,
          goodQty: 10,
          defectQty: 0,
          reportedUnitQty: 10,
          reportedGoodUnitQty: 10,
          reportedDefectUnitQty: 0,
          reportQuantityBasis: 'product',
          reportUnitLabel: '件',
          routeVersion: 0,
          idempotencyKey: `${prefix}-COMPLETION`,
          productTimeProfileId: oldProfile.id,
          productTimeEntryId: oldProfile.entries[1].id,
          productTimeProfileVersion: 1,
          standardSource: 'product_profile',
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          countsForEfficiency: true,
        },
      });
      const pool = await prisma.processLaborPool.create({
        data: {
          completionId: completion.id,
          workOrderId: completedOrder.id,
          stepId: completedBStep.id,
          workDate,
          eligibleQty: 10,
          claimedQty: 10,
          remainingQty: 0,
          status: ProcessLaborPoolStatus.EXHAUSTED,
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          totalStandardLaborMilliseconds: 10_000n,
          claimedStandardLaborMilliseconds: 10_000n,
          remainingStandardLaborMilliseconds: 0n,
          standardSource: 'product_profile',
          productTimeProfileVersion: 1,
        },
      });
      const oldClaim = await prisma.processLaborClaim.create({
        data: {
          poolId: pool.id,
          employeeId: employee.id,
          quantity: 10,
          standardLaborMilliseconds: 10_000n,
          workDate,
          status: ProcessLaborClaimStatus.ACTIVE,
          source: 'integration_test',
          idempotencyKey: `${prefix}-CLAIM`,
          claimedById: actor.id,
        },
      });
      oldClaimId = oldClaim.id;
      await prisma.processExecution.create({
        data: {
          stepId: completedBStep.id,
          employeeId: employee.id,
          startedAt: new Date('2026-08-10T03:00:00.000Z'),
          endedAt: new Date('2026-08-10T03:00:10.000Z'),
          goodQty: 10,
          timeBasis: 'per_unit',
          unitLabel: '件',
          standardMillisecondsPerUnit: 1_000,
          unitsPerProduct: 1,
          standardLaborMilliseconds: 10_000,
          actualLaborMilliseconds: 10_000,
          attainmentBasisPoints: 10_000,
          standardSource: 'product_profile',
          productTimeProfileVersion: 1,
          recordedById: actor.id,
        },
      });
      await prisma.workOrderQrPrint.create({
        data: {
          ticketId: completedOrder.qrTicket.id,
          routeId: completedRouteId,
          routeVersion: 0,
          snapshot: {},
          status: WorkOrderQrPrintStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actor.id,
          printedById: actor.id,
          items: {
            create: {
              material: WorkOrderQrPrintMaterial.TRAVELER,
              status: WorkOrderQrPrintStatus.CONFIRMED,
              confirmedAt: new Date(),
              confirmedById: actor.id,
            },
          },
        },
      });

      const preview = await previewProductTimeDeployment(item.id);
      assert.equal(preview.canPublish, true);
      assert.equal(preview.impact.workOrders.completed, 1);
      assert.equal(preview.impact.supplementObligations, 0);
      assert.equal(preview.impact.keptCompleted, 1);
      assert.equal(preview.impact.systemCoveredQty, 0);
      assert.equal(preview.impact.actualRequiredQty, 10, 'the fact-free order still executes the new operation');
      assert.equal(preview.impact.generatedLaborRecords, 0);
      assert.equal(preview.diffs.filter(diff => diff.kind === 'move').length, 0, 'insertion shifts are not moves');

      const [firstPublish, concurrentReplay] = await Promise.all([
        publishProductTimeDeployment({
          itemId: item.id,
          actorId: actor.id,
          expectedRevision: draft.revision,
          previewToken: preview.previewToken,
        }),
        publishProductTimeDeployment({
          itemId: item.id,
          actorId: actor.id,
          expectedRevision: draft.revision,
          previewToken: preview.previewToken,
        }),
      ]);
      assert.equal(firstPublish.deployment.id, concurrentReplay.deployment.id);
      assert.equal(firstPublish.deployment.status, 'active');

      const factFree = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: factFreeRouteId },
        include: {
          steps: {
            where: { retiredAt: null },
            orderBy: { position: 'asc' },
            include: { productTimeEntry: { select: { occurrenceKey: true } } },
          },
        },
      });
      assert.deepEqual(factFree.steps.map(step => step.processName), ['裁线', '穿号码管', '剥皮', '裁线']);
      assert.equal(factFree.steps[0].id, firstAId);
      assert.equal(factFree.steps[3].id, secondAId);
      assert.deepEqual(factFree.steps.map(step => step.productTimeEntry?.occurrenceKey), [
        'a-first', 'c-inserted', 'b-only', 'a-second',
      ]);
      assert.deepEqual(factFree.steps.map(step => step.inputQty), [10, 0, 0, 0]);

      const completedRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: completedRouteId },
        include: {
          workOrder: { include: { qrTicket: true } },
          steps: {
            where: { retiredAt: null },
            orderBy: { position: 'asc' },
            include: { supplementObligation: true, productTimeEntry: { select: { occurrenceKey: true } } },
          },
        },
      });
      assert.equal(completedRoute.status, 'completed');
      assert.equal(completedRoute.workOrder.completedAt?.getTime(), completedAt.getTime());
      assert.equal(completedRoute.workOrder.qrTicket?.publicCode, completedTicketCode);
      assert.deepEqual(
        completedRoute.steps.map(step => step.productTimeEntry?.occurrenceKey),
        ['a-first', 'b-only', 'a-second'],
      );
      assert.equal(completedRoute.productTimeProfileId, oldProfile.id);
      assert.equal(completedRoute.productTimeProfileVersion, 1);

      const correctedCompletion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completion.id } });
      assert.equal(correctedCompletion.productTimeProfileId, oldProfile.id);
      assert.equal(correctedCompletion.standardMillisecondsPerUnit, 1_000);
      assert.equal(correctedCompletion.setupMilliseconds, 0);
      const correctedPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { id: pool.id } });
      assert.equal(correctedPool.totalStandardLaborMilliseconds, 10_000n);
      const claims = await prisma.processLaborClaim.findMany({
        where: { poolId: pool.id },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(claims.find(claim => claim.id === oldClaimId)?.status, ProcessLaborClaimStatus.ACTIVE);
      assert.equal(claims.some(claim => claim.status === ProcessLaborClaimStatus.REVERSAL), false);
      const correctedExecution = await prisma.processExecution.findFirstOrThrow({
        where: { stepId: completedBStep.id, voidedAt: null },
      });
      assert.equal(correctedExecution.standardLaborMilliseconds, 10_000);

      // Publishing an unrelated, definition-identical profile must not erase
      // the durable NEW/time-change provenance from the prior deployment. It
      // must also reconcile an old route that missed an already-published
      // occurrence and retained a stale standard, even though profile diff is
      // empty.
      const missingFactFreeStep = factFree.steps.find(
        step => step.productTimeEntry?.occurrenceKey === 'c-inserted',
      );
      const staleFactFreeStep = factFree.steps.find(
        step => step.productTimeEntry?.occurrenceKey === 'b-only',
      );
      assert.ok(missingFactFreeStep && staleFactFreeStep);
      await prisma.workOrderProcessStep.delete({ where: { id: missingFactFreeStep.id } });
      await prisma.workOrderProcessStep.update({
        where: { id: staleFactFreeStep.id },
        data: { standardMillisecondsPerUnit: 1_000, setupMilliseconds: 0 },
      });
      const followup = await prisma.productTimeProfile.create({
        data: {
          drawingLibraryItemId: item.id,
          version: 3,
          revision: 0,
          status: 'draft',
          createdById: actor.id,
          updatedById: actor.id,
          entries: {
            create: draft.entries.map(entry => ({
              processDefinitionId: entry.processDefinitionId,
              occurrenceKey: entry.occurrenceKey,
              position: entry.position,
              sequenceGroup: entry.sequenceGroup,
              timeBasis: entry.timeBasis,
              unitMilliseconds: entry.unitMilliseconds,
              actionMilliseconds: entry.actionMilliseconds,
              setupMilliseconds: entry.setupMilliseconds,
              occurrences: entry.occurrences,
              unitLabel: entry.unitLabel,
              reportQuantityBasis: entry.reportQuantityBasis,
              reportUnitLabel: entry.reportUnitLabel,
              countsForEfficiency: entry.countsForEfficiency,
              remark: entry.remark,
            })),
          },
        },
      });
      followupProfileId = followup.id;
      const followupPreview = await previewProductTimeDeployment(item.id);
      assert.deepEqual(followupPreview.diffs, []);
      const factFreeDrift = followupPreview.routes.find(route => route.workOrderId === factFreeOrder.id);
      assert.equal(factFreeDrift?.insertedProcesses, 1);
      assert.equal(factFreeDrift?.updatedTimes, 1);
      await publishProductTimeDeployment({
        itemId: item.id,
        actorId: actor.id,
        expectedRevision: followup.revision,
        previewToken: followupPreview.previewToken,
      });
      const reconciledFactFree = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: factFreeRouteId },
        include: {
          steps: {
            where: { retiredAt: null },
            orderBy: { position: 'asc' },
            include: { productTimeEntry: { select: { occurrenceKey: true } } },
          },
        },
      });
      assert.deepEqual(
        reconciledFactFree.steps.map(step => step.productTimeEntry?.occurrenceKey),
        ['a-first', 'c-inserted', 'b-only', 'a-second'],
      );
      assert.equal(
        reconciledFactFree.steps.find(step => step.productTimeEntry?.occurrenceKey === 'b-only')
          ?.standardMillisecondsPerUnit,
        2_000,
      );
      assert.equal(
        reconciledFactFree.steps.find(step => step.productTimeEntry?.occurrenceKey === 'c-inserted')
          ?.changeSource,
        'NEW',
      );

      const qrTicket = await loadFieldReportTicket(completedTicketCode, { recordScan: false });
      const qrInserted = qrTicket.route?.steps.find(step => step.processName === '穿号码管');
      assert.equal(qrInserted, undefined);
      const qrTimeChanged = qrTicket.route?.steps.find(step => step.processName === '剥皮');
      assert.ok(qrTimeChanged);
      assert.equal(qrTimeChanged.standardMillisecondsPerUnit, 1_000);
      const closed = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: completedRouteId },
        include: {
          workOrder: { include: { qrTicket: true } },
          steps: { where: { retiredAt: null }, orderBy: { position: 'asc' } },
        },
      });
      assert.equal(closed.status, 'completed');
      assert.equal(closed.workOrder.status, 'done');
      assert.equal(closed.workOrder.stage, 'completed');
      assert.equal(closed.workOrder.completedQty, '10');
      assert.equal(closed.workOrder.qrTicket?.publicCode, completedTicketCode);
      assert.equal(closed.steps.length, 3);
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
        const completionIds = completions.map(item => item.id);
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
        await prisma.workOrderQrPrint.deleteMany({ where: { routeId: { in: routeIds } } });
        await prisma.workOrderQrTicket.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
        await prisma.productTimeDeploymentRoute.deleteMany({ where: { routeId: { in: routeIds } } });
        await prisma.workOrderProcessStep.deleteMany({ where: { routeId: { in: routeIds } } });
        await prisma.workOrderProcessRoute.deleteMany({ where: { id: { in: routeIds } } });
        await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
      }
      if (draftProfileId || oldProfileId || followupProfileId) {
        const profileIds = [followupProfileId, draftProfileId, oldProfileId].filter(Boolean);
        await prisma.productTimeDeployment.deleteMany({
          where: { profileId: { in: profileIds } },
        });
        await prisma.productTimeProfile.deleteMany({
          where: { id: { in: profileIds } },
        });
      }
      if (itemId) await prisma.drawingLibraryItem.deleteMany({ where: { id: itemId } });
      if (definitionIds.length) await prisma.processDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
