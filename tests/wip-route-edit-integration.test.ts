import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaDate, chinaWeekRange } from '../lib/production-planning';
import { enterWipWarehouse, scheduleWipLot, rescheduleWipAllocation, loadWipWeekLaborMetrics } from '../lib/wip-warehouse';
import { loadWipContinuations } from '../lib/wip-continuations';
import { fixture } from './process-flexible-route-closure-integration.test';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };
async function wipFixture(reported: boolean, scheduled = true, beforeTransfer?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture();
  const week = chinaWeekRange(new Date());
  await f.report(0, 40);
  if (reported) await f.report(3, 5);
  if (beforeTransfer) await beforeTransfer(f);
  const plan = await prisma.productionPlanOrder.create({ data: {
    sourceOrderNo: f.prefix, sourceLineNo: 1, customerName: f.prefix, productName: f.prefix, specification: f.prefix,
    orderQuantity: 40, orderDate: week.start, customerDueDate: week.end, createdById: f.actor.id, updatedById: f.actor.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: week.start, weekEndDate: week.end,
      plannedCompletionDate: week.end, releaseState: 'active', workOrderId: f.order.id } },
  }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity: 6, reason: '隔离回归工序变更',
    actorId: f.actor.id, actorName: f.prefix, idempotencyKey: `${f.prefix}:enter`, productionScope: scope });
  const allocation = scheduled ? await scheduleWipLot({ lotId: lot.id, quantity: 6, targetWeekStartDate: chinaDate(week.start),
    reason: '隔离回归半成品续作', actorId: f.actor.id, actorName: f.prefix, idempotencyKey: `${f.prefix}:schedule`, productionScope: scope }) : null;
  return { f, week, lot, allocation, async cleanup() {
    await prisma.processWipCredit.deleteMany({ where: { completion: { workOrderId: f.order.id } } });
    await prisma.wipWeekAllocationStep.deleteMany({ where: { allocation: { lotId: lot.id } } });
    await prisma.wipWeekAllocation.deleteMany({ where: { lotId: lot.id } });
    await prisma.semiFinishedLot.delete({ where: { id: lot.id } });
    await prisma.operationLog.deleteMany({ where: { userId: f.actor.id } });
    await prisma.productionPlanOrder.delete({ where: { id: plan.id } });
    await f.cleanup();
  } };
}

for (const reported of [false, true]) test(`deleting WIP process preserves references and completes remaining work (prior report=${reported})`, { skip: !enabled }, async () => {
  const ctx = await wipFixture(reported);
  const { f, lot, allocation } = ctx;
  try {
    const old = await prisma.semiFinishedLotStep.findFirstOrThrow({ where: { lotId: lot.id, processName: '检验' } });
    await f.publish([0, 1, 4]);
    assert.ok((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: old.stepId } })).retiredAt);
    assert.equal((await prisma.semiFinishedLotStep.findUniqueOrThrow({ where: { id: old.id } })).status, 'CANCELLED');
    const options = { wipAllocationId: allocation!.id, workDate: chinaDate(ctx.week.start) };
    await f.report(1, 6, options); await f.report(4, 6, options);
    const done = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    assert.equal(done.status, 'COMPLETED'); assert.equal(done.completedQty, 6);
    assert.equal(done.plannedStandardMilliseconds, done.completedStandardMilliseconds);
    assert.equal((await prisma.semiFinishedLot.findUniqueOrThrow({ where: { id: lot.id } })).scheduleStatus, 'COMPLETED');
    const views = await loadWipContinuations({ workOrderId: f.order.id, productionScope: scope });
    assert.ok(views.every(view => view.steps.every(step => step.stepId !== old.stepId)));
    await f.report(1, 34); await f.report(4, 34); await f.assertClosed();
  } finally { await ctx.cleanup(); }
});

test('inserted supplemental WIP work credits its selected week, withdraws, and closes once', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false);
  const { f, lot, allocation } = ctx;
  try {
    await f.publish([4, 0, 1, 2, 3]);
    const options = { wipAllocationId: allocation!.id, workDate: chinaDate(ctx.week.start) };
    const step = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[2].id)!;
    assert.ok(step.supplementObligation);
    await f.report(2, 6, options);
    const completion = await prisma.processCompletion.findFirstOrThrow({ where: { routeId: f.routeId, stepId: step.id, voidedAt: null } });
    const credit = await prisma.processWipCredit.findFirstOrThrow({ where: { completionId: completion.id } });
    assert.equal(credit.quantity, 6); assert.equal(credit.standardMilliseconds, 6000n);
    await f.withdraw(completion.id, 'supplement-withdraw');
    assert.equal((await prisma.processWipCredit.findUniqueOrThrow({ where: { id: credit.id } })).status, 'VOIDED');
    await f.report(2, 6, options);
    for (const id of [1, 3, 4]) await f.report(id, 6, options);
    const done = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    assert.equal(done.status, 'COMPLETED'); assert.equal(done.completedQty, 6); assert.equal(done.completedStandardMilliseconds, done.plannedStandardMilliseconds);
    assert.equal((await prisma.semiFinishedLot.findUniqueOrThrow({ where: { id: lot.id } })).scheduleStatus, 'COMPLETED');
    for (const id of [2, 1, 3, 4]) await f.report(id, 34);
    await f.assertClosed();
  } finally { await ctx.cleanup(); }
});

