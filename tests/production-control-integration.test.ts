import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { resolveAccessContext } from '../lib/department-access';
import { mutateProductionControl, getProductionControl, type ProductionControlActor } from '../lib/production-control-service';
import { productionDateKey } from '../lib/production-control';
import { assertProductionMayRun } from '../lib/production-pause-guard';
import { completeProcessStep, completeProcessStepsBatch } from '../lib/process-completion-service';
import { assignDailyProcessTask } from '../lib/daily-plan-service';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const rejectsCode = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);

test('production control PostgreSQL: facts, replay, pauses, branches, dates, permissions and concurrency', { skip: !enabled, timeout: 120_000 }, async () => {
  const prefix = `ITCONTROL-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({ data: { username: prefix, displayName: '生产控制测试', passwordHash: 'test-not-a-login', laborRole: 'ADMIN', accessGrants: { create: { profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL' } } } });
  const actor: ProductionControlActor = { ...user, access: resolveAccessContext([{ profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL', grantType: 'PRIMARY' }]) };
  const employee = await prisma.employee.create({ data: { employeeNo: prefix, name: '生产测试员', department: '生产部', team: prefix } });
  const day = productionDateKey(new Date())!;
  const date = new Date(`${day}T00:00:00Z`);
  const team = await prisma.productionTeam.create({ data: { code: prefix, name: prefix } });
  let planId: string | undefined;
  async function fixture(label: string) {
    return prisma.workOrder.create({ data: {
      code: `${prefix}-${label}`, customerName: prefix, productName: '控制测试产品', specification: prefix,
      stage: 'frontend', status: 'processing', planType: 'managed_plan', planActive: true, productionTargetQty: 20,
      uncompletedQty: '20', completedQty: '0', plannedAt: date, deliveryDay: day,
      materialTask: { create: { status: 'completed', completedAt: new Date(), completedById: user.id, updatedById: user.id } },
      processRoute: { create: { templateName: prefix, templateVersion: 1, status: 'in_progress', version: 0, confirmedAt: new Date(), confirmedById: user.id, startedAt: new Date(),
        steps: { create: [1, 2].map(position => ({ processCode: `${prefix}-${label}-${position}`, processName: position === 1 ? '压接' : '检验', stageGroup: 'frontend', position, sequenceGroup: position, standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '套', standardMillisecondsPerUnit: 1000, unitsPerProduct: 1, countsForEfficiency: true, inputQty: position === 1 ? 20 : 0, status: position === 1 ? 'current' : 'pending', startedAt: position === 1 ? new Date() : null })) },
      } },
    }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  }
  try {
    const root = await fixture('root');
    const sibling = await fixture('sibling');
    const closed = await fixture('closed');
    await prisma.workOrder.update({ where: { id: closed.id }, data: { stage: 'completed', completedAt: new Date(), completedQty: '20' } });
    const planOrder = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: '控制测试产品', specification: prefix, orderQuantity: 60, orderDate: date, customerDueDate: date,
      batches: { create: [root, sibling, closed].map((order, index) => ({ batchNo: index + 1, quantity: 20, weekStartDate: date, weekEndDate: date, plannedCompletionDate: date, releaseState: 'active', workOrderId: order.id })) },
    } });
    const route = root.processRoute!;
    const step = route.steps[0];
    const dailyPlan = await prisma.dailyProductionPlan.create({ data: { workDate: date, teamId: team.id, status: 'CONFIRMED', createdById: user.id, updatedById: user.id,
      tasks: { create: { workDate: date, shiftCode: 'DAY', workOrderId: root.id, routeId: route.id, stepId: step.id, routeVersion: 0, processCode: step.processCode, processName: step.processName, stageGroup: step.stageGroup, position: 1, sequenceGroup: 1, standardSource: 'integration_test', timeBasis: 'per_unit', unitLabel: '套', standardMillisecondsPerUnit: 1000, plannedQty: 20, availableQty: 20, status: 'READY' } },
    }, include: { tasks: true } });
    planId = dailyPlan.id;
    const command = { routeId: route.id, stepId: step.id, processedQty: 2, defectQty: 1, defectDisposition: 'rework', workDate: day, employeeIds: [employee.id], requireParticipants: true, autoAssignLabor: true, idempotencyKey: `${prefix}-report-1`, expectedRouteVersion: 0, userId: user.id, actor: user.username };
    const first = await completeProcessStep(command);
    const branch = await prisma.workOrder.findUniqueOrThrow({ where: { id: first.branchWorkOrderId! } });
    let control = await mutateProductionControl(actor, root.id, { action: 'note', expectedVersion: 0, requestId: `${prefix}-note`, text: '端子未到，采购跟进', category: 'material' });
    assert.equal(control.note?.text, '端子未到，采购跟进');
    async function facts() {
      const [steps, completions, pools] = await Promise.all([
        prisma.workOrderProcessStep.findMany({ where: { routeId: route.id }, select: { inputQty: true, processedQty: true, goodOutputQty: true } }),
        prisma.processCompletion.findMany({ where: { workOrderId: root.id }, select: { id: true, processedQty: true, goodQty: true, defectQty: true } }),
        prisma.processLaborPool.findMany({ where: { workOrderId: root.id }, select: { id: true, totalStandardLaborMilliseconds: true, claimedStandardLaborMilliseconds: true } }),
      ]);
      return JSON.stringify({ steps, completions, pools }, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    }
    const before = await facts();
    const pause = { action: 'pause', expectedVersion: control.version, requestId: `${prefix}-pause`, reason: '缺料暂停', category: 'material', followUpAt: `${day}T23:00:00+08:00`, confirmImpact: true };
    control = await mutateProductionControl(actor, root.id, pause);
    assert.ok(control.pausedAt);
    assert.equal(await facts(), before, 'pausing never changes quantity or labor facts');
    assert.ok((await prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: dailyPlan.tasks[0].id } })).productionSuspendedAt);
    assert.equal((await mutateProductionControl(actor, root.id, pause)).version, control.version, 'same control command replays');
    assert.equal((await completeProcessStep(command)).completionId, first.completionId, 'pre-pause successful report replays');
    const nextCommand = { ...command, defectQty: 0, idempotencyKey: `${prefix}-report-2`, expectedRouteVersion: first.routeVersion };
    await assert.rejects(completeProcessStep(nextCommand), rejectsCode('PRODUCTION_PAUSED'));
    await assert.rejects(completeProcessStepsBatch({ ...nextCommand, items: route.steps.map(item => ({ stepId: item.id, processedQty: 1, defectQty: 0 })) }), rejectsCode('PRODUCTION_PAUSED'));
    await assert.rejects(prisma.$transaction(tx => assertProductionMayRun(tx, branch.id)), rejectsCode('PRODUCTION_PAUSED'));
    await prisma.$transaction(tx => assertProductionMayRun(tx, sibling.id));
    await assert.rejects(assignDailyProcessTask({ actorUserId: user.id, taskId: dailyPlan.tasks[0].id, expectedVersion: 1, idempotencyKey: `${prefix}-assign`, assignments: [{ employeeId: employee.id, quantity: 1 }] }), rejectsCode('PRODUCTION_PAUSED'));
    const pauseAt = new Date(control.pausedAt!);
    const authorization = { requestId: `${prefix}-backfill`, actorId: user.id, actorName: user.username, reason: '网络故障补录', workStartedAt: new Date(pauseAt.getTime() - 120_000), workEndedAt: new Date(pauseAt.getTime() - 60_000), expectedPauseAt: control.pausedAt! };
    await assert.rejects(completeProcessStep({ ...nextCommand, idempotencyKey: `${prefix}-invalid-backfill` }, { ...authorization, requestId: `${prefix}-invalid-backfill`, workEndedAt: new Date(pauseAt.getTime() + 1000) }), rejectsCode('PRODUCTION_BACKFILL_INVALID'));
    const backfilled = await completeProcessStep({ ...nextCommand, idempotencyKey: authorization.requestId }, authorization);
    assert.ok(backfilled.completionId);
    assert.equal((await getProductionControl(actor, root.id)).pausedAt, control.pausedAt);
    assert.equal(await prisma.productionControlEvent.count({ where: { requestId: `backfill:${authorization.requestId}` } }), 1);
    assert.equal((await getProductionControl(actor, root.id)).note?.text, '端子未到，采购跟进');
    const unauthorized: ProductionControlActor = { ...actor, access: resolveAccessContext([{ profile: 'DEPARTMENT_FULL', departmentCode: 'HR', scopeKey: 'DEPARTMENT:HR', grantType: 'PRIMARY' }]) };
    await assert.rejects(mutateProductionControl(unauthorized, root.id, { action: 'adjust_date' }), rejectsCode('PRODUCTION_CONTROL_FORBIDDEN'));
    const future = '2030-09-02';
    control = await mutateProductionControl(actor, root.id, { action: 'adjust_date', dateKind: 'estimated', date: future, reason: '预计来料后完成', expectedVersion: control.version, requestId: `${prefix}-estimate` });
    assert.equal(control.planBaselineDate, day);
    assert.equal(control.customerDueDate, day);
    const unchanged = await prisma.productionPlanBatch.findUniqueOrThrow({ where: { workOrderId: root.id } });
    assert.equal(productionDateKey(unchanged.plannedCompletionDate), day);
    assert.equal(productionDateKey(unchanged.weekStartDate), day);
    control = await mutateProductionControl(actor, root.id, { action: 'adjust_date', dateKind: 'customer', date: future, reason: '客户协商延期', confirmation: '客户书面确认', confirmImpact: true, expectedVersion: control.version, expectedPlanVersion: 0, requestId: `${prefix}-customer` });
    assert.equal(control.deliveryBaselineDate, day);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: sibling.id } })).deliveryDay, future);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: closed.id } })).deliveryDay, day, 'closed history is immutable');
    assert.equal((await prisma.productionPlanOrder.findUniqueOrThrow({ where: { id: planOrder.id } })).deliveryVersion, 1);
    const beforeResume = await facts();
    control = await mutateProductionControl(actor, root.id, { action: 'resume', expectedVersion: control.version, requestId: `${prefix}-resume`, reason: '物料到位，重新确认人员', confirmImpact: true });
    assert.equal(control.pausedAt, null);
    assert.equal(await facts(), beforeResume);
    assert.ok((await prisma.dailyProcessTask.findUniqueOrThrow({ where: { id: dailyPlan.tasks[0].id } })).productionSuspendedAt, 'resume must not reactivate old schedules');
    const concurrent = await Promise.allSettled(['A', 'B'].map(text => mutateProductionControl(actor, root.id, { action: 'note', text, expectedVersion: control.version, requestId: `${prefix}-concurrent-${text}` })));
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = concurrent.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'PRODUCTION_CONTROL_VERSION_CONFLICT');
    await assert.rejects(prisma.$transaction(tx => assertProductionMayRun(tx, root.id, authorization)), rejectsCode('PRODUCTION_BACKFILL_INVALID'));
    control = await getProductionControl(actor, root.id);
    const racingReport = { ...nextCommand, idempotencyKey: `${prefix}-racing-report`, expectedRouteVersion: backfilled.routeVersion };
    const racingPause = { ...pause, expectedVersion: control.version, requestId: `${prefix}-racing-pause` };
    const race = await Promise.allSettled([completeProcessStep(racingReport), mutateProductionControl(actor, root.id, racingPause)]);
    if (race[1].status === 'rejected') {
      assert.equal(race[1].reason.code, 'PRODUCTION_CONTROL_VERSION_CONFLICT');
      await mutateProductionControl(actor, root.id, racingPause);
    }
    const persistedReports = await prisma.processCompletion.findMany({ where: { idempotencyKey: racingReport.idempotencyKey } });
    assert.equal(persistedReports.length, race[0].status === 'fulfilled' ? 1 : 0, 'pause/report race never reports a false success or repeats labor');
    if (race[0].status === 'fulfilled') assert.equal((await completeProcessStep(racingReport)).completionId, race[0].value.completionId);
    else assert.ok(['PRODUCTION_PAUSED', 'PROCESS_ROUTE_VERSION_CONFLICT'].includes(race[0].reason.code));
    assert.ok((await getProductionControl(actor, root.id)).pausedAt);
    await assert.rejects(mutateProductionControl(actor, closed.id, { action: 'pause', expectedVersion: 0, requestId: `${prefix}-closed`, reason: 'invalid', confirmImpact: true, followUpAt: `${day}T23:00:00+08:00` }), rejectsCode('PRODUCTION_CONTROL_CLOSED'));
  } finally {
    const ids = (await prisma.workOrder.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map(order => order.id);
    const pools = (await prisma.processLaborPool.findMany({ where: { workOrderId: { in: ids } }, select: { id: true } })).map(pool => pool.id);
    await prisma.processLaborClaim.deleteMany({ where: { poolId: { in: pools } } });
    await prisma.processLaborPool.deleteMany({ where: { id: { in: pools } } });
    await prisma.processQuantityMovement.deleteMany({ where: { completion: { workOrderId: { in: ids } } } });
    await prisma.dailyPlanRevision.deleteMany({ where: { actorId: user.id } });
    await prisma.dailyTaskAssignment.deleteMany({ where: { task: { workOrderId: { in: ids } } } });
    await prisma.dailyProcessTask.deleteMany({ where: { workOrderId: { in: ids } } });
    if (planId) await prisma.dailyProductionPlan.delete({ where: { id: planId } });
    await prisma.productionControlEvent.deleteMany({ where: { workOrderId: { in: ids } } });
    const shipmentItems = await prisma.dailyShipmentPlanItem.findMany({
      where: { workOrderId: { in: ids } },
      select: { id: true, planId: true },
    });
    const shipmentItemIds = shipmentItems.map(item => item.id);
    const shipmentPlanIds = [...new Set(shipmentItems.map(item => item.planId))];
    if (shipmentItemIds.length) {
      await prisma.shipmentEvent.deleteMany({ where: { itemId: { in: shipmentItemIds } } });
    }
    if (shipmentPlanIds.length) {
      await prisma.dailyShipmentRevision.deleteMany({ where: { planId: { in: shipmentPlanIds } } });
    }
    if (shipmentItemIds.length) {
      await prisma.dailyShipmentPlanItem.deleteMany({ where: { id: { in: shipmentItemIds } } });
    }
    if (shipmentPlanIds.length) {
      await prisma.dailyShipmentPlan.deleteMany({
        where: { id: { in: shipmentPlanIds }, items: { none: {} } },
      });
    }
    await prisma.productionPlanOrder.deleteMany({ where: { sourceOrderNo: prefix } });
    const branches = await prisma.workOrder.findMany({ where: { id: { in: ids }, parentWorkOrderId: { not: null } }, select: { id: true } });
    for (const branch of branches) {
      await prisma.processCompletion.deleteMany({ where: { workOrderId: branch.id } });
      await prisma.workOrderProcessRoute.deleteMany({ where: { workOrderId: branch.id } });
      await prisma.workOrder.delete({ where: { id: branch.id } });
    }
    await prisma.processCompletion.deleteMany({ where: { workOrderId: { in: ids } } });
    await prisma.workOrderProcessRoute.deleteMany({ where: { workOrderId: { in: ids } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.productionTeam.delete({ where: { id: team.id } });
    await prisma.operationLog.deleteMany({ where: { userId: user.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
