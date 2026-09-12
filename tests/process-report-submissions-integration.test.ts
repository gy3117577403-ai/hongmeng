import { deleteTestCompletions } from './helpers/delete-test-completions';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaTodayDateKey } from '../lib/attendance';
import { chinaWeekRange } from '../lib/production-planning';
import { submitProcessCompletion, previewProcessReportSubmission, resolveProcessReportSubmission,
  cancelProcessReportSubmission, reconcilePendingReportAssignees, autoContinuePublishedReportStandard } from '../lib/process-report-submissions';
import { setNotificationCompletedState } from '../lib/system-notifications';
import { completeProcessStep } from '../lib/process-completion-service';
import { enterWipWarehouse, scheduleWipLot } from '../lib/wip-warehouse';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const ownedFixtures: Array<{ workOrderId: string; itemId: string; definitionId: string; employeeId: string; userIds: string[] }> = [];
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };
async function fixture(kind: 'mismatch' | 'missing' | 'normal') {
  const prefix = `IT-SUBMISSION-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const employee = await prisma.employee.create({ data: { employeeNo: `${prefix}-EMP`, name: prefix, department: '生产部', isActive: true, attendanceEnabled: true } });
  const reporter = await prisma.user.create({ data: { username: `${prefix}-REPORTER`, displayName: '实际申报人', employeeId: employee.id,
    passwordHash: 'integration-test-not-login', laborRole: 'ADMIN' } });
  const handler = await prisma.user.create({ data: { username: `${prefix}-HANDLER`, displayName: '处理负责人', passwordHash: 'integration-test-not-login', laborRole: 'ADMIN' } });
  const outsider = await prisma.user.create({ data: { username: `${prefix}-OUTSIDE`, displayName: '无关账号', passwordHash: 'integration-test-not-login', laborRole: 'EMPLOYEE' } });
  const definition = await prisma.processDefinition.create({ data: { code: `${prefix}-P`, name: '插入', stageGroup: 'backend' } });
  const item = await prisma.drawingLibraryItem.create({ data: { customerName: prefix, productName: prefix, specification: prefix, libraryKey: prefix } });
  const profile = await prisma.productTimeProfile.create({ data: { drawingLibraryItemId: item.id, version: 6, status: 'published', publishedAt: new Date(),
    createdById: handler.id, updatedById: handler.id, publishedById: handler.id,
    entries: { create: { processDefinitionId: definition.id, occurrenceKey: 'insert-occurrence', position: 1, sequenceGroup: 1,
      timeBasis: 'per_unit', unitMilliseconds: 15000, occurrences: 1, unitLabel: '套', reportQuantityBasis: 'product', reportUnitLabel: '套' } } }, include: { entries: true } });
  const workOrder = await prisma.workOrder.create({ data: { code: `${prefix}-ORDER`, productName: prefix, specification: prefix, stage: 'backend', status: 'processing',
    productionTargetQty: 40, uncompletedQty: '40', completedQty: '0', planActive: true, planType: 'managed_plan', drawingLibraryItemId: item.id, startedAt: new Date(),
    processRoute: { create: { templateName: prefix, templateVersion: 6, status: 'in_progress', version: 0, startedAt: new Date(), confirmedById: handler.id,
      productTimeProfileId: profile.id, productTimeProfileVersion: 6, routeSource: 'product_time_profile', steps: { create: {
        processDefinitionId: definition.id, processCode: definition.code, processName: '插入', stageGroup: 'backend', position: 1, sequenceGroup: 1,
        status: 'current', inputQty: 40, productTimeProfileId: profile.id, productTimeEntryId: profile.entries[0].id, productTimeProfileVersion: 6,
        standardSource: 'product_profile', timeBasis: 'per_unit', standardMillisecondsPerUnit: kind === 'missing' ? null : 15000,
        unitsPerProduct: 1, unitLabel: '套', reportQuantityBasis: kind === 'mismatch' ? 'action' : 'product', reportUnitLabel: kind === 'mismatch' ? '个' : '套',
      } } } } }, include: { processRoute: { include: { steps: true } } } });
  const route = workOrder.processRoute!;
  ownedFixtures.push({ workOrderId: workOrder.id, itemId: item.id, definitionId: definition.id, employeeId: employee.id, userIds: [reporter.id, handler.id, outsider.id] });
  const step = route.steps[0];
  const command = { routeId: route.id, stepId: step.id, processedQty: kind === 'mismatch' ? 0 : 40, defectQty: 0, reportedUnitQty: 40, reportedDefectUnitQty: 0,
    workDate: chinaTodayDateKey(), employeeIds: [employee.id], requireParticipants: true, autoAssignLabor: true, reportSource: 'QR_MOBILE' as const,
    principalEmployeeId: employee.id, expectedRouteVersion: 0, idempotencyKey: `${prefix}:report`, userId: reporter.id, actor: reporter.displayName || reporter.username,
    expectedUserId: reporter.id, allowPending: true };
  return { prefix, employee, reporter, handler, outsider, definition, item, profile, workOrder, route, step, command };
}
function confirmation(preview: Awaited<ReturnType<typeof previewProcessReportSubmission>>) {
  return { expectedVersion: preview.submission.version, expectedRouteVersion: preview.routeVersion!,
    expectedProfileVersion: preview.standardPreview.published?.productTimeProfileVersion,
    expectedEntryId: preview.standardPreview.published?.productTimeEntryId };
}

after(async () => {
  if (!enabled) return;
  // Exact IDs created by this test process only. No shared/production namespace cleanup.
  for (const f of ownedFixtures) {
    const submissions = await prisma.processReportSubmission.findMany({ where: { workOrderId: f.workOrderId }, select: { id: true } });
    const submissionIds = submissions.map(item => item.id);
    await prisma.systemNotification.deleteMany({ where: { sourceType: 'process_reporting_submission', sourceId: { in: submissionIds } } });
    await prisma.processReportSubmission.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processWipCredit.deleteMany({ where: { completion: { workOrderId: f.workOrderId } } });
    await prisma.processLaborClaim.deleteMany({ where: { pool: { workOrderId: f.workOrderId } } });
    await prisma.processLaborPool.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processCompletionCoverage.deleteMany({ where: { reportCompletion: { workOrderId: f.workOrderId } } });
    await prisma.processQuantityMovement.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.processActionConsumption.deleteMany({ where: { step: { route: { workOrderId: f.workOrderId } } } });
    await deleteTestCompletions({ where: { workOrderId: f.workOrderId } });
    await prisma.wipWeekAllocationWorker.deleteMany({ where: { allocation: { lot: { workOrderId: f.workOrderId } } } });
    await prisma.wipWeekAllocation.deleteMany({ where: { lot: { workOrderId: f.workOrderId } } });
    await prisma.semiFinishedLot.deleteMany({ where: { workOrderId: f.workOrderId } });
    await prisma.productionPlanOrder.deleteMany({ where: { batches: { some: { workOrderId: f.workOrderId } } } });
    await prisma.workOrder.deleteMany({ where: { id: f.workOrderId } });
    await prisma.productTimeProfile.deleteMany({ where: { drawingLibraryItemId: f.itemId } });
    await prisma.drawingLibraryItem.deleteMany({ where: { id: f.itemId } });
    await prisma.processDefinition.deleteMany({ where: { id: f.definitionId } });
    await prisma.operationLog.deleteMany({ where: { OR: [{ userId: { in: f.userIds } }, { targetId: { in: submissionIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: f.userIds } } });
    await prisma.employee.deleteMany({ where: { id: f.employeeId } });
  }
});

test('pending quantity mapping notifies real accounts, cannot be dismissed, resumes once without reason text', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('mismatch');
  const pending = await submitProcessCompletion(f.command);
  assert.equal(pending.pending, true);
  if (!pending.pending) return;
  const id = pending.submission.id;
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  assert.equal((await submitProcessCompletion(f.command)).pending, true);
  assert.equal(await prisma.processReportSubmission.count({ where: { stepId: f.step.id } }), 1);
  await assert.rejects(submitProcessCompletion({ ...f.command, reportedUnitQty: 39 }), { code: 'PROCESS_SUBMISSION_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(submitProcessCompletion({ ...f.command, expectedUserId: f.outsider.id }), { code: 'ACCOUNT_CHANGED' });
  const note = await prisma.systemNotification.findFirstOrThrow({ where: { sourceType: 'process_reporting_submission', sourceId: id, category: 'TODO' }, include: { recipients: true } });
  assert.ok(note.recipients.some(recipient => recipient.userId === f.handler.id));
  assert.equal((await setNotificationCompletedState(f.handler.id, note.id, true)).status, 'source_pending');
  assert.equal((await setNotificationCompletedState(f.outsider.id, note.id, true)).status, 'not_found');
  await assert.rejects(previewProcessReportSubmission(id, f.outsider.id), { status: 404 });
  const first = await previewProcessReportSubmission(id, f.handler.id);
  assert.equal(first.quantityMappingRequired, true);
  const stillPending = await resolveProcessReportSubmission(id, f.handler.id, confirmation(first));
  assert.equal(stillPending.pending, true);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  assert.equal((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: f.step.id } })).reportQuantityBasis, 'action', 'failed confirm rolls repair back');
  const ready = await previewProcessReportSubmission(id, f.handler.id);
  const resolved = await resolveProcessReportSubmission(id, f.handler.id, { ...confirmation(ready), confirmQuantityMapping: true, processedQty: 40, defectQty: 0 });
  assert.equal(resolved.pending, false, resolved.submission.lastError || '');
  assert.equal(resolved.submission.status, 'COMPLETED');
  const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: resolved.submission.completionId! }, include: { laborPool: true } });
  assert.equal(completion.createdById, f.reporter.id);
  assert.equal(completion.processedQty, 40);
  assert.equal(completion.laborPool?.totalStandardLaborMilliseconds, 600000n);
  assert.equal(completion.laborPool?.remainingStandardLaborMilliseconds, 0n);
  assert.equal((await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: f.route.id } })).status, 'completed');
  assert.equal((await resolveProcessReportSubmission(id, f.handler.id, confirmation(ready))).pending, false);
  const replay = await submitProcessCompletion({ ...f.command, reportingAccessAllowed: false });
  assert.equal(replay.pending, false, 'lost final-step response must replay even when route is now completed');
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  const receipt = await prisma.systemNotificationRecipient.findUniqueOrThrow({ where: { notificationId_userId: { notificationId: note.id, userId: f.handler.id } } });
  assert.equal(receipt.completionKind, 'SOURCE_RESOLVED');
  assert.equal((await setNotificationCompletedState(f.handler.id, note.id, false)).status, 'not_restorable');
});

test('known product quantity is committed once when standard is missing, handler fills only numeric standard', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('missing');
  const pending = await submitProcessCompletion(f.command);
  assert.equal(pending.pending, true);
  if (!pending.pending) return;
  assert.equal(pending.submission.reasonCode, 'STANDARD_MISSING');
  assert.ok(pending.submission.completionId);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview),
    standard: { timeBasis: 'per_unit', standardMillisecondsPerUnit: 15000, unitsPerProduct: 1, setupMilliseconds: 0 } });
  assert.equal(done.pending, false, done.submission.lastError || '');
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  assert.equal((await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: done.submission.completionId! } })).claimedStandardLaborMilliseconds, 600000n);
});

test('published numeric standard resumes original labor automatically with system audit and no duplicate report', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('missing');
  const command = { ...f.command, workDate: '2026-09-07' };
  const pending = await submitProcessCompletion(command);
  assert.equal(pending.pending, true); if (!pending.pending) return;
  assert.equal(await autoContinuePublishedReportStandard(pending.submission.id), true);
  const submission = await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: pending.submission.id } });
  assert.equal(submission.status, 'COMPLETED'); assert.equal(submission.resolvedById, null);
  const claim = await prisma.processLaborClaim.findFirstOrThrow({ where: { pool: { completionId: submission.completionId! }, status: 'ACTIVE' } });
  assert.equal(claim.employeeId, f.employee.id); assert.equal(claim.workDate.toISOString().slice(0, 10), '2026-09-07');
  assert.equal(claim.standardLaborMilliseconds, 600000n); assert.equal(claim.claimedById, null);
  assert.equal(await autoContinuePublishedReportStandard(pending.submission.id), false);
  assert.equal((await submitProcessCompletion(command)).pending, false);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { action: 'resolve_process_report_submission', targetId: submission.id } });
  assert.equal(audit.userId, null);
  const mismatch = await fixture('mismatch');
  const mapping = await submitProcessCompletion(mismatch.command); assert.equal(mapping.pending, true);
  if (mapping.pending) assert.equal(await autoContinuePublishedReportStandard(mapping.submission.id), false);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: mismatch.step.id } }), 0);
});

test('partial batch reports without a standard retain receipts and later allocate the published budget to original days', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('missing');
  await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: { timeBasis: 'per_batch' } });
  await prisma.productProcessTimeEntry.update({ where: { id: f.profile.entries[0].id }, data: { timeBasis: 'per_batch', unitMilliseconds: 3_600_000, setupMilliseconds: 600_000 } });
  const first = await submitProcessCompletion({ ...f.command, processedQty: 10, reportedUnitQty: 10, workDate: '2026-09-07' });
  assert.equal(first.pending, true); if (!first.pending) return;
  assert.equal(first.submission.reasonCode, 'STANDARD_MISSING');
  const firstPool = await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: first.submission.completionId! } });
  assert.equal(firstPool.status, 'LOCKED'); assert.equal(firstPool.batchTargetQty, 40); assert.equal(firstPool.batchTotalStandardLaborMilliseconds, null);
  // A published standard can reach the current step before the recovery worker
  // runs. The next report must still retain a receipt beside the older missing
  // standard report, instead of silently succeeding with no labor pool.
  await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: { standardMillisecondsPerUnit: 3_600_000, setupMilliseconds: 600_000 } });
  const version = (await prisma.workOrderProcessRoute.findUniqueOrThrow({ where: { id: f.route.id } })).version;
  const second = await submitProcessCompletion({ ...f.command, processedQty: 30, reportedUnitQty: 30, workDate: '2026-09-08',
    idempotencyKey: `${f.prefix}-second-missing-batch`, expectedRouteVersion: version });
  assert.equal(second.pending, true); if (!second.pending) return;
  assert.equal(await prisma.processLaborClaim.count({ where: { pool: { stepId: f.step.id }, status: 'ACTIVE' } }), 0);
  assert.equal(await autoContinuePublishedReportStandard(first.submission.id), true);
  assert.equal(await autoContinuePublishedReportStandard(second.submission.id), true);
  const claims = await prisma.processLaborClaim.findMany({ where: { pool: { stepId: f.step.id }, status: 'ACTIVE' }, orderBy: { workDate: 'asc' } });
  assert.deepEqual(claims.map(claim => claim.standardLaborMilliseconds), [1050000n, 3150000n]);
  assert.deepEqual(claims.map(claim => claim.workDate.toISOString().slice(0, 10)), ['2026-09-07', '2026-09-08']);
  assert.equal(await autoContinuePublishedReportStandard(first.submission.id), false);
});

test('old-week WIP confirmation reschedules remaining amounts and completes reserved report atomically', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('normal');
  const week = chinaWeekRange(new Date());
  const previousStart = new Date(week.start); previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  const previousEnd = new Date(week.end); previousEnd.setUTCDate(previousEnd.getUTCDate() - 7);
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: f.prefix, sourceLineNo: 1, customerName: f.prefix, productName: f.prefix,
    specification: f.prefix, orderQuantity: 40, orderDate: previousStart, customerDueDate: week.end, createdById: f.handler.id, updatedById: f.handler.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: previousStart, weekEndDate: previousEnd, plannedCompletionDate: previousEnd,
      releaseState: 'active', workOrderId: f.workOrder.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity: 40, reason: '测试隔离半成品', actorId: f.handler.id, actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:enter` });
  const allocation = await scheduleWipLot({ lotId: lot.id, quantity: 40, targetWeekStartDate: week.start, reason: '上周有效安排', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:schedule` });
  // Isolated fixture models the existing allocation after the calendar advances to the next week.
  await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: { targetWeekStartDate: previousStart, targetWeekEndDate: previousEnd } });
  const command = { ...f.command, source: { kind: 'WIP' as const, lotId: lot.id, allocationId: allocation.id } };
  const pending = await submitProcessCompletion(command);
  assert.equal(pending.pending, true);
  if (!pending.pending) return;
  assert.equal(pending.submission.reasonCode, 'WIP_WEEK_CONFIRMATION');
  assert.equal((await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: pending.submission.id } })).reservedProductQty, 40);
  await assert.rejects(completeProcessStep({ ...f.command, idempotencyKey: `${f.prefix}:duplicate` }), { code: 'PROCESS_REPORTED_QTY_EXCEEDS_TARGET' });
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const option = preview.sourceOptions.find(item => item.allocationId === allocation.id)!;
  assert.equal(option.action, 'RESCHEDULE_REMAINING');
  const before = await prisma.wipWeekAllocation.count({ where: { lotId: lot.id } });
  const invalid = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview), sourceKey: option.key, sourceVersion: option.version + 1 });
  assert.equal(invalid.pending, true);
  assert.equal(await prisma.wipWeekAllocation.count({ where: { lotId: lot.id } }), before);
  const current = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(current), sourceKey: option.key, sourceVersion: option.version });
  assert.equal(done.pending, false, done.submission.lastError || '');
  assert.equal((await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).status, 'SUPERSEDED');
  const continuation = await prisma.wipWeekAllocation.findFirstOrThrow({ where: { sourceAllocationId: allocation.id } });
  assert.equal(continuation.completedQty, 40);
  assert.equal(await prisma.processWipCredit.count({ where: { completionId: done.submission.completionId! } }), 1);
  assert.equal((await prisma.processLaborPool.findUniqueOrThrow({ where: { completionId: done.submission.completionId! } })).claimedStandardLaborMilliseconds, 600000n);
});

test('pause and oversize never become pending; cancellation releases only unposted reservations', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('mismatch');
  await prisma.workOrder.update({ where: { id: f.workOrder.id }, data: { productionPausedAt: new Date() } });
  await assert.rejects(submitProcessCompletion(f.command));
  assert.equal(await prisma.processReportSubmission.count({ where: { stepId: f.step.id } }), 0);
  await prisma.workOrder.update({ where: { id: f.workOrder.id }, data: { productionPausedAt: null } });
  await assert.rejects(submitProcessCompletion({ ...f.command, processedQty: 41, reportedUnitQty: 41 }), { code: 'PROCESS_REPORTED_QTY_EXCEEDS_TARGET' });
  assert.equal(await prisma.processReportSubmission.count({ where: { stepId: f.step.id } }), 0);
  const pending = await submitProcessCompletion(f.command);
  assert.ok(pending.pending);
  if (!pending.pending) return;
  await prisma.user.update({ where: { id: f.reporter.id }, data: { isActive: false } });
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  await assert.rejects(resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview), confirmQuantityMapping: true, processedQty: 40 }), { code: 'PROCESS_SUBMISSION_ACTOR_INACTIVE' });
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  const cancelled = await cancelProcessReportSubmission(pending.submission.id, f.handler.id, preview.submission.version);
  assert.equal(cancelled.status, 'CANCELLED');
});

test('an inactive or reassigned handler is replaced by a capable account and receives an account notification', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('mismatch');
  const pending = await submitProcessCompletion(f.command);
  assert.ok(pending.pending);
  if (!pending.pending) return;
  assert.deepEqual(pending.submission.assigneeUserIds, [f.handler.id]);
  await prisma.user.update({ where: { id: f.handler.id }, data: { isActive: false } });
  await reconcilePendingReportAssignees(100);
  const updated = await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: pending.submission.id } });
  assert.ok(updated.assigneeUserIds.length);
  assert.ok(!updated.assigneeUserIds.includes(f.handler.id));
  const notifications = await prisma.systemNotification.findMany({ where: { sourceType: 'process_reporting_submission', sourceId: updated.id, eventType: 'PROCESS_REPORT_SUBMISSION_REASSIGNED' }, include: { recipients: true } });
  assert.ok(notifications.some(notification => notification.recipients.some(recipient => updated.assigneeUserIds.includes(recipient.userId))));
  const replacementId = updated.assigneeUserIds[0];
  const preview = await previewProcessReportSubmission(updated.id, replacementId);
  const resolved = await resolveProcessReportSubmission(updated.id, replacementId, { ...confirmation(preview), confirmQuantityMapping: true, processedQty: 40 });
  assert.equal(resolved.pending, false, resolved.submission.lastError || '');
});

test('action-only WIP reports retain explicit source when no whole-product credit exists and replay safely', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('normal');
  const week = chinaWeekRange(new Date());
  await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: { reportQuantityBasis: 'action', reportUnitLabel: '个', unitsPerProduct: 3, standardMillisecondsPerUnit: 5000 } });
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: f.prefix, sourceLineNo: 1, customerName: f.prefix, productName: f.prefix,
    specification: f.prefix, orderQuantity: 40, orderDate: week.start, customerDueDate: week.end, createdById: f.handler.id, updatedById: f.handler.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: week.start, weekEndDate: week.end, plannedCompletionDate: week.end,
      releaseState: 'active', workOrderId: f.workOrder.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity: 40, reason: '隔离动作半成品测试', actorId: f.handler.id, actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:enter` });
  const allocation = await scheduleWipLot({ lotId: lot.id, quantity: 40, targetWeekStartDate: week.start, reason: '本周动作续作', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:schedule` });
  const command = { ...f.command, processedQty: 0, reportedUnitQty: 120,
    source: { kind: 'WIP' as const, lotId: lot.id, allocationId: allocation.id } };
  const first = await submitProcessCompletion(command);
  assert.equal(first.pending, false);
  if (first.pending) return;
  const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: first.data.completionId }, include: { wipCredits: true, laborPool: true } });
  assert.equal(completion.reportingWipAllocationId, allocation.id);
  assert.equal(completion.wipCredits.length, 0);
  assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 600000n);
  assert.equal((await submitProcessCompletion(command)).pending, false);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  await assert.rejects(submitProcessCompletion({ ...command, source: { kind: 'NATIVE' } }), { code: 'PROCESS_COMPLETION_IDEMPOTENCY_CONFLICT' });
});

test('future-week WIP never advances until the handler explicitly confirms the scheduling change', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await fixture('normal');
  const week = chinaWeekRange(new Date());
  const nextWeek = new Date(week.start); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: f.prefix, sourceLineNo: 1, customerName: f.prefix, productName: f.prefix,
    specification: f.prefix, orderQuantity: 40, orderDate: week.start, customerDueDate: week.end, createdById: f.handler.id, updatedById: f.handler.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: week.start, weekEndDate: week.end, plannedCompletionDate: week.end,
      releaseState: 'active', workOrderId: f.workOrder.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity: 40, reason: '未来周隔离测试', actorId: f.handler.id, actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:enter` });
  const allocation = await scheduleWipLot({ lotId: lot.id, quantity: 40, targetWeekStartDate: nextWeek, reason: '下周安排', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:schedule` });
  const pending = await submitProcessCompletion({ ...f.command, source: { kind: 'WIP', lotId: lot.id, allocationId: allocation.id } });
  assert.ok(pending.pending);
  if (!pending.pending) return;
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const option = preview.sourceOptions.find(item => item.allocationId === allocation.id)!;
  assert.equal(option.action, 'FUTURE_CONFIRMATION');
  const rejected = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview), sourceKey: option.key, sourceVersion: option.version });
  assert.equal(rejected.pending, true);
  assert.equal((await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).status, 'ACTIVE');
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  const current = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(current), sourceKey: option.key, sourceVersion: option.version, confirmAdvanceSchedule: true });
  assert.equal(done.pending, false, done.submission.lastError || '');
  assert.equal((await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).status, 'SUPERSEDED');
});

async function recoveryWipFixture() {
  const f = await fixture('normal');
  const week = chinaWeekRange(new Date());
  const previousStart = new Date(week.start); previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: f.prefix, sourceLineNo: 1, customerName: f.prefix, productName: f.prefix,
    specification: f.prefix, orderQuantity: 40, orderDate: previousStart, customerDueDate: week.end, createdById: f.handler.id, updatedById: f.handler.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: previousStart, weekEndDate: new Date(week.start.getTime() - 86400000), plannedCompletionDate: week.end,
      releaseState: 'active', workOrderId: f.workOrder.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity: 40, reason: '隔离恢复验证', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:enter` });
  const allocation = await scheduleWipLot({ lotId: lot.id, quantity: 40, targetWeekStartDate: week.start, reason: '保留当前安排', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:schedule` });
  return { ...f, week, previousStart, lot, allocation };
}

test('historical WIP confirmation posts only the real past report without moving the remaining future schedule', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await recoveryWipFixture();
  await prisma.semiFinishedLot.update({ where: { id: f.lot.id }, data: { enteredAt: f.previousStart } });
  const command = { ...f.command, workDate: f.previousStart.toISOString().slice(0, 10), processedQty: 10, reportedUnitQty: 10,
    source: { kind: 'WIP' as const, lotId: f.lot.id, allocationId: f.allocation.id } };
  const pending = await submitProcessCompletion(command);
  assert.ok(pending.pending);
  if (!pending.pending) return;
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const option = preview.sourceOptions.find(item => item.allocationId === f.allocation.id)!;
  assert.equal(option.action, 'HISTORICAL_CONFIRMATION');
  const unconfirmed = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview), sourceKey: option.key, sourceVersion: option.version });
  assert.equal(unconfirmed.pending, true);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  const current = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(current), sourceKey: option.key, sourceVersion: option.version, confirmHistoricalWork: true });
  assert.equal(done.pending, false, done.submission.lastError || '');
  const allocation = await prisma.wipWeekAllocation.findUniqueOrThrow({ where: { id: f.allocation.id } });
  assert.equal(allocation.targetWeekStartDate.toISOString().slice(0, 10), f.week.start.toISOString().slice(0, 10));
  assert.equal(allocation.quantity, 40);
  assert.equal(allocation.completedQty, 10);
  assert.equal(await prisma.wipWeekAllocation.count({ where: { lotId: f.lot.id } }), 1);
  const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: done.submission.completionId! }, include: { laborPool: true, wipCredits: true } });
  assert.equal(completion.workDate.toISOString().slice(0, 10), command.workDate);
  assert.equal(completion.wipCredits[0].workDate.toISOString().slice(0, 10), command.workDate);
  assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 150000n);
  assert.equal(completion.createdById, f.reporter.id);
  assert.equal(await prisma.operationLog.count({ where: { targetId: pending.submission.id, action: 'confirm_historical_wip_report' } }), 1);
  assert.equal((await submitProcessCompletion(command)).pending, false);
});

test('product-to-action changes require explicit real action counts and never multiply old product quantities', { skip: !enabled, timeout: 120000 }, async () => {
  const f = await recoveryWipFixture();
  await prisma.wipWeekAllocation.update({ where: { id: f.allocation.id }, data: { targetWeekStartDate: f.previousStart, targetWeekEndDate: new Date(f.week.start.getTime() - 86400000) } });
  const pending = await submitProcessCompletion({ ...f.command, source: { kind: 'WIP', lotId: f.lot.id, allocationId: f.allocation.id } });
  assert.ok(pending.pending);
  if (!pending.pending) return;
  await prisma.productProcessTimeEntry.update({ where: { id: f.profile.entries[0].id }, data: {
    occurrences: 3, actionMilliseconds: 5000, unitMilliseconds: 15000, reportQuantityBasis: 'action', reportUnitLabel: '个' } });
  await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: {
    reportQuantityBasis: 'action', reportUnitLabel: '个', unitsPerProduct: 3, standardMillisecondsPerUnit: 5000 } });
  const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  assert.equal(preview.quantityMappingRequired, true);
  const option = preview.sourceOptions.find(item => item.allocationId === f.allocation.id)!;
  const absent = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(preview),
    sourceKey: option.key, sourceVersion: option.version, confirmQuantityMapping: true, processedQty: 40 });
  assert.equal(absent.pending, true);
  assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
  const current = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
  const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, { ...confirmation(current), sourceKey: option.key,
    sourceVersion: option.version, confirmQuantityMapping: true, processedQty: 40, reportedUnitQty: 120, reportedDefectUnitQty: 0 });
  assert.equal(done.pending, false, done.submission.lastError || '');
  const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: done.submission.completionId! }, include: { laborPool: true } });
  assert.equal(completion.processedQty, 40);
  assert.equal(completion.reportedUnitQty, 120);
  assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 600000n);
  const saved = await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: pending.submission.id } });
  assert.equal((saved.payload as { reportedUnitQty: number }).reportedUnitQty, 40, 'original payload is retained, mapping is separately audited');
});
