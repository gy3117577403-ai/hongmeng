import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { createInternalQualityRiskRecord, parseInternalQualityRiskInput, transitionInternalQualityRiskWorkflow, updateInternalQualityRiskTask, archiveInternalQualityRisk, softDeleteInternalQualityRisk, permanentlyDeleteInternalQualityRisk, revokeInternalQualityRiskWarning } from '../lib/internal-quality-risks';
import { qualityWarningEmployeePath, loadEmployeeQualityWarning } from '../lib/quality-warning-employee';
import { startInternalQualityRiskRevision, materializeProductQualityWarningsForWorkOrders } from '../lib/internal-quality-risks';

test('quality v2 real assignment, review authorization, employee credential scoping, and safe purge', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async () => {
  process.env.SESSION_SECRET ||= 'quality-v2-isolated-integration-test-only';
  const prefix = `quality-v2-${randomUUID().slice(0, 8)}`;
  const users = await Promise.all(['quality', 'owner', 'other'].map(name => prisma.user.create({ data: { username: `${prefix}-${name}`, displayName: name, passwordHash: 'test-only' } })));
  const [quality, owner, other] = users;
  const actor = { id: quality.id, name: 'quality', canVerify: true, canManage: true };
  const handler = { id: owner.id, name: 'owner' };
  const product = await prisma.drawingLibraryItem.create({ data: { customerName: prefix, customerCode: prefix, productName: '验证产品', specification: prefix, libraryKey: prefix } });
  const order = await prisma.workOrder.create({ data: { code: `${prefix}-WO`, productName: '验证产品', stage: 'frontend', drawingLibraryItemId: product.id } });
  const ids: string[] = [];
  try {
    let report = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, parseInternalQualityRiskInput({ title: '真实异常事件', productIds: [product.id], ownerUserId: owner.id }), actor)); ids.push(report.id);
    await assert.rejects(prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'SUBMITTED', actor)), /实际问题/);
    await prisma.internalQualityRiskReport.update({ where: { id: report.id }, data: { defectPhenomenon: '测量发现压接尺寸偏高', correctiveAction: '停机复核参数，重新调机并验证首件', finalConclusion: '复检通过，按确认方案执行' } });
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'SUBMITTED', actor));
    assert.equal(report.tasks.length, 1); assert.equal(report.tasks[0].ownerUserId, owner.id); assert.equal(report.tasks[0].isPrimary, true);
    const taskId = report.tasks[0].id;
    await assert.rejects(prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, taskId, { expectedVersion: 0, status: 'IN_PROGRESS' }, { id: other.id, name: 'other' })), /自己/);
    report = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, taskId, { expectedVersion: 0, status: 'IN_PROGRESS' }, handler));
    report = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, taskId, { expectedVersion: 1, status: 'COMPLETED', result: '参数已复核并完成首件确认' }, handler));
    await assert.rejects(prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, taskId, { expectedVersion: 2, status: 'VERIFIED', reason: '我自行通过' }, handler)), /质量/);
    report = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, report.id, taskId, { expectedVersion: 2, status: 'VERIFIED', reason: '质量复核尺寸和记录均符合要求' }, actor));
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'VERIFYING', handler));
    await assert.rejects(prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'PENDING_CLOSE', handler, '自行归档')), /质量/);
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'PENDING_CLOSE', actor, '质量验证方案有效'));
    const attachment = await prisma.internalQualityRiskAttachment.create({ data: { reportId: report.id, originalName: 'evidence.png', displayName: '已确认异常照片', mimeType: 'image/png', fileSize: 100, objectKey: `quality-risks/${report.id}/test.png`, sha256: 'a'.repeat(64), category: 'SOLUTION', caption: '原版本说明' } });
    report = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, report.id, report.version, actor));
    assert.equal(report.alerts.length, 1); assert.equal(report.alerts[0].workOrderId, order.id);
    const path = await qualityWarningEmployeePath(report.currentRevisionId!, order.id); assert.ok(path);
    const token = path!.split('/').pop()!;
    const view = await loadEmployeeQualityWarning(token); assert.ok(view); assert.equal(view!.view.attachments.length, 1); assert.equal(view!.view.correctiveAction, report.correctiveAction);
    assert.equal(await loadEmployeeQualityWarning(`${token}wrong`), null);
    assert.equal('tasks' in view!.view, false); assert.equal('ownerUserId' in view!.view, false); assert.equal('objectKey' in view!.view.attachments[0], false);
    await prisma.internalQualityRiskAttachment.update({ where: { id: attachment.id }, data: { caption: '修订时修改的说明' } });
    assert.equal((await loadEmployeeQualityWarning(token))!.view.attachments[0].caption, '原版本说明');
    const originalSolution = report.correctiveAction;
    report = await prisma.$transaction(tx => startInternalQualityRiskRevision(tx, report.id, report.version, actor));
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'COLLABORATING', actor));
    const future = await prisma.workOrder.create({ data: { code: `${prefix}-FUTURE`, productName: '新批次', stage: 'frontend', drawingLibraryItemId: product.id } });
    try {
      assert.equal(await materializeProductQualityWarningsForWorkOrders([future.id]), 1, 'old published warning still applies while a revision is collaborating');
      assert.equal(await materializeProductQualityWarningsForWorkOrders([future.id]), 0, 'projection is idempotent');
    } finally {
      await prisma.workOrderQualityAlert.deleteMany({ where: { workOrderId: future.id } });
      await prisma.internalQualityRiskWorkOrder.deleteMany({ where: { workOrderId: future.id } });
      await prisma.workOrder.delete({ where: { id: future.id } });
    }
    await prisma.internalQualityRiskReport.update({ where: { id: report.id }, data: { correctiveAction: 'R2 新版处理方案，不得覆盖旧纸质指令' } });
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'VERIFYING', handler));
    report = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, report.id, report.version, 'PENDING_CLOSE', actor, '复核新版方案有效'));
    report = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, report.id, report.version, actor));
    const oldView = await loadEmployeeQualityWarning(token);
    assert.equal(oldView!.view.revisionNumber, 1); assert.equal(oldView!.view.currentRevisionNumber, 2);
    assert.equal(oldView!.view.correctiveAction, originalSolution);
    report = await prisma.$transaction(tx => revokeInternalQualityRiskWarning(tx, report.id, report.version, '更新后撤销旧指引', actor));
    assert.equal(await loadEmployeeQualityWarning(token), null);
    await prisma.$transaction(tx => softDeleteInternalQualityRisk(tx, report.id, report.version, '退出业务列表但保留历史', actor));
    await assert.rejects(prisma.$transaction(tx => permanentlyDeleteInternalQualityRisk(tx, report.id, report.reportNo, actor, '尝试删除')), /历史/);
    let draft = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, parseInternalQualityRiskInput({ title: '误建草稿' }), actor)); ids.push(draft.id);
    await prisma.internalQualityRiskAttachment.create({ data: { reportId: draft.id, originalName: 'draft.png', displayName: '草稿图', mimeType: 'image/png', fileSize: 1, objectKey: `quality-risks/${draft.id}/draft.png`, sha256: 'b'.repeat(64) } });
    await prisma.$transaction(tx => softDeleteInternalQualityRisk(tx, draft.id, draft.version, '重复创建', actor));
    await prisma.$transaction(tx => permanentlyDeleteInternalQualityRisk(tx, draft.id, draft.reportNo, actor, '确认误建立即删除'));
    assert.equal(await prisma.internalQualityRiskReport.count({ where: { id: draft.id } }), 0);
    assert.equal(await prisma.qualityRiskObjectCleanup.count({ where: { reportId: draft.id } }), 1);
    assert.equal(await prisma.operationLog.count({ where: { action: 'purge_internal_quality_risk', targetId: draft.id } }), 1);
    let archiveOnly = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, parseInternalQualityRiskInput({ title: '仅留档不发布', productIds: [product.id], defectPhenomenon: '重复记录同一批次测量偏差', finalConclusion: '已核实为重复记录，仅留存说明，不产生现场作业指令。' }), actor)); ids.push(archiveOnly.id);
    await prisma.internalQualityRiskReport.update({ where: { id: archiveOnly.id }, data: { status: 'PENDING_CLOSE' } });
    await assert.rejects(prisma.$transaction(tx => archiveInternalQualityRisk(tx, archiveOnly.id, archiveOnly.version, actor, true)));
    archiveOnly = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, archiveOnly.id, archiveOnly.version, actor, false));
    assert.equal(archiveOnly.currentRevision!.published, false); assert.equal(archiveOnly.alerts.length, 0);
    assert.equal(await qualityWarningEmployeePath(archiveOnly.currentRevisionId!, order.id), null);
  } finally {
    await prisma.qualityWarningEmployeeLink.deleteMany({ where: { revision: { reportId: { in: ids } } } });
    await prisma.internalQualityRiskReport.deleteMany({ where: { id: { in: ids } } });
    await prisma.qualityRiskObjectCleanup.deleteMany({ where: { reportId: { in: ids } } });
    await prisma.workOrder.delete({ where: { id: order.id } }); await prisma.drawingLibraryItem.delete({ where: { id: product.id } });
    await prisma.systemNotification.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.operationLog.deleteMany({ where: { userId: { in: users.map(user => user.id) } } }); await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
