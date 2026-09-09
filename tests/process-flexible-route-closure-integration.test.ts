import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { completeProcessStep } from '../lib/process-completion-service';
import { completeProcessSupplementObligation } from '../lib/process-route-change-service';
import { deployPublishedProductTimeRoutesInTransaction, previewProductTimeDeployment, publishProductTimeDeployment } from '../lib/product-time-deployment-service';
import { recoverStalePendingCompletionCoverage } from '../lib/process-pending-coverage-recovery';
import { previewProcessCompletionWithdrawal, withdrawProcessCompletion } from '../lib/process-completion-withdrawal-service';

const run = process.env.RUN_DB_INTEGRATION === '1';
async function recover(routeId: string) {
  const origin = process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN;
  if (!origin) return recoverStalePendingCompletionCoverage({ routeId });
  const url = new URL('/api/internal/process-route-change-outbox', origin);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  const response = await fetch(url, { method: 'POST', headers: { 'x-outbox-worker-token': process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '' } });
  assert.equal(response.status, 200);
  return (await response.json() as { coverageRecovery: Awaited<ReturnType<typeof recoverStalePendingCompletionCoverage>> }).coverageRecovery;
}

export async function fixture(indices = [0, 1, 3, 4], targetQty = 40) {
  const prefix = `IT-FLEX-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const origin = process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN;
  const testPassword = 'Disposable-Flex-2026!';
  const actor = await prisma.user.create({ data: { username: prefix, passwordHash: origin ? await bcrypt.hash(testPassword, 10) : 'not-a-login-hash', displayName: prefix, laborRole: 'ADMIN',
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', scopeKey: 'GLOBAL:FLEX_QA', grantType: 'PRIMARY', effectiveFrom: new Date('2026-01-01') } },
  } });
  let cookie = '';
  async function api<T>(path: string, body?: unknown): Promise<T> {
    assert.ok(origin && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
    if (!cookie) {
      const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: actor.username, password: testPassword }) });
      assert.equal(login.status, 200, 'disposable administrator login');
      cookie = login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
      assert.ok(cookie);
    }
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin!, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(json)}`);
    return json as T;
  }
  const employee = await prisma.employee.create({ data: { employeeNo: prefix, name: prefix, department: '生产部' } });
  const item = await prisma.drawingLibraryItem.create({ data: { customerName: 'integration-test', productName: 'flexible route', specification: prefix, libraryKey: prefix } });
  const definitions = await Promise.all(['裁线', '沾锡', '检沾锡', '检验', '包装'].map((name, index) => prisma.processDefinition.create({ data: { code: `${prefix}-${index}`, name, stageGroup: index < 3 ? 'frontend' : 'backend', sortOrder: index + 1 } })));
  const entryData = (ids: number[], unitMilliseconds = 1000) => ids.map((id, index) => ({ processDefinitionId: definitions[id].id, occurrenceKey: `operation-${id}`, position: index + 1, sequenceGroup: index + 1, timeBasis: 'per_unit', unitMilliseconds, occurrences: 1, unitLabel: '套' }));
  let profile = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: 1, status: 'published', publishedAt: new Date(), createdById: actor.id, entries: { create: entryData(indices) } }, include: { entries: { orderBy: { position: 'asc' } } } });
  const order = await prisma.workOrder.create({ data: {
    code: prefix, customerName: item.customerName, productName: 'flexible route', specification: prefix,
    drawingLibraryItemId: item.id, stage: 'frontend', status: 'processing', productionTargetQty: targetQty,
    uncompletedQty: String(targetQty), completedQty: '0', planType: 'managed_plan', planActive: true, startedAt: new Date(),
    processRoute: { create: { templateName: prefix, templateVersion: 1, routeSource: 'product_time_profile', productTimeProfileId: profile.id,
      productTimeProfileVersion: 1, reportingPolicy: 'free_sequence', status: 'in_progress', confirmedAt: new Date(), confirmedById: actor.id, startedAt: new Date(),
      steps: { create: profile.entries.map((entry, index) => ({ processDefinitionId: entry.processDefinitionId, processCode: definitions[indices[index]].code,
        processName: definitions[indices[index]].name, stageGroup: definitions[indices[index]].stageGroup, position: index + 1, sequenceGroup: index + 1,
        productTimeProfileId: profile.id, productTimeEntryId: entry.id, productTimeProfileVersion: 1, standardSource: 'product_profile', timeBasis: 'per_unit',
        standardMillisecondsPerUnit: 1000, unitLabel: '套', unitsPerProduct: 1, countsForEfficiency: true, inputQty: index === 0 ? targetQty : 0,
        status: index === 0 ? 'current' : 'pending' })) },
    } },
  }, include: { processRoute: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  const routeId = order.processRoute!.id;
  async function state() { return prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: routeId }, include: { workOrder: true, steps: { where: { retiredAt: null }, orderBy: { position: 'asc' }, include: { supplementObligation: true } } } }); }
  async function report(id: number, qty: number, options: { wipAllocationId?: string; workDate?: string } = {}) {
    const current = await state();
    const step = current.steps.find(step => step.processDefinitionId === definitions[id].id)!;
    assert.ok(step);
    const common = { routeId, processedQty: qty, defectQty: 0, workDate: options.workDate || '2026-09-03', wipAllocationId: options.wipAllocationId, employeeIds: [employee.id],
      idempotencyKey: `${prefix}-${randomUUID()}`, expectedRouteVersion: current.version, userId: actor.id, actor: prefix };
    if (origin) {
      return api(`/api/process-management/routes/${routeId}/completions`, { ...common, stepId: step.id,
        ...(step.supplementObligation ? { obligationId: step.supplementObligation.id, expectedObligationVersion: step.supplementObligation.version } : {}),
      });
    }
    return step.supplementObligation
      ? completeProcessSupplementObligation({ ...common, obligationId: step.supplementObligation.id, expectedVersion: step.supplementObligation.version })
      : completeProcessStep({ ...common, stepId: step.id, requireParticipants: true, allowAdvanceReporting: true });
  }
  async function publish(ids: number[], unitMilliseconds = 1000) {
    if (origin) {
      const draft = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: profile.version + 1, status: 'draft', createdById: actor.id, entries: { create: entryData(ids, unitMilliseconds) } } });
      const preview = await api<{ preview: { previewToken: string; canPublish: boolean } }>(`/api/product-time-profiles/${item.id}/publish/preview`, {});
      assert.equal(preview.preview.canPublish, true);
      await api(`/api/product-time-profiles/${item.id}/publish`, { expectedRevision: draft.revision, previewToken: preview.preview.previewToken });
      profile = await prisma.productTimeProfile.findUniqueOrThrow({ where: { id: draft.id }, include: { entries: { orderBy: { position: 'asc' } } } });
      return;
    }
    await prisma.productTimeProfile.update({ where: { id: profile.id }, data: { status: 'archived' } });
    profile = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: profile.version + 1, status: 'published', publishedAt: new Date(), createdById: actor.id, entries: { create: entryData(ids, unitMilliseconds) } }, include: { entries: { orderBy: { position: 'asc' } } } });
    const result = await prisma.$transaction(tx => deployPublishedProductTimeRoutesInTransaction(tx, { itemId: item.id, profileId: profile.id, actorId: actor.id, sourceChangeId: `${prefix}-v${profile.version}` }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    assert.equal(result.updated, 1);
  }
  async function assertClosed() {
    const current = await state();
    assert.equal(current.status, 'completed'); assert.equal(current.workOrder.stage, 'completed'); assert.equal(current.workOrder.status, 'done');
    assert.ok(current.workOrder.completedAt); assert.equal(current.workOrder.completedQty, String(targetQty));
    assert.equal(await prisma.processCompletion.count({ where: { routeId, step: { retiredAt: null }, voidedAt: null, coverageStatus: { not: 'COVERED' } } }), 0);
    const finished = await prisma.processQuantityMovement.findMany({ where: { workOrderId: order.id, type: 'FINISHED_GOOD', voidedAt: null }, include: { reversals: { where: { voidedAt: null } } } });
    assert.equal(finished.reduce((sum, movement) => sum + movement.quantity - movement.reversals.reduce((total, reversal) => total + reversal.quantity, 0), 0), targetQty);
    assert.ok(current.steps.every(step => step.inputQty <= targetQty && step.processedQty <= step.inputQty && step.releasedGoodQty <= step.goodOutputQty));
  }
  async function cleanup() {
    await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: order.id } } });
    await prisma.processLaborPool.deleteMany({ where: { workOrderId: order.id } });
    await prisma.processExecution.deleteMany({ where: { step: { routeId } } });
    await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: order.id } });
    await prisma.processCompletion.deleteMany({ where: { routeId } });
    await prisma.processSupplementCoverage.deleteMany({ where: { routeId } });
    await prisma.processSupplementObligation.deleteMany({ where: { routeId } });
    await prisma.productTimeDeploymentRoute.deleteMany({ where: { routeId } });
    await prisma.workOrderProcessRoute.delete({ where: { id: routeId } });
    await prisma.workOrder.delete({ where: { id: order.id } });
    await prisma.productTimeDeployment.deleteMany({ where: { drawingLibraryItemId: item.id } });
    await prisma.productTimeProfile.deleteMany({ where: { drawingLibraryItemId: item.id } });
    await prisma.drawingLibraryItem.delete({ where: { id: item.id } });
    await prisma.processDefinition.deleteMany({ where: { id: { in: definitions.map(d => d.id) } } });
    await prisma.employee.delete({ where: { id: employee.id } }); await prisma.user.delete({ where: { id: actor.id } });
  }
  async function withdraw(completionId: string, key: string) {
    const command = { routeId, completionId, expectedRouteVersion: (await state()).version, category: 'REPORTING_ERROR',
      reason: '真实报工撤回与补报的回归验证', idempotencyKey: `${prefix}-${key}`, userId: actor.id, actor: prefix };
    return origin ? (await api<{ data: Awaited<ReturnType<typeof withdrawProcessCompletion>> }>(`/api/process-management/routes/${routeId}/completions/${completionId}/withdraw`, command)).data
      : withdrawProcessCompletion(command);
  }
  return { prefix, actor, employee, item, definitions, order, routeId, state, report, publish, withdraw, assertClosed, cleanup, api };
}

