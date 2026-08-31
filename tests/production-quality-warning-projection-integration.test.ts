import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { materializeProductQualityWarningForWorkOrderInTransaction } from '../lib/internal-quality-risks';

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

class RollbackIntegrationFixture extends Error {}

test('bounded quality-warning pair projection is idempotent and honors effective/revoked state', {
  skip: !runDatabaseIntegration,
  timeout: 60_000,
}, async () => {
  await assert.rejects(
    prisma.$transaction(async tx => {
      const token = `QUALITY-PROJECTION-${randomUUID().slice(0, 8)}`;
      const now = new Date('2026-08-31T04:00:00.000Z');
      const product = await tx.drawingLibraryItem.create({
        data: {
          customerName: token,
          customerCode: token,
          productName: '质量投影测试产品',
          specification: token,
          libraryKey: token,
        },
      });
      const createOrder = (suffix: string) => tx.workOrder.create({
        data: {
          code: `${token}-${suffix}`,
          productName: '质量投影测试产品',
          stage: 'frontend',
          drawingLibraryItemId: product.id,
        },
      });
      const [eligible, future, revoked] = await Promise.all([
        createOrder('ELIGIBLE'),
        createOrder('FUTURE'),
        createOrder('REVOKED'),
      ]);
      const report = await tx.internalQualityRiskReport.create({
        data: {
          reportNo: token,
          title: '质量投影回滚集成',
          status: 'ARCHIVED',
          warningState: 'ACTIVE',
          archivedAt: now,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
          effectiveUntil: new Date('2026-09-30T00:00:00.000Z'),
        },
      });
      const revision = await tx.internalQualityRiskRevision.create({
        data: {
          reportId: report.id,
          revisionNumber: 1,
          published: true,
          archivedAt: now,
          snapshot: {
            effectiveFrom: '2026-08-01T00:00:00.000Z',
            effectiveUntil: '2026-09-30T00:00:00.000Z',
          },
          products: { create: { drawingLibraryItemId: product.id } },
        },
      });
      await tx.internalQualityRiskReport.update({
        where: { id: report.id },
        data: { currentRevisionId: revision.id },
      });

      const projection = { reportId: report.id, workOrderId: eligible.id, now };
      assert.equal(await materializeProductQualityWarningForWorkOrderInTransaction(tx, projection), 'created');
      assert.equal(await materializeProductQualityWarningForWorkOrderInTransaction(tx, projection), 'existing');
      assert.equal(await tx.workOrderQualityAlert.count({ where: { workOrderId: eligible.id } }), 1);

      await tx.internalQualityRiskRevision.update({
        where: { id: revision.id },
        data: { snapshot: { effectiveFrom: '2026-09-01T00:00:00.000Z' } },
      });
      assert.equal(await materializeProductQualityWarningForWorkOrderInTransaction(tx, {
        reportId: report.id,
        workOrderId: future.id,
        now,
      }), 'ineligible');

      await tx.internalQualityRiskRevision.update({ where: { id: revision.id }, data: { snapshot: {} } });
      await tx.internalQualityRiskReport.update({ where: { id: report.id }, data: { warningRevokedAt: now } });
      assert.equal(await materializeProductQualityWarningForWorkOrderInTransaction(tx, {
        reportId: report.id,
        workOrderId: revoked.id,
        now,
      }), 'ineligible');
      assert.equal(await tx.workOrderQualityAlert.count({ where: { workOrderId: { in: [future.id, revoked.id] } } }), 0);

      throw new RollbackIntegrationFixture();
    }, { timeout: 30_000 }),
    error => error instanceof RollbackIntegrationFixture,
  );
});
