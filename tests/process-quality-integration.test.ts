import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { completeProcessStep, completeProcessStepsBatch } from '../lib/process-completion-service';
import { previewProcessCompletionWithdrawal, withdrawProcessCompletion } from '../lib/process-completion-withdrawal-service';
import { emptyProcessQualityReport } from '../lib/process-quality-report';
import { mutateQualityRecord } from '../lib/quality-data-service';
// The exact same profile-backed fixture is used by HTTP and browser acceptance.
const { createFixture } = require('../scripts/seed-process-quality-smoke.cjs');

test('inspection reporting is atomic, idempotent, step-specific, and withdrawn with its source', { skip: process.env.RUN_DB_INTEGRATION !== '1' || process.env.PROCESS_QUALITY_QA_ALLOW !== 'disposable-quality-reporting-runtime' }, async () => {
  const f = await createFixture(prisma, [36]), order = f.orders[0], actor = { id: f.users.admin.id, name: f.users.admin.name, canManage: true, canReview: true };
  const step = (position: number) => order.steps.find((s: { position: number }) => s.position === position);
  const command = (position: number, version: number, bad = 0) => ({ routeId: order.routeId, stepId: step(position).id, processedQty: 10, defectQty: bad,
    defectDisposition: bad ? 'quality_pending' : undefined, workDate: f.workDate, employeeIds: [f.users.operator.employeeId], requireParticipants: true, autoAssignLabor: true,
    allowAdvanceReporting: true, idempotencyKey: randomUUID(), expectedRouteVersion: version, userId: actor.id, actor: actor.name });
  const request = { ...command(16, 0, 3), qualityReport: { ...emptyProcessQualityReport(), responsibility: { status: 'ASSIGNED', allocations: [
    { employeeId: f.users.other.employeeId, quantity: 2 }, { employeeId: f.users.operator.employeeId, quantity: 1 },
  ] }, issue: '断路', note: 'A端现场检查' } };
  const completed = await completeProcessStep(request);
  assert.equal(completed.pendingCoverageQty, 10);
  let record = await prisma.qualityDataRecord.findUniqueOrThrow({ where: { sourceCompletionId: completed.completionId } });
  assert.equal(record.type, 'CONTINUITY'); assert.equal(record.responsibilityStatus, 'ASSIGNED');
  assert.deepEqual({ total: (record.reportSnapshot as any).quantity, good: (record.reportSnapshot as any).goodQty, bad: (record.reportSnapshot as any).defectQty }, { total: 10, good: 7, bad: 3 });
  assert.equal((record.reportSnapshot as any).stepId, step(16).id);
  assert.equal((record.data as any).context.inspectedBy, f.users.operator.name);
  const replay = await completeProcessStep(request); assert.equal(replay.completionId, completed.completionId);
  assert.equal(await prisma.qualityDataRecord.count({ where: { sourceCompletionId: completed.completionId } }), 1);
  await assert.rejects(() => completeProcessStep({ ...request, qualityReport: { ...request.qualityReport, note: 'changed retry' } }), /请求标识/);
  const version = completed.routeVersion;
  await assert.rejects(() => completeProcessStep({ ...command(24, version, 2), qualityReport: request.qualityReport }), /合计/);
  assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: order.routeId } })).version, version, 'failed quality validation rolls back route and reporting');
  assert.equal(await prisma.processCompletion.count({ where: { routeId: order.routeId, stepId: step(24).id } }), 0);
  const ordinary = await completeProcessStep(command(1, version));
  assert.equal(await prisma.qualityDataRecord.count({ where: { sourceCompletionId: ordinary.completionId } }), 0);
  const badBatch = { ...command(8, ordinary.routeVersion), items: [
    { stepId: step(8).id, processedQty: 5, defectQty: 0, qualityReport: emptyProcessQualityReport() },
    { stepId: step(24).id, processedQty: 5, defectQty: 2, defectDisposition: 'quality_pending', qualityReport: request.qualityReport },
  ] };
  await assert.rejects(() => completeProcessStepsBatch(badBatch), /合计/);
  assert.equal(await prisma.processCompletion.count({ where: { routeId: order.routeId, stepId: step(8).id } }), 0, 'invalid second batch item rolls back first');
  const batch = await completeProcessStepsBatch({ ...badBatch, idempotencyKey: randomUUID(), items: badBatch.items.map(row => ({ ...row, defectQty: 0, qualityReport: emptyProcessQualityReport() })) });
  assert.equal(batch.completionCount, 2);
  assert.equal(await prisma.qualityDataRecord.count({ where: { sourceCompletionId: { in: batch.items.map(item => item.result.completionId) } } }), 2);
  await assert.rejects(() => mutateQualityRecord(record.id, actor, { action: 'SAVE', version: record.version, reason: '伪造源数量' }), /原报工/);
  await assert.rejects(() => mutateQualityRecord(record.id, actor, { action: 'DELETE', version: record.version, reason: '单独删除' }), /原报工/);
  await mutateQualityRecord(record.id, actor, { action: 'UPDATE_REPORT_DETAILS', version: record.version, reason: '确认现场责任', qualityReport: { ...emptyProcessQualityReport(), note: '责任尚待核实' } });
  record = await prisma.qualityDataRecord.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(record.responsibilityStatus, 'PENDING'); assert.equal((record.reportSnapshot as any).quantity, 10);
  const preview = await previewProcessCompletionWithdrawal(order.routeId, completed.completionId);
  assert.ok(preview.canWithdraw, JSON.stringify(preview));
  await withdrawProcessCompletion({ routeId: order.routeId, completionId: completed.completionId, expectedRouteVersion: preview.routeVersion, category: 'REPORTING_ERROR',
    idempotencyKey: randomUUID(), userId: actor.id, actor: actor.name });
  record = await prisma.qualityDataRecord.findUniqueOrThrow({ where: { id: record.id } });
  assert.ok(record.deletedAt); assert.match(record.deleteReason || '', /原报工撤回/);
  assert.equal(await prisma.qualityDataRevision.count({ where: { recordId: record.id } }), 3);
  await assert.rejects(() => mutateQualityRecord(record.id, actor, { action: 'RESTORE', version: record.version, reason: '恢复' }), /原报工/);
  await prisma.$disconnect();
});
