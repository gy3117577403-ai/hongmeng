import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  acknowledgeWorkOrderQualityAlert,
  archiveInternalQualityRisk,
  createInternalQualityRiskTask,
  createInternalQualityRiskRecord,
  loadInternalQualityRisk,
  loadWorkOrderQualityAlerts,
  parseInternalQualityRiskInput,
  permanentlyDeleteInternalQualityRisk,
  revokeInternalQualityRiskWarning,
  restoreInternalQualityRisk,
  softDeleteInternalQualityRisk,
  startInternalQualityRiskRevision,
  transitionInternalQualityRiskWorkflow,
  updateInternalQualityRiskTask,
  updateInternalQualityRiskRecord,
} from '../lib/internal-quality-risks';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('internal quality risk archives immutable revisions and synchronizes recoverable work-order warnings', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `quality-risk-it-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({
    data: { username: `${prefix}-admin`, passwordHash: 'integration-test-only', displayName: '质量集成管理员', laborRole: 'ADMIN' },
  });
  const product = await prisma.drawingLibraryItem.create({
    data: {
      customerName: '集成测试客户',
      customerCode: `${prefix}-customer`,
      productName: '集成测试线束',
      specification: `${prefix}-product`,
      libraryKey: `${prefix}-library`,
    },
  });
  const replacementProduct = await prisma.drawingLibraryItem.create({
    data: {
      customerName: '集成测试客户',
      customerCode: `${prefix}-replacement-customer`,
      productName: '修订后适用线束',
      specification: `${prefix}-replacement-product`,
      libraryKey: `${prefix}-replacement-library`,
    },
  });
  const workOrders = await Promise.all([1, 2].map(index => prisma.workOrder.create({
    data: {
      code: `${prefix}-WO-${index}`,
      businessCode: `${prefix}-BIZ-${index}`,
      customerName: '集成测试客户',
      productName: '集成测试线束',
      specification: product.specification,
      stage: 'frontend',
      drawingLibraryItemId: product.id,
    },
  })));
  const issue = await prisma.issue.create({
    data: {
      title: `${prefix}-压接拉脱力异常`,
      type: 'quality',
      priority: 'urgent',
      reporterId: actor.id,
      workOrderId: workOrders[0].id,
      rootCause: '换型参数未锁定',
      solution: '锁定参数并补充首件确认',
      verificationResult: '连续三批拉脱力合格',
    },
  });
  const actorInput = { id: actor.id, name: actor.displayName, canVerify: true, canManage: true };
  let reportId = '';

  const riskInput = ({
    workOrderIds = [workOrders[0].id],
    productIds = [product.id],
    rootCause = '设备换型后压接高度参数未受控',
    warningSummary = '该产品曾发生端子压接高度超差，作业前必须核验参数与首件',
  }: {
    workOrderIds?: string[];
    productIds?: string[];
    rootCause?: string;
    warningSummary?: string;
  } = {}) => parseInternalQualityRiskInput({
    reportNo: `${prefix}-IQR-001`,
    title: '压接拉脱力内部重大异常',
    severity: 'CRITICAL',
    occurrenceDate: '2026-08-26',
    workshopArea: '压接车间 A 区',
    processName: '端子压接',
    responsibleDepartment: '质量部 / 制造部',
    ownerUserId: actor.id,
    defectPhenomenon: '抽检发现端子压接后拉脱力低于标准下限',
    occurrenceCause: '换型参数调用错误',
    escapeCause: '首件记录未包含拉脱力实测值',
    systemCause: '参数权限和首件检查项未形成联锁',
    rootCause,
    secondaryCause: '班次交接未复核设备参数',
    containmentAction: '隔离同批在制品并执行百分百拉力复检',
    disposition: '不合格品返工后复检',
    correctiveAction: '锁定设备配方并增加换型双人复核',
    preventiveAction: '将拉脱力实测值纳入首件放行门禁',
    verificationResult: '连续三批各抽检 30 件，结果全部合格',
    finalConclusion: '纠正措施有效，按现场控制要求恢复正常生产',
    evidenceSummary: '拉脱力记录、返工复检清单和参数截图已经质量复核',
    riskScope: '同产品、同端子和同压接设备',
    applicableProcess: '端子压接首件、巡检和换型确认',
    effectiveFrom: '2026-08-26',
    warningSummary,
    requiredAction: '首件确认后方可生产；每小时抽检 5 件并记录',
    inspectionMethod: '使用数显千分尺测量压接高度，并核对拉脱力',
    inspectionFrequency: '首件 + 每小时 5 件',
    acceptanceCriteria: '压接高度 1.80±0.05mm，拉脱力不低于图纸要求',
    stopConditions: '出现 1 件不合格立即停线、隔离并通知质量部',
    escalationContact: '质量部 张伟',
    printPolicy: 'REQUIRED',
    issueIds: [issue.id],
    workOrderIds,
    productIds,
    eightDReportIds: [],
  });

  try {
    const created = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, riskInput(), actorInput));
    reportId = created.id;
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.issues.length, 1);
    assert.equal(created.workOrders.length, 1);
    assert.equal(created.products.length, 1);

    await prisma.internalQualityRiskAttachment.create({
      data: {
        reportId,
        category: 'SOLUTION',
        originalName: 'integration-solution.jpg',
        displayName: 'R1 解决方案照片',
        mimeType: 'image/jpeg',
        fileSize: 128,
        objectKey: `integration/${prefix}/solution.jpg`,
        sha256: 'a'.repeat(64),
        uploadedById: actor.id,
      },
    });
    const submitted = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, reportId, created.version, 'SUBMITTED', actorInput));
    const withTask = await prisma.$transaction(tx => createInternalQualityRiskTask(tx, reportId, {
      taskType: 'ACTION',
      title: '锁定压接参数并补充首件门禁',
      department: '制造部',
      ownerName: '制造主管',
      ownerUserId: actor.id,
      requirement: '完成参数锁定并提交验证记录',
    }, actorInput));
    assert.equal(withTask.status, 'COLLABORATING');
    let taskVerified = withTask;
    for (const task of withTask.tasks) {
      taskVerified = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, reportId, task.id, { expectedVersion: 0, status: 'IN_PROGRESS' }, actorInput));
      taskVerified = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, reportId, task.id, { expectedVersion: 1, status: 'COMPLETED', result: '参数锁定完成，连续三批复核通过' }, actorInput));
      taskVerified = await prisma.$transaction(tx => updateInternalQualityRiskTask(tx, reportId, task.id, { expectedVersion: 2, status: 'VERIFIED', reason: '质量复核连续三批数据，确认通过' }, actorInput));
    }
    const verifying = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, reportId, taskVerified.version, 'VERIFYING', actorInput));
    const pendingClose = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, reportId, verifying.version, 'PENDING_CLOSE', actorInput, '质量复核记录与措施有效'));
    assert.ok(submitted.version < pendingClose.version);

    const archivedR1 = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, reportId, pendingClose.version, actorInput));
    assert.equal(archivedR1.status, 'ARCHIVED');
    assert.equal(archivedR1.revisions.length, 1);
    assert.equal(archivedR1.currentRevision?.revisionNumber, 1);
    assert.equal(archivedR1.currentRevision?.products.length, 1);
    assert.equal(archivedR1.currentRevision?.attachments.length, 1);
    assert.equal(archivedR1.alerts.filter(alert => alert.state === 'ACTIVE').length, 2);

    const firstOrderWarnings = await loadWorkOrderQualityAlerts(workOrders[0].id);
    assert.equal(firstOrderWarnings.alerts.length, 1);
    assert.equal(firstOrderWarnings.alerts[0].rootCause, '设备换型后压接高度参数未受控');
    assert.match(firstOrderWarnings.alerts[0].controlRequirement || '', /临时遏制/);

    const secondOrderWarnings = await loadWorkOrderQualityAlerts(workOrders[1].id);
    assert.equal(secondOrderWarnings.alerts.length, 1);
    assert.equal(secondOrderWarnings.alerts[0].source, 'PRODUCT_AUTO_ARCHIVE');
    assert.equal(secondOrderWarnings.alerts[0].printPolicy, 'REQUIRED');

    const firstAlertId = firstOrderWarnings.alerts[0].id;
    const acknowledged = await prisma.$transaction(tx => acknowledgeWorkOrderQualityAlert(
      tx,
      workOrders[0].id,
      firstAlertId,
      '班组已完成风险交底',
      actorInput,
    ));
    assert.equal(acknowledged.state, 'ACTIVE');
    assert.equal(acknowledged.acknowledgements.length, 1);

    const afterAcknowledgement = await loadInternalQualityRisk(reportId);
    const revising = await prisma.$transaction(tx => startInternalQualityRiskRevision(tx, reportId, afterAcknowledgement.version, actorInput));
    assert.equal(revising.status, 'REVISING');
    assert.equal(revising.alerts.filter(alert => alert.state === 'ACTIVE' || alert.state === 'ACKNOWLEDGED').length, 2);

    const updated = await prisma.$transaction(tx => updateInternalQualityRiskRecord(
      tx,
      reportId,
      riskInput({
        workOrderIds: [],
        productIds: [replacementProduct.id],
        rootCause: '设备配方权限与换型首件门禁同时缺失',
        warningSummary: 'R2 修订稿只适用于替代产品，未归档前不得覆盖 R1',
      }),
      revising.version,
      actorInput,
    ));
    const lateR1Order = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO-LATE-R1`,
        businessCode: `${prefix}-BIZ-LATE-R1`,
        customerName: '集成测试客户',
        productName: '集成测试线束',
        specification: product.specification,
        stage: 'frontend',
        drawingLibraryItemId: product.id,
      },
    });
    workOrders.push(lateR1Order);
    const replacementOrder = await prisma.workOrder.create({
      data: {
        code: `${prefix}-WO-R2`,
        businessCode: `${prefix}-BIZ-R2`,
        customerName: '集成测试客户',
        productName: '修订后适用线束',
        specification: replacementProduct.specification,
        stage: 'frontend',
        drawingLibraryItemId: replacementProduct.id,
      },
    });
    workOrders.push(replacementOrder);
    const lateR1Warning = await loadWorkOrderQualityAlerts(lateR1Order.id);
    assert.equal(lateR1Warning.alerts.length, 1);
    assert.equal(lateR1Warning.alerts[0].rootCause, '设备换型后压接高度参数未受控');
    assert.equal((await loadWorkOrderQualityAlerts(replacementOrder.id)).alerts.length, 0);

    const revisionPendingClose = await prisma.$transaction(tx => transitionInternalQualityRiskWorkflow(tx, reportId, updated.version, 'PENDING_CLOSE', actorInput, '修订版已重新验证通过'));
    const archivedR2 = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, reportId, revisionPendingClose.version, actorInput));
    assert.equal(archivedR2.currentRevision?.revisionNumber, 2);
    assert.equal(archivedR2.revisions.length, 2);
    assert.equal(archivedR2.currentRevision?.products[0].drawingLibraryItemId, replacementProduct.id);
    assert.equal(archivedR2.alerts.filter(alert => alert.state === 'SUPERSEDED').length, 3);
    assert.deepEqual(
      archivedR2.alerts.filter(alert => alert.state === 'ACTIVE').map(alert => alert.workOrder.businessCode).sort(),
      [replacementOrder.businessCode],
    );
    const r1Snapshot = archivedR2.revisions.find(revision => revision.revisionNumber === 1)?.snapshot as { rootCause?: string };
    assert.equal(r1Snapshot.rootCause, '设备换型后压接高度参数未受控');
    const replacementWarnings = await loadWorkOrderQualityAlerts(replacementOrder.id);
    assert.equal(replacementWarnings.alerts.length, 1);
    assert.equal(replacementWarnings.alerts[0].rootCause, '设备配方权限与换型首件门禁同时缺失');
    assert.equal((await loadWorkOrderQualityAlerts(lateR1Order.id)).alerts.length, 0);

    const revoked = await prisma.$transaction(tx => revokeInternalQualityRiskWarning(
      tx,
      reportId,
      archivedR2.version,
      '集成测试验证单独撤销活动警示',
      actorInput,
    ));
    await prisma.$transaction(tx => softDeleteInternalQualityRisk(
      tx,
      reportId,
      revoked.version,
      '集成测试验证回收站保留历史',
      actorInput,
    ));
    const deleted = await loadInternalQualityRisk(reportId, true);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.warningState, 'REVOKED');
    assert.equal(deleted.alerts.filter(alert => alert.state === 'REVOKED').length, 1);
    assert.equal((await loadWorkOrderQualityAlerts(workOrders[0].id)).alerts.length, 0);

    const restored = await prisma.$transaction(tx => restoreInternalQualityRisk(tx, reportId, deleted.version, actorInput));
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.warningState, 'REVOKED');
    assert.equal(restored.alerts.filter(alert => alert.state === 'ACTIVE').length, 0);
    assert.equal((await loadWorkOrderQualityAlerts(replacementOrder.id)).alerts.length, 0);

    await prisma.$transaction(tx => softDeleteInternalQualityRisk(
      tx,
      reportId,
      restored.version,
      '集成测试验证三十天永久删除门禁',
      actorInput,
    ));
    await prisma.internalQualityRiskReport.update({
      where: { id: reportId },
      data: { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000) },
    });
    await assert.rejects(prisma.$transaction(tx => permanentlyDeleteInternalQualityRisk(tx, reportId, `${prefix}-IQR-001`, actorInput, '验证历史保留')), /历史/);
    assert.equal(await prisma.internalQualityRiskReport.count({ where: { id: reportId } }), 1);
  } finally {
    if (reportId) await prisma.internalQualityRiskReport.deleteMany({ where: { id: reportId } });
    await prisma.issue.deleteMany({ where: { id: issue.id } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrders.map(item => item.id) } } });
    await prisma.drawingLibraryItem.deleteMany({ where: { id: { in: [product.id, replacementProduct.id] } } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.deleteMany({ where: { id: actor.id } });
  }
});
