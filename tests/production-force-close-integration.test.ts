import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { closeProductionByException, previewProductionForceClose } from '../lib/production-force-close-service';
import { completeProcessStep, loadProcessCompletionContext } from '../lib/process-completion-service';
import { loadProductionOrderById, serializeProductionOrder } from '../lib/production-execution';
import { summarizeWeeklyClose } from '../lib/weekly-work-orders';
import { assertProductionMayBeScheduled } from '../lib/production-pause-guard';
import { resolveFieldReportAccess } from '../lib/work-order-qr-service';
import type { ProductionControlActor } from '../lib/production-control-service';
import { productionForceCloseFixture } from './helpers/production-force-close-fixture';

const skip = process.env.RUN_DB_INTEGRATION !== '1';

function productionActor(user: { id: string; username: string; displayName: string | null }): ProductionControlActor {
  return { ...user, access: { productionScope: 'GLOBAL', scopeHints: [], capabilities: ['PRODUCTION:READ', 'PRODUCTION:UPDATE'] } };
}

async function productionFacts(workOrderId: string, routeId: string) {
  return Promise.all([
    prisma.workOrderProcessStep.findMany({ where: { routeId }, orderBy: { id: 'asc' } }),
    prisma.processCompletion.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
    prisma.processSupplementObligation.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
    prisma.processQuantityMovement.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
    prisma.processLaborPool.findMany({
      where: { workOrderId }, orderBy: { id: 'asc' },
      include: { claims: { orderBy: { id: 'asc' } } },
    }),
    prisma.dailyShipmentPlanItem.findMany({ where: { workOrderId }, orderBy: { id: 'asc' } }),
  ]);
}

for (const scenario of ['voltage', 'sleeve'] as const) {
  test(`force closes the ${scenario} missing-operation scenario without changing production, labor or shipping facts`, { skip }, async () => {
    const fixture = await productionForceCloseFixture({ scenario });
    const actor = productionActor(fixture.user);
    const input = await previewProductionForceClose(actor, fixture.order.id);
    assert.equal(input.targetQty, 50);
    assert.equal(input.lastReportedQty, 50);
    assert.equal(input.verifiedQty, 0);
    assert.equal(input.steps.find(step => step.name === '包装')?.pendingCoverage, 50);
    assert.equal(input.steps.find(step => step.name === (scenario === 'voltage' ? '打耐压' : '穿双壁管'))?.reported, 0);
    if (scenario === 'sleeve') assert.equal(input.steps.find(step => step.name === '拆胶布')?.supplementalRemaining, 50);
    const before = await productionFacts(fixture.order.id, fixture.route.id);
    const beforeWeek = await summarizeWeeklyClose(fixture.week.start);
    const command = {
      version: input.version, requestId: randomUUID(), mode: 'verified_output', reason: '现场核实本批五十套已完工', actualQty: 50,
    };
    const [result, replay] = await Promise.all([
      closeProductionByException(actor, fixture.order.id, command),
      closeProductionByException(actor, fixture.order.id, command),
    ]);
    assert.deepEqual(result.closure, replay.closure);
    assert.equal(result.closure?.actualQty, 50);
    assert.equal(result.canClose, false);
    assert.equal(await prisma.productionControlEvent.count({ where: { workOrderId: fixture.order.id, action: 'force_close' } }), 1);
    const order = (await loadProductionOrderById(fixture.order.id))!;
    assert.equal(order.stage, 'completed');
    assert.equal(order.completedQty, '0');
    assert.ok(order.completedAt);
    assert.equal(order.processRoute?.status, 'force_closed');
    const boardOrder = serializeProductionOrder(order);
    assert.equal(boardOrder.stageText, '已结单（强制）');
    assert.deepEqual(boardOrder.quantityFlow.segments.map(item => item.stage), ['completed']);
    assert.equal(boardOrder.forceClosedQty, 50);
    assert.equal((await summarizeWeeklyClose(fixture.week.start)).incompleteWorkOrderCount, beforeWeek.incompleteWorkOrderCount - 1);
    assert.equal(resolveFieldReportAccess({
      ticketStatus: 'ACTIVE', workOrder: order, route: { status: 'force_closed', hasActiveSupplement: true },
    }).canReport, false);
    await assert.rejects(completeProcessStep({
      routeId: fixture.route.id, stepId: fixture.route.steps[2].id,
      processedQty: 50, defectQty: 0, employeeIds: [fixture.employee.id],
      workDate: fixture.workDate, idempotencyKey: randomUUID(), expectedRouteVersion: order.processRoute!.version,
      userId: fixture.user.id, actor: fixture.user.username,
    }), /已强制结单/);
    assert.deepEqual(await productionFacts(fixture.order.id, fixture.route.id), before);
    assert.equal((await previewProductionForceClose(actor, fixture.order.id)).closure?.reason, command.reason);
  });
}

