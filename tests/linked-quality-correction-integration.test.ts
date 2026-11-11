import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { qualityFixture } from './helpers/quality-correction-fixture';
import { correctLinkedQuality, previewLinkedQualityCorrection } from '../lib/linked-quality-correction-service';
import { previewQualityCorrection } from '../lib/process-quality-correction-service';
import { auditProductionClosure } from '../lib/production-closure-audit';
import { loadProductionClosureAuditSnapshot } from '../lib/production-closure-audit-prisma';
import { completeProcessStep } from '../lib/process-completion-service';
const enabled = process.env.RUN_DB_INTEGRATION === '1';
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const ledger = (id: string) => prisma.processLaborPool.findMany({ where: { workOrderId: id }, orderBy: { id: 'asc' }, include: { claims: { orderBy: { id: 'asc' } } } });
async function command(f: Awaited<ReturnType<typeof qualityFixture>>) {
  const p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
  return { routeId: f.route.id, completionId: f.completion.completionId, previewToken: p.previewToken,
    idempotencyKey: randomUUID(), reason: '现场核实两笔都是良品，保留原真实劳动', confirmActualWork: true,
    confirmLaterActions: true, userId: f.user.id, actor: f.user.username };
}
test('linked quality corrections are atomic, previewable and preserve every labor claim', { skip: !enabled }, async t => {
  for (const partialDownstream of [false, true]) await t.test(`linked full closure / partial=${partialDownstream}`, async () => {
    const f = await qualityFixture({ linked: true, priorActions: true, partialDownstream });
    const before = stable(await ledger(f.order.id));
    const records = await prisma.processCompletion.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' } });
    const single = await previewQualityCorrection(f.route.id, f.completion.completionId);
    assert.ok(single.blockers.some(b => b.includes('其他不良')));
    const p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
    assert.deepEqual(p.blockers, []); assert.equal(p.corrections.length, 2);
    assert.equal(p.requiresLaterActionConfirmation, true);
    assert.equal(p.actionAllocations.filter(a => a.laterAction).reduce((n, a) => n + a.quantity, 0), 70);
    assert.equal(p.closure.afterCompleted, partialDownstream ? 14 : 40);
    assert.equal(p.closure.expectedCompleted, !partialDownstream);
    assert.equal(stable(records), stable(await prisma.processCompletion.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' } })), 'GET preview performs no writes');
    const c = await command(f);
    await assert.rejects(correctLinkedQuality({ ...c, confirmLaterActions: false }), /后录入动作/);
    const result = await correctLinkedQuality(c);
    assert.deepEqual(await correctLinkedQuality(c), result);
    await assert.rejects(correctLinkedQuality({ ...c, reason: '不同原因禁止重用请求' }), /请求标识/);
    assert.equal(stable(await ledger(f.order.id)), before);
    const after = await prisma.processCompletion.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' } });
    assert.equal(after.length, records.length);
    for (const r of after) { const original = records.find(x => x.id === r.id)!;
      assert.equal(r.workDate.getTime(), original.workDate.getTime()); assert.equal(r.completedAt.getTime(), original.completedAt.getTime());
      assert.equal(r.reportedUnitQty, original.reportedUnitQty); assert.equal(r.processedQty, original.processedQty);
    }
    const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: f.order.id } });
    assert.equal(order.completedQty, partialDownstream ? '14' : '40'); assert.equal(order.status === 'done', !partialDownstream);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: f.completion.branchWorkOrderId! } })).branchStatus, 'CANCELLED');
    assert.equal(await prisma.operationLog.count({ where: { targetId: c.completionId, action: 'correct_linked_quality' } }), 1);
    const audit = auditProductionClosure(await loadProductionClosureAuditSnapshot(prisma));
    assert.deepEqual(audit.findings.filter(x => x.workOrderCode?.startsWith(f.order.code)), []);
  });
  await t.test('missing actions, different dates and used rework block without mutation', async () => {
    const f = await qualityFixture({ linked: true, priorActions: true });
    const heat = f.route.steps.find(s => s.processCode === 'HEAT')!;
    const source = await prisma.processCompletion.findFirstOrThrow({ where: { stepId: heat.id, reportedUnitQty: 110 } });
    await prisma.processCompletion.update({ where: { id: source.id }, data: { workDate: new Date('2026-11-12T00:00:00Z') } });
    let p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
    assert.ok(p.blockers.some(b => b.includes('动作来源不足')));
    await assert.rejects(correctLinkedQuality(await command(f)), /动作来源不足/);
    await prisma.processCompletion.update({ where: { id: source.id }, data: { workDate: new Date('2026-11-11T00:00:00Z') } });
    await prisma.warehouseMaterialTask.create({ data: { workOrderId: f.completion.branchWorkOrderId! } });
    p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
    assert.ok(p.blockers.some(b => b.includes('已经发生')));
    assert.equal((await prisma.processCompletion.findUniqueOrThrow({ where: { id: f.completion.completionId } })).defectQty, 40);
  });
  await t.test('twenty-step route closes with fulfilled supplements; unrelated withdrawal stays pending', async () => {
    const f = await qualityFixture({ linked: true, priorActions: true });
    await prisma.workOrderProcessStep.update({ where: { id: f.route.steps[1].id }, data: { position: 20, sequenceGroup: 20 } });
    for (let i = 3; i <= 16; i++) {
      const step = await prisma.workOrderProcessStep.create({ data: { routeId: f.route.id, processCode: `MID-${i}`, processName: `后续工序${i}`,
        position: i, sequenceGroup: i, stageGroup: 'backend', timeBasis: 'per_unit', unitsPerProduct: 1, unitLabel: '套',
        standardSource: 'test', standardMillisecondsPerUnit: 1000, inputQty: 0, status: 'pending' } });
      const route = await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: f.route.id } });
      await completeProcessStep({ routeId: route.id, stepId: step.id, processedQty: 40, defectQty: 0, workDate: '2026-11-11',
        employeeIds: [f.employee.id], requireParticipants: true, allowAdvanceReporting: true, autoAssignLabor: true,
        idempotencyKey: randomUUID(), expectedRouteVersion: route.version, userId: f.user.id, actor: f.user.username });
    }
    for (let i = 17; i <= 19; i++) {
      const definition = await prisma.processDefinition.create({ data: { code: `${f.order.code}-${i}`, name: `已履行补充工序${i}`, stageGroup: 'backend' } });
      const step = await prisma.workOrderProcessStep.create({ data: { routeId: f.route.id, processCode: definition.code, processName: definition.name,
        processDefinitionId: definition.id, position: i, sequenceGroup: i, stageGroup: 'backend', timeBasis: 'per_unit', unitsPerProduct: 1,
        unitLabel: '套', standardSource: 'test', standardMillisecondsPerUnit: 1000, executionMode: 'SUPPLEMENTAL_OBLIGATION', status: 'completed' } });
      await prisma.processSupplementObligation.create({ data: { reconciliationKey: `existing-route:${step.id}`, workOrderId: f.order.id, routeId: f.route.id, displayStepId: step.id,
        processDefinitionId: definition.id, source: 'EXISTING', processCode: definition.code, processName: definition.name, stageGroup: 'backend',
        displayPosition: i, intendedSequenceGroup: i, requiredQty: 40, reportedQty: 40, reportedUnitQty: 40, reportedGoodUnitQty: 40,
        status: 'FULFILLED', fulfilledAt: new Date(), standardMillisecondsPerUnit: 1000 } });
    }
    const pack = await prisma.processCompletion.findFirstOrThrow({ where: { stepId: f.route.steps[1].id } });
    const withdrawal = await prisma.processCompletionWithdrawalRequest.create({ data: { workOrderId: f.order.id, routeId: f.route.id,
      completionId: pack.id, stepId: pack.stepId, requesterUserId: f.user.id, requestedRouteVersion: 0, preview: {}, requestIdempotencyKey: randomUUID() } });
    const before = stable(await ledger(f.order.id));
    const p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
    assert.equal(p.steps.length, 20); assert.deepEqual(p.blockers, []); assert.equal(p.closure.expectedCompleted, true);
    assert.equal(p.pendingWithdrawalCount, 1);
    await correctLinkedQuality(await command(f));
    assert.equal(stable(await ledger(f.order.id)), before);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, 'done');
    assert.equal((await prisma.processCompletionWithdrawalRequest.findUniqueOrThrow({ where: { id: withdrawal.id } })).status, 'PENDING');
  });
  await t.test('changed downstream preview and concurrent commands cannot double apply', async () => {
    const f = await qualityFixture({ linked: true, priorActions: true }); const old = await command(f);
    await prisma.workOrderProcessRoute.update({ where: { id: f.route.id }, data: { version: { increment: 1 } } });
    await assert.rejects(correctLinkedQuality(old), /重新预览/);
    const c = await command(f); const before = stable(await ledger(f.order.id));
    const r = await Promise.allSettled([correctLinkedQuality(c), correctLinkedQuality({ ...c, idempotencyKey: randomUUID() })]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1); assert.equal(stable(await ledger(f.order.id)), before);
  });
  await t.test('final audit failure rolls back all linked rows, branch and labor', async () => {
    assert.ok(/hongmeng_quality_(?:test|correction_ci)/.test(new URL(process.env.DATABASE_URL!).pathname));
    const f = await qualityFixture({ linked: true, priorActions: true }); const c = await command(f);
    const p = await previewLinkedQualityCorrection(f.route.id, f.completion.completionId);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION linked_quality_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'correct_linked_quality' THEN RAISE EXCEPTION 'linked_quality_rollback'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER linked_quality_rollback BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION linked_quality_test_fail()');
    try { await assert.rejects(correctLinkedQuality(c), /linked_quality_rollback/);
      assert.deepEqual(await previewLinkedQualityCorrection(f.route.id, f.completion.completionId), p);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER linked_quality_rollback ON operation_logs'); await prisma.$executeRawUnsafe('DROP FUNCTION linked_quality_test_fail()'); }
  });
  await prisma.$disconnect();
});
