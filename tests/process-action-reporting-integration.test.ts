import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { completeProcessStep, loadProcessCompletionContext } from '../lib/process-completion-service';
import {
  previewProcessCompletionWithdrawal,
  withdrawProcessCompletion,
} from '../lib/process-completion-withdrawal-service';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'action reporting pays by terminal count while product flow remains in sets',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `IT-ACTION-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-USER`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} operator`,
        laborRole: 'ADMIN',
      },
    });
    const employees = await Promise.all([0, 1, 2].map(index => prisma.employee.create({
      data: {
        employeeNo: `${prefix}-EMP-${index + 1}`,
        name: `${prefix} operator ${index + 1}`,
        department: '生产部',
      },
    })));
    const employee = employees[0];
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'terminal crimp product',
        stage: 'frontend',
        status: 'processing',
        processName: '压接',
        uncompletedQty: '50',
        productionTargetQty: 50,
        completedQty: '0',
        frontendTransferredQty: 0,
        planType: 'managed_plan',
        planActive: true,
        startedAt: new Date(),
        processRoute: {
          create: {
            templateName: `${prefix} route`,
            templateVersion: 1,
            status: 'in_progress',
            version: 0,
            confirmedAt: new Date(),
            confirmedById: actor.id,
            startedAt: new Date(),
            routeSource: 'product_time_profile',
            steps: {
              create: {
                processCode: `${prefix}-CRIMP`,
                processName: '压接',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                standardSource: 'integration_test',
                timeBasis: 'per_unit',
                unitLabel: '套',
                standardMillisecondsPerUnit: 9_000,
                setupMilliseconds: 0,
                unitsPerProduct: 96,
                reportQuantityBasis: 'action',
                reportUnitLabel: '个',
                countsForEfficiency: true,
                inputQty: 50,
                status: 'current',
                startedAt: new Date(),
              },
            },
          },
        },
      },
      include: { processRoute: { include: { steps: true } } },
    });
    assert.ok(order.processRoute);
    const step = order.processRoute.steps[0];

    try {
      await assert.rejects(
        completeProcessStep({
          routeId: order.processRoute.id,
          stepId: step.id,
          processedQty: 1,
          defectQty: 0,
          reportedUnitQty: 95,
          reportedDefectUnitQty: 0,
          workDate: '2026-08-13',
          employeeIds: [employee.id],
          requireParticipants: true,
          allowAdvanceReporting: true,
          autoAssignLabor: true,
          reportSource: 'QR_MOBILE',
          principalEmployeeId: employee.id,
          idempotencyKey: `${prefix}-invalid`,
          expectedRouteVersion: 0,
          userId: actor.id,
          actor: actor.displayName || actor.username,
        }),
        (error: unknown) => (
          error instanceof Error
          && 'code' in error
          && error.code === 'PROCESS_PRODUCT_FLOW_EXCEEDS_ACTION_OUTPUT'
        ),
      );

      const first = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: step.id,
        processedQty: 0,
        defectQty: 0,
        reportedUnitQty: 100,
        reportedDefectUnitQty: 4,
        workDate: '2026-08-13',
        employeeIds: employees.map(item => item.id),
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: employee.id,
        idempotencyKey: `${prefix}-first`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const converted = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: step.id,
        processedQty: 1,
        defectQty: 0,
        reportedUnitQty: 0,
        reportedDefectUnitQty: 0,
        workDate: '2026-08-13',
        employeeIds: [employee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: employee.id,
        idempotencyKey: `${prefix}-converted`,
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      const partial = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: step.id,
        processedQty: 0,
        defectQty: 0,
        reportedUnitQty: 48,
        reportedDefectUnitQty: 0,
        workDate: '2026-08-13',
        employeeIds: [employee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: employee.id,
        idempotencyKey: `${prefix}-partial`,
        expectedRouteVersion: 2,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });

      const [firstCompletion, convertedCompletion, partialCompletion, storedStep, context] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({
          where: { id: first.completionId },
          include: { laborPool: { include: { claims: { where: { status: 'ACTIVE' } } } } },
        }),
        prisma.processCompletion.findUniqueOrThrow({
          where: { id: converted.completionId },
          include: { laborPool: true },
        }),
        prisma.processCompletion.findUniqueOrThrow({
          where: { id: partial.completionId },
          include: { laborPool: true },
        }),
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: step.id } }),
        loadProcessCompletionContext(order.processRoute.id, step.id, {
          allowAdvanceReporting: true,
          allowCompletedSelection: true,
        }),
      ]);

      assert.equal(firstCompletion.reportedUnitQty, 100);
      assert.equal(firstCompletion.reportedDefectUnitQty, 4);
      assert.equal(firstCompletion.laborPool?.eligibleQty, 100);
      assert.equal(firstCompletion.laborPool?.unitsPerProduct, 1);
      assert.equal(firstCompletion.laborPool?.totalStandardLaborMilliseconds, 900_000n);
      assert.deepEqual(
        firstCompletion.laborPool?.claims.map(claim => claim.standardLaborMilliseconds),
        [300_000n, 300_000n, 300_000n],
      );
      assert.equal(
        firstCompletion.laborPool?.claims.reduce((sum, claim) => sum + claim.quantity, 0),
        100,
      );
      assert.equal(convertedCompletion.processedQty, 1);
      assert.equal(convertedCompletion.reportedUnitQty, 0);
      assert.equal(convertedCompletion.laborPool, null);
      assert.equal(partialCompletion.processedQty, 0);
      assert.equal(partialCompletion.coverageStatus, 'COVERED');
      assert.equal(partialCompletion.laborPool?.eligibleQty, 48);
      assert.equal(partialCompletion.laborPool?.totalStandardLaborMilliseconds, 432_000n);
      assert.equal(storedStep.processedQty, 1);
      assert.equal(context.step.reportQuantityBasis, 'action');
      assert.equal(context.reportedUnitQty, 148);
      assert.equal(context.reportedGoodUnitQty, 144);
      assert.equal(context.reportedDefectUnitQty, 4);
      assert.equal(context.reportTargetQty, 4_800);
      assert.equal(context.reportableUnitQty, 4_656);
      assert.equal(context.reportedQty, 1);
      assert.equal(context.reportableQty, 49);

      const sourceWithdrawalPreview = await previewProcessCompletionWithdrawal(
        order.processRoute.id,
        first.completionId,
      );
      assert.equal(sourceWithdrawalPreview.canWithdraw, false);
      assert.ok(sourceWithdrawalPreview.blockers.some(
        blocker => blocker.code === 'PROCESS_ACTION_WITHDRAWAL_DEPENDENCY_EXISTS',
      ));

      const withdrawalPreview = await previewProcessCompletionWithdrawal(
        order.processRoute.id,
        partial.completionId,
      );
      assert.equal(withdrawalPreview.canWithdraw, true);
      assert.equal(withdrawalPreview.impact.processedQty, 0);
      assert.equal(withdrawalPreview.impact.reportQuantityBasis, 'action');
      assert.equal(withdrawalPreview.impact.reportedUnitQty, 48);
      assert.equal(withdrawalPreview.impact.reportUnitLabel, '个');
      assert.equal(withdrawalPreview.impact.laborClaimedQty, 48);

      const withdrawal = await withdrawProcessCompletion({
        routeId: order.processRoute.id,
        completionId: partial.completionId,
        expectedRouteVersion: 3,
        category: 'REPORTING_ERROR',
        reason: 'integration-test action-only correction',
        idempotencyKey: `${prefix}-partial-withdrawal`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(withdrawal.status, 'WITHDRAWN');

      const [withdrawnCompletion, withdrawnPool, remainingContext] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({ where: { id: partial.completionId } }),
        prisma.processLaborPool.findUniqueOrThrow({
          where: { completionId: partial.completionId },
          include: { claims: { orderBy: { createdAt: 'asc' } } },
        }),
        loadProcessCompletionContext(order.processRoute.id, step.id, {
          allowAdvanceReporting: true,
          allowCompletedSelection: true,
        }),
      ]);
      assert.ok(withdrawnCompletion.voidedAt);
      assert.equal(withdrawnPool.status, 'VOIDED');
      assert.equal(withdrawnPool.claimedQty, 0);
      assert.equal(withdrawnPool.claims.length, 2);
      assert.equal(withdrawnPool.claims[0].status, 'VOIDED');
      assert.equal(withdrawnPool.claims[1].status, 'REVERSAL');
      assert.equal(remainingContext.reportedUnitQty, 100);
      assert.equal(remainingContext.reportedQty, 1);

      const convertedWithdrawal = await withdrawProcessCompletion({
        routeId: order.processRoute.id,
        completionId: converted.completionId,
        expectedRouteVersion: withdrawal.routeVersion,
        category: 'REPORTING_ERROR',
        reason: '',
        idempotencyKey: `${prefix}-converted-withdrawal`,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      assert.equal(convertedWithdrawal.status, 'WITHDRAWN');
      const sourceAfterConsumer = await previewProcessCompletionWithdrawal(
        order.processRoute.id,
        first.completionId,
      );
      assert.equal(sourceAfterConsumer.canWithdraw, true);
    } finally {
      await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: order.id } } });
      await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionCoverage.deleteMany({ where: { reportCompletion: { workOrderId: order.id } } });
      await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processActionConsumption.deleteMany({ where: { step: { route: { workOrderId: order.id } } } });
      await prisma.processCompletion.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.employee.deleteMany({ where: { id: { in: employees.map(item => item.id) } } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
