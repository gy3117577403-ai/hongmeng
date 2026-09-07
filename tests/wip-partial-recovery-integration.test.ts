import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { chinaTodayDateKey } from '../lib/attendance';
import { chinaWeekRange } from '../lib/production-planning';
import { submitProcessCompletion, previewProcessReportSubmission, resolveProcessReportSubmission } from '../lib/process-report-submissions';
import { enterWipWarehouse, scheduleWipLot, unscheduleWipAllocation } from '../lib/wip-warehouse';
import { loadProcessCompletionContext } from '../lib/process-completion-service';
import { loadWipScheduleBalances } from '../lib/wip-schedule-balance';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };
const fixtures: Array<{ workOrderId: string; actorId: string; employeeId: string; definitionIds: string[] }> = [];
after(async () => {
  for (const f of fixtures) {
    const ids = (await prisma.processReportSubmission.findMany({ where: { workOrderId: f.workOrderId }, select: { id: true } })).map(row => row.id);
    await prisma.systemNotification.deleteMany({ where: { sourceType: 'process_reporting_submission', sourceId: { in: ids } } });
    await prisma.processReportSubmission.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processWipCredit.deleteMany({ where: { completion: { workOrderId: f.workOrderId } } });
    await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: f.workOrderId } } });
    await prisma.processLaborPool.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processCompletionCoverage.deleteMany({ where: { reportCompletion: { workOrderId: f.workOrderId } } });
    await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processActionConsumption.deleteMany({ where: { step: { route: { workOrderId: f.workOrderId } } } });
    await prisma.processCompletion.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.wipWeekAllocationWorker.deleteMany({ where: { allocation: { lot: { workOrderId: f.workOrderId } } } });
    await prisma.wipWeekAllocation.deleteMany({ where: { lot: { workOrderId: f.workOrderId } } });
    await prisma.semiFinishedLot.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.productionPlanOrder.deleteMany({ where: { batches: { some: { workOrderId: f.workOrderId } } } });
    await prisma.workOrder.deleteMany({ where: { id: f.workOrderId } });
    await prisma.processDefinition.deleteMany({ where: { id: { in: f.definitionIds } } });
    await prisma.operationLog.deleteMany({ where: { userId: f.actorId } });
    await prisma.user.deleteMany({ where: { id: f.actorId } });
    await prisma.employee.deleteMany({ where: { id: f.employeeId } });
  }
  await prisma.$disconnect();
});

