import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fixture } from './process-flexible-route-closure-integration.test';
import { prisma } from '../lib/prisma';
import { previewProductTimeDeployment, publishProductTimeDeployment } from '../lib/product-time-deployment-service';
import { loadProcessCompletionContext } from '../lib/process-completion-service';
import { submitProcessCompletion } from '../lib/process-report-submissions';
import { chinaTodayDateKey } from '../lib/attendance';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Scope = { mode: 'all' | 'selected' | 'work_orders'; workOrderIds: string[] };
async function draft(f: Fixture, indices: number[], version = 2) {
  return prisma.productTimeProfile.create({ data: { drawingLibraryItemId: f.item.id, version, status: 'draft', createdById: f.actor.id,
    entries: { create: indices.map((index, position) => ({ processDefinitionId: f.definitions[index].id,
      occurrenceKey: `operation-${index}`, position: position + 1, sequenceGroup: position + 1,
      timeBasis: 'per_unit', unitMilliseconds: 1000, occurrences: 1, unitLabel: '套' })) } } });
}
async function publish(f: Fixture, scope: Scope) {
  const origin = process.env.PROCESS_PENDING_RECOVERY_TEST_ORIGIN;
  if (origin) {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.actor.username, password: 'Disposable-Flex-2026!' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.match(/hm_session=[^;]+/)?.[0] || '';
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
    const response = await fetch(`${origin}/api/product-time-profiles/${f.item.id}/publish/preview`, { method: 'POST', headers, body: JSON.stringify({ scope }) });
    const { preview } = await response.json(); assert.equal(response.status, 200); assert.ok(preview.canPublish);
    const profile = await prisma.productTimeProfile.findUniqueOrThrow({ where: { id: preview.draftProfileId } });
    const published = await fetch(`${origin}/api/product-time-profiles/${f.item.id}/publish`, { method: 'POST', headers,
      body: JSON.stringify({ expectedRevision: profile.revision, previewToken: preview.previewToken, scope }) });
    const result = await published.json(); assert.equal(published.status, 200, JSON.stringify(result));
    return { profileId: result.profile.id, deployment: result.deployment };
  }
  const preview = await previewProductTimeDeployment(f.item.id, prisma, {}, scope);
  assert.ok(preview.canPublish, JSON.stringify(preview.conflicts));
  const profile = await prisma.productTimeProfile.findUniqueOrThrow({ where: { id: preview.draftProfileId } });
  return publishProductTimeDeployment({ itemId: f.item.id, actorId: f.actor.id, expectedRevision: profile.revision, previewToken: preview.previewToken, scope });
}
async function removeSubmissions(f: Fixture) {
  const ids = (await prisma.processReportSubmission.findMany({ where: { workOrderId: f.order.id }, select: { id: true } })).map(row=>row.id);
  await prisma.systemNotification.deleteMany({ where: { sourceType: 'process_reporting_submission', sourceId: { in: ids } } });
  await prisma.processReportSubmission.deleteMany({ where: { workOrderId: f.order.id } });
}

test('replace an unreported step on an already started order, then report the replacement and close exactly once', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 4]);
  try {
    await f.report(0, 40);
    const old = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[1].id)!;
    await draft(f, [0, 2, 4]);
    await publish(f, { mode: 'all', workOrderIds: [] });
    assert.ok((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: old.id } })).retiredAt);
    const next = (await f.state()).steps.find(step => step.processDefinitionId === f.definitions[2].id)!;
    const context = await loadProcessCompletionContext(f.routeId, next.id);
    assert.ok(context.routeSteps.some(step=>step.id===next.id && step.reportableQty===40));
    await f.report(2, 40); await f.report(4, 40); await f.assertClosed();
    assert.equal(await prisma.processCompletion.count({ where: { stepId: old.id } }), 0);
  } finally { await f.cleanup(); }
});

test('retiring a reported operation preserves the original receipt and earned labor without crediting the new inspection', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 4]);
  try {
    const state = await f.state(), old = state.steps.find(step => step.processDefinitionId === f.definitions[1].id)!;
    await prisma.user.update({ where: { id: f.actor.id }, data: { employeeId: f.employee.id } });
    const result = await submitProcessCompletion({ routeId: f.routeId, stepId: old.id, processedQty: 40, defectQty: 0,
      employeeIds: [f.employee.id], principalEmployeeId: f.employee.id, workDate: chinaTodayDateKey(), reportSource: 'QR_MOBILE', userId: f.actor.id,
      actor: f.prefix, expectedRouteVersion: state.version, idempotencyKey: randomUUID(), autoAssignLabor: true, requireParticipants: true, allowPending: true });
    assert.equal(result.pending, false); if (result.pending) return;
    const completion = await prisma.processCompletion.findFirstOrThrow({ where: { stepId: old.id, voidedAt: null }, include: { laborPool: { include: { claims: true } } } });
    assert.equal(completion.coverageStatus, 'PENDING');
    assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 40000n);
    await draft(f, [0, 2, 4]); await publish(f, { mode: 'all', workOrderIds: [] });
    const retained = await prisma.processCompletion.findUniqueOrThrow({ where: { id: completion.id }, include: { laborPool: { include: { claims: true } } } });
    assert.equal(retained.voidedAt, null); assert.equal(retained.countsForEfficiency, true);
    assert.equal(retained.workDate.getTime(), completion.workDate.getTime());
    assert.deepEqual(retained.laborPool, completion.laborPool);
    const next = (await f.state()).steps.find(step=>step.processDefinitionId===f.definitions[2].id)!;
    assert.equal(await prisma.processCompletion.count({ where: { stepId: next.id } }), 0);
    await f.report(0, 40); await f.report(2, 40); await f.report(4, 40); await f.assertClosed();
  } finally { await removeSubmissions(f); await f.cleanup(); }
});

