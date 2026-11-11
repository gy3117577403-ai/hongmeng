import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { previewQualityCorrection, correctQualityQuantity } from '../lib/process-quality-correction-service';
import { qualityFixture } from './helpers/quality-correction-fixture';
import { auditProductionClosure } from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';
import { completeProcessStep } from '../lib/process-completion-service';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const ledger = (orderId: string) => prisma.processLaborPool.findMany({ where: { workOrderId: orderId }, orderBy: { id: 'asc' }, include: { claims: { orderBy: { id: 'asc' } } } });

test('quality correction preserves labor, voids empty rework, reconciles downstream and is idempotent', { skip: !enabled }, async t => {
  for (const scenario of [{}, { partialDownstream: true }, { priorActions: true }, { partialDefect: true }]) {
    await t.test(JSON.stringify(scenario), async () => {
      const f = await qualityFixture(scenario);
      const beforeLabor = stable(await ledger(f.order.id));
      const beforeCompletions = await prisma.processCompletion.count({ where: { workOrderId: f.order.id } });
      const beforeActivities = await prisma.processRouteActivity.count({ where: { routeId: f.route.id } });
      const preview = await previewQualityCorrection(f.route.id, f.completion.completionId);
      assert.deepEqual(preview.blockers, []);
      assert.equal(preview.after.goodQty, 40);
      assert.equal(await prisma.processRouteActivity.count({ where: { routeId: f.route.id } }), beforeActivities, 'preview is read-only');
      assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } })).defectQty, scenario.partialDefect ? 20 : 40);
      const command = { routeId: f.route.id, completionId: f.completion.completionId, previewToken: preview.previewToken,
        idempotencyKey: randomUUID(), reason: '现场确认只填错不良分类', confirmActualWork: true, userId: f.user.id, actor: f.user.username };
      const result = await correctQualityQuantity(command);
      assert.deepEqual(await correctQualityQuantity(command), result, 'replay returns original result');
      await assert.rejects(correctQualityQuantity({ ...command, reason: '不同原因不能重用请求编号' }), /请求标识/);
      assert.equal(stable(await ledger(f.order.id)), beforeLabor, 'every pool and claim is unchanged');
      assert.equal(await prisma.processCompletion.count({ where: { workOrderId: f.order.id } }), beforeCompletions, 'no duplicate completion');
      const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.order.id } });
      assert.equal(order.completedQty, scenario.partialDownstream ? '14' : '40');
      assert.equal(order.status === 'done', !scenario.partialDownstream);
      const branch = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.completion.branchWorkOrderId! } });
      assert.equal(branch.branchStatus, 'CANCELLED'); assert.equal(branch.planActive, false); assert.equal(branch.deletedAt, null);
      const record = await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } });
      assert.equal(record.goodQty, 40); assert.equal(record.defectQty, 0); assert.equal(record.coveredGoodQty, 40);
      assert.equal(await prisma.processQuantityMovement.count({ where: { completionId: record.id, type: 'REWORK_SPLIT', voidedAt: null } }), 0);
      assert.equal(await prisma.operationLog.count({ where: { targetId: record.id, action: 'correct_quality_quantity' } }), 1);
      const audit = auditProductionClosure(await loadProductionClosureAuditSnapshot(prisma));
      assert.deepEqual(audit.findings.filter(x => x.workOrderCode?.startsWith(f.order.code)), []);
      const branchRoute = await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { workOrderId: branch.id }, include: { steps: true } });
      await assert.rejects(completeProcessStep({ routeId: branchRoute.id, stepId: branchRoute.steps[0].id, processedQty: 1, defectQty: 0,
        workDate: '2026-11-11', idempotencyKey: randomUUID(), expectedRouteVersion: branchRoute.version, userId: f.user.id, actor: f.user.username }), /尚未进入生产|不可|不能/);
    });
  }
  await t.test('stale preview, dependencies and false confirmation do not change formal rows', async () => {
    const f = await qualityFixture();
    const preview = await previewQualityCorrection(f.route.id, f.completion.completionId);
    const command = { routeId: f.route.id, completionId: f.completion.completionId, previewToken: preview.previewToken,
      idempotencyKey: randomUUID(), reason: '只读测试错误分类更正', confirmActualWork: true, userId: f.user.id, actor: f.user.username };
    await assert.rejects(correctQualityQuantity({ ...command, confirmActualWork: false }), /真实劳动/);
    await prisma.workOrderProcessRoute.update({ where: { id: f.route.id }, data: { version: { increment: 1 } } });
    await assert.rejects(correctQualityQuantity(command), /重新预览/);
    await prisma.warehouseMaterialTask.create({ data: { workOrderId: f.completion.branchWorkOrderId! } });
    const blocked = await previewQualityCorrection(f.route.id, f.completion.completionId);
    assert.equal(blocked.canExecute, false); assert.ok(blocked.blockers.some(b => b.includes('已经发生')));
    await assert.rejects(correctQualityQuantity({ ...command, previewToken: blocked.previewToken }), /已经发生/);
    assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } })).defectQty, 40);
  });
  await t.test('no downstream reporting reopens the material route without fabricating completion', async () => {
    const f = await qualityFixture({ noDownstream: true });
    const p = await previewQualityCorrection(f.route.id, f.completion.completionId);
    assert.deepEqual(p.blockers, []);
    await correctQualityQuantity({ routeId: f.route.id, completionId: f.completion.completionId, previewToken: p.previewToken,
      idempotencyKey: randomUUID(), reason: '真实劳动不良分类填写错误', confirmActualWork: true, userId: f.user.id, actor: f.user.username });
    const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.order.id } });
    assert.equal(order.completedQty, '0'); assert.notEqual(order.status, 'done');
    const step = await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: f.route.steps[1].id } });
    assert.equal(step.inputQty, 40); assert.equal(step.processedQty, 0); assert.equal(step.status, 'current');
  });
  await t.test('two concurrent submissions commit once; stale second operation is rejected', async () => {
    const f = await qualityFixture(); const p = await previewQualityCorrection(f.route.id, f.completion.completionId);
    const command = { routeId: f.route.id, completionId: f.completion.completionId, previewToken: p.previewToken,
      idempotencyKey: randomUUID(), reason: '并发点击不得重复入账', confirmActualWork: true, userId: f.user.id, actor: f.user.username };
    const before = stable(await ledger(f.order.id));
    const results = await Promise.allSettled([correctQualityQuantity(command), correctQualityQuantity({ ...command, idempotencyKey: randomUUID() })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(stable(await ledger(f.order.id)), before);
    assert.equal(await prisma.operationLog.count({ where: { targetId: f.completion.completionId, action: 'correct_quality_quantity' } }), 1);
  });
  await t.test('late failure rolls back branch, quantities, action allocations and audit', async () => {
    assert.ok(/hongmeng_quality_(?:test|correction_ci)/.test(new URL(process.env.DATABASE_URL!).pathname), 'fault injection requires dedicated quality DB');
    const f = await qualityFixture();
    const preview = await previewQualityCorrection(f.route.id, f.completion.completionId);
    const before = stable(await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } }));
    // A test-only trigger injects a failure at the final audit write, after all quantity operations.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION quality_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'correct_quality_quantity' THEN RAISE EXCEPTION 'quality_test_rollback'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER quality_test_rollback BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION quality_test_fail()`);
    try {
      await assert.rejects(correctQualityQuantity({ routeId: f.route.id, completionId: f.completion.completionId, previewToken: preview.previewToken,
        idempotencyKey: randomUUID(), reason: '故障注入验证原子回滚', confirmActualWork: true, userId: f.user.id, actor: f.user.username }), /quality_test_rollback/);
      assert.equal(stable(await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } })), before);
      assert.notEqual((await prisma.workOrder.findUniqueOrThrow({ where: { id: f.completion.branchWorkOrderId! } })).branchStatus, 'CANCELLED');
      assert.equal(await prisma.processRouteActivity.count({ where: { routeId: f.route.id, action: 'correct_quality_quantity' } }), 0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER quality_test_rollback ON operation_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION quality_test_fail()');
    }
  });
  await prisma.$disconnect();
});
