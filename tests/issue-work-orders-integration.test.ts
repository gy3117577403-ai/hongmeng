import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import {
  createIssueWorkOrder,
  IssueWorkOrderConflictError,
  loadIssueWorkOrderOptions,
} from '../lib/issue-work-orders';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('issue work order search pages through active and historical work orders and quick create rolls back atomically', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `issue-wo-it-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({
    data: {
      username: `${prefix}-user`,
      passwordHash: 'integration-test-only',
      displayName: 'Issue Work Order Integration',
    },
  });
  try {
    await prisma.workOrder.createMany({
      data: Array.from({ length: 85 }, (_, index) => ({
        code: `${prefix}-WO-${String(index + 1).padStart(3, '0')}`,
        customerName: index % 2 ? '客户乙' : '客户甲',
        productName: `${prefix}-产品`,
        specification: `${prefix}-SPEC-${String(index + 1).padStart(3, '0')}`,
        sourceOrderNo: `${prefix}-SO-${String(index + 1).padStart(3, '0')}`,
        stage: index === 84 ? 'completed' : 'not_issued',
        status: index === 84 ? 'done' : 'pending',
        planActive: index !== 84,
        planClearedAt: index === 84 ? new Date('2026-08-01T00:00:00.000Z') : null,
      })),
    });

    const first = await loadIssueWorkOrderOptions({ keyword: prefix, page: 1, pageSize: 50 });
    const second = await loadIssueWorkOrderOptions({ keyword: prefix, page: 2, pageSize: 50 });
    assert.equal(first.pagination.total, 85);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 35);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 85);
    assert.equal([...first.items, ...second.items].some(item => item.planClearedAt && item.planActive === false), true);

    const exactCode = `${prefix}-WO-085`;
    const exact = await loadIssueWorkOrderOptions({ keyword: exactCode, page: 1, pageSize: 50 });
    assert.equal(exact.items[0]?.code, exactCode);

    const createdCode = `${prefix}-QUICK-CREATE`;
    const created = await prisma.$transaction(tx => createIssueWorkOrder(tx, {
      code: createdCode,
      productName: '待补资料产品',
      customerName: '',
      specification: '',
      sourceOrderNo: '',
      remark: '',
    }, actor.id));
    const persisted = await prisma.workOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: { processRoute: true },
    });
    assert.equal(persisted.drawingLibraryItemId, null);
    assert.equal(persisted.drawingStatus, '待补充');
    assert.equal(persisted.planType, 'manual');
    assert.equal(persisted.processRoute?.routeSource, 'product_time_pending');

    await assert.rejects(
      prisma.$transaction(tx => createIssueWorkOrder(tx, {
        code: createdCode.toLowerCase(),
        productName: '重复产品',
        customerName: '', specification: '', sourceOrderNo: '', remark: '',
      }, actor.id)),
      (error: unknown) => error instanceof IssueWorkOrderConflictError,
    );

    const raceCode = `${prefix}-RACE-CREATE`;
    const concurrent = await Promise.allSettled([
      prisma.$transaction(tx => createIssueWorkOrder(tx, {
        code: raceCode,
        productName: '并发创建产品 A',
        customerName: '', specification: '', sourceOrderNo: '', remark: '',
      }, actor.id)),
      prisma.$transaction(tx => createIssueWorkOrder(tx, {
        code: raceCode.toLowerCase(),
        productName: '并发创建产品 B',
        customerName: '', specification: '', sourceOrderNo: '', remark: '',
      }, actor.id)),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
    assert.equal(await prisma.workOrder.count({
      where: { code: { equals: raceCode, mode: 'insensitive' } },
    }), 1);

    const softDeletedCode = `${prefix}-SOFT-DELETED`;
    await prisma.workOrder.create({
      data: {
        code: softDeletedCode,
        productName: '回收站工单',
        stage: 'not_issued',
        deletedAt: new Date(),
      },
    });
    await assert.rejects(
      prisma.$transaction(tx => createIssueWorkOrder(tx, {
        code: softDeletedCode,
        productName: '不应重复创建',
        customerName: '', specification: '', sourceOrderNo: '', remark: '',
      }, actor.id)),
      (error: unknown) => error instanceof IssueWorkOrderConflictError && error.softDeleted,
    );

    const rollbackCode = `${prefix}-ROLLBACK`;
    await assert.rejects(prisma.$transaction(async tx => {
      await createIssueWorkOrder(tx, {
        code: rollbackCode,
        productName: '回滚验证产品',
        customerName: '', specification: '', sourceOrderNo: '', remark: '',
      }, actor.id);
      throw new Error('force rollback');
    }));
    assert.equal(await prisma.workOrder.count({ where: { code: rollbackCode } }), 0);
  } finally {
    await prisma.workOrder.deleteMany({ where: { code: { startsWith: prefix, mode: 'insensitive' } } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