test('a pending unposted receipt explicitly blocks replacement until the original report is handled', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 4]);
  try {
    await prisma.user.update({ where: { id: f.actor.id }, data: { employeeId: f.employee.id } });
    const state = await f.state(), old = state.steps.find(step=>step.processDefinitionId===f.definitions[1].id)!;
    await prisma.workOrderProcessStep.update({ where: { id: old.id }, data: { reportQuantityBasis: 'action', unitsPerProduct: 1 } });
    const result = await submitProcessCompletion({ routeId: f.routeId, stepId: old.id, processedQty: 0, defectQty: 0,
      reportedUnitQty: 40, reportedDefectUnitQty: 0, employeeIds: [f.employee.id], principalEmployeeId: f.employee.id,
      workDate: chinaTodayDateKey(), reportSource: 'QR_MOBILE', userId: f.actor.id, actor: f.prefix,
      expectedRouteVersion: state.version, idempotencyKey: randomUUID(), autoAssignLabor: true, requireParticipants: true, allowPending: true });
    assert.equal(result.pending, true); if (!result.pending) return;
    await draft(f, [0, 2, 4]);
    const preview = await previewProductTimeDeployment(f.item.id);
    assert.equal(preview.canPublish, false);
    assert.ok(preview.conflicts.some(conflict=>conflict.code==='PENDING_REPORT_ON_REMOVED_STEP' && conflict.message.includes(result.submission.id)));
    assert.equal((await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: result.submission.id } })).status, 'PENDING');
    assert.equal((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: old.id } })).retiredAt, null);
  } finally { await removeSubmissions(f); await f.cleanup(); }
});

test('scope is bound to the preview, and a work-order-only replacement keeps the global template and other orders unchanged', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 4]);
  const other = await prisma.workOrder.create({ data: { code: `${f.prefix}-other`, drawingLibraryItemId: f.item.id,
    specification: f.prefix, productName: '未选择工单', stage: 'frontend', status: 'not_started', productionTargetQty: 40, planType: 'managed_plan', planActive: true,
    processRoute: { create: { templateName: f.prefix, templateVersion: 1, routeSource: 'product_time_profile',
      productTimeProfileId: (await f.state()).productTimeProfileId, productTimeProfileVersion: 1 } } }, include: { processRoute: true } });
  try {
    const original = await f.state();
    await draft(f, [0, 2, 4]);
    const scope: Scope = { mode: 'work_orders', workOrderIds: [f.order.id] };
    const preview = await previewProductTimeDeployment(f.item.id, prisma, {}, scope);
    const profile = await prisma.productTimeProfile.findUniqueOrThrow({ where: { id: preview.draftProfileId } });
    await assert.rejects(publishProductTimeDeployment({ itemId: f.item.id, actorId: f.actor.id, expectedRevision: profile.revision,
      previewToken: preview.previewToken, scope: { mode: 'all', workOrderIds: [] } }));
    await publish(f, scope);
    assert.equal((await prisma.productTimeProfile.findFirstOrThrow({ where: { drawingLibraryItemId: f.item.id, status: 'published' } })).id, original.productTimeProfileId);
    assert.equal((await f.state()).routeSource, 'work_order_override');
    assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: other.processRoute!.id } })).productTimeProfileId, original.productTimeProfileId);
    await loadProcessCompletionContext(f.routeId);
    assert.equal((await f.state()).productTimeProfileId, profile.id, 'a read must not restore the old global template');
    await f.report(0, 40); await f.report(2, 40); await f.report(4, 40); await f.assertClosed();
  } finally {
    await prisma.productTimeDeploymentRoute.deleteMany({ where: { workOrderId: other.id } });
    await prisma.workOrder.delete({ where: { id: other.id } }); await f.cleanup();
  }
});

test('publishing for future orders pins unselected running routes to their existing version', { skip: !enabled }, async () => {
  const f = await fixture([0, 1, 4]);
  try {
    const before = await f.state();
    const profile = await draft(f, [0, 2, 4]);
    await publish(f, { mode: 'selected', workOrderIds: [] });
    assert.equal((await prisma.productTimeProfile.findFirstOrThrow({ where: { drawingLibraryItemId: f.item.id, status: 'published' } })).id, profile.id);
    await loadProcessCompletionContext(f.routeId);
    const after = await f.state();
    assert.equal(after.productTimeProfileId, before.productTimeProfileId); assert.equal(after.routeSource, 'product_time_pinned');
    assert.deepEqual(after.steps.map(step=>step.id), before.steps.map(step=>step.id));
    await f.report(0, 40); await f.report(1, 40); await f.report(4, 40); await f.assertClosed();
  } finally { await f.cleanup(); }
});