export async function historicalPartialFixture(withBypassEvidence = true) {
  const f = await fixture([0, 3, 4], 2100);
  // The first 1295 physically passed before the historical route edit. Keep
  // those real transfer facts; the later 805 traverses the two added positions.
  await f.report(0, 1295);
  const original = await f.state();
  for (const step of original.steps.filter(step => step.position > 1).reverse()) {
    await prisma.workOrderProcessStep.update({ where: { id: step.id }, data: { position: step.position + 2, sequenceGroup: step.sequenceGroup + 2 } });
  }
  for (const index of [1, 2]) {
    const definition = f.definitions[index];
    await prisma.workOrderProcessStep.create({ data: { routeId: f.routeId, processDefinitionId: definition.id,
      processCode: definition.code, processName: definition.name, stageGroup: definition.stageGroup,
      position: index + 1, sequenceGroup: index + 1, timeBasis: 'per_unit', standardMillisecondsPerUnit: 30000,
      unitLabel: '套', unitsPerProduct: 1, status: 'current' } });
  }
  if (withBypassEvidence) await prisma.processRouteActivity.create({ data: {
    routeId: f.routeId, action: 'product_time_deleted_step_quantity_bypassed', content: '旧工序删除后1295件承接到检验',
    detail: { quantity: 1295, targetStepIds: [original.steps.find(step => step.processName === '检验')!.id] },
  } });
  await f.report(1, 1700); await f.report(2, 2100); await f.report(0, 805); await f.report(1, 400);
  await f.report(3, 2100); await f.report(4, 2100);
  return f;
}