test('1528: unequal remaining steps and two pending reports recover against 700 plus 550 without duplicate labor', { skip: !enabled, timeout: 120000 }, async () => {
  const prefix = `IT-WIP-SPLIT-${randomUUID()}`;
  const origin = process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN;
  const password = 'Disposable-Wip-Split-2026!';
  const employee = await prisma.employee.create({ data: { employeeNo: prefix, name: '原实际作业员', department: '生产部', attendanceEnabled: true } });
  const actor = await prisma.user.create({ data: { username: prefix, displayName: '报工恢复验收', passwordHash: origin ? await bcrypt.hash(password, 10) : 'test-only', laborRole: 'ADMIN', employeeId: employee.id,
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:WIP_SPLIT_QA', grantType: 'PRIMARY' } } } });
  let cookie = '';
  async function api(path: string, body?: unknown) {
    assert.ok(origin && ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
    if (!cookie) {
      const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password }) });
      assert.equal(response.status, 200); cookie = response.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
    }
    const response = await fetch(`${origin}${path}`, { method: body == null ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin!, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.ok([200, 202].includes(response.status), JSON.stringify(result)); return result;
  }
  const definitions = await Promise.all(['包胶布', '检验', '包装'].map((name, i) => prisma.processDefinition.create({ data: { code: `${prefix}-${i}`, name, stageGroup: 'backend' } })));
  const order = await prisma.workOrder.create({ data: { code: prefix, productName: '1528隔离验收', specification: prefix, planType: 'managed_plan', planActive: true,
    productionTargetQty: 4000, uncompletedQty: '4000', completedQty: '0', stage: 'backend', status: 'processing', startedAt: new Date(),
    processRoute: { create: { templateName: prefix, templateVersion: 1, reportingPolicy: 'free_sequence', status: 'in_progress', startedAt: new Date(),
      steps: { create: definitions.map((definition, i) => ({ processDefinitionId: definition.id, processCode: definition.code, processName: definition.name,
        stageGroup: 'backend', position: i + 1, sequenceGroup: i + 1, status: 'current', inputQty: i === 0 ? 4000 : 0,
        timeBasis: 'per_unit', standardMillisecondsPerUnit: [30000, 8000, 1000][i], standardSource: 'manual', unitsPerProduct: 1,
        unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套' })) } } } }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  const route = order.processRoute!, [wrap, inspect, pack] = route.steps;
  fixtures.push({workOrderId:order.id,actorId:actor.id,employeeId:employee.id,definitionIds:definitions.map(row=>row.id)});
  const common = { actorId: actor.id, actorName: actor.displayName || '', productionScope: scope, reason: '隔离业务验收' };
  async function report(stepId: string, quantity: number, source?: { kind: 'WIP'; lotId: string; allocationId: string }) {
    const current = await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: route.id } });
    const command = { routeId: route.id, stepId, processedQty: quantity, defectQty: 0, reportedUnitQty: quantity, reportedDefectUnitQty: 0,
      employeeIds: [employee.id], workDate: chinaTodayDateKey(), reportSource: 'QR_MOBILE' as const, principalEmployeeId: employee.id, userId: actor.id,
      actor: actor.displayName || '', expectedRouteVersion: current.version, expectedUserId: actor.id, idempotencyKey: randomUUID(),
      autoAssignLabor: true, requireParticipants: true, allowPending: true, ...(source ? { source } : {}) };
    if (origin) { const result = await api(`/api/process-management/routes/${route.id}/completions`, command); return { ...result, pending: result.pending === true }; }
    return submitProcessCompletion(command);
  }
  assert.equal((await report(wrap.id, 3300)).pending, false);
  assert.equal((await report(inspect.id, 2750)).pending, false);
  const week = chinaWeekRange(new Date()), previousStart = new Date(week.start.getTime() - 7 * 86400000), previousEnd = new Date(week.end.getTime() - 7 * 86400000);
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: prefix, sourceLineNo: 1, customerName: prefix, productName: prefix, specification: prefix,
    orderQuantity: 4000, orderDate: previousStart, customerDueDate: week.end, createdById: actor.id, updatedById: actor.id,
    batches: { create: { batchNo: 1, quantity: 4000, weekStartDate: previousStart, weekEndDate: previousEnd, plannedCompletionDate: previousEnd, releaseState: 'active', workOrderId: order.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ ...common, batchId: plan.batches[0].id, quantity: 4000, idempotencyKey: randomUUID() });
  const original = await scheduleWipLot({ ...common, lotId: lot.id, quantity: 4000, targetWeekStartDate: week.start, idempotencyKey: randomUUID() });
  await prisma.wipWeekAllocation.update({ where: { id: original.id }, data: { targetWeekStartDate: previousStart, targetWeekEndDate: previousEnd } });
  const source = { kind: 'WIP' as const, lotId: lot.id, allocationId: original.id };
  const first = await report(wrap.id, 700, source), second = await report(inspect.id, 1250, source);
  assert.ok(first.pending && second.pending); if (!first.pending || !second.pending) return;
  await unscheduleWipAllocation({ ...common, allocationId: original.id, expectedVersion: original.version, idempotencyKey: randomUUID() });
  const current = await scheduleWipLot({ ...common, lotId: lot.id, quantity: 700, targetWeekStartDate: week.start, idempotencyKey: randomUUID() });
  const steps = await prisma.wipWeekAllocationStep.findMany({ where: { allocationId: current.id }, include: { lotStep: true } });
  assert.deepEqual(steps.sort((a,b) => a.lotStep.position-b.lotStep.position).map(step => step.plannedQty), [700,700,700]);
  const context = await loadProcessCompletionContext(route.id, wrap.id);
  assert.equal(context.routeSteps.find(step => step.id === wrap.id)?.pendingSubmissionQty, 700);
  assert.equal(context.routeSteps.find(step => step.id === wrap.id)?.reportableQty, 0);
  async function resolve(id: string) {
    const preview: Awaited<ReturnType<typeof previewProcessReportSubmission>> = origin ? (await api(`/api/process-report-submissions/${id}/preview`)).data : await previewProcessReportSubmission(id, actor.id);
    const option = preview.sourceOptions.find(option => option.remainingQty >= preview.submission.processedQty)!;
    assert.ok(preview.canResolve, preview.blockers.join(';'));
    const input = { expectedVersion: preview.submission.version, expectedRouteVersion: preview.routeVersion!, sourceKey: option.key, sourceVersion: option.version };
    const response = origin ? await api(`/api/process-report-submissions/${id}/resolve`, input) : null;
    return { result: response ? { pending: response.pending, submission: response.data || response.submission } : await resolveProcessReportSubmission(id, actor.id, input), option, input };
  }
  const firstDone = await resolve(first.submission.id);
  assert.equal(firstDone.result.pending, false, firstDone.result.submission.lastError || '');
  if (!origin) {
    const insufficient = await previewProcessReportSubmission(second.submission.id, actor.id);
    const shortSource = insufficient.sourceOptions.find(option => option.action === 'USE_ALLOCATION' && option.remainingQty === 700)!;
    assert.ok(shortSource);
    const allocationCount = await prisma.wipWeekAllocation.count({ where: { lotId: lot.id } });
    const failed = await resolveProcessReportSubmission(second.submission.id, actor.id, {
      expectedVersion: insufficient.submission.version, expectedRouteVersion: insufficient.routeVersion!, sourceKey: shortSource.key, sourceVersion: shortSource.version,
    });
    assert.equal(failed.pending, true); assert.match(failed.submission.lastError || '', /1250/);
    assert.equal(await prisma.wipWeekAllocation.count({ where: { lotId: lot.id } }), allocationCount);
    assert.equal(await prisma.processCompletion.count({ where: { stepId: inspect.id } }), 1, 'insufficient recovery cannot create a partial receipt');
  }
  const secondDone = await resolve(second.submission.id);
  assert.equal(secondDone.option.action, 'COMBINE_SOURCES');
  assert.deepEqual(secondDone.option.parts?.map(part => part.quantity), [700,550]);
  assert.equal(secondDone.result.pending, false, secondDone.result.submission.lastError || '');
  const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: secondDone.result.submission.completionId! }, include: { wipCredits: true, laborPool: { include: { claims: true } } } });
  assert.equal(completion.processedQty, 1250);
  assert.equal(completion.createdById, actor.id);
  assert.equal(completion.workDate.toISOString().slice(0,10), chinaTodayDateKey());
  assert.deepEqual(completion.wipCredits.map(credit => credit.quantity).sort((a,b)=>a-b), [550,700]);
  assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 10000000n);
  assert.equal(completion.laborPool?.claims[0].employeeId, employee.id);
  assert.equal((await resolveProcessReportSubmission(second.submission.id, actor.id, secondDone.input)).pending, false);
  assert.equal(await prisma.processCompletion.count({ where: { id: completion.id } }), 1);
  const balances = await loadWipScheduleBalances(prisma, lot.id);
  assert.equal(balances.find(step=>step.stepId===wrap.id)?.remainingQty,0);
  assert.equal(balances.find(step=>step.stepId===inspect.id)?.remainingQty,0);
  assert.equal(balances.find(step=>step.stepId===pack.id)?.remainingQty,4000);
  const finalSchedule = await scheduleWipLot({ ...common, lotId: lot.id, quantity: 2750, targetWeekStartDate: week.start, idempotencyKey: randomUUID() });
  const remainingSteps = await prisma.wipWeekAllocationStep.findMany({ where: { allocationId: finalSchedule.id }, include: { lotStep: true } });
  assert.deepEqual(remainingSteps.map(step=>[step.lotStep.processName,step.plannedQty]), [['包装',2750]]);
});
