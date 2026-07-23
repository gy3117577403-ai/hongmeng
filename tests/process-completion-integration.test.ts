import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import {
  claimProcessLaborPool,
  ProcessLaborServiceError,
  resolveProcessLaborPoolStandard,
  voidProcessLaborClaim,
} from '../lib/process-labor-service';
import {
  adjustProductionQuantities,
  ProductionQuantityAdjustmentServiceError,
} from '../lib/production-quantity-adjustment-service';
import {
  applyProductionStageFlow,
  ProductionStageFlowServiceError,
} from '../lib/production-stage-flow-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';
const workDate = '2026-07-23';

function completionKey(prefix: string, label: string) {
  return `${prefix}-completion-${label}`;
}

function claimKey(prefix: string, label: string) {
  return `${prefix}-claim-${label}`;
}

test(
  'real Prisma flow conserves process quantities, rework output, and claimed labor',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITPC-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const employeeIds = new Set<string>();
    const userIds = new Set<string>();
    let databaseConnected = false;

    try {
      const actor = await prisma.user.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, displayName: true, username: true },
      });
      databaseConnected = true;
      assert.ok(actor, 'database integration requires at least one existing User');
      const otherActor = await prisma.user.create({
        data: {
          username: `${prefix}-admin`,
          passwordHash: 'integration-test-not-a-login-hash',
          displayName: `${prefix} second administrator`,
          laborRole: 'ADMIN',
        },
      });
      userIds.add(otherActor.id);

      const [employeeA, employeeB, teamLeadEmployee] = await Promise.all([
        prisma.employee.create({
          data: {
            employeeNo: `${prefix}-A`,
            name: `${prefix} employee A`,
            department: 'integration-test',
            team: `${prefix}-TEAM-A`,
          },
        }),
        prisma.employee.create({
          data: {
            employeeNo: `${prefix}-B`,
            name: `${prefix} employee B`,
            department: 'integration-test',
            team: `${prefix}-TEAM-B`,
          },
        }),
        prisma.employee.create({
          data: {
            employeeNo: `${prefix}-LEAD`,
            name: `${prefix} team lead`,
            department: 'integration-test',
            team: `${prefix}-TEAM-A`,
          },
        }),
      ]);
      employeeIds.add(employeeA.id);
      employeeIds.add(employeeB.id);
      employeeIds.add(teamLeadEmployee.id);
      const [employeeActor, teamLeadActor] = await Promise.all([
        prisma.user.create({
          data: {
            username: `${prefix}-employee`,
            passwordHash: 'integration-test-not-a-login-hash',
            displayName: `${prefix} employee account`,
            laborRole: 'EMPLOYEE',
            employeeId: employeeA.id,
          },
        }),
        prisma.user.create({
          data: {
            username: `${prefix}-team-lead`,
            passwordHash: 'integration-test-not-a-login-hash',
            displayName: `${prefix} team lead account`,
            laborRole: 'TEAM_LEAD',
            employeeId: teamLeadEmployee.id,
          },
        }),
      ]);
      userIds.add(employeeActor.id);
      userIds.add(teamLeadActor.id);

      const now = new Date();
      const routeLessOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ROUTE-REQUIRED`,
          customerName: 'integration-test',
          productName: 'route-required product',
          stage: 'not_issued',
          status: 'pending',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          planType: 'managed_plan',
          planActive: true,
        },
      });
      await assert.rejects(
        applyProductionStageFlow({
          workOrderId: routeLessOrder.id,
          action: 'confirm_drawing_issued',
          expectedVersion: routeLessOrder.executionVersion,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => error instanceof ProductionStageFlowServiceError
          && error.code === 'PROCESS_ROUTE_REQUIRED',
      );
      await assert.rejects(
        adjustProductionQuantities({
          workOrderId: routeLessOrder.id,
          targetQty: 10,
          frontendTransferredQty: 10,
          completedQty: 10,
          expectedVersion: routeLessOrder.executionVersion,
          reason: 'must not bypass process completion',
          confirmReopen: true,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => error instanceof ProductionQuantityAdjustmentServiceError
          && error.code === 'PROCESS_QUANTITY_LEDGER_LOCKED',
      );

      const rootOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ROOT`,
          customerName: 'integration-test',
          productName: 'quantity conservation product',
          stage: 'frontend',
          status: 'processing',
          processName: 'cut',
          uncompletedQty: '100',
          productionTargetQty: 100,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} two-step route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: now,
              confirmedById: actor.id,
              startedAt: now,
              routeSource: 'process_template',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-CUT`,
                    processName: 'cut',
                    stageGroup: 'frontend',
                    position: 1,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_000,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-PRESS`,
                    processName: 'press',
                    stageGroup: 'backend',
                    position: 2,
                    sequenceGroup: 2,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 2_000,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 0,
                    status: 'pending',
                  },
                ],
              },
            },
          },
        },
        include: {
          processRoute: {
            include: {
              steps: { orderBy: { position: 'asc' } },
            },
          },
        },
      });
      assert.ok(rootOrder.processRoute);
      const rootRoute = rootOrder.processRoute;
      const [cutStep, pressStep] = rootRoute.steps;

      const firstCompletionCommand = {
        routeId: rootRoute.id,
        stepId: cutStep.id,
        processedQty: 60,
        defectQty: 5,
        defectDisposition: 'rework',
        workDate,
        workStartedAt: `${workDate}T00:00:00.000Z`,
        workEndedAt: `${workDate}T02:00:00.000Z`,
        employeeIds: [employeeA.id, employeeB.id],
        team: '集成测试班组',
        workstation: '集成测试工位',
        remark: '验证现场作业记录和报工推荐',
        requireParticipants: true,
        idempotencyKey: completionKey(prefix, 'root-cut-60'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      } as const;
      const firstCompletion = await completeProcessStep(firstCompletionCommand);
      assert.equal(firstCompletion.goodTransferredQty, 55);
      assert.equal(firstCompletion.remainingInputQty, 40);
      assert.equal(firstCompletion.routeCompleted, false);
      assert.ok(firstCompletion.laborPoolId);
      assert.ok(firstCompletion.branchWorkOrderId);
      const storedCompletion = await prisma.processCompletion.findUniqueOrThrow({
        where: { id: firstCompletion.completionId },
        include: {
          participants: {
            orderBy: { position: 'asc' },
          },
        },
      });
      assert.equal(storedCompletion.workStartedAt?.toISOString(), `${workDate}T00:00:00.000Z`);
      assert.equal(storedCompletion.workEndedAt?.toISOString(), `${workDate}T02:00:00.000Z`);
      assert.equal(storedCompletion.team, '集成测试班组');
      assert.equal(storedCompletion.workstation, '集成测试工位');
      assert.deepEqual(
        storedCompletion.participants.map(participant => participant.employeeId),
        [employeeA.id, employeeB.id],
      );
      await prisma.processRouteActivity.createMany({
        data: Array.from({ length: 101 }, (_, index) => ({
          routeId: rootRoute.id,
          stepId: cutStep.id,
          action: 'complete_process_step',
          content: `idempotency replay noise ${index}`,
          actorId: actor.id,
          detail: { synthetic: true, index },
        })),
      });

      const replay = await completeProcessStep(firstCompletionCommand);
      assert.deepEqual(replay, firstCompletion);
      assert.equal(
        await prisma.processCompletion.count({
          where: { idempotencyKey: firstCompletionCommand.idempotencyKey },
        }),
        1,
      );

      const afterFirst = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: rootRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(afterFirst.version, 1);
      assert.deepEqual(
        afterFirst.steps.map(step => ({
          processedQty: step.processedQty,
          goodOutputQty: step.goodOutputQty,
          defectOutputQty: step.defectOutputQty,
          releasedGoodQty: step.releasedGoodQty,
          inputQty: step.inputQty,
          status: step.status,
        })),
        [
          {
            processedQty: 60,
            goodOutputQty: 55,
            defectOutputQty: 5,
            releasedGoodQty: 55,
            inputQty: 100,
            status: 'current',
          },
          {
            processedQty: 0,
            goodOutputQty: 0,
            defectOutputQty: 0,
            releasedGoodQty: 0,
            inputQty: 55,
            status: 'current',
          },
        ],
      );

      const firstMovements = await prisma.processQuantityMovement.findMany({
        where: { completionId: firstCompletion.completionId },
        orderBy: { type: 'asc' },
      });
      assert.deepEqual(
        firstMovements.map(movement => ({
          type: movement.type,
          quantity: movement.quantity,
          targetStepId: movement.targetStepId,
          branchWorkOrderId: movement.branchWorkOrderId,
        })),
        [
          {
            type: 'GOOD_TRANSFER',
            quantity: 55,
            targetStepId: pressStep.id,
            branchWorkOrderId: null,
          },
          {
            type: 'REWORK_SPLIT',
            quantity: 5,
            targetStepId: firstMovements.find(item => item.type === 'REWORK_SPLIT')?.targetStepId,
            branchWorkOrderId: firstCompletion.branchWorkOrderId,
          },
        ],
      );

      const mainPool = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: firstCompletion.laborPoolId },
      });
      assert.equal(mainPool.eligibleQty, 55);
      assert.equal(mainPool.remainingQty, 55);
      assert.equal(mainPool.totalStandardLaborMilliseconds, 55_000n);
      assert.equal(mainPool.remainingStandardLaborMilliseconds, 55_000n);
      assert.equal(mainPool.status, 'OPEN');

      const branchBeforeWork = await prisma.workOrder.findUniqueOrThrow({
        where: { id: firstCompletion.branchWorkOrderId },
        include: {
          processRoute: {
            include: { steps: { orderBy: { position: 'asc' } } },
          },
        },
      });
      assert.equal(branchBeforeWork.parentWorkOrderId, rootOrder.id);
      assert.equal(branchBeforeWork.rootWorkOrderId, rootOrder.id);
      assert.equal(branchBeforeWork.branchType, 'REWORK');
      assert.equal(branchBeforeWork.branchStatus, 'IN_PROGRESS');
      assert.equal(branchBeforeWork.productionTargetQty, 5);
      assert.equal(branchBeforeWork.processRoute?.steps.length, 1);

      const downstreamFirst = await completeProcessStep({
        routeId: rootRoute.id,
        stepId: pressStep.id,
        processedQty: 55,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'root-press-55'),
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(downstreamFirst.goodTransferredQty, 55);
      assert.equal(downstreamFirst.routeCompleted, false);
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: rootOrder.id } })).completedQty,
        '55',
      );

      const upstreamRemainder = await completeProcessStep({
        routeId: rootRoute.id,
        stepId: cutStep.id,
        processedQty: 40,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'root-cut-40'),
        expectedRouteVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(upstreamRemainder.goodTransferredQty, 40);
      assert.equal(upstreamRemainder.remainingInputQty, 0);
      assert.equal(upstreamRemainder.routeCompleted, false);

      const beforeFinalMainCompletion = await prisma.workOrderProcessStep.findUniqueOrThrow({
        where: { id: pressStep.id },
      });
      assert.equal(beforeFinalMainCompletion.inputQty, 95);
      assert.equal(beforeFinalMainCompletion.processedQty, 55);
      assert.equal(beforeFinalMainCompletion.status, 'current');

      const mainFinal = await completeProcessStep({
        routeId: rootRoute.id,
        stepId: pressStep.id,
        processedQty: 40,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'root-press-40'),
        expectedRouteVersion: 3,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(mainFinal.goodTransferredQty, 40);
      assert.equal(mainFinal.routeCompleted, true);

      const rootWaitingForRework = await prisma.workOrder.findUniqueOrThrow({
        where: { id: rootOrder.id },
        include: { processRoute: true },
      });
      assert.equal(rootWaitingForRework.processRoute?.status, 'completed');
      assert.equal(rootWaitingForRework.completedQty, '95');
      assert.equal(rootWaitingForRework.progress, 95);
      assert.equal(rootWaitingForRework.completedAt, null);
      assert.notEqual(rootWaitingForRework.stage, 'completed');
      await assert.rejects(
        adjustProductionQuantities({
          workOrderId: rootOrder.id,
          targetQty: 100,
          frontendTransferredQty: 95,
          completedQty: 100,
          expectedVersion: rootWaitingForRework.executionVersion,
          reason: 'integration test must not bypass the process ledger',
          confirmReopen: false,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => error instanceof ProductionQuantityAdjustmentServiceError
          && error.code === 'PROCESS_QUANTITY_LEDGER_LOCKED',
      );

      const branchRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { workOrderId: firstCompletion.branchWorkOrderId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      const [branchStep] = branchRoute.steps;
      const branchCompletion = await completeProcessStep({
        routeId: branchRoute.id,
        stepId: branchStep.id,
        processedQty: 5,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'rework-cut-5'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(branchCompletion.goodTransferredQty, 5);
      assert.equal(branchCompletion.routeCompleted, true);

      const [resolvedBranchBeforeRejoin, rootAfterReworkReturn, rootRouteAfterReworkReturn] = await Promise.all([
        prisma.workOrder.findUniqueOrThrow({
          where: { id: firstCompletion.branchWorkOrderId },
          include: { processRoute: true },
        }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: rootOrder.id } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { id: rootRoute.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        }),
      ]);
      assert.equal(resolvedBranchBeforeRejoin.processRoute?.status, 'completed');
      assert.equal(resolvedBranchBeforeRejoin.branchStatus, 'RESOLVED');
      assert.equal(resolvedBranchBeforeRejoin.completedQty, '5');
      assert.equal(rootAfterReworkReturn.completedQty, '95');
      assert.equal(rootRouteAfterReworkReturn.status, 'in_progress');
      assert.equal(rootRouteAfterReworkReturn.version, 5);
      assert.deepEqual(
        rootRouteAfterReworkReturn.steps.map(step => ({
          processName: step.processName,
          inputQty: step.inputQty,
          processedQty: step.processedQty,
          goodOutputQty: step.goodOutputQty,
          defectOutputQty: step.defectOutputQty,
          releasedGoodQty: step.releasedGoodQty,
          status: step.status,
        })),
        [
          {
            processName: 'cut',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            status: 'completed',
          },
          {
            processName: 'press',
            inputQty: 100,
            processedQty: 95,
            goodOutputQty: 95,
            defectOutputQty: 0,
            releasedGoodQty: 95,
            status: 'current',
          },
        ],
      );
      const reworkReturnMovements = await prisma.processQuantityMovement.findMany({
        where: { completionId: branchCompletion.completionId },
        orderBy: { type: 'asc' },
      });
      assert.deepEqual(
        reworkReturnMovements.map(movement => ({
          type: movement.type,
          quantity: movement.quantity,
          targetStepId: movement.targetStepId,
          workOrderId: movement.workOrderId,
        })),
        [
          {
            type: 'GOOD_TRANSFER',
            quantity: 5,
            targetStepId: pressStep.id,
            workOrderId: rootOrder.id,
          },
          {
            type: 'REWORK_RETURN',
            quantity: 5,
            targetStepId: cutStep.id,
            workOrderId: rootOrder.id,
          },
        ],
      );

      const rootTailCompletion = await completeProcessStep({
        routeId: rootRoute.id,
        stepId: pressStep.id,
        processedQty: 5,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'root-press-rework-return-5'),
        expectedRouteVersion: 5,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(rootTailCompletion.goodTransferredQty, 5);
      assert.equal(rootTailCompletion.routeCompleted, true);

      const [resolvedBranch, completedRoot] = await Promise.all([
        prisma.workOrder.findUniqueOrThrow({
          where: { id: firstCompletion.branchWorkOrderId },
          include: { processRoute: true },
        }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: rootOrder.id } }),
      ]);
      assert.equal(resolvedBranch.processRoute?.status, 'completed');
      assert.equal(resolvedBranch.branchStatus, 'RESOLVED');
      assert.equal(resolvedBranch.completedQty, '5');
      assert.equal(completedRoot.completedQty, '100');
      assert.deepEqual(
        await completeProcessStep(firstCompletionCommand),
        firstCompletion,
        'old idempotent result remains stable after more than 100 later activities and route closure',
      );
      assert.equal(completedRoot.progress, 100);
      assert.equal(completedRoot.stage, 'completed');
      assert.equal(completedRoot.status, 'done');
      assert.ok(completedRoot.completedAt);

      const claimACommand = {
        poolId: mainPool.id,
        employeeId: employeeA.id,
        quantity: 40,
        expectedVersion: 0,
        idempotencyKey: claimKey(prefix, 'employee-a-40'),
        userId: teamLeadActor.id,
      } as const;
      const claimA = await claimProcessLaborPool(claimACommand);
      assert.equal(claimA.claim.quantity, 40);
      assert.equal(claimA.pool.claimedQty, 40);
      assert.equal(claimA.pool.remainingQty, 15);
      assert.equal(claimA.pool.status, 'PARTIAL');
      assert.equal(claimA.pool.version, 1);
      assert.deepEqual(claimA.pool.claims.map(claim => claim.employee.id), [employeeA.id]);

      const claimAReplay = await claimProcessLaborPool(claimACommand);
      assert.equal(claimAReplay.claim.id, claimA.claim.id);
      assert.equal(claimAReplay.pool.version, 1);
      assert.equal(claimAReplay.pool.claimedQty, 40);
      assert.equal(
        await prisma.processLaborClaim.count({
          where: { idempotencyKey: claimACommand.idempotencyKey },
        }),
        1,
      );
      await assert.rejects(
        claimProcessLaborPool({
          ...claimACommand,
          userId: otherActor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_IDEMPOTENCY_CONFLICT',
      );
      await assert.rejects(
        claimProcessLaborPool({
          ...claimACommand,
          quantity: 39,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_IDEMPOTENCY_CONFLICT',
      );
      const mainPoolAfterIdempotencyConflict = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: mainPool.id },
      });
      assert.equal(mainPoolAfterIdempotencyConflict.version, 1);
      assert.equal(mainPoolAfterIdempotencyConflict.claimedQty, 40);
      assert.equal(mainPoolAfterIdempotencyConflict.remainingQty, 15);

      await assert.rejects(
        claimProcessLaborPool({
          poolId: mainPool.id,
          employeeId: employeeB.id,
          quantity: 1,
          expectedVersion: 1,
          idempotencyKey: claimKey(prefix, 'team-lead-cross-team'),
          userId: teamLeadActor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_TEAM_SCOPE_FORBIDDEN',
      );

      await assert.rejects(
        claimProcessLaborPool({
          poolId: mainPool.id,
          employeeId: employeeB.id,
          quantity: 16,
          expectedVersion: 1,
          idempotencyKey: claimKey(prefix, 'over-claim-16'),
          userId: actor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_CLAIM_QTY_EXCEEDS_REMAINING',
      );
      assert.equal(
        (await prisma.processLaborPool.findUniqueOrThrow({ where: { id: mainPool.id } })).version,
        1,
      );

      const claimB = await claimProcessLaborPool({
        poolId: mainPool.id,
        employeeId: employeeB.id,
        quantity: 15,
        expectedVersion: 1,
        idempotencyKey: claimKey(prefix, 'employee-b-15'),
        userId: actor.id,
      });
      assert.equal(claimB.claim.quantity, 15);
      assert.equal(claimB.pool.claimedQty, 55);
      assert.equal(claimB.pool.remainingQty, 0);
      assert.equal(claimB.pool.status, 'EXHAUSTED');
      assert.equal(claimB.pool.version, 2);

      const voidedA = await voidProcessLaborClaim({
        claimId: claimA.claim.id,
        expectedPoolVersion: 2,
        reason: `${prefix} correction`,
        idempotencyKey: claimKey(prefix, 'void-employee-a-40'),
        userId: teamLeadActor.id,
      });
      assert.equal(voidedA.claim.status, 'VOIDED');
      assert.equal(voidedA.reversal.status, 'REVERSAL');
      assert.equal(voidedA.reversal.quantity, -40);
      assert.equal(voidedA.pool.claimedQty, 15);
      assert.equal(voidedA.pool.remainingQty, 40);
      assert.equal(voidedA.pool.version, 3);
      assert.equal(
        voidedA.pool.claims.length,
        0,
        'team lead mutation responses must not expose another team claims',
      );

      const reclaimedA = await claimProcessLaborPool({
        poolId: mainPool.id,
        employeeId: employeeA.id,
        quantity: 40,
        expectedVersion: 3,
        idempotencyKey: claimKey(prefix, 'employee-a-reclaim-40'),
        userId: actor.id,
      });
      assert.equal(reclaimedA.pool.claimedQty, 55);
      assert.equal(reclaimedA.pool.remainingQty, 0);
      assert.equal(reclaimedA.pool.status, 'EXHAUSTED');
      assert.equal(reclaimedA.pool.version, 4);

      const conservedClaims = await prisma.processLaborClaim.findMany({
        where: { poolId: mainPool.id },
        orderBy: { claimedAt: 'asc' },
      });
      assert.equal(
        conservedClaims.reduce((sum, claim) => sum + claim.quantity, 0),
        mainPool.eligibleQty,
      );
      assert.equal(
        conservedClaims.reduce(
          (sum, claim) => sum + claim.standardLaborMilliseconds,
          0n,
        ),
        mainPool.totalStandardLaborMilliseconds,
      );
      assert.equal(
        conservedClaims
          .filter(claim => claim.status === 'ACTIVE')
          .reduce((sum, claim) => sum + claim.quantity, 0),
        mainPool.eligibleQty,
      );
      assert.equal(
        conservedClaims.filter(claim => claim.status === 'REVERSAL').length,
        1,
      );

      assert.ok(upstreamRemainder.laborPoolId);
      const concurrentPoolBefore = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: upstreamRemainder.laborPoolId },
      });
      assert.equal(concurrentPoolBefore.eligibleQty, 40);
      assert.equal(concurrentPoolBefore.claimedQty, 0);
      assert.equal(concurrentPoolBefore.remainingQty, 40);
      assert.equal(concurrentPoolBefore.version, 0);

      const concurrentClaimResults = await Promise.allSettled([
        claimProcessLaborPool({
          poolId: concurrentPoolBefore.id,
          employeeId: employeeA.id,
          quantity: 25,
          expectedVersion: 0,
          idempotencyKey: claimKey(prefix, 'concurrent-employee-a-25'),
          userId: actor.id,
        }),
        claimProcessLaborPool({
          poolId: concurrentPoolBefore.id,
          employeeId: employeeB.id,
          quantity: 25,
          expectedVersion: 0,
          idempotencyKey: claimKey(prefix, 'concurrent-employee-b-25'),
          userId: actor.id,
        }),
      ]);
      const concurrentClaimSuccesses = concurrentClaimResults.filter(
        result => result.status === 'fulfilled',
      );
      const concurrentClaimFailures = concurrentClaimResults.filter(
        result => result.status === 'rejected',
      );
      assert.equal(concurrentClaimSuccesses.length, 1);
      assert.equal(concurrentClaimFailures.length, 1);
      assert.ok(
        concurrentClaimFailures[0].reason instanceof ProcessLaborServiceError
          && concurrentClaimFailures[0].reason.code === 'PROCESS_LABOR_VERSION_CONFLICT',
      );
      const winningConcurrentClaim = concurrentClaimSuccesses[0].value.claim;
      const concurrentPoolAfterClaim = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: concurrentPoolBefore.id },
      });
      assert.equal(concurrentPoolAfterClaim.claimedQty, 25);
      assert.equal(concurrentPoolAfterClaim.remainingQty, 15);
      assert.equal(concurrentPoolAfterClaim.version, 1);
      assert.equal(
        await prisma.processLaborClaim.count({
          where: {
            poolId: concurrentPoolBefore.id,
            status: 'ACTIVE',
          },
        }),
        1,
      );

      const concurrentVoidResults = await Promise.allSettled([
        voidProcessLaborClaim({
          claimId: winningConcurrentClaim.id,
          expectedPoolVersion: 1,
          reason: `${prefix} concurrent correction A`,
          idempotencyKey: claimKey(prefix, 'concurrent-void-a'),
          userId: actor.id,
        }),
        voidProcessLaborClaim({
          claimId: winningConcurrentClaim.id,
          expectedPoolVersion: 1,
          reason: `${prefix} concurrent correction B`,
          idempotencyKey: claimKey(prefix, 'concurrent-void-b'),
          userId: actor.id,
        }),
      ]);
      const concurrentVoidSuccesses = concurrentVoidResults.filter(
        result => result.status === 'fulfilled',
      );
      const concurrentVoidFailures = concurrentVoidResults.filter(
        result => result.status === 'rejected',
      );
      assert.ok(concurrentVoidSuccesses.length >= 1);
      assert.ok(concurrentVoidSuccesses.length <= 2);
      for (const failure of concurrentVoidFailures) {
        assert.ok(
          failure.reason instanceof ProcessLaborServiceError
            && (
              failure.reason.code === 'PROCESS_LABOR_VERSION_CONFLICT'
              || failure.reason.code === 'PROCESS_LABOR_IDEMPOTENCY_CONFLICT'
            ),
        );
      }

      const concurrentClaimRows = await prisma.processLaborClaim.findMany({
        where: { poolId: concurrentPoolBefore.id },
        orderBy: { claimedAt: 'asc' },
      });
      const concurrentReversals = concurrentClaimRows.filter(
        claim => claim.reversalOfId === winningConcurrentClaim.id,
      );
      assert.equal(concurrentReversals.length, 1);
      for (const success of concurrentVoidSuccesses) {
        assert.equal(success.value.reversal.id, concurrentReversals[0].id);
      }
      const originalConcurrentClaim = concurrentClaimRows.find(
        claim => claim.id === winningConcurrentClaim.id,
      );
      assert.equal(originalConcurrentClaim?.status, 'VOIDED');
      const concurrentPoolAfterVoid = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: concurrentPoolBefore.id },
      });
      assert.equal(concurrentPoolAfterVoid.claimedQty, 0);
      assert.equal(concurrentPoolAfterVoid.remainingQty, 40);
      assert.equal(concurrentPoolAfterVoid.claimedStandardLaborMilliseconds, 0n);
      assert.equal(
        concurrentPoolAfterVoid.remainingStandardLaborMilliseconds,
        concurrentPoolAfterVoid.totalStandardLaborMilliseconds,
      );
      assert.equal(concurrentPoolAfterVoid.version, 2);
      assert.equal(
        concurrentClaimRows.reduce((sum, claim) => sum + claim.quantity, 0),
        concurrentPoolAfterVoid.claimedQty,
      );
      assert.equal(
        concurrentClaimRows.reduce(
          (sum, claim) => sum + claim.standardLaborMilliseconds,
          0n,
        ),
        concurrentPoolAfterVoid.claimedStandardLaborMilliseconds,
      );

      const parallelOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-PARALLEL-REWORK`,
          customerName: 'integration-test',
          productName: 'parallel rework conservation product',
          stage: 'frontend',
          status: 'processing',
          processName: 'parallel operation A / B',
          uncompletedQty: '100',
          productionTargetQty: 100,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} parallel rework route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: now,
              confirmedById: actor.id,
              startedAt: now,
              routeSource: 'process_template',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-PARALLEL-A`,
                    processName: 'parallel A',
                    stageGroup: 'frontend',
                    position: 1,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_000,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-PARALLEL-B`,
                    processName: 'parallel B',
                    stageGroup: 'frontend',
                    position: 2,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_500,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-PARALLEL-C`,
                    processName: 'final C',
                    stageGroup: 'backend',
                    position: 3,
                    sequenceGroup: 2,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 2_000,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 0,
                    status: 'pending',
                  },
                ],
              },
            },
          },
        },
        include: {
          processRoute: {
            include: {
              steps: { orderBy: { position: 'asc' } },
            },
          },
        },
      });
      assert.ok(parallelOrder.processRoute);
      const parallelRoute = parallelOrder.processRoute;
      const [parallelStepA, parallelStepB, parallelStepC] = parallelRoute.steps;

      const parallelACompletion = await completeProcessStep({
        routeId: parallelRoute.id,
        stepId: parallelStepA.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'rework',
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-a-100-defect-10'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelACompletion.goodTransferredQty, 0);
      assert.ok(parallelACompletion.branchWorkOrderId);

      const parallelBCompletion = await completeProcessStep({
        routeId: parallelRoute.id,
        stepId: parallelStepB.id,
        processedQty: 100,
        defectQty: 20,
        defectDisposition: 'rework',
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-b-100-defect-20'),
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelBCompletion.goodTransferredQty, 80);
      assert.ok(parallelBCompletion.branchWorkOrderId);

      const parallelMainCompletion = await completeProcessStep({
        routeId: parallelRoute.id,
        stepId: parallelStepC.id,
        processedQty: 80,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-c-80'),
        expectedRouteVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelMainCompletion.goodTransferredQty, 80);
      assert.equal(parallelMainCompletion.routeCompleted, true);
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelOrder.id } })).completedQty,
        '80',
      );

      const parallelBranchARoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { workOrderId: parallelACompletion.branchWorkOrderId },
        include: { steps: true },
      });
      const parallelBranchBRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { workOrderId: parallelBCompletion.branchWorkOrderId },
        include: { steps: true },
      });
      assert.equal(parallelBranchARoute.steps.length, 1);
      assert.equal(parallelBranchBRoute.steps.length, 1);

      const parallelARework = await completeProcessStep({
        routeId: parallelBranchARoute.id,
        stepId: parallelBranchARoute.steps[0].id,
        processedQty: 10,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-a-rework-10'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelARework.goodTransferredQty, 10);
      const afterParallelARework = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: parallelRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(afterParallelARework.version, 4);
      assert.equal(afterParallelARework.steps[2].inputQty, 80);
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelOrder.id } })).completedQty,
        '80',
      );

      const parallelBRework = await completeProcessStep({
        routeId: parallelBranchBRoute.id,
        stepId: parallelBranchBRoute.steps[0].id,
        processedQty: 20,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-b-rework-20'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelBRework.goodTransferredQty, 20);

      const parallelRouteAfterReturns = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: parallelRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(parallelRouteAfterReturns.version, 5);
      assert.equal(parallelRouteAfterReturns.status, 'in_progress');
      assert.deepEqual(
        parallelRouteAfterReturns.steps.map(step => ({
          processName: step.processName,
          inputQty: step.inputQty,
          processedQty: step.processedQty,
          goodOutputQty: step.goodOutputQty,
          defectOutputQty: step.defectOutputQty,
          releasedGoodQty: step.releasedGoodQty,
          status: step.status,
        })),
        [
          {
            processName: 'parallel A',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            status: 'completed',
          },
          {
            processName: 'parallel B',
            inputQty: 100,
            processedQty: 100,
            goodOutputQty: 100,
            defectOutputQty: 0,
            releasedGoodQty: 100,
            status: 'completed',
          },
          {
            processName: 'final C',
            inputQty: 100,
            processedQty: 80,
            goodOutputQty: 80,
            defectOutputQty: 0,
            releasedGoodQty: 80,
            status: 'current',
          },
        ],
      );
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelOrder.id } })).completedQty,
        '80',
      );

      const parallelTailCompletion = await completeProcessStep({
        routeId: parallelRoute.id,
        stepId: parallelStepC.id,
        processedQty: 20,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-c-rework-return-20'),
        expectedRouteVersion: 5,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelTailCompletion.goodTransferredQty, 20);
      assert.equal(parallelTailCompletion.routeCompleted, true);

      const [parallelCompletedOrder, parallelFinalRoute, parallelCLaborPools] = await Promise.all([
        prisma.workOrder.findUniqueOrThrow({ where: { id: parallelOrder.id } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { id: parallelRoute.id },
          include: { steps: { orderBy: { position: 'asc' } } },
        }),
        prisma.processLaborPool.findMany({
          where: { stepId: parallelStepC.id },
        }),
      ]);
      assert.equal(parallelCompletedOrder.completedQty, '100');
      assert.equal(parallelCompletedOrder.stage, 'completed');
      assert.equal(parallelFinalRoute.status, 'completed');
      assert.equal(
        parallelCLaborPools.reduce((sum, pool) => sum + pool.eligibleQty, 0),
        100,
      );
      assert.equal(
        await prisma.processQuantityMovement.aggregate({
          where: {
            workOrderId: parallelOrder.id,
            type: 'GOOD_TRANSFER',
            targetStepId: parallelStepC.id,
          },
          _sum: { quantity: true },
        }).then(result => result._sum.quantity),
        100,
      );
      assert.equal(
        await prisma.processQuantityMovement.count({
          where: {
            workOrderId: {
              in: [
                parallelACompletion.branchWorkOrderId,
                parallelBCompletion.branchWorkOrderId,
              ],
            },
            type: 'FINISHED_GOOD',
          },
        }),
        0,
      );

      const parallelScrapOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-PARALLEL-SCRAP`,
          customerName: 'integration-test',
          productName: 'parallel scrap reservation product',
          stage: 'frontend',
          status: 'processing',
          processName: 'parallel scrap A / B',
          uncompletedQty: '100',
          productionTargetQty: 100,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} parallel scrap route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: now,
              confirmedById: actor.id,
              startedAt: now,
              routeSource: 'process_template',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-SCRAP-A`,
                    processName: 'scrap parallel A',
                    stageGroup: 'frontend',
                    position: 1,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_000,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-SCRAP-B`,
                    processName: 'scrap parallel B',
                    stageGroup: 'frontend',
                    position: 2,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_000,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-SCRAP-C`,
                    processName: 'scrap final C',
                    stageGroup: 'backend',
                    position: 3,
                    sequenceGroup: 2,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 2_000,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 0,
                    status: 'pending',
                  },
                ],
              },
            },
          },
        },
        include: {
          processRoute: {
            include: { steps: { orderBy: { position: 'asc' } } },
          },
        },
      });
      assert.ok(parallelScrapOrder.processRoute);
      const parallelScrapRoute = parallelScrapOrder.processRoute;
      const [parallelScrapStepA, parallelScrapStepB, parallelScrapStepC] = parallelScrapRoute.steps;
      const parallelScrapACompletion = await completeProcessStep({
        routeId: parallelScrapRoute.id,
        stepId: parallelScrapStepA.id,
        processedQty: 100,
        defectQty: 10,
        defectDisposition: 'scrap_replenish',
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-scrap-a-10'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelScrapACompletion.goodTransferredQty, 0);
      assert.ok(parallelScrapACompletion.branchWorkOrderId);

      const parallelScrapBCompletion = await completeProcessStep({
        routeId: parallelScrapRoute.id,
        stepId: parallelScrapStepB.id,
        processedQty: 100,
        defectQty: 20,
        defectDisposition: 'scrap_replenish',
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-scrap-b-20'),
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelScrapBCompletion.goodTransferredQty, 70);
      assert.ok(parallelScrapBCompletion.branchWorkOrderId);

      const parallelScrapMainFinal = await completeProcessStep({
        routeId: parallelScrapRoute.id,
        stepId: parallelScrapStepC.id,
        processedQty: 70,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'parallel-scrap-c-70'),
        expectedRouteVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(parallelScrapMainFinal.goodTransferredQty, 70);
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelScrapOrder.id } })).completedQty,
        '70',
      );

      async function finishScrapBranch(
        branchWorkOrderId: string,
        quantity: number,
        label: string,
      ) {
        const branchActor = actor;
        assert.ok(branchActor);
        const scrapRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
          where: { workOrderId: branchWorkOrderId },
          include: { steps: { orderBy: [{ sequenceGroup: 'asc' }, { position: 'asc' }] } },
        });
        let version = 0;
        for (const step of scrapRoute.steps) {
          const completion = await completeProcessStep({
            routeId: scrapRoute.id,
            stepId: step.id,
            processedQty: quantity,
            defectQty: 0,
            workDate,
            idempotencyKey: completionKey(prefix, `${label}-${step.position}`),
            expectedRouteVersion: version,
            userId: branchActor.id,
            actor: branchActor.displayName || branchActor.username,
          });
          version += 1;
          assert.equal(completion.remainingInputQty, 0);
        }
        return prisma.workOrder.findUniqueOrThrow({
          where: { id: branchWorkOrderId },
          include: { processRoute: true },
        });
      }

      const completedScrapA = await finishScrapBranch(
        parallelScrapACompletion.branchWorkOrderId,
        10,
        'parallel-scrap-branch-a',
      );
      assert.equal(completedScrapA.branchStatus, 'RESOLVED');
      assert.equal(
        (await prisma.workOrder.findUniqueOrThrow({ where: { id: parallelScrapOrder.id } })).completedQty,
        '80',
      );
      const completedScrapB = await finishScrapBranch(
        parallelScrapBCompletion.branchWorkOrderId,
        20,
        'parallel-scrap-branch-b',
      );
      assert.equal(completedScrapB.branchStatus, 'RESOLVED');

      const parallelScrapCompletedRoot = await prisma.workOrder.findUniqueOrThrow({
        where: { id: parallelScrapOrder.id },
      });
      assert.equal(parallelScrapCompletedRoot.completedQty, '100');
      assert.equal(parallelScrapCompletedRoot.stage, 'completed');
      assert.ok(parallelScrapCompletedRoot.completedAt);
      assert.equal(
        await prisma.processQuantityMovement.aggregate({
          where: {
            workOrderId: parallelScrapOrder.id,
            type: 'GOOD_TRANSFER',
            targetStepId: parallelScrapStepC.id,
          },
          _sum: { quantity: true },
        }).then(result => result._sum.quantity),
        70,
      );

      const perBatchOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-PER-BATCH`,
          customerName: 'integration-test',
          productName: 'split release per-batch product',
          stage: 'frontend',
          status: 'processing',
          processName: 'batch upstream',
          uncompletedQty: '100',
          productionTargetQty: 100,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} split-release per-batch route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: now,
              confirmedById: actor.id,
              startedAt: now,
              routeSource: 'process_template',
              steps: {
                create: [
                  {
                    processCode: `${prefix}-BATCH-UPSTREAM`,
                    processName: 'batch upstream',
                    stageGroup: 'frontend',
                    position: 1,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 500,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 100,
                    status: 'current',
                    startedAt: now,
                  },
                  {
                    processCode: `${prefix}-BATCH-DOWNSTREAM`,
                    processName: 'batch downstream',
                    stageGroup: 'backend',
                    position: 2,
                    sequenceGroup: 2,
                    standardSource: 'integration_test',
                    timeBasis: 'per_batch',
                    unitLabel: 'batch',
                    standardMillisecondsPerUnit: 600_000,
                    setupMilliseconds: 120_000,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 0,
                    status: 'pending',
                  },
                ],
              },
            },
          },
        },
        include: {
          processRoute: {
            include: {
              steps: { orderBy: { position: 'asc' } },
            },
          },
        },
      });
      assert.ok(perBatchOrder.processRoute);
      const perBatchRoute = perBatchOrder.processRoute;
      const [perBatchUpstreamStep, perBatchDownstreamStep] = perBatchRoute.steps;

      const perBatchUpstreamFirst = await completeProcessStep({
        routeId: perBatchRoute.id,
        stepId: perBatchUpstreamStep.id,
        processedQty: 50,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-upstream-50-first'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchUpstreamFirst.goodTransferredQty, 50);
      assert.equal(perBatchUpstreamFirst.remainingInputQty, 50);
      assert.equal(perBatchUpstreamFirst.routeCompleted, false);

      const perBatchDownstreamFirst = await completeProcessStep({
        routeId: perBatchRoute.id,
        stepId: perBatchDownstreamStep.id,
        processedQty: 50,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-downstream-50-first'),
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchDownstreamFirst.goodTransferredQty, 50);
      assert.equal(perBatchDownstreamFirst.remainingInputQty, 0);
      assert.equal(perBatchDownstreamFirst.routeCompleted, false);
      assert.equal(perBatchDownstreamFirst.laborPoolId, null);
      assert.equal(
        await prisma.processLaborPool.count({
          where: { stepId: perBatchDownstreamStep.id },
        }),
        0,
      );

      const perBatchUpstreamFinal = await completeProcessStep({
        routeId: perBatchRoute.id,
        stepId: perBatchUpstreamStep.id,
        processedQty: 50,
        defectQty: 20,
        defectDisposition: 'rework',
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-upstream-50-defect-20'),
        expectedRouteVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchUpstreamFinal.goodTransferredQty, 30);
      assert.equal(perBatchUpstreamFinal.remainingInputQty, 0);
      assert.equal(perBatchUpstreamFinal.routeCompleted, false);
      assert.ok(perBatchUpstreamFinal.branchWorkOrderId);

      const perBatchBeforeSecondDownstream = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: perBatchRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(perBatchBeforeSecondDownstream.steps[0].status, 'completed');
      assert.equal(perBatchBeforeSecondDownstream.steps[1].status, 'current');
      assert.equal(perBatchBeforeSecondDownstream.steps[1].inputQty, 80);
      assert.equal(perBatchBeforeSecondDownstream.steps[1].processedQty, 50);
      assert.equal(
        await prisma.processLaborPool.count({
          where: { stepId: perBatchDownstreamStep.id },
        }),
        0,
      );

      const perBatchDownstreamBeforeRework = await completeProcessStep({
        routeId: perBatchRoute.id,
        stepId: perBatchDownstreamStep.id,
        processedQty: 30,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-downstream-30-before-rework'),
        expectedRouteVersion: 3,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchDownstreamBeforeRework.goodTransferredQty, 30);
      assert.equal(perBatchDownstreamBeforeRework.remainingInputQty, 0);
      assert.equal(perBatchDownstreamBeforeRework.routeCompleted, true);
      assert.equal(perBatchDownstreamBeforeRework.laborPoolId, null);
      assert.equal(
        await prisma.processLaborPool.count({
          where: { stepId: perBatchDownstreamStep.id },
        }),
        0,
      );

      const perBatchReworkRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { workOrderId: perBatchUpstreamFinal.branchWorkOrderId },
        include: { steps: true },
      });
      assert.equal(perBatchReworkRoute.steps.length, 1);
      const perBatchReworkCompletion = await completeProcessStep({
        routeId: perBatchReworkRoute.id,
        stepId: perBatchReworkRoute.steps[0].id,
        processedQty: 20,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-upstream-rework-20'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchReworkCompletion.goodTransferredQty, 20);
      assert.equal(perBatchReworkCompletion.routeCompleted, true);
      assert.equal(
        await prisma.processLaborPool.count({
          where: { stepId: perBatchDownstreamStep.id },
        }),
        0,
      );

      const perBatchBeforeFinal = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: perBatchRoute.id },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(perBatchBeforeFinal.version, 5);
      assert.equal(perBatchBeforeFinal.status, 'in_progress');
      assert.equal(perBatchBeforeFinal.steps[1].inputQty, 100);
      assert.equal(perBatchBeforeFinal.steps[1].processedQty, 80);
      assert.equal(perBatchBeforeFinal.steps[1].status, 'current');

      const perBatchDownstreamFinal = await completeProcessStep({
        routeId: perBatchRoute.id,
        stepId: perBatchDownstreamStep.id,
        processedQty: 20,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'per-batch-downstream-20-final'),
        expectedRouteVersion: 5,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(perBatchDownstreamFinal.goodTransferredQty, 20);
      assert.equal(perBatchDownstreamFinal.remainingInputQty, 0);
      assert.equal(perBatchDownstreamFinal.routeCompleted, true);
      assert.ok(perBatchDownstreamFinal.laborPoolId);

      const perBatchPools = await prisma.processLaborPool.findMany({
        where: { stepId: perBatchDownstreamStep.id },
        orderBy: { createdAt: 'asc' },
      });
      assert.equal(perBatchPools.length, 1);
      assert.equal(perBatchPools[0].id, perBatchDownstreamFinal.laborPoolId);
      assert.equal(perBatchPools[0].completionId, perBatchDownstreamFinal.completionId);
      assert.equal(perBatchPools[0].eligibleQty, 100);
      assert.equal(perBatchPools[0].claimedQty, 0);
      assert.equal(perBatchPools[0].remainingQty, 100);
      assert.equal(perBatchPools[0].standardMillisecondsPerUnit, 600_000);
      assert.equal(perBatchPools[0].setupMilliseconds, 120_000);
      assert.equal(perBatchPools[0].totalStandardLaborMilliseconds, 720_000n);
      assert.equal(perBatchPools[0].remainingStandardLaborMilliseconds, 720_000n);
      assert.equal(perBatchPools[0].status, 'OPEN');
      const completedPerBatchOrder = await prisma.workOrder.findUniqueOrThrow({
        where: { id: perBatchOrder.id },
        include: { processRoute: true },
      });
      assert.equal(completedPerBatchOrder.completedQty, '100');
      assert.equal(completedPerBatchOrder.processRoute?.status, 'completed');

      const noStandardOrder = await prisma.workOrder.create({
        data: {
          code: `${prefix}-NO-STANDARD`,
          customerName: 'integration-test',
          productName: 'no standard product',
          stage: 'frontend',
          status: 'processing',
          processName: 'manual operation',
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt: now,
          processRoute: {
            create: {
              templateName: `${prefix} no-standard route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: now,
              confirmedById: actor.id,
              startedAt: now,
              routeSource: 'process_template',
              steps: {
                create: {
                  processCode: `${prefix}-MANUAL`,
                  processName: 'manual operation',
                  stageGroup: 'frontend',
                  position: 1,
                  sequenceGroup: 1,
                  standardSource: 'integration_test_missing',
                  timeBasis: null,
                  unitLabel: null,
                  standardMillisecondsPerUnit: null,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: false,
                  inputQty: 10,
                  status: 'current',
                  startedAt: now,
                },
              },
            },
          },
        },
        include: {
          processRoute: {
            include: { steps: true },
          },
        },
      });
      assert.ok(noStandardOrder.processRoute);
      const noStandardCompletion = await completeProcessStep({
        routeId: noStandardOrder.processRoute.id,
        stepId: noStandardOrder.processRoute.steps[0].id,
        processedQty: 10,
        defectQty: 0,
        workDate,
        idempotencyKey: completionKey(prefix, 'no-standard-10'),
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(noStandardCompletion.routeCompleted, true);
      assert.equal(noStandardCompletion.goodTransferredQty, 10);
      assert.ok(noStandardCompletion.laborPoolId);
      assert.equal(noStandardCompletion.laborPoolPendingStandard, true);
      const pendingStandardPool = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: noStandardCompletion.laborPoolId },
      });
      assert.equal(pendingStandardPool.status, 'LOCKED');
      assert.equal(pendingStandardPool.standardSource, 'pending_standard');
      assert.equal(pendingStandardPool.eligibleQty, 10);
      assert.equal(pendingStandardPool.totalStandardLaborMilliseconds, 0n);
      await assert.rejects(
        claimProcessLaborPool({
          poolId: pendingStandardPool.id,
          employeeId: employeeA.id,
          quantity: 10,
          expectedVersion: pendingStandardPool.version,
          idempotencyKey: claimKey(prefix, 'pending-standard-must-not-claim'),
          userId: employeeActor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_STANDARD_PENDING',
      );
      await assert.rejects(
        resolveProcessLaborPoolStandard({
          poolId: pendingStandardPool.id,
          expectedVersion: pendingStandardPool.version,
          timeBasis: 'per_unit',
          standardMillisecondsPerUnit: 1_000,
          setupMilliseconds: 0,
          unitsPerProduct: 1,
          countsForEfficiency: true,
          reason: 'team lead must not resolve standard',
          userId: teamLeadActor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_STANDARD_FORBIDDEN',
      );
      const resolvedStandardPool = await resolveProcessLaborPoolStandard({
        poolId: pendingStandardPool.id,
        expectedVersion: pendingStandardPool.version,
        timeBasis: 'per_unit',
        standardMillisecondsPerUnit: 1_000,
        setupMilliseconds: 0,
        unitsPerProduct: 1,
        countsForEfficiency: true,
        reason: 'integration test standard backfill',
        userId: actor.id,
      });
      assert.equal(resolvedStandardPool.pool.pendingStandard, false);
      assert.equal(resolvedStandardPool.pool.status, 'OPEN');
      assert.equal(resolvedStandardPool.pool.totalStandardLaborMilliseconds, 10_000);
      const resolvedClaim = await claimProcessLaborPool({
        poolId: pendingStandardPool.id,
        employeeId: employeeA.id,
        quantity: 10,
        expectedVersion: resolvedStandardPool.pool.version,
        idempotencyKey: claimKey(prefix, 'resolved-standard-claim'),
        userId: employeeActor.id,
      });
      assert.equal(resolvedClaim.pool.status, 'EXHAUSTED');
      assert.equal(resolvedClaim.claim.standardLaborMilliseconds, 10_000);
      await assert.rejects(
        voidProcessLaborClaim({
          claimId: resolvedClaim.claim.id,
          expectedPoolVersion: resolvedClaim.pool.version,
          reason: 'employee must not self-void',
          idempotencyKey: claimKey(prefix, 'employee-self-void-forbidden'),
          userId: employeeActor.id,
        }),
        (error: unknown) => error instanceof ProcessLaborServiceError
          && error.code === 'PROCESS_LABOR_VOID_FORBIDDEN',
      );
      const noStandardCompletedOrder = await prisma.workOrder.findUniqueOrThrow({
        where: { id: noStandardOrder.id },
        include: { processRoute: true },
      });
      assert.equal(noStandardCompletedOrder.completedQty, '10');
      assert.equal(noStandardCompletedOrder.processRoute?.status, 'completed');
    } finally {
      if (databaseConnected) {
        const workOrders = await prisma.workOrder.findMany({
          where: { code: { startsWith: prefix } },
          select: { id: true, parentWorkOrderId: true },
        });
        const workOrderIds = workOrders.map(item => item.id);
        const routes = workOrderIds.length
          ? await prisma.workOrderProcessRoute.findMany({
              where: { workOrderId: { in: workOrderIds } },
              select: { id: true, workOrderId: true },
            })
          : [];
        const routeIds = routes.map(item => item.id);
        const completions = routeIds.length
          ? await prisma.processCompletion.findMany({
              where: { routeId: { in: routeIds } },
              select: { id: true, workOrderId: true },
            })
          : [];
        const completionIds = completions.map(item => item.id);
        const pools = completionIds.length
          ? await prisma.processLaborPool.findMany({
              where: { completionId: { in: completionIds } },
              select: { id: true },
            })
          : [];
        const poolIds = pools.map(item => item.id);
        const claims = poolIds.length
          ? await prisma.processLaborClaim.findMany({
              where: { poolId: { in: poolIds } },
              select: { id: true },
            })
          : [];
        const claimIds = claims.map(item => item.id);
        const createdEmployees = await prisma.employee.findMany({
          where: { employeeNo: { startsWith: prefix } },
          select: { id: true },
        });
        for (const employee of createdEmployees) employeeIds.add(employee.id);

        if (poolIds.length) {
          await prisma.processLaborClaim.deleteMany({
            where: { poolId: { in: poolIds }, reversalOfId: { not: null } },
          });
          await prisma.processLaborClaim.deleteMany({
            where: { poolId: { in: poolIds } },
          });
          await prisma.processLaborPool.deleteMany({
            where: { id: { in: poolIds } },
          });
        }
        if (completionIds.length) {
          await prisma.processQuantityMovement.deleteMany({
            where: { completionId: { in: completionIds } },
          });
        }
        const logTargetIds = [
          ...workOrderIds,
          ...routeIds,
          ...completionIds,
          ...poolIds,
          ...claimIds,
        ];
        if (logTargetIds.length) {
          await prisma.operationLog.deleteMany({
            where: { targetId: { in: logTargetIds } },
          });
        }

        const workOrderById = new Map(workOrders.map(order => [order.id, order]));
        const depthOf = (workOrderId: string) => {
          let depth = 0;
          let cursor = workOrderById.get(workOrderId)?.parentWorkOrderId || null;
          const visited = new Set<string>();
          while (cursor && workOrderById.has(cursor) && !visited.has(cursor)) {
            visited.add(cursor);
            depth += 1;
            cursor = workOrderById.get(cursor)?.parentWorkOrderId || null;
          }
          return depth;
        };
        const branchOrders = workOrders
          .filter(order => order.parentWorkOrderId)
          .sort((left, right) => depthOf(right.id) - depthOf(left.id));
        for (const branchOrder of branchOrders) {
          await prisma.processCompletion.deleteMany({
            where: { workOrderId: branchOrder.id },
          });
          await prisma.workOrderProcessRoute.deleteMany({
            where: { workOrderId: branchOrder.id },
          });
          await prisma.workOrder.delete({
            where: { id: branchOrder.id },
          });
        }

        const rootOrderIds = workOrders
          .filter(order => !order.parentWorkOrderId)
          .map(order => order.id);
        if (rootOrderIds.length) {
          await prisma.processCompletion.deleteMany({
            where: { workOrderId: { in: rootOrderIds } },
          });
          await prisma.workOrderProcessRoute.deleteMany({
            where: { workOrderId: { in: rootOrderIds } },
          });
          await prisma.workOrder.deleteMany({
            where: { id: { in: rootOrderIds } },
          });
        }
        if (employeeIds.size) {
          await prisma.employee.deleteMany({
            where: { id: { in: [...employeeIds] } },
          });
        }
        if (userIds.size) {
          await prisma.operationLog.deleteMany({
            where: { userId: { in: [...userIds] } },
          });
          await prisma.user.deleteMany({
            where: { id: { in: [...userIds] } },
          });
        }
      }
    }
  },
);