test('006: pending 400 withdrawal cannot close full finished goods; recover partial 805 coverage without duplicate reports or labor', { skip: !run }, async () => {
  const f = await historicalPartialFixture();
  try {
    const beforeWithdrawal = await f.state();
    assert.equal(beforeWithdrawal.workOrder.completedQty, '2100');
    assert.equal(beforeWithdrawal.workOrder.stage, 'backend');
    assert.equal(beforeWithdrawal.status, 'in_progress');
    const withdrawnReport = await prisma.processCompletion.findFirstOrThrow({ where: { routeId: f.routeId, processedQty: 400 } });
    assert.equal(withdrawnReport.coveredQty, 0);
    assert.equal((await f.withdraw(withdrawnReport.id, '006-pending-withdraw')).status, 'WITHDRAWN');
    const afterWithdrawal = await f.state();
    assert.equal(afterWithdrawal.workOrder.stage, 'backend');
    assert.equal(afterWithdrawal.workOrder.completedAt, null);
    assert.equal(afterWithdrawal.steps.find(step => step.processName === '沾锡')?.status, 'current');
    assert.equal(afterWithdrawal.steps.find(step => step.processName === '检沾锡')?.status, 'current');
    // Emulate the old persisted closure projection, not a new report or transfer.
    await prisma.workOrder.update({ where: { id: f.order.id }, data: { stage: 'completed', status: 'done' } });
    const facts = await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, select: { id: true, processedQty: true, completedAt: true, workDate: true, voidedAt: true }, orderBy: { id: 'asc' } });
    const labor = await prisma.processLaborPool.findMany({ where: { workOrderId: f.order.id }, include: { claims: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
    const movements = await prisma.processQuantityMovement.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' } });
    const result = await recover(f.routeId);
    assert.deepEqual(result.failures, []); assert.ok(result.repairedRouteIds.includes(f.routeId));
    const restored = await f.state();
    assert.equal(restored.workOrder.stage, 'backend'); assert.equal(restored.workOrder.completedAt, null);
    assert.equal(restored.workOrder.completedQty, '2100'); assert.equal(restored.status, 'in_progress');
    const crimp = restored.steps.find(step => step.processName === '沾锡')!;
    const inspection = restored.steps.find(step => step.processName === '检沾锡')!;
    assert.equal(crimp.supplementObligation?.reportedQty, 1700);
    assert.equal(crimp.supplementObligation?.requiredQty, 2100);
    assert.equal(inspection.supplementObligation?.reportedQty, 2100);
    assert.equal(crimp.inputQty, 0, 'independent actual work cannot emit another material stream');
    const retained = await prisma.processSupplementCoverage.findFirstOrThrow({ where: { displayStepId: crimp.id } });
    assert.equal((retained.evidence as { retainedMaterial: { inputQty: number } }).retainedMaterial.inputQty, 805);
    for (const stepId of [crimp.id, inspection.id]) {
      const reports = await prisma.processCompletion.findMany({ where: { stepId, voidedAt: null }, include: { coverageAllocations: { where: { voidedAt: null } } } });
      for (const report of reports) {
        assert.equal(report.coveredQty, report.processedQty);
        assert.equal(report.coverageAllocations.reduce((sum, row) => sum + row.quantity, 0), report.processedQty, '805 coverage is not allocated twice');
      }
    }
    assert.deepEqual(await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, select: { id: true, processedQty: true, completedAt: true, workDate: true, voidedAt: true }, orderBy: { id: 'asc' } }), facts);
    assert.deepEqual(await prisma.processQuantityMovement.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' } }), movements);
    assert.deepEqual(await prisma.processLaborPool.findMany({ where: { workOrderId: f.order.id }, include: { claims: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }), labor);
    const notification = await prisma.systemNotification.findFirst({ where: { sourceId: f.routeId, eventType: 'PROCESS_ROUTE_COVERAGE_RECOVERED' }, include: { recipients: true } });
    assert.ok(notification?.recipients.some(row => row.userId === f.actor.id));
    assert.equal((await recover(f.routeId)).repairedRouteIds.includes(f.routeId), false);
    if (process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN) {
      await prisma.user.update({ where: { id: f.actor.id }, data: { employeeId: f.employee.id } });
      const ticket = await prisma.workOrderQrTicket.create({ data: { workOrderId: f.order.id, publicCode: randomUUID().replaceAll('-', '') } });
      await f.api(`/api/field-report/tickets/${ticket.publicCode}`);
      await f.api(`/api/field-report/tickets/${ticket.publicCode}/supplement-obligations/${crimp.supplementObligation!.id}/completions`, {
        expectedRouteVersion: (await f.state()).version, expectedVersion: crimp.supplementObligation!.version,
        processedQty: 400, defectQty: 0, employeeIds: [f.employee.id], expectedUserId: f.actor.id,
        workDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
        idempotencyKey: `${f.prefix}-qr-final-400`, source: { kind: 'NATIVE' },
      });
    } else await f.report(1, 400);
    await f.assertClosed();
    // Correcting a report already converted to an independent actual obligation
    // reopens its work, while the historic 805 transfer remains unchanged.
    const originalCrimp = await prisma.processCompletion.findFirstOrThrow({ where: { stepId: crimp.id, processedQty: 1700, voidedAt: null } });
    assert.equal((await f.withdraw(originalCrimp.id, '006-converted-withdraw')).status, 'WITHDRAWN');
    assert.equal((await f.state()).workOrder.stage, 'backend');
    assert.equal((await f.state()).workOrder.completedQty, '2100');
    await f.report(1, 1700); await f.assertClosed();
  } finally { await f.cleanup(); }
});

test('partial historical coverage without audited bypass evidence is not automatically credited', { skip: !run }, async () => {
  const f = await historicalPartialFixture(false);
  try {
    await recover(f.routeId);
    const state = await f.state();
    assert.equal(state.steps.find(step => step.processName === '沾锡')?.executionMode, 'NORMAL');
    assert.equal(state.steps.find(step => step.processName === '沾锡')?.processedQty, 805);
    assert.equal(state.status, 'in_progress');
    assert.equal(await prisma.processSupplementObligation.count({ where: { routeId: f.routeId } }), 0);
  } finally { await f.cleanup(); }
});

test('partial reports survive repeated process reordering and insertion until exact final closure', { skip: !run }, async () => {
  const f = await fixture();
  try {
    await f.report(0, 20); await f.report(1, 10); await f.report(3, 40); await f.report(4, 40);
    const reportsBefore = await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, select: { id: true, processedQty: true, workDate: true, completedAt: true }, orderBy: { id: 'asc' } });
    await f.publish([0, 3, 1, 4]);
    assert.deepEqual((await f.state()).steps.map(step => step.processName), ['裁线', '检验', '沾锡', '包装']);
    await f.publish([3, 0, 2, 1, 4]);
    assert.equal((await f.state()).steps.find(step => step.processName === '检沾锡')?.supplementObligation?.requiredQty, 40);
    await f.report(0, 20); await f.report(1, 30);
    assert.equal((await f.state()).status, 'in_progress', 'missing actual inspection must keep the batch open');
    await f.report(2, 40); await f.assertClosed();
    assert.deepEqual(await prisma.processCompletion.findMany({ where: { id: { in: reportsBefore.map(report => report.id) } }, select: { id: true, processedQty: true, workDate: true, completedAt: true }, orderBy: { id: 'asc' } }), reportsBefore);
    const pools = await prisma.processLaborPool.findMany({ where: { workOrderId: f.order.id } });
    assert.equal(pools.reduce((sum, pool) => sum + pool.eligibleQty, 0), 200, 'five real operations, exactly forty units each');
  } finally { await f.cleanup(); }
});

