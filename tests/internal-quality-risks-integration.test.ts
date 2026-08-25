import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  acknowledgeWorkOrderQualityAlert,
  archiveInternalQualityRisk,
  confirmProductRiskForWorkOrder,
  createInternalQualityRiskRecord,
  loadInternalQualityRisk,
  loadWorkOrderQualityAlerts,
  parseInternalQualityRiskInput,
  permanentlyDeleteInternalQualityRisk,
  restoreInternalQualityRisk,
  softDeleteInternalQualityRisk,
  startInternalQualityRiskRevision,
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
  const actorInput = { id: actor.id, name: actor.displayName };
  let reportId = '';

  const riskInput = (workOrderIds = [workOrders[0].id], rootCause = '设备换型后压接高度参数未受控') => parseInternalQualityRiskInput({
    reportNo: `${prefix}-IQR-001`,
    title: '压接拉脱力内部重大异常',
    severity: 'CRITICAL',
    occurrenceDate: '2026-08-26',
    workshopArea: '压接车间 A 区',
    processName: '端子压接',
    responsibleDepartment: '质量部 / 制造部',
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
    issueIds: [issue.id],
    workOrderIds,
    productIds: [product.id],
    eightDReportIds: [],
  });

  try {
    const created = await prisma.$transaction(tx => createInternalQualityRiskRecord(tx, riskInput(), actorInput));
    reportId = created.id;
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.issues.length, 1);
    assert.equal(created.workOrders.length, 1);
    assert.equal(created.products.length, 1);

    const archivedR1 = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, reportId, created.version, actorInput));
    assert.equal(archivedR1.status, 'ARCHIVED');
    assert.equal(archivedR1.revisions.length, 1);
    assert.equal(archivedR1.currentRevision?.revisionNumber, 1);
    assert.equal(archivedR1.alerts.filter(alert => alert.state === 'ACTIVE').length, 1);

    const firstOrderWarnings = await loadWorkOrderQualityAlerts(workOrders[0].id);
    assert.equal(firstOrderWarnings.alerts.length, 1);
    assert.equal(firstOrderWarnings.alerts[0].rootCause, '设备换型后压接高度参数未受控');
    assert.match(firstOrderWarnings.alerts[0].controlRequirement || '', /临时遏制/);

    const secondOrderBeforeConfirm = await loadWorkOrderQualityAlerts(workOrders[1].id);
    assert.equal(secondOrderBeforeConfirm.alerts.length, 0);
    assert.equal(secondOrderBeforeConfirm.suggestions.length, 1);
    await prisma.$transaction(tx => confirmProductRiskForWorkOrder(
      tx,
      workOrders[1].id,
      reportId,
      archivedR1.version,
      actorInput,
    ));
    const secondOrderAfterConfirm = await loadWorkOrderQualityAlerts(workOrders[1].id);
    assert.equal(secondOrderAfterConfirm.alerts.length, 1);
    assert.equal(secondOrderAfterConfirm.alerts[0].source, 'PRODUCT_SUGGESTION_CONFIRMED');
    const afterProductConfirmation = await loadInternalQualityRisk(reportId);

    const firstAlertId = firstOrderWarnings.alerts[0].id;
    const acknowledged = await prisma.$transaction(tx => acknowledgeWorkOrderQualityAlert(
      tx,
      workOrders[0].id,
      firstAlertId,
      '班组已完成风险交底',
      actorInput,
    ));
    assert.equal(acknowledged.state, 'ACKNOWLEDGED');
    assert.equal(acknowledged.acknowledgements.length, 1);

    const revising = await prisma.$transaction(tx => startInternalQualityRiskRevision(tx, reportId, afterProductConfirmation.version, actorInput));
    assert.equal(revising.status, 'REVISING');
    assert.equal(revising.alerts.filter(alert => alert.state === 'ACTIVE' || alert.state === 'ACKNOWLEDGED').length, 2);

    const updated = await prisma.$transaction(tx => updateInternalQualityRiskRecord(
      tx,
      reportId,
      riskInput(workOrders.map(item => item.id), '设备配方权限与换型首件门禁同时缺失'),
      revising.version,
      actorInput,
    ));
    const confirmedLink = updated.workOrders.find(link => link.workOrderId === workOrders[1].id);
    assert.equal(confirmedLink?.source, 'PRODUCT_CONFIRMATION');

    const archivedR2 = await prisma.$transaction(tx => archiveInternalQualityRisk(tx, reportId, updated.version, actorInput));
    assert.equal(archivedR2.currentRevision?.revisionNumber, 2);
    assert.equal(archivedR2.revisions.length, 2);
    assert.equal(archivedR2.alerts.filter(alert => alert.state === 'SUPERSEDED').length, 2);
    assert.equal(archivedR2.alerts.filter(alert => alert.state === 'ACTIVE').length, 2);
    const r1Snapshot = archivedR2.revisions.find(revision => revision.revisionNumber === 1)?.snapshot as { rootCause?: string };
    assert.equal(r1Snapshot.rootCause, '设备换型后压接高度参数未受控');

    await prisma.$transaction(tx => softDeleteInternalQualityRisk(
      tx,
      reportId,
      archivedR2.version,
      '集成测试验证回收站撤销预警',
      actorInput,
    ));
    const deleted = await loadInternalQualityRisk(reportId, true);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.alerts.filter(alert => alert.state === 'REVOKED').length, 2);
    assert.equal((await loadWorkOrderQualityAlerts(workOrders[0].id)).alerts.length, 0);

    const restored = await prisma.$transaction(tx => restoreInternalQualityRisk(tx, reportId, deleted.version, actorInput));
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.alerts.filter(alert => alert.state === 'ACTIVE').length, 2);
    assert.equal((await loadWorkOrderQualityAlerts(workOrders[0].id)).alerts.length, 1);

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
    const purged = await prisma.$transaction(tx => permanentlyDeleteInternalQualityRisk(tx, reportId, `${prefix}-IQR-001`));
    assert.equal(purged.reportNo, `${prefix}-IQR-001`);
    assert.equal(await prisma.internalQualityRiskReport.count({ where: { id: reportId } }), 0);
    reportId = '';
  } finally {
    if (reportId) await prisma.internalQualityRiskReport.deleteMany({ where: { id: reportId } });
    await prisma.issue.deleteMany({ where: { id: issue.id } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrders.map(item => item.id) } } });
    await prisma.drawingLibraryItem.deleteMany({ where: { id: product.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.deleteMany({ where: { id: actor.id } });
  }
});