test('stop execution accepts a pending quantity and rejects unauthorized or stale requests', { skip }, async () => {
  const fixture = await productionForceCloseFixture({ scenario: 'voltage' });
  const actor = productionActor(fixture.user);
  const reader: ProductionControlActor = { ...actor, access: { ...actor.access, capabilities: ['PRODUCTION:READ'] } };
  const input = await previewProductionForceClose(actor, fixture.order.id);
  const command = {
    version: input.version, requestId: randomUUID(), mode: 'stop_execution', actualQty: null, reason: '停止执行，实物数量待核定',
  };
  assert.equal((await previewProductionForceClose(reader, fixture.order.id)).canClose, false);
  await assert.rejects(closeProductionByException(reader, fixture.order.id, command), { status: 403 });
  await assert.rejects(closeProductionByException(actor, fixture.order.id, { ...command, mode: 'verified_output' }), /实际完成数量/);
  await prisma.workOrderProcessRoute.update({ where: { id: fixture.route.id }, data: { version: { increment: 1 } } });
  await assert.rejects(closeProductionByException(actor, fixture.order.id, command), { code: 'PRODUCTION_FORCE_CLOSE_STALE' });
  assert.equal(await prisma.productionControlEvent.count({ where: { workOrderId: fixture.order.id, action: 'force_close' } }), 0);
  const latest = await previewProductionForceClose(actor, fixture.order.id);
  const result = await closeProductionByException(actor, fixture.order.id, { ...command, version: latest.version });
  assert.equal(result.closure?.actualQty, null);
  assert.equal(result.closure?.mode, 'stop_execution');
  await assert.rejects(closeProductionByException(actor, fixture.order.id, { ...command, version: latest.version, requestId: randomUUID() }), {
    code: 'PRODUCTION_FORCE_CLOSE_NOT_OPEN',
  });
});

test('normal last-step reporting still produces verified output, labor, and automatic closure', { skip }, async () => {
  const fixture = await productionForceCloseFixture({ scenario: 'normal' });
  await fixture.report(0);
  const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: fixture.order.id }, include: { processRoute: true } });
  assert.equal(order.completedQty, '50');
  assert.equal(order.stage, 'completed');
  assert.equal(order.forceClosedAt, null);
  assert.equal(order.processRoute?.status, 'completed');
  assert.equal(await prisma.processLaborPool.count({ where: { workOrderId: order.id } }), 1);
  assert.equal((await previewProductionForceClose(productionActor(fixture.user), order.id)).canClose, false);
});

test('a closed strict route shows its history and stops work without rewriting its outstanding branch', { skip }, async () => {
  const fixture = await productionForceCloseFixture({ scenario: 'normal' });
  await prisma.workOrderProcessRoute.update({
    where: { id: fixture.route.id }, data: { reportingPolicy: 'strict_sequence' },
  });
  const completion = await fixture.report(0, 1);
  assert.ok(completion.branchWorkOrderId);
  const branch = await prisma.workOrder.findUniqueOrThrow({ where: { id: completion.branchWorkOrderId } });
  const actor = productionActor(fixture.user);
  const preview = await previewProductionForceClose(actor, fixture.order.id);
  assert.deepEqual(preview.relatedOpenOrders, [branch.businessCode || branch.code]);
  const before = await summarizeWeeklyClose(fixture.week.start);
  await closeProductionByException(actor, fixture.order.id, {
    mode: 'stop_execution', actualQty: null, reason: '停止本批生产，保留返工原记录',
    version: preview.version, requestId: randomUUID(),
  });
  assert.deepEqual(await prisma.workOrder.findUniqueOrThrow({ where: { id: branch.id } }), branch);
  await assert.rejects(prisma.$transaction(tx => assertProductionMayBeScheduled(tx, branch.id)), { code: 'PRODUCTION_FORCE_CLOSED' });
  assert.equal((await summarizeWeeklyClose(fixture.week.start)).incompleteWorkOrderCount, before.incompleteWorkOrderCount - 2);
  const history = await loadProcessCompletionContext(fixture.route.id, null, { allowCompletedSelection: true });
  assert.equal(history.step.id, fixture.route.steps[0].id);
  assert.equal(history.recentCompletions[0]?.id, completion.completionId);
});