test('withdrawal after a partial-report reorder reverses only its original material stream, then closes on re-report', { skip: !run }, async () => {
  const f = await fixture();
  try {
    await f.report(0, 20); await f.report(1, 10); await f.report(3, 40); await f.report(4, 40);
    await f.publish([3, 0, 1, 4]);
    await f.report(0, 20); await f.report(1, 30); await f.assertClosed();
    const completion = await prisma.processCompletion.findFirstOrThrow({ where: { routeId: f.routeId, step: { processName: '沾锡' }, processedQty: 30 } });
    const result = await f.withdraw(completion.id, 'withdraw-reordered');
    assert.equal(result.status, 'WITHDRAWN'); assert.equal((await f.state()).workOrder.completedQty, '10');
    await f.report(1, 30); await f.assertClosed();
  } finally { await f.cleanup(); }
});

test('changing the displayed serial/parallel order retains partially released group quantities', { skip: !run }, async () => {
  const f = await fixture();
  try {
    const step = (await f.state()).steps.find(step => step.processName === '检验')!;
    await prisma.workOrderProcessStep.update({ where: { id: step.id }, data: { sequenceGroup: 2 } });
    await prisma.productProcessTimeEntry.update({ where: { id: step.productTimeEntryId! }, data: { sequenceGroup: 2 } });
    await f.report(0, 20); await f.report(1, 40); await f.report(3, 10); await f.report(4, 10);
    await f.publish([3, 0, 1, 4]);
    await f.report(0, 20); await f.report(3, 30); await f.report(4, 30); await f.assertClosed();
  } finally { await f.cleanup(); }
});

