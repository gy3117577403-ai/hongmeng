import { deleteTestCompletions } from './helpers/delete-test-completions';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { prisma } from '../lib/prisma';
import { chinaTodayDateKey } from '../lib/attendance';
import { chinaWeekRange } from '../lib/production-planning';
import { submitProcessCompletion, previewProcessReportSubmission, resolveProcessReportSubmission } from '../lib/process-report-submissions';
import { enterWipWarehouse, scheduleWipLot } from '../lib/wip-warehouse';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const ownedFixtures: Array<{ workOrderId: string; itemId: string; definitionId: string; employeeId: string; userIds: string[] }> = [];
const scope = { level: 'GLOBAL' as const, canRead: true, canWrite: true, canReconcile: true, readOnly: false, teamKeys: [] };
async function fixture(kind: 'mismatch' | 'missing' | 'normal') {
  const prefix = `IT-COMPOUND-${Date.now()}-${randomUUID().slice(0, 6)}`;
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

async function oldWeekWip(f: Awaited<ReturnType<typeof fixture>>, quantity = 40) {
  const week = chinaWeekRange(new Date());
  const previousStart = new Date(week.start); previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  const previousEnd = new Date(week.end); previousEnd.setUTCDate(previousEnd.getUTCDate() - 7);
  const plan = await prisma.productionPlanOrder.create({ data: { sourceOrderNo: f.prefix, sourceLineNo: 1,
    customerName: f.prefix, productName: f.prefix, specification: f.prefix, orderQuantity: 40,
    orderDate: previousStart, customerDueDate: week.end, createdById: f.handler.id, updatedById: f.handler.id,
    batches: { create: { batchNo: 1, quantity: 40, weekStartDate: previousStart, weekEndDate: previousEnd,
      plannedCompletionDate: previousEnd, releaseState: 'active', workOrderId: f.workOrder.id } } }, include: { batches: true } });
  const lot = await enterWipWarehouse({ batchId: plan.batches[0].id, quantity, reason: '隔离复合异常验收', actorId: f.handler.id,
    actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:enter` });
  const allocation = await scheduleWipLot({ lotId: lot.id, quantity, targetWeekStartDate: week.start, reason: '隔离续作安排',
    actorId: f.handler.id, actorName: '测试负责人', productionScope: scope, idempotencyKey: `${f.prefix}:schedule` });
  await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: { targetWeekStartDate: previousStart, targetWeekEndDate: previousEnd } });
  return { lot, allocation };
}

for (const firstReason of ['STANDARD_MISMATCH', 'WIP_WEEK_CONFIRMATION'] as const) test(
  `one receipt atomically resolves contract and old-week WIP when first failure is ${firstReason}`,
  { skip: !enabled, timeout: 120000 }, async () => {
    const f = await fixture('mismatch');
    const { lot, allocation } = await oldWeekWip(f);
    const command = { ...f.command, source: { kind: 'WIP' as const, lotId: lot.id,
      ...(firstReason === 'STANDARD_MISMATCH' ? { allocationId: allocation.id } : {}) } };
    const pending = await submitProcessCompletion(command);
    assert.ok(pending.pending);
    if (!pending.pending) return;
    assert.equal(pending.submission.reasonCode, firstReason);
    const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
    assert.equal(preview.quantityMappingRequired, true);
    assert.ok(preview.actions.some(action => action.code === 'REPAIR_STANDARD'));
    assert.ok(preview.actions.some(action => action.code === 'CONFIRM_SOURCE'));
    const option = preview.sourceOptions.find(option => option.allocationId === allocation.id)!;
    assert.equal(option.action, 'RESCHEDULE_REMAINING');

    // An incomplete confirmation must roll back both the repair and any WIP arrangement.
    const invalid = await resolveProcessReportSubmission(pending.submission.id, f.handler.id,
      { ...confirmation(preview), confirmQuantityMapping: true, processedQty: 40, defectQty: 0 });
    assert.equal(invalid.pending, true);
    assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 0);
    assert.equal((await prisma.workOrderProcessStep.findUniqueOrThrow({ where: { id: f.step.id } })).reportQuantityBasis, 'action');
    assert.equal(await prisma.wipWeekAllocation.count({ where: { sourceAllocationId: allocation.id } }), 0);

    const refreshed = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
    const done = await resolveProcessReportSubmission(pending.submission.id, f.handler.id, {
      ...confirmation(refreshed), confirmQuantityMapping: true, processedQty: 40, defectQty: 0,
      sourceKey: option.key, sourceVersion: option.version,
    });
    assert.equal(done.pending, false, done.submission.lastError || 'compound report stayed pending');
    assert.equal(done.submission.id, pending.submission.id);
    assert.equal(done.submission.status, 'COMPLETED');
    assert.equal(await prisma.processReportSubmission.count({ where: { stepId: f.step.id } }), 1);
    const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: done.submission.completionId! }, include: { laborPool: { include: { claims: true } } } });
    assert.equal(completion.createdById, f.reporter.id);
    assert.equal(completion.processedQty, 40);
    assert.equal(completion.reportQuantityBasis, 'product');
    assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 600000n);
    assert.equal(completion.laborPool?.remainingStandardLaborMilliseconds, 0n);
    assert.deepEqual(completion.laborPool?.claims.map(claim => claim.employeeId), [f.employee.id]);
    assert.equal(await prisma.processWipCredit.count({ where: { completionId: completion.id } }), 1);
    assert.equal((await prisma.wipWeekAllocation.findFirstOrThrow({ where: { sourceAllocationId: allocation.id } })).completedQty, 40);
    assert.equal((await submitProcessCompletion(command)).pending, false);
    assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  });

test('other pending WIP reservations cannot be reclassified as native quantity in compound preview',
  { skip: !enabled, timeout: 120000 }, async () => {
    const f = await fixture('normal');
    const { lot, allocation } = await oldWeekWip(f, 30);
    const reserved = await submitProcessCompletion({ ...f.command, processedQty: 10, reportedUnitQty: 10,
      source: { kind: 'WIP', lotId: lot.id, allocationId: allocation.id } });
    assert.ok(reserved.pending);
    if (!reserved.pending) return;
    assert.equal((await prisma.processReportSubmission.findUniqueOrThrow({ where: { id: reserved.submission.id } })).reservedProductQty, 10);
    await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: { reportQuantityBasis: 'action', reportUnitLabel: '个' } });
    const pending = await submitProcessCompletion({ ...f.command, idempotencyKey: `${f.prefix}:second`, processedQty: 0, reportedUnitQty: 15 });
    assert.ok(pending.pending);
    if (!pending.pending) return;
    const preview = await previewProcessReportSubmission(pending.submission.id, f.handler.id);
    assert.equal(preview.submission.reasonCode, 'STANDARD_MISMATCH');
    assert.ok(preview.actions.some(action => action.code === 'CONFIRM_SOURCE'), '30 WIP including 10 reserved leaves only 10 native, not 20');
    assert.equal(preview.sourceOptions.find(option => option.allocationId === allocation.id)?.remainingQty, 20);
  });

test('zero-set action work keeps WIP source identity for duplicate receipts without inventing material credits',
  { skip: !enabled, timeout: 120000 }, async () => {
    const f = await fixture('normal');
    await prisma.productProcessTimeEntry.update({ where: { id: f.profile.entries[0].id }, data: {
      occurrences: 3, actionMilliseconds: 5000, unitMilliseconds: 15000, reportQuantityBasis: 'action', reportUnitLabel: '个' } });
    await prisma.workOrderProcessStep.update({ where: { id: f.step.id }, data: {
      reportQuantityBasis: 'action', reportUnitLabel: '个', unitsPerProduct: 3, standardMillisecondsPerUnit: 5000 } });
    const { lot, allocation } = await oldWeekWip(f);
    const week = chinaWeekRange(new Date());
    await prisma.wipWeekAllocation.update({ where: { id: allocation.id }, data: { targetWeekStartDate: week.start, targetWeekEndDate: week.end } });
    const command = { ...f.command, processedQty: 0, reportedUnitQty: 40,
      source: { kind: 'WIP' as const, lotId: lot.id, allocationId: allocation.id } };
    const done = await submitProcessCompletion(command);
    assert.equal(done.pending, false, done.pending ? done.submission.lastError || '' : '');
    if (done.pending) return;
    const completion = await prisma.processCompletion.findUniqueOrThrow({ where: { id: done.data.completionId }, include: { laborPool: true } });
    assert.equal(completion.processedQty, 0);
    assert.equal(completion.reportingWipAllocationId, allocation.id);
    assert.equal(completion.laborPool?.claimedStandardLaborMilliseconds, 200000n);
    assert.equal(await prisma.processWipCredit.count({ where: { completionId: completion.id } }), 0);
    const replay = await submitProcessCompletion(command);
    assert.equal(replay.pending, false);
    assert.equal(await prisma.processCompletion.count({ where: { stepId: f.step.id } }), 1);
  });

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
