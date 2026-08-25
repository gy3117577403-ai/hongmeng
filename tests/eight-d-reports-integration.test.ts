import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  addEightDReportVersionRecord,
  createEightDReportRecord,
  restoreEightDReport,
  restoreEightDReportVersion,
  setCurrentEightDReportVersion,
  softDeleteEightDReport,
  softDeleteEightDReportVersion,
  updateEightDReportRecord,
} from '../lib/eight-d-reports';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('8D archive persists product/problem many-to-many links and immutable PDF history', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `eight-d-it-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({
    data: { username: `${prefix}-user`, passwordHash: 'integration-test-only', displayName: '8D Integration' },
  });
  const products = await Promise.all([1, 2].map(index => prisma.drawingLibraryItem.create({
    data: {
      customerName: `集成客户${index}`,
      customerCode: `${prefix}-C${index}`,
      productName: `集成产品${index}`,
      specification: `${prefix}-SPEC-${index}`,
      libraryKey: `${prefix}-LIB-${index}`,
    },
  })));
  const issues = await Promise.all([1, 2].map(index => prisma.issue.create({
    data: {
      title: `${prefix}-质量问题-${index}`,
      type: 'quality',
      priority: index === 1 ? 'urgent' : 'normal',
      reporterId: actor.id,
    },
  })));
  let reportId = '';

  try {
    const actorInput = { id: actor.id, name: actor.displayName };
    const created = await prisma.$transaction(tx => createEightDReportRecord(tx, {
      id: randomUUID(),
      actor: actorInput,
      metadata: {
        reportNo: `${prefix}-R001`,
        title: '端子压接异常8D报告',
        reportDate: new Date('2026-08-26T00:00:00.000+08:00'),
        responsibleDepartment: '质量部',
        keywords: '压接 客诉',
        status: 'active',
        productIds: products.map(item => item.id),
        issueIds: issues.map(item => item.id),
      },
      file: {
        id: randomUUID(),
        originalName: '8D-V1.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        sha256: 'a'.repeat(64),
        objectKey: `integration/${prefix}/v1.pdf`,
      },
    }));
    reportId = created.id;
    assert.equal(created.products.length, 2);
    assert.equal(created.issues.length, 2);
    assert.equal(created.versions.length, 1);
    assert.equal(created.currentVersion?.versionNumber, 1);
    assert.equal(created.version, 0);

    const updated = await prisma.$transaction(tx => updateEightDReportRecord(tx, created.id, {
      reportNo: created.reportNo,
      title: '端子压接异常8D报告（更新）',
      reportDate: created.reportDate,
      responsibleDepartment: '质量与制造联合小组',
      keywords: '压接 客诉 更新',
      status: 'active',
      productIds: [products[1].id],
      issueIds: issues.map(item => item.id),
    }, created.version, actorInput));
    assert.equal(updated.products.length, 1);
    assert.equal(updated.issues.length, 2);
    assert.equal(updated.version, 1);

    const v2 = await prisma.$transaction(tx => addEightDReportVersionRecord(tx, created.id, {
      id: randomUUID(),
      originalName: '8D-V2.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      sha256: 'b'.repeat(64),
      objectKey: `integration/${prefix}/v2.pdf`,
      note: '客户确认版',
    }, updated.version, actorInput));
    const firstVersion = v2.versions.find(item => item.versionNumber === 1)!;
    const secondVersion = v2.versions.find(item => item.versionNumber === 2)!;
    assert.equal(v2.currentVersionId, secondVersion.id);
    assert.equal(v2.version, 2);

    const switched = await prisma.$transaction(tx => setCurrentEightDReportVersion(
      tx, created.id, firstVersion.id, v2.version, actorInput,
    ));
    assert.equal(switched.currentVersionId, firstVersion.id);

    const deletedVersion = await prisma.$transaction(tx => softDeleteEightDReportVersion(
      tx, created.id, firstVersion.id, switched.version, actorInput,
    ));
    assert.equal(deletedVersion.currentVersionId, secondVersion.id);
    assert.ok(deletedVersion.versions.find(item => item.id === firstVersion.id)?.deletedAt);

    const restoredVersion = await prisma.$transaction(tx => restoreEightDReportVersion(
      tx, created.id, firstVersion.id, deletedVersion.version, actorInput,
    ));
    assert.equal(restoredVersion.versions.filter(item => !item.deletedAt).length, 2);

    await prisma.$transaction(tx => softDeleteEightDReport(
      tx, created.id, restoredVersion.version, '集成测试软删除', actorInput,
    ));
    const deleted = await prisma.eightDReport.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(deleted.deletedAt);

    const restored = await prisma.$transaction(tx => restoreEightDReport(
      tx, created.id, deleted.version, actorInput,
    ));
    assert.equal(restored.deletedAt, null);
    assert.ok(restored.activities.some(item => item.action === 'restored'));
  } finally {
    if (reportId) await prisma.eightDReport.deleteMany({ where: { id: reportId } });
    await prisma.issue.deleteMany({ where: { id: { in: issues.map(item => item.id) } } });
    await prisma.drawingLibraryItem.deleteMany({ where: { id: { in: products.map(item => item.id) } } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