test('deleting a pending reported operation after reordering keeps history without blocking active-route closure', { skip: !run }, async () => {
  const f = await fixture();
  try {
    await f.report(3, 40); await f.report(4, 40); await f.report(0, 20);
    await f.publish([0, 3, 1, 4]);
    await f.publish([0, 1, 4]);
    await f.report(0, 20); await f.report(1, 40); await f.assertClosed();
    const retired = await prisma.workOrderProcessStep.findFirstOrThrow({ where: { routeId: f.routeId, processName: '检验' } });
    assert.ok(retired.retiredAt);
    assert.equal(await prisma.processCompletion.count({ where: { stepId: retired.id, voidedAt: null } }), 1);
  } finally { await f.cleanup(); }
});

test('a completed order stays completed when a later profile contains a legacy recall insertion policy', { skip: !run }, async () => {
  const f = await fixture([0, 3, 4]);
  try {
    await f.report(0, 40); await f.report(3, 40); await f.report(4, 40); await f.assertClosed();
    const before = await f.state();
    const reportIds = (await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, orderBy: { id: 'asc' } })).map(report => report.id);
    const draft = await prisma.productTimeProfile.create({ data: {
      drawingLibraryItemId: f.item.id, version: 2, status: 'draft', createdById: f.actor.id,
      entries: { create: [0, 2, 3, 4].map((index, position) => ({
        processDefinitionId: f.definitions[index].id, occurrenceKey: `operation-${index}`,
        position: position + 1, sequenceGroup: position + 1, timeBasis: 'per_unit', unitMilliseconds: 1000, occurrences: 1, unitLabel: '套',
      })) },
    } });
    const policies = { 'operation-2': 'RECALL_REWORK' };
    const preview = await previewProductTimeDeployment(f.item.id, prisma, policies);
    assert.equal(preview.canPublish, true);
    assert.equal(preview.impact.keptCompleted, 1);
    const result = await publishProductTimeDeployment({ itemId: f.item.id, actorId: f.actor.id,
      expectedRevision: draft.revision, previewToken: preview.previewToken, policies });
    assert.equal(result.profileId, draft.id);
    assert.equal(result.deployment.status, 'active');
    assert.equal(result.deployment.routes.find(route => route.workOrderId === f.order.id)?.status, 'unchanged');
    const after = await f.state();
    assert.equal(after.version, before.version);
    assert.equal(after.productTimeProfileId, before.productTimeProfileId);
    assert.equal(after.workOrder.stage, 'completed');
    assert.equal(after.workOrder.status, 'done');
    assert.deepEqual(after.workOrder.completedAt, before.workOrder.completedAt);
    assert.deepEqual(after.steps.map(step => step.id), before.steps.map(step => step.id));
    assert.deepEqual((await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, orderBy: { id: 'asc' } })).map(report => report.id), reportIds);
    assert.equal(await prisma.processSupplementObligation.count({ where: { routeId: f.routeId } }), 0);
  } finally { await f.cleanup(); }
});

