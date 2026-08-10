import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MaterialFollowUpStatus, WarehouseExceptionCaseStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

test('warehouse exception events keep resolved history while a later event stays active', {
  skip: !runDatabaseIntegration,
}, async () => {
  const prefix = `material-sync-it-${randomUUID().slice(0, 8)}`;
  const actor = await prisma.user.create({
    data: {
      username: `${prefix}-user`,
      passwordHash: 'integration-test-only',
      displayName: 'Material Sync Integration',
      laborRole: 'ADMIN',
    },
  });
  const workOrder = await prisma.workOrder.create({
    data: {
      code: `${prefix}-WO-001`,
      productName: `${prefix}-产品`,
      specification: `${prefix}-SPEC`,
      customerName: '集成测试客户',
      stage: 'not_issued',
      planType: 'weekly_plan',
      planActive: true,
      weekStartDate: new Date('2026-08-09T16:00:00.000Z'),
      weekEndDate: new Date('2026-08-16T15:59:59.999Z'),
    },
  });
  try {
    const warehouseTask = await prisma.warehouseMaterialTask.create({
      data: {
        workOrderId: workOrder.id,
        status: 'exception',
        exceptionType: 'shortage',
        exceptionNote: '端子不足 200 套',
        updatedById: actor.id,
      },
    });
    const firstCase = await prisma.warehouseMaterialExceptionCase.create({
      data: {
        warehouseTaskId: warehouseTask.id,
        sequence: 1,
        status: WarehouseExceptionCaseStatus.RESOLVED,
        exceptionType: 'shortage',
        exceptionNote: '端子不足 100 套',
        reportedById: actor.id,
        resolvedAt: new Date('2026-08-10T01:00:00.000Z'),
        resolvedById: actor.id,
        resolutionNote: '第一批物料已复核入库',
      },
    });
    await prisma.materialFollowUpTask.create({
      data: {
        warehouseTaskId: warehouseTask.id,
        warehouseExceptionId: firstCase.id,
        status: MaterialFollowUpStatus.RESOLVED,
        latestProgress: '第一批物料已复核入库',
        resolvedAt: new Date('2026-08-10T01:00:00.000Z'),
        createdById: actor.id,
        resolvedById: actor.id,
      },
    });
    const secondCase = await prisma.warehouseMaterialExceptionCase.create({
      data: {
        warehouseTaskId: warehouseTask.id,
        sequence: 2,
        exceptionType: 'wrong_material',
        exceptionNote: '新到物料型号错误',
        reportedById: actor.id,
      },
    });
    const secondFollowUp = await prisma.materialFollowUpTask.create({
      data: {
        warehouseTaskId: warehouseTask.id,
        warehouseExceptionId: secondCase.id,
        status: MaterialFollowUpStatus.PENDING,
        latestProgress: '新到物料型号错误',
        createdById: actor.id,
      },
    });

    assert.equal(await prisma.materialFollowUpTask.count({ where: { warehouseTaskId: warehouseTask.id } }), 2);
    assert.equal(await prisma.warehouseMaterialExceptionCase.count({
      where: { warehouseTaskId: warehouseTask.id, status: WarehouseExceptionCaseStatus.RESOLVED },
    }), 1);
    assert.equal(await prisma.warehouseMaterialExceptionCase.count({
      where: { warehouseTaskId: warehouseTask.id, status: WarehouseExceptionCaseStatus.OPEN },
    }), 1);

    const expectedArrivalAt = new Date('2026-08-12T04:00:00.000Z');
    await prisma.$transaction([
      prisma.materialFollowUpTask.update({
        where: { id: secondFollowUp.id },
        data: {
          status: MaterialFollowUpStatus.WAITING_ARRIVAL,
          ownerId: actor.id,
          expectedAt: expectedArrivalAt,
          latestProgress: '采购确认 8 月 12 日到料',
        },
      }),
      prisma.warehouseMaterialExceptionCase.update({
        where: { id: secondCase.id },
        data: {
          expectedArrivalAt,
          expectedArrivalById: actor.id,
          expectedArrivalUpdatedAt: new Date(),
        },
      }),
      prisma.warehouseMaterialTask.update({
        where: { id: warehouseTask.id },
        data: { expectedAt: expectedArrivalAt },
      }),
    ]);
    const synchronized = await prisma.warehouseMaterialTask.findUniqueOrThrow({
      where: { id: warehouseTask.id },
      include: {
        exceptionCases: { where: { status: WarehouseExceptionCaseStatus.OPEN } },
        followUpTasks: { where: { status: MaterialFollowUpStatus.WAITING_ARRIVAL } },
      },
    });
    assert.equal(synchronized.expectedAt?.toISOString(), expectedArrivalAt.toISOString());
    assert.equal(synchronized.exceptionCases[0]?.expectedArrivalAt?.toISOString(), expectedArrivalAt.toISOString());
    assert.equal(synchronized.followUpTasks[0]?.expectedAt?.toISOString(), expectedArrivalAt.toISOString());
  } finally {
    await prisma.workOrder.delete({ where: { id: workOrder.id } });
    await prisma.operationLog.deleteMany({ where: { userId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
  }
});
