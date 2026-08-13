import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import {
  previewProcessCompletionWithdrawal,
  withdrawProcessCompletion,
} from '../lib/process-completion-withdrawal-service';
import { resolveProcessLaborPoolStandard } from '../lib/process-labor-service';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test(
  'out-of-order reporting auto-records labor and reconciles when upstream catches up',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITAR-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({
      data: {
        username: `${prefix}-ADMIN`,
        passwordHash: 'integration-test-not-a-login-hash',
        displayName: `${prefix} administrator`,
        laborRole: 'ADMIN',
      },
      select: { id: true, username: true, displayName: true },
    });
    const downstreamEmployee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-DOWN`,
        name: `${prefix} downstream operator`,
        department: '生产部',
        team: `${prefix}-TEAM`,
      },
    });
    const upstreamEmployee = await prisma.employee.create({
      data: {
        employeeNo: `${prefix}-UP`,
        name: `${prefix} upstream operator`,
        department: '生产部',
        team: `${prefix}-TEAM`,
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'advance reporting product',
        stage: 'frontend',
        status: 'processing',
        processName: 'cut',
        uncompletedQty: '100',
        productionTargetQty: 100,
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
                  unitLabel: '套',
                  standardMillisecondsPerUnit: 6_000,
                  setupMilliseconds: 0,
                  unitsPerProduct: 1,
                  countsForEfficiency: true,
                  inputQty: 100,
                  status: 'current',
                  startedAt: new Date(),
                },
                {
                  processCode: `${prefix}-PACK`,
                  processName: 'pack',
                  stageGroup: 'backend',
                  position: 2,
                  sequenceGroup: 2,
                  standardSource: 'integration_test',
                  timeBasis: 'per_unit',
                  unitLabel: '套',
                  standardMillisecondsPerUnit: 3_000,
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
    assert.ok(order.processRoute);
    const [cut, pack] = order.processRoute.steps;
    const completionIds: string[] = [];

    try {
      const advance = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: pack.id,
        processedQty: 100,
        defectQty: 0,
        workDate: '2026-08-03',
        employeeIds: [downstreamEmployee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: downstreamEmployee.id,
        idempotencyKey: `${prefix}-advance-pack`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      completionIds.push(advance.completionId);
      assert.equal(advance.coverageStatus, 'pending');
      assert.equal(advance.pendingCoverageQty, 100);
      assert.equal(advance.autoAssignedEmployeeCount, 1);
      assert.equal(advance.autoAssignedLaborMilliseconds, 300_000);

      const pendingPack = await prisma.processCompletion.findUniqueOrThrow({
        where: { id: advance.completionId },
        include: { laborPool: { include: { claims: true } } },
      });
      assert.equal(pendingPack.reportMode, 'ADVANCE');
      assert.equal(pendingPack.coveredQty, 0);
      assert.equal(pendingPack.laborPool?.status, 'EXHAUSTED');
      assert.equal(pendingPack.laborPool?.claims[0]?.source, 'completion_auto');
      assert.equal(pendingPack.laborPool?.claims[0]?.quantity, 100);

      const upstream = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: cut.id,
        processedQty: 100,
        defectQty: 0,
        workDate: '2026-08-03',
        employeeIds: [upstreamEmployee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: upstreamEmployee.id,
        idempotencyKey: `${prefix}-upstream-cut`,
        expectedRouteVersion: 1,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      completionIds.push(upstream.completionId);
      assert.equal(upstream.routeCompleted, true);

      const [reconciledPack, route, packStep, coverageRows] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({ where: { id: advance.completionId } }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.processRoute.id } }),
        prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: pack.id } }),
        prisma.processCompletionCoverage.findMany({
          where: { reportCompletionId: advance.completionId, voidedAt: null },
        }),
      ]);
      assert.equal(reconciledPack.coverageStatus, 'COVERED');
      assert.equal(reconciledPack.coveredQty, 100);
      assert.equal(packStep.inputQty, 100);
      assert.equal(packStep.processedQty, 100);
      assert.equal(route.status, 'completed');
      assert.equal(coverageRows.reduce((sum, row) => sum + row.quantity, 0), 100);
      assert.ok(coverageRows.every(row => row.quantity > 0));

      const preview = await previewProcessCompletionWithdrawal(
        order.processRoute.id,
        upstream.completionId,
      );
      assert.equal(preview.canWithdraw, true);
      assert.equal(preview.impact.downstreamPendingCompletionCount, 1);
      assert.equal(preview.impact.downstreamPendingQty, 100);

      const withdrawn = await withdrawProcessCompletion({
        routeId: order.processRoute.id,
        completionId: upstream.completionId,
        expectedRouteVersion: preview.routeVersion,
        category: 'REPORTING_ERROR',
        reason: '上道员工误报，保留下道员工已经完成的记录',
        idempotencyKey: `${prefix}-withdraw-upstream`,
        userId: actor.id,
        actor: `${upstreamEmployee.employeeNo} · ${upstreamEmployee.name}`,
      });
      assert.equal(withdrawn.status, 'WITHDRAWN');

      const [withdrawnUpstream, preservedDownstream, downstreamPool, upstreamPool, reopenedRoute, reopenedOrder, reopenedSteps, activeCoverageRows] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({ where: { id: upstream.completionId } }),
        prisma.processCompletion.findUniqueOrThrow({ where: { id: advance.completionId } }),
        prisma.processLaborPool.findFirstOrThrow({
          where: { completionId: advance.completionId },
          include: { claims: true },
        }),
        prisma.processLaborPool.findFirstOrThrow({
          where: { completionId: upstream.completionId },
          include: { claims: true },
        }),
        prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.processRoute.id } }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } }),
        prisma.workOrderProcessStep.findMany({
          where: { routeId: order.processRoute.id },
          orderBy: { position: 'asc' },
        }),
        prisma.processCompletionCoverage.findMany({
          where: {
            reportCompletionId: advance.completionId,
            voidedAt: null,
          },
        }),
      ]);
      assert.ok(withdrawnUpstream.voidedAt);
      assert.equal(preservedDownstream.voidedAt, null);
      assert.equal(preservedDownstream.coverageStatus, 'PENDING');
      assert.equal(preservedDownstream.coveredQty, 0);
      assert.equal(downstreamPool.status, 'EXHAUSTED');
      assert.equal(downstreamPool.claims.filter(claim => claim.status === 'ACTIVE').length, 1);
      assert.equal(downstreamPool.claims.find(claim => claim.status === 'ACTIVE')?.employeeId, downstreamEmployee.id);
      assert.equal(upstreamPool.status, 'VOIDED');
      assert.equal(upstreamPool.claims.filter(claim => claim.status === 'ACTIVE').length, 0);
      assert.equal(reopenedRoute.status, 'in_progress');
      assert.equal(reopenedOrder.stage, 'frontend');
      assert.equal(reopenedOrder.completedQty, '0');
      assert.equal(reopenedSteps[0].processedQty, 0);
      assert.equal(reopenedSteps[0].status, 'current');
      assert.equal(reopenedSteps[1].inputQty, 0);
      assert.equal(reopenedSteps[1].processedQty, 0);
      assert.equal(reopenedSteps[1].status, 'pending');
      assert.equal(activeCoverageRows.length, 0);

      const correctedUpstream = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: cut.id,
        processedQty: 100,
        defectQty: 0,
        workDate: '2026-08-03',
        employeeIds: [upstreamEmployee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        reportSource: 'QR_MOBILE',
        principalEmployeeId: upstreamEmployee.id,
        idempotencyKey: `${prefix}-upstream-cut-corrected`,
        expectedRouteVersion: withdrawn.routeVersion,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      completionIds.push(correctedUpstream.completionId);
      assert.equal(correctedUpstream.routeCompleted, true);
      const [coveredAgain, downstreamPools, completedAgain] = await Promise.all([
        prisma.processCompletion.findUniqueOrThrow({ where: { id: advance.completionId } }),
        prisma.processLaborPool.findMany({
          where: { completionId: advance.completionId },
          include: { claims: true },
        }),
        prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } }),
      ]);
      assert.equal(coveredAgain.coverageStatus, 'COVERED');
      assert.equal(coveredAgain.coveredQty, 100);
      assert.equal(downstreamPools.length, 1);
      assert.equal(downstreamPools[0].claims.filter(claim => claim.status === 'ACTIVE').length, 1);
      assert.equal(completedAgain.completedQty, '100');
    } finally {
      await prisma.operationLog.deleteMany({ where: { targetId: { in: completionIds } } });
      await prisma.processRouteActivity.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: order.id } } });
      await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionCoverage.deleteMany({
        where: {
          OR: [
            { reportCompletionId: { in: completionIds } },
            { triggerCompletionId: { in: completionIds } },
          ],
        },
      });
      await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionParticipant.deleteMany({
        where: { completionId: { in: completionIds } },
      });
      await prisma.processCompletion.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.employee.deleteMany({
        where: { id: { in: [downstreamEmployee.id, upstreamEmployee.id] } },
      });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);

test(
  'a pending-standard completion auto-records labor immediately after the standard is repaired',
  { skip: runDatabaseIntegration ? false : 'set RUN_DB_INTEGRATION=1 to use the configured database' },
  async () => {
    const prefix = `ITAS-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
        department: '生产部',
        team: `${prefix}-TEAM`,
      },
    });
    const order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-ORDER`,
        customerName: 'integration-test',
        productName: 'pending standard product',
        stage: 'frontend',
        status: 'processing',
        processName: 'inspect',
        uncompletedQty: '20',
        productionTargetQty: 20,
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
            routeSource: 'process_template',
            steps: {
              create: {
                processCode: `${prefix}-INSPECT`,
                processName: 'inspect',
                stageGroup: 'frontend',
                position: 1,
                sequenceGroup: 1,
                standardSource: 'pending_standard',
                unitLabel: 'piece',
                inputQty: 20,
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
    const [step] = order.processRoute.steps;
    let completionId = '';
    let poolId = '';

    try {
      const completion = await completeProcessStep({
        routeId: order.processRoute.id,
        stepId: step.id,
        processedQty: 20,
        defectQty: 0,
        workDate: '2026-08-03',
        employeeIds: [employee.id],
        requireParticipants: true,
        allowAdvanceReporting: true,
        autoAssignLabor: true,
        idempotencyKey: `${prefix}-completion`,
        expectedRouteVersion: 0,
        userId: actor.id,
        actor: actor.displayName || actor.username,
      });
      completionId = completion.completionId;
      poolId = completion.laborPoolId || '';
      assert.ok(poolId);
      assert.equal(completion.laborPoolPendingStandard, true);
      assert.equal(completion.autoAssignedEmployeeCount, 0);

      const lockedPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { id: poolId } });
      assert.equal(lockedPool.status, 'LOCKED');
      assert.equal(lockedPool.standardSource, 'pending_standard');

      await resolveProcessLaborPoolStandard({
        poolId,
        expectedVersion: lockedPool.version,
        timeBasis: 'per_unit',
        standardMillisecondsPerUnit: 6_000,
        setupMilliseconds: 0,
        unitsPerProduct: 1,
        countsForEfficiency: true,
        reason: 'integration standard repair',
        userId: actor.id,
      });

      const resolvedPool = await prisma.processLaborPool.findUniqueOrThrow({
        where: { id: poolId },
        include: { claims: true },
      });
      assert.equal(resolvedPool.status, 'EXHAUSTED');
      assert.equal(resolvedPool.claimedQty, 20);
      assert.equal(resolvedPool.remainingQty, 0);
      assert.equal(resolvedPool.claimedStandardLaborMilliseconds, 120_000n);
      assert.equal(resolvedPool.claims.length, 1);
      assert.equal(resolvedPool.claims[0].employeeId, employee.id);
      assert.equal(resolvedPool.claims[0].source, 'completion_auto');
    } finally {
      if (poolId) {
        await prisma.processLaborClaim.deleteMany({ where: { poolId } });
        await prisma.processLaborPool.deleteMany({ where: { id: poolId } });
      }
      await prisma.operationLog.deleteMany({
        where: {
          OR: [
            ...(completionId ? [{ targetId: completionId }] : []),
            ...(poolId ? [{ targetId: poolId }] : []),
          ],
        },
      });
      await prisma.processRouteActivity.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.processCompletionCoverage.deleteMany({
        where: {
          OR: [
            { reportCompletionId: completionId || '__none__' },
            { triggerCompletionId: completionId || '__none__' },
          ],
        },
      });
      await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionParticipant.deleteMany({
        where: { completionId: completionId || '__none__' },
      });
      await prisma.processCompletion.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: order.processRoute.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: order.processRoute.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.employee.delete({ where: { id: employee.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  },
);