for (const { missingInspection, batch } of [{ missingInspection: false, batch: false }, { missingInspection: true, batch: false }, { missingInspection: false, batch: true }]) {
  test(`historical-recovery: bypassed reports reconcile without duplicate material or labor; missing inspection=${missingInspection}; batch=${batch}`, { skip: !run }, async () => {
    const f = await fixture([0, 3, 4]);
    try {
      await f.report(0, 40); await f.report(3, 40); await f.report(4, 40);
      await f.assertClosed();
      // Only recreate the old route projection. All material transfers and
      // finished goods above, and the advance report below, are real services.
      await prisma.workOrder.update({ where: { id: f.order.id }, data: { stage: 'backend', status: 'processing', completedAt: null } });
      await prisma.workOrderProcessRoute.update({ where: { id: f.routeId }, data: { status: 'in_progress', completedAt: null, version: { increment: 1 } } });
      for (const step of (await f.state()).steps.filter(step => step.position > 1)) {
        await prisma.workOrderProcessStep.update({ where: { id: step.id }, data: { position: step.position + 2, sequenceGroup: step.sequenceGroup + 2 } });
      }
      for (const index of missingInspection ? [1, 2] : [1]) {
        const definition = f.definitions[index];
        await prisma.workOrderProcessStep.create({ data: { routeId: f.routeId, processDefinitionId: definition.id, processCode: definition.code,
          processName: definition.name, stageGroup: definition.stageGroup, position: index + 1, sequenceGroup: index + 1,
          timeBasis: batch ? 'per_batch' : 'per_unit', standardMillisecondsPerUnit: 1000, unitLabel: '套', unitsPerProduct: 1, status: 'current' } });
      }
      await f.report(1, 40);
      if (batch) {
        // A past edit moved this zero-input operation before the original first
        // step. Only the immutable full finished-good ledger proves passage.
        const hole = (await f.state()).steps.find(step => step.processName === '沾锡')!;
        await prisma.workOrderProcessStep.update({ where: { id: hole.id }, data: { position: 100 } });
        for (const step of (await f.state()).steps.filter(step => step.id !== hole.id).reverse()) {
          await prisma.workOrderProcessStep.update({ where: { id: step.id }, data: { position: step.position + 1, sequenceGroup: step.sequenceGroup + 1 } });
        }
        await prisma.workOrderProcessStep.update({ where: { id: hole.id }, data: { position: 1, sequenceGroup: 1 } });
      }
      await prisma.workOrderProcessStep.updateMany({ where: { routeId: f.routeId, inputQty: 0, processedQty: 0 }, data: { status: 'skipped', completedAt: new Date() } });
      const poolsBefore = await prisma.processLaborPool.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' }, include: { claims: true } });
      const reportsBefore = await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, select: { id: true, processedQty: true, completedAt: true, workDate: true }, orderBy: { id: 'asc' } });
      const movementCount = await prisma.processQuantityMovement.count({ where: { workOrderId: f.order.id } });
      await prisma.workOrder.update({ where: { id: f.order.id }, data: { productionPausedAt: new Date() } });
      assert.equal((await recover(f.routeId)).repairedRouteIds.includes(f.routeId), false);
      await prisma.workOrder.update({ where: { id: f.order.id }, data: { productionPausedAt: null } });
      const recovered = await recover(f.routeId);
      assert.deepEqual(recovered.failures, []); assert.ok(recovered.repairedRouteIds.includes(f.routeId));
      assert.equal(await prisma.processQuantityMovement.count({ where: { workOrderId: f.order.id } }), movementCount);
      const poolsAfter = await prisma.processLaborPool.findMany({ where: { workOrderId: f.order.id }, orderBy: { id: 'asc' }, include: { claims: true } });
      assert.deepEqual(poolsAfter.filter(pool => poolsBefore.some(before => before.id === pool.id)), poolsBefore);
      assert.equal(poolsAfter.length - poolsBefore.length, 0, 'upstream coverage must not add labor already earned at reporting');
      if (batch) assert.equal(poolsAfter.find(pool => pool.allocationPolicy === 'batch_proportional_v1')?.totalStandardLaborMilliseconds, 1000n);
      assert.deepEqual(await prisma.processCompletion.findMany({ where: { routeId: f.routeId }, select: { id: true, processedQty: true, completedAt: true, workDate: true }, orderBy: { id: 'asc' } }), reportsBefore);
      assert.equal((await recover(f.routeId)).repairedRouteIds.includes(f.routeId), false);
      if (missingInspection) {
        const step = (await f.state()).steps.find(step => step.processName === '检沾锡')!;
        assert.equal(step.status, 'current'); assert.equal(step.supplementObligation?.reportedQty, 0);
        assert.equal((await f.state()).workOrder.completedAt, null);
        await f.report(2, 40);
      }
      await f.assertClosed();
      const converted = await prisma.processCompletion.findFirstOrThrow({ where: { routeId: f.routeId, step: { processName: '沾锡' } } });
      const preview = await previewProcessCompletionWithdrawal(f.routeId, converted.id);
      assert.equal(preview.canWithdraw, true); assert.equal(preview.impact.workOrderCompletedReductionQty, 0);
      const withdrawn = await f.withdraw(converted.id, 'withdraw');
      assert.equal(withdrawn.status, 'WITHDRAWN'); assert.equal((await f.state()).status, 'in_progress');
      assert.equal((await f.state()).workOrder.completedQty, '40');
      await f.report(1, 40); await f.assertClosed();
    } finally { await f.cleanup(); }
  });
}
