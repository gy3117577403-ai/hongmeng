import { deleteTestCompletions } from './helpers/delete-test-completions';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { withdrawProcessCompletion } from '../lib/process-completion-withdrawal-service';
import { activateProcessRouteChange, createProcessRouteChangeProposal, reviewProcessRouteChange, submitProcessRouteChange } from '../lib/process-route-change-service';
import { previewProductTimeDeployment, publishProductTimeDeployment } from '../lib/product-time-deployment-service';
import { getProcessStepPublishedContract, repairUnreportedProcessStepContract } from '../lib/process-report-contract';
import { syncProductTimeRouteFromPublishedProductTime } from '../lib/process-routing';

test('withdrawn action reporting publishes one-set contract and repairs old mismatches without changing history',
  { skip: process.env.RUN_DB_INTEGRATION !== '1' ? 'set RUN_DB_INTEGRATION=1 for isolated database' : false }, async () => {
    const prefix = `IT-CONTRACT-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({ data: { username: `${prefix}-USER`, displayName: prefix,
      passwordHash: 'integration-test-not-a-login-hash', laborRole: 'ADMIN' } });
    const employee = await prisma.employee.create({ data: { employeeNo: `${prefix}-EMP`, name: prefix, department: '生产部' } });
    const definition = await prisma.processDefinition.create({ data: { code: `${prefix}-INSERT`, name: '插入', stageGroup: 'backend' } });
    const item = await prisma.drawingLibraryItem.create({ data: { customerName: 'integration-test', productName: prefix,
      specification: prefix, libraryKey: prefix } });
    let workOrderId = '';
    try {
      const profile5 = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id,
        version: 5, status: 'published', publishedAt: new Date(), createdById: actor.id, updatedById: actor.id,
        publishedById: actor.id, entries: { create: { processDefinitionId: definition.id, occurrenceKey: 'insert-occurrence',
          position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 15000, actionMilliseconds: 5000,
          occurrences: 3, unitLabel: '套', reportQuantityBasis: 'action', reportUnitLabel: '个' } } }, include: { entries: true } });
      const draft6 = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id,
        version: 6, status: 'draft', createdById: actor.id, updatedById: actor.id,
        entries: { create: { processDefinitionId: definition.id, occurrenceKey: 'insert-occurrence',
          position: 1, sequenceGroup: 1, timeBasis: 'per_unit', unitMilliseconds: 15000, actionMilliseconds: null,
          occurrences: 1, unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套' } } } });
      const order = await prisma.workOrder.create({ data: { code: `${prefix}-ORDER`, productName: prefix, stage: 'backend',
        status: 'processing', productionTargetQty: 40, uncompletedQty: '40', completedQty: '0', planActive: true, planType: 'managed_plan',
        drawingLibraryItemId: item.id, startedAt: new Date(), processRoute: { create: {
          templateName: prefix, templateVersion: 5, status: 'in_progress', version: 0, startedAt: new Date(),
          confirmedAt: new Date(), routeSource: 'product_time_profile', productTimeProfileId: profile5.id, productTimeProfileVersion: 5,
          steps: { create: { processDefinitionId: definition.id, processCode: definition.code, processName: definition.name,
            stageGroup: 'backend', position: 1, sequenceGroup: 1, status: 'current', inputQty: 40,
            productTimeProfileId: profile5.id, productTimeEntryId: profile5.entries[0].id, productTimeProfileVersion: 5,
            standardSource: 'product_profile', timeBasis: 'per_unit', standardMillisecondsPerUnit: 5000,
            unitsPerProduct: 3, unitLabel: '套', reportQuantityBasis: 'action', reportUnitLabel: '个' } },
        } } }, include: { processRoute: { include: { steps: true } } } });
      workOrderId = order.id;
      const route = order.processRoute!;
      const step = route.steps[0];
      const routeVersion = async () => (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
      const identity = { userId: actor.id, actor: actor.displayName || actor.username };
      const initial = await completeProcessStep({ routeId: route.id, stepId: step.id, processedQty: 0, defectQty: 0,
        reportedUnitQty: 120, reportedDefectUnitQty: 0, workDate: '2026-09-05', employeeIds: [employee.id],
        requireParticipants: true, allowAdvanceReporting: true, autoAssignLabor: true, reportSource: 'QR_MOBILE',
        principalEmployeeId: employee.id, expectedRouteVersion: 0, idempotencyKey: `${prefix}-report120`, ...identity });
      const originalPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: initial.completionId } });
      assert.equal(originalPool.totalStandardLaborMilliseconds, 600000n);
      const blockedPreview = await previewProductTimeDeployment(item.id);
      assert.equal(blockedPreview.canPublish, false);
      assert.ok(blockedPreview.conflicts.some(conflict => conflict.code === 'PROCESS_REPORT_CONTRACT_HISTORY_CONFLICT'));

      // The existing route-change workflow must correct action time once, not multiply the three actions again.
      const proposal = await createProcessRouteChangeProposal({ workOrderId: order.id, routeId: route.id,
        title: '核对动作工时', reason: '', scope: 'CURRENT_WORK_ORDER_ONLY', expectedVersion: await routeVersion(),
        diffs: [{ kind: 'UPDATE_TIME', targetStepId: step.id, processDefinitionId: definition.id,
          afterData: { standardMillisecondsPerUnit: 6000 } }], idempotencyKey: `${prefix}-change`, ...identity });
      const submitted = await submitProcessRouteChange({ changeId: proposal.id, expectedVersion: proposal.version,
        idempotencyKey: `${prefix}-submit-change`, ...identity });
      const reviewed = await reviewProcessRouteChange({ changeId: proposal.id, decision: 'approve', expectedVersion: submitted.version,
        idempotencyKey: `${prefix}-review-change`, ...identity });
      assert.equal((reviewed.impact as Record<string, unknown>).nextStandardLaborMilliseconds, 720000);
      await activateProcessRouteChange({ changeId: proposal.id, expectedVersion: reviewed.version,
        expectedRouteVersion: await routeVersion(), idempotencyKey: `${prefix}-activate-change`, ...identity });
      const corrected = await prisma.processLaborPool.findUniqueOrThrow({ where: { id: originalPool.id } });
      assert.equal(corrected.totalStandardLaborMilliseconds, 720000n);
      assert.equal(corrected.unitsPerProduct, 1);
      assert.equal((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: step.id } })).unitsPerProduct, 3);
      const activeRepair = await prisma.$transaction(tx => repairUnreportedProcessStepContract(tx, {
        routeId: route.id, stepId: step.id, actorId: actor.id,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.equal(activeRepair.code, 'PROCESS_REPORT_CONTRACT_HAS_ACTIVE_FACTS');
      await prisma.productTimeProfile.update({ where: { id: profile5.id }, data: { status: 'archived' } });
      await prisma.productTimeProfile.update({ where: { id: draft6.id }, data: { status: 'published', publishedAt: new Date() } });
      const legacySync = await prisma.$transaction(tx => syncProductTimeRouteFromPublishedProductTime(tx, {
        routeId: route.id, profileId: draft6.id, actorId: actor.id,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.equal(legacySync.reviewRequired, true, 'withdrawal/background refresh must not change another live action contract');
      const stillAction = await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: step.id } });
      assert.equal(stillAction.reportQuantityBasis, 'action');
      assert.equal(stillAction.unitsPerProduct, 3);
      assert.equal(stillAction.standardMillisecondsPerUnit, 6000);
      await prisma.productTimeProfile.update({ where: { id: draft6.id }, data: { status: 'draft', publishedAt: null } });
      await prisma.productTimeProfile.update({ where: { id: profile5.id }, data: { status: 'published' } });

      await withdrawProcessCompletion({ routeId: route.id, completionId: initial.completionId, expectedRouteVersion: await routeVersion(),
        category: 'REPORTING_ERROR', reason: '', idempotencyKey: `${prefix}-withdraw`, ...identity });
      const voided = await prisma.processLaborPool.findUniqueOrThrow({ where: { id: originalPool.id } });
      assert.equal(voided.status, 'VOIDED');
      const preview = await previewProductTimeDeployment(item.id);
      assert.equal(preview.canPublish, true, JSON.stringify(preview.conflicts));
      await publishProductTimeDeployment({ itemId: item.id, actorId: actor.id, expectedRevision: draft6.revision, previewToken: preview.previewToken });
      const deployed = await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: step.id } });
      assert.equal(deployed.reportQuantityBasis, 'product');
      assert.equal(deployed.unitsPerProduct, 1);
      assert.equal(deployed.standardMillisecondsPerUnit, 15000);
      assert.equal(deployed.inputQty, 40);
      assert.equal(deployed.processedQty, 0);

      // Model the already-published legacy fault; repair uses exact occurrence identity and leaves voided history intact.
      await prisma.workOrderProcessStep.update({ where: { id: step.id }, data: { reportQuantityBasis: 'action', reportUnitLabel: '个' } });
      const source = await prisma.$transaction(tx => getProcessStepPublishedContract(tx, { routeId: route.id, stepId: step.id }));
      assert.equal(source.current?.reportQuantityBasis, 'action');
      assert.equal(source.published?.reportQuantityBasis, 'product');
      const orphanClaim = await prisma.processLaborClaim.findFirstOrThrow({ where: { poolId: originalPool.id, status: 'VOIDED' } });
      await prisma.processLaborClaim.update({ where: { id: orphanClaim.id }, data: { status: 'ACTIVE' } });
      const orphanBlocked = await prisma.$transaction(tx => repairUnreportedProcessStepContract(tx, {
        routeId: route.id, stepId: step.id, actorId: actor.id,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.equal(orphanBlocked.code, 'PROCESS_REPORT_CONTRACT_HAS_ACTIVE_FACTS', 'an inconsistent VOIDED pool with active claims cannot be ignored');
      await prisma.processLaborClaim.update({ where: { id: orphanClaim.id }, data: { status: 'VOIDED' } });
      const wrongOccurrence = await prisma.$transaction(tx => getProcessStepPublishedContract(tx, { routeId: route.id, stepId: randomUUID() }));
      assert.equal(wrongOccurrence.status, 'blocked');
      const beforeRepairVersion = await routeVersion();
      const repair = await prisma.$transaction(tx => repairUnreportedProcessStepContract(tx, {
        routeId: route.id, stepId: step.id, actorId: actor.id, expectedRouteVersion: beforeRepairVersion,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.equal(repair.status, 'repaired');
      assert.equal(repair.routeVersion, beforeRepairVersion + 1);
      const repeated = await prisma.$transaction(tx => repairUnreportedProcessStepContract(tx, {
        routeId: route.id, stepId: step.id, actorId: actor.id,
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.equal(repeated.status, 'unchanged');
      assert.equal(await prisma.operationLog.count({ where: { action: 'repair_unreported_process_contract', targetId: step.id } }), 1);
      const preserved = await prisma.processCompletion.findUniqueOrThrow({ where: { id: initial.completionId } });
      assert.ok(preserved.voidedAt);
      assert.equal(preserved.reportedUnitQty, 120);
      assert.equal(preserved.reportQuantityBasis, 'action');
      assert.equal((await prisma.processLaborPool.findUniqueOrThrow({ where: { id: originalPool.id } })).status, 'VOIDED');
      const completed = await completeProcessStep({ routeId: route.id, stepId: step.id, processedQty: 40, defectQty: 0,
        workDate: '2026-09-05', employeeIds: [employee.id], requireParticipants: true, allowAdvanceReporting: true,
        autoAssignLabor: true, reportSource: 'QR_MOBILE', principalEmployeeId: employee.id, expectedRouteVersion: await routeVersion(),
        idempotencyKey: `${prefix}-report40`, ...identity });
      const finalPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: completed.completionId } });
      assert.equal(finalPool.totalStandardLaborMilliseconds, 600000n);
      assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).status, 'completed');
    } finally {
      if (workOrderId) {
        const changes = await prisma.processRouteChange.findMany({ where: { workOrderId }, select: { id: true, changeRequestId: true } });
        const changeIds = changes.map(value => value.id);
        await prisma.systemNotification.deleteMany({ where: { sourceType: 'process_route_change', sourceId: { in: changeIds } } });
        await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
        await prisma.changeRequest.deleteMany({ where: { id: { in: changes.map(value => value.changeRequestId) } } });
        await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId } } });
        await prisma.processLaborPool.deleteMany({ where: { workOrderId } });
        await prisma.processCompletionCoverage.deleteMany({ where: { reportCompletion: { workOrderId } } });
        await prisma.processQuantityMovement.deleteMany({ where: { workOrderId } });
        await prisma.processActionConsumption.deleteMany({ where: { step: { route: { workOrderId } } } });
        await deleteTestCompletions({ where: { workOrderId } });
        await prisma.productTimeDeploymentRoute.deleteMany({ where: { workOrderId } });
        await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      }
      await prisma.productTimeDeployment.deleteMany({ where: { drawingLibraryItemId: item.id } });
      await prisma.productTimeProfile.deleteMany({ where: { drawingLibraryItemId: item.id } });
      await prisma.drawingLibraryItem.deleteMany({ where: { id: item.id } });
      await prisma.processDefinition.deleteMany({ where: { id: definition.id } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  });
