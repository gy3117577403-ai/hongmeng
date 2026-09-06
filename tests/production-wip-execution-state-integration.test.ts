import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaDate, chinaWeekRange } from '../lib/production-planning';
import { loadProductionExecution, loadProductionWeekNavigation, summarizeProduction } from '../lib/production-execution';
import { enterWipWarehouse, loadWipWeekLaborMetrics, rescheduleWipAllocation, scheduleWipLot } from '../lib/wip-warehouse';
import type { ProductionEntityScope } from '../lib/production-access-scope';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope: ProductionEntityScope = {
  level: 'GLOBAL', canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [],
};
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

test('WIP execution cards, filters and both summaries use allocation state and quantity independently of the open source order', {
  skip: !enabled, timeout: 90_000,
}, async () => {
  const prefix = `IT-WIP-STATE-${randomUUID().slice(0, 8)}`;
  const currentWeek = chinaWeekRange(new Date());
  const targetWeek = chinaWeekRange(plusDays(currentWeek.start, 56));
  const actor = await prisma.user.create({ data: {
    username: prefix, displayName: '续作状态投影测试', passwordHash: 'integration-test-only',
  } });
  const team = await prisma.productionTeam.create({ data: { code: `${prefix}-A`, name: `${prefix}-A` } });
  const otherTeam = await prisma.productionTeam.create({ data: { code: `${prefix}-B`, name: `${prefix}-B` } });
  const teamScope = { ...scope, level: 'TEAM' as const, teamKeys: [team.id] };
  const otherScope = { ...scope, level: 'TEAM' as const, teamKeys: [otherTeam.id] };
  const order = await prisma.workOrder.create({ data: {
    code: prefix, customerName: prefix, productName: prefix, specification: prefix,
    planType: 'managed_plan', planActive: true, productionTargetQty: 100,
    uncompletedQty: '100', completedQty: '0', stage: 'frontend', status: 'in_progress',
    weekStartDate: currentWeek.start, weekEndDate: currentWeek.end, startedAt: currentWeek.start,
    processRoute: { create: {
      templateName: prefix, templateVersion: 1, status: 'in_progress', version: 0,
      confirmedAt: currentWeek.start, confirmedById: actor.id, startedAt: currentWeek.start,
      steps: { create: [0, 1].map(index => ({
        processCode: `${prefix}-${index}`, processName: index ? '剩余工序' : '已完成工序',
        stageGroup: 'frontend', position: index + 1, sequenceGroup: index + 1,
        status: index ? 'current' : 'completed', inputQty: 100,
        processedQty: index ? 0 : 100, goodOutputQty: index ? 0 : 100, releasedGoodQty: index ? 0 : 100,
        standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '件',
        standardMillisecondsPerUnit: 1_000, unitsPerProduct: 1, countsForEfficiency: true,
      })) },
    } },
  } });
  const plan = await prisma.productionPlanOrder.create({ data: {
    sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: prefix, specification: prefix,
    orderQuantity: 100, orderDate: currentWeek.start, customerDueDate: targetWeek.end,
    createdById: actor.id, updatedById: actor.id,
    batches: { create: {
      batchNo: 1, quantity: 100, weekStartDate: currentWeek.start, weekEndDate: currentWeek.end,
      plannedCompletionDate: currentWeek.end, releaseState: 'active', workOrderId: order.id,
    } },
  }, include: { batches: true } });
  const week = { scope: 'history' as const, weekStart: targetWeek.start, weekEnd: targetWeek.end };
  const read = (filters: { stage?: string; quick?: string[] } = {}) => loadProductionExecution({
    week, filters: { ...filters, keyword: prefix }, includeSummary: true, productionScope: scope,
  });
  try {
    const lot = await enterWipWarehouse({
      batchId: plan.batches[0].id, quantity: 40, reason: '部分转仓状态验收',
      actorId: actor.id, actorName: actor.displayName, idempotencyKey: `${prefix}:enter`, productionScope: scope,
    });
    const allocation = await scheduleWipLot({
      lotId: lot.id, quantity: 40, targetWeekStartDate: targetWeek.start, reason: '目标周续作验收', teamId: team.id,
      actorId: actor.id, actorName: actor.displayName, idempotencyKey: `${prefix}:schedule`, productionScope: scope,
    });
    const active = await read({ quick: ['not_started'] });
    assert.equal(active.items.length, 1);
    assert.equal(active.items[0].executionKey, `wip:${allocation.id}`);
    assert.equal(active.items[0].stage, 'not_issued');
    assert.equal(active.items[0].quantitySummary.targetQty, 40);
    assert.equal(active.items[0].completedAt, null);
    const snapshotInput = { week, filters: { keyword: prefix }, productionScope: teamScope, snapshotMode: true };
    const snapshot = await loadProductionExecution(snapshotInput);
    assert.ok(snapshot.pagination.snapshotToken);
    await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: { teamId: otherTeam.id } });
    assert.equal((await loadProductionExecution({ ...snapshotInput, snapshotToken: snapshot.pagination.snapshotToken })).items.length, 0,
      'an existing snapshot does not keep access to a continuation reassigned to another team');
    await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: { teamId: team.id } });
    await prisma.productionExecutionSnapshot.delete({ where: { id: snapshot.pagination.snapshotToken } });
    await prisma.workOrder.update({ where: { id: order.id }, data: { completedAt: new Date() } });
    assert.equal((await read({ quick: ['not_started'] })).items[0].completedAt, null,
      'an active continuation cannot inherit a completion timestamp from its source order');
    assert.equal((await read({ quick: ['completed_today'] })).items.length, 0);
    await prisma.workOrder.update({ where: { id: order.id }, data: { completedAt: null } });
    assert.equal((await read({ quick: ['in_production'] })).items.length, 0);
    const teamBoard = await loadProductionExecution({ week, includeSummary: true, productionScope: teamScope });
    assert.equal(teamBoard.items.length, 1, 'WIP team assignment does not require an unrelated native daily assignment');
    assert.equal(teamBoard.items[0].id, order.id);
    assert.equal(teamBoard.summary?.wipPlanMetrics?.scheduledInMilliseconds, 40_000);
    const otherBoard = await loadProductionExecution({ week, includeSummary: true, productionScope: otherScope });
    assert.equal(otherBoard.items.length, 0);
    assert.equal(otherBoard.summary?.wipPlanMetrics?.scheduledInMilliseconds, 0,
      'team-scoped summaries must not expose another team continuation labor');
    assert.equal(otherBoard.summary?.wipPlanMetrics?.effectivePlannedMilliseconds, 0);

    // This is a read-projection fixture, not a reporting test: seed the
    // persisted partial-completion projection, then exercise real rescheduling.
    await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: {
      status: 'IN_PROGRESS', completedQty: 10, completedStandardMilliseconds: 10_000n,
      steps: { updateMany: { where: {}, data: {
        status: 'IN_PROGRESS', completedQty: 10, completedStandardMilliseconds: 10_000n,
      } } },
    } });
    const inProgress = await read({ quick: ['in_production'] });
    assert.equal(inProgress.items.length, 1);
    assert.equal(inProgress.items[0].quantitySummary.completedQty, 10);
    assert.equal((await read({ stage: 'completed' })).items.length, 0,
      'partial completion is not a completed continuation even if quantity flow contains a completed segment');
    const replacement = await rescheduleWipAllocation({
      allocationId: allocation.id, targetWeekStartDate: plusDays(targetWeek.start, 7), reason: '余数改排，保留旧周完成事实',
      actorId: actor.id, actorName: actor.displayName, idempotencyKey: `${prefix}:reschedule`, productionScope: scope,
    });
    assert.ok(replacement.id);
    const historical = await read({ stage: 'completed' });
    assert.equal(historical.items.length, 1);
    assert.equal(historical.items[0].wipContinuation?.status, 'SUPERSEDED');
    assert.equal(historical.items[0].stage, 'completed');
    assert.equal(historical.items[0].completedAt, null,
      'a superseded historical fact without a real completion timestamp must not invent one');
    assert.equal((await read({ quick: ['completed_today'] })).items.length, 0);
    assert.equal(historical.items[0].quantitySummary.targetQty, 10);
    assert.equal(historical.items[0].quantitySummary.completedQty, 10);
    assert.equal(historical.items[0].processRoute?.status, 'in_progress', 'source route facts stay unchanged');
    assert.equal((await read({ quick: ['in_production'] })).items.length, 0);
    const standaloneSummary = await summarizeProduction(week, scope);
    assert.ok(historical.summary?.dispatchMetrics);
    assert.equal(historical.summary?.dispatchMetrics.completed, standaloneSummary.dispatchMetrics.completed);
    assert.equal(historical.summary?.total, standaloneSummary.total);
    assert.equal(historical.stageCounts.completed, 1);
    const navigation = await loadProductionWeekNavigation(new Date(), teamScope);
    assert.equal(navigation.history.find(item => item.weekStartDate === chinaDate(targetWeek.start))?.wipTaskCount, 1,
      'navigation retains the same historical completed continuation that the list and summaries expose');
    const continuationCompletedAt = new Date();
    await prisma.wipWeekAllocation.update({ where: { id: replacement.id }, data: {
      status: 'COMPLETED', completedQty: 30, completedStandardMilliseconds: 30_000n, completedAt: continuationCompletedAt,
      steps: { updateMany: { where: {}, data: {
        status: 'COMPLETED', completedQty: 30, completedStandardMilliseconds: 30_000n,
      } } },
    } });
    const completed = await loadProductionExecution({
      week: { ...week, weekStart: plusDays(targetWeek.start, 7), weekEnd: plusDays(targetWeek.end, 7) },
      filters: { stage: 'completed', quick: ['completed_today'] }, includeSummary: true, productionScope: teamScope,
    });
    assert.equal(completed.items.length, 1);
    assert.equal(completed.items[0].wipContinuation?.status, 'COMPLETED');
    assert.equal(completed.items[0].wipContinuation?.completedAt, continuationCompletedAt.toISOString());
    assert.equal(completed.items[0].completedAt, continuationCompletedAt.toISOString());
    assert.equal(completed.items[0].quantitySummary.completedQty, 30);
    assert.equal(completed.summary?.dispatchMetrics?.completed, 1);
    assert.equal(completed.summary?.stageQuantityTotals?.completed, 30);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } })).stage, 'frontend');
    assert.equal((await loadWipWeekLaborMetrics(targetWeek.start, teamScope)).scheduledInMilliseconds, 10_000);
    await prisma.productionPlanOrder.update({ where: { id: plan.id }, data: { deletedAt: new Date() } });
    assert.equal((await loadWipWeekLaborMetrics(targetWeek.start, teamScope)).scheduledInMilliseconds, 0,
      'deleted plan facts cannot remain in the visible WIP labor denominator');
  } finally {
    await prisma.wipWeekAllocation.deleteMany({ where: { lot: { productionPlanBatchId: plan.batches[0].id } } });
    await prisma.semiFinishedLot.deleteMany({ where: { productionPlanBatchId: plan.batches[0].id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.productionPlanOrder.delete({ where: { id: plan.id } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.productionTeam.deleteMany({ where: { id: { in: [team.id, otherTeam.id] } } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