test('deleted WIP requirement cannot reappear when an unfinished allocation is rescheduled', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false);
  const { f, lot, allocation } = ctx;
  try {
    await f.report(3, 2, { wipAllocationId: allocation!.id, workDate: chinaDate(ctx.week.start) });
    await f.publish([0, 1, 4]);
    const retiredCredits = await prisma.processWipCredit.findMany({ where: { completion: { workOrderId: f.order.id, step: { retiredAt: { not: null } } } } });
    assert.equal(retiredCredits.length, 1); assert.equal(retiredCredits[0].status, 'VOIDED');
    const next = new Date(ctx.week.start); next.setUTCDate(next.getUTCDate() + 7);
    const changed = await rescheduleWipAllocation({ allocationId: allocation!.id, targetWeekStartDate: chinaDate(next), reason: '变更后改排',
      actorId: f.actor.id, actorName: f.prefix, idempotencyKey: `${f.prefix}:reschedule`, productionScope: scope });
    const steps = await prisma.wipWeekAllocationStep.findMany({ where: { allocationId: changed.id }, include: { lotStep: true } });
    assert.ok(steps.every(step => step.lotStep.status !== 'CANCELLED'));
    assert.equal(steps.length, 2);
    const metrics = await loadWipWeekLaborMetrics(chinaDate(next), scope);
    assert.ok(metrics);
    assert.equal((await prisma.semiFinishedLot.findUniqueOrThrow({ where: { id: lot.id } })).quantity, 6);
  } finally { await ctx.cleanup(); }
});

test('unscheduled WIP deletes remaining requirements without fabricating employee completions', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false, false);
  try {
    const count = await prisma.processCompletion.count({ where: { routeId: ctx.f.routeId } });
    await ctx.f.publish([0]);
    assert.equal(await prisma.processCompletion.count({ where: { routeId: ctx.f.routeId } }), count);
    assert.equal(await prisma.semiFinishedLotStep.count({ where: { lotId: ctx.lot.id, status: { not: 'CANCELLED' } } }), 0);
    assert.equal((await prisma.semiFinishedLot.findUniqueOrThrow({ where: { id: ctx.lot.id } })).scheduleStatus, 'COMPLETED');
  } finally { await ctx.cleanup(); }
});

test('published time changes reprice a partially reported WIP slice and close the exact remaining milliseconds', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false);
  const { f, allocation } = ctx;
  try {
    const options = { wipAllocationId: allocation!.id, workDate: chinaDate(ctx.week.start) };
    await f.report(1, 2, options);
    await f.publish([0, 1, 3, 4], 2000);
    const before = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    assert.equal(before.completedStandardMilliseconds, 4000n);
    assert.equal(before.plannedStandardMilliseconds, 36000n);
    await f.report(1, 4, options); await f.report(3, 6, options); await f.report(4, 6, options);
    const after = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
    assert.equal(after.completedQty, 6); assert.equal(after.completedStandardMilliseconds, 36000n);
    assert.equal(after.status, 'COMPLETED');
  } finally { await ctx.cleanup(); }
});

test('partially fulfilled supplemental work transfers only its actual remaining obligation', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false, true, async f => { await f.publish([0, 1, 2, 3, 4]); await f.report(2, 35); });
  try {
    const pending = await prisma.semiFinishedLotStep.findFirstOrThrow({ where: { lotId: ctx.lot.id, processName: '检沾锡' } });
    assert.equal(pending.remainingQty, 5);
    const options = { wipAllocationId: ctx.allocation!.id, workDate: chinaDate(ctx.week.start) };
    await ctx.f.report(2, 5, options);
    for (const id of [1, 3, 4]) await ctx.f.report(id, 6, options);
    assert.equal((await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: ctx.allocation!.id } })).status, 'COMPLETED');
    for (const id of [1, 3, 4]) await ctx.f.report(id, 34);
    await ctx.f.assertClosed();
  } finally { await ctx.cleanup(); }
});

test('a completed WIP slice reprices with its unfinished source order without reopening or changing completion facts', { skip: !enabled }, async () => {
  const ctx = await wipFixture(false);
  try {
    const options = { wipAllocationId: ctx.allocation!.id, workDate: chinaDate(ctx.week.start) };
    for (const id of [1, 3, 4]) await ctx.f.report(id, 6, options);
    const before = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: ctx.allocation!.id } });
    assert.equal(before.status, 'COMPLETED');
    const reportIds = (await prisma.processCompletion.findMany({ where: { routeId: ctx.f.routeId }, orderBy: { id: 'asc' } })).map(row => row.id);
    await ctx.f.publish([0, 1, 2, 3, 4], 2000);
    const after = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: ctx.allocation!.id } });
    assert.equal(after.plannedStandardMilliseconds, 36000n); assert.equal(after.completedStandardMilliseconds, 36000n);
    assert.equal(after.status, 'COMPLETED'); assert.equal(after.completedQty, 6); assert.deepEqual(after.completedAt, before.completedAt);
    assert.equal(await prisma.semiFinishedLotStep.count({ where: { lotId: ctx.lot.id, processName: '检沾锡' } }), 0, 'new operations do not reopen a completed WIP history slice');
    assert.deepEqual((await prisma.processCompletion.findMany({ where: { routeId: ctx.f.routeId }, orderBy: { id: 'asc' } })).map(row => row.id), reportIds);
  } finally { await ctx.cleanup(); }
});
