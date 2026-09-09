import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { completeProcessStep, reconcileProportionalBatchLaborInTransaction } from '../lib/process-completion-service';
import { withdrawProcessCompletion } from '../lib/process-completion-withdrawal-service';

test('batch labor preserves each day and worker through early reporting, replay, withdrawal and historical pool recovery',
  { skip: process.env.RUN_DB_INTEGRATION !== '1', timeout: 120000 }, async () => {
    const prefix = `ITBP-${randomUUID().slice(0, 8)}`;
    const actor = await prisma.user.create({ data: { username: prefix, displayName: prefix, passwordHash: 'integration-only', laborRole: 'ADMIN' } });
    const employees = await Promise.all(['A', 'B', 'C'].map(suffix => prisma.employee.create({ data: {
      employeeNo: `${prefix}-${suffix}`, name: `${prefix}-${suffix}`, department: '生产部', team: prefix,
    } })));
    const order = await prisma.workOrder.create({ data: { code: prefix, customerName: prefix, productName: prefix,
      stage: 'frontend', status: 'processing', uncompletedQty: '3', productionTargetQty: 3, completedQty: '0',
      planType: 'managed_plan', planActive: true, startedAt: new Date(), processRoute: { create: {
        templateName: prefix, templateVersion: 1, status: 'in_progress', reportingPolicy: 'free_sequence',
        routeSource: 'process_template', confirmedAt: new Date(), confirmedById: actor.id, startedAt: new Date(),
        steps: { create: [
          { processCode: `${prefix}-UP`, processName: '裁线', stageGroup: 'frontend', position: 1, sequenceGroup: 1,
            standardSource: 'integration_test', timeBasis: 'per_unit', standardMillisecondsPerUnit: 1000, unitLabel: '件',
            unitsPerProduct: 1, inputQty: 3, status: 'current', startedAt: new Date() },
          { processCode: `${prefix}-BATCH`, processName: '整批装配', stageGroup: 'backend', position: 2, sequenceGroup: 2,
            standardSource: 'integration_test', timeBasis: 'per_batch', standardMillisecondsPerUnit: 3_600_001,
            setupMilliseconds: 600_000, unitLabel: '件', unitsPerProduct: 1, inputQty: 0, status: 'pending' },
        ] },
      } } }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
    const route = order.processRoute!; const [upstream, batch] = route.steps;
    const completionIds: string[] = [];
    const base = { routeId: route.id, defectQty: 0, requireParticipants: true, autoAssignLabor: true,
      reportSource: 'QR_MOBILE' as const, userId: actor.id, actor: prefix };
    const report = async (stepId: string, qty: number, people: number[], date: string, key: string) => {
      const version = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
      const command = { ...base, stepId, processedQty: qty, employeeIds: people.map(index => employees[index].id),
        principalEmployeeId: employees[people[0]].id, workDate: date, idempotencyKey: `${prefix}-${key}`, expectedRouteVersion: version };
      const result = await completeProcessStep(command); completionIds.push(result.completionId);
      return { command, result };
    };
    try {
      const first = await report(batch.id, 1, [0, 1], '2026-09-07', 'first');
      assert.equal(first.result.pendingCoverageQty, 1);
      assert.equal(first.result.autoAssignedLaborMilliseconds, 1_400_000);
      const second = await report(batch.id, 2, [2], '2026-09-08', 'second');
      assert.equal(second.result.autoAssignedLaborMilliseconds, 2_800_001);
      const claims = await prisma.processLaborClaim.findMany({ where: { pool: { stepId: batch.id }, status: 'ACTIVE' }, orderBy: { workDate: 'asc' } });
      assert.equal(claims.length, 3);
      assert.deepEqual(claims.filter(claim => claim.workDate.toISOString().startsWith('2026-09-07')).map(claim => claim.standardLaborMilliseconds), [700000n, 700000n]);
      assert.equal(claims.find(claim => claim.employeeId === employees[2].id)?.standardLaborMilliseconds, 2800001n);
      assert.equal((await completeProcessStep(first.command)).completionId, first.result.completionId);
      assert.equal(await prisma.processLaborPool.count({ where: { stepId: batch.id } }), 2);
      const covered = await report(upstream.id, 3, [0], '2026-09-09', 'upstream');
      assert.equal(covered.result.routeCompleted, true);
      const conserved = await prisma.processLaborClaim.aggregate({ where: { pool: { stepId: batch.id }, status: 'ACTIVE' }, _sum: { standardLaborMilliseconds: true } });
      assert.equal(conserved._sum.standardLaborMilliseconds, 4200001n);
      const version = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
      await withdrawProcessCompletion({ routeId: route.id, completionId: covered.result.completionId,
        category: 'REPORTING_ERROR',
        expectedRouteVersion: version, reason: '隔离测试前序误报撤回', idempotencyKey: `${prefix}-withdraw-up`, userId: actor.id, actor: prefix });
      assert.equal(await prisma.processLaborClaim.count({ where: { pool: { stepId: batch.id }, status: 'ACTIVE' } }), 3);
      assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: second.result.completionId } })).coverageStatus, 'PENDING');
      const nextVersion = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
      await withdrawProcessCompletion({ routeId: route.id, completionId: first.result.completionId,
        category: 'REPORTING_ERROR',
        expectedRouteVersion: nextVersion, reason: '隔离测试本笔误报撤回', idempotencyKey: `${prefix}-withdraw-first`, userId: actor.id, actor: prefix });
      const replacement = await report(batch.id, 1, [1], '2026-09-09', 'replacement');
      assert.equal(replacement.result.autoAssignedLaborMilliseconds, 1400000);
      assert.equal((await prisma.processLaborClaim.aggregate({ where: { pool: { stepId: batch.id }, status: 'ACTIVE' }, _sum: { standardLaborMilliseconds: true } }))._sum.standardLaborMilliseconds, 4200001n);

      // Model an isolated pre-upgrade batch with valid reports but no settled
      // pools. Preview must not mutate it, and execution keeps original dates.
      await prisma.processLaborClaim.deleteMany({ where: { pool: { stepId: batch.id } } });
      await prisma.processLaborPool.deleteMany({ where: { stepId: batch.id } });
      const preview = await prisma.$transaction(tx => reconcileProportionalBatchLaborInTransaction(tx, route.id, { execute: false, userId: actor.id }));
      assert.equal(preview.rows.length, 2);
      assert.equal(await prisma.processLaborPool.count({ where: { stepId: batch.id } }), 0);
      const repaired = await prisma.$transaction(tx => reconcileProportionalBatchLaborInTransaction(tx, route.id, { execute: true, userId: actor.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      assert.deepEqual(repaired.rows.map(row => row.workDate), ['2026-09-08', '2026-09-09']);
      assert.equal(repaired.rows.reduce((sum, row) => sum + BigInt(row.milliseconds), 0n), 4200001n);
      const repeated = await prisma.$transaction(tx => reconcileProportionalBatchLaborInTransaction(tx, route.id, { execute: true, userId: actor.id }));
      assert.equal(repeated.rows.length, 0);
      // A legacy settled pool is never combined with new proportional credits.
      await prisma.processLaborPool.updateMany({ where: { stepId: batch.id }, data: { allocationPolicy: 'legacy', batchTargetQty: null, batchTotalStandardLaborMilliseconds: null } });
      const preserved = await prisma.$transaction(tx => reconcileProportionalBatchLaborInTransaction(tx, route.id, { execute: true, userId: actor.id }));
      assert.equal(preserved.rows.length, 0); assert.equal(preserved.blocked.length, 1);
      for (const completionId of [second.result.completionId, replacement.result.completionId]) {
        const version = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
        await withdrawProcessCompletion({ routeId: route.id, completionId, expectedRouteVersion: version,
          category: 'REPORTING_ERROR', reason: '隔离测试旧工时池撤回后重新报工', idempotencyKey: `${prefix}-legacy-withdraw-${completionId}`,
          userId: actor.id, actor: prefix });
      }
      const afterLegacyWithdrawal = await report(batch.id, 3, [0], '2026-09-09', 'legacy-replacement');
      assert.equal(afterLegacyWithdrawal.result.autoAssignedLaborMilliseconds, 4200001);
      assert.equal((await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: afterLegacyWithdrawal.result.completionId } })).allocationPolicy, 'batch_proportional_v1');
      const finalVersion = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } })).version;
      await withdrawProcessCompletion({ routeId: route.id, completionId: afterLegacyWithdrawal.result.completionId,
        expectedRouteVersion: finalVersion, category: 'REPORTING_ERROR', reason: '隔离测试全部撤回后采用新标准',
        idempotencyKey: `${prefix}-withdraw-all-proportional`, userId: actor.id, actor: prefix });
      await prisma.workOrderProcessStep.update({ where: { id: batch.id }, data: { standardMillisecondsPerUnit: 5_400_000 } });
      const repriced = await report(batch.id, 3, [0], '2026-09-09', 'new-standard-after-all-voided');
      assert.equal(repriced.result.autoAssignedLaborMilliseconds, 6000000, 'voided-only budgets cannot override a new valid standard');
    } finally {
      await prisma.operationLog.deleteMany({ where: { OR: [{ userId: actor.id }, { targetId: { in: completionIds } }] } });
      await prisma.processRouteActivity.deleteMany({ where: { routeId: route.id } });
      await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: order.id } } });
      await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionCoverage.deleteMany({ where: { OR: [{ reportCompletionId: { in: completionIds } }, { triggerCompletionId: { in: completionIds } }] } });
      await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: order.id } });
      await prisma.processCompletionParticipant.deleteMany({ where: { completionId: { in: completionIds } } });
      await prisma.processCompletion.deleteMany({ where: { routeId: route.id } });
      await prisma.workOrderProgressLog.deleteMany({ where: { workOrderId: order.id } });
      await prisma.workOrderProcessStep.deleteMany({ where: { routeId: route.id } });
      await prisma.workOrderProcessRoute.delete({ where: { id: route.id } });
      await prisma.workOrder.delete({ where: { id: order.id } });
      await prisma.employee.deleteMany({ where: { id: { in: employees.map(employee => employee.id) } } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  });
