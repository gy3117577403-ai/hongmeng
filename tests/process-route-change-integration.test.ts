import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  DailyProcessTaskStatus,
  DailyProductionPlanStatus,
  DailyTaskAssignmentStatus,
  ProcessCompletionSource,
} from '@prisma/client';
import { completeProcessStep } from '../lib/process-completion-service';
import {
  activateProcessRouteChange,
  completeProcessSupplementObligation,
  createProcessRouteChangeProposal,
  reviewProcessRouteChange,
  submitProcessRouteChange,
} from '../lib/process-route-change-service';
import { prisma } from '../lib/prisma';
import { PRODUCTION_DEPARTMENT } from '../lib/production-workforce';
import { loadFieldReportTicket } from '../lib/work-order-qr-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'late insertion keeps the same QR, creates no quantity flow, records real labor, and replays safely',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RC-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const publicCode = `${randomUUID().replaceAll('-', '')}${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, username: true, displayName: true },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-E`,
        name: `${prefix} operator`,
        department: PRODUCTION_DEPARTMENT,
        team: `${prefix}-TEAM`,
        isActive: true,
        attendanceEnabled: true,
      },
    });
    const definitions = await Promise.all([
      prisma.processDefinition.create({
        data: { code: `${prefix}-CUT`, name: `${prefix} cut`, stageGroup: 'frontend', sortOrder: 1 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-PACK`, name: `${prefix} pack`, stageGroup: 'backend', sortOrder: 2 },
      }),
      prisma.processDefinition.create({
        data: { code: `${prefix}-SUP`, name: `${prefix} supplement`, stageGroup: 'backend', sortOrder: 3 },
      }),
    ]);

    let workOrderId = '';
    let routeId = '';
    let changeId = '';
    let changeRequestId = '';
    let obligationId = '';
    let supplementCompletionId = '';
    let firstSupplementCompletionId = '';
    let downstreamCompletionId = '';
    let dailyPlanId = '';
    let teamId = '';
    try {
      const startedAt = new Date('2026-08-11T00:00:00.000Z');
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          customerName: 'integration-test',
          productName: 'late insertion product',
          stage: 'frontend',
          status: 'processing',
          processName: definitions[0].name,
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt,
          qrTicket: {
            create: { publicCode, createdById: actor.id },
          },
          processRoute: {
            create: {
              templateName: `${prefix} route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: startedAt,
              confirmedById: actor.id,
              startedAt,
              routeSource: 'integration_test',
              steps: {
                create: [
                  {
                    processDefinitionId: definitions[0].id,
                    processCode: definitions[0].code,
                    processName: definitions[0].name,
                    stageGroup: definitions[0].stageGroup,
                    position: 1,
                    sequenceGroup: 1,
                    standardSource: 'integration_test',
                    timeBasis: 'per_unit',
                    unitLabel: 'piece',
                    standardMillisecondsPerUnit: 1_000,
                    setupMilliseconds: 0,
                    unitsPerProduct: 1,
                    countsForEfficiency: true,
                    inputQty: 10,
                    status: 'current',
                    startedAt,
                  },
                  {
                    processDefinitionId: definitions[1].id,
                    processCode: definitions[1].code,
                    processName: definitions[1].name,
                    stageGroup: definitions[1].stageGroup,
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
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      workOrderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;
      const [cutStep, packStep] = order.processRoute.steps;

      await completeProcessStep({
        routeId,
        stepId: cutStep.id,
        processedQty: 10,
        defectQty: 0,
        workDate: '2026-08-11',
        employeeIds: [employee.id],
        requireParticipants: true,
        autoAssignLabor: true,
        idempotencyKey: `${prefix}-complete-cut`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const completedDownstream = await completeProcessStep({
        routeId,
        stepId: packStep.id,
        processedQty: 10,
        defectQty: 0,
        workDate: '2026-08-11',
        employeeIds: [employee.id],
        requireParticipants: true,
        autoAssignLabor: true,
        idempotencyKey: `${prefix}-complete-pack`,
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(completedDownstream.routeCompleted, true);
      assert.ok(completedDownstream.laborPoolId);
      downstreamCompletionId = completedDownstream.completionId;
      const originalDownstreamClaim = await prisma.processLaborClaim.findFirstOrThrow({
        where: { poolId: completedDownstream.laborPoolId, status: 'ACTIVE' },
      });
      assert.equal(originalDownstreamClaim.standardLaborMilliseconds, 20_000n);
      const team = await prisma.productionTeam.create({
        data: { code: `${prefix}-DAILY-TEAM`, name: `${prefix} daily team` },
      });
      teamId = team.id;
      const dailyPlan = await prisma.dailyProductionPlan.create({
        data: {
          workDate: startedAt,
          shiftCode: 'DAY',
          teamId: team.id,
          status: DailyProductionPlanStatus.IN_PROGRESS,
          confirmedAt: startedAt,
          confirmedById: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      dailyPlanId = dailyPlan.id;
      const completedPackDailyTask = await prisma.dailyProcessTask.create({
        data: {
          planId: dailyPlan.id,
          workDate: dailyPlan.workDate,
          shiftCode: dailyPlan.shiftCode,
          workOrderId,
          routeId,
          stepId: packStep.id,
          routeVersion: 2,
          processCode: packStep.processCode,
          processName: packStep.processName,
          stageGroup: packStep.stageGroup,
          position: packStep.position,
          sequenceGroup: packStep.sequenceGroup,
          standardSource: packStep.standardSource,
          timeBasis: 'per_unit',
          unitLabel: packStep.unitLabel || 'piece',
          standardMillisecondsPerUnit: 2_000,
          setupMilliseconds: packStep.setupMilliseconds,
          unitsPerProduct: packStep.unitsPerProduct,
          countsForEfficiency: packStep.countsForEfficiency,
          plannedQty: 10,
          availableQty: 0,
          status: DailyProcessTaskStatus.COMPLETED,
          sortOrder: 1,
        },
      });
      const completedPackAssignment = await prisma.dailyTaskAssignment.create({
        data: {
          taskId: completedPackDailyTask.id,
          employeeId: employee.id,
          assignedTeamId: team.id,
          quantity: 10,
          plannedStandardMilliseconds: 20_000n,
          status: DailyTaskAssignmentStatus.COMPLETED,
          idempotencyKey: `${prefix}-daily-pack-assignment`,
          assignedById: actor.id,
        },
      });

      const beforeTicket = await loadFieldReportTicket(publicCode);
      assert.equal(beforeTicket.publicCode, publicCode);
      assert.equal(beforeTicket.route?.version, 2);
      const beforeMovements = await prisma.processQuantityMovement.findMany({
        where: { workOrderId },
        orderBy: { createdAt: 'asc' },
      });
      const beforeFinishedGoods = beforeMovements
        .filter(item => item.type === 'FINISHED_GOOD')
        .reduce((sum, item) => sum + item.quantity, 0);
      const beforeOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });

      const proposal = await createProcessRouteChangeProposal({
        workOrderId,
        routeId,
        title: 'Insert missed supplemental operation',
        reason: 'The downstream operation was already reported',
        scope: 'CURRENT_WORK_ORDER_ONLY',
        diffs: [
          {
            kind: 'INSERT_STEP',
            processDefinitionId: definitions[2].id,
            targetStepId: packStep.id,
            afterData: {
              insertBeforeStepId: packStep.id,
              standardMillisecondsPerUnit: 4_000,
              setupMilliseconds: 5_000,
              requiredQty: 10,
              unitLabel: 'piece',
            },
          },
          {
            kind: 'UPDATE_TIME',
            targetStepId: packStep.id,
            processDefinitionId: definitions[1].id,
            afterData: {
              standardMillisecondsPerUnit: 3_000,
              unitLabel: 'piece',
            },
          },
        ],
        idempotencyKey: `${prefix}-create-change`,
        expectedVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      changeId = proposal.id;
      changeRequestId = proposal.changeRequestId;
      const proposalImpact = proposal.impact as Record<string, unknown>;
      assert.equal(proposalImpact.downstreamReportedStepCount, 1);
      assert.equal(proposalImpact.affectedCompletionCount, 1);
      assert.equal(proposalImpact.affectedClaimCount, 1);
      assert.equal(proposalImpact.affectedEmployeeCount, 1);
      assert.equal(proposalImpact.previousStandardLaborMilliseconds, 20_000);
      assert.equal(proposalImpact.nextStandardLaborMilliseconds, 30_000);
      const submitted = await submitProcessRouteChange({
        changeId,
        idempotencyKey: `${prefix}-submit-change`,
        expectedVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const [reviewed, concurrentReviewReplay] = await Promise.all([
        reviewProcessRouteChange({
          changeId,
          decision: 'approve',
          idempotencyKey: `${prefix}-approve-change-a`,
          expectedVersion: submitted.version,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        reviewProcessRouteChange({
          changeId,
          decision: 'approve',
          idempotencyKey: `${prefix}-approve-change-b`,
          expectedVersion: submitted.version,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
      ]);
      assert.equal(concurrentReviewReplay.status, 'APPROVED');
      assert.equal(concurrentReviewReplay.version, reviewed.version);
      const activationCommand = {
        changeId,
        expectedRouteVersion: 2,
        idempotencyKey: `${prefix}-activate-change`,
        expectedVersion: reviewed.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      };
      const activated = await activateProcessRouteChange(activationCommand);
      const activationReplay = await activateProcessRouteChange(activationCommand);
      assert.equal(activationReplay.id, activated.id);
      assert.equal(activationReplay.version, activated.version);
      const staleActivationReplay = await activateProcessRouteChange({
        ...activationCommand,
        idempotencyKey: `${prefix}-activate-change-stale-panel`,
      });
      assert.equal(staleActivationReplay.status, 'ACTIVE');
      assert.equal(staleActivationReplay.version, activated.version);
      assert.equal(await prisma.processRouteChangeEvent.count({
        where: { changeId, action: 'activate' },
      }), 1);
      const staleReviewReplay = await reviewProcessRouteChange({
        changeId,
        decision: 'approve',
        idempotencyKey: `${prefix}-approve-after-activation`,
        expectedVersion: submitted.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(staleReviewReplay.status, 'ACTIVE');
      assert.equal(staleReviewReplay.version, activated.version);
      assert.equal(await prisma.processRouteChangeEvent.count({
        where: { changeId, action: 'approve' },
      }), 1);
      assert.equal(activated.supplementObligations.length, 1);
      obligationId = activated.supplementObligations[0].id;

      const afterActivationTicket = await loadFieldReportTicket(publicCode);
      assert.equal(afterActivationTicket.publicCode, publicCode);
      assert.equal(afterActivationTicket.route?.version, 3);
      const insertedStep = afterActivationTicket.route?.steps.find(step => step.supplementObligation?.id === obligationId);
      assert.ok(insertedStep);
      assert.equal(insertedStep.changeSource, 'NEW');
      assert.equal(insertedStep.changeTag, 'ADDED');
      assert.equal(insertedStep.executionMode, 'SUPPLEMENTAL_OBLIGATION');
      assert.equal(insertedStep.status, 'current');
      assert.equal(insertedStep.supplementObligation?.remainingQty, 10);
      const changedDownstreamStep = afterActivationTicket.route?.steps.find(step => step.id === packStep.id);
      assert.equal(changedDownstreamStep?.changeTag, 'TIME_CHANGED');
      assert.equal(changedDownstreamStep?.standardMillisecondsPerUnit, 3_000);
      const dailyTasksAfterActivation = await prisma.dailyProcessTask.findMany({
        where: { planId: dailyPlan.id },
        include: { assignments: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      assert.equal(dailyTasksAfterActivation.length, 2);
      const preservedPackTask = dailyTasksAfterActivation.find(item => item.id === completedPackDailyTask.id);
      assert.ok(preservedPackTask);
      assert.equal(preservedPackTask.routeVersion, 2);
      assert.equal(preservedPackTask.standardMillisecondsPerUnit, 2_000);
      assert.equal(preservedPackTask.status, DailyProcessTaskStatus.COMPLETED);
      assert.equal(
        preservedPackTask.assignments.find(item => item.id === completedPackAssignment.id)
          ?.plannedStandardMilliseconds,
        20_000n,
      );
      const supplementDailyTask = dailyTasksAfterActivation.find(item => item.stepId === insertedStep.id);
      assert.ok(supplementDailyTask);
      assert.equal(supplementDailyTask.routeVersion, 3);
      assert.equal(supplementDailyTask.plannedQty, 10);
      assert.equal(supplementDailyTask.availableQty, 0);
      assert.equal(supplementDailyTask.status, DailyProcessTaskStatus.WAITING_UPSTREAM);
      assert.equal(supplementDailyTask.standardMillisecondsPerUnit, 4_000);
      assert.ok((supplementDailyTask.riskWarnings as string[]).includes('PROCESS_SUPPLEMENT_OBLIGATION'));
      assert.ok((supplementDailyTask.riskWarnings as string[]).includes('ZERO_MATERIAL_FLOW'));

      const correctedDownstream = await prisma.processCompletion.findUniqueOrThrow({
        where: { id: downstreamCompletionId },
        include: { laborPool: { include: { claims: { orderBy: { createdAt: 'asc' } } } } },
      });
      assert.equal(correctedDownstream.standardMillisecondsPerUnit, 3_000);
      assert.equal(correctedDownstream.laborPool?.totalStandardLaborMilliseconds, 30_000n);
      const correctedClaims = correctedDownstream.laborPool?.claims || [];
      assert.equal(correctedClaims.filter(item => item.status === 'VOIDED').length, 1);
      assert.equal(correctedClaims.filter(item => item.status === 'REVERSAL').length, 1);
      assert.equal(correctedClaims.filter(item => item.status === 'ACTIVE').length, 1);
      assert.equal(
        correctedClaims.find(item => item.status === 'REVERSAL')?.standardLaborMilliseconds,
        -20_000n,
      );
      assert.equal(
        correctedClaims.find(item => item.status === 'ACTIVE')?.standardLaborMilliseconds,
        30_000n,
      );

      const firstCompletionCommand = {
        obligationId,
        routeId,
        publicCode,
        expectedRouteVersion: 3,
        processedQty: 4,
        defectQty: 0,
        workDate: '2026-08-11',
        employeeIds: [employee.id],
        idempotencyKey: `${prefix}-complete-supplement-first`,
        expectedVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      };
      const firstSupplement = await completeProcessSupplementObligation(firstCompletionCommand);
      firstSupplementCompletionId = firstSupplement.completionId;
      const firstReplay = await completeProcessSupplementObligation(firstCompletionCommand);
      assert.equal(firstReplay.completionId, firstSupplement.completionId);
      assert.equal(firstReplay.routeVersion, firstSupplement.routeVersion);
      assert.equal(firstSupplement.status, 'ACTIVE');
      assert.equal(firstSupplement.remainingQty, 6);
      assert.equal(firstSupplement.standardLaborMilliseconds, '21000');
      const partialDailySupplement = await prisma.dailyProcessTask.findUniqueOrThrow({
        where: { id: supplementDailyTask.id },
      });
      assert.equal(partialDailySupplement.routeVersion, 4);
      assert.equal(partialDailySupplement.status, DailyProcessTaskStatus.IN_PROGRESS);
      assert.equal(partialDailySupplement.availableQty, 0);

      const partialTicket = await loadFieldReportTicket(publicCode);
      assert.equal(partialTicket.route?.version, 4);
      assert.equal(partialTicket.route?.status, 'in_progress');
      assert.equal(
        partialTicket.route?.steps.find(step => step.supplementObligation?.id === obligationId)
          ?.supplementObligation?.remainingQty,
        6,
      );

      const supplementTimeProposal = await createProcessRouteChangeProposal({
        workOrderId,
        routeId,
        title: 'Correct active supplemental operation time',
        reason: 'The first partial supplemental report exposed the time omission',
        scope: 'CURRENT_WORK_ORDER_ONLY',
        diffs: [{
          kind: 'UPDATE_TIME',
          targetStepId: insertedStep.id,
          processDefinitionId: definitions[2].id,
          afterData: {
            standardMillisecondsPerUnit: 5_000,
            setupMilliseconds: 7_000,
            unitLabel: 'piece-new',
            unitsPerProduct: 1,
            countsForEfficiency: false,
          },
        }],
        idempotencyKey: `${prefix}-create-supplement-time-change`,
        expectedVersion: 4,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const supplementTimeImpact = supplementTimeProposal.impact as Record<string, unknown>;
      assert.equal(supplementTimeImpact.downstreamReportedStepCount, 0);
      assert.equal(supplementTimeImpact.affectedCompletionCount, 1);
      assert.equal(supplementTimeImpact.affectedClaimCount, 1);
      assert.equal(supplementTimeImpact.affectedEmployeeCount, 1);
      assert.equal(supplementTimeImpact.previousStandardLaborMilliseconds, 21_000);
      assert.equal(supplementTimeImpact.nextStandardLaborMilliseconds, 27_000);
      const submittedTimeChange = await submitProcessRouteChange({
        changeId: supplementTimeProposal.id,
        idempotencyKey: `${prefix}-submit-supplement-time-change`,
        expectedVersion: supplementTimeProposal.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const reviewedTimeChange = await reviewProcessRouteChange({
        changeId: supplementTimeProposal.id,
        decision: 'approve',
        timeChanges: [{
          stepId: insertedStep.id,
          standardMillisecondsPerUnit: 6_000,
        }],
        idempotencyKey: `${prefix}-approve-supplement-time-change`,
        expectedVersion: submittedTimeChange.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const reviewedTimeImpact = reviewedTimeChange.impact as Record<string, unknown>;
      assert.equal(reviewedTimeImpact.previousStandardLaborMilliseconds, 21_000);
      assert.equal(reviewedTimeImpact.nextStandardLaborMilliseconds, 31_000);
      assert.equal(reviewedTimeImpact.deltaStandardLaborMilliseconds, 10_000);
      await activateProcessRouteChange({
        changeId: supplementTimeProposal.id,
        expectedRouteVersion: 4,
        idempotencyKey: `${prefix}-activate-supplement-time-change`,
        expectedVersion: reviewedTimeChange.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const revisedObligation = await prisma.processSupplementObligation.findUniqueOrThrow({
        where: { id: obligationId },
      });
      assert.equal(revisedObligation.version, 2);
      assert.equal(revisedObligation.standardMillisecondsPerUnit, 6_000);
      assert.equal(revisedObligation.setupMilliseconds, 7_000);
      assert.equal(revisedObligation.unitLabel, 'piece-new');
      assert.equal(revisedObligation.countsForEfficiency, false);
      const revisedDailySupplement = await prisma.dailyProcessTask.findUniqueOrThrow({
        where: { id: supplementDailyTask.id },
      });
      assert.equal(revisedDailySupplement.routeVersion, 5);
      assert.equal(revisedDailySupplement.status, DailyProcessTaskStatus.IN_PROGRESS);
      assert.equal(revisedDailySupplement.availableQty, 0);
      assert.equal(revisedDailySupplement.standardMillisecondsPerUnit, 6_000);
      const correctedFirstSupplement = await prisma.processCompletion.findUniqueOrThrow({
        where: { id: firstSupplementCompletionId },
        include: { laborPool: { include: { claims: true } } },
      });
      assert.equal(correctedFirstSupplement.standardMillisecondsPerUnit, 6_000);
      assert.equal(correctedFirstSupplement.setupMilliseconds, 7_000);
      assert.equal(correctedFirstSupplement.laborPool?.totalStandardLaborMilliseconds, 31_000n);
      assert.equal(
        correctedFirstSupplement.laborPool?.claims.find(item => item.status === 'ACTIVE')
          ?.standardLaborMilliseconds,
        31_000n,
      );

      const finalCompletionCommand = {
        ...firstCompletionCommand,
        expectedRouteVersion: 5,
        processedQty: 6,
        idempotencyKey: `${prefix}-complete-supplement-final`,
        expectedVersion: 2,
      };
      const supplement = await completeProcessSupplementObligation(finalCompletionCommand);
      supplementCompletionId = supplement.completionId;
      const supplementReplay = await completeProcessSupplementObligation(finalCompletionCommand);
      assert.equal(supplementReplay.completionId, supplement.completionId);
      assert.equal(supplementReplay.routeVersion, supplement.routeVersion);
      assert.equal(supplement.quantityMovementCount, 0);
      assert.equal(supplement.completedQtyDelta, 0);
      assert.equal(supplement.status, 'FULFILLED');
      assert.equal(supplement.remainingQty, 0);
      assert.equal(supplement.standardLaborMilliseconds, '36000');

      const [storedSupplement, movements, currentOrder, currentRoute, currentTicket] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({
          where: { id: supplementCompletionId },
          include: { laborPool: { include: { claims: true } } },
        }),
        prisma.processQuantityMovement.findMany({ where: { workOrderId }, orderBy: { createdAt: 'asc' } }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: routeId } }),
        loadFieldReportTicket(publicCode),
      ]);
      assert.equal(storedSupplement.reportSource, ProcessCompletionSource.SUPPLEMENT_OBLIGATION);
      assert.equal(storedSupplement.supplementObligationId, obligationId);
      assert.equal(storedSupplement.setupMilliseconds, 0);
      assert.equal(storedSupplement.laborPool?.status, 'EXHAUSTED');
      assert.equal(storedSupplement.laborPool?.totalStandardLaborMilliseconds, 36_000n);
      assert.equal(storedSupplement.laborPool?.claims.filter(item => item.status === 'ACTIVE').length, 1);
      assert.equal(storedSupplement.laborPool?.claims[0]?.standardLaborMilliseconds, 36_000n);
      const firstStoredSupplement = await prisma.processCompletion.findUniqueOrThrow({
        where: { id: firstSupplementCompletionId },
        include: { laborPool: { include: { claims: true } } },
      });
      assert.equal(firstStoredSupplement.setupMilliseconds, 7_000);
      assert.equal(firstStoredSupplement.laborPool?.totalStandardLaborMilliseconds, 31_000n);
      assert.equal(movements.length, beforeMovements.length);
      assert.equal(
        movements.filter(item => item.type === 'FINISHED_GOOD').reduce((sum, item) => sum + item.quantity, 0),
        beforeFinishedGoods,
      );
      assert.equal(currentOrder.completedQty, beforeOrder.completedQty);
      assert.equal(currentOrder.status, 'done');
      assert.equal(currentRoute.status, 'completed');
      assert.equal(currentRoute.version, 6);
      assert.equal(currentTicket.publicCode, publicCode);
      assert.equal(currentTicket.route?.version, 6);
      const completedDailySupplement = await prisma.dailyProcessTask.findUniqueOrThrow({
        where: { id: supplementDailyTask.id },
      });
      assert.equal(completedDailySupplement.routeVersion, 6);
      assert.equal(completedDailySupplement.status, DailyProcessTaskStatus.COMPLETED);
      assert.equal(completedDailySupplement.availableQty, 0);
      assert.equal(
        await prisma.processCompletion.count({
          where: { supplementObligationId: obligationId, voidedAt: null },
        }),
        2,
      );
    } finally {
      if (workOrderId) {
        if (dailyPlanId) {
          await prisma.dailyPlanRevision.deleteMany({ where: { planId: dailyPlanId } });
          await prisma.dailyTaskAssignment.deleteMany({ where: { task: { planId: dailyPlanId } } });
          await prisma.dailyProcessTask.deleteMany({ where: { planId: dailyPlanId } });
          await prisma.dailyProductionPlan.deleteMany({ where: { id: dailyPlanId } });
        }
        const pools = await prisma.processLaborPool.findMany({
          where: { workOrderId },
          select: { id: true },
        });
        const poolIds = pools.map(item => item.id);
        if (poolIds.length) await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
        await prisma.processLaborPool.deleteMany({ where: { workOrderId } });
        await prisma.processCompletionCoverage.deleteMany({
          where: {
            OR: [
              { reportCompletion: { workOrderId } },
              { triggerCompletion: { workOrderId } },
            ],
          },
        });
        await prisma.processQuantityMovement.deleteMany({ where: { workOrderId } });
        await prisma.processCompletionParticipant.deleteMany({
          where: { completion: { workOrderId } },
        });
        await prisma.processCompletion.deleteMany({ where: { workOrderId } });
        await prisma.processRouteActivity.deleteMany({ where: { routeId } });
        const changes = await prisma.processRouteChange.findMany({
          where: { workOrderId },
          select: { id: true, changeRequestId: true },
        });
        const changeIds = changes.map(item => item.id);
        if (changeIds.length) {
          await prisma.processSupplementObligation.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeDiff.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeEvent.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
          await prisma.changeRequest.deleteMany({
            where: { id: { in: changes.map(item => item.changeRequestId) } },
          });
        }
        await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      }
      if (teamId) await prisma.productionTeam.deleteMany({ where: { id: teamId } });
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);

test(
  'insertion before an untouched downstream group becomes a normal step and rewires inbound quantity once',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-RC-NORMAL-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, username: true, displayName: true },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-E`,
        name: `${prefix} operator`,
        department: PRODUCTION_DEPARTMENT,
        team: `${prefix}-TEAM`,
        isActive: true,
        attendanceEnabled: true,
      },
    });
    const definitions = await Promise.all(
      ['one', 'two', 'three', 'four', 'inserted'].map((name, index) => prisma.processDefinition.create({
        data: {
          code: `${prefix}-${index + 1}`,
          name: `${prefix} ${name}`,
          stageGroup: index < 2 ? 'frontend' : 'backend',
          sortOrder: index + 1,
        },
      })),
    );
    let workOrderId = '';
    let routeId = '';
    let dailyPlanId = '';
    let teamId = '';
    try {
      const startedAt = new Date('2026-08-11T00:00:00.000Z');
      const order = await prisma.workOrder.create({
        data: {
          code: `${prefix}-ORDER`,
          customerName: 'integration-test',
          productName: 'normal insertion product',
          stage: 'frontend',
          status: 'processing',
          processName: definitions[0].name,
          uncompletedQty: '10',
          productionTargetQty: 10,
          completedQty: '0',
          frontendTransferredQty: 0,
          planType: 'managed_plan',
          planActive: true,
          startedAt,
          processRoute: {
            create: {
              templateName: `${prefix} route`,
              templateVersion: 1,
              status: 'in_progress',
              version: 0,
              confirmedAt: startedAt,
              confirmedById: actor.id,
              startedAt,
              routeSource: 'integration_test',
              steps: {
                create: definitions.slice(0, 4).map((definition, index) => ({
                  processDefinitionId: definition.id,
                  processCode: definition.code,
                  processName: definition.name,
                  stageGroup: definition.stageGroup,
                  position: index + 1,
                  sequenceGroup: index + 1,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: 'piece',
                  standardMillisecondsPerUnit: 1_000 + index * 1_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: index === 0 ? 10 : 0,
                  status: index === 0 ? 'current' : 'pending',
                  startedAt: index === 0 ? startedAt : null,
                })),
              },
            },
          },
        },
        include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } },
      });
      workOrderId = order.id;
      assert.ok(order.processRoute);
      routeId = order.processRoute.id;
      const [firstStep, secondStep, thirdStep, targetStep] = order.processRoute.steps;
      for (const [index, step] of [firstStep, secondStep, thirdStep].entries()) {
        await completeProcessStep({
          routeId,
          stepId: step.id,
          processedQty: 10,
          defectQty: 0,
          workDate: '2026-08-11',
          employeeIds: [employee.id],
          requireParticipants: true,
          autoAssignLabor: true,
          idempotencyKey: `${prefix}-complete-${index + 1}`,
          expectedRouteVersion: index,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        });
      }
      const sourceCompletion = await prisma.processCompletion.findUniqueOrThrow({
        where: { idempotencyKey: `${prefix}-complete-3` },
      });
      const originalInbound = await prisma.processQuantityMovement.findFirstOrThrow({
        where: {
          completionId: sourceCompletion.id,
          targetStepId: targetStep.id,
          type: 'GOOD_TRANSFER',
          voidedAt: null,
        },
      });
      const team = await prisma.productionTeam.create({
        data: { code: `${prefix}-DAILY-TEAM`, name: `${prefix} daily team` },
      });
      teamId = team.id;
      const dailyPlan = await prisma.dailyProductionPlan.create({
        data: {
          workDate: startedAt,
          shiftCode: 'DAY',
          teamId: team.id,
          status: DailyProductionPlanStatus.IN_PROGRESS,
          confirmedAt: startedAt,
          confirmedById: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      dailyPlanId = dailyPlan.id;
      const completedDailyTask = await prisma.dailyProcessTask.create({
        data: {
          planId: dailyPlan.id,
          workDate: dailyPlan.workDate,
          shiftCode: dailyPlan.shiftCode,
          workOrderId,
          routeId,
          stepId: thirdStep.id,
          routeVersion: 3,
          processCode: thirdStep.processCode,
          processName: thirdStep.processName,
          stageGroup: thirdStep.stageGroup,
          position: thirdStep.position,
          sequenceGroup: thirdStep.sequenceGroup,
          standardSource: thirdStep.standardSource,
          timeBasis: 'per_unit',
          unitLabel: thirdStep.unitLabel || 'piece',
          standardMillisecondsPerUnit: thirdStep.standardMillisecondsPerUnit || 3_000,
          setupMilliseconds: thirdStep.setupMilliseconds,
          unitsPerProduct: thirdStep.unitsPerProduct,
          countsForEfficiency: thirdStep.countsForEfficiency,
          plannedQty: 10,
          availableQty: 0,
          status: DailyProcessTaskStatus.COMPLETED,
          sortOrder: 1,
        },
      });
      const completedDailyAssignment = await prisma.dailyTaskAssignment.create({
        data: {
          taskId: completedDailyTask.id,
          employeeId: employee.id,
          assignedTeamId: team.id,
          quantity: 10,
          plannedStandardMilliseconds: 30_000n,
          status: DailyTaskAssignmentStatus.COMPLETED,
          idempotencyKey: `${prefix}-daily-completed-assignment`,
          assignedById: actor.id,
        },
      });
      const targetDailyTask = await prisma.dailyProcessTask.create({
        data: {
          planId: dailyPlan.id,
          workDate: dailyPlan.workDate,
          shiftCode: dailyPlan.shiftCode,
          workOrderId,
          routeId,
          stepId: targetStep.id,
          routeVersion: 3,
          processCode: targetStep.processCode,
          processName: targetStep.processName,
          stageGroup: targetStep.stageGroup,
          position: targetStep.position,
          sequenceGroup: targetStep.sequenceGroup,
          standardSource: targetStep.standardSource,
          timeBasis: 'per_unit',
          unitLabel: targetStep.unitLabel || 'piece',
          standardMillisecondsPerUnit: targetStep.standardMillisecondsPerUnit || 4_000,
          setupMilliseconds: targetStep.setupMilliseconds,
          unitsPerProduct: targetStep.unitsPerProduct,
          countsForEfficiency: targetStep.countsForEfficiency,
          plannedQty: 10,
          availableQty: 10,
          status: DailyProcessTaskStatus.READY,
          sortOrder: 2,
        },
      });
      const targetDailyAssignment = await prisma.dailyTaskAssignment.create({
        data: {
          taskId: targetDailyTask.id,
          employeeId: employee.id,
          assignedTeamId: team.id,
          quantity: 10,
          plannedStandardMilliseconds: 40_000n,
          status: DailyTaskAssignmentStatus.PLANNED,
          idempotencyKey: `${prefix}-daily-target-assignment`,
          assignedById: actor.id,
        },
      });
      const proposal = await createProcessRouteChangeProposal({
        workOrderId,
        routeId,
        title: 'Insert omitted operation before untouched fourth operation',
        reason: 'The first three operations are complete but the fourth has not been reported',
        scope: 'CURRENT_WORK_ORDER_ONLY',
        diffs: [
          {
            kind: 'INSERT_STEP',
            processDefinitionId: definitions[4].id,
            targetStepId: targetStep.id,
            afterData: {
              insertBeforeStepId: targetStep.id,
              standardMillisecondsPerUnit: 5_000,
              requiredQty: 10,
              unitLabel: 'piece',
            },
          },
          {
            kind: 'UPDATE_TIME',
            processDefinitionId: definitions[3].id,
            targetStepId: targetStep.id,
            afterData: {
              standardMillisecondsPerUnit: 6_000,
              unitLabel: 'piece',
            },
          },
        ],
        idempotencyKey: `${prefix}-create-change`,
        expectedVersion: 3,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const proposalImpact = proposal.impact as Record<string, unknown>;
      assert.equal(proposalImpact.downstreamReportedStepCount, 0);
      assert.equal(proposalImpact.affectedCompletionCount, 0);
      assert.equal(proposalImpact.affectedClaimCount, 0);
      assert.equal(proposalImpact.affectedEmployeeCount, 0);
      assert.equal(proposalImpact.previousStandardLaborMilliseconds, 0);
      assert.equal(proposalImpact.nextStandardLaborMilliseconds, 0);
      const submitted = await submitProcessRouteChange({
        changeId: proposal.id,
        idempotencyKey: `${prefix}-submit-change`,
        expectedVersion: proposal.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const reviewed = await reviewProcessRouteChange({
        changeId: proposal.id,
        decision: 'approve',
        idempotencyKey: `${prefix}-approve-change`,
        expectedVersion: submitted.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const activated = await activateProcessRouteChange({
        changeId: proposal.id,
        expectedRouteVersion: 3,
        idempotencyKey: `${prefix}-activate-change`,
        expectedVersion: reviewed.version,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(activated.supplementObligations.length, 0);
      const afterActivation = await prisma.workOrderProcessRoute.findUniqueOrThrow({
        where: { id: routeId },
        include: { steps: { orderBy: { position: 'asc' } } },
      });
      assert.equal(afterActivation.version, 4);
      const insertedStep = afterActivation.steps.find(step => step.processDefinitionId === definitions[4].id);
      assert.ok(insertedStep);
      const resetTarget = afterActivation.steps.find(step => step.id === targetStep.id);
      assert.ok(resetTarget);
      assert.equal(insertedStep.executionMode, 'NORMAL');
      assert.equal(insertedStep.changeSource, 'NEW');
      assert.equal(insertedStep.status, 'current');
      assert.equal(insertedStep.inputQty, 10);
      assert.equal(insertedStep.processedQty, 0);
      assert.equal(resetTarget.status, 'pending');
      assert.equal(resetTarget.inputQty, 0);
      assert.equal(resetTarget.sequenceGroup, insertedStep.sequenceGroup + 1);
      assert.equal(resetTarget.standardMillisecondsPerUnit, 6_000);

      const [dailyTasksAfterActivation, dailyPlanAfterActivation] = await Promise.all([
        prisma.dailyProcessTask.findMany({
          where: { planId: dailyPlan.id },
          include: { assignments: { orderBy: { createdAt: 'asc' } } },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.dailyProductionPlan.findUniqueOrThrow({ where: { id: dailyPlan.id } }),
      ]);
      assert.equal(dailyTasksAfterActivation.length, 3);
      const synchronizedCompletedTask = dailyTasksAfterActivation.find(item => item.id === completedDailyTask.id);
      assert.ok(synchronizedCompletedTask);
      assert.equal(synchronizedCompletedTask.routeVersion, 3);
      assert.equal(synchronizedCompletedTask.standardMillisecondsPerUnit, 3_000);
      assert.equal(synchronizedCompletedTask.status, DailyProcessTaskStatus.COMPLETED);
      assert.equal(
        synchronizedCompletedTask.assignments.find(item => item.id === completedDailyAssignment.id)
          ?.plannedStandardMilliseconds,
        30_000n,
      );
      const synchronizedTargetTask = dailyTasksAfterActivation.find(item => item.id === targetDailyTask.id);
      assert.ok(synchronizedTargetTask);
      assert.equal(synchronizedTargetTask.routeVersion, 4);
      assert.equal(synchronizedTargetTask.status, DailyProcessTaskStatus.WAITING_UPSTREAM);
      assert.equal(synchronizedTargetTask.availableQty, 0);
      assert.equal(synchronizedTargetTask.standardMillisecondsPerUnit, 6_000);
      assert.equal(
        synchronizedTargetTask.assignments.find(item => item.id === targetDailyAssignment.id)
          ?.plannedStandardMilliseconds,
        60_000n,
      );
      const insertedDailyTask = dailyTasksAfterActivation.find(item => item.stepId === insertedStep.id);
      assert.ok(insertedDailyTask);
      assert.equal(insertedDailyTask.routeVersion, 4);
      assert.equal(insertedDailyTask.status, DailyProcessTaskStatus.READY);
      assert.equal(insertedDailyTask.plannedQty, 10);
      assert.equal(insertedDailyTask.availableQty, 10);
      assert.equal(insertedDailyTask.standardMillisecondsPerUnit, 5_000);
      assert.deepEqual(
        (insertedDailyTask.riskWarnings as string[]).includes('PROCESS_ROUTE_CHANGE_NEW'),
        true,
      );
      assert.equal(dailyPlanAfterActivation.version, dailyPlan.version + 1);
      assert.equal(
        await prisma.dailyPlanRevision.count({
          where: {
            planId: dailyPlan.id,
            action: { in: ['PROCESS_ROUTE_CHANGE_TASK_CREATED', 'PROCESS_ROUTE_CHANGE_TASK_SYNCHRONIZED'] },
          },
        }),
        2,
      );

      const [reversal, rewiredInbound] = await Promise.all([
        prisma.processQuantityMovement.findFirstOrThrow({
          where: { reversalOfId: originalInbound.id, type: 'REVERSAL', voidedAt: null },
        }),
        prisma.processQuantityMovement.findFirstOrThrow({
          where: {
            completionId: sourceCompletion.id,
            sourceStepId: thirdStep.id,
            targetStepId: insertedStep.id,
            type: 'GOOD_TRANSFER',
            voidedAt: null,
          },
        }),
      ]);
      assert.equal(reversal.quantity, 10);
      assert.equal(rewiredInbound.quantity, 10);
      const insertedCompletion = await completeProcessStep({
        routeId,
        stepId: insertedStep.id,
        processedQty: 10,
        defectQty: 0,
        workDate: '2026-08-11',
        employeeIds: [employee.id],
        requireParticipants: true,
        autoAssignLabor: true,
        idempotencyKey: `${prefix}-complete-inserted`,
        expectedRouteVersion: 4,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(insertedCompletion.goodTransferredQty, 10);
      const [finalSteps, outboundToTarget, storedOrder] = await Promise.all([
        prisma.workOrderProcessStep.findMany({
          where: { routeId },
          orderBy: { position: 'asc' },
        }),
        prisma.processQuantityMovement.findFirstOrThrow({
          where: {
            completionId: insertedCompletion.completionId,
            sourceStepId: insertedStep.id,
            targetStepId: targetStep.id,
            type: 'GOOD_TRANSFER',
            voidedAt: null,
          },
        }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } }),
      ]);
      const finalInserted = finalSteps.find(step => step.id === insertedStep.id);
      const finalTarget = finalSteps.find(step => step.id === targetStep.id);
      assert.equal(outboundToTarget.quantity, 10);
      assert.equal(finalInserted?.processedQty, 10);
      assert.equal(finalInserted?.goodOutputQty, 10);
      assert.equal(finalInserted?.releasedGoodQty, 10);
      assert.equal(finalInserted?.status, 'completed');
      assert.equal(finalTarget?.inputQty, 10);
      assert.equal(finalTarget?.status, 'current');
      assert.equal(storedOrder.completedQty?.toString() || '0', '0');
      const originalReversalTotal = await prisma.processQuantityMovement.aggregate({
        where: { reversalOfId: originalInbound.id, voidedAt: null },
        _sum: { quantity: true },
      });
      assert.equal(originalInbound.quantity - (originalReversalTotal._sum.quantity || 0), 0);
      const effectiveTargetInbound = await prisma.processQuantityMovement.findMany({
        where: { workOrderId, targetStepId: targetStep.id, type: 'GOOD_TRANSFER', voidedAt: null },
        include: { reversals: { where: { voidedAt: null }, select: { quantity: true } } },
      });
      assert.equal(
        effectiveTargetInbound.reduce(
          (sum, movement) => sum + movement.quantity
            - movement.reversals.reduce((reversalSum, item) => reversalSum + item.quantity, 0),
          0,
        ),
        finalTarget?.inputQty,
      );
    } finally {
      if (workOrderId) {
        if (dailyPlanId) {
          await prisma.dailyPlanRevision.deleteMany({ where: { planId: dailyPlanId } });
          await prisma.dailyTaskAssignment.deleteMany({ where: { task: { planId: dailyPlanId } } });
          await prisma.dailyProcessTask.deleteMany({ where: { planId: dailyPlanId } });
          await prisma.dailyProductionPlan.deleteMany({ where: { id: dailyPlanId } });
        }
        const pools = await prisma.processLaborPool.findMany({
          where: { workOrderId },
          select: { id: true },
        });
        const poolIds = pools.map(item => item.id);
        if (poolIds.length) await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: poolIds } } });
        await prisma.processLaborPool.deleteMany({ where: { workOrderId } });
        await prisma.processCompletionCoverage.deleteMany({
          where: {
            OR: [
              { reportCompletion: { workOrderId } },
              { triggerCompletion: { workOrderId } },
            ],
          },
        });
        await prisma.processQuantityMovement.deleteMany({ where: { workOrderId } });
        await prisma.processCompletionParticipant.deleteMany({ where: { completion: { workOrderId } } });
        await prisma.processCompletion.deleteMany({ where: { workOrderId } });
        await prisma.processRouteActivity.deleteMany({ where: { routeId } });
        const changes = await prisma.processRouteChange.findMany({
          where: { workOrderId },
          select: { id: true, changeRequestId: true },
        });
        const changeIds = changes.map(item => item.id);
        if (changeIds.length) {
          await prisma.processSupplementObligation.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeDiff.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeOutbox.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChangeEvent.deleteMany({ where: { changeId: { in: changeIds } } });
          await prisma.processRouteChange.deleteMany({ where: { id: { in: changeIds } } });
          await prisma.changeRequest.deleteMany({ where: { id: { in: changes.map(item => item.changeRequestId) } } });
        }
        await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
      }
      if (teamId) await prisma.productionTeam.deleteMany({ where: { id: teamId } });
      await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(item => item.id) } } });
      await prisma.employee.deleteMany({ where: { id: employee.id } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  },
);
